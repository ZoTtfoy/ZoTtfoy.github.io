/* ==========================================================================
 *  渲染层：把 config.js 的数据填进 index.html 的骨架
 *  一般不需要改这个文件。新增内容优先改 config.js；
 *  新增模块则复制一个 <section> 骨架，再在这里补一段渲染函数。
 *
 *  页面 6 屏 → hero(Q1) / listen(Q2) / gaming(Q3) / repair(Q4) / links(Q5) / contact(Q6)
 * ========================================================================== */

window.SITE_RENDER = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};

  /* ---------- 小工具 ---------- */
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function text(v) { return esc(v).replace(/\n/g, "<br>"); }
  function icon(name, cls) { return window.siteIcon(name, cls); }
  function $(id) { return document.getElementById(id); }
  function set(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function delay(i, step) { return "--reveal-delay:" + (i * (step || 70)) + "ms;"; }

  /* ---------- 自定义主题色（在 config.js 的 ui.accent / ui.accentDark 里设置） ---------- */
  function hexToRgba(hex, alpha) {
    var h = String(hex).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    var n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  function applyAccent() {
    var ui = C.ui || {};
    var light = ui.accent, dark = ui.accentDark || ui.accent;
    if (!light && !dark) return;
    var root = document.documentElement;
    var isDark = root.dataset.theme === "dark";
    var color = isDark ? dark : light;
    if (!color) return;
    root.style.setProperty("--accent", color);
    var soft = hexToRgba(color, isDark ? 0.13 : 0.09);
    if (soft) root.style.setProperty("--accent-soft", soft);
  }

  /* ---------- 文档信息 ---------- */
  function renderMeta() {
    var s = C.site || {};
    document.title = esc(s.name) + " · 个人主页";
    var desc = document.querySelector('meta[name="description"]');
    var ogT = document.querySelector('meta[property="og:title"]');
    var ogD = document.querySelector('meta[property="og:description"]');
    if (desc) desc.setAttribute("content", s.description || "");
    if (ogT) ogT.setAttribute("content", esc(s.name) + " · 个人主页");
    if (ogD) ogD.setAttribute("content", s.description || "");
  }

  /* ---------- 头像：优先用图片，没有就退回字母方块 ---------- */
  function avatarUrl() {
    var v = (C.site || {}).avatar;
    return (typeof v === "string" && v.trim()) ? v.trim() : "";
  }

  function markHtml(size) {
    var s = C.site || {};
    var url = avatarUrl();
    var letter = esc(s.initials || (s.name || "Z").slice(0, 1));
    if (url) {
      return '<img class="brand__avatar' + (size ? " brand__avatar--sm" : "") + '" src="' + esc(url) +
             '" alt="' + esc(s.name || "头像") + '" loading="eager" decoding="async">';
    }
    return '<span class="brand__mark' + (size ? " brand__mark--sm" : "") + '">' + letter + '</span>';
  }

  /* 头像位是「字母块」还是「图片」要用不同外壳样式，必须让 CSS 知道。
     ⚠️ 这就是"深色下头像还有白边"的真正原因：
        #brandMark / #footerMark 本身是 .brand__mark —— 一个
        `border-radius: 10px` + `background: var(--text)` 的字母方块。
        深色主题下 --text 接近纯白，于是图片后面永远垫着一个**白色圆角方块**，
        图片再怎么 border-radius:50%，方角都会从四个角露出来。
        之前两轮只改 img 的边框和圆角，当然没用。
     解法：有图片时给外壳加 .is-photo —— 圆形、透明、overflow:hidden，
        由外壳负责裁切，img 铺满并轻微放大，把图片自带的浅色边缘也裁掉。 */
  function paintMark(id, size) {
    var el = $(id);
    if (!el) return;
    el.innerHTML = markHtml(size);
    el.classList.toggle("is-photo", !!avatarUrl());
  }

  function renderAvatar() {
    var s = C.site || {};
    var url = avatarUrl();

    paintMark("brandMark", false);
    paintMark("footerMark", true);

    // 首屏大头像：只有配置了图片才显示，否则靠名字本身撑起识别度
    var box = $("heroAvatar");
    if (box) {
      if (url) {
        box.hidden = false;
        box.innerHTML = '<img src="' + esc(url) + '" alt="' + esc(s.name || "头像") +
                        '" loading="eager" decoding="async">';
      } else {
        box.hidden = true;
        box.innerHTML = "";
      }
    }
  }

  /* ---------- 品牌 / 页脚 ---------- */
  function renderBrand() {
    var s = C.site || {};
    set("brandName", esc(s.name));
    set("footerName", esc(s.name));
    set("footerCopy", esc(s.copyright));
    set("footerNote", esc(s.footerNote));
    set("mobileNavFoot", esc(s.location));
    renderAvatar();
  }

  /* ============================================================ Q1 · 我 */
  function renderProfile() {
    var s = C.site || {}, p = C.profile || {}, h = C.hero || {};

    set("heroGreet", esc(p.greet || "你好，我是"));
    set("heroName", esc(s.name || "Zotrod"));
    set("heroTagline", esc(p.tagline || ""));
    set("heroRole", esc(s.role || ""));
    set("heroIntro", text(p.intro || ""));
    if (!p.tagline) { var t = $("heroTagline"); if (t) t.hidden = true; }

    // 微信 / QQ：只印平台名，点一下复制账号。
    // 用 <button> 而不是 <a>，因为它不跳转。
    //
    // ⚠️ 账号本身不再上屏（2026-11-10 改）：QQ 号 10 位、微信号 12 位，
    // 摆在卡上要么被挤成第二行、要么吃省略号；而"看见再手抄"本来就不如
    // "点一下进剪贴板"。账号仍留在 data-copy 与 aria-label 里 ——
    // 读屏用户照样听得到，复制也照样拿到。
    // data-copy-toast 让 Toast 只说"已复制 QQ"，不把号码复述一遍。
    set("heroContacts", arr(p.contacts).map(function (c, i) {
      return '<button class="ccard" type="button" ' +
             'data-copy="' + esc(c.value) + '" ' +
             'data-copy-toast="已复制 ' + esc(c.label) + '" ' +
             'aria-label="复制' + esc(c.label) + '：' + esc(c.value) + '" ' +
             'style="' + delay(i, 70) + '">' +
               '<span class="ccard__icon">' + icon(c.icon) + "</span>" +
               '<span class="ccard__label">' + esc(c.label) + "</span>" +
               '<span class="ccard__act">' +
                 '<span class="ccard__hint" data-copy-hint>点击复制</span>' +
                 icon("copy") +
               "</span>" +
             "</button>";
    }).join(""));

    // 两个主页的摘要卡（左右各一张）。compact：只要「图标 + 平台名 + 箭头」
    paintPreviews("heroPreviews", p.previews, true);

    // 首屏按钮
    var a = $("heroPrimary"), b = $("heroSecondary");
    var pri = h.primary || { label: "看看我在听", target: "#listen" };
    var sec = h.secondary || { label: "游戏 ID", target: "#gaming" };
    if (a) {
      a.innerHTML = "<span>" + esc(pri.label) + "</span>" + icon("arrow-down", "btn__icon");
      if (pri.target) a.setAttribute("href", pri.target);
    }
    if (b) {
      b.innerHTML = "<span>" + esc(sec.label) + "</span>" + icon("arrow-up-right", "btn__icon");
      if (sec.target) b.setAttribute("href", sec.target);
    }
  }

  /* ---------- 外链摘要卡（Q1 两个 + Q4 闲鱼一个） ----------
     一个组件两种形态：
       有 cover → 上方封面 + 下方文字，像一张缩略图卡
       无 cover → 纯文字信息卡，左边一块平台图标
     sync.js 拿到 data/previews.json 后，会按 [data-preview-id] 回填
     标题 / 副标题 / 数据 / 封面 —— 优先用抓到的真实信息。

     ⚠️ 2026-11-11 第二轮：用户要「磁贴内文字去掉，只要网易云音乐和小黑盒」。
        Q1 那两张卡改成**单行**（compact）——不渲染标题 / 副标题 / 数据三块，
        只留 图标 + 平台名 + 外链箭头。数据本身还在 data/previews.json 里，
        只是不再上屏；哪天想摆回来，把 compact 去掉即可。 */
  function previewCard(p, i, compact) {
    var cover = String(p.cover || "").trim();
    var stats = compact ? [] : arr(p.stats).filter(function (s) { return s && s.value != null; });
    var statsHtml = stats.map(function (s) {
      return '<span class="preview__stat"><b>' + esc(s.value) + "</b>" + esc(s.label || "") + "</span>";
    }).join("");

    var style = (p.accent ? "--pc:" + esc(p.accent) + ";" : "") + delay(i, 80);

    return '<a class="preview' + (cover ? " preview--cover" : "") +
             (compact ? " preview--slim" : "") + '"' +
             ' href="' + esc(p.url || "#") + '" target="_blank" rel="noopener noreferrer"' +
             ' data-preview-id="' + esc(p.id || "") + '"' +
             ' style="' + style + '" data-reveal>' +
             (cover
               ? '<span class="preview__cover"><img src="' + esc(cover) +
                 '" alt="" loading="lazy" decoding="async"></span>'
               : "") +
             '<span class="preview__body">' +
               '<span class="preview__top">' +
                 '<span class="preview__icon">' + icon(p.icon) + "</span>" +
                 '<span class="preview__platform">' + esc(p.platform || "") + "</span>" +
                 icon("arrow-up-right", "preview__go") +
               "</span>" +
               (compact ? "" :
                 '<span class="preview__title" data-preview-title>' + esc(p.title || "") + "</span>" +
                 '<span class="preview__meta" data-preview-meta>' + esc(p.meta || "") + "</span>") +
               (compact ? "" :
                 '<span class="preview__stats" data-preview-stats' +
                   (statsHtml ? "" : " hidden") + ">" + statsHtml + "</span>") +
             "</span>" +
           "</a>";
  }

  function paintPreviews(mountId, list, compact) {
    var el = $(mountId);
    if (!el) return;
    el.innerHTML = arr(list).map(function (p, i) { return previewCard(p, i, compact); }).join("");
  }

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

  /* ========================================================== Q3 · 游戏 */
  /* 这一屏只有**一个模块**（用户的明确要求）：
       ┌ 顶栏：平台名 · 公开库存 · 好友码 ………… ↗ ┐   ← 整块
       │ 三格数据：游戏数量 / 时长 / 完美通关      │      点哪都进
       │ ─────────────────────────────────────── │      Steam 主页
       │ 游戏列表（可滚动，行数按可用高度算）        │
       └─────────────────────────────────────────┘
     DOM 分两半填：
       #gameRail  ← renderGaming()     顶栏
       #gameStats ← renderGameStats()  数据 + 列表
     外层 <a id="gameBoard"> 由 renderGaming() 设 href（来自 config 的 steam.profileUrl）。
     所以**不再有"复制好友码"这个动作** —— 点模块就是去主页，好友码只作为文字展示。
  */
  function steamItem() {
    return arr((C.gaming || {}).items).filter(function (g) {
      return g && !g.hidden && g.steam && g.steam.steamId;
    })[0] || null;
  }

  function renderGaming() {
    var rail = $("gameRail");
    var board = $("gameBoard");
    if (!rail) return;

    var g = steamItem();
    if (!g) {                       /* 没有 Steam 卡就整块不显示 */
      if (board) { board.hidden = true; board.removeAttribute("href"); }
      rail.innerHTML = "";
      return;
    }

    var href = (g.steam && g.steam.profileUrl) || g.link || "#";
    if (board) {
      board.hidden = false;
      board.href = href;
      board.setAttribute("aria-label", "打开我的 " + (g.name || "Steam") + " 主页");
    }

    /* 顶栏：左边是身份，右边是好友码。
       ⚠️ 好友码不再是按钮：它现在是模块的说明文字，点击由外层链接接管。 */
    rail.innerHTML =
      '<span class="gb-head">' +
        '<span class="gb-head__icon">' + icon(g.icon || "steam") + "</span>" +
        '<span class="gb-head__name">' + esc(g.name || "Steam") + "</span>" +
        (g.server ? '<span class="gb-head__meta">' + esc(g.server) + "</span>" : "") +
        (g.uid
          ? '<span class="gb-head__id"><i>' + esc(g.uidLabel || "好友码") + "</i>" +
            "<b>" + esc(g.uid) + "</b></span>"
          : "") +
        '<span class="gb-head__go">' + icon("arrow-up-right") + "</span>" +
      "</span>";
  }

  /* ---------- 三格数据 + 游戏列表 ---------- */
  /* 数据来自 data/steam.json：
       lib    { totalGames, totalHours, perfect, partial, source }
       recent [{ appid, name, hours, hours2w, cover, ach:{have,total} }]
     三个刻意的决定：
       1. 时长条按 **√ 归一化**：库里 2491h 和 2.7h 差 900 倍，
          线性会让除第一名以外全塌成 1px。
       2. 条的颜色按 appid 哈希出色相（同小黑盒：颜色不承载信息，只分开相邻行）。
       3. 只有**全成就**才挂奖章 + 强调色数字。没打满只写 x/y。 */
  function hueOf(appid) {
    var x = ((Number(appid) || 0) * 2654435761) % 4294967296;
    return Math.round(x * 0.6180339887) % 360;
  }

  function fmtH(n) {
    var v = Number(n) || 0;
    if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (v >= 10) return v.toFixed(1).replace(/\.0$/, "");
    return (Math.round(v * 10) / 10).toString();
  }

  function boardSummaryHtml(lib, rowCount) {
    if (!lib) return "";
    var hours = lib.totalHours
      ? '<b>' + esc(fmtH(lib.totalHours)) + "<small>h</small></b>"
      : "<b>—</b>";
    /* partial=true 时不能写"游戏时长"：那只是列表里这几款之和 */
    var hoursLabel = lib.partial ? "近 " + rowCount + " 款" : "游戏时长";
    return '<span class="gb-sum">' +
        '<span class="gb-sum__item"><b>' +
          esc(lib.totalGames ? lib.totalGames.toLocaleString("en-US") : "—") +
          "</b><i>游戏数量</i></span>" +
        '<span class="gb-sum__item">' + hours + "<i>" + hoursLabel + "</i></span>" +
        '<span class="gb-sum__item"><b>' + esc(String(lib.perfect || 0)) +
          "</b><i>完美通关</i></span>" +
      "</span>";
  }

  /* ---------- 最近入库 ----------
     Steam 的 Web API **没有"购买时间"** 这个字段（GetOwnedGames 只给
     rtime_last_played = 最后游玩）。所以这条是"记账"算出来的：
     每次同步把全库 appid 存进 data/steam.json，下次对比，新出现的即新入库。
     第一次同步只建基线（ownedSince 记下日期），之后才会陆续有内容。
     ⚠️ 没有数据时整条不渲染 —— 空标题比没有更难看。 */
  function recentlyAddedHtml(added, since) {
    var list = arr(added).filter(function (g) { return g && g.appid; });

    /* 空态：一条记录都没有时，早先整块不渲染 —— 那一行就凭空少了 30px，
       看起来像"这块坏了"。现在补一句实话：从哪天开始记账。
       Steam 接口没有"购买时间"，记录只能从第一次建立基线那天算起，
       所以这个日期是准的，不是占位文案。 */
    if (!list.length) {
      if (!since) return "";
      return '<span class="gb-new is-empty">' +
          '<span class="gb-new__label">最近入库' +
            '<i>' + esc(String(since).slice(5).replace("-", "/")) + " 起</i>" +
          "</span>" +
          '<span class="gb-new__hint">还没有新入库</span>' +
        "</span>";
    }

    var MAX = 8;
    var head = list.slice(0, MAX).map(function (g) {
      var url = "https://cdn.akamai.steamstatic.com/steam/apps/" + g.appid + "/header.jpg";
      /* --h 是这块的兜底色相：新入库的游戏最容易没有 header.jpg，
         图挂了就藏起 img，露出 .gb-new__item 自己的色相渐变，
         而不是留一个空洞（列表行的 is-blank 是同一套思路）。 */
      return '<span class="gb-new__item" style="--h:' + hueOf(g.appid) + '"' +
               ' title="' + esc(g.name || "") +
               (g.at ? "（" + esc(g.at) + " 入库）" : "") + '">' +
               '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async"' +
               ' onerror="this.style.display=\'none\'">' +
             "</span>";
    }).join("");

    return '<span class="gb-new">' +
        '<span class="gb-new__label">最近入库' +
          (since ? '<i>' + esc(String(since).slice(5).replace("-", "/")) + " 起</i>" : "") +
        "</span>" +
        '<span class="gb-new__row">' + head +
          (list.length > MAX ? '<b class="gb-new__more">+' + (list.length - MAX) + "</b>" : "") +
        "</span>" +
      "</span>";
  }

  /* 列表里一行。封面挂了就换下一个源，全挂了露兜底图标 ——
     绝不出现"空黑框"（深空当铺的 header.jpg 就是 404）。 */
  function rowHtml(g, i, maxH) {
    var cover = String(g.cover || "").trim();
    var fb = String(g.coverFallback || "").trim();
    var ach = g.ach && g.ach.total > 0 ? g.ach : null;
    var done = ach && ach.have >= ach.total;
    var pct = Math.max(4, Math.round(Math.sqrt((Number(g.hours) || 0) / maxH) * 100));
    var hue = hueOf(g.appid);

    return '<span class="gb-row' + (done ? " is-done" : "") + '" data-reveal' +
             ' style="' + delay(i, 45) + "--c:hsl(" + hue + " 72% 56%);" + '">' +
             '<span class="gb-row__cover' + (cover ? "" : " is-blank") + '">' +
               '<i class="gb-row__ph">' + icon("gamepad") + "</i>" +
               (cover
                 ? '<img src="' + esc(cover) + '" alt="" loading="lazy" decoding="async"' +
                   (fb ? ' data-fb="' + esc(fb) + '"' : "") +
                   ' onerror="var f=this.dataset.fb;if(f){this.removeAttribute(\'data-fb\');this.src=f}else{this.parentNode.classList.add(\'is-blank\');this.remove()}">'
                 : "") +
             "</span>" +
             '<span class="gb-row__main">' +
               '<span class="gb-row__name">' + esc(g.name || "") + "</span>" +
               '<span class="gb-row__stats">' +
                 '<b class="gb-row__hours">' + fmtH(g.hours) + "<small>h</small></b>" +
                 '<span class="gb-row__bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' +
                 (g.hours2w > 0
                   ? '<span class="gb-row__w" title="最近两周">' + fmtH(g.hours2w) + "<small>h</small></span>"
                   : '<span class="gb-row__w is-empty"></span>') +
               "</span>" +
             "</span>" +
             (ach
               ? '<span class="gb-row__ach">' +
                   (done ? '<span class="gb-row__medal">' + icon("award") + "</span>" : "") +
                   '<span class="gb-row__ach-num"><b>' + ach.have + "</b>/" + ach.total + "</span>" +
                 "</span>"
               : '<span class="gb-row__ach is-none">—/—</span>') +
           "</span>";
  }

  /* 渲染行数的硬上限。数据端（sync-steam.mjs 的 ROWS）也给 30，
     这里再兜一层：万一 JSON 是旧的 / 手工改大的，DOM 也不会失控。
     为什么是 30：一屏最多也就 6~7 行，30 行 = 滚动 4~5 屏，
     再多既没人看，也会让首次渲染变重。 */
  var ROW_LIMIT = 30;

  function renderGameStats(data) {
    var box = $("gameStats");
    if (!box) return 0;

    var lib = !Array.isArray(data) && data ? data.lib : null;
    var added = !Array.isArray(data) && data ? data.added : null;
    var since = !Array.isArray(data) && data ? data.ownedSince : "";
    var rows = arr(Array.isArray(data) ? data : (data && data.recent))
      .filter(function (g) { return g && (g.hours > 0 || (g.ach && g.ach.total > 0)); })
      .slice(0, ROW_LIMIT);

    if (!rows.length) { box.hidden = true; box.innerHTML = ""; fitBoardList(); return 0; }

    var maxH = rows.reduce(function (m, g) { return Math.max(m, Number(g.hours) || 0); }, 0) || 1;

    box.innerHTML =
      boardSummaryHtml(lib, rows.length) +
      recentlyAddedHtml(added, since) +
      '<span class="gb-list" id="gbList">' +
        rows.map(function (g, i) { return rowHtml(g, i, maxH); }).join("") +
      "</span>" +
      /* 列表被截断时，底部给一条渐隐 + 一句"查看全部" —— 
         不然滚到一半的人不知道下面还有。 */
      '<span class="gb-more" id="gbMore" hidden>' +
        '<span class="gb-more__fade"></span>' +
        '<span class="gb-more__txt">查看全部' +
          (lib && lib.totalGames ? " " + lib.totalGames + " 款" : "") +
          icon("arrow-up-right") + "</span>" +
      "</span>";

    box.hidden = false;
    if (window.SITE_MOTION && typeof window.SITE_MOTION.revealScan === "function") {
      window.SITE_MOTION.revealScan(box);
    }
    fitBoardList();
    /* 行是**这一刻**才进 DOM 的，而 fonts.ready 可能在更早就已经 resolve 了 ——
       所以必须在这里再挂一次：字体真正落地时按新行高再算一遍。 */
    refitOnFonts();
    return rows.length;
  }

  /* 列表高度 = 可用高度能放几行。
     ⚠️ 为什么不写死 max-height：全站有一层等比缩放（scale.js 改根字号），
        行高会跟着 rem 变；而且桌面/平板/手机的可视高度差得很远。
        直接量第一行的实际高度再算行数，缩放变了自然跟着变。

     ⚠️ 为什么用"区块内的相对位置"而不是 window.innerHeight - list.top：
        这个函数在数据到达时就会跑一次，那时 Q3 还在屏幕外（list.top ≈ 1700），
        拿视口算出来是负数 → 只放 2 行，而且滚到这一屏也不会重算。
        改成两者都减区块的 top，差值就是**布局内**的位置，与滚动无关。 */
  function fitBoardList() {
    var list = $("gbList");
    var more = $("gbMore");
    var board = $("gameBoard");
    var sec = $("gaming");
    if (!list || !board || !sec || !list.firstElementChild) return 0;

    /* 还没布局完（区块隐藏 / 行高为 0）→ 下一帧再来 */
    if (!sec.clientHeight || !list.firstElementChild.getBoundingClientRect().height) {
      if (!fitBoardList._raf) {
        fitBoardList._raf = requestAnimationFrame(function () {
          fitBoardList._raf = 0;
          fitBoardList();
        });
      }
      return 0;
    }

    var secTop = sec.getBoundingClientRect().top;
    var padBottom = parseFloat(getComputedStyle(sec).paddingBottom) || 48;
    /* 上限永远是"一屏"：用区块自身高度会**自我放大**（列表撑高区块 →
       下一轮按更大的高度算 → 行更多），所以取 min(区块高, 视口高)。 */
    var budget = Math.min(sec.clientHeight, window.innerHeight || 800);

    /* "查看全部"要先显形才量得到高度；它现在是列表下方的独立底带 */
    if (more) more.hidden = false;
    var strip = (more && more.offsetHeight) || 46;

    /* 归零再量：列表可能还带着上一轮的 max-height 与底带 */
    list.style.maxHeight = "none";
    board.style.paddingBottom = "";
    var listTop = list.getBoundingClientRect().top - secTop;
    /* 尾部余量 22：给页码条 / 回顶按钮留的。原来是 18，实测 920×720 那档
       容器 579 + 上下内边距 144 = 723 > 720，正好差 3~4px。 */
    var room = budget - listTop - padBottom - 22 - strip;

    var bt = parseFloat(getComputedStyle(list).borderTopWidth) || 0;
    var avail = room - bt;

    /* 逐行累加**每行自己的真实高度**，累到放不下为止。
       ⚠️ 为什么不用"行高 × 行数"（这是上一版的写法，实测被裁）：
          · 首行没有 border-top，比其它行矮 1px；
          · 字体分片加载后行高会从 63.25 变成 64。
        任何"平均值 × N"都会差 1~3px，而这几像素正好表现为
        "最后一行被裁掉一条边"。逐行累加量的就是真实占位，不存在这个问题。 */
    var kids = list.children;
    function measureFits(limit) {
      var sum = 0, n = 0;
      for (var i = 0; i < kids.length; i++) {
        var h = kids[i].getBoundingClientRect().height;
        if (h <= 0) break;
        if (sum + h > limit) break;
        sum += h;
        n++;
      }
      return { sum: sum, n: n };
    }

    var fit = measureFits(avail);
    var useStrip = true;

    /* 连一行都放不下时，先把"查看全部"的底带也让出来（920×720 那档就差这 4px）。
       让出底带还放不下，才退到"只画一行"—— 空白面板比略溢出更糟。 */
    if (fit.n < 1) {
      fit = measureFits(avail + strip);
      useStrip = false;
    }

    if (fit.n >= kids.length) {             /* 全装得下：不滚、不留底带 */
      list.classList.remove("is-scroll");
      board.style.paddingBottom = "";
      if (more) more.hidden = true;
      return kids.length;
    }

    if (fit.n < 1) {                        /* 极矮窗口：保底一行 */
      fit.n = 1;
      fit.sum = kids[0].getBoundingClientRect().height;
      useStrip = false;
    }

    /* 列表 = 整整 fit.n 行；需要时底带单独占 strip，两者不重叠 */
    board.style.paddingBottom = useStrip ? strip + "px" : "";
    if (more) more.hidden = !useStrip;
    list.style.maxHeight = (fit.sum + bt) + "px";
    list.classList.add("is-scroll");

    /* 终局校验：上面所有算术都基于"可用高度"的估算，而真正决定成败的是
       **区块的实测高度**。只要它超过一屏，就按差值退掉整行 ——
       这是"一屏一页"唯一的硬指标，比任何常数都可靠。
       （实测 920×720 那档容器 579 + 内边距 144 = 723 > 720，
         靠调 18→22 没能解决，因为溢出不在列表里。） */
    var minH = kids[0].getBoundingClientRect().height;
    var guard = 0;
    while (guard++ < 6 && fit.n > 1) {
      /* ⚠️ 容差 3px：区块有 `border-top: 1px`，`offsetHeight` 天然比视口多 1px。
         用 0.5 做阈值会让守卫**永远成立**，一路把行砍到 1 行（实机踩过：
         392×744 上从 3 行变 1 行）。只有真的溢出 3px 以上才收行。 */
      var overH = sec.offsetHeight - (window.innerHeight || 0);
      if (overH <= 3) break;
      fit.n -= 1;
      fit.sum = Math.max(minH, fit.sum - kids[fit.n].getBoundingClientRect().height);
      list.style.maxHeight = (fit.sum + bt) + "px";
    }
    return fit.n;
  }

  /* 字体就绪后重算一次（模块加载时先挂一次，覆盖"行还没进 DOM"的情况）。
     注意：fonts.ready 只 resolve 一次，所以 renderGameStats 里也会在插完行
     之后再挂一次 —— 那次挂的才是真正生效的。 */
  function refitOnFonts() {
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { fitBoardList(); }).catch(function () {});
    }
  }
  refitOnFonts();

  /* 窗口变了 / 档位变了都要重算行数 —— 导出给外部调 */
  window.addEventListener("resize", function () {
    if (!$("gbList")) return;
    clearTimeout(fitBoardList._t);
    fitBoardList._t = setTimeout(fitBoardList, 120);
    /* 第二次复算：120ms 那次往往赶在"档位切换 / 根字号写完"之前，
       量到的还是上一档的高度，于是差 4~5px。等布局定下来再校一次。 */
    clearTimeout(fitBoardList._t2);
    fitBoardList._t2 = setTimeout(fitBoardList, 420);
  }, { passive: true });

  /* ========================================================== Q4 · 维修 */
  /* 报价单 → 闲鱼在售物品（2026-11-11 改版）
     ---------------------------------------------------------------------
     为什么换：原来的报价单是 10 行长静态价目表，读起来像一份"公告"，
     而访客真正想看的是"你现在手上有什么、卖多少钱"。
     闲鱼在售列表同时满足两件事：价格可信（有具体链接与状态），
     也能顺势引到闲鱼店铺。

     数据来源只支持快照（config.js 的 repair.quote.items）：
       试过抓 https://www.goofish.com/personal，它是 SPA，
       服务端只回空壳；h5api 的 mtop 接口需要 appKey + 签名，
       裸请求直接返回 FAIL_SYS_API_NOT_FOUNDED。
       这跟网易云不同 —— 那边的公开接口是可读的。
       所以这里不做抓取，改成"快照 + 一键重抓"的边界：
       结构对齐闲鱼的字段（title / price / condition / note / url），
       将来若有了合法数据源，只需替换 source 的读取方式，渲染层不用动。 */
  function renderQuote() {
    var q = (C.repair || {}).quote || {};
    var el = $("repairQuote");
    if (!el) return;

    var items = arr(q.items);
    if (!items.length) { el.innerHTML = ""; return; }

    var rows = items.map(function (it) {
      /* 每条都尽量是一个可点链接：有 url 用 <a>，没有就退化成 <div>，
         不让"看起来能点但其实点不动"的元素出现。 */
      var tag = it.url ? "a" : "div";
      var attrs = it.url
        ? ' href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer"'
        : "";
      var cond = it.condition || "";
      /* 「已成交」的置灰：它还有参考价值（能看出这一单大概多少钱），
         但不该和「在售」抢注意力。 */
      var sold = /已(成交|售出|下架)/.test(cond);

      return "<" + tag + ' class="xy' + (sold ? " is-sold" : "") + '"' + attrs + ">" +
          '<span class="xy__main">' +
            '<span class="xy__title">' + esc(it.title) + "</span>" +
            (it.note ? '<span class="xy__note">' + esc(it.note) + "</span>" : "") +
          "</span>" +
          '<span class="xy__side">' +
            '<span class="xy__price">' + esc(it.price) + "</span>" +
            (cond ? '<span class="xy__cond">' + esc(cond) + "</span>" : "") +
          "</span>" +
        "</" + tag + ">";
    }).join("");

    var onSale = items.filter(function (it) { return !/已(成交|售出|下架)/.test(it.condition || ""); }).length;

    el.innerHTML =
      '<details class="quote" id="quoteDetails" open>' +
        '<summary class="quote__summary">' +
          '<span class="quote__title">' + icon("shop") + esc(q.title || "闲鱼在售") + "</span>" +
          '<span class="quote__count">' + onSale + " 件在售 · 共 " + items.length + " 件</span>" +
          '<span class="quote__caret" aria-hidden="true">' + icon("chevron-right") + "</span>" +
        "</summary>" +
        '<div class="quote__body">' +
          '<div class="xy-list">' + rows + "</div>" +
          (q.note ? '<p class="quote__note">' + esc(q.note) + "</p>" : "") +
          (q.profileUrl
            ? '<a class="xy__more" href="' + esc(q.profileUrl) + '" target="_blank" rel="noopener noreferrer">' +
                "去闲鱼看全部" + icon("arrow-up-right") + "</a>"
            : "") +
        "</div>" +
      "</details>";
  }

  function renderRepair() {
    var d = C.repair || {};
    paintPreviews("repairPreview", d.xianyu ? [d.xianyu] : []);
    renderQuote();
    // 计算器由 repair.js 负责（它有状态和交互，放在渲染层里不合适）
  }

  /* ========================================================== Q5 · 其他 */
  function renderLinks() {
    var d = C.links || {};
    set("linksGrid", arr(d.items).map(function (it, i) {
      var inner =
        '<span class="social__icon">' + icon(it.icon) + "</span>" +
        '<span class="social__text">' +
          '<span class="social__label">' + esc(it.label) + "</span>" +
          '<span class="social__handle">' + esc(it.handle) + "</span>" +
        "</span>";

      // copy 模式：没有公开主页的账号，点击即复制
      if (it.copy) {
        return '<button class="social" type="button" style="' + delay(i, 55) + '" data-reveal ' +
               'data-copy="' + esc(it.copy) + '"' +
               ' data-copy-toast="已复制 ' + esc(it.label) + '"' +
               ' aria-label="复制' + esc(it.label) + "：" + esc(it.copy) + '">' +
               inner + icon("copy", "social__arrow") + "</button>";
      }

      var url = it.url || "#";
      var external = url.charAt(0) !== "#" && url.indexOf("mailto:") !== 0;
      return '<a class="social" style="' + delay(i, 55) + '" data-reveal ' +
             'href="' + esc(url) + '"' +
             (external ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" +
             inner + icon("arrow-up-right", "social__arrow") + "</a>";
    }).join(""));
  }

  /* ========================================================== Q6 · 邮箱 */
  function renderContact() {
    var s = C.site || {}, d = C.contact || {};
    var mail = s.email || "";
    set("contactBox",
      '<p class="mailbox__hint">' + esc(d.hint || "欢迎来信") + "</p>" +
      '<a class="mailbox__mail" href="mailto:' + esc(mail) + '">' + esc(mail) + "</a>" +
      '<div class="mailbox__actions">' +
        '<a class="btn btn--primary" href="mailto:' + esc(mail) + '">' +
          "<span>发封邮件</span>" + icon("send", "btn__icon") + "</a>" +
        '<button class="btn btn--quiet" type="button" data-copy="' + esc(mail) + '"' +
          ' data-copy-toast="已复制邮箱">' +
          icon("copy", "btn__icon") + '<span data-copy-hint>复制邮箱</span></button>' +
      "</div>");
  }

  /* ---------- 导航 + 模块开关 / 排序 ---------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function renderSections() {
    var conf = C.sections || {};
    var wrap = $("sections");
    /* 只认页面上真实存在的屏。
       旧草稿里的 about / services / interests / social 会一直留在 config.sections 里，
       照着渲染就会变成四个点不动的死链，编号还会被顶到「010」——
       配置是数据，导航不能拿数据当事实，得拿页面当事实。 */
    var list = Object.keys(conf)
      .filter(function (k) {
        return conf[k] && conf[k].enabled !== false &&
          (!wrap || wrap.querySelector('[data-section="' + k + '"]'));
      })
      .sort(function (a, b) { return (conf[a].order || 0) - (conf[b].order || 0); });

    var navHtml = "", mNavHtml = "";
    list.forEach(function (key, i) {
      var label = esc(conf[key].label || key);
      navHtml += '<li><a class="nav__link" href="#' + key + '" data-nav="' + key + '">' +
                 '<span class="nav__num">' + pad2(i + 2) + "</span>" + label + "</a></li>";
      mNavHtml += '<li><a href="#' + key + '" data-mnav="' + key + '">' +
                  "<span>" + label + "</span>" + icon("arrow-up-right") + "</a></li>";
    });
    set("navList", navHtml);
    set("mobileNavList", mNavHtml);

    if (!wrap) return;
    Object.keys(conf).forEach(function (key) {
      var el = wrap.querySelector('[data-section="' + key + '"]');
      if (el) el.hidden = conf[key].enabled === false;
    });
    // 按 order 重排真实 DOM（含隐藏模块），保证视觉顺序与屏幕阅读器顺序一致
    Object.keys(conf)
      .sort(function (a, b) { return (conf[a].order || 0) - (conf[b].order || 0); })
      .forEach(function (key) {
        var el = wrap.querySelector('[data-section="' + key + '"]');
        if (el) wrap.appendChild(el);
      });

    // 每个区块的标题三件套
    list.forEach(function (key) {
      var data = C[key] || {};
      var sec = wrap.querySelector('[data-section="' + key + '"]');
      if (!sec) return;
      ["eyebrow", "title", "lead"].forEach(function (f) {
        var node = sec.querySelector('[data-field="' + f + '"]');
        if (node) node.innerHTML = esc(data[f] || "");
      });
    });
  }

  /* ---------- 功能性按钮里的图标 ---------- */
  function renderControls() {
    var dark = document.documentElement.dataset.theme === "dark";
    set("themeToggle", icon(dark ? "sun" : "moon"));
    var t = $("themeToggle");
    if (t) {
      t.setAttribute("aria-label", dark ? "切换到浅色主题" : "切换到深色主题");
      t.setAttribute("title", dark ? "切换到浅色主题" : "切换到深色主题");
      if (C.ui && C.ui.showThemeToggle === false) t.hidden = true;
    }
    set("menuToggle", icon("menu"));
    set("toTop", icon("arrow-up"));

    set("skinBtn", icon("palette"));
    var sk = $("skinBtn");
    if (sk && C.ui && C.ui.showSkinPicker === false) sk.hidden = true;
    var cnt = $("skinCount");
    if (cnt && window.SITE_THEMES) cnt.textContent = window.SITE_THEMES.list.length + " 套可选";

    var top = $("toTop");
    if (top && C.ui && C.ui.showBackToTop === false) top.hidden = true;
  }

  /* ======================================================================
   *  渲染分块：每个 UI 块独立渲染、独立报错、独立可测
   * ----------------------------------------------------------------------
   *  为什么拆：
   *    原来是 9 个 renderXxx() 顺序直调，**任何一个抛错，后面的全部不执行** ——
   *    表现就是"页面只渲染了上半截"，而且看不出是哪一块坏的。
   *    这在移动端排查时最要命：你看到一个空面板，但控制台只说某处 undefined。
   *
   *  拆完之后有三件事：
   *    1. 单块失败只影响自己（catch 住，打日志，继续下一块）
   *    2. 每块在它自己的容器上留标记：data-render="ok" / "error"
   *       → DevTools 里一眼看出哪块没画出来，不用猜
   *    3. 支持单独渲染：?render=gaming 只跑那一块，方便隔离问题
   *
   *  layer 只是"先骨架、再文案、最后内容与控件"的顺序分组，
   *  不是时间上的分帧（分帧会让下面几块晚一帧出现，反而像闪）。
   * ==================================================================== */
  var BLOCKS = [
    /* ---- layer -1：P0。顶栏三件套先画，且只依赖最少的输入 ----
       为什么单独一层：头像、导航、右上角三个按钮原来分别在 layer 1 / 3，
       只要前面任何一块抛错，**整个顶栏就是空的**（K80 + Android Edge 上
       看到的就是这个）。它们是最该先出现的控件，不能排在内容后面。
       顺序也有讲究：sections 先跑 —— 它决定导航项和区块顺序，
       后面的块都按它排好的 DOM 取元素。 */
    { name: "sections", layer: -1, fn: renderSections, sel: "#siteHeader" },
    { name: "brand",    layer: -1, fn: renderBrand,    sel: "#siteHeader" },
    { name: "controls", layer: -1, fn: renderControls, sel: "#siteHeader" },
    /* layer 0：配色（纯变量，不碰结构） */
    { name: "theme",    layer: 0, fn: applyAccent,    sel: null },
    /* layer 1：首屏文案 */
    { name: "meta",     layer: 1, fn: renderMeta,     sel: null },
    { name: "profile",  layer: 1, fn: renderProfile,  sel: "#top" },
    /* layer 2：内容块 */
    { name: "listen",   layer: 2, fn: renderListen,   sel: "#listen" },
    { name: "gaming",   layer: 2, fn: renderGaming,   sel: "#gaming" },
    { name: "repair",   layer: 2, fn: renderRepair,   sel: "#repair" },
    /* layer 3：其余导航与页脚 */
    { name: "links",    layer: 3, fn: renderLinks,    sel: null },
    { name: "contact",  layer: 3, fn: renderContact,  sel: "#contact" }
  ];

  /* P0 失败时的补救：下一帧再试一次。
     为什么值得单独做：这一层是"页面看起来是不是活的"的全部依据，
     一次偶发的异常（比如图标名读不到）不该让顶栏永远空着。 */
  var P0_RETRY = ["sections", "brand", "controls"];

  var lastReport = {};

  /* 跑一块：单独 try/catch + 打标记。
     ⚠️ 这里绝不能把异常往上抛 —— 一块坏了不该带走整页。 */
  function runBlock(b) {
    var t0 = (window.performance && performance.now) ? performance.now() : 0;
    var ok = true, msg = "";
    try {
      b.fn();
    } catch (e) {
      ok = false;
      msg = (e && e.message) || String(e);
      if (window.console && console.error) console.error("[render] " + b.name + " 失败：", e);
    }
    lastReport[b.name] = { ok: ok, ms: Math.round(((window.performance && performance.now) ? performance.now() : 0) - t0), error: msg };

    var el = b.sel ? document.querySelector(b.sel) : null;
    if (el) {
      /* ⚠️ 同一个容器可能被多块写（顶栏就是 sections/brand/controls 三块）——
         直接赋值会让后写的覆盖前面的：sections 挂了、controls 成功，
         标记就变成 ok，排查时被它骗。所以按块累计，任一失败即为 error。 */
      if (!el._renderBlocks) el._renderBlocks = [];
      el._renderBlocks.push(b.name + (ok ? ":ok" : ":error"));
      var anyBad = el._renderBlocks.some(function (x) { return x.slice(-6) === ":error"; });
      el.setAttribute("data-render", anyBad ? "error" : "ok");
      el.setAttribute("data-render-blocks", el._renderBlocks.join(" "));
      if (anyBad) el.setAttribute("data-render-error", b.name + ": " + msg.slice(0, 110));
    }
    return ok;
  }

  /* only：只跑这几块（调试用）。不传就跑全部，按 layer 从低到高。 */
  function runBlocks(only) {
    /* 重跑前清掉旧记录：否则一次偶发失败会让标记永久停在 error */
    [].forEach.call(document.querySelectorAll("[data-render]"), function (el) {
      el._renderBlocks = null;
      el.removeAttribute("data-render-blocks");
      el.removeAttribute("data-render-error");
    });
    var list = only && only.length
      ? BLOCKS.filter(function (b) { return only.indexOf(b.name) >= 0; })
      : BLOCKS.slice();
    list.sort(function (a, b) { return a.layer - b.layer; });
    var failed = [];
    for (var i = 0; i < list.length; i++) {
      if (!runBlock(list[i])) failed.push(list[i].name);
    }
    /* P0 掉队了就在下一帧补一次（只补 P0，不重跑内容块） */
    var p0Failed = failed.filter(function (n) { return P0_RETRY.indexOf(n) >= 0; });
    if (p0Failed.length && !only) {
      requestAnimationFrame(function () {
        for (var j = 0; j < BLOCKS.length; j++) {
          if (p0Failed.indexOf(BLOCKS[j].name) >= 0) runBlock(BLOCKS[j]);
        }
      });
    }
    return failed;
  }

  /* ?render=gaming,listen 只渲染指定块 —— 排查"是不是这一块画坏的"时用。
     页面上会少东西，这是预期的（它的用途就是隔离）。 */
  function pickedFromQuery() {
    try {
      var m = /[?&]render=([^&]+)/.exec(location.search);
      if (!m) return null;
      return decodeURIComponent(m[1]).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    } catch (e) { return null; }
  }

  function init() {
    var only = pickedFromQuery();
    if (only && only.length) {
      if (window.console && console.info) console.info("[render] 只渲染：" + only.join(" / "));
    }
    runBlocks(only);
  }

  return {
    init: init,
    esc: esc,
    icon: icon,
    applyAccent: applyAccent,
    setTracks: setTracks,      // sync.js 用：抓到真实播放记录后重画
    setListenMeta: setListenMeta, // sync.js 用：只更新累计听歌 / 同步状态
    previewCard: previewCard,  // sync.js 用
    renderGameStats: renderGameStats, // sync.js 用：读 data/steam.json 后画模块
    fitBoardList: fitBoardList, // sync.js / 翻页完成后重算可见行数
    recentlyAddedHtml: recentlyAddedHtml,
    /* 调试接口（排查用）：
       SITE_RENDER.renderOnly('gaming')  只重画某一块
       SITE_RENDER.report()              每块的成败与耗时 */
    renderOnly: function (name) { return runBlocks(String(name).split(",")); },
    report: function () { return lastReport; }
  };
})();
