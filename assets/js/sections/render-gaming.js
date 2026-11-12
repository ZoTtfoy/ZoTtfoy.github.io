/* ==========================================================================
 *  render-gaming.js —— Q3「游戏」屏的渲染
 * --------------------------------------------------------------------------
 *  原 render.js 第 462–822 行，逐行搬来，函数体未改一字。
 *
 *  为什么单独一个文件：这一屏是渲染层里最大的一块（361 行），而且**零对外
 *  交叉引用** —— 只依赖 kit 里的小工具，自己内部闭环。它是拆 render.js
 *  最安全的第一刀，也用来把「屏模块 → kit 注册 → 核心块表」这条接缝跑通。
 *
 *  约定：
 *    · 屏模块自己不碰 window.SITE_RENDER（那是核心的事）
 *    · 需要给外部用的函数，在文件末尾 K.register() 里登记
 *    · 块表条目仍由 render.js 统一持有，保证 layer 顺序一处可见
 * ========================================================================== */

(function (K) {
  "use strict";

  /* kit 提供渲染层共用的小工具；这里做成局部别名，
     于是搬过来的函数体一个字都不用改。 */
  var C = K.C, esc = K.esc, text = K.text, icon = K.icon;
  var $ = K.$, set = K.set, arr = K.arr, delay = K.delay;

  /* ========================================================== Q3 · 游戏 */
  /* 这一屏只有**一个模块**（用户的明确要求）：
       ┌ 顶栏：平台名 · 公开库存 · 好友码 ………… ↗ ┐   ← 整块
       │ 三格数据：游戏数量 / 时长 / 完美通关      │      点哪都进
       │ ─────────────────────────────────────── │      Steam 主页
       │ 游戏列表（可滚动，行数按可用高度算）        │
       └─────────────────────────────────────────┘
     DOM 分两半填：
       #gameRail  ← renderGaming()     顶栏
       #gameStats ← renderGameStats()  数据 + 列表
     外层 <a id="gameBoard"> 由 renderGaming() 设 href（来自 config 的 steam.profileUrl）。
     所以**不再有"复制好友码"这个动作** —— 点模块就是去主页，好友码只作为文字展示。
  */
  function steamItem() {
    return arr((C.gaming || {}).items).filter(function (g) {
      return g && !g.hidden && g.steam && g.steam.steamId;
    })[0] || null;
  }

  function renderGaming() {
    var rail = $("gameRail");
    var board = $("gameBoard");
    if (!rail) return;

    var g = steamItem();
    if (!g) {                       /* 没有 Steam 卡就整块不显示 */
      if (board) { board.hidden = true; board.removeAttribute("href"); }
      rail.innerHTML = "";
      return;
    }

    var href = (g.steam && g.steam.profileUrl) || g.link || "#";
    if (board) {
      board.hidden = false;
      board.href = href;
      board.setAttribute("aria-label", "打开我的 " + (g.name || "Steam") + " 主页");
    }

    /* 顶栏：左边是身份，右边是好友码。
       ⚠️ 好友码不再是按钮：它现在是模块的说明文字，点击由外层链接接管。 */
    rail.innerHTML =
      '<span class="gb-head">' +
        '<span class="gb-head__icon">' + icon(g.icon || "steam") + "</span>" +
        '<span class="gb-head__name">' + esc(g.name || "Steam") + "</span>" +
        (g.server ? '<span class="gb-head__meta">' + esc(g.server) + "</span>" : "") +
        (g.uid
          ? '<span class="gb-head__id"><i>' + esc(g.uidLabel || "好友码") + "</i>" +
            "<b>" + esc(g.uid) + "</b></span>"
          : "") +
        '<span class="gb-head__go">' + icon("arrow-up-right") + "</span>" +
      "</span>";
  }

  /* ---------- 三格数据 + 游戏列表 ---------- */
  /* 数据来自 data/steam.json：
       lib    { totalGames, totalHours, perfect, partial, source }
       recent [{ appid, name, hours, hours2w, cover, ach:{have,total} }]
     三个刻意的决定：
       1. 时长条按 **√ 归一化**：库里 2491h 和 2.7h 差 900 倍，
          线性会让除第一名以外全塌成 1px。
       2. 条的颜色按 appid 哈希出色相（同小黑盒：颜色不承载信息，只分开相邻行）。
       3. 只有**全成就**才挂奖章 + 强调色数字。没打满只写 x/y。 */
  function hueOf(appid) {
    var x = ((Number(appid) || 0) * 2654435761) % 4294967296;
    return Math.round(x * 0.6180339887) % 360;
  }

  function fmtH(n) {
    var v = Number(n) || 0;
    if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (v >= 10) return v.toFixed(1).replace(/\.0$/, "");
    return (Math.round(v * 10) / 10).toString();
  }

  function boardSummaryHtml(lib, rowCount) {
    if (!lib) return "";
    var hours = lib.totalHours
      ? '<b>' + esc(fmtH(lib.totalHours)) + "<small>h</small></b>"
      : "<b>—</b>";
    /* partial=true 时不能写"游戏时长"：那只是列表里这几款之和 */
    var hoursLabel = lib.partial ? "近 " + rowCount + " 款" : "游戏时长";
    return '<span class="gb-sum">' +
        '<span class="gb-sum__item"><b>' +
          esc(lib.totalGames ? lib.totalGames.toLocaleString("en-US") : "—") +
          "</b><i>游戏数量</i></span>" +
        '<span class="gb-sum__item">' + hours + "<i>" + hoursLabel + "</i></span>" +
        '<span class="gb-sum__item"><b>' + esc(String(lib.perfect || 0)) +
          "</b><i>完美通关</i></span>" +
      "</span>";
  }

  /* ---------- 最近入库 ----------
     Steam 的 Web API **没有"购买时间"** 这个字段（GetOwnedGames 只给
     rtime_last_played = 最后游玩）。所以这条是"记账"算出来的：
     每次同步把全库 appid 存进 data/steam.json，下次对比，新出现的即新入库。
     第一次同步只建基线（ownedSince 记下日期），之后才会陆续有内容。
     ⚠️ 没有数据时整条不渲染 —— 空标题比没有更难看。 */
  function recentlyAddedHtml(added, since) {
    var list = arr(added).filter(function (g) { return g && g.appid; });

    /* 空态：一条记录都没有时，早先整块不渲染 —— 那一行就凭空少了 30px，
       看起来像"这块坏了"。现在补一句实话：从哪天开始记账。
       Steam 接口没有"购买时间"，记录只能从第一次建立基线那天算起，
       所以这个日期是准的，不是占位文案。 */
    if (!list.length) {
      if (!since) return "";
      return '<span class="gb-new is-empty">' +
          '<span class="gb-new__label">最近入库' +
            '<i>' + esc(String(since).slice(5).replace("-", "/")) + " 起</i>" +
          "</span>" +
          '<span class="gb-new__hint">还没有新入库</span>' +
        "</span>";
    }

    var MAX = 8;
    var head = list.slice(0, MAX).map(function (g) {
      var url = "https://cdn.akamai.steamstatic.com/steam/apps/" + g.appid + "/header.jpg";
      /* --h 是这块的兜底色相：新入库的游戏最容易没有 header.jpg，
         图挂了就藏起 img，露出 .gb-new__item 自己的色相渐变，
         而不是留一个空洞（列表行的 is-blank 是同一套思路）。 */
      return '<span class="gb-new__item" style="--h:' + hueOf(g.appid) + '"' +
               ' title="' + esc(g.name || "") +
               (g.at ? "（" + esc(g.at) + " 入库）" : "") + '">' +
               '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async"' +
               ' onerror="this.style.display=\'none\'">' +
             "</span>";
    }).join("");

    return '<span class="gb-new">' +
        '<span class="gb-new__label">最近入库' +
          (since ? '<i>' + esc(String(since).slice(5).replace("-", "/")) + " 起</i>" : "") +
        "</span>" +
        '<span class="gb-new__row">' + head +
          (list.length > MAX ? '<b class="gb-new__more">+' + (list.length - MAX) + "</b>" : "") +
        "</span>" +
      "</span>";
  }

  /* 列表里一行。封面挂了就换下一个源，全挂了露兜底图标 ——
     绝不出现"空黑框"（深空当铺的 header.jpg 就是 404）。 */
  function rowHtml(g, i, maxH) {
    var cover = String(g.cover || "").trim();
    var fb = String(g.coverFallback || "").trim();
    var ach = g.ach && g.ach.total > 0 ? g.ach : null;
    var done = ach && ach.have >= ach.total;
    var pct = Math.max(4, Math.round(Math.sqrt((Number(g.hours) || 0) / maxH) * 100));
    var hue = hueOf(g.appid);

    return '<span class="gb-row' + (done ? " is-done" : "") + '" data-reveal' +
             ' style="' + delay(i, 45) + "--c:hsl(" + hue + " 72% 56%);" + '">' +
             '<span class="gb-row__cover' + (cover ? "" : " is-blank") + '">' +
               '<i class="gb-row__ph">' + icon("gamepad") + "</i>" +
               (cover
                 ? '<img src="' + esc(cover) + '" alt="" loading="lazy" decoding="async"' +
                   (fb ? ' data-fb="' + esc(fb) + '"' : "") +
                   ' onerror="var f=this.dataset.fb;if(f){this.removeAttribute(\'data-fb\');this.src=f}else{this.parentNode.classList.add(\'is-blank\');this.remove()}">'
                 : "") +
             "</span>" +
             '<span class="gb-row__main">' +
               '<span class="gb-row__name">' + esc(g.name || "") + "</span>" +
               '<span class="gb-row__stats">' +
                 '<b class="gb-row__hours">' + fmtH(g.hours) + "<small>h</small></b>" +
                 '<span class="gb-row__bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' +
                 (g.hours2w > 0
                   ? '<span class="gb-row__w" title="最近两周">' + fmtH(g.hours2w) + "<small>h</small></span>"
                   : '<span class="gb-row__w is-empty"></span>') +
               "</span>" +
             "</span>" +
             (ach
               ? '<span class="gb-row__ach">' +
                   (done ? '<span class="gb-row__medal">' + icon("award") + "</span>" : "") +
                   '<span class="gb-row__ach-num"><b>' + ach.have + "</b>/" + ach.total + "</span>" +
                 "</span>"
               : '<span class="gb-row__ach is-none">—/—</span>') +
           "</span>";
  }

  /* 渲染行数的硬上限。数据端（sync-steam.mjs 的 ROWS）也给 30，
     这里再兜一层：万一 JSON 是旧的 / 手工改大的，DOM 也不会失控。
     为什么是 30：一屏最多也就 6~7 行，30 行 = 滚动 4~5 屏，
     再多既没人看，也会让首次渲染变重。 */
  var ROW_LIMIT = 30;

  function renderGameStats(data) {
    var box = $("gameStats");
    if (!box) return 0;

    var lib = !Array.isArray(data) && data ? data.lib : null;
    var added = !Array.isArray(data) && data ? data.added : null;
    var since = !Array.isArray(data) && data ? data.ownedSince : "";
    var rows = arr(Array.isArray(data) ? data : (data && data.recent))
      .filter(function (g) { return g && (g.hours > 0 || (g.ach && g.ach.total > 0)); })
      .slice(0, ROW_LIMIT);

    if (!rows.length) { box.hidden = true; box.innerHTML = ""; fitBoardList(); return 0; }

    var maxH = rows.reduce(function (m, g) { return Math.max(m, Number(g.hours) || 0); }, 0) || 1;

    box.innerHTML =
      boardSummaryHtml(lib, rows.length) +
      recentlyAddedHtml(added, since) +
      '<span class="gb-list" id="gbList">' +
        rows.map(function (g, i) { return rowHtml(g, i, maxH); }).join("") +
      "</span>" +
      /* 列表被截断时，底部给一条渐隐 + 一句"查看全部" —— 
         不然滚到一半的人不知道下面还有。 */
      '<span class="gb-more" id="gbMore" hidden>' +
        '<span class="gb-more__fade"></span>' +
        '<span class="gb-more__txt">查看全部' +
          (lib && lib.totalGames ? " " + lib.totalGames + " 款" : "") +
          icon("arrow-up-right") + "</span>" +
      "</span>";

    box.hidden = false;
    if (window.SITE_MOTION && typeof window.SITE_MOTION.revealScan === "function") {
      window.SITE_MOTION.revealScan(box);
    }
    fitBoardList();
    /* 行是**这一刻**才进 DOM 的，而 fonts.ready 可能在更早就已经 resolve 了 ——
       所以必须在这里再挂一次：字体真正落地时按新行高再算一遍。 */
    refitOnFonts();
    return rows.length;
  }

  /* 列表高度 = 可用高度能放几行。
     ⚠️ 为什么不写死 max-height：全站有一层等比缩放（scale.js 改根字号），
        行高会跟着 rem 变；而且桌面/平板/手机的可视高度差得很远。
        直接量第一行的实际高度再算行数，缩放变了自然跟着变。

     ⚠️ 为什么用"区块内的相对位置"而不是 window.innerHeight - list.top：
        这个函数在数据到达时就会跑一次，那时 Q3 还在屏幕外（list.top ≈ 1700），
        拿视口算出来是负数 → 只放 2 行，而且滚到这一屏也不会重算。
        改成两者都减区块的 top，差值就是**布局内**的位置，与滚动无关。 */
  function fitBoardList() {
    var list = $("gbList");
    var more = $("gbMore");
    var board = $("gameBoard");
    var sec = $("gaming");
    if (!list || !board || !sec || !list.firstElementChild) return 0;

    /* 还没布局完（区块隐藏 / 行高为 0）→ 下一帧再来 */
    if (!sec.clientHeight || !list.firstElementChild.getBoundingClientRect().height) {
      if (!fitBoardList._raf) {
        fitBoardList._raf = requestAnimationFrame(function () {
          fitBoardList._raf = 0;
          fitBoardList();
        });
      }
      return 0;
    }

    var secTop = sec.getBoundingClientRect().top;
    var padBottom = parseFloat(getComputedStyle(sec).paddingBottom) || 48;
    /* 上限永远是"一屏"：用区块自身高度会**自我放大**（列表撑高区块 →
       下一轮按更大的高度算 → 行更多），所以取 min(区块高, 视口高)。 */
    var budget = Math.min(sec.clientHeight, window.innerHeight || 800);

    /* "查看全部"要先显形才量得到高度；它现在是列表下方的独立底带 */
    if (more) more.hidden = false;
    var strip = (more && more.offsetHeight) || 46;

    /* 归零再量：列表可能还带着上一轮的 max-height 与底带 */
    list.style.maxHeight = "none";
    board.style.paddingBottom = "";
    var listTop = list.getBoundingClientRect().top - secTop;
    /* 尾部余量 22：给页码条 / 回顶按钮留的。原来是 18，实测 920×720 那档
       容器 579 + 上下内边距 144 = 723 > 720，正好差 3~4px。 */
    var room = budget - listTop - padBottom - 22 - strip;

    var bt = parseFloat(getComputedStyle(list).borderTopWidth) || 0;
    var avail = room - bt;

    /* 逐行累加**每行自己的真实高度**，累到放不下为止。
       ⚠️ 为什么不用"行高 × 行数"（这是上一版的写法，实测被裁）：
          · 首行没有 border-top，比其它行矮 1px；
          · 字体分片加载后行高会从 63.25 变成 64。
        任何"平均值 × N"都会差 1~3px，而这几像素正好表现为
        "最后一行被裁掉一条边"。逐行累加量的就是真实占位，不存在这个问题。 */
    var kids = list.children;
    function measureFits(limit) {
      var sum = 0, n = 0;
      for (var i = 0; i < kids.length; i++) {
        var h = kids[i].getBoundingClientRect().height;
        if (h <= 0) break;
        if (sum + h > limit) break;
        sum += h;
        n++;
      }
      return { sum: sum, n: n };
    }

    var fit = measureFits(avail);
    var useStrip = true;

    /* 连一行都放不下时，先把"查看全部"的底带也让出来（920×720 那档就差这 4px）。
       让出底带还放不下，才退到"只画一行"—— 空白面板比略溢出更糟。 */
    if (fit.n < 1) {
      fit = measureFits(avail + strip);
      useStrip = false;
    }

    if (fit.n >= kids.length) {             /* 全装得下：不滚、不留底带 */
      list.classList.remove("is-scroll");
      board.style.paddingBottom = "";
      if (more) more.hidden = true;
      return kids.length;
    }

    if (fit.n < 1) {                        /* 极矮窗口：保底一行 */
      fit.n = 1;
      fit.sum = kids[0].getBoundingClientRect().height;
      useStrip = false;
    }

    /* 列表 = 整整 fit.n 行；需要时底带单独占 strip，两者不重叠 */
    board.style.paddingBottom = useStrip ? strip + "px" : "";
    if (more) more.hidden = !useStrip;
    list.style.maxHeight = (fit.sum + bt) + "px";
    list.classList.add("is-scroll");

    /* 终局校验：上面所有算术都基于"可用高度"的估算，而真正决定成败的是
       **区块的实测高度**。只要它超过一屏，就按差值退掉整行 ——
       这是"一屏一页"唯一的硬指标，比任何常数都可靠。
       （实测 920×720 那档容器 579 + 内边距 144 = 723 > 720，
         靠调 18→22 没能解决，因为溢出不在列表里。） */
    var minH = kids[0].getBoundingClientRect().height;
    var guard = 0;
    while (guard++ < 6 && fit.n > 1) {
      /* ⚠️ 容差 3px：区块有 `border-top: 1px`，`offsetHeight` 天然比视口多 1px。
         用 0.5 做阈值会让守卫**永远成立**，一路把行砍到 1 行（实机踩过：
         392×744 上从 3 行变 1 行）。只有真的溢出 3px 以上才收行。 */
      var overH = sec.offsetHeight - (window.innerHeight || 0);
      if (overH <= 3) break;
      fit.n -= 1;
      fit.sum = Math.max(minH, fit.sum - kids[fit.n].getBoundingClientRect().height);
      list.style.maxHeight = (fit.sum + bt) + "px";
    }
    return fit.n;
  }

  /* 字体就绪后重算一次（模块加载时先挂一次，覆盖"行还没进 DOM"的情况）。
     注意：fonts.ready 只 resolve 一次，所以 renderGameStats 里也会在插完行
     之后再挂一次 —— 那次挂的才是真正生效的。 */
  function refitOnFonts() {
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { fitBoardList(); }).catch(function () {});
    }
  }
  refitOnFonts();

  /* 窗口变了 / 档位变了都要重算行数 —— 导出给外部调 */
  window.addEventListener("resize", function () {
    if (!$("gbList")) return;
    clearTimeout(fitBoardList._t);
    fitBoardList._t = setTimeout(fitBoardList, 120);
    /* 第二次复算：120ms 那次往往赶在"档位切换 / 根字号写完"之前，
       量到的还是上一档的高度，于是差 4~5px。等布局定下来再校一次。 */
    clearTimeout(fitBoardList._t2);
    fitBoardList._t2 = setTimeout(fitBoardList, 420);
  }, { passive: true });

  /* ------------------------------------------------------------------
     登记给核心：只有这四个是对外接口（sync.js / 调试 / 块表要用）。
     其余 steamItem / hueOf / fmtH / rowHtml / fitBoardList 的内部依赖
     都是本闭包里的局部函数，不必外泄。 */
  K.register("gaming", {
    renderGaming: renderGaming,
    renderGameStats: renderGameStats,
    fitBoardList: fitBoardList,
    recentlyAddedHtml: recentlyAddedHtml
  });
})(window.SITE_RENDER_KIT);
