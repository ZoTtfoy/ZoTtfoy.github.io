/* ==========================================================================
 *  paged.js —— 翻页控制
 * --------------------------------------------------------------------------
 *  做了四件事：
 *    1. 把页面切成「一屏一页」，交给 CSS scroll-snap 去吸附
 *    2. 测量每页的真实内容高度：一屏装不下的页自动放弃吸附（关键）
 *    3. 右侧页码指示：显示当前位置、可点击跳转、跟随滚动高亮
 *    4. 键盘翻页：↑↓ / PgUp PgDn / Home End / 数字键直接跳第 N 页
 *
 *  刻意没有做的事：接管鼠标滚轮。
 *    滚轮劫持在触控板上非常难受（一次滑动被拆成好几次跳页），
 *    而且会破坏浏览器的惯性滚动。原生 snap 已经足够像翻页。
 * ========================================================================== */

window.SITE_PAGED = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};
  var UI = C.ui || {};
  var SEC = C.sections || {};

  var pages = [];          // 页面元素，按屏幕顺序
  var dots = [];           // 桌面：页码圆点
  var segs = [];           // 手机：底部细分段
  var activeIndex = -1;
  var enabled = false;
  var reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var $ = function (id) { return document.getElementById(id); };
  var ticking = false;
  var rafId = null;

  function reduced() { return reduceQuery.matches; }
  function smooth() { return reduced() ? "auto" : "smooth"; }
  function headerH() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h"));
    return isNaN(v) ? 72 : v;
  }

  /* ------------------------------------------------------- 收集页面元素 */
  function collect() {
    pages = [];
    var hero = $("top");
    if (hero && !hero.hidden) pages.push(hero);
    Array.prototype.forEach.call(document.querySelectorAll(".section"), function (s) {
      if (!s.hidden) pages.push(s);
    });
    return pages;
  }

  /* --------------------------------------------- 测量：这页一屏装得下吗 */
  /* 临时把 min-height / align-items 还原成内容自然尺寸，量完立刻复原。
     比用 scrollHeight 可靠：flex 居中时 scrollHeight 永远等于最小高度，看不出溢出。 */
  function naturalHeight(el) {
    var prevMin = el.style.minHeight;
    var prevAlign = el.style.alignItems;
    el.style.minHeight = "0";
    el.style.alignItems = "flex-start";
    var h = el.offsetHeight;
    el.style.minHeight = prevMin;
    el.style.alignItems = prevAlign;
    return h;
  }

  function markTall() {
    if (!enabled) return;
    var vh = window.innerHeight;

    // 先全部当作「装得下」来量，避免上一轮的 data-tall 影响这一轮
    pages.forEach(function (p) { p.removeAttribute("data-tall"); });
    void document.documentElement.offsetHeight;

    var anyTall = false;
    pages.forEach(function (p) {
      var h = naturalHeight(p);
      // 留 2px 容差，避免亚像素把刚好一屏的页误判成溢出
      if (h > vh + 2) {
        p.setAttribute("data-tall", "1");
        anyTall = true;
      }
    });

    /* 吸附力度自适应：
       全部装得下 → mandatory，任何滚动都停在页边界，最像翻页；
       有一页装不下 → proximity，让用户能把那页看完，不至于被弹走。 */
    document.documentElement.dataset.snap = anyTall ? "proximity" : "mandatory";
  }

  /* ----------------------------------------------------------- 页码构建 */
  function labelOf(page, i) {
    if (i === 0 && page.id === "top") return "首页";
    var key = page.getAttribute("data-section");
    var conf = key ? SEC[key] : null;
    if (conf && conf.label) return conf.label;
    var t = page.querySelector(".section__title");
    return t ? t.textContent.trim() : "第 " + (i + 1) + " 页";
  }

  function buildPager() {
    var list = $("pagerList");
    var track = $("pagerTrack");
    var pager = $("pager");
    if (!list || !pager) return;

    list.innerHTML = "";
    if (track) track.innerHTML = "";
    dots = [];
    segs = [];

    pages.forEach(function (page, i) {
      var label = labelOf(page, i);

      /* 桌面：圆点 + 悬停标签 */
      var li = document.createElement("li");
      li.className = "pager__item";

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pager__dot";
      btn.setAttribute("aria-label", "第 " + (i + 1) + " 页：" + label);
      btn.innerHTML = '<span class="pager__label"><b>' +
        String(i + 1).padStart(2, "0") + "</b> " +
        label.replace(/</g, "&lt;") + "</span>";

      btn.addEventListener("click", function () { goTo(i); });
      li.appendChild(btn);
      list.appendChild(li);
      dots.push(btn);

      /* 手机：底部细分段（只做指示，不可点，避免误触） */
      if (track) {
        var seg = document.createElement("span");
        seg.className = "pager__seg";
        track.appendChild(seg);
        segs.push(seg);
      }
    });

    if (UI.showPager === false) pager.hidden = true;
  }

  /* ------------------------------------------------------------ 状态同步 */
  var enterTimer = null;
  var settleTimer = null;
  var lastAnimated = -1;

  /* 章节入场：只在这一页「滚动停稳后」播放一次。
     为什么不在滚动过程中播：从第 1 页跳到第 5 页时会途经中间几页，
     若每经过一页都触发，就会有多页同时挂着 is-entering，动画互相打架。
     所以改成「停稳 140ms 后再判断」，并且每次都先把其他页的标记清干净。 */
  function playEnter(page) {
    if (!page || reduced()) return false;

    /* 只给「确实在视口里」的页播动画。
       平滑滚动从第 1 页跳到第 6 页时，中途可能有短暂停顿触发调度，
       若不校验，那一页会在屏幕外播完动画、真正翻到时反而什么都不动。 */
    var rect = page.getBoundingClientRect();
    var vh = window.innerHeight || 800;
    if (rect.top > vh * 0.5 || rect.bottom < vh * 0.5) return false;

    pages.forEach(function (p) { p.classList.remove("is-entering"); });
    void page.offsetHeight;                 // 强制回流，保证重复进入也能重播
    page.classList.add("is-entering");

    clearTimeout(enterTimer);
    enterTimer = setTimeout(function () {
      page.classList.remove("is-entering");
    }, 920);
    return true;
  }

  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (activeIndex < 0 || activeIndex === lastAnimated) return;
      /* 只有真的播了才算「已播放」。
         早先在这里先把 lastAnimated 置位再判断能否播放，
         结果一旦因不在视口内被跳过，这一页就永远不会再播 —— 已成历史 bug。 */
      if (playEnter(pages[activeIndex])) {
        lastAnimated = activeIndex;
        if (UI.lightEffects !== false && !reduced()) sweep();
      }
    }, 140);
  }

  function setActive(i) {
    if (i === activeIndex || i < 0 || i >= pages.length) return;
    activeIndex = i;

    pages.forEach(function (p, k) {
      p.classList.toggle("is-page-active", k === i);
    });
    dots.forEach(function (d, k) {
      d.classList.toggle("is-current", k === i);
      if (k === i) d.setAttribute("aria-current", "page");
      else d.removeAttribute("aria-current");
    });
    segs.forEach(function (s, k) {
      s.classList.toggle("is-current", k === i);
    });
  }

  function sweep() {
    var el = document.querySelector(".page-sweep");
    if (!el) return;
    el.classList.remove("is-running");
    void el.offsetWidth;
    el.classList.add("is-running");
  }

  /* --------------------------------------------------------- 滚动位置判定 */
  function updateActive() {
    if (!pages.length) return;
    var y = window.scrollY || window.pageYOffset || 0;
    var vh = window.innerHeight;
    var line = y + vh * 0.42;         // 视线落点：略高于中线

    var idx = -1;
    for (var i = 0; i < pages.length; i++) {
      var top = pages[i].getBoundingClientRect().top + y;
      var h = pages[i].offsetHeight;
      if (top <= line && top + h > line) { idx = i; break; }
    }

    // 落在页与页的缝隙里（或到顶 / 到底），取最近的一页
    if (idx === -1) {
      var min = Infinity;
      for (var j = 0; j < pages.length; j++) {
        var t = pages[j].getBoundingClientRect().top + y;
        var d = Math.abs(t - line);
        if (d < min) { min = d; idx = j; }
      }
    }
    setActive(idx);
    scheduleSettle();
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    rafId = requestAnimationFrame(function () {
      ticking = false;
      updateActive();
    });
  }

  /* ------------------------------------------------------------ 跳转某页 */
  function goTo(i) {
    if (i < 0 || i >= pages.length) return;
    var top = pages[i].getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
    window.scrollTo({ top: Math.max(0, top), behavior: smooth() });
    setActive(i);
    scheduleSettle();
  }

  function goBy(delta) {
    var base = activeIndex === -1 ? 0 : activeIndex;
    var target = base + delta;
    if (target < 0) return false;                 // 已经在第一页，交给浏览器
    if (target > pages.length - 1) {
      // 已经是最后一页：再往下就滚到页脚，别把用户卡在最后
      var bottom = document.documentElement.scrollHeight - window.innerHeight;
      var y = window.scrollY || window.pageYOffset || 0;
      if (y < bottom - 8) {
        window.scrollTo({ top: bottom, behavior: smooth() });
        return true;
      }
      return false;
    }
    goTo(target);
    return true;
  }

  /* -------------------------------------------------------------- 滚轮
     为什么需要它：强制吸附下，鼠标滚 400px（不足半屏）会被浏览器吸回原页，
     用户会觉得「滚了没反应」。
     这里把「一次明确的滚动意图」翻译成「翻一页」。
     为了不冒犯触控板：累加增量达阈值才翻，翻完锁 700ms，
     横向滚动（deltaX 占主导）和非强制吸附模式一律不接管。 */
  var WHEEL_THRESHOLD = 46;
  var WHEEL_LOCK = 700;
  var wheelAcc = 0;
  var wheelLockedUntil = 0;
  var wheelResetTimer = null;

  function wheelPagingAllowed(e) {
    if (document.documentElement.dataset.snap !== "mandatory") return false;
    // 横向滚动交给卡片导轨，不要抢
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return false;
    // 面板打开时不接管
    var panels = ["skinPanel", "mobileNav", "publishSheet"];
    for (var i = 0; i < panels.length; i++) {
      var el = $(panels[i]);
      if (el && !el.hidden) return false;
    }
    // 由键盘/程序触发的滚动不拦
    if (e.ctrlKey || e.metaKey) return false;
    return true;
  }

  function initWheel() {
    window.addEventListener("wheel", function (e) {
      if (!enabled) return;
      if (!wheelPagingAllowed(e)) return;

      var now = Date.now();
      if (now < wheelLockedUntil) {
        // 锁定期间吃掉事件，避免一次手势连翻好几页
        e.preventDefault();
        return;
      }

      wheelAcc += e.deltaY;

      clearTimeout(wheelResetTimer);
      wheelResetTimer = setTimeout(function () { wheelAcc = 0; }, 160);

      if (Math.abs(wheelAcc) < WHEEL_THRESHOLD) {
        // 还没攒够：先不让页面自己滚，否则会先动一下再翻，看着发抖
        e.preventDefault();
        return;
      }

      var dir = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      wheelLockedUntil = now + WHEEL_LOCK;
      e.preventDefault();
      goBy(dir);
    }, { passive: false });
  }

  /* -------------------------------------------------------------- 键盘 */  function initKeys() {
    document.addEventListener("keydown", function (e) {
      if (!enabled) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      var t = e.target;
      var tag = t && t.tagName ? t.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;

      // 面板开着的时候键盘留给面板
      var panels = ["skinPanel", "mobileNav", "publishSheet"];
      for (var i = 0; i < panels.length; i++) {
        var el = $(panels[i]);
        if (el && !el.hidden) return;
      }

      var cur = pages[activeIndex];
      var curTall = cur && cur.getAttribute("data-tall") === "1";
      var handled = true;

      // 高个页里按上下键，用户多半是想在本页内慢慢看，就让浏览器原生滚动
      if (curTall && (e.key === "ArrowDown" || e.key === "ArrowUp")) return;

      switch (e.key) {
        case "ArrowDown": case "PageDown": case "j":
          handled = goBy(1); break;
        case "ArrowUp": case "PageUp": case "k":
          handled = goBy(-1); break;
        case "Home":
          goTo(0); break;
        case "End":
          goTo(pages.length - 1); break;
        default:
          // 数字键 1-9 直接跳到对应页（演示时很好用）
          if (/^[1-9]$/.test(e.key)) {
            var n = parseInt(e.key, 10) - 1;
            if (n < pages.length) goTo(n); else handled = false;
          } else {
            handled = false;
          }
      }
      if (handled) e.preventDefault();
    });
  }

  /* ------------------------------------------------------- 尺寸变化重算 */
  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      markTall();
      updateActive();
    }, 180);
  }

  /* ------------------------------------------------------ 首次翻页提示 */
  function initHint() {
    var el = $("pageHint");
    if (!el || UI.showHint === false) return;

    var seen = false;
    try { seen = sessionStorage.getItem("zotrod-hint") === "1"; } catch (e) {}
    if (seen) return;

    // 只在高个页不存在、确实能一页一页翻的时候提示，否则提示会误导
    if (document.documentElement.dataset.snap !== "mandatory") return;

    el.classList.add("is-shown");

    var gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      el.classList.add("is-gone");
      setTimeout(function () { el.classList.remove("is-shown", "is-gone"); }, 420);
      try { sessionStorage.setItem("zotrod-hint", "1"); } catch (e) {}
      window.removeEventListener("wheel", dismiss);
      window.removeEventListener("touchstart", dismiss);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("scroll", dismiss);
    }

    window.addEventListener("wheel", dismiss, { passive: true, once: false });
    window.addEventListener("touchstart", dismiss, { passive: true });
    window.addEventListener("keydown", dismiss);
    window.addEventListener("scroll", dismiss, { passive: true });
    // 8 秒没动作也自动收掉，别一直挂着
    setTimeout(dismiss, 8000);
  }

  /* ------------------------------------------------------------ 初始化 */
  function init() {
    enabled = UI.paged !== false;
    document.documentElement.dataset.paged = enabled ? "on" : "off";
    if (!enabled) return;

    collect();
    if (!pages.length) return;

    markTall();
    buildPager();

    // 首帧先确定当前页，但不触发光扫
    activeIndex = -1;
    updateActive();
    // 首帧就把「已播放入场的页」对齐当前页，避免一进页面就动一次
    lastAnimated = activeIndex;

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onResize, { passive: true });
    }

    // 字体晚到会改变高度，加载完再量一次
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        markTall();
        updateActive();
      }).catch(function () {});
    }
    window.addEventListener("load", function () {
      markTall();
      updateActive();
    });

    initKeys();
    initWheel();
    initHint();
  }

  return {
    init: init,
    goTo: goTo,
    pages: function () { return pages.slice(); },
    activeIndex: function () { return activeIndex; },
    refresh: function () { markTall(); updateActive(); }
  };
})();
