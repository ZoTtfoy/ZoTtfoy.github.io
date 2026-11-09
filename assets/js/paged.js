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

  /* ------------------------------------------- 按「可用高度」分级（适配手机）
     为什么不用 @media (max-height)：
       手机浏览器地址栏会随滚动收缩 / 展开，视口高度在 640~740 之间反复跳。
       用视口高度的媒体查询会让整页布局反复重排、内容闪动。
       所以由 JS 算好、写成 html[data-fit]，只在**跨档**时更新。

     四档（宽松 → 紧凑）：roomy → tight → snug → micro
       roomy  主流手机、平板，保持设计稿留白
       tight  小屏手机（iPhone SE / 8 Plus）
       snug   极矮屏、折叠屏外屏
       micro  横屏手机（改横向布局）

     ⚠️ 关键：不能用「视口高度 > 阈值」来定档。
       同样的高度，窄屏需要更多行、内容更高 —— 实测 360×780 与 390×844
       可用高度接近，但 360 宽的「关于」章要高 122px。
       所以改成「**从最宽松开始试，装不下就降一档、重新量**」，
       直到某档能装下，或已到最紧。这样任何比例都能自己找到合适档位。 */
  var FIT_STEPS = ["roomy", "tight", "snug", "micro"];
  var fitNow = "";

  function setFit(level) {
    if (fitNow === level) return false;
    fitNow = level;
    document.documentElement.dataset.fit = level;
    return true;
  }

  /* 量一遍所有页面，把超出的标上 data-tall，返回超出数量 */
  function countOverflow() {
    var vh = window.innerHeight;
    var over = 0;
    pages.forEach(function (p) {
      p.removeAttribute("data-tall");
      /* 容差 2px → 1px。
         2px 原本是想挡住亚像素把「刚好一屏」误判成溢出，但字体的
         亚像素累积误差实际在 1px 以内，2px 就留得太宽了，
         会让真正超 2px 的页蒙混过关。
         实测案例：iPhone 8 Plus 414×736 下 gaming 章节是 738px，
         判定式 738 > 736 + 2 为假 → 没降档 → 页面底部被切掉 2px。
         收窄到 1px 后该页会正确降到下一档。 */
      if (naturalHeight(p) > vh + 1) {
        p.setAttribute("data-tall", "1");
        over++;
      }
    });
    return over;
  }

  /* 从最宽松逐级往下试，找到第一个「所有页都装得下」的档位 */
  function pickFit() {
    for (var i = 0; i < FIT_STEPS.length; i++) {
      setFit(FIT_STEPS[i]);
      if (countOverflow() === 0) return FIT_STEPS[i];
    }
    return FIT_STEPS[FIT_STEPS.length - 1];
  }

  function markTall() {
    if (!enabled) return;
    var vh = window.innerHeight;

    /* 每次都从最宽松档重新试 —— 这样屏幕变大（或竖屏转横屏再转回）
       也能自动放宽，而不是一直卡在上一次的紧档。 */
    setFit("roomy");
    void document.documentElement.offsetHeight;

    pickFit();

    // 逐级试完后可能仍有页装不下（已到最紧档），此时保留 data-tall 让吸附降级
    var anyTall = countOverflow() > 0;

    /* 吸附力度自适应：
       全部装得下 → mandatory，任何滚动都停在页边界，最像翻页；
       有一页装不下 → proximity，让用户能把那页看完，不至于被弹走。 */
    document.documentElement.dataset.snap = anyTall ? "proximity" : "mandatory";

    // 高度变了，位置缓存立刻失效
    measureTops();
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

    /* 广播当前页，让导航高亮等其它模块复用同一份判断。
       早先 motion.js 自己另做了一套 scrollspy，每帧对 6 个 section
       各读一次 getBoundingClientRect —— 既浪费又可能与这里得出不同结果。 */
    try {
      document.dispatchEvent(new CustomEvent("site:pagechange", {
        detail: { index: i, id: pages[i] ? pages[i].id : "" }
      }));
    } catch (e) { /* 老浏览器忽略 */ }
  }

  function sweep() {
    var el = document.querySelector(".page-sweep");
    if (!el) return;
    el.classList.remove("is-running");
    void el.offsetWidth;
    el.classList.add("is-running");
  }

  /* --------------------------------------------------------- 滚动位置判定 */
  /* -------------------------------------------- 位置缓存（性能关键）
     早先每一帧都对 6 个页面各调一次 getBoundingClientRect，
     一次滚动下来 180+ 次布局读取，浏览器无法把布局推迟到最后一刻。
     现在把每页的文档坐标和高度缓存起来，只在尺寸真的变了才重算：
       · ResizeObserver 监听页面本身和 document
       · 窗口 resize / 字体加载完成 / 显式 refresh()
     滚动过程中零布局读取。 */
  var pageTops = [];
  var pageHeights = [];
  var measureQueued = false;

  function measureTops() {
    measureQueued = false;
    var y = window.scrollY || window.pageYOffset || 0;
    pageTops = [];
    pageHeights = [];
    for (var i = 0; i < pages.length; i++) {
      var r = pages[i].getBoundingClientRect();
      pageTops.push(Math.round(r.top + y));
      pageHeights.push(pages[i].offsetHeight);
    }
  }

  function queueMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(measureTops);
  }

  function observeSizes() {
    if (typeof ResizeObserver !== "function") return;
    var ro = new ResizeObserver(queueMeasure);
    pages.forEach(function (p) { ro.observe(p); });
  }

  function updateActive() {
    if (!pages.length) return;
    if (!pageTops.length) measureTops();

    var y = window.scrollY || window.pageYOffset || 0;
    var vh = window.innerHeight;
    var line = y + vh * 0.42;         // 视线落点：略高于中线

    var idx = -1;
    for (var i = 0; i < pageTops.length; i++) {
      var top = pageTops[i];
      var h = pageHeights[i];
      if (top <= line && top + h > line) { idx = i; break; }
    }

    // 落在页与页的缝隙里（或到顶 / 到底），取最近的一页
    if (idx === -1) {
      var min = Infinity;
      for (var j = 0; j < pageTops.length; j++) {
        var d = Math.abs(pageTops[j] - line);
        if (d < min) { min = d; idx = j; }
      }
    }
    setActive(idx);
    scheduleSettle();
  }

  /* 滚动处理：位置已缓存，updateActive 是纯计算（无布局读取），成本很低。
     曾试过「每 3 帧算一次」的节流，结果反而更差：页码高亮变成一步一跳，
     掉帧从 4 升到 19 —— 均匀的小开销比不均匀的大跳变更友好。
     所以保持每帧计算。 */
  function onScroll() {
    if (ticking) return;
    ticking = true;
    rafId = requestAnimationFrame(function () {
      ticking = false;
      updateActive();
    });

    /* 停手后归位：拖动滚动条、触摸划动、或惯性滚动结束时，
       页面可能停在两页之间，这里把它落回最近的边界。
       程序滚动（goTo / 滚轮）期间跳过，否则会把自己的动画打断。 */
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snapToNearest, SETTLE_DELAY);
  }

  /* ------------------------------------------------------------ 跳转某页 */
  function goTo(i) {
    if (i < 0 || i >= pages.length) return;
    if (!pageTops.length) measureTops();
    var top = pageTops[i];
    if (top === undefined) {
      top = pages[i].getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
    }
    markProgrammatic(520);
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

  /* ======================================================== 滚动所有权
     这一块是重做的。早先的做法是「CSS 强制吸附 + JS 劫持滚轮」两条腿走路，
     两者互相打架，桌面端表现成：
       单格滚轮要滚 3 次才过一页（0 → 641 → 897 → 900）
       向下滚第 3 格完全没反应
     原因：JS 调 scrollTo(smooth) 的同时浏览器的 snap 也在往吸附点拉，
     两边都在改 scrollTop，结果是走到一半被拽回去。

     现在改成**单一所有权**：paged 模式下关掉 CSS 吸附，翻页完全由 JS 负责。
       · 滚轮：攒够一格的量就翻一页（不劫持浏览器惯性的中间态）
       · 键盘 / 页码：直接 goTo
       · 拖动滚动条、触摸划动：自由滚动，停手后自动落到最近的页边界
     没有第二套规则参与，就不会再出现"滚了没反应"。 */
  var WHEEL_STEP = 40;          // 一格滚轮的判定量（真实鼠标一格约 100）
  var SETTLE_DELAY = 150;       // 停手多久后归位
  var wheelAcc = 0;
  var wheelLockedUntil = 0;
  var wheelResetTimer = null;
  var programmatic = false;     // JS 正在滚动（到点前不做归位）
  var progTimer = null;
  /* ⚠️ 这里必须用独立的变量名。
     早先复用了 settleTimer（章节入场动画也在用它），
     结果 updateActive → setActive → scheduleSettle 每次都把归位定时器 clear 掉，
     自动归位永远不执行 —— 表现为"自由滚动后停在两页中间"。 */
  var snapTimer = null;

  /* 标记「接下来这段时间的滚动是程序触发的」，归位逻辑要跳过 */
  function markProgrammatic(ms) {
    programmatic = true;
    clearTimeout(progTimer);
    progTimer = setTimeout(function () { programmatic = false; }, ms);
  }

  /* 落到最近的页边界。仅在用户自由滚动（拖滚动条 / 触摸）后调用 */
  function snapToNearest() {
    if (!enabled || programmatic) return;
    if (document.documentElement.dataset.snap !== "mandatory") return;  // 有高个页时不强制
    if (!pageTops.length) measureTops();
    var y = window.scrollY || window.pageYOffset || 0;

    /* 候选落点 = 每页顶部 + 文档最底部。
       把「最底部」也算进去，页脚才能被滚到；
       否则最后一页再往下滚会被吸回页顶，页脚永远看不到。 */
    var bottom = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    var cands = pageTops.slice();
    if (bottom > pageTops[pageTops.length - 1] + 4) cands.push(bottom);

    var best = cands[0], bestD = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var d = Math.abs(cands[i] - y);
      if (d < bestD) { bestD = d; best = cands[i]; }
    }
    if (bestD > 3) {
      markProgrammatic(520);
      window.scrollTo({ top: best, behavior: smooth() });
    }
  }

  function wheelPagingAllowed(e) {
    if (!enabled) return false;
    if (document.documentElement.dataset.snap !== "mandatory") return false;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return false;   // 横向手势不管
    // 面板打开时不接管
    var panels = ["skinPanel", "mobileNav", "publishSheet"];
    for (var i = 0; i < panels.length; i++) {
      var el = $(panels[i]);
      if (el && !el.hidden) return false;
    }
    if (e.ctrlKey || e.metaKey) return false;                   // 缩放
    return true;
  }

  function initWheel() {
    window.addEventListener("wheel", function (e) {
      if (!wheelPagingAllowed(e)) return;

      var now = Date.now();
      if (now < wheelLockedUntil) { e.preventDefault(); return; }

      wheelAcc += e.deltaY;
      clearTimeout(wheelResetTimer);
      wheelResetTimer = setTimeout(function () { wheelAcc = 0; }, 140);

      if (Math.abs(wheelAcc) < WHEEL_STEP) {
        // 不足一格：吃掉事件，避免先动一小段再被拽回（那是"发抖"的来源）
        e.preventDefault();
        return;
      }

      var dir = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      // 锁时间略大于滚动动画（420ms），避免一次手势连翻几页
      wheelLockedUntil = now + 460;
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
      markTall();          // 内部会刷新位置缓存
      updateActive();
    }, 180);
  }

  /* ------------------------------------------------------ 首次翻页提示 */
  function initHint() {
    var el = $("pageHint");
    if (!el || UI.showHint === false) return;

    /* 减少动效时不提示：提示本身是"会动的引导"，
       而且这条路径不该依赖 CSS 的 display:none 兜底 ——
       类名加上去、只是看不见，会让状态和 DOM 不一致。 */
    if (reduced()) return;

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

    // 页面尺寸或内容变化时重算位置缓存
    observeSizes();

    initKeys();
    initWheel();
    initHint();
  }

  return {
    init: init,
    goTo: goTo,
    /* 暴露给自检使用：手动触发一次"归位"，便于验证自由滚动后的对齐逻辑 */
    snapNow: function () { snapToNearest(); },
    pages: function () { return pages.slice(); },
    activeIndex: function () { return activeIndex; },
    refresh: function () { markTall(); updateActive(); }
  };
})();
