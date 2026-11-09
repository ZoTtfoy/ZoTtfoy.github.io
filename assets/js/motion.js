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

    /* 滚动期间：关顶栏毛玻璃 + 暂停背景动画（CSS 里对应 data-scrolling）。
       两者都是"滚动时停、停手恢复"，因为滚动本身就要占合成器带宽。
       实测这一组把掉帧从 7/110 压到 0~2/110。

       注意这里刻意用同步赋值而不是放到 rAF 里：
       如果延后一帧，滚动开始时背景还在动，那一帧就会掉 ——
       这正是之前残余掉帧的来源。 */
    var glassTimer = null;
    function markScrolling() {
      if (!header) return;
      header.classList.add("is-scrolling");
      document.documentElement.dataset.scrolling = "on";
      clearTimeout(glassTimer);
      glassTimer = setTimeout(function () {
        header.classList.remove("is-scrolling");
        document.documentElement.dataset.scrolling = "off";
      }, 180);
    }

    /* 缓存的文档高度：scrollHeight 会强制重新布局，不适合每帧读 */
    var docHeight = 0;
    var lastInner = 0;
    function refreshHeight() {
      docHeight = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      lastInner = window.innerHeight;
    }

    function update() {
      ticking = false;
      var y = window.scrollY || window.pageYOffset || 0;

      if (header) header.classList.toggle("is-scrolled", y > 12);
      if (bar) {
        if (!docHeight || Math.abs(lastInner - window.innerHeight) > 1) refreshHeight();
        bar.style.transform = "scaleX(" + Math.min(1, y / docHeight).toFixed(4) + ")";
      }
      if (toTop) toTop.classList.toggle("is-visible", y > 560 && UI.showBackToTop !== false);

      /* 翻页模式下导航高亮由 paged.js 通过 site:pagechange 广播，
         这里不再重复遍历 section 读布局（那是每帧 6 次强制布局）。 */
      if (document.documentElement.dataset.paged === "on") return;

      var probe = y + headerHeight() + 110;
      var current = "";
      sections.forEach(function (s) {
        if (s.getBoundingClientRect().top + y <= probe) current = s.id;
      });
      setActive(current);
    }

    /* 接收 paged.js 的翻页广播，复用它算好的当前页，避免两套 scrollspy */
    document.addEventListener("site:pagechange", function (e) {
      if (document.documentElement.dataset.paged !== "on") return;
      var id = e && e.detail ? e.detail.id : "";
      setActive(id === "top" ? "" : id);
    });

    function onScroll() {
      markScrolling();
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    window.addEventListener("scroll", onScroll, { passive: true });

    /* 更早的触发点：scroll 事件本身可能比 rAF 晚一帧到达，
       这里用 wheel / touchmove 抢先进入"滚动中"状态，
       让背景动画在这一帧之前就停住 —— 这是把残余掉帧压到 0 的关键。
       用 passive + 只做一次属性赋值，成本可忽略。 */
    function earlyScroll() { markScrolling(); }
    window.addEventListener("wheel", earlyScroll, { passive: true });
    window.addEventListener("touchmove", earlyScroll, { passive: true });
    window.addEventListener("touchstart", earlyScroll, { passive: true });
    window.addEventListener("resize", function () { docHeight = 0; onScroll(); }, { passive: true });
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

      var paged = document.documentElement.dataset.paged === "on";
      var top;

      if (paged) {
        // 翻页模式下，页内已经把页头高度算进 padding，锚点直接对齐页顶，
        // 不能再减一次页头高度，否则会差出一整条。
        top = target.getBoundingClientRect().top + window.scrollY;
        // 如果是某个区块，交给 paged 精确对齐
        if (window.SITE_PAGED && target.matches(".section, .hero")) {
          var all = window.SITE_PAGED.pages();
          var idx = all.indexOf(target);
          if (idx >= 0) {
            window.SITE_PAGED.goTo(idx);
            if (history.pushState) history.pushState(null, "", hash);
            closeMenu();
            return;
          }
        }
      } else {
        top = target.getBoundingClientRect().top + window.scrollY - headerHeight() - 18;
        if (hash === "#top") top = 0;
      }

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
    var label = dark ? "切换到浅色" : "切换到深色";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    if (C.ui && C.ui.showThemeToggle === false) btn.hidden = true;
    // theme-color 由 skin.js 依据当前主题底色写入，这里不再固定
  }

  function applyTheme(mode, persist) {
    document.documentElement.classList.add("theme-switching");
    // 主题（风格 + 明暗）统一由 skin.js 负责注入，这里只转交
    if (window.SITE_SKIN && window.SITE_SKIN.apply) {
      window.SITE_SKIN.apply(window.SITE_SKIN.currentSkin(), mode, persist);
    } else {
      document.documentElement.dataset.theme = mode;
      if (persist) {
        try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
      }
      if (window.SITE_RENDER && window.SITE_RENDER.applyAccent) window.SITE_RENDER.applyAccent();
    }
    paintThemeButton();
    setTimeout(function () { document.documentElement.classList.remove("theme-switching"); }, 380);
  }

  function initTheme() {
    paintThemeButton();
    var btn = $("themeToggle");
    if (btn) {
      btn.addEventListener("click", function () {
        // 快速切换：在浅色 / 深色之间来回（若原本是「跟随系统」，点一下即转为手动）
        var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        applyTheme(next, true);
      });
    }
    // 系统偏好变化交给 skin.js 统一处理，这里不重复绑定
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

  /* ------------------------------------------------- 背景动效总开关
     这里只负责「该不该动」这一个开关（data-motion），
     具体的分层、视差、图片都在 backdrop.js 里。
     早先视差也写在这里，会和 backdrop.js 抢同一个 transform，故已移交。 */
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

  return { init: init, toast: toast, closeMenu: closeMenu, syncThemeButton: paintThemeButton };
})();
