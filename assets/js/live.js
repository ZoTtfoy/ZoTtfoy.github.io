/* ==========================================================================
 *  live.js —— 首页的「活着的」细节
 * --------------------------------------------------------------------------
 *  五件事：
 *    1. 载入动画：首屏一条细线走完就退场，每次会话只出现一次
 *    2. 实时时钟：时:分 + 星期 + 日期（等宽数字，跳动不抖）
 *    3. 时光进度条：今年过了百分之多少
 *    4. 一言：本地精选为主，可选联网；点一下换一句
 *    5. 音乐浮窗：只在配置了音源或链接时出现，绝不自动播放
 *
 *  为什么一言默认用本地列表：
 *    公开的一言接口返回内容随机，风格跨度极大（有很丧的、有无厘头的）。
 *    主页常在社交场合给别人看，随机到一句不合适的会很尴尬。
 *    本地列表可控、零网络、零失败。想要联网可在 config 里打开 quoteRemote。
 * ========================================================================== */

window.SITE_LIVE = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};
  var L = C.live || {};
  var M = C.music || {};
  var reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var $ = function (id) { return document.getElementById(id); };
  var timers = [];

  function reduced() { return reduceQuery.matches; }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function on(v) { return v !== false; }     // 未配置时默认开启

  /* ======================================================== 1. 载入动画 */
  function initSplash() {
    var el = $("splash");
    if (!el) return;

    // 用配置里的名字填进去，而不是写死在 HTML 里
    var s = C.site || {};
    var mark = el.querySelector(".splash__mark");
    var name = el.querySelector(".splash__name");
    if (mark) mark.textContent = s.initials || (s.name || "Z").slice(0, 1);
    if (name) name.textContent = String(s.name || "").toUpperCase();

    /* 退场。⚠️ 只有在"没有预取闸门"时才允许自动退场：
       preload.js 会在首屏/第二屏的图解码完之前把 gating 置真，
       这时任何计时器都不该把 splash 收掉 —— 否则闸门形同虚设，
       用户看到的还是"图没到位就先给页面"。真退场由 preload 调 done(true)。 */
    function done(force) {
      if (!force && window.SITE_PRELOAD && window.SITE_PRELOAD.gating) return;
      el.classList.add("is-done");
      document.documentElement.dataset.loading = "0";
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 600);
    }

    /* 暴露给 preload.js —— 它是唯一知道"图到底缓存完没有"的一方 */
    window.SITE_SPLASH = { done: done, el: el };

    // 内联脚本没标记要显示（非首次 / 减少动效），直接清理
    if (document.documentElement.dataset.loading !== "1") {
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }

    // 硬上限：不管资源加载到哪一步，最多 900ms 就退场（有闸门时由 preload 接管）
    var cap = setTimeout(function () { done(false); }, 900);
    if (document.readyState === "complete") {
      clearTimeout(cap);
      setTimeout(function () { done(false); }, 380);   // 已加载完，让动画走完就收
    } else {
      window.addEventListener("load", function () {
        clearTimeout(cap);
        setTimeout(function () { done(false); }, 320);
      }, { once: true });
    }

    // 允许点击跳过 —— 这一下是用户主动要进去，闸门也不拦
    el.addEventListener("click", function () { done(true); });
  }

  /* ======================================================== 2. 实时时钟 */
  var WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function paintClock() {
    var now = new Date();
    var clock = $("liveClock");
    var day = $("liveDate");
    var week = $("liveWeek");
    if (clock) clock.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes());
    if (week) week.textContent = WEEK[now.getDay()];
    if (day) day.textContent = (now.getMonth() + 1) + " 月 " + now.getDate() + " 日";
  }

  function initClock() {
    if (!on(L.clock)) return;
    var box = $("liveMeta");
    if (!box) return;
    paintClock();
    box.hidden = false;
    // 每 15 秒对齐一次就够（分钟级的显示）
    var t = setInterval(paintClock, 15000);
    timers.push(t);
  }

  /* ==================================================== 3. 时光进度条 */
  function initProgress() {
    if (!on(L.progress)) return;
    var box = $("liveProgress");
    if (!box) return;

    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 1);
    var end = new Date(now.getFullYear() + 1, 0, 1);
    var ratio = (now - start) / (end - start);
    ratio = Math.min(1, Math.max(0, ratio));
    var pct = ratio * 100;

    box.hidden = false;
    var fill = $("liveProgressFill");
    var label = $("liveProgressLabel");
    if (label) label.textContent = "今年已过 " + pct.toFixed(pct >= 10 ? 0 : 1) + "%";

    if (fill) {
      // 下一帧再赋值，保证过渡能看到（从 0 长出来）
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          fill.style.transform = "scaleX(" + ratio.toFixed(4) + ")";
        });
      });
    }
  }

  /* ============================================================ 4. 一言 */
  var QUOTES = Array.isArray(C.quotes) && C.quotes.length
    ? C.quotes
    : ["把复杂的东西，做得简单一点。"];

  var quoteIndex = -1;

  function pickQuote() {
    if (QUOTES.length === 1) return { text: QUOTES[0], from: "" };
    var i = quoteIndex;
    while (i === quoteIndex) i = Math.floor(Math.random() * QUOTES.length);
    quoteIndex = i;
    var item = QUOTES[i];
    return typeof item === "string" ? { text: item, from: "" } : { text: item.text || "", from: item.from || "" };
  }

  function renderQuote(q) {
    var el = $("liveQuote");
    if (!el) return;
    el.innerHTML = '<span class="hero__quote__body">' + escapeHtml(q.text) + "</span>" +
      (q.from ? '<span class="hero__quote__from">— ' + escapeHtml(q.from) + "</span>" : "");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fetchRemoteQuote() {
    /* ⚠️ 先确认 fetch 存在再调。
       `fetch(...)` 在 fetch 未定义时抛的是 ReferenceError，不是 Promise rejection ——
       它不会走到下面的 .catch，而是直接冒泡出 initQuote，
       再被 main.js 那个包住整个 init 的 try 接住，于是**其余模块全都不初始化**。
       触发场景不止测试桩：老浏览器、被 CSP 拦掉、某些隐私模式禁用 fetch，都会这样。
       一言本来就是锦上添花，取不到就用本地列表，没有任何理由让它拖垮整站。 */
    if (typeof fetch !== "function") return Promise.resolve(null);

    // 5 秒超时；失败就用本地列表顶上，绝不留白
    return new Promise(function (resolve) {
      var settled = false;
      var to = setTimeout(function () {
        if (!settled) { settled = true; resolve(null); }
      }, 5000);

      try {
        fetch("https://v1.hitokoto.cn/?encode=json&max_length=24")
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (settled) return;
            settled = true;
            clearTimeout(to);
            resolve(data && data.hitokoto ? { text: data.hitokoto, from: data.from || "" } : null);
          })
          .catch(function () {
            if (settled) return;
            settled = true;
            clearTimeout(to);
            resolve(null);
          });
      } catch (e) {
        // fetch 同步抛错（部分环境下会）—— 同样降级
        if (!settled) { settled = true; clearTimeout(to); resolve(null); }
      }
    });
  }

  function initQuote() {
    if (!on(L.quote)) return;
    var el = $("liveQuote");
    if (!el) return;

    el.hidden = false;
    renderQuote(pickQuote());
    if (reduced()) return;   // 减少动效时不做换句动画

    // 点一下换一句（本地列表时才有意义）
    if (!L.quoteRemote) {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("title", "换一句");
      el.setAttribute("aria-label", "换一句");

      var swap = function () {
        el.classList.add("is-swapping");
        setTimeout(function () {
          renderQuote(pickQuote());
          el.classList.remove("is-swapping");
        }, 220);
      };
      el.addEventListener("click", swap);
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); swap(); }
      });
    } else {
      fetchRemoteQuote().then(function (q) {
        if (q && q.text) renderQuote(q);
      });
    }
  }

  /* ======================================================== 5. 音乐浮窗 */
  function initMusic() {
    if (!M || M.enabled !== true) return;
    if (!$("soundOn")) return;

    var bar = document.createElement("div");
    bar.className = "music-dock";

    /* 只有"真的是音频文件"的地址才做成播放按钮。
       ⚠️ config.music.src 里最常见填的是**网页地址**
       （ https://music.163.com/#/song?id=733149 这种），
       把它塞进 <audio> 必然报错，点一下的后果是 play() 被拒 →
       掉进 catch → window.open 弹一个新标签页。用户看到的是
       "我点播放，结果跳走了"，很像播放器坏了。
       所以先认扩展名（或网易云的外链地址），认不出就当纯链接 ——
       跳转至少是诚实的。 */
    var rawSrc = typeof M.src === "string" ? M.src.trim() : "";
    var isAudioFile = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)(\?|#|$)/i.test(rawSrc) ||
      /\/media\/outer\//.test(rawSrc);
    var hasSrc = rawSrc.length > 0 && isAudioFile;
    var title = M.title || "我的歌单";
    var artist = M.artist || "";

    if (hasSrc) {
      bar.innerHTML =
        '<button class="music-dock__btn" type="button" id="musicBtn" aria-label="播放">' +
          window.siteIcon("music") +
        "</button>" +
        '<span class="music-dock__text">' +
          '<span class="music-dock__title">' + escapeHtml(title) + "</span>" +
          (artist ? '<span class="music-dock__artist">' + escapeHtml(artist) + "</span>" : "") +
        "</span>";

      var audio = document.createElement("audio");
      audio.src = M.src;
      audio.loop = M.loop !== false;
      audio.preload = "none";
      audio.volume = typeof M.volume === "number" ? M.volume : 0.6;
      bar.appendChild(audio);

      var btn = bar.querySelector("#musicBtn");
      /* ⚠️ 必须判空再绑。
         这里的 #musicBtn 是靠上面 innerHTML 解析出来的，一旦解析没发生
         （极简 DOM、被 CSP 拦掉的 innerHTML、将来改成模板渲染），
         btn 就是 null，`btn.addEventListener` 会直接抛错 ——
         而 main.js 把整个 init 包在一个 try 里，于是**其余所有模块一起不初始化**：
         时钟、进度条、主题按钮全都没有，排查时完全看不出根因在音乐浮窗。
         宁可让浮窗退化成一个纯链接，也不要拖垮整站。 */
      if (!btn) {
        // 静默退化：这是可选装饰，不该在控制台制造噪音
        return;
      }
      var setIcon = function (playing) {
        btn.innerHTML = window.siteIcon(playing ? "pause" : "music");
        btn.setAttribute("aria-label", playing ? "暂停" : "播放");
        bar.classList.toggle("is-playing", playing);
      };

      btn.addEventListener("click", function () {
        if (audio.paused) {
          audio.play().then(function () { setIcon(true); }).catch(function () {
            // 浏览器拦截或不支持格式：回落成跳转链接
            if (M.link) window.open(M.link, "_blank", "noopener");
          });
        } else {
          audio.pause();
          setIcon(false);
        }
      });
      audio.addEventListener("ended", function () { setIcon(false); });
    } else {
      // 只有链接：做成一个去听歌的入口
      var a = document.createElement("a");
      a.className = "music-dock";
      a.href = M.link || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML =
        '<span class="music-dock__btn">' + window.siteIcon("headphones") + "</span>" +
        '<span class="music-dock__text">' +
          '<span class="music-dock__title">' + escapeHtml(title) + "</span>" +
          '<span class="music-dock__artist">' + escapeHtml(artist || "去听") + "</span>" +
        "</span>";
      bar = a;
    }

    document.body.appendChild(bar);
  }

  /* ============================================================ 初始化 */
  function init() {
    // 载入动画先挂，其余排后
    initSplash();
    initClock();
    initProgress();
    initQuote();
    initMusic();
  }

  return {
    init: init,
    /* 供自检使用，不依赖 DOM */
    _pct: function (date) {
      var now = date || new Date();
      var s = new Date(now.getFullYear(), 0, 1);
      var e = new Date(now.getFullYear() + 1, 0, 1);
      return (now - s) / (e - s);
    }
  };
})();
