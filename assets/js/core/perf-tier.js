/* ==========================================================================
 *  perf-tier.js —— 设备档位判断（一行代码决定"要不要给它上重效果"）
 * --------------------------------------------------------------------------
 *  背景那两面滚动封面墙是整站最贵的东西（12 个合成层 + 12 条无限动画）。
 *  它在旗舰机上是"氛围"，在低端机/省流量/省电模式下就是"发烫 + 掉电"。
 *
 *  所以这里先判一次档，把结论写到 <html> 上：
 *      data-perf="low" | "high"
 *      data-wall="static"        ← 低端：墙保留同一张预渲染图，但不滚动
 *
 *  判据（任一命中即 low）：
 *    · prefers-reduced-motion —— 用户明确要求减少动效
 *    · save-data              —— 用户开了省流量
 *    · hardwareConcurrency ≤ 4 —— 4 核及以下（中低端机常见）
 *    · deviceMemory ≤ 4        —— 4GB 及以下（仅 Chromium 有）
 *    · effectiveType 2g/3g     —— 网络本身很慢，先保内容
 *
 *  ⚠️ 刻意**不**用 UA 判断"是不是手机"：现在旗舰手机比很多老笔记本强，
 *     按设备类型一刀切会把好机器也降级。只按能力判。
 *  ⚠️ 判低的后果必须只是"少动效"，不能少内容 —— 墙的图还在，只是不动。
 *
 *  调试/自检：?perf=low 或 ?perf=high 可强制档位。
 * ========================================================================== */

window.SITE_PERF = (function () {
  "use strict";

  var root = document.documentElement;
  var nav = window.navigator || {};
  var conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
  var reasons = [];

  /* 强制档位：给真机排查与自检用 */
  var forced = null;
  try {
    var m = /[?&]perf=(low|high)\b/.exec(location.search);
    if (m) forced = m[1];
  } catch (e) { /* 无 location 的环境（自检桩）忽略 */ }

  if (forced !== "high") {
    var reduced = false;
    try {
      reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e2) { /* 老浏览器 */ }

    if (reduced) reasons.push("reduced-motion");
    if (conn.saveData === true) reasons.push("save-data");

    var cores = Number(nav.hardwareConcurrency) || 0;
    if (cores && cores <= 4) reasons.push("cores:" + cores);

    var mem = Number(nav.deviceMemory) || 0;
    if (mem && mem <= 4) reasons.push("memory:" + mem + "GB");

    var et = String(conn.effectiveType || "");
    if (et === "slow-2g" || et === "2g" || et === "3g") reasons.push("net:" + et);
  }

  var low = forced ? forced === "low" : reasons.length > 0;

  root.setAttribute("data-perf", low ? "low" : "high");
  /* 低端不滚动背景墙；高端什么都不加，CSS 的默认就是"会动" */
  if (low) root.setAttribute("data-wall", "static");
  else root.removeAttribute("data-wall");

  return {
    forced: forced,
    low: function () { return low; },
    /* 墙要不要动：一处判断，两面墙共用 */
    staticWall: function () { return low; },
    reasons: function () { return reasons.slice(); },
    /* 自检与排查用的一句话摘要 */
    summary: function () {
      return (low ? "low" : "high") + (reasons.length ? "（" + reasons.join(", ") + "）" : "");
    }
  };
})();
