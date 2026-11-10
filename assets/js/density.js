/* ==========================================================================
 *  density.js —— 视口密度分级（"缩到某个阈值就让位"的唯一决策处）
 * --------------------------------------------------------------------------
 *  要解决的事：
 *    桌面窗口可以被拖成任意尺寸。六屏里 Q1（头像 + 名片）、Q2（六首歌）、
 *    Q4（估价器 + 报价表）都是"内容比一屏多一点点"的类型，
 *    一旦窗口变矮就会溢出一截 —— 而 paged.js 只能把整站降级成可滚动，
 *    读者看到的是"卡片被切了一半"，很难看。
 *
 *  做法：
 *    按视口高度分四级，写进 <html data-vp="…">，再由 density.css 决定
 *    「这一级还留哪些装饰」。级别只跟视口有关，跟内容无关 ——
 *    所以它是稳定的、可预测的，不像 data-fit 那样一页一变。
 *
 *      full     h ≥ 780   全都要
 *      compact  h ≥ 660   去掉一言、同步时间（纯装饰）
 *      tight    h ≥ 560   折叠报价表、去掉章节导语、进度条
 *      mini     h < 560   再去掉简介、平台小图标行
 *
 *  和 data-fit 的分工（重要，否则又变成两套逻辑打架）：
 *    · data-vp   —— 全局、按视口，决定**留哪些元素**。只在跨级时变。
 *    · data-fit  —— 每屏、按"这屏装不装得下"，决定**留白收多紧**。页页不同。
 *    元素取舍只有一个出口（这里），留白松紧只有一个出口（fit.css）。
 *
 *  为什么不用纯 CSS 媒体查询：
 *    浏览器缩放（Ctrl +/-）与拖拽会连续触发媒体查询，元素频繁进出会闪。
 *    这里用 JS 统一判定 + 只在跨级时改一次属性，配合 CSS 过渡，变化才平滑。
 * ========================================================================== */

