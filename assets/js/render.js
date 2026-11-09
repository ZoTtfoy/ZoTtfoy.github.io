/* ==========================================================================
 *  渲染层：把 config.js 的数据填进 index.html 的骨架
 *  一般不需要改这个文件。新增内容优先改 config.js；
 *  新增模块则复制一个 <section> 骨架，再在这里补一段渲染函数。
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
  function delay(i, step) { return '--reveal-delay:' + (i * (step || 70)) + 'ms;'; }

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

  /* ---------- 品牌 / 页脚 ---------- */
  function renderBrand() {
    var s = C.site || {};
    set("brandMark", esc(s.initials || (s.name || "Z").slice(0, 1)));
    set("brandName", esc(s.name));
    set("footerMark", esc(s.initials || (s.name || "Z").slice(0, 1)));
    set("footerName", esc(s.name));
    set("footerCopy", esc(s.copyright));
    set("footerNote", esc(s.footerNote));
    set("mobileNavFoot", esc(s.location));
  }

  /* ---------- 首页 ---------- */
  function renderHero() {
    var s = C.site || {}, h = C.hero || {};
    set("heroStatus", s.available
      ? '<span class="status-dot" aria-hidden="true"></span>' + esc(s.availableText || "开放合作")
      : esc(s.availableText || ""));
    if (!s.availableText) { var st = $("heroStatus"); if (st) st.hidden = true; }

    set("heroTitle", text(s.tagline));
    set("heroRole", esc(s.role));
    set("heroDesc", esc(s.description));

    var p = h.primary || {}, q = h.secondary || {};
    var a = $("heroPrimary");
    if (a) {
      a.innerHTML = '<span>' + esc(p.label || "了解更多") + '</span>' + icon("arrow-down", "btn__icon");
      if (p.target) a.setAttribute("href", p.target);
    }
    var b = $("heroSecondary");
    if (b) {
      b.innerHTML = '<span>' + esc(q.label || "联系我") + '</span>' + icon("arrow-up-right", "btn__icon");
      if (q.target) b.setAttribute("href", q.target);
      if (q.target && q.target.charAt(0) !== "#") {
        b.setAttribute("target", "_blank"); b.setAttribute("rel", "noopener noreferrer");
      }
    }
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
                 '<span class="nav__num">0' + (i + 1) + '</span>' + label + '</a></li>';
      mNavHtml += '<li><a href="#' + key + '" data-mnav="' + key + '">' +
                  '<span>' + label + '</span>' + icon("arrow-up-right") + '</a></li>';
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

  /* ---------- 关于个人 ---------- */
  function renderAbout() {
    var d = C.about || {};
    set("aboutBody", arr(d.paragraphs).map(function (p) {
      return '<p>' + text(p) + '</p>';
    }).join(""));

    set("aboutFacts", arr(d.facts).map(function (f, i) {
      return '<div class="facts__row" style="' + delay(i, 55) + '" data-reveal>' +
             '<dt>' + esc(f.label) + '</dt><dd>' + esc(f.value) + '</dd></div>';
    }).join(""));

    set("aboutTags", arr(d.tags).map(function (t, i) {
      return '<li class="tag" style="' + delay(i, 45) + '" data-reveal>' + esc(t) + '</li>';
    }).join(""));
  }

  /* ---------- 业务范畴 ---------- */
  function renderServices() {
    var d = C.services || {};
    set("serviceGrid", arr(d.items).map(function (it, i) {
      var tags = arr(it.tags).map(function (t) { return '<span class="pill">' + esc(t) + '</span>'; }).join("");
      return '' +
        '<article class="card" style="' + delay(i, 80) + '" data-reveal>' +
          '<span class="card__index">' + String(i + 1).padStart(2, "0") + '</span>' +
          '<span class="card__icon">' + icon(it.icon) + '</span>' +
          '<h3 class="card__title">' + esc(it.title) + '</h3>' +
          '<p class="card__desc">' + text(it.desc) + '</p>' +
          (tags ? '<div class="card__tags">' + tags + '</div>' : '') +
        '</article>';
    }).join(""));
  }

  /* ---------- 个人喜好 ---------- */
  function renderInterests() {
    var d = C.interests || {};
    set("interestGrid", arr(d.items).map(function (it, i) {
      return '' +
        '<article class="interest" style="' + delay(i, 60) + '" data-reveal>' +
          '<span class="interest__icon">' + icon(it.icon) + '</span>' +
          '<div class="interest__text">' +
            '<h3>' + esc(it.title) + '</h3>' +
            '<p>' + esc(it.desc) + '</p>' +
          '</div>' +
          (it.meta ? '<span class="interest__meta">' + esc(it.meta) + '</span>' : '') +
        '</article>';
    }).join(""));
  }

  /* ---------- 社交平台 ---------- */
  function renderSocial() {
    var d = C.social || {}, s = C.site || {};
    set("socialGrid", arr(d.items).map(function (it, i) {
      var external = it.url && it.url.charAt(0) !== "#" && it.url.indexOf("mailto:") !== 0;
      return '' +
        '<a class="social" style="' + delay(i, 55) + '" data-reveal ' +
           'href="' + esc(it.url || "#") + '"' +
           (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
          '<span class="social__icon">' + icon(it.icon) + '</span>' +
          '<span class="social__text">' +
            '<span class="social__label">' + esc(it.label) + '</span>' +
            '<span class="social__handle">' + esc(it.handle) + '</span>' +
          '</span>' +
          icon("arrow-up-right", "social__arrow") +
        '</a>';
    }).join(""));

    var mail = s.email || "";
    set("contactBlock",
      '<p class="contact__hint">' + esc(d.contactHint || "欢迎联系") + '</p>' +
      '<div class="contact__actions">' +
        '<a class="btn btn--primary" href="mailto:' + esc(mail) + '">' +
          '<span>发封邮件</span>' + icon("send", "btn__icon") + '</a>' +
        '<button class="btn btn--quiet" type="button" data-copy="' + esc(mail) + '">' +
          icon("copy", "btn__icon") + '<span>复制邮箱</span></button>' +
      '</div>' +
      '<p class="contact__mail">' + esc(mail) + '</p>'
    );
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
    var top = $("toTop");
    if (top && C.ui && C.ui.showBackToTop === false) top.hidden = true;
  }

  function init() {
    renderMeta();
    renderBrand();
    renderHero();
    renderSections();
    renderAbout();
    renderServices();
    renderInterests();
    renderSocial();
    renderControls();
  }

  return { init: init, esc: esc, icon: icon };
})();
