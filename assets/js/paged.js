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

  /* 档位写在**每一屏自己身上**（.hero / .section），不再写在 <html> 上。
     为什么改成按屏分档：
       全站共用一个档位时，内容是「就高不就低」的 —— Q4（计算器 + 报价表）
       始终是最高的那一屏，它一装不下，Q1/Q5 这些只填了 40% 的屏也跟着降档，
       于是出现「屏幕上大半是空白，字和留白却被压得很紧」的怪现象。
       实测 390×844 的 Q1 内容只占 55%，却因为 Q4 超屏被判成 snug 档。
     改成按屏分档后，每屏各自拿到「自己能承受的最宽松档位」：
       Q1 → roomy，Q4 → snug/micro，互不牵连。 */
  function setFit(el, level) {
    if (!el) return false;
    /* 真实 DOM 走 dataset；自检脚本用的是轻量 DOM 桩（verify-paged 等），
       只实现了 getAttribute / setAttribute，没有 dataset，这里兜一下。 */
    var cur = el.dataset ? el.dataset.fit : el.getAttribute("data-fit");
    if (cur === level) return false;
    if (el.dataset) el.dataset.fit = level;
    else el.setAttribute("data-fit", level);
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

  /* 每屏各自从最宽松往下试，取第一个「这一屏装得下」的档位。
     都装不下就停在 micro，交给 countOverflow 标 data-tall（降级为可滚动）。 */
  function pickFit() {
    var vh = window.innerHeight;
    pages.forEach(function (p) {
      var chosen = FIT_STEPS[FIT_STEPS.length - 1];
      for (var i = 0; i < FIT_STEPS.length; i++) {
        setFit(p, FIT_STEPS[i]);
        /* 读一次 offsetHeight 强制浏览器把新档位的样式算完再量 */
        void p.offsetHeight;
        if (naturalHeight(p) <= vh + 1) { chosen = FIT_STEPS[i]; break; }
      }
      setFit(p, chosen);
    });
  }

  function markTall() {
    if (!enabled) return;
    var vh = window.innerHeight;

    /* 每次都从最宽松档重新试 —— 这样屏幕变大（或竖屏转横屏再转回）
       也能自动放宽，而不是一直卡在上一次的紧档。 */
    pages.forEach(function (p) { setFit(p, "roomy"); });
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
  function playEnter(page, force) {
    if (!page || reduced()) return false;

    /* 默认路径（停稳后补播）：只给「确实在视口里」且**还没露过面**的页播。
       已经露过面的页再播，等于把看得见的内容按回 opacity:0 重来一遍。 */
    if (!force) {
      if (page.getAttribute("data-entered")) return false;
      var rect = page.getBoundingClientRect();
      var vh = window.innerHeight || 800;
      if (rect.top > vh * 0.5 || rect.bottom < vh * 0.5) return false;
    }

    pages.forEach(function (p) { p.classList.remove("is-entering"); });
    void page.offsetHeight;                 // 强制回流，保证重复进入也能重播
    page.classList.add("is-entering");

    clearTimeout(enterTimer);
    /* 1150ms = 卡片那层的最长延时 .50s + 时长 .55s，留一点余量。
       早先写 920ms，是从"停稳后才加"的时机倒推的；现在动画提前开跑，
       920ms 会把最后几张卡片的淡入从中间掐断，留下一次生硬的跳变。 */
    enterTimer = setTimeout(function () {
      page.classList.remove("is-entering");
    }, 1150);
    return true;
  }

  /* ⚠️ 2026-11-10 修「翻页闪两下」：
     原先入场动画只在「滚动停稳 140ms 后」播。而平滑滚动本身要 700ms 左右，
     等它停稳时，目标页的内容早就随着滚动露出来了 ——
     @keyframes chapter-item 的 from{opacity:0} 又把它们按回去重播，
     屏幕上就是「内容亮了 → 整页变黑 → 再淡入」，实测在 866ms 处必然发生，
     且卡片上还叠着两层 chapter-item（轨道 + 卡片），暗得更明显。

     根治办法是让动画在**目标页还在视口外**时就开始：那一刻没人看得见
     它被藏起来，等它滑进屏幕时正好淡入，全程单调 0→1，不会有回跳。
     所以 goTo 在 scrollTo 之前就把 is-entering 加上（force = true）。
     手动滚轮 / 滑动进来的页不补播 —— 用户是自己把内容拖进来的，
     再给它来一次淡入只能制造同样的回跳；data-entered 会把这条路关掉。 */
  function enterOnNavigate(i) {
    var page = pages[i];
    if (!page || page.getAttribute("data-entered")) return;
    page.setAttribute("data-entered", "1");
    if (playEnter(page, true)) {
      lastAnimated = i;
      if (UI.lightEffects !== false && !reduced()) sweep();
    }
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
    /* 露过面就记下来：以后无论是谁把这一页滚进来，都不再补播入场动画。
       只有「从没露过面」的页才有资格在屏幕外偷偷藏一下再淡入。 */
    if (pages[i]) pages[i].setAttribute("data-entered", "1");
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
    /* 入场动画赶在 scrollTo 之前开跑：此时目标页还在屏幕外，
       藏起来没人看得见，滑进来的过程正好淡入（见 enterOnNavigate 的注释）。 */
    enterOnNavigate(i);
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

  /* ============================================================ 触摸翻页
     需求原话：「上滑不管距离全部视为一次上滑，两次间隔可以适量缩短但绝不为 0」。

     所以触摸和滚轮是**两套语义**：
       · 滚轮要攒够 40px 才算一格 —— 因为鼠标一格约 100，触控板会碎成小块
       · 触摸是「一次手势 = 一次翻页」，位移只用来判方向，不参与阈值

     但有四种情况必须排除，否则会误伤：
       1. 点击（位移 < 8px）—— 不然点「复制微信号」会连带翻走一页
       2. 横向手势（|dx| > |dy|）—— 留给以后可能出现的横滑组件
       3. 多指（双指缩放 / 三指）—— 那不是翻页
       4. 有高个页时（snap = proximity）—— 那页本来就该让用户自由滚

     锁间隔 SWIPE_LOCK = 300ms，**绝不为 0**。原因不是手感，是正确性：
       smooth 滚动有 400~500ms 动画期，期间 scrollTop 一直在变，
       而 activeIndex 要等滚动停稳（updateActive）才更新。若无锁：
         第一下 goTo(1) → 动画还在跑；
         第二下读到的 activeIndex 仍是 0 → 又 goTo(1)，看起来「滑了没反应」；
       更糟的情况是 activeIndex 已更新到 1，第二下就跳到 2 —— 第 1 页被整个跳过。
       所以锁的下限必须 >= 一次滚动动画的时长。

     为什么是 300 而不是 460（滚轮的锁）：手指抬起后人会立刻准备下一次滑动，
     比鼠标滚轮的节奏快得多。300ms 是「跟手」和「不跳页」的平衡点。
     reduced-motion 下滚动是瞬时的（smooth() 返回 auto），锁收到 160ms。 */
  var SWIPE_LOCK = 300;
  var swipeLockedUntil = 0;
  var swipeEnabled = true;      // 由 init 按 config 设置

  /* 面板打开时不接管触摸，否则用户在面板里滑不动 */
  function panelOpen() {
    var panels = ["skinPanel", "mobileNav", "publishSheet"];
    for (var i = 0; i < panels.length; i++) {
      var el = $(panels[i]);
      if (el && !el.hidden) return true;
    }
    return false;
  }

  function swipeAllowed() {
    if (!enabled || !swipeEnabled) return false;
    // 有高个页 / 自由滚动模式：让位给浏览器原生滚动
    if (document.documentElement.dataset.snap !== "mandatory") return false;
    if (panelOpen()) return false;
    return true;
  }

  function initSwipe() {
    var startX = 0, startY = 0;
    var tracking = false;    // 这一轮手势是否归我们管
    var decided = false;     // 是否已判定为竖向手势

    window.addEventListener("touchstart", function (e) {
      // 多指：直接放弃这一轮
      if (e.touches.length !== 1) { tracking = false; return; }
      if (!swipeAllowed()) { tracking = false; return; }
      var t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      decided = false;
    }, { passive: true });

    window.addEventListener("touchmove", function (e) {
      if (!tracking) return;
      if (e.touches.length !== 1) { tracking = false; return; }

      var t = e.touches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;

      if (!decided) {
        // 位移还太小，方向未定：先不动，继续观察
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        // 横向为主：交回浏览器（不 preventDefault，不翻页）
        if (Math.abs(dx) > Math.abs(dy)) { tracking = false; return; }
        decided = true;
      }

      /* 竖向手势：从第一次判定起就完全接管。
         必须在这里 preventDefault，而不是等 touchend 再纠正 ——
         一旦让浏览器先滚几像素再拉回来，会看到明显的「抖一下」。 */
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    function finish(e) {
      if (!tracking) return;
      tracking = false;
      if (!decided) return;      // 从没判定成竖向（点击 / 横向）

      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;

      var dx = t.clientX - startX;
      var dy = t.clientY - startY;

      // 位移过小视为点击，不翻页（否则点复制按钮会连带翻走）
      if (Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) return;

      var now = Date.now();
      if (now < swipeLockedUntil) return;

      swipeLockedUntil = now + (reduced() ? 160 : SWIPE_LOCK);
      // 上滑（dy < 0）→ 下一页；下滑 → 上一页
      goBy(dy < 0 ? 1 : -1);
    }

    window.addEventListener("touchend", finish, { passive: true });
    window.addEventListener("touchcancel", function () {
      tracking = false;
    }, { passive: true });
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
  /* ⚠️ 2026-11-10 重写 —— 拖拽/缩放窗口时的三个坑。
   *
   * 原先是「防抖 180ms 后重算一次」。问题在于：
   *   1. 拖动过程中那 180ms 一直被打断，于是**整段拖拽期间档位都停在旧值**，
   *      而视口已经变了 → 页面明显高于/矮于视口，看起来像"布局坏了"。
   *   2. 位置缓存 pageTops 也是旧的。此时点页码、按方向键，
   *      会滚到一个按旧尺寸算出来的偏移 —— 落点偏掉。
   *   3. 重算完只调 updateActive()，**没有把滚动位置重新对齐到当前页**。
   *      页高变了但 scrollY 没变，于是停在两页交界处，屏幕上同时露着上一页的尾声
   *      和下一页的开头 —— 这是"缩放后渲染不对"最直观的那一幕。
   *
   * 现在改成：
   *   · 过程中节流重算（每 120ms 一次），让档位跟着窗口走，而不是拖完才反应；
   *   · 停手 160ms 后做最后一次，并把滚动位置对齐回当前页顶部；
   *   · 拖动期间挂 html[data-resizing="on"]，CSS 里借它去掉页间那 14px 位移，
   *     避免每个像素的窗口变化都让六屏内容整体上下抖一下。
   */
  var resizeTimer = null;
  var resizeThrottle = 0;
  var resizeAnchor = -1;      // 开始拖拽时停在哪一页

  /* 把滚动位置钉回「开始缩放时那一页」的顶部。
     落点用**实际高度累加**算，不用 i × 视口高：
       paged 模式下每屏是 100vh，但一旦某页装不下（data-tall），
       它的高度就大于 100vh，后面所有页的偏移就都变了 ——
       而窗口变矮时恰恰最容易出现高个页（实测 1000×620 下 top 与 repair 都超高）。
       早先用 i × innerHeight 就是栽在这里：钉完偏 231px，正好是那一页超出的高度。
     为什么不读 pageTops 缓存：拖动过程中它至少落后一个节流周期，
     用旧值去滚等于滚到错的地方。现读 offsetHeight 一共 6 次，
     而这次 resize 本来就要强制回流十几次，这点开销不算什么。
     为什么用 auto 不用 smooth：这是"修正落点"，不是"翻页"，
     平滑滚动会让读者以为页面自己在动。 */
  /* 当前视口顶部落在哪一页的头部（用实际高度累加反推）。
     为什么不直接用 activeIndex：拖动过程中浏览器会自行调整 scrollY，
     scroll 事件随之把 activeIndex 改成邻居页或中间页 ——
     实测「停在末页 → 连续放大 → 落到了 repair」，就是因为锚点取到了那个漂移值。
     按"谁的顶部离 scrollY 最近"来判，才不受这些中间状态影响。 */
  function pageAtTop() {
    var y = window.scrollY || 0;
    var acc = 0, best = 0, bestD = Infinity;
    for (var i = 0; i < pages.length; i++) {
      var d = Math.abs(acc - y);
      if (d < bestD) { bestD = d; best = i; }
      acc += pages[i].offsetHeight;
    }
    return best;
  }

  function pinToActivePage(forceIndex) {
    var i = typeof forceIndex === "number" ? forceIndex
          : resizeAnchor >= 0 ? resizeAnchor : activeIndex;
    if (i < 0 || i >= pages.length) return;
    var y = 0;
    for (var k = 0; k < i; k++) y += pages[k].offsetHeight;
    if (Math.abs((window.scrollY || 0) - y) > 1) {
      window.scrollTo({ top: Math.max(0, y), behavior: "auto" });
    }
  }

  function onResize() {
    /* 位置缓存立刻作废：拖动中任何一次滚动/跳页都要用新尺寸算落点 */
    queueMeasure();

    if (document.documentElement.dataset.resizing !== "on") {
      document.documentElement.dataset.resizing = "on";
      /* 在第一次 resize 时锁定锚点：用 pageAtTop() 反推，而不是读 activeIndex。 */
      resizeAnchor = pageAtTop();
    }

    /* 落点修正每帧都做（一次 scrollTo，开销可忽略），
       档位重算才节流 —— markTall 会强制回流十几次，那个不能每帧跑。 */
    pinToActivePage();

    var now = Date.now();
    if (now - resizeThrottle > 120) {
      resizeThrottle = now;
      markTall();
      pinToActivePage();
    }

    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      /* 锚点要在整个收尾过程里一直有效。
         ⚠️ 早先这里先把 resizeAnchor 置 -1，再做尾帧修正 ——
         结果尾帧退回用 activeIndex，而那时它已被滚动事件改成了邻居页，
         实测从末页放大回去会落到 repair（第 4 页）。锚点必须活到最后一帧。 */
      var anchor = resizeAnchor;
      markTall();
      pinToActivePage(anchor);
      if (anchor >= 0) setActive(anchor);
      updateActive();
      document.documentElement.dataset.resizing = "off";

      /* 尾帧再钉两次。
         第一次钉完可能又变了一次版面 —— 典型是滚动条：内容从"装得下"变成
         "装不下"会让纵向滚动条出现，可用宽度少约 15px，文字重排、页高再变，
         于是刚才那个落点又偏了。实测在 1000×620 上残留 81px，就是这个原因。
         两次都在 rAF 里、都用固定的 anchor，不受中途滚动事件影响。 */
      requestAnimationFrame(function () {
        pinToActivePage(anchor);
        requestAnimationFrame(function () {
          pinToActivePage(anchor);
          if (anchor >= 0) setActive(anchor);
          resizeAnchor = -1;
        });
      });
    }, 240);
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

    swipeEnabled = UI.swipePaging !== false;
    initKeys();
    initWheel();
    initSwipe();
    initHint();
  }

  return {
    init: init,
    goTo: goTo,
    /* 暴露给自检使用：手动触发一次"归位"，便于验证自由滚动后的对齐逻辑 */
    snapNow: function () { snapToNearest(); },
    pages: function () { return pages.slice(); },
    activeIndex: function () { return activeIndex; },
    refresh: function () { markTall(); updateActive(); },
    /* 量"内容自然高度"（不受 min-height:100vh 影响）。
       density.js 需要它来判断第二屏装不装得下曲目 ——
       直接读 offsetHeight 永远是 100vh，那样的判断毫无意义。 */
    naturalHeight: naturalHeight,
    /* 自检用：读触摸翻页的锁状态，验证「间隔绝不为 0」 */
    swipeLock: function () { return { ms: reduced() ? 160 : SWIPE_LOCK, until: swipeLockedUntil }; }
  };
})();
