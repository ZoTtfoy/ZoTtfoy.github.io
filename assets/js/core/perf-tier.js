/* ==========================================================================
 *  perf-tier.js —— 设备档位判断（只看实测帧表现，不猜硬件）
 * --------------------------------------------------------------------------
 *  背景那两面滚动封面墙是整站最贵的东西（12 个合成层 + 12 条无限动画）。
 *  它在跑得动的机器上是"氛围"，在跑不动的机器上就是"发烫 + 掉电"。
 *
 *  结论写到 <html> 上：
 *      data-perf="low" | "high"
 *      data-wall="static"        ← 判低：墙保留同一张预渲染图，但不滚动
 *
 *  ⚠️ 2026-11-13 改版：**判据只有页面跑起来之后的实测帧表现**，两项 ——
 *
 *    · 渲染时间：采样窗口内的平均帧间隔 avgMs
 *    · 帧数：窗口实际交付的帧数，以及其中「慢帧（>20ms）」的数量/占比
 *
 *  两轮采样都超标才判 low：一次冷启动或机器临时忙，不该把用户误伤成低端机。
 *
 *  刻意**不**再看 hardwareConcurrency / deviceMemory / effectiveType / UA /
 *  saveData。核心数猜不准（4 核旗舰与 8 核低端都存在），网络慢也不等于渲染慢；
 *  「能不能扛住背景运算」这件事，只有帧说了算。
 *
 *  两个旁路开关（都不属于「低端判定」）：
 *    · prefers-reduced-motion —— 系统无障碍偏好，直接静态降级
 *    · ?perf=low | ?perf=high —— 真机排查 / 自检强制，跳过采样
 *    · ?perf=auto —— 在自动化环境里也强制走一次真实采样（自检用）
 *
 *  ⚠️ 判低的后果必须只是"少动效"，不能少内容 —— 墙的图还在，只是不动。
 *  ⚠️ 采样结论可能比墙的 init 晚（load 后约 2.6s），所以这里提供 onChange()：
 *     墙模块订阅它，收到降级立刻停动画；CSS 的 data-wall 规则同时兜底。
 * ========================================================================== */

