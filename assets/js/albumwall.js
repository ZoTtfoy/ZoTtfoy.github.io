/* ==========================================================================
 *  albumwall.js —— Q2「在听」的专辑封面拼贴背景
 * --------------------------------------------------------------------------
 *  2026-11-11：按用户要求把黑胶换成「这周听的 100 首歌的封面」。
 *
 *  ── 需求逐条落地 ──────────────────────────────────────────────────────
 *    · 6 行，每行由专辑封面横向拼接
 *    · 1/3/5 行左移、2/4/6 行右移（方向交替），且各行速度不同（差速）
 *    · 每周轮换一次：按 ISO 周数做种子打乱这 100 首，周一零点自动换一批
 *    · 图片交接缝隙、上下交接处都要处理干净
 *
 *  ── 几何：固定实例 + 整体等比缩放（沿用 Q3 封面墙验证过的思路）──────
 *    实例 2400×2400px，封面格 400×400（正方形），6 行 × 每行单份 6 张。
 *    每行渲染**两份完全相同**的 6 张（12 张 = 4800px 宽）。
 *
 *    缩放 scale = max(W/2400, H/2400) × 1.05
 *      两个方向都 ≥ 视口，四角不会露白。
 *      1440×900 → 0.63    390×844 → 0.37    1920×1080 → 0.84
 *
 *  ── 无缝循环（关键）─────────────────────────────────────────────────
 *    每行的 X 位移限制在 [-2400, 0]，内容占 [0, 4800]：
 *      左移行  X = -((phase × 倍率) % 2400)   → 从 0 走到 -2400
 *      右移行  X = ((phase × 倍率) % 2400) - 2400 → 从 -2400 走到 0
 *    任意 X 都有内容覆盖 [X, 4800+X] ⊇ [0,2400]，永远填满。
 *    X 在端点归位时，两份内容相同 → 画面接得上，看不出跳变。
 *
 *  ── 缝隙 ────────────────────────────────────────────────────────────
 *    gap:0 + display:block 去掉 inline 基线缝；
 *    每格 width/height 比标称多 1px，再用 margin -1px 把占位收回去 ——
 *    相邻格**重叠 1px**，缩放产生的亚像素缝就被盖住了，
 *    而占位仍精确等于 400px，循环周期不会漂移。
 *    行与行之间同理（多出的 1px 盖住下一行顶部），这就是"上下交接处"。
 *
 *  ── 性能 ────────────────────────────────────────────────────────────
 *    6 行 × 12 张 = 72 个 <img>，源图 400×400（约 10~60KB），
 *    唯一 URL 约 36 个。IntersectionObserver 在离屏时把 rAF 整个停掉。
 * ========================================================================== */

