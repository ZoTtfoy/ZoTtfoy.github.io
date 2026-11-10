/* ==========================================================================
 *  player.js —— Q2「在听」的站内播放
 * --------------------------------------------------------------------------
 *  为什么不是简单的 <audio src="...">：
 *
 *  ① 网易云的外链播放地址对 VIP / 付费版权曲返回的是**一个 HTML 提示页**
 *     （"因版权要求无法播放"），HTTP 状态还是 200。也就是说"能不能播"
 *     不能靠 URL 判断，必须提前探测并写进数据（scripts/sync.mjs 的 canPlay）。
 *     实测本站 100 首里 56 首能播，44 首不能 —— 你听的日系曲子大多要会员。
 *
 *     所以这个播放器只处理"数据里标记为可播"的那些。不能播的由渲染层
 *     直接画成外链，点了会去网易云 —— 而不是给一个按下去没反应的按钮。
 *
 *  ② 同一时间只能有一首在响。第二首点下去必须先停第一首，
 *     否则多个 <audio> 叠在一起，而且没有统一的"当前是哪一首"状态。
 *     所以这里用**单例 audio**：换歌就是换 src，不是新建元素。
 *
 *  ③ 页面是一个六屏的翻页结构，Q2 只是其中一屏。用户切到别的屏时
 *     音乐应该继续放（这就是听歌），但要能随时从浮窗或回 Q2 停掉。
 *     所以播放器挂在 window 上，不随某一屏的渲染生命周期销毁。
 *
 *  和 live.js 的 music-dock 的关系：
 *     那个浮窗读的是 config.music.src，配的常常是**网页地址**而不是音频文件，
 *     所以它实际上是"点一下打开网易云"。两者都出声会叠音，
 *     所以在 play() 里主动把它压住（见 hushDock）。
 * ========================================================================== */

