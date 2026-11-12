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
  /* ⚠️ 2026-11-12 第五轮：整套「设计像素」减半，scale 由公式自动翻倍。
     屏幕上瓦片尺寸 = TILE × scale：200 × (2×0.4917) 与旧的 400 × 0.4917
     完全相等 —— 视觉尺寸、旋转包围盒、四角覆盖、循环观感都不变；
     但一列从 1100×13200 设备像素降到约 540×6500，两面墙 12 个大层
     合计纹理从约 175M 降到约 44M 像素（−75%）。
     ⚠️ BASE_RATE / boost 必须同步减半，否则屏幕上的流速会翻倍。
     ⚠️ 本文件历史注释里写的 2400 / 400 / 600 / 4800 是**旧设计像素**，
        现在分别是 1200 / 200 / 300 / 2400，几何推导关系不变。 */
  var INST = 1200;               // 实例边长（正方形）
  var TILE_W = 200;              // 格子宽（2:3 竖版）
  var TILE_H = 300;              // 格子高
  var COLS = INST / TILE_W;      // 6 列（不变）
  var ROWS = 4;                  // 单份 4 格 = 1200px
  var PERIOD = ROWS * TILE_H;    // 一份的高度，也是循环周期 = 1200
  var SAFETY = 1.12;             // 旋转后的覆盖余量
  var BASE_RATE = 24;            // px/s（原 48，随实例减半，屏幕流速不变）

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

  /* ⚠️ 2026-11-11 图床换血。
     原来只用 cdn.cloudflare.steamstatic.com —— 国内网络下它会时通时不通，
     表现是这面墙**一部分封面永远加载不出来**（瓦片露出接近白色的底色，
     整屏看着像没渲染完）。实测三个域名都返回同一张图，换主机即可：
       steamcdn-a.akamaihd.net      Akamai 老域名，国内最稳，也是最快的
       cdn.akamai.steamstatic.com   新 Akamai 域名，兜底
       cdn.cloudflare.steamstatic.com  最后再退到它
     顺序按"国内可达性"排，不是按字母。 */
  var CDN_HOSTS = [
    "https://steamcdn-a.akamaihd.net",
    "https://cdn.akamai.steamstatic.com",
    "https://cdn.cloudflare.steamstatic.com"
  ];

  function cdnUrl(appid, host) {
    return (host || CDN_HOSTS[0]) + "/steam/apps/" + appid + "/library_600x900.jpg";
  }

  /* 图挂了 / 还没到时的底色：由 appid 派生一个固定的深色相。
     目的不是好看，是**别露白** —— 一面墙只要有几块近白的瓦片，
     远看就是"页面没加载出来"。同一 appid 永远同一个颜色，重排也不晃。 */
  function hueOf(appid) {
    return ((Number(appid) || 0) * 47) % 360;
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
  /* 2026-11-12：fit() 挂在 resize / visualViewport.resize / orientationchange 上，
     安卓地址栏一收一放会连发十几次。原来每次都无条件写 5 个 CSS 变量，
     值没变也会让 2400×2400 旋转层的 transform 失效并重新栅格化 —— 实测
     单次 resize 被放大成 12 次整页重排。改成只在值真的变了才写。 */
  var fitCache = {};
  function setWallVar(name, value) {
    if (fitCache[name] === value) return;
    fitCache[name] = value;
    grid.style.setProperty(name, value);
  }

  function fit() {
    if (!grid) return;
    /* ⚠️ 2026-11-11 改用**背景层自己的盒子**，不再读 window.innerHeight。
       手机浏览器（iOS Safari / 部分安卓 WebView）里 innerHeight 是"当前可见高度"
       —— 地址栏滑出滑入时它比 CSS 的 100vh 小 60~120px，而这一层是
       position:absolute; inset:0，跟的是 section 的 100vh。
       用小的那个数去算 scale，结果就是：页面越高、背景越盖不满，
       用户看到的是"游戏界面背景错了一截"。
       clientWidth/clientHeight 是布局尺寸，不受浏览器 chrome 影响。
       取不到（display:none / 还没布局）时才退回窗口尺寸。 */
    var w = wall ? wall.clientWidth : 0;
    var h = wall ? wall.clientHeight : 0;
    if (!w || !h) { w = window.innerWidth || 1280; h = window.innerHeight || 800; }
    /* 旋转 45° 后，S×S 正方形的轴对齐内接正方形边长是 S/√2。
       把它撑到至少 max(w,h)×SAFETY，视口四角就都在实例里。 */
    scale = Math.SQRT2 * Math.max(w, h) * SAFETY / INST;
    setWallVar("--wall-scale", scale.toFixed(4));
    setWallVar("--wall-inst", INST + "px");
    setWallVar("--wall-tile-w", TILE_W + "px");
    setWallVar("--wall-tile-h", TILE_H + "px");
    setWallVar("--wall-period", PERIOD + "px");
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
        /* --h 是这张瓦片的兜底色相（见 hueOf）。图没到 / 图挂了时由它顶上，
           绝不再露接近白色的 --bg-soft —— 那种"几块白瓦片"会让整面墙
           看起来像没渲染完。 */
        cells += '<span class="steamwall__tile" style="--dim:' + dim.toFixed(2) +
          ';--h:' + hueOf(appid) + '">' +
          /* ⚠️ 这里**不能**加 loading="lazy"（实测过，然后又撤了）：
             整面墙 = 48 个 <img>，其中只有一部分落在视口内，
             其余被 .steamwall 的 overflow:hidden 裁掉。
             Chrome 的懒加载按"是否接近视口"判定，被裁掉的那些会被判成
             "还不需要"，于是永远不加载 —— 实测只有 20/48 张到位，
             剩下 28 格露出 --h 纯色块，墙看起来是花的。
             画面比性能重要，所以只在请求优先级上让路（fetchpriority="low"）：
             它不影响加不加载，只让背景图排在首屏数据后面。 */
          '<img src="' + cdnUrl(appid, CDN_HOSTS[0]) + '" alt="" decoding="async" ' +
          'fetchpriority="low" ' +
          'width="' + TILE_W + '" height="' + TILE_H + '" ' +
          'data-appid="' + appid + '" data-host="0">' +
          "</span>";
      }
      html += '<div class="steamwall__col" data-col="' + c + '" ' +
        'style="--col-speed:' + factor.toFixed(3) + '">' + cells + "</div>";
    }
    grid.innerHTML = html;

    /* 图挂了就换下一个图床，全部试完才认输（落到底色）。
       用 addEventListener 而不是内联 onerror：内联要挂一个全局函数，
       而这里刚好在同一个作用域里，闭包更好读也更好测。 */
    [].forEach.call(grid.querySelectorAll(".steamwall__tile img"), function (img) {
      img.addEventListener("error", function () {
        var tile = img.parentNode;
        var step = Number(img.getAttribute("data-host") || 0) + 1;
        if (step < CDN_HOSTS.length) {
          img.setAttribute("data-host", String(step));
          img.src = cdnUrl(img.getAttribute("data-appid"), CDN_HOSTS[step]);
          return;
        }
        if (tile) tile.classList.add("is-broken");
      });
    });

    wall.setAttribute("data-ready", "1");
    colsEls = [].slice.call(grid.querySelectorAll(".steamwall__col"));
    fit();
    buildAnims();
    return COLS * ROWS * 2;
  }

  /* ------------------------------------------------------------- 运动 */
  /* 为什么不再用 rAF 逐帧写 transform：
     实机（安卓 Edge）测得 —— 墙在跑时 35.6fps / 平均 28.1ms / 最长长任务 296ms；
     把墙一停，立刻 60fps / 16.7ms / 零长任务。整页的帧全被它吃掉：
     每帧 6 次 style 写入 → 6 个 400×4800 的大层重新合成。

     改成 Web Animations API：一次声明「0 → 一个周期」的线性无限动画，
     之后由合成器自己跑，主线程零开销。视觉一致：同样匀速、同样两份内容
     首尾相接无缝归位；滚动时的加速改用 playbackRate（一次写属性）。
     实机复测：35.6 → 45fps，最长长任务 296 → 183ms。 */
  var anims = [];
  var useWaapi = true;

  /* ⚠️ 不能叫 colSpeed：build() 里已有 colSpeed(c, COLS) 是列速度系数生成器，
     同名会把那个覆盖掉，build 直接抛错（踩过）。 */
  function speedOf(el) { return parseFloat(el.style.getPropertyValue("--col-speed")) || 1; }

  function buildAnims() {
    anims = [];
    if (typeof Element === "undefined" || !Element.prototype.animate) { useWaapi = false; return; }
    for (var i = 0; i < colsEls.length; i++) {
      var el = colsEls[i];
      var f = speedOf(el);
      var dur = (PERIOD / (BASE_RATE * SPEED * f)) * 1000;
      el.style.transform = "";
      var a = el.animate(
        [{ transform: "translate3d(0,0,0)" },
         { transform: "translate3d(0," + PERIOD + "px,0)" }],
        { duration: dur, iterations: Infinity, easing: "linear" }
      );
      a.pause();
      anims.push({ el: el, f: f, anim: a, dur: dur });
    }
    useWaapi = anims.length > 0;
  }

  function resetRate() {
    for (var i = 0; i < anims.length; i++) anims[i].anim.playbackRate = 1;
  }

  /* 退化路径：不支持 WAAPI 时仍是逐帧写 transform */
  function paint() {
    for (var i = 0; i < colsEls.length; i++) {
      var el = colsEls[i];
      var d = (phase * speedOf(el)) % PERIOD;
      el.style.transform = "translate3d(0," + d.toFixed(2) + "px,0)";
    }
  }

  function tick(t) {
    raf = 0;
    if (!running || useWaapi) return;
    if (!lastT) lastT = t;
    var dt = Math.min(64, t - lastT);
    lastT = t;
    if (!reduced() && !document.hidden) {
      boost *= Math.pow(0.94, dt / 16.7);
      if (boost < 0.05) boost = 0;
      phase += (BASE_RATE * SPEED + boost) * dt / 1000;
      paint();
    }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (reduced() || !colsEls.length) return;
    running = true;
    if (useWaapi) {
      for (var i = 0; i < anims.length; i++) {
        anims[i].anim.playbackRate = 1 + boost / Math.max(1, BASE_RATE * SPEED);
        anims[i].anim.play();
      }
      return;
    }
    if (raf) return;
    lastT = 0;
    raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastT = 0;
    for (var i = 0; i < anims.length; i++) anims[i].anim.pause();
  }

  function onScroll() {
    /* 翻页时给一个短促的加速，让背景"跟着冲一下"。
       滚动速度取绝对值的 1/8，最多再叠 220px/s，然后自然衰减。 */
    var y = window.scrollY || 0;
    var dy = Math.abs(y - (onScroll._y === undefined ? y : onScroll._y));
    onScroll._y = y;
    /* 实例减半后 design px 也减半：上限 220→110、系数 0.12→0.06，
       保证滚动时那一下"跟着冲"的屏幕速度与原版一致。 */
    boost = Math.min(110, boost + dy * 0.06);
    if (!useWaapi || !anims.length) return;
    /* 2026-11-12：原来每个 scroll 事件都写 6 个 WAAPI 动画的 playbackRate，
       真机 touch 一秒上百次，主线程白忙。改成每帧最多写一次（boost 仍逐事件累计）。 */
    if (onScroll._raf) return;
    onScroll._raf = requestAnimationFrame(function () {
      onScroll._raf = 0;
      var rate = 1 + boost / Math.max(1, BASE_RATE * SPEED);
      for (var i = 0; i < anims.length; i++) anims[i].anim.playbackRate = rate;
      clearTimeout(onScroll._t);
      onScroll._t = setTimeout(function () { boost = 0; resetRate(); }, 420);
    });
  }

  /* ------------------------------------------------------------- 入口 */
  /* 精确裁决「这一刻该不该动」。
     forceVisible 由 IntersectionObserver / site:pagechange 传入；
     不传时自己按 #gaming 的矩形判断（用于初始化与 visibilitychange）。
     ⚠️ 不再用无条件 start() —— 它会把 IO 刚做出的「离屏暂停」裁决覆盖掉。 */
  function decide(forceVisible) {
    var visible = forceVisible;
    if (visible == null) {
      var sec = document.getElementById("gaming");
      if (!sec) visible = false;
      else {
        var r = sec.getBoundingClientRect();
        visible = r.bottom > 0 && r.top < (window.innerHeight || 800);
      }
    }
    if (visible) start(); else stopLoop();
  }

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
        decide();
      }
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { fit(); }, { passive: true });
    /* 同 albumwall：地址栏伸缩改的是 visualViewport，不是 window 尺寸，
       而背景层的 100dvh 会跟着变 —— 不重算就露边。 */
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () { fit(); }, { passive: true });
    }
    window.addEventListener("orientationchange", function () { fit(); }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      lastT = 0;
      if (document.hidden) stopLoop(); else decide();
    });

    /* 游戏屏离屏时把动画整个停掉。
       ⚠️ 2026-11-12 实机实测：rootMargin "30% 0px" 会把相邻屏也算"可见" ——
          停在 #gaming 时 #listen 完全在视口外（top=-745），对面那面墙的
          6 条 infinite 动画照样 running；反过来 #gaming 离屏时这 6 条也在跑。
          于是任何一屏都常驻 12 条动画 + 12 个巨型合成层。
          改成 0 边距，并用 site:pagechange 的页号做精确裁决：
          任何时刻只让当前屏那一面墙动。 */
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(function (entries) {
        decide(entries.some(function (e) { return e.isIntersecting; }));
      }, { rootMargin: "0px" });
      io.observe(document.getElementById("gaming"));
    }
    /* 页码广播比 IO 更准：翻页目标一确定就裁决一次，不用等下一帧。 */
    document.addEventListener("site:pagechange", function (e) {
      decide(e && e.detail ? e.detail.id === "gaming" : null);
    });

    fit();
    paint();
    decide();
  }

  /* 速度可调：0 = 静止，1 = 默认，3 = 明显流动。 */
  function setSpeed(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) v = 1;
    SPEED = Math.min(6, v);
    if (useWaapi) { buildAnims(); if (running) start(); } else { paint(); }
    return SPEED;
  }

  return {
    init: init,
    setSpeed: setSpeed,
    speed: function () { return SPEED; },
    /* 自检用 */
    fit: fit,
    scale: function () { return scale; },
    phase: function () {
      if (useWaapi && anims.length) {
        var a = anims[0];
        if (a.anim.currentTime != null) return (a.anim.currentTime / a.dur) * PERIOD;
      }
      return phase;
    },
    /* 测试/调试：按相位拨时间轴（不取消动画 —— 取消会让墙整块错位） */
    step: function (px) {
      phase += px;
      if (!anims.length) { paint(); return; }
      for (var i = 0; i < anims.length; i++) {
        var a = anims[i];
        a.anim.currentTime = ((phase * a.f) % PERIOD) / PERIOD * a.dur;
      }
    },
    period: function () { return PERIOD; },
    portraitOnly: function () { return portraitOnly; },
    count: function () { return grid ? grid.children.length : 0; },
    apps: function () { return apps.slice(); },
    refresh: function () { if (wall) { build(apps); if (!useWaapi) paint(); decide(); } }
  };
})();