window.SITE_ALBUMWALL = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};
  var reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  function reduced() { return reduceQuery.matches; }

  var INST = 2400;                // 实例边长
  var TILE = 400;                 // 封面格
  var ROWS = 6;
  var PERIOD = 6 * TILE;          // 一份 6 张 = 2400，也是循环周期
  var SAFETY = 1.05;
  var BASE_RATE = 30;             // px/s，SPEED=1 时基准行的流速

  /* 每行速度。方向由索引奇偶决定，倍率让相邻行还有快慢差 ——
     只交替方向不差速的话，看起来会像整块板子在左右搓。 */
  var ROW_RATE = [1.00, 0.82, 1.18, 0.91, 1.09, 0.95];

  var wall = null, grid = null;
  var rowEls = [];
  var io = null;              // 可见性裁决者（模块级，异步换数据后要复用）
  var covers = [];
  var scale = 1;
  var weekKey = 0;

  var SPEED = 1;

  /* ------------------------------------------------------------ 每周种子
     ISO 8601 周：周一为一周起点，跨年时归到所属周的那一年。
     用 年×100+周 做种子，所以每周一零点布局自动换一批，不需要定时任务。 */
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    var y = t.getUTCFullYear();
    var jan1 = new Date(Date.UTC(y, 0, 1));
    var w = Math.ceil((((t - jan1) / 86400000) + 1) / 7);
    return y * 100 + w;
  }

  /* 固定种子的洗牌：同一周每次刷新结果完全一致，不会晃 */
  function seededShuffle(list, seed) {
    var a = list.slice(), s = seed >>> 0;
    function rand() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    }
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 列表里用的是 120y120 小图（34px 缩略图够用），
     背景要 400y400。网易云的 ?param= 直接换尺寸即可，不用再抓一次接口。 */
  function bigCover(url) {
    if (!url) return "";
    return /param=\d+y\d+/.test(url)
      ? url.replace(/param=\d+y\d+/, "param=400y400")
      : url + (url.indexOf("?") >= 0 ? "&" : "?") + "param=400y400";
  }

  /* 封面没加载出来时的兜底色相：由 URL 字符串哈希出来。
     同一个封面永远同一个颜色（不会每次刷新换色），不同封面互相错开。
     为什么不用 --bg-soft：那是个接近白的灰，弱网下几块白瓦片
     会让整面墙看起来像"没渲染完"——游戏墙踩过同一个坑。 */
  function hueOf(url) {
    var s = String(url || ""), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
    return h % 360;
  }

  function fromConfig() {
    var f = (C.listen && C.listen.fallback) || [];
    return f.map(function (t) { return bigCover(t.cover); }).filter(Boolean);
  }

  function getJSON(url) {
    if (!url || typeof fetch !== "function") return Promise.resolve(null);
    return fetch(url, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* ------------------------------------------------------------- 适配 */
  function fit() {
    if (!grid) return;
    /* ⚠️ 2026-11-11 修「手机上看背景是错的」。
       根因不是尺寸算错，是**量错了对象**：
         · .albumwall 是 position:absolute; inset:0，高度跟的是 #listen 的
           CSS 高度（100vh / 100dvh）；
         · 这里原来读的是 window.innerHeight —— 那是"当前可见高度"。
       iOS Safari 地址栏展开时，innerHeight 比 100vh 小 60~120px；
       安卓 WebView、以及"这一屏内容比视口高"的降级布局里也一样。
       用小的那个数算 scale，实例就撑不满区块 —— 底部露一条空白，
       而且因为 scale 偏小，封面看起来也比桌面"缩水"了。
       clientWidth/clientHeight 是布局尺寸，不受浏览器 chrome 影响。
       只有在元素还没布局（0×0）时才退回窗口尺寸。 */
    var w = wall ? wall.clientWidth : 0;
    var h = wall ? wall.clientHeight : 0;
    if (!w || !h) { w = window.innerWidth || 1280; h = window.innerHeight || 800; }
    /* 行是无限长的（每行两份 6 格循环），所以横向只要一个周期盖住宽度；
       纵向是实打实的 6 行，必须 6×400×scale ≥ h。
       两个约束取大者 —— 任何一边不满足都会露白。 */
    scale = Math.max(w / PERIOD, h / INST) * SAFETY;
    grid.style.setProperty("--aw-scale", scale.toFixed(4));
    grid.style.setProperty("--aw-inst", INST + "px");
    grid.style.setProperty("--aw-tile", TILE + "px");
    grid.style.setProperty("--aw-period", PERIOD + "px");
  }

  /* ------------------------------------------------------------- 渲染 */
  function build(list) {
    if (!grid || !list.length) return 0;

    weekKey = isoWeek(new Date());
    /* 去重：排行里同一首歌常出现好几次，连着铺三张一样的封面很显眼 */
    var seen = {}, uniq = [];
    list.forEach(function (u) {
      if (u && !seen[u]) { seen[u] = 1; uniq.push(u); }
    });
    var pool = seededShuffle(uniq, weekKey * 7919 + 20261111);
    var need = ROWS * 6;                       // 6 行 × 单份 6 张

    var html = "";
    for (var r = 0; r < ROWS; r++) {
      var seq = [];
      for (var k = 0; k < 6; k++) {
        var pick = pool[(r * 6 + k) % pool.length];
        seq.push(pick);
      }
      /* 两份完全相同：位移走到端点归位时画面接得上 */
      var cells = "";
      for (var copy = 0; copy < 2; copy++) {
        for (var j = 0; j < 6; j++) {
          /* --h：封面没到 / 加载失败时的兜底色相。
             和游戏墙同一个理由 —— 别用近白底色，几块白瓦片
             会让整面墙看起来像"没渲染完"。 */
          cells += '<img src="' + seq[j] + '" alt="" decoding="async" ' +
            /* 6 行 × 12 格 × 2 份 = 144 个 <img>，首屏一上来就要抢带宽和解码。
               试过 loading="lazy"，但被 .albumwall 的 overflow:hidden 裁掉的
               瓦片会被判成"还不需要"，永远不加载，墙面就花了 —— 撤掉。
               只保留 fetchpriority="low"：不影响加载，只把优先级排到内容后面。 */
            'fetchpriority="low" ' +
            'width="' + TILE + '" height="' + TILE + '" ' +
            'style="--h:' + hueOf(seq[j]) + '" ' +
            'onerror="this.classList.add(\'is-broken\')">';
        }
      }
      var dir = r % 2 === 0 ? "left" : "right";
      html += '<div class="albumwall__row" data-row="' + r + '" data-dir="' + dir + '" ' +
        'style="--row-rate:' + ROW_RATE[r].toFixed(3) + '">' + cells + "</div>";
    }
    grid.innerHTML = html;
    wall.setAttribute("data-ready", "1");
    wall.setAttribute("data-week", String(weekKey));
    rowEls = [].slice.call(grid.querySelectorAll(".albumwall__row"));
    installKeyframes();
    fit();
    applyTiming();
    return ROWS * 12;
  }

  /* ------------------------------------------------------------- 运动
   *  2026-11-11：从「rAF 每帧写 transform」改成**纯 CSS 合成器动画**。
   *
   *  为什么改 —— 不是为了好看，是实测必须改：
   *    每帧用 JS 写 6 个 4800px 宽图层的 transform，主线程被占满，
   *    停在「在听」页时帧率直接掉到 30fps
   *    （verify-drag 的 p50 从 16.7ms 变 33.3ms，断言 18ms 上限就红了）。
   *    CSS animation + transform 由合成器线程驱动，主线程一帧都不用管 ——
   *    同样 6 层在动，主线程开销接近 0，而且滚动、点击都不会和它抢。
   *
   *  差速与方向仍然是用户要的：
   *    · 方向：1/3/5 行 aw-move-left（0 → -2400），2/4/6 行 aw-move-right（-2400 → 0）
   *    · 差速：每行 --aw-dur 不同，= 2400 / (30px/s × SPEED × 该行倍率)
   *      rate 1.00 → 80s 一圈；0.82 → 97.6s；1.18 → 67.8s
   *
   *  @keyframes 由 installKeyframes() 用常量现算再注入，不写死在 CSS 里 ——
   *  否则改了 TILE / PERIOD 就得记得同步改 CSS 里那两行 -2400px，
   *  改漏了表现是"跑到一半跳一下"，极难查。
   */

  var styleEl = null;

  function installKeyframes() {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.id = "aw-keyframes";
    /* 两份内容完全相同，所以从 0 走到 -PERIOD 归位时画面接得上。
       用 translate3d 而不是 translateX：多一个 Z 轴=0 明确要求图层提升。 */
    styleEl.textContent =
      "@keyframes aw-move-left{from{transform:translate3d(0,0,0)}" +
      "to{transform:translate3d(-" + PERIOD + "px,0,0)}}" +
      "@keyframes aw-move-right{from{transform:translate3d(-" + PERIOD + "px,0,0)}" +
      "to{transform:translate3d(0,0,0)}}";
    document.head.appendChild(styleEl);
  }

  /* 每行时长 = 走完一个周期需要的时间。倍率越大越快（时长越短）。 */
  function applyTiming() {
    var base = PERIOD / BASE_RATE;         // SPEED=1、倍率=1 时的秒数
    for (var i = 0; i < rowEls.length; i++) {
      var rate = parseFloat(rowEls[i].style.getPropertyValue("--row-rate")) || 1;
      var dur = base / (Math.max(0.05, SPEED) * rate);
      rowEls[i].style.setProperty("--aw-dur", dur.toFixed(2) + "s");
    }
  }

  function start() {
    if (!wall) return;
    if (reduced()) { wall.setAttribute("data-paused", "1"); return; }
    wall.removeAttribute("data-paused");
  }

  function stopLoop() {
    if (wall) wall.setAttribute("data-paused", "1");
  }

  /* 测试与调试用：当前虚拟位移（px）。
     直接读动画 currentTime，换算成"走了多少像素"，语义和之前的 phase 一致。 */
  function phase() {
    if (!rowEls.length || typeof rowEls[0].getAnimations !== "function") return 0;
    var a = rowEls[0].getAnimations()[0];
    if (!a || a.currentTime == null) return 0;
    return (+a.currentTime / 1000) * BASE_RATE * SPEED;
  }
  function paint() { /* 合成器动画不需要每帧重绘；保留这个名字给外部调用 */ }

  /* ------------------------------------------------------------- 入口 */
  function init() {
    (function () {
      var l = C.listen || {};
      if (typeof l.wallSpeed === "number") SPEED = l.wallSpeed;
    })();

    wall = document.getElementById("albumWall");
    grid = document.getElementById("albumWallGrid");
    if (!wall || !grid) return;

    /* 先铺 config 里的快照，保证打开就有图 */
    covers = fromConfig();
    if (covers.length) build(covers);

    /* 再用真实的「这周听的 100 首」替换 */
    getJSON("data/netease.json").then(function (d) {
      if (!d || !Array.isArray(d.tracks) || d.tracks.length < 6) return;
      covers = d.tracks.map(function (t) { return bigCover(t.cover); }).filter(Boolean);
      build(covers);
      /* ⚠️ 数据回来后必须重算每行时长，否则新行没有 --aw-dur = 不动。
         （实测过：72 张图全加载、方向也对，但相位恒为 0 ——
           因为 build() 重建了 DOM，旧的时长写在已经被替换掉的节点上。） */
      applyTiming();
      /* 再重新裁决一次"要不要在动"：第一次 build 若因为没数据而跳过，
         init 末尾的 start() 是空操作。重新 observe 让 IO 按当前
         真实可见性决定，比无脑 start() 更省 —— 否则离屏的屏也一直在动。 */
      if (io) {
        var sec = document.getElementById("listen");
        if (sec) { io.unobserve(sec); io.observe(sec); }
      } else {
        start();
      }
    });

    window.addEventListener("resize", function () { fit(); }, { passive: true });
    /* iOS / 安卓的地址栏伸缩只改 visualViewport，不一定发 window.resize；
       而它一变，section 的 100dvh 就跟着变 —— 不重算 scale 就会露边。
       fit() 只读布局尺寸，重复调用是幂等的，不需要节流。 */
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () { fit(); }, { passive: true });
    }
    window.addEventListener("orientationchange", function () { fit(); }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopLoop(); else start();
    });

    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(function (entries) {
        var visible = entries.some(function (e) { return e.isIntersecting; });
        if (visible) start(); else stopLoop();
      }, { rootMargin: "30% 0px" });
      io.observe(document.getElementById("listen"));
    }

    fit(); applyTiming(); start();
  }

  function setSpeed(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) v = 1;
    SPEED = Math.min(6, v);
    /* 0 = 停：把整面墙暂停，而不是设一个"无穷长的时长" */
    if (SPEED === 0) { stopLoop(); return SPEED; }
    start();
    applyTiming();
    return SPEED;
  }

  return {
    init: init,
    setSpeed: setSpeed,
    speed: function () { return SPEED; },
    fit: fit,
    scale: function () { return scale; },
    /* ⚠️ 必须直接挂函数引用。
       写成 `phase: function () { return phase; }` 会因为同名提升而返回
       **函数本身**，调用方 `.phase().toFixed()` 直接报 TypeError ——
       这类"导出名和内部名撞车"的坑不会有任何提示，只能靠测试发现。 */
    phase: phase,
    /* 动画改由合成器跑，逐帧步进已无意义。保留这个名字给旧调用方，
       语义变成"把每行动画快进 px 像素对应的时长"（测试循环归位用）。 */
    step: function (px) {
      var ms = (Number(px) || 0) / BASE_RATE * 1000;
      rowEls.forEach(function (el) {
        var a = el.getAnimations && el.getAnimations()[0];
        if (a) a.currentTime = (Number(a.currentTime) || 0) + ms;
      });
    },
    period: function () { return PERIOD; },
    week: function () { return weekKey; },
    weekFor: isoWeek,
    covers: function () { return covers.slice(); },
    refresh: function () { if (grid) { build(covers); applyTiming(); } },
    count: function () { return grid ? grid.children.length : 0; }
  };
})();
