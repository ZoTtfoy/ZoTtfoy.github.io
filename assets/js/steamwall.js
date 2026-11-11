/* ==========================================================================
 *  steamwall.js —— 游戏屏的 Steam 竖版封面拼贴背景
 * --------------------------------------------------------------------------
 *  2026-11-11 重写。旧版有三个硬伤，都是实测截图看出来的：
 *
 *    ① 用横版 header.jpg（460×215），不是竖版封面。
 *    ② 右下角大片空白、手机上几乎全空 —— 网格按 170%/200% 百分比给尺寸，
 *       旋转 45° 后覆盖不了四角，列又只有 5 格，列底就是空的。
 *    ③ 停在游戏屏时位移只有 -0.04%，等于不动。
 *       翻页站点没有"持续滚动进度"，靠 scrollY 驱动的视差在停稳后必然归零。
 *
 *  现在换成用户点名的思路：**做一个够大的固定实例，再对整个实例等比缩放**。
 *
 *  ── 几何 ──────────────────────────────────────────────────────────────
 *    实例 INST × INST = 2400×2400（固定 px，与设备无关）
 *    格子 TILE_W × TILE_H = 400×600（2:3，竖版封面的比例）
 *    COLS = INST/TILE_W = 6，单份 ROWS = 4 格 = 2400px（正好一个周期）
 *
 *    ⚠️ 格子尺寸是**性能**调出来的，不是随手定的。
 *       第一版用 300×450 / 8 列 / 每列 12 格 = 96 个 <img>，
 *       实测 verify-perf 的滚动帧耗时从 61ms 翻倍到 118ms ——
 *       96 张 600×900 的竖图在软件合成下要维护约 52M 像素纹理。
 *       放大到 400×600 后只需 6 列 × 8 格 = 48 张（砍半），
 *       覆盖面积一点没变，手机上单张还更清楚。
 *
 *    一个 S×S 的正方形旋转 45° 之后，能完整内接的轴对齐正方形边长 = S/√2。
 *    要让 W×H 的视口整个落在里面：S/√2 ≥ max(W,H)。
 *    所以 scale = √2 × max(W,H) × SAFETY / INST，SAFETY = 1.12 留旋转余量。
 *
 *      1440×900  → 0.95      390×844 → 0.56      1920×1080 → 1.27
 *    格子在手机上约 223×334、宽屏约 507×760 —— 同一套布局等比缩放，
 *    任何设备都被填满，且不会出现"换台机器就缺一角"。
 *
 *  ── 为什么永远填得满 ─────────────────────────────────────────────────
 *    每列渲染 **2 份完全相同**的图组（8 格 = 4800px），列从 top = -2400 起。
 *    格子 k 的顶部 = -2400 + k×600。
 *      位移 d = 0     → 实例 [0,2400] 里看到的是第二份（格子 4..7）
 *      位移 d = +2400 → 看到的是第一份（格子 0..3）
 *    两份内容相同，所以 d 从 2400 归零时画面**完全一致**，没有跳变。
 *    任意 d ∈ [0,2400]，内容覆盖 [-2400+d, 2400+d]，
 *      上沿 ≤ 0（因 d ≤ 2400）且下沿 ≥ 2400（因 d ≥ 0）—— 恒成立。
 *    于是流动永远无缝、永远填满。gap = 0、无圆角，连 1px 缝都不留。
 *
 *  ── 动起来 ───────────────────────────────────────────────────────────
 *    不再依赖滚动位置，改用**时间驱动**的持续缓慢流动（rAF 累积相位），
 *    这样停在游戏屏时也在动。每列 d = (phase × 该列倍率) % 2700。
 *    倍率沿用正弦分布 0.55~1.45：随机会让相邻列一快一慢像抖动，
 *    正弦是连续变化，读起来像流动。
 *    滚动时另外叠一个会衰减的 boost，翻页瞬间背景会"跟着冲一下"，
 *    保留先前要求的"伴随滚动"，但不把运动绑死在 scrollY 上。
 *
 *  ── 数据 ─────────────────────────────────────────────────────────────
 *    data/steam.json 的 portraitApps 是**逐张探测过 200 + >5KB** 的 appid。
 *    45 个库存 appid 里 8 个没有竖版封面（404），不剔掉就会在墙上开天窗。
 *    渲染层仍有 img.onerror 兜底，防止 CDN 临时故障露白。
 * ========================================================================== */

