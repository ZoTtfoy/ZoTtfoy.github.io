/* ==========================================================================
 *  preload.js —— 首屏就绪闸门 + 三屏图片预取
 * --------------------------------------------------------------------------
 *  为什么要有这个文件：
 *    第 3 屏（游戏）的背景是 48 张封面，第 2 屏（在听）是 144 张。
 *    它们和首屏抢同一条带宽 / 同一份解码内存，结果是"首屏刚出来就卡住"，
 *    在移动端甚至出现过整块面板没画出来的情况。
 *
 *  做法（用户 2026-11-11 的要求，逐条对应）：
 *    1. 「第一屏和第二屏缓存完毕之后再显示」→ 复用站点原有的 splash 当闸门：
 *       这两屏的图片全部 decode 完（或超时兜底）才放行，期间底部那条细线
 *       显示真实进度。
 *    2. 「并发缓存第三页」→ 闸门一开就立刻在后台预取第 3 屏，不阻塞。
 *    3. 「退出或刷新后校验版本，版本没变就只缓存拉取的图片」→
 *       版本 = 三屏图片 URL 集合的哈希。命中就**不设闸门**（直接进站），
 *       只对还没进缓存的图做一次 decode 暖机 —— 已缓存的图这一步是零成本。
 *
 *  两条硬性边界：
 *    · **绝不因为预取失败而让人进不去**：单张图 onerror / decode 失败都算完成，
 *      整轮还有 MAX_WAIT 兜底，到点就放行。
 *    · **减少动效模式不设闸门**（splash 本身就被内联脚本关掉了）。
 * ========================================================================== */
