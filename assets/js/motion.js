/* ==========================================================================
 *  motion.js —— 交互与动效
 *  模块之间互相独立，某个功能不需要了，删掉对应的 initXxx() 调用即可。
 * ========================================================================== */

window.SITE_MOTION = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};
  var UI = C.ui || {};
  var THEME_KEY = "zotrod-theme";
  var reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
  var $ = function (id) { return document.getElementById(id); };
  var toastTimer = null;

  function reduced() { return reduceQuery.matches; }
  function headerHeight() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 72; }

  /* ------------------------------------------------------------ Toast 提示 */
  function toast(message) {
    var el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); }, 2200);
  }

  /* ------------------------------------------------------------ 滚动渐显 */
  function initReveal() {
    var nodes = document.querySelectorAll("[data-reveal]");
    if (reduced() || typeof window.IntersectionObserver !== "function") {
      Array.prototype.forEach.call(nodes, function (n) { n.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-visible");
        io.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    Array.prototype.forEach.call(nodes, function (n) { io.observe(n); });
  }

  /* --------------------------------------------- 滚动：进度 / 页头 / 回顶 / 高亮 */
  function initScroll() {
    var header = $("siteHeader");
    var bar = $("scrollProgressBar");
    var toTop = $("toTop");
    var navLinks = document.querySelectorAll("[data-nav]");
    var sections = Array.prototype.slice.call(document.querySelectorAll(".section"))
      .filter(function (s) { return !s.hidden; });
    var ticking = false;

    function setActive(id) {
      Array.prototype.forEach.call(navLinks, function (a) {
        a.classList.toggle("is-active", a.getAttribute("data-nav") === id);
      });
    }

    function update() {
      ticking = false;
      var y = window.scrollY || window.pageYOffset || 0;
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

      if (header) header.classList.toggle("is-scrolled", y > 12);
      if (bar) bar.style.transform = "scaleX(" + Math.min(1, y / max).toFixed(4) + ")";
      if (toTop) toTop.classList.toggle("is-visible", y > 560 && UI.showBackToTop !== false);

      var probe = y + headerHeight() + 110;
      var current = "";
      sections.forEach(function (s) {
        if (s.getBoundingClientRect().top + y <= probe) current = s.id;
      });
      setActive(current);
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    window.addEventListener("load", onScroll);
    update();

    if (toTop) {
      toTop.addEventListener("click", function () {
        window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
      });
    }
  }

  /* ------------------------------------------------------------ 锚点平滑跳转 */
  function initAnchors() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var hash = a.getAttribute("href");
      if (!hash || hash === "#") return;
      var target = document.querySelector(hash);
      if (!target) return;
      e.preventDefault();
      var top = target.getBoundingClientRect().top + window.scrollY - headerHeight() - 18;
      if (hash === "#top") top = 0;
      window.scrollTo({ top: Math.max(0, top), behavior: reduced() ? "auto" : "smooth" });
      if (history.pushState) history.pushState(null, "", hash);
      closeMenu();
    });
  }

  /* -------------------------------------------------------------- 主题切换 */
  function paintThemeButton() {
    var btn = $("themeToggle");
    if (!btn) return;
    var dark = document.documentElement.dataset.theme === "dark";
    btn.innerHTML = window.siteIcon(dark ? "sun" : "moon");
    var label = dark ? "切换到浅色主题" : "切换到深色主题";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0e1011" : "#fbfbf9");
  }

  function applyTheme(mode, persist) {
    document.documentElement.classList.add("theme-switching");
    document.documentElement.dataset.theme = mode;
    if (persist) {
      try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    }
    if (window.SITE_RENDER && window.SITE_RENDER.applyAccent) window.SITE_RENDER.applyAccent();
    paintThemeButton();
    setTimeout(function () { document.documentElement.classList.remove("theme-switching"); }, 380);
  }

  function initTheme() {
    paintThemeButton();
    var btn = $("themeToggle");
    if (btn) {
      btn.addEventListener("click", function () {
        var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        applyTheme(next, true);
      });
    }
    var onSystemChange = function (e) {
      var saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch (err) {}
      if (!saved) applyTheme(e.matches ? "dark" : "light", false);
    };
    if (systemQuery.addEventListener) systemQuery.addEventListener("change", onSystemChange);
    else if (systemQuery.addListener) systemQuery.addListener(onSystemChange);
  }

  /* ------------------------------------------------------------ 移动端菜单 */
  var menuOpen = false;
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    var panel = $("mobileNav"), btn = $("menuToggle");
    if (panel) panel.hidden = true;
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", "打开菜单");
      btn.innerHTML = window.siteIcon("menu");
    }
  }
  function openMenu() {
    menuOpen = true;
    var panel = $("mobileNav"), btn = $("menuToggle");
    if (panel) panel.hidden = false;
    if (btn) {
      btn.setAttribute("aria-expanded", "true");
      btn.setAttribute("aria-label", "关闭菜单");
      btn.innerHTML = window.siteIcon("close");
    }
  }

  function initMenu() {
    var btn = $("menuToggle"), panel = $("mobileNav");
    if (!btn || !panel) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menuOpen ? closeMenu() : openMenu();
    });
    document.addEventListener("click", function (e) {
      if (!menuOpen) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) closeMenu();
    }, { passive: true });
  }

  /* -------------------------------------------------------------- 复制邮箱 */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject();
      } catch (err) { reject(err); }
      document.body.removeChild(ta);
    });
  }

  function initCopy() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-copy]");
      if (!btn) return;
      var value = btn.getAttribute("data-copy");
      copyText(value).then(function () {
        toast("已复制：" + value);
        var label = btn.querySelector("span");
        if (label) {
          var old = label.textContent;
          label.textContent = "已复制";
          setTimeout(function () { label.textContent = old; }, 1800);
        }
      }).catch(function () { toast("复制失败，请手动选择邮箱地址"); });
    });
  }

  /* ------------------------------------------------- 背景光晕：缓慢流动 + 鼠标视差 */
  function initAmbient() {
    var ambient = document.querySelector(".ambient");
    if (!ambient) return;

    function syncFlag() {
      var off = reduced() || UI.ambientMotion === false;
      document.documentElement.dataset.motion = off ? "off" : "on";
    }
    syncFlag();
    if (reduceQuery.addEventListener) reduceQuery.addEventListener("change", syncFlag);
    else if (reduceQuery.addListener) reduceQuery.addListener(syncFlag);

    if (reduced() || UI.ambientMotion === false) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    var tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
    function loop() {
      cx += (tx - cx) * .055;
      cy += (ty - cy) * .055;
      ambient.style.transform = "translate3d(" + cx.toFixed(2) + "px," + cy.toFixed(2) + "px,0)";
      if (Math.abs(tx - cx) > .05 || Math.abs(ty - cy) > .05) {
        raf = requestAnimationFrame(loop);
      } else {
        raf = null;
      }
    }
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      tx = (e.clientX / window.innerWidth - .5) * 30;
      ty = (e.clientY / window.innerHeight - .5) * 30;
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
  }

  function init() {
    initReveal();
    initScroll();
    initAnchors();
    initTheme();
    initMenu();
    initCopy();
    initAmbient();
  }

  return { init: init, toast: toast, closeMenu: closeMenu };
})();
