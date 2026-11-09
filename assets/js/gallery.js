/* ==========================================================================
 *  gallery.js —— 风格总览：把每套风格 × 明暗渲染成一张可以真实预览的卡片
 * ========================================================================== */

(function () {
  "use strict";

  var T = window.SITE_THEMES;
  var C = window.SITE_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var KEY_SKIN = "zotrod-skin";
  var KEY_MODE = "zotrod-theme";

  if (!T) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">' +
      '找不到 themes.js，无法生成风格总览。</p>';
    return;
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function currentSkin() {
    try { return localStorage.getItem(KEY_SKIN) || (C.ui && C.ui.skin) || T.defaultSkin; }
    catch (e) { return (C.ui && C.ui.skin) || T.defaultSkin; }
  }

  /* 把一组变量逐个注入到元素上。
     不用 style="a:b;c:d" 的字符串写法：字体栈里含引号和逗号，
     拼接后被某些解析器截断，会把后面的变量一起丢掉。逐个 setProperty 更稳。 */
  function applyVars(el, skinId, mode) {
    var vars = T.resolve(skinId, mode);
    Object.keys(vars).forEach(function (k) {
      el.style.setProperty("--" + k, vars[k]);
    });
  }

  function cardHtml(t, mode) {
    var isDark = mode === "dark";
    var accent = t[mode].accent;
    var radius = t.base["r-md"];
    var fontName = /serif/i.test(t.base["font-display"]) ? "宋 / Serif" :
                   /mono/i.test(t.base["font-sans"]) ? "等宽" : "无衬线";

    return '' +
      '<button class="g-card" type="button" data-skin="' + t.id + '" data-mode="' + mode + '" ' +
        'aria-label="应用风格：' + esc(t.name) + '（' + (isDark ? "深色" : "浅色") + '）">' +

        '<span class="g-card__flag">✓ 默认</span>' +

        '<span class="g-card__bar">' +
          '<span class="g-card__name">' + esc(t.name) +
            '<span class="g-card__id">' + esc(t.id) + '</span>' +
          '</span>' +
          '<span class="g-card__mode">' + (isDark ? "DARK" : "LIGHT") + '</span>' +
        '</span>' +

        '<span class="g-mini">' +
          '<span class="g-mini__avatar">' +
            esc((C.site && C.site.initials) || "Z") +
          '</span>' +
          '<span class="g-mini__title">把复杂的东西，<br>做得简单一点。</span>' +
          '<span class="g-mini__desc">写一点关于我的事、我做的事情，以及一些不务正业的爱好。</span>' +
          '<span class="g-mini__row">' +
            '<span class="g-mini__btn g-mini__btn--solid">看看我做什么</span>' +
            '<span class="g-mini__btn g-mini__btn--ghost">找到我</span>' +
          '</span>' +
          '<span class="g-specimens">' +
            '<span class="g-chip">' +
              '<span class="g-chip__label">Accent</span>' +
              '<span class="g-chip__swatch" style="background:' + accent + '"></span>' +
            '</span>' +
            '<span class="g-chip">' +
              '<span class="g-chip__label">Radius</span>' +
              '<span class="g-chip__value">' + esc(radius) + '</span>' +
            '</span>' +
            '<span class="g-chip">' +
              '<span class="g-chip__label">Font</span>' +
              '<span class="g-chip__value">' + esc(fontName) + '</span>' +
            '</span>' +
          '</span>' +
        '</span>' +
      '</button>';
  }

  function render() {
    var html = "";
    T.list.forEach(function (t) {
      html += cardHtml(t, "light");
      html += cardHtml(t, "dark");
    });
    $("gGrid").innerHTML = html;

    // 变量在插入 DOM 之后逐个注入，避免字符串拼接解析问题
    Array.prototype.forEach.call(document.querySelectorAll(".g-card"), function (el) {
      applyVars(el, el.getAttribute("data-skin"), el.getAttribute("data-mode"));
    });

    $("gLead").textContent =
      "同一份内容，共 " + T.list.length + " 套风格 × 2 种明暗 = " + T.count() +
      " 种组合。每张卡片都用真实的设计变量渲染，悬停看整体气质，点一下设为默认。";

    syncCurrent();
  }

  function syncCurrent() {
    var skin = currentSkin();
    var modeRaw = null;
    try { modeRaw = localStorage.getItem(KEY_MODE); } catch (e) {}
    var mode = modeRaw === "dark" ? "dark" : modeRaw === "light" ? "light" : null;

    Array.prototype.forEach.call(document.querySelectorAll(".g-card"), function (el) {
      var on = el.getAttribute("data-skin") === skin &&
               (mode === null || el.getAttribute("data-mode") === mode);
      el.classList.toggle("is-current", on);
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $("gToast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); }, 2200);
  }

  function bind() {
    $("gGrid").addEventListener("click", function (e) {
      var card = e.target.closest("[data-skin]");
      if (!card) return;
      var id = card.getAttribute("data-skin");
      var mode = card.getAttribute("data-mode");
      try {
        localStorage.setItem(KEY_SKIN, id);
        localStorage.setItem(KEY_MODE, mode);
      } catch (err) {}
      syncCurrent();
      var t = T.get(id);
      toast("已设为默认：「" + (t ? t.name : id) + "」· " + (mode === "dark" ? "深色" : "浅色"));
    });
  }

  render();
  bind();
})();