window.SITE_PERF = (function () {
  "use strict";

  var root = document.documentElement;
  var listeners = [];
  var rounds = [];                 // 已完成的采样结果
  var low = false;
  var reasons = [];
  var forced = null;
  var reducedMotion = false;
  var sampled = false;             // 是否已出实测结论
  var scheduled = false;

  /* ---- 采样参数 ----
     60fps 预算 16.67ms；无头/高刷屏会更快，不影响判定方向。
     AVG_LIMIT 22ms ≈ 45fps，SLOW_RATIO .30 ≈ 三成帧掉出 20ms。
     MIN_FRAMES 12：连样本都凑不齐，说明 rAF 本身已被掐到 15fps 以下。 */
  var WINDOW_MS = 800;
  var ROUND_GAP_MS = 120;
  var START_DELAY_MS = 900;        // 从 load 起，避开首屏冷启动
  var ROUNDS = 2;
  var SLOW_MS = 20;
  var AVG_LIMIT_MS = 22;
  var SLOW_RATIO_LIMIT = 0.30;
  var MIN_FRAMES = 12;

  /* 强制档位：给真机排查与自检用 */
  try {
    var m = /[?&]perf=(low|high|auto)\b/.exec(location.search);
    if (m) forced = m[1];
  } catch (e) { /* 无 location 的环境（自检桩）忽略 */ }

  try {
    reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e2) { /* 老浏览器 */ }

  /* 自动化环境（Playwright / CDP）里 navigator.webdriver 为 true，而它的帧率是
     **软件栅格化**的结果，不代表任何真实设备：实测 24ms/帧会把每次自检都判成
     low，墙全停，于是所有"墙在滚动"的行为校验一起变红，也测不出真机表现。
     所以 webdriver 下默认跳过自动采样、保持 high；想验证采样链路本身，
     用 ?perf=auto 显式强制（tools/verify-perf-tier.js 就是这么做的）。 */
  var automated = false;
  try { automated = !!(window.navigator && window.navigator.webdriver); } catch (eNav) {}

  /* ------------------------------------------------------------ 档位落盘 */
  function emit() {
    try {
      document.dispatchEvent(new CustomEvent("site:perf", {
        detail: { low: low, reasons: reasons.slice(), metrics: rounds.slice() }
      }));
    } catch (e) { /* 不支持 CustomEvent 的老浏览器，订阅回调照样走 */ }
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](low); } catch (e2) { /* 一个订阅者出错不影响其他 */ }
    }
  }

  function apply(next, why) {
    var changed = next !== low;
    low = next;
    reasons = why.slice();
    root.setAttribute("data-perf", low ? "low" : "high");
    if (low) root.setAttribute("data-wall", "static");
    else root.removeAttribute("data-wall");
    if (changed) emit();
  }

  /* ------------------------------------------------------------ 帧采样 */
  function isBad(m) {
    return m.frames < MIN_FRAMES
        || m.avgMs > AVG_LIMIT_MS
        || m.slowRatio > SLOW_RATIO_LIMIT;
  }

  /* 采一个窗口。回调参数 m 是实测结果；页面被切到后台时回 null，这一轮不算。 */
  function sampleRound(done) {
    var first = 0, prev = 0, frames = 0, slow = 0;
    function tick(t) {
      if (document.hidden) { done(null); return; }
      if (!first) { first = t; prev = t; requestAnimationFrame(tick); return; }
      var dt = t - prev;
      prev = t;
      frames++;
      if (dt > SLOW_MS) slow++;
      if (t - first < WINDOW_MS) { requestAnimationFrame(tick); return; }
      var elapsed = t - first;
      done({
        ms: Math.round(elapsed),
        frames: frames,
        slow: slow,
        slowRatio: +(slow / Math.max(1, frames)).toFixed(2),
        avgMs: +(elapsed / Math.max(1, frames)).toFixed(1)
      });
    }
    requestAnimationFrame(tick);
  }

  function finish() {
    sampled = true;
    var line = rounds.map(function (r) {
      return r.avgMs + "ms/帧·慢帧 " + r.slow + "/" + r.frames;
    }).join("，");
    var bad = rounds.every(isBad);
    /* 档位没变时不 emit —— 没必要为了"实测达标"去重启一次已经跑着的墙动画 */
    apply(bad, ["实测 " + line]);
  }

  function runRounds() {
    if (sampled || (forced === "low" || forced === "high") || reducedMotion || document.hidden) return;
    rounds = [];
    function next(m) {
      if (!m) { schedule(); return; }   // 中途被切后台，整轮重排
      rounds.push(m);
      if (rounds.length < ROUNDS) {
        setTimeout(function () { sampleRound(next); }, ROUND_GAP_MS);
        return;
      }
      finish();
    }
    sampleRound(next);
  }

  function schedule() {
    if (scheduled || sampled || (forced === "low" || forced === "high") || reducedMotion || document.hidden) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      runRounds();
    }, START_DELAY_MS);
  }

  /* ------------------------------------------------------------ 启动 */
  if (forced === "low" || forced === "high") {
    apply(forced === "low", ["强制 ?perf=" + forced]);
  } else if (reducedMotion) {
    apply(true, ["系统减少动效偏好"]);
  } else {
    apply(false, []);               // 先按 high 起步，实测后再决定要不要降
    if (!automated || forced === "auto") {
      if (document.readyState === "complete") schedule();
      else window.addEventListener("load", schedule);
      /* 后台标签页加载完不会触发 load/采样；回到前台时补一次 */
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) schedule();
      });
    }
  }

  return {
    forced: forced,
    low: function () { return low; },
    /* 墙要不要动：一处判断，两面墙共用 */
    staticWall: function () { return low; },
    reasons: function () { return reasons.slice(); },
    /* 排查用：两轮实测的原始数据 */
    metrics: function () { return rounds.slice(); },
    /* 墙模块订阅「运行中降级/升级」；注册时若结论已出，不回溯调用 */
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    /* 排查用：手动重测一轮 */
    measure: function () {
      rounds = [];
      sampled = false;
      schedule();
    },
    summary: function () {
      if (forced === "low" || forced === "high")
        return (low ? "low" : "high") + "（强制 ?perf=" + forced + "）";
      if (reducedMotion) return "low（系统减少动效偏好）";
      if (automated && forced !== "auto" && !sampled)
        return "high（自动化环境，跳过实测）";
      if (!sampled) return "high（待实测）";
      return (low ? "low" : "high") + "（" + reasons[0] + "）";
    }
  };
})();
