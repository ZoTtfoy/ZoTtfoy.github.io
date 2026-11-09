/* ==========================================================================
 *  skin.js —— 主题应用与切换面板
 * --------------------------------------------------------------------------
 *  两个维度互相独立：
 *    skin（风格）  ink / paper / noir / aurora / terminal / clay / mint
 *    mode（明暗）  light / dark / auto（跟随系统）
 *  任意组合都是有效状态。选择会记在浏览器里，下次打开还是同一种。
 * ========================================================================== */

window.SITE_SKIN = (function () {
  "use strict";

  var KEY_SKIN = "zotrod-skin";
  var KEY_MODE = "zotrod-theme";
  var T = window.SITE_THEMES || { list: [], defaultSkin: "ink" };
  var C = window.SITE_CONFIG || {};
  var UI = C.ui || {};

  var systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
  var $ = function (id) { return document.getElementById(id); };

  function store(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  /* -------------------------------------------------- 默认值与当前状态 */
  function defaultSkin() {
    var want = UI.skin || T.defaultSkin || "ink";
    return T.get(want) ? want : (T.defaultSkin || "ink");
  }

  function resolveMode(mode) {
    if (mode === "light" || mode === "dark") return mode;
    return systemQuery.matches ? "dark" : "light";
  }

  function currentSkin() {
    return document.documentElement.dataset.skin || defaultSkin();
  }

  function currentModeRaw() {
    var saved = read(KEY_MODE);
    var want = saved || UI.themeDefault || "auto";
    return (want === "light" || want === "dark" || want === "auto") ? want : "auto";
  }

  /* ------------------------------------------------------ 注入 CSS 变量 */
  function apply(skinId, modeRaw, persist) {
    var skin = T.get(skinId) || T.get(defaultSkin()) || T.list[0];
    if (!skin) return;

    var mode = resolveMode(modeRaw);
    var root = document.documentElement;

    // 变量表由 themes.js 统一合并，避免这里的逻辑和预览页各写一套
    var vars = T.resolve(skin.id, mode);
    Object.keys(vars).forEach(function (k) {
      root.style.setProperty("--" + k, vars[k]);
    });

    root.dataset.skin = skin.id;
    root.dataset.theme = mode;
    root.dataset.modeRaw = modeRaw;

    // 允许 config.ui.accent 在主题之上再覆盖一次主色
    if (window.SITE_RENDER && window.SITE_RENDER.applyAccent) {
      window.SITE_RENDER.applyAccent();
    }
    /* 换主题后背景层要重算：小字保护色依赖 --text-3 / --text，
       遮罩色靠 --bg 自动跟随但需要重新评估一次。 */
    if (window.SITE_BACKDROP && window.SITE_BACKDROP.refresh) {
      window.SITE_BACKDROP.refresh();
    }

    if (persist) {
      store(KEY_SKIN, skin.id);
      store(KEY_MODE, modeRaw);
    }

    syncMeta();
    syncPanelState();
  }

  function syncMeta() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    var bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) meta.setAttribute("content", bg);
  }

  /* ---------------------------------------------------------- 面板渲染 */
  function renderPanel() {
    var list = $("skinList");
    if (!list) return;

    list.innerHTML = T.list.map(function (t) {
      var sw = (t.swatch || []).map(function (c) {
        return '<i style="background:' + c + '"></i>';
      }).join("");
      return '<button class="skin-item" type="button" data-skin="' + t.id + '">' +
        '<span class="skin-item__swatch">' + sw + '</span>' +
        '<span class="skin-item__text"><strong>' + t.name + '</strong><small>' + t.desc + '</small></span>' +
        '<span class="skin-item__check" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>' +
        '</span></button>';
    }).join("");
  }

  function syncPanelState() {
    var skin = currentSkin(), raw = currentModeRaw();
    Array.prototype.forEach.call(document.querySelectorAll("[data-skin]"), function (el) {
      var on = el.getAttribute("data-skin") === skin;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (el) {
      var on = el.getAttribute("data-mode") === raw;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ---------------------------------------------------------- 面板开合 */
  var isOpen = false;

  function openPanel() {
    var p = $("skinPanel"), btn = $("skinBtn");
    if (!p) return;
    isOpen = true;
    p.hidden = false;
    if (btn) btn.setAttribute("aria-expanded", "true");
    // 打开时把当前项滚进可视区
    var active = p.querySelector(".skin-item.is-active");
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function closePanel() {
    var p = $("skinPanel"), btn = $("skinBtn");
    if (!p) return;
    isOpen = false;
    p.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function bindPanel() {
    var btn = $("skinBtn"), p = $("skinPanel");
    if (!btn || !p) return;

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      isOpen ? closePanel() : openPanel();
    });

    p.addEventListener("click", function (e) {
      var item = e.target.closest("[data-skin]");
      if (item) {
        apply(item.getAttribute("data-skin"), currentModeRaw(), true);
        // 让「减少动态效果」之外的场景也有过渡
        document.documentElement.classList.add("theme-switching");
        setTimeout(function () {
          document.documentElement.classList.remove("theme-switching");
        }, 380);
        return;
      }

      var modeBtn = e.target.closest("[data-mode]");
      if (modeBtn) {
        apply(currentSkin(), modeBtn.getAttribute("data-mode"), true);
        if (window.SITE_MOTION && window.SITE_MOTION.syncThemeButton) {
          window.SITE_MOTION.syncThemeButton();
        }
        document.documentElement.classList.add("theme-switching");
        setTimeout(function () {
          document.documentElement.classList.remove("theme-switching");
        }, 380);
        return;
      }

      if (e.target.closest("[data-skin-close]")) closePanel();
    });

    document.addEventListener("click", function (e) {
      if (!isOpen) return;
      if (p.contains(e.target) || btn.contains(e.target)) return;
      closePanel();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen) {
        closePanel();
        btn.focus();
      }
    });
  }

  /* ------------------------------------------------------------ 初始化 */
  function init() {
    renderPanel();
    apply(read(KEY_SKIN) || defaultSkin(), currentModeRaw(), false);
    bindPanel();

    var onChange = function () {
      if (!read(KEY_MODE) && currentModeRaw() === "auto") {
        apply(currentSkin(), "auto", false);
      }
    };
    if (systemQuery.addEventListener) systemQuery.addEventListener("change", onChange);
    else if (systemQuery.addListener) systemQuery.addListener(onChange);
  }

  return {
    init: init,
    apply: apply,
    openPanel: openPanel,
    closePanel: closePanel,
    currentSkin: currentSkin,
    currentMode: currentModeRaw,
    syncMeta: syncMeta
  };
})();
