/* ==========================================================================
 *  backdrop.js —— 背景系统控制
 * --------------------------------------------------------------------------
 *  它在做什么：
 *    读取 config.backdrop，把开关写成 html 上的 data 属性，CSS 据此显隐各层。
 *    再补两件事纯 CSS 做不到的：多层视差、图片预检。
 *
 *  为什么用 data 属性而不是逐个 style：
 *    背景各层的显隐规则全在 CSS 里，JS 只表达"要什么"，
 *    切换主题 / 改配置时不需要重算样式，也不会有内联样式残留。
 *
 *  安全阀（重要）：
 *    图片地址可能失效、可能是被防盗链的第三方图。失败时必须自动退回
 *    无图状态，绝不留一个空白占位或半加载的灰块。
 * ========================================================================== */

window.SITE_BACKDROP = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};
  var B = C.backdrop || {};
  var UI = C.ui || {};
  var reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };

  var ambient = null;
  var imageEl = null;
  var rafId = null;
  var scrollY = 0, smoothScrollY = 0;
  var px = 0, py = 0, sx = 0, sy = 0;

  function reduced() { return reduceQuery.matches; }
  function on(v, dflt) { return v === undefined ? dflt : v !== false; }
  function num(v, dflt) {
    var n = parseFloat(v);
    return isNaN(n) ? dflt : n;
  }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /* --------------------------------------------------------- 把配置写进 DOM */
  function applyFlags() {
    var motion = on(B.motion && B.motion.aurora, true) ||
                 on(B.motion && B.motion.grain, true) ||
                 on(B.motion && B.motion.grid, false) ||
                 on(B.motion && B.motion.stars, false);

    root.dataset.bdAurora = on(B.motion && B.motion.aurora, true) ? "on" : "off";
    root.dataset.bdGrain = on(B.motion && B.motion.grain, true) ? "on" : "off";
    root.dataset.bdGrid = on(B.motion && B.motion.grid, false) ? "on" : "off";
    root.dataset.bdStars = on(B.motion && B.motion.stars, false) ? "on" : "off";

    var blur = clamp(num(B.imageBlur, 0), 0, 40);
    var opacity = clamp(num(B.imageOpacity, 0.35), 0, 1);
    var scrim = clamp(num(B.scrim, 0.65), 0.15, 0.95);
    /* 可读性下限：图片最终露出来的比例 = opacity × (1 - scrim)。
       纯黑 / 纯白这种最坏图下，比例超过 0.12 正文对比度就压不到 4.5
       （verify-backdrop 会拿最坏图逐套主题量）。用户把图调得很实，
       就把遮罩自动补上去 —— 宁可图淡，不可字糊。 */
    var MAX_VIS = 0.12;
    if (opacity * (1 - scrim) > MAX_VIS) {
      scrim = Math.min(0.95, 1 - MAX_VIS / Math.max(opacity, 0.01));
    }
    var gridSize = clamp(num(B.gridSize, 64), 24, 200);
    var starsOpacity = clamp(num(B.bdStarsOpacity, 0.5), 0.05, 1);

    root.style.setProperty("--bd-image-blur", blur + "px");
    root.style.setProperty("--bd-image-opacity", String(opacity));
    root.style.setProperty("--bd-scrim", String(scrim));
    root.style.setProperty("--bd-grid-size", gridSize + "px");
    root.style.setProperty("--bd-stars-opacity", String(starsOpacity));

    root.dataset.backdropBlur = blur > 0 ? "on" : "off";
    root.dataset.kenBurns = on(B.kenBurns, false) && !reduced() ? "on" : "off";
    root.dataset.backdropMotion = motion ? "on" : "off";
  }

  /* ------------------------------------------------- 图片模式下的文字保护
     这是整套背景里最关键的一段，理由值得写清楚：

     背景图一旦压在文字下，最脆弱的是「辅助小字」（--text-3：时钟、页码、
     卡片元信息）。实测浅色主题配深色图时，即使把遮罩拉到 0.85，
     小字对比度也只有 3.19 —— 单靠遮罩救不回来，因为 --text-3 本身就浅。

     所以图片模式下额外做一件事：把 --text-3 向正文色（--text）混合 50%。
     实测这一档可以让小字从 2.63 提到 5~6，同时仍与正文有可见的层次差。
     图片关掉时立刻还原，绝不影响没有图片时的观感。 */
  var TEXT3_MIX = 0.5;
  var ACCENT_MIX = 0.45;

  function parseColor(v) {
    var s = String(v || "").trim();
    var m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return [0, 2, 4].map(function (i) { return parseInt(m[1].substr(i, 2), 16); });
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [0, 1, 2].map(function (i) { return parseInt(m[1][i] + m[1][i], 16); });
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) return m[1].split(",").map(Number).slice(0, 3);
    return null;
  }

  function applyTextGuard() {
    // 没图就不碰文字颜色
    if (root.dataset.backdropImage !== "on") {
      root.style.removeProperty("--text-3");
      root.style.removeProperty("--accent-bd");
      return;
    }

    var T = window.SITE_THEMES;
    if (!T || !T.get) return;

    var skin = T.get(root.dataset.skin || T.defaultSkin);
    if (!skin) return;

    var mode = root.dataset.theme === "dark" ? "dark" : "light";
    var palette = skin[mode] || skin.light;
    var t3 = parseColor(palette["text-3"]);
    var t1 = parseColor(palette["text"]);
    if (!t3 || !t1) return;

    var mixed = t3.map(function (v, i) { return Math.round(v + (t1[i] - v) * TEXT3_MIX); });
    root.style.setProperty("--text-3", "rgb(" + mixed.join(",") + ")");

    /* 主色也有同样的问题：eyebrow（01 / ABOUT 这类小标签）和首页身份行
       直接用 --accent，压在图片上时对比度会掉到 3.1 左右。
       这里单独算一个「背景专用的强调色」，只给这两处用，
       不影响按钮、图标等有实底的地方，主题气质得以保留。 */
    var acc = parseColor(palette["accent"]);
    if (acc) {
      var accMixed = acc.map(function (v, i) {
        return Math.round(v + (t1[i] - v) * ACCENT_MIX);
      });
      root.style.setProperty("--accent-bd", "rgb(" + accMixed.join(",") + ")");
    }
  }

  /* ------------------------------------------------------------ 背景图片 */
  function setImage(url) {
    if (!imageEl) return;
    var u = typeof url === "string" ? url.trim() : "";

    if (!u) {
      root.dataset.backdropImage = "off";
      imageEl.style.backgroundImage = "";
      applyTextGuard();
      return;
    }

    // 先用 Image 预加载，成功才真的铺上去 —— 避免坏链留下空白
    var probe = new Image();
    probe.decoding = "async";

    probe.onload = function () {
      imageEl.style.backgroundImage = 'url("' + u.replace(/"/g, '\\"') + '")';
      root.dataset.backdropImage = "on";
      applyTextGuard();
    };
    probe.onerror = function () {
      root.dataset.backdropImage = "off";
      imageEl.style.backgroundImage = "";
      applyTextGuard();
      if (window.console && console.warn) {
        console.warn("[backdrop] 背景图加载失败，已自动退回纯色背景：" + u);
      }
    };
    probe.src = u;
  }

  /* -------------------------------------------------------------- 视差
     两个方向叠加，幅度都很小：
       · 鼠标视差：光晕层 ±26px（原有的手感，保留）
       · 滚动视差：图片层 ±18px（新增，让背景和内容有前后层次） */
  function initParallax() {
    if (reduced()) return;
    if (!on(B.parallax, true)) return;
    if (!ambient) return;

    var useMouse = finePointer.matches;
    var hasImage = root.dataset.backdropImage === "on";

    function loop() {
      rafId = null;
      var moving = false;

      /* 滚动视差：图片走得更慢 */
      smoothScrollY += (scrollY - smoothScrollY) * 0.08;
      if (Math.abs(scrollY - smoothScrollY) > 0.3) moving = true;

      /* 鼠标视差 */
      if (useMouse) {
        sx += (px - sx) * 0.055;
        sy += (py - sy) * 0.055;
        if (Math.abs(px - sx) > 0.06 || Math.abs(py - sy) > 0.06) moving = true;
      }

      // 光晕整体轻微跟随鼠标
      ambient.style.transform = "translate3d(" +
        (sx * 0.7).toFixed(2) + "px," + (sy * 0.7).toFixed(2) + "px,0)";

      // 图片反向轻微位移，形成前景/背景分离
      if (hasImage && imageEl) {
        var offset = clamp(smoothScrollY * -0.05, -60, 60);
        imageEl.style.translate = "0 " + offset.toFixed(2) + "px";
      }

      if (moving) rafId = requestAnimationFrame(loop);
    }

    function kick() {
      if (!rafId) rafId = requestAnimationFrame(loop);
    }

    window.addEventListener("scroll", function () {
      scrollY = window.scrollY || window.pageYOffset || 0;
      kick();
    }, { passive: true });

    if (useMouse) {
      window.addEventListener("pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        px = (e.clientX / window.innerWidth - .5) * 26;
        py = (e.clientY / window.innerHeight - .5) * 26;
        kick();
      }, { passive: true });
    }

    scrollY = smoothScrollY = window.scrollY || 0;
    kick();
  }

  /* ---------------------------------------------------------------- 初始化 */
  function init() {
    ambient = $("ambient");
    imageEl = $("ambientImage");

    applyFlags();
    setImage(B.image);

    // 主题 / 明暗切换后，遮罩颜色取自 --bg，会自动跟着变，这里只需重算一次 kenBurns 等
    var syncMotion = function () {
      root.dataset.kenBurns = on(B.kenBurns, false) && !reduced() ? "on" : "off";
    };
    if (reduceQuery.addEventListener) reduceQuery.addEventListener("change", syncMotion);
    else if (reduceQuery.addListener) reduceQuery.addListener(syncMotion);

    initParallax();
  }

  return {
    init: init,
    setImage: setImage,
    flags: applyFlags,
    /* 主题 / 明暗切换后必须重算小字保护色（--text-3 会被 skin.js 重新注入） */
    refresh: function () {
      applyFlags();
      applyTextGuard();
    }
  };
})();
