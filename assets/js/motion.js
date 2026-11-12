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
  /* ---------------------------------------------------------- 滚动渐显
     ⚠️ 这个模块必须能"补挂" —— 页面里有大量内容是脚本异步塞进来的：
       · sync.js 抓到听歌排行后重绘 #trackList（整块 innerHTML 替换）
       · repair.js 每一步都重建估价卡
       · 曲目、社交按钮、游戏卡都带 data-reveal
     早先只在 init 时观察一次，于是**异步插入的元素永远不会被观察到**，
     它们带着 opacity: 0 静静躺在页面里 —— 在 DOM 里查得到、肉眼看不见。
     这正是"网易云不显示数据"的真正原因：数据抓到了、节点也渲染了，
     只是没人给它加 is-visible。

     现在把观察器提到模块作用域，暴露 reveal.scan()：
     任何重绘之后调一次，新节点就能正常淡入。 */
  var revealIO = null;

  function revealScan(root) {
    var scope = root || document;
    /* ⚠️ 不要用 :not() 复合选择器。
       自检脚本跑在极简 DOM 桩里，那种环境的选择器引擎只认最基础的形式，
       ":not(.x):not([y])" 会静默返回空集 —— 于是"降级环境下内容仍然可见"
       这条断言会莫名其妙地失败，而浏览器里一切正常。
       拿到全部 [data-reveal] 再用 JS 过滤，行为在任何环境都一致。 */
    var all = scope.querySelectorAll("[data-reveal]");
    var nodes = [];
    Array.prototype.forEach.call(all, function (n) {
      if (n.classList.contains("is-visible")) return;
      if (n.hasAttribute && n.hasAttribute("data-reveal-bound")) return;
      nodes.push(n);
    });

    /* 减少动效 / 不支持 IntersectionObserver：直接可见，不做动画 */
    if (reduced() || typeof window.IntersectionObserver !== "function") {
      Array.prototype.forEach.call(nodes, function (n) { n.classList.add("is-visible"); });
      return nodes.length;
    }

    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          en.target.classList.add("is-visible");
          revealIO.unobserve(en.target);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    }

    Array.prototype.forEach.call(nodes, function (n) {
      /* 标记"已挂过"，重复 scan 不会重复 observe。
         用属性而不是 Set：节点被替换后旧标记自然消失，不用清理。 */
      n.setAttribute("data-reveal-bound", "1");

      /* 已经在视口里的，直接标可见 —— 不要再等观察器回调。
         ⚠️ 为什么不省这一步：IntersectionObserver 的回调是异步的，
         要等下一帧且依赖滚动/布局事件。当列表在"当前正在看的这一页"
         被重绘时，读者已经在看它了，等一帧就会先看到一片空白再淡入。
         实测线上：sync.js 回填后 6 首歌全在视口里，却因为等回调
         迟迟不显示，被误判成"数据没抓到"。
         先判一次 inViewport，命中就立刻可见，剩下的交给观察器管。 */
      var r = n.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.bottom > 0 && r.top < vh && r.height > 0) {
        n.classList.add("is-visible");
        return;
      }
      revealIO.observe(n);
    });
    return nodes.length;
  }

  function initReveal() {
    revealScan();
  }

  /* --------------------------------------------- 滚动：进度 / 页头 / 回顶 / 高亮 */
  function initScroll() {
    var header = $("siteHeader");
    var bar = null;   // 顶部进度条已移除（见 update() 里的注释）
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
    /* 2026-11-12 第六轮：顶栏「翻页时重渲染一遍」的根因修复。
       实测一次翻页顶栏被切了 27 次状态：class 13 次 + data-scrolling 11 次。
       原因三条叠加：
         1) 180ms 定时器太短 —— 平滑滚动的事件间隔能到 193ms，滚动中反复
            到期移除、下一帧又加回来，顶栏在"关毛玻璃/开毛玻璃"之间高频切换；
         2) 每次切换都写 class + data 两个属性，即使值没变也会触发样式失效；
         3) background-color 上有 transition，每次抖动都重启一次 0.2s 渐变。
       现在：只保留 html[data-scrolling] 一个开关、只在值真的变化时写、
       定时器 260ms 覆盖事件间隔，并用 scrollend（支持时）立即收口。 */
    var glassTimer = null;
    function setScrolling(on) {
      var root = document.documentElement;
      clearTimeout(glassTimer);
      if (on) {
        if (root.dataset.scrolling !== "on") root.dataset.scrolling = "on";
        glassTimer = setTimeout(function () {
          if (root.dataset.scrolling !== "off") root.dataset.scrolling = "off";
        }, 260);
      } else if (root.dataset.scrolling !== "off") {
        root.dataset.scrolling = "off";
      }
    }
    function markScrolling() { setScrolling(true); }

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

      /* 每帧只在值真的变化时写，避免无谓的 class/样式失效 */
      if (header) {
        var scrolled = y > 12;
        if (header.classList.contains("is-scrolled") !== scrolled) {
          header.classList.toggle("is-scrolled", scrolled);
        }
      }
      /* 2026-11-13：顶部滚动进度条已移除（用户要求只保留侧边页码）。
         这里不再写任何进度值 —— bar 永远是 null，下面这段留着只作说明。 */
      if (toTop) {
        var showTop = y > 560 && UI.showBackToTop !== false;
        if (toTop.classList.contains("is-visible") !== showTop) {
          toTop.classList.toggle("is-visible", showTop);
        }
      }

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
    /* 滚动真正结束就立刻收口，不必等 260ms 兜底定时器。
       Chromium 114+ / Edge 156 都支持；不支持时上面的定时器照常工作。 */
    if ("onscrollend" in window) {
      window.addEventListener("scrollend", function () { setScrolling(false); }, { passive: true });
    }
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

  /* 把焦点交给跳转目标。
     为什么必须做：锚点跳转只改变滚动位置，键盘焦点还留在原来那条链接上 ——
     「跳到主要内容」之后按 Tab，会回到页头的第一个链接，等于没跳。
     只对"本来就能接收焦点"的容器做（有 tabindex 的），
     不改变任何元素的原有行为。 */
  function focusTarget(el) {
    if (!el || !el.focus) return;
    if (!el.hasAttribute("tabindex")) return;
    // preventScroll：滚动已经安排好了，别让聚焦再滚一次把落点带偏
    el.focus({ preventScroll: true });
  }

  /* 压历史时保留已有 state。
     ⚠️ 这里原来写的是 pushState(null, "", hash) —— 会把 history.state
     整个覆盖成 null。而 repair.js 现在把「估价向导停在第几步」存在
     history.state 里，被覆盖后按浏览器后退就找不到步骤，只能退回第一步。
     保留原 state、只换 URL，两边的记录才能共存。 */
  function pushHash(hash) {
    if (!history.pushState) return;
    try {
      var st = history.state;
      history.pushState(st == null ? null : st, "", hash);
    } catch (e) {
      history.pushState(null, "", hash);
    }
  }

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
            pushHash(hash);
            closeMenu();
            /* 翻页是平滑滚动，立刻聚焦会让浏览器把视口拽一下。
               等落点稳定再交焦点。 */
            setTimeout(function () { focusTarget(target); }, reduced() ? 0 : 520);
            return;
          }
        }
      } else {
        top = target.getBoundingClientRect().top + window.scrollY - headerHeight() - 18;
        if (hash === "#top") top = 0;
      }

      window.scrollTo({ top: Math.max(0, top), behavior: reduced() ? "auto" : "smooth" });
      pushHash(hash);
      closeMenu();
      setTimeout(function () { focusTarget(target); }, reduced() ? 0 : 520);
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

  /* -------------------------------------------------------------- 复制
     四个入口共用这一套：联系卡 / 游戏 UID / Q5 的 copy 型社交 / Q6 邮箱。

     ⚠️ 反馈只落在显式标了 [data-copy-hint] 的元素上。
     早先这里写的是 btn.querySelector("span") —— 它命中的是**第一个** span。
     对联系卡来说第一个 span 是图标容器 .ccard__icon，于是点一下图标就被
     "已复制"三个字顶掉、整张卡当场塌一下，1.8 秒后才弹回来。
     没有 hint 的元素（游戏 UID、社交按钮）就不动 DOM，只靠 toast + 配色。

     toast 报的是"复制了什么"，不是"复制到了什么"：
     data-copy-toast 缺省为「已复制」，绝不把账号明文念出来。 */
  function flashCopied(btn) {
    btn.classList.add("is-copied");
    clearTimeout(btn.copyTimer);
    btn.copyTimer = setTimeout(function () { btn.classList.remove("is-copied"); }, 1600);

    var hint = btn.querySelector("[data-copy-hint]");
    if (!hint) return;
    // 原文记在 DOM 上而不是闭包里：连点几次也不会把"已复制"记成原文
    if (hint.dataset.raw == null) hint.dataset.raw = hint.textContent;
    hint.textContent = "已复制";
    clearTimeout(hint.copyTimer);
    hint.copyTimer = setTimeout(function () {
      hint.textContent = hint.dataset.raw;
    }, 1600);
  }

  function initCopy() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-copy]");
      if (!btn) return;
      var value = btn.getAttribute("data-copy");
      var said = btn.getAttribute("data-copy-toast") || "已复制";
      copyText(value).then(function () {
        toast(said);
        flashCopied(btn);
      }).catch(function () { toast("复制失败，请长按手动选中"); });
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

  return {
    init: init,
    toast: toast,
    closeMenu: closeMenu,
    syncThemeButton: paintThemeButton,
    /* 供异步渲染层调用：重绘之后补挂渐显，否则新节点停在 opacity: 0 */
    revealScan: revealScan
  };
})();
