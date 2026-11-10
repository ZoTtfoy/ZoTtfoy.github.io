/* ==========================================================================
 *  readability.js —— 可读性兜底（把"太小"的字抬到下限）
 * --------------------------------------------------------------------------
 *  为什么需要它：
 *    scale.js 会按可用空间等比缩放整个界面（改 <html> 的 font-size）。
 *    缩到最小时（0.82），全站那三十多个 .6~.72rem 的辅助文字会掉到 8~10px ——
 *    实测踩到的：quote__count、eyebrow、track__idx、calc__label i、
 *    preview__platform、hero__quote__from、profile__greet …
 *
 *    逐个去 CSS 里抬字号并不收敛：补一个冒一个，因为它们散在五个文件里，
 *    而且还会被 fit.css 里更高特异性的规则覆盖（`.preview-pair .preview__platform`
 *    就把单类选择器的 max() 压回去了）。维护一份"哪些选择器太小"的清单，
 *    等于把一件可以自动化的判断手工化了。
 *
 *  做法：
 *    量 → 谁低于下限就抬谁 → 记下原文（rem 值）→ 下次重新算。
 *    只处理"叶子文字元素"（没有子元素、有可见文字），
 *    容器不动 —— 动容器的字号会连带影响所有子元素，一次改动放大成一片。
 *
 *  ⚠️ 只抬不压：
 *      这是兜底，不是设计。正常尺寸下它什么都不做（清单为空），
 *      只有缩放到极小、某处跌破下限时才介入。
 *  ⚠️ 幂等：
 *      被抬过的元素记住原始值（data-fs-base），尺寸变大时能还原，
 *      否则一次次累积抬升会把小字变成大字。
 * ========================================================================== */

window.SITE_READABLE = (function () {
  "use strict";

  /* 下限：10.5px。
     依据是 verify-devices 里"辅助信息 ≥ 11px"的标准 ——
     允许 0.5px 误差是因为浏览器会把 rem 算成小数值（9.92px 这种），
     硬卡 11 会把"10.96px"这类正常值也判成不合格，反而制造噪音。 */
  var MIN = 10.5;

  /* 只挑这些"承载信息"的标签；装饰性元素（分隔点、箭头）不看 */
  var SKIP = /^(SCRIPT|STYLE|SVG|PATH|CIRCLE|RECT|LINE|POLYGON|G)$/;

  var raised = [];        // 本次被抬高的元素，自检用
  var pending = false;

  function isVisible(el) {
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (+cs.opacity === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* 取一个元素"本来的"字号。
     优先用记下的基线（data-fs-base），否则用当前 computed 值。
     这样反复调用不会累积抬升。 */
  function baseSize(el, cs) {
    var b = el.dataset.fsBase;
    if (b) return parseFloat(b);
    return parseFloat(cs.fontSize);
  }

  function repair() {
    var out = [];

    /* 只查文本叶子节点。
       TreeWalker 比 querySelectorAll('*') 快得多，也不会把
       svg 里的一堆 path 都算进来。 */
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null
    );

    var el = walker.currentNode;
    while (el) {
      if (!SKIP.test(el.tagName) && !el.children.length) {
        var txt = el.textContent && el.textContent.trim();
        if (txt && isVisible(el)) {
          var cs = getComputedStyle(el);
          var base = baseSize(el, cs);
          var now = parseFloat(cs.fontSize);

          if (base >= MIN) {
            /* 本来就够大：如果之前被抬过，还原 */
            if (el.dataset.fsRaised) {
              el.style.fontSize = "";
              delete el.dataset.fsRaised;
              delete el.dataset.fsBase;
            }
          } else if (now < MIN - 0.05) {
            /* 太小：记下基线再抬到下限 */
            if (!el.dataset.fsBase) el.dataset.fsBase = String(base);
            el.style.fontSize = MIN + "px";
            el.dataset.fsRaised = "1";
            out.push({
              el: (typeof el.className === "string" && el.className.split(" ")[0]) || el.tagName.toLowerCase(),
              from: +base.toFixed(2),
              to: MIN
            });
          }
        }
      }
      el = walker.nextNode();
    }

    raised = out;
    return out.length;
  }

  /* 尺寸变了 → 根字号也变了 → 需要重算。
     防抖是因为 repair 会强制读所有叶子元素的 computed style，
     连续拖动时每帧都跑代价不小（几百次样式读取）。 */
  var timer = null;
  function schedule(delay) {
    if (pending) return;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(function () {
      pending = false;
      /* 先让 scale 更新根字号，再判断谁太小 —— 顺序反了会用旧基准判断 */
      if (window.SITE_SCALE && window.SITE_SCALE.refresh) window.SITE_SCALE.refresh();
      var n = repair();
      /* 抬高字号会改变换行数、进而改变每屏高度：必须让翻页引擎重算。
         不做这一步的话，960×1080 这种尺寸下第二屏会多出几像素溢出。 */
      if (n > 0 && window.SITE_PAGED && window.SITE_PAGED.refresh) {
        window.SITE_PAGED.refresh();
      }
    }, delay == null ? 260 : delay);
  }

  /* 监听 DOM 变化：曲目列表、价目表、摘要统计都是 JS 重绘的（innerHTML），
     重绘后新节点没有内联字号 —— 兜底会"漏掉"它们。
     实测 track__idx 在极矮窗口下 8.9px，就是因为 setTracks 的 innerHTML
     在 repair 之后又跑了一遍。

     用 MutationObserver 而不是给每个渲染函数加回调：
     渲染入口有六七处，加回调容易漏，而 observer 只需要挂一次。
     节流 200ms，避免一次重绘几十个节点触发几十次扫描。 */
  function init() {
    repair();
    if (typeof MutationObserver === "function") {
      var mo = new MutationObserver(function () { schedule(200); });
      mo.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener("resize", function () { schedule(); }, { passive: true });
    window.addEventListener("orientationchange", function () { schedule(); }, { passive: true });
    /* 字体晚到会改变度量，落地后再校一次 */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { schedule(60); }).catch(function () {});
    }
    /* 内容异步到达（曲目、摘要统计）后也校一次 */
    document.addEventListener("site:density", function () { schedule(320); });
  }

  return {
    init: init,
    repair: repair,
    /* 自检用：看有哪些元素是被兜底救回来的 */
    raised: function () { return raised.slice(); },
    MIN: MIN
  };
})();
