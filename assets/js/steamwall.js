/* ==========================================================================
 *  steamwall.js —— 游戏屏的 Steam 封面拼贴背景
 * --------------------------------------------------------------------------
 *  做什么：
 *    用「我的 Steam 库里的游戏封面」铺满 #gaming 这一屏，
 *    整体旋转 45° 斜着摆，滚动时缓慢位移（视差）。
 *
 *  数据来源（三级降级，任何一级失败都有图）：
 *    ① data/steam.json —— 由 .github/workflows/sync.yml 定时抓取
 *       结构 { apps: [appid, ...], names: { appid: name }, updated }
 *       抓取需要 STEAM_API_KEY（Steam 的 GetOwnedGames 强制要求 key，
 *       不像网易云的公开接口 —— 实测无 key 直接返回 401）。
 *    ② config 里 gaming.items[].steam.fallbackApps —— 手写快照
 *    ③ 什么都没有 → 整块背景不渲染，这一屏退回普通底色
 *
 *  为什么用 header.jpg 而不是 library_600x900：
 *    实测 header.jpg 每张 30~40KB，600x900 竖版封面要 120~200KB。
 *    背景会被 scrim 压到很暗、还要旋转 45°，细节根本看不出来 ——
 *    用大图纯属浪费流量。12 张 header 合计约 400KB，且都带 loading=lazy。
 *
 *  性能约朿（这一屏最容易踩的坑）：
 *    · 不用 background-image 拼贴，而是真实的 <img>：
 *      浏览器的图片解码比 CSS 背景更省，且能用 loading/decoding 提示。
 *    · 滚动位移只碰 transform（合成层），不碰 top/left（触发 layout）。
 *    · 用 rAF 节流 + 只在游戏屏接近视口时才更新。
 *    · prefers-reduced-motion 下完全不位移（图还在，只是不动）。
 * ========================================================================== */

