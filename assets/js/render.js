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

    // QQ / 微信：点击即复制。用 <button> 而不是 <a>，因为它不跳转。
    set("heroContacts", arr(p.contacts).map(function (c, i) {
      return '<button class="chip" type="button" ' +
             'data-copy="' + esc(c.value) + '" ' +
             'aria-label="复制' + esc(c.label) + '：' + esc(c.value) + '" ' +
             'style="' + delay(i, 60) + '">' +
               '<span class="chip__icon">' + icon(c.icon) + '</span>' +
               '<span class="chip__text">' +
                 '<span class="chip__label">' + esc(c.label) + '</span>' +
                 '<span class="chip__value">' + esc(c.value) + '</span>' +
               '</span>' +
               '<span class="chip__hint">' + esc(c.hint || "复制") + '</span>' +
             '</button>';
    }).join(""));

    // 两个主页的摘要卡
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
  function trackHtml(t, i) {
    var meta = [t.artist, t.album].filter(Boolean).join(" · ");
    return '<li class="track" style="' + delay(i, 45) + '" data-reveal>' +
             '<span class="track__idx">' + String(i + 1).padStart(2, "0") + "</span>" +
             '<span class="track__main">' +
               '<span class="track__title">' + esc(t.title || "") + "</span>" +
               (meta ? '<span class="track__meta">' + esc(meta) + "</span>" : "") +
             "</span>" +
             (t.url
               ? '<a class="track__go" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer"' +
                 ' aria-label="在网易云打开 ' + esc(t.title || "") + '">' + icon("play") + "</a>"
               : "") +
           "</li>";
  }

  /* 把"最近在听"画出来。sync.js 抓到真实数据后也会调用它。 */
  function setTracks(list, source) {
    var d = C.listen || {};
    var ul = $("trackList");
    if (!ul) return;
    var items = arr(list).slice(0, d.limit || 6);
    ul.innerHTML = items.map(trackHtml).join("");
    ul.setAttribute("data-count", String(items.length));

    var foot = $("listenFoot");
    if (foot) {
      var uid = d.neteaseUid || "";
      var link = uid && uid !== "000000000"
        ? "https://music.163.com/#/user/home?id=" + encodeURIComponent(uid)
        : "https://music.163.com/";
      foot.innerHTML =
        '<span class="listen__src">' +
          (source === "live"
            ? '<span class="live-dot" aria-hidden="true"></span>已同步'
            : "示例数据 · 等待首次同步") +
        "</span>" +
        '<a class="listen__more" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' +
          "去网易云看看" + icon("arrow-up-right") + "</a>";
    }
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

  function renderQuote() {
    var q = (C.repair || {}).quote || {};
    var el = $("repairQuote");
    if (!el) return;

    var groups = groupQuote(q.rows).map(function (g) {
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
      '<div class="quote__head">' +
        '<h3 class="quote__title">' + icon("tag") + esc(q.title || "报价单") + "</h3>" +
      "</div>" +
      '<div class="quote__groups">' + groups + "</div>" +
      (q.note ? '<p class="quote__note">' + esc(q.note) + "</p>" : "");
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
               'data-copy="' + esc(it.copy) + '" aria-label="复制' + esc(it.label) + "：" + esc(it.copy) + '">' +
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
        '<button class="btn btn--quiet" type="button" data-copy="' + esc(mail) + '">' +
          icon("copy", "btn__icon") + "<span>复制邮箱</span></button>" +
      "</div>");
  }

  /* ---------- 导航 + 模块开关 / 排序 ---------- */
  function renderSections() {
    var conf = C.sections || {};
    var list = Object.keys(conf)
      .filter(function (k) { return conf[k] && conf[k].enabled !== false; })
      .sort(function (a, b) { return (conf[a].order || 0) - (conf[b].order || 0); });

    var navHtml = "", mNavHtml = "";
    list.forEach(function (key, i) {
      var label = esc(conf[key].label || key);
      navHtml += '<li><a class="nav__link" href="#' + key + '" data-nav="' + key + '">' +
                 '<span class="nav__num">0' + (i + 2) + "</span>" + label + "</a></li>";
      mNavHtml += '<li><a href="#' + key + '" data-mnav="' + key + '">' +
                  "<span>" + label + "</span>" + icon("arrow-up-right") + "</a></li>";
    });
    set("navList", navHtml);
    set("mobileNavList", mNavHtml);

    var wrap = $("sections");
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
    previewCard: previewCard   // sync.js 用
  };
})();
