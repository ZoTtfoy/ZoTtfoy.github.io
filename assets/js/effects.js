/* ==========================================================================
 *  effects.js —— 指针与触控光效
 * --------------------------------------------------------------------------
 *  三件事，互相独立：
 *    1. 全局追光：一团很淡的光缓动跟随鼠标，制造「有光源」的感觉
 *    2. 卡片光斑：指针在卡片内时，光落在指针所在位置（不是固定居中）
 *    3. 触控涟漪：手指按下处扩散一圈，给触屏一个即时反馈
 *
 *  性能与克制：
 *    · 所有指针事件都是 passive + requestAnimationFrame 节流
 *    · 追光与光斑只在「有精确指针」的设备上启用，触屏不跑
 *    · 系统开启「减少动态效果」或 ui.lightEffects = false 时整层关闭
 * ========================================================================== */

window.SITE_EFFECTS = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};
  var UI = C.ui || {};
  var reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  var enabled = false;
  var spotlight = null;
  var rafId = null;
  var tx = 0, ty = 0, cx = 0, cy = 0;
  var visible = false;

  function reduced() { return reduceQuery.matches; }
  function on() { return enabled && !reduced() && UI.lightEffects !== false; }

  /* ------------------------------------------------------------- 全局追光 */
  function initSpotlight() {
    spotlight = document.getElementById("spotlight");
    if (!spotlight) return;
    if (!finePointer.matches) return;

    var first = true;

    function loop() {
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      spotlight.style.transform =
        "translate3d(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px,0)";

      if (Math.abs(tx - cx) > 0.4 || Math.abs(ty - cy) > 0.4) {
        rafId = requestAnimationFrame(loop);
      } else {
        rafId = null;
      }
    }

    window.addEventListener("pointermove", function (e) {
      if (!on()) return;
      if (e.pointerType && e.pointerType !== "mouse") return;

      tx = e.clientX;
      ty = e.clientY;

      if (first) {
        // 第一次出现时直接定位，避免从左上角飞过来
        cx = tx; cy = ty;
        first = false;
      }
      if (!visible) {
        visible = true;
        spotlight.classList.add("is-on");
      }
      if (!rafId) rafId = requestAnimationFrame(loop);
    }, { passive: true });

    // 指针离开窗口就熄灭，别留一团光挂在角落
    document.addEventListener("pointerleave", function () {
      visible = false;
      spotlight.classList.remove("is-on");
    });
    window.addEventListener("blur", function () {
      visible = false;
      spotlight.classList.remove("is-on");
    });
  }

  /* --------------------------------------------------------- 卡片跟随光斑 */
  var GLOW_TARGETS = ".card, .interest, .social, .contact, .about__side";
  var glowRaf = null;
  var pendingGlow = null;

  function applyGlow() {
    glowRaf = null;
    if (!pendingGlow) return;
    var el = pendingGlow.el, x = pendingGlow.x, y = pendingGlow.y, rect = pendingGlow.rect;
    pendingGlow = null;

    el.style.setProperty("--mx", (x - rect.left).toFixed(0) + "px");
    el.style.setProperty("--my", (y - rect.top).toFixed(0) + "px");
  }

  function initCardGlow() {
    if (!finePointer.matches) return;

    document.addEventListener("pointermove", function (e) {
      if (!on()) return;
      if (e.pointerType && e.pointerType !== "mouse") return;

      var el = e.target.closest ? e.target.closest(GLOW_TARGETS) : null;
      if (!el) return;

      var rect = el.getBoundingClientRect();
      pendingGlow = { el: el, x: e.clientX, y: e.clientY, rect: rect };
      if (!glowRaf) glowRaf = requestAnimationFrame(applyGlow);
    }, { passive: true });
  }

  /* ------------------------------------------------------------ 触控涟漪 */
  function spawnRipple(x, y) {
    var el = document.createElement("span");
    el.className = "tap-ripple";
    el.style.left = x + "px";
    el.style.top = y + "px";
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 700);
  }

  function initRipple() {
    document.addEventListener("pointerdown", function (e) {
      if (!on()) return;
      // 鼠标点按交给 hover / :active，不额外画圈
      if (e.pointerType === "mouse") return;
      spawnRipple(e.clientX, e.clientY);
    }, { passive: true });
  }

  /* ---------------------------------------------------------------- 初始化 */
  function init() {
    enabled = UI.lightEffects !== false;
    document.documentElement.dataset.effects = enabled ? "on" : "off";
    if (!enabled) return;

    if (reduced()) return;

    initSpotlight();
    initCardGlow();
    initRipple();

    // 系统开关变化时整体启停
    var sync = function () {
      document.documentElement.dataset.effects =
        (enabled && !reduced()) ? "on" : "off";
      if (spotlight && reduced()) spotlight.classList.remove("is-on");
    };
    if (reduceQuery.addEventListener) reduceQuery.addEventListener("change", sync);
    else if (reduceQuery.addListener) reduceQuery.addListener(sync);
  }

  return { init: init };
})();