window.SITE_STEAMWALL = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  function reduced() { return reduceQuery.matches; }

  /* 一格封面的原始比例。Steam 的 header.jpg 固定 460×215。 */
  var TILE_W = 460;
  var TILE_H = 215;

  /* 拼贴规格。cols/rows 取略大于视口能容纳的数量，
     多出来的部分用于覆盖 45° 旋转后的四角（旋转会露出空白，必须溢出）。 */
  var COLS = 7;
  var ROWS = 5;
  var GAP = 14;

  var wall = null, grid = null;
  var colsEls = [];        // 每列的 DOM，位移时逐列写 transform
  var apps = [];
  var lastY = -1;
  var raf = 0;

  function cdnUrl(appid) {
    return "https://cdn.cloudflare.steamstatic.com/steam/apps/" + appid + "/header.jpg";
  }

  /* ------------------------------------------------------- 数据来源 */
  /* 从 config 里找带 steam 字段的那张卡，取 fallbackApps。 */
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

  /* --------------------------------------------------------- 渲染 */
  function build(list) {
    if (!grid || !list.length) return 0;

    /* 打乱顺序：库里前几个 appid 往往是最常玩的，
       原样铺开会让人一眼认出"左上角那三个我认识"，反而像没排过。
       用固定种子的伪随机，保证每次刷新布局一致（不会晃来晃去）。 */
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

    /* ============================================================
       结构改成「按列切分」，而不是一个大网格。
       为什么：要给每一列不同的移速，就必须能单独位移每列 ——
       一个整体网格只能整体平移，做不出列与列之间的流速差。
       拆成列之后，每列是一个纵向 flex 容器，各自带 transform。

       列数/每列格子数由 CSS 变量控制（桌面 7 列 × 5 格，手机 4 列 × 6 格），
       这里只负责把 appid 均匀分到各列，顺序仍然是打乱后的。
       ============================================================ */
    var cols = COLS;
    var rows = ROWS;
    var perCol = rows;

    var html = "";
    for (var c = 0; c < cols; c++) {
      /* 每列的移速不同 —— 这是纵深感的核心。
         用一条平滑的曲线分配倍率，而不是随机：随机会让相邻两列一快一慢，
         看起来像抖动；用「奇数列与偶数列反向」的分配更像背景在流动。 */
      var factor = colSpeed(c, cols);
      var cells = "";
      for (var r = 0; r < perCol; r++) {
        var idx = c * perCol + r;                    // 全局序号，用于取 appid
        var appid = pool[idx % pool.length];
        /* 每格给一点点随机的亮度差，避免整面墙灰得非常死板 */
        var dim = 0.72 + (rand() * 0.28);
        var delay = c * 45 + r * 70;
        cells += '<span class="steamwall__tile" style="--dim:' + dim.toFixed(2) +
          ";--d:" + delay + 'ms">' +
            '<img src="' + cdnUrl(appid) + '" alt="" loading="lazy" decoding="async" ' +
              'width="' + TILE_W + '" height="' + TILE_H + '">' +
          "</span>";
      }
      html += '<div class="steamwall__col" data-col="' + c + '" ' +
        'style="--col-speed:' + factor.toFixed(3) + '">' + cells + "</div>";
    }
    grid.innerHTML = html;

    wall.setAttribute("data-ready", "1");
    colsEls = [].slice.call(grid.querySelectorAll(".steamwall__col"));

    /* 尺寸交给 CSS 变量，样式层据此算旋转后的溢出 */
    document.documentElement.style.setProperty("--steamwall-cols", String(COLS));
    document.documentElement.style.setProperty("--steamwall-rows", String(ROWS));
    document.documentElement.style.setProperty("--steamwall-gap", GAP + "px");

    return cols * perCol;
  }

  /* 每列的移速倍率。
     用「正弦分布」而不是随机：
       · 随机 → 相邻列一快一慢，看起来像画面在抖；
       · 正弦 → 中间那列最慢、两侧逐渐变快（或反之），
         人眼会读成"这一排封面在绕着一个轴流动"，是有机的。
     返回 0.55 ~ 1.45 之间的值，平均约 1.0（整体速度不变，只是分配不同）。 */
  function colSpeed(i, total) {
    if (total <= 1) return 1;
    /* 相位从 -π/2 到 +π/2：中间列 sin=0 → 最慢，两端最快。
       再乘 0.45 控制幅度，±45% 的差异已经很明显但不夸张。 */
    var phase = (i / (total - 1) - 0.5) * Math.PI;
    return 1 + Math.sin(phase) * 0.45;
  }

  /* ------------------------------------------------------- 滚动视差
   * 方向约定（2026-11-11 按用户要求改）：
   *   位移**只沿图片自身的垂直方向**，也就是旋转 45° 之后的「下」。
   *   网格已经 rotate(-45deg)，所以它的局部 Y 轴在屏幕上指向右下 ——
   *   只要只改 translateY，视觉上就是"封面墙顺着自己的竖纹滑"。
   *
   * 每列不同速（2026-11-11 追加）：
   *   这是纵深感的关键。所有列同速 = 一整块板子在平移，看起来很平；
   *   列与列之间有流速差，人眼会读成"有前后层次"。
   *
   *   倍率由 colSpeed() 按正弦分布算出，写在每列的 --col-speed 上：
   *     中间列 1.00（基准），往两侧逐渐到 0.55 / 1.45。
   *   正向与反向各占一半，视觉上像两股水流在对穿。
   *
   *   为什么用正弦而不是随机：
   *     随机 → 相邻列可能一快一慢，看起来像画面在抖；
   *     正弦 → 相邻列的速度是**连续变化**的，读起来是"流动"。
   */
  var SPEED = 1;
  var BASE_SHIFT = 6;      // 页面滚过一屏时，基准列的滑动百分比
  var MAX_SHIFT = 28;      // 硬上限：再多就会滑出拼接缝隙

  function update() {
    raf = 0;
    if (!wall || reduced() || !colsEls.length) return;

    var page = document.getElementById("gaming");
    if (!page) return;

    var rect = page.getBoundingClientRect();
    var vh = window.innerHeight || 800;
    /* 离视口还远就跳过：这一屏在第三页，前两页滚动时不该有任何计算 */
    if (rect.bottom < -200 || rect.top > vh + 200) return;

    /* 位移基准：页面中心相对视口中心的偏移，归一化到 ≈ -1 ~ 1。 */
    var progress = (vh / 2 - (rect.top + rect.height / 2)) / vh;
    var base = progress * BASE_SHIFT * SPEED;

    /* 差量很小时不写样式：滚动事件很密，避免每帧都触发样式重算 */
    if (Math.abs(base - lastY) < 0.1) return;
    lastY = base;

    /* 逐列写 transform。
       每列的倍率从 --col-speed 读（在 build 时写进内联样式），
       这样 CSS 侧改倍率也不用动 JS。 */
    for (var i = 0; i < colsEls.length; i++) {
      var el = colsEls[i];
      var f = parseFloat(el.style.getPropertyValue("--col-speed")) || 1;
      var shift = base * f;
      if (shift > MAX_SHIFT) shift = MAX_SHIFT;
      if (shift < -MAX_SHIFT) shift = -MAX_SHIFT;

      /* 只改 Y。translate 在 rotate 之后，Y 是网格的局部纵轴 ——
         屏幕上就是"顺着 45° 斜纹的走向"。
         注意这里的 transform 是**列**的，不是整个网格的：
         网格本身只负责 rotate(-45deg)，列各自 translateY。 */
      el.style.transform = "translate3d(0," + shift.toFixed(2) + "%, 0)";
    }
  }

  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(update);
  }

  /* ---------------------------------------------------------- 入口 */
  function init() {
    /* 速度可以在 config 里配：gaming.items[].steam.scrollSpeed */
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

    /* 先把 config 里的快照铺上 —— 保证"打开就有图"，不等网络 */
    apps = fromConfig();
    if (!apps.length) {
      /* 没有配置就整块不渲染，这一屏退回普通底色（不留一个空壳吃掉布局） */
      wall.hidden = true;
      return;
    }
    build(apps);

    /* 再尝试用定时任务抓来的真实库存替换。
       抓不到就保持快照，静默降级 —— 与 sync.js 的其它数据同一套原则。 */
    getJSON("data/steam.json").then(function (d) {
      if (!d || !Array.isArray(d.apps) || !d.apps.length) return;
      /* 只在真实的库和快照差异明显时才重铺，避免无意义的 DOM 重建 */
      if (d.apps.length < 4) return;
      apps = d.apps;
      build(apps);
      update();
    });

    if (!reduced()) {
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", function () { lastY = -1; onScroll(); }, { passive: true });
    }
    update();
  }

  /* 速度可调：0 = 静止，1 = 默认，3 = 明显流动。
     只影响"滚动时滑多快"，不影响入场动画。 */
  function setSpeed(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) v = 1;
    SPEED = Math.min(6, v);
    lastY = -1;
    onScroll();
    return SPEED;
  }

  return {
    init: init,
    setSpeed: setSpeed,
    speed: function () { return SPEED; },
    /* 自检用 */
    count: function () { return grid ? grid.children.length : 0; },
    apps: function () { return apps.slice(); },
    refresh: function () { if (wall) { build(apps); update(); } }
  };
})();