window.SITE_STEAMWALL = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  function reduced() { return reduceQuery.matches; }

  /* ------------------------------------------------------------- 实例规格
     这些全是**固定的设计像素**，不随设备变。适配只通过最外层的一个 scale，
     所以手机/平板/带鱼屏看到的是同一张拼贴的不同放大倍率，不会各缺一角。 */
  var INST = 2400;               // 实例边长（正方形）
  var TILE_W = 400;              // 格子宽（2:3 竖版）
  var TILE_H = 600;              // 格子高
  var COLS = INST / TILE_W;      // 6 列
  var ROWS = 4;                  // 单份 4 格 = 2400px
  var PERIOD = ROWS * TILE_H;    // 一份的高度，也是循环周期
  var SAFETY = 1.12;             // 旋转后的覆盖余量
  var BASE_RATE = 48;            // px/s，SPEED=1 时基准列的流速

  var wall = null, grid = null;
  var colsEls = [];
  var io = null;              // 可见性裁决者（模块级，异步换数据后要复用）
  var apps = [];
  var portraitOnly = false;      // 是否只用了探测过的竖版封面
  var scale = 1;

  var SPEED = 1;
  var phase = 0;                 // 累积相位（px）
  var boost = 0;                 // 滚动带来的额外速度，会衰减
  var lastT = 0;
  var raf = 0;
  var running = false;

  function cdnUrl(appid) {
    return "https://cdn.cloudflare.steamstatic.com/steam/apps/" + appid +
      "/library_600x900.jpg";
  }

  /* ------------------------------------------------------- 数据来源 */
  function fromConfig() {
    var items = (C.gaming && C.gaming.items) || [];
    for (var i = 0; i < items.length; i++) {
      var st = items[i] && items[i].steam;
      if (st && Array.isArray(st.fallbackApps) && st.fallbackApps.length) {
        return st.fallbackApps.slice();
      }
    }
    return [];
  }

  function getJSON(url) {
    if (!url || typeof fetch !== "function") return Promise.resolve(null);
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 4000);
    return fetch(url, { cache: "no-cache", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) { clearTimeout(timer); return v; });
  }

  /* 各列流速倍率。正弦，不是随机：随机让相邻列一快一慢像在抖，
     正弦是连续变化，人眼读成"有前后层次的流动"。 */
  function colSpeed(i, total) {
    if (total <= 1) return 1;
    var phase = (i / (total - 1) - 0.5) * Math.PI;
    return 1 + Math.sin(phase) * 0.45;   // 0.55 ~ 1.45
  }

  /* ------------------------------------------------------------- 适配 */
  function fit() {
    if (!grid) return;
    var w = window.innerWidth || 1280;
    var h = window.innerHeight || 800;
    /* 旋转 45° 后，S×S 正方形的轴对齐内接正方形边长是 S/√2。
       把它撑到至少 max(w,h)×SAFETY，视口四角就都在实例里。 */
    scale = Math.SQRT2 * Math.max(w, h) * SAFETY / INST;
    grid.style.setProperty("--wall-scale", scale.toFixed(4));
    grid.style.setProperty("--wall-inst", INST + "px");
    grid.style.setProperty("--wall-tile-w", TILE_W + "px");
    grid.style.setProperty("--wall-tile-h", TILE_H + "px");
    grid.style.setProperty("--wall-period", PERIOD + "px");
  }

  /* ------------------------------------------------------------- 渲染 */
  function build(list) {
    if (!grid || !list.length) return 0;

    /* 固定种子打乱：库里靠前的都是最常玩的，原样铺会一眼认出来，
       也保证每次刷新布局一致（不会晃）。 */
    var seed = 20261111;
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    var pool = list.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }

    var html = "";
    for (var c = 0; c < COLS; c++) {
      var factor = colSpeed(c, COLS);
      /* 每列错开起点，避免所有列第一张都是同一张图；
         同时保证「第 k 格」和「第 k+ROWS 格」用同一个 appid（两份完全相同）。 */
      var seq = [];
      for (var r = 0; r < ROWS; r++) {
        seq.push(pool[(c * 3 + r * 5) % pool.length]);
      }

      var cells = "";
      for (var k = 0; k < ROWS * 2; k++) {
        var appid = seq[k % ROWS];
        /* 明暗起伏：两份对应位置必须一致，否则循环归零会闪一下 */
        var dim = 0.82 + (((c * 7 + (k % ROWS) * 3) % 5) * 0.035);
        cells += '<span class="steamwall__tile" style="--dim:' + dim.toFixed(2) + '">' +
          '<img src="' + cdnUrl(appid) + '" alt="" decoding="async" ' +
          'width="' + TILE_W + '" height="' + TILE_H + '" ' +
          'onerror="this.closest(\'.steamwall__tile\').classList.add(\'is-broken\')">' +
          "</span>";
      }
      html += '<div class="steamwall__col" data-col="' + c + '" ' +
        'style="--col-speed:' + factor.toFixed(3) + '">' + cells + "</div>";
    }
    grid.innerHTML = html;

    wall.setAttribute("data-ready", "1");
    colsEls = [].slice.call(grid.querySelectorAll(".steamwall__col"));
    fit();
    return COLS * ROWS * 2;
  }

  /* ------------------------------------------------------------- 运动 */
  function paint() {
    for (var i = 0; i < colsEls.length; i++) {
      var el = colsEls[i];
      var f = parseFloat(el.style.getPropertyValue("--col-speed")) || 1;
      /* 取模 = 无限循环。因为两份内容首尾相同，模回 0 时画面完全接得上。
         只写 Y，X 恒为 0 —— 位移沿图片自身的垂直方向（旋转后是斜向流水）。 */
      var d = (phase * f) % PERIOD;
      el.style.transform = "translate3d(0," + d.toFixed(2) + "px,0)";
    }
  }

  function tick(t) {
    raf = 0;
    if (!running) return;
    if (!lastT) lastT = t;
    var dt = Math.min(64, t - lastT);     // 切标签回来时别一次跳一大截
    lastT = t;

    /* 是否可见由 IntersectionObserver 决定（见 init），
       这里不再每帧测 getBoundingClientRect —— 那本身就是一次强制布局。
       只在 reduced / 标签页隐藏时跳过推进。 */
    if (!reduced() && !document.hidden) {
      boost *= Math.pow(0.94, dt / 16.7);           // 滚动冲量衰减
      if (boost < 0.05) boost = 0;
      phase += (BASE_RATE * SPEED + boost) * dt / 1000;
      paint();
    }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (running || reduced() || !colsEls.length) return;
    running = true;
    lastT = 0;
    raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastT = 0;
  }

  function onScroll() {
    /* 翻页时给一个短促的加速，让背景"跟着冲一下"。
       滚动速度取绝对值的 1/8，最多再叠 220px/s，然后自然衰减。 */
    var y = window.scrollY || 0;
    var dy = Math.abs(y - (onScroll._y === undefined ? y : onScroll._y));
    onScroll._y = y;
    boost = Math.min(220, boost + dy * 0.12);
  }

  /* ------------------------------------------------------------- 入口 */
  function init() {
    (function () {
      var items = (C.gaming && C.gaming.items) || [];
      for (var i = 0; i < items.length; i++) {
        var st = items[i] && items[i].steam;
        if (st && typeof st.scrollSpeed === "number") { SPEED = st.scrollSpeed; break; }
      }
    })();

    wall = $("steamWall");
    grid = $("steamWallGrid");
    if (!wall || !grid) return;

    /* 先铺 config 里的快照，保证打开就有图（不等网络）。
       但快照没探测过竖版可用性，所以拿到 steam.json 后要换成 portraitApps。 */
    apps = fromConfig();
    if (!apps.length) { wall.hidden = true; return; }
    build(apps);

    getJSON("data/steam.json").then(function (d) {
      if (!d) return;
      var good = Array.isArray(d.portraitApps) && d.portraitApps.length >= 6
        ? d.portraitApps
        : (Array.isArray(d.apps) ? d.apps : []);
      if (!good.length) return;
      apps = good;
      portraitOnly = !!(d.portraitApps && d.portraitApps.length >= 6);
      build(apps);
      paint();
      /* ⚠️ 数据回来后必须重新裁决一次要不要跑。
         如果 config 里没有 fallback，第一次 build 没执行，init 末尾的
         start() 会被空 colsEls 挡掉；这里填上 colsEls 后若什么都不做，
         rAF 永远不启动（实测：72 张图全加载、方向也对，phase 恒为 0）。
         但不能无脑 start() —— 那会让离屏很远的屏也常驻 rAF，
         把 IntersectionObserver 的优化整个抵消掉。
         重新 observe 一次，让 IO 按"此刻真实可见性"决定 start / stop。 */
      if (io) {
        var sec = document.getElementById("gaming");
        if (sec) { io.unobserve(sec); io.observe(sec); }
      } else {
        start();
      }
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { fit(); }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      lastT = 0;
      if (document.hidden) stopLoop(); else start();
    });

    /* 游戏屏离屏时把 rAF 整个停掉，别空转。
       ⚠️ 早先是在 tick 里每帧读 getBoundingClientRect 判断 near，
          那样即使离屏也保持一帧一次的 JS 调用，而且读 rect 本身会触发
          强制布局 —— verify-perf 的滚动帧耗时因此翻倍。
          改用 IntersectionObserver：只在进出时各回调一次，平时零开销。
          rootMargin 上下各留 0.3 屏，翻页过渡还没结束就已经在动了。
          ⚠️ 不能留一整屏：gaming 是第三屏，留 100% 会让它在用户还停在
          首页时也算"可见"，rAF 照样常驻，等于没优化。 */
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(function (entries) {
        var visible = entries.some(function (e) { return e.isIntersecting; });
        if (visible) start(); else stopLoop();
      }, { rootMargin: "30% 0px" });
      io.observe(document.getElementById("gaming"));
    }

    fit();
    paint();
    start();
  }

  /* 速度可调：0 = 静止，1 = 默认，3 = 明显流动。 */
  function setSpeed(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) v = 1;
    SPEED = Math.min(6, v);
    paint();
    return SPEED;
  }

  return {
    init: init,
    setSpeed: setSpeed,
    speed: function () { return SPEED; },
    /* 自检用 */
    fit: fit,
    scale: function () { return scale; },
    phase: function () { return phase; },
    step: function (px) { phase += px; paint(); },   // 测试里精确推进相位
    period: function () { return PERIOD; },
    portraitOnly: function () { return portraitOnly; },
    count: function () { return grid ? grid.children.length : 0; },
    apps: function () { return apps.slice(); },
    refresh: function () { if (wall) { build(apps); paint(); } }
  };
})();