window.SITE_DENSITY = (function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  /* 分级阈值（px，视口高度）。
     数字来自实测：1440×900 下六屏余量都很宽（最紧的 Q4 余 57px）；
     1180×700 时 Q4 余 70px；到 1000×620 时 Q1 溢 23px、Q4 溢 171px。
     所以 780 / 660 / 560 这三条线分别对应"开始吃紧 / 明显吃紧 / 只能留骨架"。 */
  var LEVELS = [
    { id: "mini", min: 0 },
    { id: "tight", min: 560 },
    { id: "compact", min: 660 },
    { id: "full", min: 780 }
  ];

  var level = "";
  var root = document.documentElement;

  /* 判定"装得下"时的余量。
     ⚠️ 这个值直接决定报价表折不折。踩过两次：
       · 取 2px 时，scale 放大字号后有尺寸残留 3px 溢出（1250×880）；
       · 取 6px 时，1440×900 展开态实测 896px，距 900 只剩 4px，
         刚好被判成"装不下"，于是永远折不展 —— 那条断言直接失败。
     折中是 3px：能挡住 scale 带来的 3px 抖动，
     又不会把"只剩 4px 但确实装得下"的正例判成溢出。 */
  var SLACK = 3;

  /* 窄桌面的"等效高度"惩罚。
     为什么宽度也要算进来：同样 700px 高，1440 宽时正文一行放得下，
     760 宽时要折成两三行 —— 文字行数变多，可用高度就变少了。
     实测 1180×700 一切正常，而 860×700 的 Q4 溢出 83px、Q2 溢出 15px，
     两者的差别只在宽度。

     系数 0.5 是实测拟合的：
       860 宽 → 罚 70 → 等效 630 → tight（报价表折叠）✓
       760 宽 → 罚 120 → 等效 580 → tight ✓
       900 宽 → 罚 50 → 等效 650 → tight ✓
       1000 宽及以上 → 不罚（这个宽度下正文已经不会额外折行） */
  function effectiveHeight() {
    var h = window.innerHeight || 800;
    var w = window.innerWidth || 1200;
    if (w >= 1000) return h;
    return h - (1000 - w) * 0.5;
  }

  function compute() {
    var h = effectiveHeight();
    for (var i = LEVELS.length - 1; i >= 0; i--) {
      if (h >= LEVELS[i].min) return LEVELS[i].id;
    }
    return "mini";
  }

  /* 报价表在这一级是否该折叠。
     报价表是 Q4 里最大的单块（展开时 535px），矮窗口下它一张就吃掉整屏。
     比"整块删掉"更好的处理是折叠：标题行还在，读者知道有这份价目，
     想看就点开（点开后那一屏会变成可滚动，paged.js 自己会降级）。 */
  function quoteFolded() {
    return level === "tight" || level === "mini";
  }

  /* ---------------------------------------------------------- 曲目数自适应
     第二屏的曲目数是 render.js 的 trackCap() 按视口倒推的，用的是几个
     实测常数（页头 + 卡片内边距 + 页脚 ≈ 350px，行高 ≈ 84px）。
     问题是这些常数在 1 列 / 2 列 / 3 列下并不一样：列数变了，
     页头文字换行数变了，可用宽度也变了 —— 常数一旦不准，就会溢出一截。

     与其把常数调到"对大多数情况都对"，不如直接量：
     溢出就减一首，减到装下或减到下限为止。这样不管将来怎么改内边距、
     改字号、改行数，这一屏都不会把整站拖下水。 */
  function fitListen() {
    var page = $("listen");
    var list = $("trackList");
    if (!page || !list) return;
    if (!window.SITE_RENDER || typeof window.SITE_RENDER.setTracks !== "function") return;
    if (!window.SITE_SYNC || typeof window.SITE_SYNC.currentTracks !== "function") return;

    var all = window.SITE_SYNC.currentTracks();
    if (!all || !all.length) return;

    var MIN = 3;                     // 少于三首就不像"排行"了
    var want = Math.min(C_limit(), all.length);
    for (var n = want; n >= MIN; n--) {
      window.SITE_RENDER.setTracks(all.slice(0, n), "live");
      /* 留 8px 余量：字体亚像素累积 + 唱片底纹溢出 + scale 放大字号，
         三者叠加会让"刚好 100vh"的页面实际多出 1~6px
         （实测 810×640 残留 4px、810×680 残留 6px）。
         宁可少放一首，也不要让这一屏把整站拖成可滚动。 */
      if (measure(page) <= window.innerHeight - 8) return;
      if (n === MIN) return;         // 到下限还装不下，交给 paged 标 data-tall
    }
  }

  /* 量「内容自然高度」。
     ⚠️ paged 模式下每屏都有 min-height:100vh，直接读 offsetHeight 永远是
     一屏高 —— 用它判断"装不装得下"会永远得出"装得下"，自适应等于没做。
     所以临时把 min-height 去掉再量。这段逻辑和 paged.naturalHeight 是同一件事，
     优先借它的实现，避免两处算法漂移（自检里有断言保证两者一致）。 */
  function measure(el) {
    if (window.SITE_PAGED && typeof window.SITE_PAGED.naturalHeight === "function") {
      return window.SITE_PAGED.naturalHeight(el);
    }
    var prevMin = el.style.minHeight;
    var prevAlign = el.style.alignItems;
    el.style.minHeight = "0";
    el.style.alignItems = "flex-start";
    var h = el.offsetHeight;
    el.style.minHeight = prevMin;
    el.style.alignItems = prevAlign;
    return h;
  }

  function C_limit() {
    var C = window.SITE_CONFIG || {};
    return (C.listen && C.listen.limit) || 6;
  }

  /* ------------------------------------------------- 第四屏：报价表兜底折叠
     级别阈值只是"大多数情况下够用"的估计。真正可靠的判据是量出来：
     报价表展开后装不下，就折叠它 —— 不管当前是第几级。

     为什么需要这道兜底：实测 920×720 处在 compact 级（阈值说还不用折），
     但报价表一张 535px，展开时 Q4 溢出 66px。阈值再细分也只是拿更多
     魔数去逼近，不如直接量。这条不会和阈值打架：
       · 阈值说该折（tight/mini）→ repair.foldQuote() 已经折了，这里 return
       · 阈值说不折、但量出来装不下 → 这里折
       · 阈值说不折、量出来也装得下 → 保持展开
     折叠后不会自动弹回，所以没有"折了又开、开了又折"的振荡。 */
  /* 双向：装不下就折，装得下且"本轮没被折过"就展开。
     ⚠️ 早先只做"折"这一半，结果放大回去报价表再也展不开 ——
     verify-density 的"放大后报价表重新展开"直接失败。
     单向逻辑看着安全，实际破坏的是"收放可逆"这条最基本的期望。

     为什么不会振荡：展开后如果又装不下，下一轮会再折；
     但折/展之间的高度差远大于 6px 的余量，所以不会来回摆。 */
  /* 预估"报价表展开后 Q4 会有多高" —— 不用真实测量，避开过渡干扰。
     ⚠️ 这一版之所以改成"算"而不是"量"，是被过渡坑了三次：
       · max-height 过渡期间量到的 Q4 高度是中间值，"装得下"会被误判；
       · 强制回流也救不了 —— 过渡是动画，回流只会拿到当前帧的值；
       · 加两层 rAF 还不够，因为过渡 300ms 比两帧长得多。
     而这些值其实都能直接读出来：Q4 内容高度（不含过渡属性）＋
     报价表展开时比折叠多出来的那部分（= .quote__body 的高度）。
     两者都是静态布局量，任何时刻读都准确。 */
  /* 报价表要不要折叠？—— 只看一个加法，不做估算也不再反复测量。
     ⚠️ 这里前后绕了四轮弯路，最后靠"换个主人"解决，值得记下来：
       1) 直接量 Q4 的 offsetHeight 判断 —— 受 max-height 过渡影响，
          过渡期间读到中间值，判断随机漂移。
       2) 加两次 rAF 等过渡结束 —— 不够，过渡 300ms 比两帧长。
       3) 让 density 数 .quote__item 的行数乘一个估算行高 ——
          这是最糟的一版：估算值必须恰好落在"偏大"和"偏小"之间。
          偏大 → 大屏也判装不下，表再也展不开；
          偏小 → 矮屏保持展开，溢出 75px。实测两个方向都踩到了，
          调常数只是在这两种错误之间来回摆。
       4) 现在的做法：**谁来量、谁来算，职责分开**。
          · repair 在"展开的那一刻"量一次真实高度并缓存（那时它当然是可见的）；
          · density 只做一道加法：折叠态页高 + 缓存的展开增量 ≤ 视口？
          两个数都是确定的，没有估算，也没有过渡干扰。

     这条分工的判据很简单：谁生成那段 DOM，谁就该负责它的度量。
     报价表是 repair 生成的，所以"它展开有多高"只有 repair 说了算。 */
  function fitQuote() {
    var d = $("quoteDetails");
    var page = $("repair");
    if (!d || !page) return;
    if (!window.SITE_REPAIR || typeof window.SITE_REPAIR.quoteDelta !== "function") return;

    /* 算"折叠态的内容需要多少高度"。
       ⚠️ 不能用页高（offsetHeight / section 的 rect）——
       paged 模式下每屏都撑到 100vh，页高恒等于视口高，
       再叠加展开增量必然超预算，于是大屏也会被判成"装不下"
       （实测 1440×900 的报价表被折了）。
       内容高度 + 页面内边距才是真实需求：内容 614 + 内边距 138 = 752。 */
    var pcs = getComputedStyle(page);
    var padY = parseFloat(pcs.paddingTop) + parseFloat(pcs.paddingBottom);
    var inner = page.querySelector(".container") || page;
    /* 若此刻是展开态，先减掉展开增量，还原成"折叠态需求" */
    var nowH = inner.getBoundingClientRect().height + padY;
    var foldH = nowH - (d.open ? window.SITE_REPAIR.quoteDelta() : 0);

    var delta = window.SITE_REPAIR.quoteDelta();
    var openH = foldH + delta;

    /* 留 4px 余量：避免卡在边界上反复折展。 */
    var budget = window.innerHeight - 4;
    if (openH > budget) {
      if (d.open) d.removeAttribute("open");
    } else {
      if (!d.open) d.setAttribute("open", "");
    }
  }

  /* ------------------------------------------------------------------ 应用 */
  function apply(next) {
    if (next === level) return false;
    var prev = level;
    level = next;

    /* 过渡期间允许元素"长出来 / 收回去"，而不是啪一下消失。
       density.css 里所有可收起元素都带 max-height + opacity 过渡。 */
    root.dataset.vp = level;

    /* 报价表：**不要**在这里调 repair.foldQuote()。
       ⚠️ 它按"阈值 + 手机宽度"直接重设 open，会把 fitQuote 的双向判断覆盖掉 ——
       实测放大回 1440×900 后 level 已经是 full，但 foldQuote 一跑就把表重新折上，
       于是"放大后报价表重新展开"永远失败。
       现在的分工是：foldQuote 只在初始化时给一个初值，
       之后的开合全由 fitQuote 按"装不装得下"决定（它是内容驱动的，更准）。 */

    /* 顺序很讲究：
         1) paged 先按新级别重算一次档位（改内边距/间隙）——
            不然下面 fitListen 量到的是旧内边距，会多留一首歌。
         2) 再决定放几首。
         3) 曲目数变了高度也变了，让 paged 再量一次。
       实测漏掉第 1 步时，800×640 会残留 3px 溢出。 */
    if (window.SITE_PAGED && window.SITE_PAGED.refresh) window.SITE_PAGED.refresh();

    /* 报价表要"先按新档位重算一次，再决定折展"。
       档位会改内边距，进而改 Q4 高度 —— 顺序反了会用旧尺寸判断。
       这里做两轮：第一轮让档位跟上，第二轮在稳定尺寸上收口。 */
    fitQuote();
    fitListen();
    if (window.SITE_PAGED && window.SITE_PAGED.refresh) window.SITE_PAGED.refresh();
    fitQuote();
    /* 展开态改变了 Q4 高度，再让 paged 定一次档 */
    if (window.SITE_PAGED && window.SITE_PAGED.refresh) window.SITE_PAGED.refresh();
    fitQuote();

    try {
      document.dispatchEvent(new CustomEvent("site:density", {
        detail: { level: level, prev: prev }
      }));
    } catch (e) { /* 老浏览器忽略 */ }

    return true;
  }

  function refresh() {
    var next = compute();
    /* 即使是同一级，曲目数与报价表开合也可能需要重算
       （宽度变了、字号变了、列数变了，但级别没跨） */
    if (next === level) {
      if (window.SITE_PAGED && window.SITE_PAGED.refresh) window.SITE_PAGED.refresh();
      fitQuote();
      fitListen();
      if (window.SITE_PAGED && window.SITE_PAGED.refresh) window.SITE_PAGED.refresh();
      return false;
    }
    return apply(next);
  }

  /* ---------------------------------------------------------- 收敛（关键）
     拖动结束后的最终校正是这道：等收起过渡（.3s）走完再量一次。
     为什么必须有：过渡进行中 max-height 是中间值，那期间量的高度偏小，
     "放几首 / 折不折"会判得偏乐观。实测 810×640 残留 4px 溢出就是这么来的。
     这个 pass 只做"往下减"，不会把已经收起的又打开，所以不会振荡。 */
  function settle() {
    var refresh = function () {
      if (window.SITE_PAGED && window.SITE_PAGED.refresh) window.SITE_PAGED.refresh();
    };
    refresh();
    /* 再读一次级别：从 tight 放大回 full 时，refresh() 已经被 paged 的
       落点修正触发过一次，但那次可能还在 data-resizing 期间（过渡没走完）。
       这里在"停手且过渡结束"之后重算一次，报价表才拿得到真实高度。 */
    var next = compute();
    if (next !== level) { apply(next); return; }

    /* 夹在两次 rAF 之后再做一轮"定档 → 折展"。
       此时收起过渡（.3s）已经走完、data-resizing 也已摘掉，
       量到的是最终高度。早先只在同步段里调 fitQuote ——
       而那时 .container 上还挂着过渡，max-height 停在中间值，
       量出来的 Q4 比真实值小，于是"装得下"被误判，
       报价表在矮窗口里也保持展开（实测 1100×580 展着、溢出）。
       三层嵌套是有意的：同步 → rAF → rAF，分别对应
       "立即跟上" / "布局稳定" / "过渡结束"。 */
    var pass = function () {
      refresh();
      fitQuote();
      fitListen();
      refresh();
      fitQuote();
    };
    pass();
    requestAnimationFrame(function () {
      requestAnimationFrame(pass);
    });

    /* 再复检一次。
       有些高度不只在 resize 时变：懒加载的游戏图标落位、字体换行数变化，
       都会让某一屏在测量之后又长高几像素（实测 810×760 的 gaming 差 4px，
       而那时 roamy 档已经定下来了，没人再回头改）。
       这一次不重算级别，只让 paged 重新定档 —— 它自己会往下试更紧的档。 */
    setTimeout(refresh, 300);
  }

  /* 尺寸变化：paged.js 的 onResize 已经做了节流与收尾，
     这里只需跟上它的节奏，不必自己再防抖一遍。 */
  var timer = null;
  var settleTimer = null;
  function onResize() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
    /* 560ms = paged 的收尾（240ms）+ 收起过渡（300ms）+ 余量。
       早先给 420ms，正好卡在过渡刚结束那一刻，量到的还是中间值 ——
       实测 810×640 残留 3px 溢出。
       两个定时器并存是有意的：120ms 那次负责"拖动过程中就跟上"，
       560ms 那次负责"停手之后收口"。 */
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 560);
  }

  function init() {
    apply(compute());
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    /* 字体晚到会改变换行数，进而改变第二屏所需高度 */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        fitListen();
        if (window.SITE_PAGED && window.SITE_PAGED.refresh) window.SITE_PAGED.refresh();
      }).catch(function () {});
    }
  }

  return {
    init: init,
    refresh: refresh,
    level: function () { return level; },
    quoteFolded: quoteFolded,
    fitListen: fitListen,
    fitQuote: fitQuote,
    LEVELS: LEVELS
  };
})();