(function () {
  "use strict";

  var KEY_V = "zotrod-media-v";     /* 上次预取时的版本哈希 */
  var KEY_W = "zotrod-media-warm";  /* 是否已经完整预热过一次 */
  var MAX_WAIT = 4500;              /* 闸门硬上限：再慢也放人 */
  var PARALLEL = 8;                 /* 并发解码数：手机上每个 host 上限约 6，留点余量 */
  var START_WAIT = 2500;            /* 等 DOM 稳定（两面墙 + 战绩行）的上限 */

  /* 总截止时间从**脚本执行那一刻**算，不是从"开始预取"算。
     否则最坏情况是"等 DOM 2.5s + 等图 4.5s = 7s"，首访会被锁在门外太久。
     现在无论前面等了多久，留给人等待的总时长都是 MAX_WAIT。 */
  var DEADLINE = Date.now() + MAX_WAIT;

  var state = { gating: false, total: 0, done: 0, version: "", warm: false };

  function read(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式下忽略 */ } }

  function $(id) { return document.getElementById(id); }
  function sec(sel) { return document.querySelector(sel); }

  /* 屏幕顺序就是翻页顺序：hero(#top) → listen → gaming */
  function collect() {
    var order = [sec("#top") || sec(".hero"), sec("#listen"), sec("#gaming")];
    var out = [[], [], []];
    for (var s = 0; s < order.length; s++) {
      var root = order[s];
      if (!root) continue;
      var imgs = root.querySelectorAll("img");
      for (var i = 0; i < imgs.length; i++) {
        /* ⚠️ 只读 src 属性并归一化成绝对地址，不要用 currentSrc：
           currentSrc 在"已加载"时是绝对 URL、未加载时是空串（退回相对路径），
           同一张图会因为加载时机不同产出两种字符串，版本号就随机跳
           （实测 79d7uc / 158hwj8 来回变，闸门天天重开）。 */
        var raw = imgs[i].getAttribute("data-src") || imgs[i].getAttribute("src");
        if (!raw || raw.indexOf("data:") === 0) continue;
        try { raw = new URL(raw, location.href).href; } catch (e) { /* 保持原样 */ }
        out[s].push(raw);
      }
    }
    /* 去重：一面墙里同一张封面会排两次（首尾相接的那两份），
       按 URL 去重后要解码的其实是 72 / 24 张，不是 144 / 48。 */
    return out.map(function (list) {
      var seen = {}, uniq = [];
      for (var i = 0; i < list.length; i++) {
        if (!seen[list[i]]) { seen[list[i]] = 1; uniq.push(list[i]); }
      }
      return uniq;
    });
  }

  /* FNV-1a：够短、够稳，只用来判断"图片集合变没变"，不是安全哈希 */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h.toString(36);
  }

  /* 逐张 decode。成功的标准是"解码完成、可以直接画"，
     不是"下载完成" —— 后者还要再等一次解码，正是首帧卡顿的来源。
     ⚠️ 两个坑都踩过：
        1. `new Image()` 只被局部变量引用，循环结束后元素会被 GC，
           请求随之取消、onload 永不触发 → active 永远不降，整批卡死。
           所以用 pool 持有到全部结束。
        2. onload 和 decode() 都会回调，必须用 done 标记保证只结算一次，
           否则 settled 会被算多，提前 resolve。 */
  function load(urls, onEach) {
    return new Promise(function (resolve) {
      var n = urls.length;
      if (!n) { resolve(); return; }
      var i = 0, active = 0, settled = 0, pool = [];

      function start() {
        while (active < PARALLEL && i < n) {
          (function () {
            var img = new Image();
            var done = false;
            pool.push(img);
            active++;
            function fin() {
              if (done) return;
              done = true;
              active--;
              settled++;
              if (onEach) onEach(settled, n);
              if (settled >= n) { pool.length = 0; resolve(); return; }
              start();
            }
            img.decoding = "async";
            img.onload = fin;
            /* 一张图挂了也算"这件事结束了"：不能让整站卡在它身上 */
            img.onerror = fin;
            img.src = urls[i++];
            if (img.decode) img.decode().then(fin, fin);
          })();
        }
      }
      start();
    });
  }

  function splashEl() { return $("splash"); }

  function setProgress(p) {
    var el = splashEl();
    if (!el) return;
    el.classList.add("has-progress");
    el.style.setProperty("--splash-p", Math.max(0.02, Math.min(1, p)).toFixed(3));
  }

  /* 放行：闸门关闭 + 让 splash 退场。live.js 已经把 done 挂到 SITE_SPLASH 上。 */
  function release() {
    state.gating = false;
    if (window.SITE_PRELOAD) window.SITE_PRELOAD.gating = false;
    if (window.SITE_SPLASH && typeof window.SITE_SPLASH.done === "function") {
      window.SITE_SPLASH.done(true);
    } else {
      document.documentElement.dataset.loading = "0";
    }
  }

  /* 等"DOM 真正定下来"再收集 URL。
     ⚠️ 为什么不能只看 data-ready：两面封面墙和战绩列表各有各的异步来源
        （墙自己读 data/*.json，战绩走 sync.js 的 idle 调度），谁先谁后不固定。
        实测同一个页面两次访问会收集到两批不同的封面，版本号在
        79d7uc / 158hwj8 之间跳 —— 闸门就天天重开。
     所以改成**自稳定探测**：URL 集合连续 300ms 没变化，才认为定下来了。
        这比逐个追每个数据源的"完成信号"可靠，也不怕以后再加新的异步块。 */
  function whenSettled(cb) {
    var t0 = Date.now();
    var lastSig = "", stableAt = 0;
    (function loop() {
      var groups = collect();
      /* ⚠️ 只看第 1、2 屏：闸门等的是它们。第 3 屏的数据走 sync.js 的 idle 调度，
         最晚 2s 才到；把它算进"稳定"判据会让首访白白多等 2 秒。 */
      var crit = groups[0].concat(groups[1]);
      var sig = hash(crit.slice().sort().join("|")) + "/" + crit.length;

      if (sig !== lastSig) { lastSig = sig; stableAt = Date.now(); }
      var settled = stableAt && (Date.now() - stableAt >= 300);
      if (settled || Date.now() - t0 > START_WAIT) { cb(); return; }
      setTimeout(loop, 80);
    })();
  }

  function run() {
    var groups = collect();
    var s1 = groups[0], s2 = groups[1], s3 = groups[2];
    var crit = s1.concat(s2);
    var all = crit.concat(s3);

    /* 排序后再哈希：同一组封面不论渲染顺序如何都得到同一个版本号，
       否则"今天先画哪一张"这种无关差异会让闸门天天重开。 */
    /* 版本只由"闸门实际等待的那批图"决定 —— 这样版本变化 = 闸门该重跑，
       两者语义一致；第三屏的封面换了不需要为此挡住任何人。 */
    state.version = hash(crit.slice().sort().join("|"));
    state.total = crit.length;

    var warm = read(KEY_W) === "1" && read(KEY_V) === state.version;
    state.warm = warm;

    var shown = document.documentElement.dataset.loading === "1" && !!splashEl();

    if (warm) {
      /* 版本没变：不设闸门，直接进站。只对"本轮还没进缓存"的图做一次暖机，
         已缓存的图 decode() 是同步命中，几乎不花时间。 */
      release();
      load(all, null);
      return;
    }

    /* 老访客（warm 标记在）只是封面换了一批 → 不重新挡人，后台补图即可。
       挡人只在"这台设备第一次来"时发生，否则换了批封面反而让老用户多等。 */
    if (!shown || hadWarm) {
      /* 没有 splash（减少动效 / 二次进入本会话）或老访客：不挡人，后台预热 */
      release();
      load(all, null).then(function () {
        write(KEY_V, state.version);
        write(KEY_W, "1");
      });
      return;
    }

    /* 一张该等的图都没有 ≠ 缓存完了：多半是封面墙还没建好（它要等 data/*.json）。
       这时候放行等于闸门失效，所以再等一会儿重试，但不超过总时限。 */
    if (!crit.length && Date.now() < DEADLINE - 300) {
      setTimeout(function () {
        if (read(KEY_V) === state.version && read(KEY_W) === "1") { release(); return; }
        run();
      }, 200);
      return;
    }

    /* 已经超过总时限（比如数据接口很慢）→ 不再设闸门，后台补图 */
    if (Date.now() >= DEADLINE) {
      release();
      load(all, null).then(function () { write(KEY_V, state.version); write(KEY_W, "1"); });
      return;
    }

    /* 有 splash 且版本变了 → 设闸门：第一二屏 decode 完才放行 */
    state.gating = true;
    if (window.SITE_PRELOAD) window.SITE_PRELOAD.gating = true;
    setProgress(0);

    var released = false;
    function releaseOnce() {
      if (released) return;
      released = true;
      release();
    }

    /* 硬上限：CDN 抽风也不许把人锁在门外（按总截止时间算余量） */
    var left = Math.max(0, DEADLINE - Date.now());
    var cap = setTimeout(releaseOnce, left);

    load(crit, function (done, total) {
      state.done = done;
      setProgress(total ? done / total : 1);
    }).then(function () {
      clearTimeout(cap);
      write(KEY_V, state.version);
      write(KEY_W, "1");
      setProgress(1);
      /* 让进度条走到头的那一下被看见，再退场（80ms 足够，不拖节奏） */
      setTimeout(releaseOnce, 80);
      /* 第三屏并发预取：不 await，也不影响放行 */
      load(s3, null);
    });
  }

  /* 先占位声明 gating=true：live.js 的 900ms 兜底会看这个标记，
     避免它抢在预取开始前把 splash 收掉。真正要不要挡由 run() 决定。 */
  /* 开关放在 config.live.preload。**默认关**：闸门会让首访多等一会儿，
     排查渲染问题的阶段不该叠加这个变量。关掉时它完全不介入 ——
     不放行、不预取、不碰 splash，页面行为回到加这个文件之前。 */
  function enabled() {
    /* URL 可以强制开关，方便 A/B 与自检：
         ?preload=1 强制开   ?preload=0 强制关
       比改 config.js 快，也不影响线上默认值。 */
    var q = "";
    try { q = (/[?&]preload=([01])/.exec(location.search) || [])[1] || ""; } catch (e) { q = ""; }
    if (q === "1") return true;
    if (q === "0") return false;
    var live = (window.SITE_CONFIG || {}).live || {};
    return live.preload === true;
  }

  if (!enabled()) {
    /* 不接管 splash：把 gating 置假，live.js 的计时器照旧负责退场 */
    window.SITE_PRELOAD = { gating: false, disabled: true, version: function () { return ""; } };
    return;
  }

  window.SITE_PRELOAD = { gating: true, state: state, version: function () { return state.version; } };

  /* 老访客（本机已经完整预热过一次）不等 DOM 稳定，立刻放行：
     "等 300ms 稳定"是为了算准版本号，不该让回访的人陪着等。 */
  var hadWarm = read(KEY_W) === "1";
  if (hadWarm) release();

  function boot() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { whenSettled(run); }, { once: true });
    } else {
      whenSettled(run);
    }
  }
  boot();
})();