window.SITE_PLAYER = (function () {
  "use strict";

  var audio = null;
  var curKey = null;      // 当前曲目的 url（用它当唯一键，id 可能缺）
  var curRow = null;      // 当前播放的 <li>
  var listeners = [];
  var failedOnce = {};    // 探测说能播、实际却失败了的曲目，记下来避免反复踩

  var BASE_VOLUME = 0.8;

  function ensure() {
    if (audio) return audio;
    audio = document.createElement("audio");
    audio.preload = "none";       // 不预加载：六首全预载等于替用户下几 MB
    audio.volume = BASE_VOLUME;
    /* 不做 loop：一首歌放完就停，进度条归零。
       循环播放会让"到底放完没有"变得不可知 —— 列表里看不出状态。 */
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", function () { reset(true); });
    audio.addEventListener("error", onError);
    document.body.appendChild(audio);
    return audio;
  }

  /* ------------------------------------------------------------ 状态同步 */
  function emit() {
    var st = state();
    listeners.forEach(function (fn) {
      try { fn(st); } catch (e) { /* 监听方出错不该影响播放本身 */ }
    });
  }

  function paintRow() {
    /* 只改"当前行"，不去遍历整个列表：
       列表会随同步结果重建，遍历到已经不存在的节点会白跑。 */
    if (curRow && curRow.isConnected) {
      curRow.classList.add("is-playing");
      curRow.setAttribute("data-playing", "1");
      var btn = curRow.querySelector("[data-play]");
      if (btn) {
        btn.setAttribute("aria-label", "暂停");
        btn.setAttribute("aria-pressed", "true");
        swapIcon(btn, "pause");
      }
    }
  }

  function clearRow() {
    if (!curRow) return;
    var btn = curRow.querySelector("[data-play]");
    if (btn) {
      btn.setAttribute("aria-label", "播放");
      btn.setAttribute("aria-pressed", "false");
      swapIcon(btn, "play");
    }
    curRow.classList.remove("is-playing");
    curRow.removeAttribute("data-playing");
    curRow.style.removeProperty("--p");
    curRow = null;
  }

  /* 图标替换：只换 <svg>，保留按钮上的其他东西。
     没有 siteIcon 时退化成文字，保证按钮永远不是空的。 */
  function swapIcon(btn, name) {
    if (!btn) return;
    var html = window.siteIcon ? window.siteIcon(name) : "";
    if (!html) return;
    var svg = btn.querySelector("svg");
    if (svg) {
      var box = document.createElement("span");
      box.innerHTML = html;
      var next = box.firstElementChild;
      if (next) svg.replaceWith(next);
    } else {
      btn.innerHTML = html;
    }
  }

  function onTime() {
    if (!audio || !curRow || !curRow.isConnected) return;
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    var p = Math.min(1, audio.currentTime / d);
    /* 写成一个 0~1 的自定义属性，样式层自己决定怎么画。
       不在 JS 里算 px，这样窄屏/缩放时不用改代码。 */
    curRow.style.setProperty("--p", p.toFixed(4));
  }

  /* 播完 / 手动停：复位但不卸载，随时能再播 */
  function reset(ended) {
    var was = curRow;
    clearRow();
    if (ended && audio) audio.currentTime = 0;
    curKey = null;
    if (was && ended) {
      /* 播完时把进度清零，否则下次点播会从 100% 开始往回跳一下 */
      was.style.removeProperty("--p");
    }
    emit();
  }

  function onError() {
    /* 走到这里说明"探测说能播，实际播不了" —— 版权状态可能在两次同步之间变了。
       处理方式：标记这一首、复位界面、跳网易云。不弹一大段错误文字，
       因为用户此刻的意图很明确（想听这首），最该给的是"去哪能听"。 */
    var key = curKey;
    var row = curRow;
    reset(false);
    if (key) failedOnce[key] = true;
    if (row && row.isConnected) {
      row.classList.add("is-blocked");
      var btn = row.querySelector("[data-play]");
      if (btn) {
        btn.setAttribute("aria-label", "这首在网易云需要会员，点开去听");
        btn.removeAttribute("data-play");
      }
    }
    if (window.SITE_TOAST) {
      window.SITE_TOAST("这首暂时无法站内播放，正在打开网易云…");
    }
    var link = row && row.querySelector("a[href*='music.163.com'], a[data-go]");
    if (link) { try { window.open(link.href, "_blank", "noopener"); } catch (e) {} }
  }

  /* 把 live.js 的音乐浮窗按下去，避免两个声音叠在一起。
     浮窗没有对外接口，所以直接找它的 <audio> 暂停 —— 这是个 DOM 契约，
     浮窗改结构时这里会静默失效（不会报错），属于可接受的降级。 */
  function hushDock() {
    var dock = document.querySelector(".music-dock");
    if (!dock) return;
    var a = dock.querySelector("audio");
    if (a && !a.paused) {
      a.pause();
      var b = dock.querySelector("#musicBtn");
      if (b) {
        b.setAttribute("aria-label", "播放");
        dock.classList.remove("is-playing");
      }
    }
  }

  /* ---------------------------------------------------------------- 控制 */
  function play(url, key, row) {
    if (!url) return false;
    var a = ensure();
    hushDock();

    /* 已经在放这一首：不重新加载（会从头开始，听起来像卡了一下） */
    if (curKey === (key || url) && !a.paused) return true;

    /* 换行之前先把上一行的状态清掉 */
    clearRow();
    curKey = key || url;
    curRow = row || null;

    a.src = url;
    a.currentTime = 0;
    paintRow();
    emit();

    var p = a.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () {
        /* 自动播放被拦：这是用户点击触发的，正常不会发生。
           真发生了就当"没播"，不要留下一个假的播放状态。 */
        reset(false);
      });
    }
    return true;
  }

  function pause() {
    if (audio && !audio.paused) audio.pause();
    reset(false);
  }

  function stop() {
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    reset(false);
  }

  function toggle(url, key, row) {
    if (curKey === (key || url) && audio && !audio.paused) {
      pause();
      return false;
    }
    return play(url, key, row);
  }

  function state() {
    return {
      key: curKey,
      playing: !!(audio && !audio.paused && curKey),
      time: audio ? +audio.currentTime.toFixed(2) : 0,
      duration: audio && isFinite(audio.duration) ? +audio.duration.toFixed(2) : 0,
      volume: audio ? audio.volume : BASE_VOLUME
    };
  }

  /* ------------------------------------------------------------- 事件接线
     委托在 #trackList 上，而不是给每个按钮单独绑：
     列表是 innerHTML 重建的，逐个绑会在重建后全部失效 ——
     这正是之前网易云列表"能看见但没反应"的那类坑。 */
  function init() {
    var list = document.getElementById("trackList");
    if (!list) return;

    list.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-play]") : null;
      if (!btn || !list.contains(btn)) return;
      /* 按钮在 <li> 里，而 <li> 里还可能有外链 <a> —— 别让点击冒泡过去 */
      e.preventDefault();
      e.stopPropagation();

      var row = btn.closest(".track");
      var url = btn.getAttribute("data-src");
      var key = btn.getAttribute("data-play");
      toggle(url, key, row);
    });

    /* 空格 / 回车：按钮是原生 <button>，本来就响应，
       这里什么都不用加。加一层反而会和浏览器的默认行为打架。 */

    /* 页面隐藏时不停（切标签页继续听是合理预期），
       但离开站点前把它停掉，避免关页面前还在响。 */
    window.addEventListener("pagehide", function () {
      if (audio && !audio.paused) audio.pause();
    });
  }

  return {
    init: init,
    play: play,
    pause: pause,
    stop: stop,
    toggle: toggle,
    state: state,
    /* 供测试与将来的浮窗复用 */
    on: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    audio: function () { return audio; }
  };
})();
