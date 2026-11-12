/* ==========================================================================
 *  render-listen.js —— Q2「在听」屏的渲染
 * --------------------------------------------------------------------------
 *  原 render.js 第 229–461 行（Q3 拆完之后的行号），逐行搬来，未改一字。
 *
 *  这一段的内部状态 listenMeta、曲目容量推算 trackCap、页脚 paintListenFoot
 *  都只在本屏内闭环；对外只需要 setTracks / setListenMeta / renderListen。
 *  · setTracks     sync.js 抓到真实排行后重画；density.js / player 校验也会调
 *  · setListenMeta sync.js 只更新累计听歌与同步状态
 *  · renderListen  收进 render.js 的块表（layer 2）
 * ========================================================================== */

(function (K) {
  "use strict";

  var C = K.C, esc = K.esc, text = K.text, icon = K.icon;
  var $ = K.$, set = K.set, arr = K.arr, delay = K.delay;

  /* ========================================================== Q2 · 在听 */
  /* 一首歌 = 一块磁贴。磁贴吸附在主卡片的唱片底纹上：
     序号、曲名、歌手、播放入口，四样都在一块里，不再是一行行的表格。
     序号用等宽数字 —— 01~06 竖向对齐时，列表看起来才整齐。

     ⚠️ 2026-11-10 从「最近在听」改成「听歌排行」：
     以前只显示歌名，其实网易云那边每首歌都有播放次数，只是被脚本丢掉了。

     ⚠️ 2026-11-10 三次定稿 —— 只留排行，不要热度条。
     中间版本画过一根「相对热度条」，理由是匿名接口把次数脱敏成 score。
     实测真实数据后发现它没用：我这一周的 score 是 100/57/51/51/48/48，
     归一化到 32px 轨道上就是 32/18/16/16/15/15 ——
     后四首差 1px，读者看不出任何区别，只会以为那是几根随机的短线，
     而它占掉的 32px 正是曲名最缺的宽度（曲名是这一屏唯一的正文）。
     所以热度条撤掉，排行靠两件事表达：
       · 序号 01~06 的先后顺序（这本来就是排行榜）
       · 前三名的序号用强调色（排行榜的通用语言，零宽度成本）
     有真实 playCount 时才印「128 次」；只有 score 时什么都不印。
     绝不在只有 score 的时候印「100 次」—— 那是个编出来的数字。 */
  function fmtNum(n) {
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* sync.js 抓来的额外信息（累计听歌 / 等级 / 数据来源 / 同步时间）。
     和曲目分开存：排行抓不到时，这几个数字照样有。 */
  var listenMeta = {
    total: 0, level: 0, updated: "", live: false, source: "rank",
    /* 这一批曲目里"能站内播"和"实际显示"各多少首。
       页脚据此决定要不要说一句「站内试听 1/6 首 · 其余为会员曲」——
       部分可播是最容易让人困惑的状态，必须解释。 */
    shownCount: 0, playableCount: 0
  };

  function trackHtml(t, i) {
    var meta = [t.artist, t.album].filter(Boolean).join(" · ");

    /* 只有真实次数才印数字。score 是服务端的相对热度，
       印成"N 次"是编数据，画成条又看不出差别 —— 两样都不做。 */
    var plays = Number(t.playCount) > 0
      ? '<span class="track__plays">' + fmtNum(t.playCount) +
        '<span class="track__plays-unit">次</span></span>'
      : "";

    /* 前三名的序号高亮。不加奖牌、不加图标 ——
       排行榜的语言本来就是"数字越小越靠前"，一个颜色就够。 */
    var top3 = i < 3 ? " is-top" : "";

    /* 封面。sync.mjs 已带上 ?param=120y120（约 3~5KB），这里按 34px 显示，
       2x 屏也够清晰。没有封面时画一个音符占位块 —— 比留空白格好看，
       也避免为不存在的图发一次请求。 */
    var cover = t.cover
      ? '<img class="track__pic" src="' + esc(t.cover) + '" alt="" ' +
        'width="34" height="34" loading="lazy" decoding="async" ' +
        'referrerpolicy="no-referrer">'
      : (window.siteIcon ? '<span class="track__pic track__pic--none">' +
          window.siteIcon("music") + "</span>" : "");

    /* 播放按钮的三种形态：
         ① playable === true  → 站内播放按钮（player.js 接管）
         ② playable === false → 外链，title 说明"需要会员"
         ③ 未定义（老数据）    → 外链。保守总比放一个按不出声的按钮好。
       ⚠️ outer/url 里的 `.mp3` 必须拼在 id 后面，写成 ?ext=mp3 不生效。 */
    var songId = (function () {
      var m = /[?&]id=(\d+)/.exec(t.url || "");
      return m ? m[1] : "";
    })();

    var action = "";
    if (t.url) {
      if (t.playable === true && songId) {
        action = '<button class="track__go track__play" type="button"' +
          ' data-play="' + esc(t.url) + '"' +
          ' data-src="https://music.163.com/song/media/outer/url?id=' + songId + '.mp3"' +
          ' aria-pressed="false" aria-label="播放 ' + esc(t.title || "") + '">' +
          icon("play") + "</button>";
      } else {
        var why = t.playable === false ? "（网易云会员 / 版权曲）" : "";
        action = '<a class="track__go" href="' + esc(t.url) + '"' +
          ' target="_blank" rel="noopener noreferrer"' +
          ' title="在网易云打开' + why + '"' +
          ' aria-label="在网易云打开 ' + esc(t.title || "") + why + '">' +
          icon("play") + "</a>";
      }
    }

    return '<li class="track" style="' + delay(i, 45) + '" data-reveal ' +
             'data-idx="' + (i + 1) + '">' +
             '<span class="track__idx' + top3 + '">' + String(i + 1).padStart(2, "0") + "</span>" +
             cover +
             '<span class="track__main">' +
               '<span class="track__title">' + esc(t.title || "") + "</span>" +
               (meta ? '<span class="track__meta">' + esc(meta) + "</span>" : "") +
             "</span>" +
             plays +
             action +
           "</li>";
  }

  /* 页脚：数据来源 + 累计听歌 + 外链。
     累计听歌是这一屏唯一一个"总量"指标，所以给它单独一个位置和字号，
     而不是和"已同步"挤在同一行小字里。 */
  function paintListenFoot() {
    var foot = $("listenFoot");
    if (!foot) return;
    var d = C.listen || {};
    var uid = d.neteaseUid || "";
    var link = uid && uid !== "000000000"
      ? "https://music.163.com/#/user/home?id=" + encodeURIComponent(uid)
      : "https://music.163.com/";

    /* 四种状态，页脚说四种话 —— 关键是别让"数字是真的"冒充"歌也是真的"：
         · 排行已同步        → 已同步
         · 我喜欢的音乐      → 已同步 · 收藏（内容真实，但语义不是"排行"，必须点明）
         · 只有累计听歌      → 排行待同步（数字是真的，歌还是兜底）
         · 什么都没有        → 示例数据 · 等待首次同步 */
    var src;
    if (listenMeta.live && listenMeta.source === "liked") {
      src = '<span class="listen__src is-live is-liked" title="听歌排行未公开，当前显示的是「我喜欢的音乐」">' +
              '<span class="live-dot" aria-hidden="true"></span>已同步 · 收藏</span>';
    } else if (listenMeta.live) {
      src = '<span class="listen__src is-live"><span class="live-dot" aria-hidden="true"></span>已同步</span>';
    } else if (listenMeta.total) {
      src = '<span class="listen__src is-pending">排行待同步</span>';
    } else {
      src = '<span class="listen__src">示例数据 · 等待首次同步</span>';
    }

    var stat = listenMeta.total
      ? '<span class="listen__stat">累计听歌 <b>' + fmtNum(listenMeta.total) + "</b> 首</span>"
      : "";

    /* 试听说明。只在"部分可播"时出现 ——
       全可播不用解释，全不可播时的每一行本来就是外链，也不用解释。
       偏偏"部分可播"最容易让人困惑："为什么第 4 首能放，第 1 首点了却跳走？"
       一句话把原因（会员 / 版权）说在前面，比让用户逐个试要好。 */
    var note = "";
    if (listenMeta.playableCount > 0 && listenMeta.playableCount < listenMeta.shownCount) {
      /* 文案刻意短：「1/6 可试听」。长版本（"站内试听 1/6 首 · 其余为会员曲"）
         在 320px 上会把页脚挤成两行，多出的 20 多 px 正好顶出屏幕。
         完整原因放进 title，鼠标悬停能看到，读屏也会念。 */
      note = '<span class="listen__note" title="网易云的 VIP 与付费版权曲不提供外链音频，只能去客户端听">' +
             listenMeta.playableCount + "/" + listenMeta.shownCount + " 可试听</span>";
    }

    foot.innerHTML =
      '<span class="listen__meta">' + src + stat + note + "</span>" +
      /* 窄屏（≤400px）只留箭头，文字用 font-size:0 收掉 ——
         320px 下「去网易云看看」会把页脚挤成两行，多出的 29px
         正好把这一屏顶出屏幕。文字仍在 DOM 里，读屏照常念。 */
      '<a class="listen__more" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer"' +
        ' aria-label="去网易云看看" title="去网易云看看">' +
        "去网易云看看" + icon("arrow-up-right") + "</a>";
  }

  /* 一屏最多放几首？
     从可用高度倒推，而不是写死 limit —— 320×568 上六行单列会把这一屏
     撑到 787px（超屏 219px），paged.js 只好把整站降级成可滚动。
     以前没暴露：示例数组只有 3 首，恰好装得下；真实排行有 6 首，立刻溢出。

     常数是实测的：390×844 下单列磁贴 75px 高 + 8px 间距，
     页头/卡片内边距/页脚共约 350px。350 和 84(75+8) 是在真浏览器里
     量出来的，不是猜的 —— 改磁贴的内边距或字号，这两个数要跟着重测。 */
  function trackCap() {
    var w = window.innerWidth || 400;
    var h = window.innerHeight || 800;
    var cols = w <= 680 ? 1 : w <= 900 ? 2 : 3;
    var rows = Math.max(2, Math.round((h - 350) / 84));
    return rows * cols;
  }

  /* 把"听歌排行"画出来。sync.js 抓到真实数据后也会调用它。 */
  function setTracks(list, source, meta) {
    var d = C.listen || {};
    var ul = $("trackList");
    if (!ul) return;

    if (source) listenMeta.live = source === "live";
    if (meta) {
      if (Number(meta.totalSongs) > 0) listenMeta.total = Number(meta.totalSongs);
      if (Number(meta.level) > 0) listenMeta.level = Number(meta.level);
      if (meta.updated) listenMeta.updated = meta.updated;
      if (meta.source) listenMeta.source = meta.source;
    }

    var items = arr(list).slice(0, Math.min(d.limit || 6, trackCap()));

    ul.innerHTML = items.map(trackHtml).join("");
    ul.setAttribute("data-count", String(items.length));

    /* 页脚那句「站内试听 N/M 首」要用的两个数。
       必须在这里更新而不是在 paintListenFoot 里数 DOM ——
       paintListenFoot 也会被"只更新页脚"那条路径调用，那时列表还是旧的，
       数出来的是上一批曲目，页脚就会和列表对不上。 */
    listenMeta.shownCount = items.length;
    listenMeta.playableCount = items.filter(function (t) {
      return t.playable === true && t.url;
    }).length;
    /* 有真实次数时标记：手机上要换成单列，
       否则两列里每块只剩 ~100px 放"曲名 + 次数"，两样都会被截断。 */
    ul.setAttribute("data-ranked",
      items.some(function (t) { return Number(t.playCount) > 0; }) ? "1" : "0");
    paintListenFoot();

    /* ⚠️ 重绘后必须补挂渐显。
       曲目块带 data-reveal，而 motion.js 的 IntersectionObserver 只在
       init 时扫过一遍；这里 innerHTML 重建出来的新节点没人观察，
       于是永远停在 opacity: 0 —— 数据在、节点在，就是看不见。
       这正是"网易云抓到数据但不显示"的根因。 */
    if (window.SITE_MOTION && typeof window.SITE_MOTION.revealScan === "function") {
      window.SITE_MOTION.revealScan(ul);
    }
  }

  /* 只更新页脚（累计听歌变了、但曲目没变时用） */
  function setListenMeta(meta) {
    if (!meta) return;
    if (Number(meta.totalSongs) > 0) listenMeta.total = Number(meta.totalSongs);
    if (Number(meta.level) > 0) listenMeta.level = Number(meta.level);
    if (meta.updated) listenMeta.updated = meta.updated;
    /* ⚠️ 显式赋值而不是 `if (meta.live)`：调用方不传 live 就意味着
       "这次没有真实曲目"，此时必须把 live 拉回 false，
       否则页脚会停在"已同步"，替一排兜底歌曲作伪证。 */
    listenMeta.live = meta.live === true;
    paintListenFoot();
  }

  function renderListen() {
    var d = C.listen || {};
    /* 骨架（#trackList / #listenFoot）写在 index.html 里，这里只填内容。
       早先是整块用 innerHTML 生成 —— 那样 sync.js 回填时必须先等 DOM 解析，
       而且在没有 HTML 解析的环境（自检用的极简 DOM）里会取不到节点。 */
    setTracks(d.fallback, "fallback");
  }

  K.register("listen", {
    renderListen: renderListen,
    setTracks: setTracks,
    setListenMeta: setListenMeta
  });
})(window.SITE_RENDER_KIT);
