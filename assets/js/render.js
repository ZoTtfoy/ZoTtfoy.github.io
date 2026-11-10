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

  function renderAvatar() {
    var s = C.site || {};
    var url = avatarUrl();

    set("brandMark", markHtml(false));
    set("footerMark", markHtml(true));

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

    // 两个主页的摘要卡（左右各一张）
    paintPreviews("heroPreviews", p.previews);

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
     标题 / 副标题 / 数据 / 封面 —— 优先用抓到的真实信息。 */
  function previewCard(p, i) {
    var cover = String(p.cover || "").trim();
    var stats = arr(p.stats).filter(function (s) { return s && s.value != null; });
    var statsHtml = stats.map(function (s) {
      return '<span class="preview__stat"><b>' + esc(s.value) + "</b>" + esc(s.label || "") + "</span>";
    }).join("");

    var style = (p.accent ? "--pc:" + esc(p.accent) + ";" : "") + delay(i, 80);

    return '<a class="preview' + (cover ? " preview--cover" : "") + '"' +
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
               '<span class="preview__title" data-preview-title>' + esc(p.title || "") + "</span>" +
               '<span class="preview__meta" data-preview-meta>' + esc(p.meta || "") + "</span>" +
               '<span class="preview__stats" data-preview-stats' +
                 (statsHtml ? "" : " hidden") + ">" + statsHtml + "</span>" +
             "</span>" +
           "</a>";
  }

  function paintPreviews(mountId, list) {
    var el = $(mountId);
    if (!el) return;
    el.innerHTML = arr(list).map(previewCard).join("");
  }

  /* ========================================================== Q2 · 在听 */
  /* 一首歌 = 一块磁贴。磁贴吸附在主卡片的唱片底纹上：
     序号、曲名、歌手、播放入口，四样都在一块里，不再是一行行的表格。
     序号用等宽数字 —— 01~06 竖向对齐时，列表看起来才整齐。

     ⚠️ 2026-11-10 从「最近在听」改成「听歌排行」：
     以前只显示歌名，其实网易云那边每首歌都有播放次数，只是被脚本丢掉了。
     现在每块右侧印出「N 次」，这一屏才真的回答了"你最近在听什么"——
     不是"有哪些歌"，而是"哪几首听得最多、听了几遍"。 */
  function fmtNum(n) {
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* sync.js 抓来的额外信息（累计听歌 / 等级 / 同步时间）。
     和曲目分开存：排行抓不到时（缺 cookie），这几个数字照样有。 */
  var listenMeta = { total: 0, level: 0, updated: "", live: false };

  function trackHtml(t, i) {
    var meta = [t.artist, t.album].filter(Boolean).join(" · ");
    var plays = Number(t.playCount) > 0
      ? '<span class="track__plays">' + fmtNum(t.playCount) +
        '<span class="track__plays-unit">次</span></span>'
      : "";
    return '<li class="track" style="' + delay(i, 45) + '" data-reveal>' +
             '<span class="track__idx">' + String(i + 1).padStart(2, "0") + "</span>" +
             '<span class="track__main">' +
               '<span class="track__title">' + esc(t.title || "") + "</span>" +
               (meta ? '<span class="track__meta">' + esc(meta) + "</span>" : "") +
             "</span>" +
             plays +
             (t.url
               ? '<a class="track__go" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer"' +
                 ' aria-label="在网易云打开 ' + esc(t.title || "") + '">' + icon("play") + "</a>"
               : "") +
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

    /* 三种状态，页脚说三种话：
         · 排行已同步        → 已同步
         · 只有累计听歌      → 排行待同步（数字是真的，歌还是兜底，不能写"已同步"）
         · 什么都没有        → 示例数据 · 等待首次同步 */
    var src = listenMeta.live
      ? '<span class="listen__src is-live"><span class="live-dot" aria-hidden="true"></span>已同步</span>'
      : listenMeta.total
        ? '<span class="listen__src is-pending">排行待同步</span>'
        : '<span class="listen__src">示例数据 · 等待首次同步</span>';

    var stat = listenMeta.total
      ? '<span class="listen__stat">累计听歌 <b>' + fmtNum(listenMeta.total) + "</b> 首</span>"
      : "";

    foot.innerHTML =
      '<span class="listen__meta">' + src + stat + "</span>" +
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
    }

    var items = arr(list).slice(0, Math.min(d.limit || 6, trackCap()));
    ul.innerHTML = items.map(trackHtml).join("");
    ul.setAttribute("data-count", String(items.length));
    /* 有播放次数时加这个标记：手机上要换成单列，
       否则两列里每块只剩 ~100px 放"曲名 + 次数"，两样都会被截断。 */
    ul.setAttribute("data-ranked", items.some(function (t) { return Number(t.playCount) > 0; }) ? "1" : "0");
    paintListenFoot();
  }

  /* 只更新页脚（累计听歌变了、但排行没变时用） */
  function setListenMeta(meta) {
    if (!meta) return;
    if (Number(meta.totalSongs) > 0) listenMeta.total = Number(meta.totalSongs);
    if (Number(meta.level) > 0) listenMeta.level = Number(meta.level);
    if (meta.updated) listenMeta.updated = meta.updated;
    if (meta.live) listenMeta.live = true;
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
  /* 只保留 图标 + 名称 + ID。介绍性文字全部去掉 —— 这一屏的用途是
     "在社交场合让对方抄 ID"，多一行字就少一个游戏能露出来。 */
  function renderGaming() {
    var d = C.gaming || {};
    var grid = $("gameRail");
    if (!grid) return;

    var items = arr(d.items);
    grid.innerHTML = items.map(function (g, i) {
      var color = g.color ? "--game:" + esc(g.color) + ";" : "";
      var img = String(g.iconImage || "").trim();
      var glyph = img
        ? '<img class="game__logo" src="' + esc(img) + '" alt="" loading="lazy" decoding="async">'
        : icon(g.icon);

      var uid = g.uid || g.copy || "";
      var uidBlock = uid
        ? '<button class="game__uid" type="button" data-copy="' + esc(uid) + '"' +
          ' data-copy-toast="已复制 ' + esc(g.uidLabel || "ID") + '"' +
          ' aria-label="复制 ' + esc(g.name) + " 的 " + esc(g.uidLabel || "ID") + "：" + esc(uid) + '">' +
            '<span class="game__uid-label">' + esc(g.uidLabel || "ID") + "</span>" +
            '<span class="game__uid-value">' + esc(uid) + "</span>" +
            '<span class="game__uid-copy">' + icon("copy") + "</span>" +
          "</button>"
        : "";

      return '<article class="game" data-reveal style="' + color + delay(i, 50) + '">' +
               '<span class="game__icon">' + glyph + "</span>" +
               '<h3 class="game__name">' + esc(g.name) + "</h3>" +
               uidBlock +
               (g.link
                 ? '<a class="game__link" href="' + esc(g.link) + '" target="_blank" rel="noopener noreferrer"' +
                   ' aria-label="打开 ' + esc(g.name) + ' 主页">' + icon("arrow-up-right") + "</a>"
                 : "") +
             "</article>";
    }).join("");
  }

  /* ========================================================== Q4 · 维修 */
  /* config 里报价是扁平的 rows（每行带 group），这里按 group 聚合成分栏。
     用第一次出现的顺序作为分组顺序，这样编辑器里上下移动行就能调分组次序。 */
  function groupQuote(rows) {
    var order = [], map = {};
    arr(rows).forEach(function (r) {
      var g = (r && r.group) || "其他";
      if (!map[g]) { map[g] = []; order.push(g); }
      map[g].push(r);
    });
    return order.map(function (name) { return { name: name, rows: map[name] }; });
  }

  /* 报价表包在 <details> 里。
     原因：10 行报价在手机上至少占 150px，而 Q4 是六屏里最高的一屏 ——
     它一旦超屏，paged.js 就会把**整站**降档、所有字号跟着缩一截。
     做成可折叠后，手机上默认收起（由 repair.js 在渲染后关掉），
     Q4 不再绑架其他五屏；桌面默认展开，宽屏有横向余量，收起来反倒少看信息。 */
  function renderQuote() {
    var q = (C.repair || {}).quote || {};
    var el = $("repairQuote");
    if (!el) return;

    var all = arr(q.rows);
    var grouped = groupQuote(all);

    var groups = grouped.map(function (g) {
      var rows = g.rows.map(function (r) {
        return '<div class="quote__row">' +
                 '<dt class="quote__item">' + esc(r.item) +
                   (r.note ? '<span class="quote__hint">' + esc(r.note) + "</span>" : "") +
                 "</dt>" +
                 '<dd class="quote__price">' + esc(r.price) + "</dd>" +
               "</div>";
      }).join("");
      return '<section class="quote__group">' +
               '<h4 class="quote__gname">' + esc(g.name) + "</h4>" +
               '<dl class="quote__list">' + rows + "</dl>" +
             "</section>";
    }).join("");

    el.innerHTML =
      '<details class="quote" id="quoteDetails" open>' +
        '<summary class="quote__summary">' +
          '<span class="quote__title">' + icon("tag") + esc(q.title || "报价单") + "</span>" +
          '<span class="quote__count">' + all.length + " 项 · " + grouped.length + " 类</span>" +
          '<span class="quote__caret" aria-hidden="true">' + icon("chevron-right") + "</span>" +
        "</summary>" +
        '<div class="quote__body">' +
          '<div class="quote__groups">' + groups + "</div>" +
          (q.note ? '<p class="quote__note">' + esc(q.note) + "</p>" : "") +
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

  function init() {
    applyAccent();
    renderMeta();
    renderBrand();
    renderSections();   // 先排好顺序：后面按 id 取元素才不会错位
    renderProfile();
    renderListen();
    renderGaming();
    renderRepair();
    renderLinks();
    renderContact();
    renderControls();
  }

  return {
    init: init,
    esc: esc,
    icon: icon,
    applyAccent: applyAccent,
    setTracks: setTracks,      // sync.js 用：抓到真实播放记录后重画
    setListenMeta: setListenMeta, // sync.js 用：只更新累计听歌 / 同步状态
    previewCard: previewCard   // sync.js 用
  };
})();
