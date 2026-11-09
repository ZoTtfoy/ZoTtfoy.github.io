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

    /* 滚动期间停止跟随。
       追光是一个 460px 的半透明渐变层，每帧移动它都要合成器重新混合覆盖区域；
       滚动时合成器本来就在忙（内容位移 + 光晕层），两者叠加就掉帧
       （实测关掉追光掉帧 17 → 6）。
       滚动时人眼在追随内容，光斑停在原地完全看不出来；停手 180ms 后恢复跟随。 */
    var idleUntil = 0;
    function markBusy() {
      idleUntil = performance.now() + 180;
    }
    window.addEventListener("wheel", markBusy, { passive: true });
    window.addEventListener("touchmove", markBusy, { passive: true });
    window.addEventListener("scroll", markBusy, { passive: true });

    function loop() {
      // 滚动中：只更新目标值，不动 DOM，等停手后再一次性跟上去
      if (performance.now() < idleUntil) {
        rafId = requestAnimationFrame(loop);
        return;
      }

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
  /* 跟着 6 屏重构一起更新：旧结构里的 .card / .interest / .about__side / .contact
     已经不存在了（业务、喜好、关于三屏被删），换成了新组件。
     这里刻意**没有**加 .chip 和 .track —— 它们太小，光斑在 26px 的盒子里
     移动会像一只乱窜的亮点，反而廉价。 */
  var GLOW_TARGETS = ".social, .preview, .game, .calc, .mailbox";
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

    /* 缓存每个卡片的矩形，避免 pointermove 里做布局读取。
       另外一处关键优化：指针在卡片内移动时，矩形的变化只可能来自
       滚动或尺寸变化，纯水平/垂直移动不会改变它 —— 所以只在
       换了卡片、或滚动/尺寸变化后才重新测量。 */
    var rectCache = new WeakMap();
    var dirty = true;

    window.addEventListener("scroll", function () { dirty = true; }, { passive: true });
    window.addEventListener("resize", function () { dirty = true; }, { passive: true });

    document.addEventListener("pointermove", function (e) {
      if (!on()) return;
      if (e.pointerType && e.pointerType !== "mouse") return;

      var el = e.target.closest ? e.target.closest(GLOW_TARGETS) : null;
      if (!el) return;

      var rect = rectCache.get(el);
      if (!rect || dirty) {
        rect = el.getBoundingClientRect();
        rectCache.set(el, rect);
        dirty = false;
      }
      pendingGlow = { el: el, x: e.clientX, y: e.clientY, rect: rect };
      if (!glowRaf) glowRaf = requestAnimationFrame(applyGlow);
    }, { passive: true });
  }

  /* ---------------------------------------------------------- 拖拽光效
     桌面：按住拖动 → 聚光团跟随 + 细密拖尾
     触屏：手指按下 → 光团出现（做大并上移，因为指尖会遮住中心）
            → 拖动撒拖尾 → 抬手淡出

     为什么这样写：
     · 拖尾点用**对象池**（DOM 只创建一次，循环复用），避免移动时反复增删节点
     · 淡出用 Web Animations API，不切 class、不读 offsetWidth，
       所以没有强制回流 —— 早先试过 class + 读取宽度重启动画，每次撒点都触发一次布局
     · 一切只在按住期间运行，抬手立即停止；不影响滚动帧率（已用 verify-perf 守住）
     · 触屏与桌面的阈值不同：手指移动快且密集，撒点间隔要大得多，
       否则点会糊成一条粗线，反而看不出"拖尾" */

  var dragGlow = null;
  var trailBox = null;
  var dotPool = [];
  var dotCursor = 0;
  var POOL_SIZE = 20;

  var dragging = false;
  var dragKind = "mouse";
  var moveDist = 0;             // 按下后累计位移，判断是"点"还是"拖"
  var lastMove = { x: 0, y: 0 };
  var spawnAt = { x: 0, y: 0 };
  var smoothAt = { x: 0, y: 0 };
  var targetAt = { x: 0, y: 0 };
  var dragRaf = null;

  function buildTrail() {
    if (!trailBox || dotPool.length) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < POOL_SIZE; i++) {
      var d = document.createElement("span");
      d.className = "drag-trail__dot";
      frag.appendChild(d);
      dotPool.push(d);
    }
    trailBox.appendChild(frag);
  }

  /* 撒一个拖尾点。用 getAnimations 取消旧动画再重新起，
     比切 class 更干净（不会有一瞬间两个动画同时改 transform）。 */
  function spawnDot(x, y) {
    if (!dotPool.length) return;
    var dot = dotPool[dotCursor % POOL_SIZE];
    dotCursor++;

    // 取消该点上可能还在跑的旧动画
    if (dot.getAnimations) {
      var old = dot.getAnimations();
      for (var i = 0; i < old.length; i++) old[i].cancel();
    }

    dot.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)";

    if (dot.animate) {
      dot.animate([
        { opacity: 0.5, transform: dot.style.transform + " scale(1)" },
        { opacity: 0, transform: dot.style.transform + " scale(.32)" }
      ], { duration: 520, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
    } else {
      dot.style.opacity = "0";
    }
  }

  /* 光团平滑跟随。触屏用更高的跟随系数：
     滞后感在手指上会变成"光跑偏了"，而鼠标有光标本身作参照，慢一点更柔。 */
  function dragLoop() {
    dragRaf = null;
    if (!dragging) return;

    /* 跟随系数：触屏要比鼠标快得多。
       实测 0.42 时快速滑动下光团落后手指约 22px，看起来像"追不上"；
       0.62 把滞后压到 8px 以内，同时仍有一点柔和的拖沓感（完全 1.0 会显得生硬）。
       鼠标有光标本身作参照，慢一些更自然。 */
    var k = dragKind === "touch" ? 0.62 : 0.38;
    smoothAt.x += (targetAt.x - smoothAt.x) * k;
    smoothAt.y += (targetAt.y - smoothAt.y) * k;

    dragGlow.style.transform =
      "translate3d(" + smoothAt.x.toFixed(1) + "px," + smoothAt.y.toFixed(1) + "px,0)";

    if (Math.abs(targetAt.x - smoothAt.x) > 0.3 || Math.abs(targetAt.y - smoothAt.y) > 0.3) {
      dragRaf = requestAnimationFrame(dragLoop);
    }
  }

  function startDrag(x, y, kind) {
    if (!on() || !dragGlow) return;

    dragKind = kind;
    dragging = true;
    moveDist = 0;

    lastMove.x = x; lastMove.y = y;
    spawnAt.x = x; spawnAt.y = y;
    smoothAt.x = x; smoothAt.y = y;
    targetAt.x = x; targetAt.y = y;

    dragGlow.setAttribute("data-kind", dragKind);
    dragGlow.classList.add("is-dragging");
    trailBox.setAttribute("data-kind", dragKind);

    // 位置先落位再淡入，避免从上一个位置"飞过来"
    dragGlow.style.transform =
      "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)";

    // 桌面按住时暂时收起常驻追光，避免两个光叠在一起显脏
    if (dragKind === "mouse" && spotlight) spotlight.classList.add("is-hold");
  }

  /* 统一的移动处理：更新光团目标位置 + 按阈值撒拖尾点 */
  function trackMove(x, y) {
    var dx = x - lastMove.x;
    var dy = y - lastMove.y;
    moveDist += Math.sqrt(dx * dx + dy * dy);
    lastMove.x = x;
    lastMove.y = y;
    targetAt.x = x;
    targetAt.y = y;

    if (!dragRaf) dragRaf = requestAnimationFrame(dragLoop);

    /* 位移超过阈值才开始撒尾：轻点（<8px）不该留下轨迹，否则页面会显得很吵。
       撒点间隔：触屏 19px、桌面 12px。
       间隔过大（试过 34px）会让点之间明显断开，像"一串珠子"而不是拖尾；
       19px 配 12px 的点径刚好首尾相接。 */
    if (moveDist < 8) return;
    var gap = dragKind === "touch" ? 19 : 12;
    var sx = x - spawnAt.x;
    var sy = y - spawnAt.y;
    if (sx * sx + sy * sy >= gap * gap) {
      spawnDot(x, y);
      spawnAt.x = x;
      spawnAt.y = y;
    }
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; }
    if (dragGlow) dragGlow.classList.remove("is-dragging");
    if (spotlight) spotlight.classList.remove("is-hold");
  }

  function initDragGlow() {
    dragGlow = document.getElementById("dragGlow");
    trailBox = document.getElementById("dragTrail");
    if (!dragGlow || !trailBox) return;
    buildTrail();

    /* ⚠️ 触屏和桌面必须走两套事件，这是实测踩出来的：
       在可滚动页面上，浏览器一旦判定为滚动手势就会发 pointercancel，
       之后 pointermove 完全停止。实测一次 12 步的竖直拖动：
         pointermove 只触发 1 次，pointercancel 1 次
         而 touchmove 持续触发 9 次
       所以触屏用 touch 事件才能拿到完整轨迹，桌面继续用 pointer 事件。 */

    /* ---------------- 桌面：pointer 事件 ---------------- */
    document.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch" || e.pointerType === "pen") return;  // 交给 touch 那套
      startDrag(e.clientX, e.clientY, "mouse");
    }, { passive: true });

    document.addEventListener("pointermove", function (e) {
      if (dragKind !== "mouse" || !dragging) return;
      if (!on()) { endDrag(); return; }
      trackMove(e.clientX, e.clientY);
    }, { passive: true });

    document.addEventListener("pointerup", function (e) {
      if (dragKind === "mouse" && dragging) endDrag();
    }, { passive: true });
    document.addEventListener("pointercancel", function (e) {
      if (dragKind === "mouse" && dragging) endDrag();
    }, { passive: true });

    /* ---------------- 触屏：touch 事件 ---------------- */
    document.addEventListener("touchstart", function (e) {
      if (!on()) return;
      if (e.touches.length !== 1) { endDrag(); return; }   // 多指手势（缩放）不管
      var t = e.touches[0];
      spawnRipple(t.clientX, t.clientY);
      startDrag(t.clientX, t.clientY, "touch");
    }, { passive: true });

    document.addEventListener("touchmove", function (e) {
      if (!dragging || dragKind !== "touch") return;
      if (e.touches.length !== 1) { endDrag(); return; }
      if (!on()) { endDrag(); return; }
      var t = e.touches[0];
      trackMove(t.clientX, t.clientY);
    }, { passive: true });

    document.addEventListener("touchend", function () {
      if (dragKind === "touch" && dragging) endDrag();
    }, { passive: true });
    document.addEventListener("touchcancel", function () {
      if (dragKind === "touch" && dragging) endDrag();
    }, { passive: true });

    /* 松手可能发生在窗口外，用这些兜底，避免光团卡在屏幕上 */
    window.addEventListener("blur", endDrag);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) endDrag();
    });
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
    /* 注意：这里必须把「减少动态效果」也算进开关状态。
       早先的写法是先设 on 再 early-return，导致开了减少动效时
       data-effects 仍然是 "on"，CSS 里的降级规则就失效了 ——
       功能上没坏（JS 不初始化），但少了一层兜底。 */
    var active = UI.lightEffects !== false && !reduced();
    enabled = UI.lightEffects !== false;
    document.documentElement.dataset.effects = active ? "on" : "off";
    if (!active) return;

    initSpotlight();
    initCardGlow();
    initRipple();
    initDragGlow();

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
