/* ==========================================================================
 *  repair.js —— Q4 的维修估价器（跳转式四步向导）
 * --------------------------------------------------------------------------
 *  流程：
 *      ① 设备  →  ② 项目  →  ③ 材料  →  ④ 加项  →  出价格
 *    每一步只显示一个问题，**选完立刻跳到下一步**，不用点「下一步」按钮。
 *    顶部那排小格子是进度条，也是返回键：点任意一格可以回去改。
 *
 *  为什么改成一次只问一件事：
 *    原来四个问题同时铺在卡里，读者要自己判断"从哪开始、还差几项"，
 *    手机上 12 个按钮挤在一起，误触率也高。一次一问之后，选项可以放大到
 *    44px 的触控高度，卡片高度反而更矮 —— Q4 是唯一「一屏差几十像素」的屏。
 *
 *  为什么不放 render.js：
 *    它是有状态的交互组件（每次点击都要重算 + 重画），
 *    render.js 的职责是"把静态数据填进骨架"，两者混在一起会互相拖累。
 *
 *  算法（全部数据来自 config.js → repair.calculator）：
 *      基准价 = 项目价 × 设备系数
 *      估算值 = 基准价 × 材料系数 + 加项固定价
 *      区间   = 估算值 × range[0] .. 估算值 × range[1]      // 默认 ±15%
 *  之所以输出区间而不是一个数：实际维修总有浮动，报一个精确数字反而不可信。
 * ========================================================================== */

(function () {
  "use strict";

  var REPAIR = (window.SITE_CONFIG || {}).repair || {};
  var CFG = REPAIR.calculator || {};
  var CUR = CFG.currency || "¥";
  var RANGE = (Array.isArray(CFG.range) && CFG.range.length === 2) ? CFG.range : [0.85, 1.15];

  var state = { device: "", service: "", material: "", extra: "" };
  var mount = null;

  /* 四个问题。改动这里的文案不用碰其它逻辑；
     想换问法可以在 config.js 的 calculator.questions 里覆盖。 */
  var STEPS = [
    { key: "device",   label: "设备", q: "这是什么设备？" },
    { key: "service",  label: "项目", q: "要修的是哪一项？" },
    { key: "material", label: "材料", q: "配件用什么料？" },
    { key: "extra",    label: "加项", q: "需要加急、上门或备份吗？" }
  ];
  var QA = CFG.questions || {};
  var cursor = 0;                    // 0~3 = 第几步，4 = 看结果

  /* ------------------------------------------------ 交互节奏（三个常量）
   *
   * CONFIRM_MS —— 选中后到前进之间的那一小段停顿。
   *   为什么需要它：原来是"点下即跳"，手指稍微滑一下选中了错的那项，
   *   人已经被带到下一步了 —— 想改就得回头点进度条。加这 240ms 后，
   *   按钮先实心高亮一下（看得见的"我记下了"），再走。
   *   240ms 是实测的折中：低于 160ms 几乎看不出来，高于 320ms 开始觉得卡。
   *
   * REPEAT_LOCK —— 同一次连点的忽略窗口。狂点时浏览器会把多次点击
   *   排进同一帧，不加锁会连续走好几步（实测 5 连点直接冲到结果页）。
   *
   * 两者配合起来就是"防抖"：连点的后续事件被 REPEAT_LOCK 丢掉，
   *   而已经排上的前进定时器会被新点击取消重排 —— 用户有反悔的余地。 */
  var CONFIRM_MS = 240;
  var REPEAT_LOCK = 90;

  var pendingTimer = null;     // 已排上的"前进"，新点击会取消它
  var lastPickAt = 0;          // 上次有效点击的时间戳
  var suppressPush = false;    // 由 popstate 触发的渲染不回写历史

  /* 历史条目里标记向导步骤用的键。
     与 motion.js 的锚点 pushState 共用 history.state，所以用独立键名，
     两边互不覆盖（motion 那边写的是 hash，不写 state）。 */
  var HKEY = "calc";

  /* ---------------------------------------------------------------- 提示 */
  function toast(msg) {
    if (window.SITE_MOTION && typeof window.SITE_MOTION.toast === "function") {
      window.SITE_MOTION.toast(msg);
      return;
    }
    /* 兜底：motion.js 还没初始化也能提示。
       直接操作那个 aria-live 容器，但用行内样式保证可见 ——
       正常路径上样式由 motion.css 的 .toast.is-visible 提供，
       这里只是不让"没有 motion 模块"变成"没有任何反馈"。 */
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("is-visible"); }, 2400);
  }


  /* --------------------------------------------------------------- 工具 */
  function list(v) { return Array.isArray(v) ? v : []; }
  function find(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function pool(key) { return list(CFG[key + "s"]); }   // device → devices
  function nameOf(key, id) {
    var it = find(pool(key), id);
    return it ? it.name : "";
  }

  /* 某个项目是否适用于当前设备。
     项目上的 devices 为空 = 全设备通用。 */
  function supports(service, deviceId) {
    return !service.devices || service.devices.indexOf(deviceId) >= 0;
  }

  /* 当前设备能做的项目。设备还没选时先给全量，避免出现空白步骤。 */
  function validServices(deviceId) {
    if (!deviceId) return list(CFG.services);
    return list(CFG.services).filter(function (s) { return supports(s, deviceId); });
  }

  /* ----------------------------------------------------------- 价格计算 */
  function compute() {
    var dev = find(list(CFG.devices), state.device);
    var svc = find(list(CFG.services), state.service);
    var mat = find(list(CFG.materials), state.material);
    var ext = find(list(CFG.extras), state.extra);
    if (!dev || !svc || !mat || !ext) return null;

    var base = (svc.price || 0) * (dev.factor || 1);
    var mid = base * (mat.factor || 1) + (ext.add || 0);

    return {
      lo: Math.round(mid * RANGE[0]),
      hi: Math.round(mid * RANGE[1]),
      base: base,
      mid: mid,
      dev: dev, svc: svc, mat: mat, ext: ext
    };
  }

  /* --------------------------------------------------------------- 校验 */
  /* 出结果之前必须过这一关，返回「问题描述数组」，空数组才算通过。
   *
   * 为什么要单独一层：compute() 只会"缺东西就返回 null"，它不区分
   *   「还没选」和「选了但矛盾」，也不检查数值本身是否正常。
   *   而结果是直接展示给访客的价格，报错成本比多一层判断高得多 ——
   *   宁可拦下来让他改，也不能算出一个 NaN 或者负号开头的价格。
   *
   * 关于"逻辑冲突"：需求里举的例子是「完美无瑕 + 屏幕碎裂」，
   *   但这个估价器的维度是 设备→项目→材料→加项，没有"成色"这一项，
   *   所以那句话不构成真实冲突。这里真正存在、且配置里就能发生的冲突是
   *   **项目与设备不兼容**（比如「游戏机」+「换屏」—— 配置里换屏只挂给了
   *   手机/平板/笔记本）。这类冲突在改配置时很容易被忽略，
   *   而 pick() 清空旧项目的行为只能挡住"换设备后残留"，
   *   挡不住直接构造出来的状态（比如从后台改了配置）。
   *   所以按数据本身推导，不写死某两个选项互斥。 */
  function validate() {
    var problems = [];

    var dev = find(list(CFG.devices), state.device);
    var svc = find(list(CFG.services), state.service);
    var mat = find(list(CFG.materials), state.material);
    var ext = find(list(CFG.extras), state.extra);

    if (!dev) problems.push("还没选设备");
    if (!svc) problems.push("还没选维修项目");
    if (!mat) problems.push("还没选配件");
    if (!ext) problems.push("还没选加项");

    /* 项目与设备不兼容 —— 这是这一套数据里唯一真实的逻辑冲突 */
    if (dev && svc && !supports(svc, dev.id)) {
      problems.push("「" + dev.name + "」做不了「" + svc.name + "」");
    }

    /* 价格本身的合理性。四项齐全时才算，缺项已经在上面报过了。 */
    if (!problems.length) {
      var r = compute();
      if (!r) {
        problems.push("选项不完整，算不出价格");
      } else if (!isFinite(r.lo) || !isFinite(r.hi) || !isFinite(r.mid)) {
        problems.push("价格算不出来（配置里有非数字）");
      } else if (r.lo < 0 || r.hi < 0 || r.mid < 0) {
        problems.push("价格出现负数（配置里可能有负的系数）");
      } else if (r.hi < r.lo) {
        problems.push("区间上下限反了（检查 range 配置）");
      }
    }

    return problems;
  }

  /* ---------------------------------------------------- 结果页的一句人话
   * 只印一个数字，访客的感受是"报价单"；加一句解释，才是"人在跟他说话"。
   *
   * ⚠️ 这句话必须由**真实数据**推出来，不能是随机夸奖。
   *    需求里举的例子是「您的设备成色不错」—— 但这个估价器并不知道成色
   *    （它只问设备/项目/材料/加项），说"成色不错"就是编的。
   *    所以下面每一句都对应一个确定的事实：用了什么料、做的是什么活、
   *    有没有加急。读者对着上面的算式能验证这句话，它才有分量。 */
  function toneOf(r) {
    /* 材料决定"修完的手感"，这是访客最关心的那一层 */
    var byMaterial = {
      oem: "按原装件报的价，修完手感最接近出厂状态。",
      brand: "一线副厂的件，日常使用基本看不出差别，价格也松快些。",
      value: "走国产件，预算压到了最低；寿命会短一些，但够用。"
    }[r.mat.id] || "";

    /* 保养类项目的价值不在"修"，而在"省" */
    if (r.svc.id === "clean" || r.svc.id === "system") {
      return "这类活本身不贵，定期做一次，能省下将来更大的开销。";
    }

    /* 加急已经把等待时间算进价格了，值得点明，否则访客会觉得"贵在哪" */
    if (r.ext.id === "rush") {
      return byMaterial + " 加急费用已含在内，当天可取。";
    }

    return byMaterial;
  }

  /* --------------------------------------------------------------- 渲染 */
  /* 顶部进度条：四格，各自是一个按钮。
     已答的格子显示答案本身（「手机」而不是「设备」）——
     读者不用记自己选过什么，扫一眼就知道。 */
  function trailHtml() {
    return '<ol class="calc__trail">' +
      STEPS.map(function (s, i) {
        var ans = nameOf(s.key, state[s.key]);
        var cls = "calc__trail__item" +
          (i === cursor ? " is-now" : "") +
          (i !== cursor && ans ? " is-done" : "");
        return '<li class="calc__trail__li">' +
          '<button class="' + cls + '" type="button" data-goto="' + i + '"' +
            (i === cursor ? ' aria-current="step"' : "") +
            ' aria-label="第 ' + (i + 1) + " 步 · " + esc(s.label) +
              (ans ? "，已选 " + esc(ans) : "，未选") + '">' +
            '<span class="calc__trail__n">' + (i + 1) + "</span>" +
            '<span class="calc__trail__t">' + esc(ans || s.label) + "</span>" +
          "</button></li>";
      }).join("") + "</ol>";
  }

  /* 选项底下那行小字：把这个选项"贵在哪、便宜在哪"说清楚。
     这些信息本来只写在 title 里 —— 手机上根本没有 hover，等于没写。
     服务项没有 note 字段，就用价格顶上，正好对应结果里那条算式。 */
  function noteOf(key, it) {
    if (!it) return "";
    var n = it.note || "";
    if (key === "service") return CUR + it.price + " 起" + (n ? " · " + n : "");
    if (key === "material") return (n ? n + " · " : "") + "系数 ×" + it.factor;
    if (key === "device") return (n ? n + " · " : "") + "系数 ×" + it.factor;
    if (key === "extra") return (it.add ? "+" + CUR + it.add + (n ? " · " + n : "") : (n || "不加钱"));
    return n;
  }

  /* 当前这一问。选项做成按钮，点一下 = 选定 + 前进。

     排成两列是为了"每一步都是两行"：四组选项的条数是 4 / 4 / 3 / 4
     （项目按设备过滤后最多 4 个，游戏机只有 2 个），
     两列下分别是 2 / 2 / 2 / 2 行 —— 高度天然对齐，
     不需要给卡片锁死一个最小高度，也就不会在「材料」那一步留下半张空白。
     奇数个（材料 3 个）让最后一个横跨两列；只剩 2 个时改单列，
     两个按钮各占一行，仍然是两行高。 */
  function stageHtml() {
    var s = STEPS[cursor];
    var items = s.key === "service" ? validServices(state.device) : pool(s.key);
    var q = QA[s.key] || s.q;
    var first = find(items, state[s.key]) || items[0];

    /* 兜底：某个设备在配置里一个项目都没挂（改配置时容易漏）。
       与其渲染一排空按钮，不如说清楚并给一条退路。 */
    if (!items.length) {
      return '<div class="calc__stage" tabindex="-1">' +
          '<p class="calc__label"><b>' + (cursor + 1) + "</b>" + esc(q) + "</p>" +
          '<p class="calc__note">这个设备暂时没有对应项目，换一个设备试试。</p>' +
          '<div class="calc__foot">' + backBtn() +
            '<button class="calc__reset" type="button" data-goto="0">' +
              window.siteIcon("refresh") + "重新选设备</button></div>" +
        "</div>";
    }

    return '<div class="calc__stage" tabindex="-1">' +
        '<p class="calc__label" id="calcQ"><b>' + (cursor + 1) + "</b>" + esc(q) +
          (cursor === 0 ? "<i>选中后自动到下一步</i>" : "") +
        "</p>" +
        '<div class="calc__opts' + (items.length <= 2 ? " is-single" : "") +
          (items.length > 2 && items.length % 2 ? " is-odd" : "") +
          '" role="group" aria-labelledby="calcQ">' +
          items.map(function (it) {
            return '<button class="calc__opt" type="button"' +
              ' data-opt="' + s.key + '" data-value="' + esc(it.id) + '"' +
              ' aria-pressed="' + (it.id === state[s.key] ? "true" : "false") + '"' +
              ' title="' + esc(it.note || it.name) + '">' +
              esc(it.name) +
            "</button>";
          }).join("") +
        "</div>" +
        '<p class="calc__note" data-note>' + esc(noteOf(s.key, first)) + "</p>" +
        '<div class="calc__foot">' + backBtn() + "</div>" +
      "</div>";
  }

  /* 「上一步」按钮。做成低调的灰白次要按钮：它是"反悔"用的，
     不该和选项抢注意力。
     ⚠️ 第 1 步没有上一步，但**不能直接不渲染** —— 那会让第 2 步的卡片
     比第 1 步高出 40px，每前进一次整个卡片就长一截，下面的报价表跟着跳。
     所以第 1 步留一个占位（visibility:hidden），高度一致、但不可见也不可聚焦。
     这是本项目一直守的"每步卡片等高"契约（见 fit.css 的注释）。 */
  function backBtn() {
    var ghost = cursor <= 0;
    return '<button class="calc__back' + (ghost ? " is-ghost" : "") + '" type="button"' +
      (ghost ? ' tabindex="-1" aria-hidden="true"' : "") +
      ' data-calc-back>← 上一步</button>';
  }

  function resultHtml(r) {
    return '<div class="calc__result" tabindex="-1" aria-live="polite">' +
        '<p class="calc__price"><small>' + esc(CUR) + "</small>" +
          r.lo + " – " + r.hi + "</p>" +
        /* 一句"人话"。只给数字像报价单，补一句由数据推出来的解释，
           访客才知道这个价贵在哪、值不值。 */
        '<p class="calc__tone">' + esc(toneOf(r)) + "</p>" +
        '<p class="calc__detail">' +
          esc(r.svc.name) + " " + esc(CUR) + r.svc.price +
          " × " + esc(r.dev.name) + " " + r.dev.factor +
          " × " + esc(r.mat.name) + " " + r.mat.factor +
          (r.ext.add ? " + " + esc(r.ext.name) + " " + esc(CUR) + r.ext.add : "") +
        "</p>" +
        '<div class="calc__foot">' +
          /* 结果页的主按钮改成实心强调色：到这里只剩"再来一次"这一个动作，
             它该是屏幕上看一眼就能点的那个东西。 */
          '<button class="calc__again" type="button" data-calc-reset>' +
            window.siteIcon("refresh") + "重新估价</button>" +
          '<button class="calc__back" type="button" data-calc-back>' +
            "回去改一项</button>" +
        "</div>" +
        '<p class="calc__more">实际以拆机检测为准</p>' +
      "</div>";
  }

  /* 校验没过时显示的块。
     与"结果"占同一个位置（都是 .calc__result），但说清楚缺什么 ——
     原来的实现只有一句「选项不完整，无法估价」，访客不知道该改哪。 */
  function problemHtml(problems) {
    return '<div class="calc__result calc__result--warn" tabindex="-1" role="alert">' +
        '<p class="calc__warn-title">还差一点，算不出价格</p>' +
        '<ul class="calc__warn-list">' +
          problems.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") +
        "</ul>" +
        '<div class="calc__foot">' +
          '<button class="calc__back" type="button" data-calc-back>回去改一项</button>' +
          '<button class="calc__reset" type="button" data-calc-reset>' +
            window.siteIcon("refresh") + "重新估价</button>" +
        "</div>" +
      "</div>";
  }

  function render() {
    if (!mount) return;

    var atEnd = cursor >= STEPS.length;
    var r = compute();
    /* 结果页必须过校验才显示价格。
       顺序是先 compute 再 validate —— validate 内部也会调 compute，
       但这里先算一次是为了"缺项时 r 为 null"这个快路径不白跑。 */
    var problems = atEnd ? validate() : [];

    mount.innerHTML =
      '<div class="calc__head">' +
        '<h3 class="calc__title">' + window.siteIcon("calc") + esc(CFG.title || "估个价") + "</h3>" +
        (CFG.hint ? '<span class="calc__hint">' + esc(CFG.hint) + "</span>" : "") +
      "</div>" +

      trailHtml() +

      (atEnd
        ? (problems.length
            ? problemHtml(problems)
            : (r ? resultHtml(r) : problemHtml(["选项不完整，无法估价"])))
        : stageHtml());

    // 高度变了，翻页引擎要重新量一次，否则吸附落点会偏
    if (window.Paged && typeof window.Paged.refresh === "function") window.Paged.refresh();
  }

  /* --------------------------------------------------------------- 交互 */
  /* 前进到「下一个还没答的问题」；都答完了就看结果。
     从第 3 步回头改材料时，加项已经答过 —— 这时直接出结果，
     而不是把读者又拖回第 3 步：他改完就是要看新价格。 */
  function advance(from) {
    // 设备只对应一个可修项目时，替读者选掉，省一次点击
    if (from === 0 && !state.service) {
      var only = validServices(state.device);
      if (only.length === 1) state.service = only[0].id;
    }

    var next = STEPS.length;
    for (var i = from + 1; i < STEPS.length; i++) {
      if (!state[STEPS[i].key]) { next = i; break; }
    }
    go(next);
  }

  /* ------------------------------------------------------- 历史（后退键）
   * 目标：按浏览器后退，回到向导的上一步，而不是直接离开页面。
   * 做法：每前进一步 push 一个历史条目，条目里只带 { calc: 步骤号 }。
   *
   * 为什么用 replaceState 建立基线：
   *   进入页面时历史栈里没有我们自己的条目，此时的 state 可能是 null
   *   （motion.js 的锚点跳转只写 hash、不写 state）。先在当前位置
   *   replace 一个 { calc: 0 }，第一步才有"可退回"的参照。
   *
   * 为什么 pushState 时用 URL 空串：
   *   本站是翻页式单页，步骤不值得改变地址栏 —— 改 hash 会触发
   *   motion.js 的锚点逻辑和 paged.js 的翻页，反而把用户带走。
   *   传空串 = 只压一条历史，不动地址。 */
  function pushStep(step) {
    if (suppressPush) return;
    try {
      var base = history.state && typeof history.state === "object" ? history.state : {};
      var next = {};
      for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k];
      next[HKEY] = step;
      history.pushState(next, "", location.href.split("#")[0] + (location.hash || ""));
    } catch (e) { /* 隐私模式 / file:// 下可能抛错，不影响向导本身 */ }
  }

  function currentHistoryStep() {
    var st = history.state;
    return st && typeof st[HKEY] === "number" ? st[HKEY] : null;
  }

  function go(i) {
    cursor = Math.max(0, Math.min(STEPS.length, i));
    /* 只在步骤**真的变了**的时候压历史。
       同一格重复点、或从第 3 步改完材料直接出结果（步骤号会跳），
       都按"当前所在步骤"记，避免后退时出现两个一模一样的条目。 */
    pushStep(cursor);
    render();
    focusStep();
  }

  /* 后退 / 前进：把向导拨到历史条目里记的那一步。
     不回写历史（suppressPush），否则按一次后退会立刻又压一条，
     形成"退不动"的死循环。 */
  function onPopState(e) {
    var st = e.state || {};
    var step = typeof st[HKEY] === "number" ? st[HKEY] : null;

    /* 清掉还没执行的前进：用户已经按后退了，不能让他两秒后又跳回来 */
    clearTimeout(pendingTimer);
    pendingTimer = null;

    suppressPush = true;
    if (step !== null) {
      cursor = Math.max(0, Math.min(STEPS.length, step));
    } else if (cursor > 0) {
      /* 退到了向导之外的历史条目：回到第一步，但不要把人踢出页面。
         这时地址栏已经是别的锚点了，paged.js 自己会跟着滚。 */
      cursor = 0;
    }
    render();
    focusStep();
    suppressPush = false;
  }

  /* ------------------------------------------------------------- 选择
   * 点一下选项做三件事：
   *   1. 立刻给这一项实心高亮（看得见的确认）
   *   2. 排一个 CONFIRM_MS 之后的前进
   *   3. 如果这段时间里用户又点了同一组的别的项，取消上一个前进、重排
   *
   * 第 3 条就是"防错"的落点：误触时有 240ms 可以改主意，
   * 而不是被硬生生带到下一步再回头。 */
  function pick(key, value) {
    var now = Date.now();
    /* 狂点保护：同一次连击里的后续事件直接丢掉。
       不加这个的话，浏览器把多次 click 排进同一帧时会连走好几步。 */
    if (now - lastPickAt < REPEAT_LOCK) return;
    lastPickAt = now;

    var stepIdx = -1;
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].key === key) stepIdx = i;

    if (state[key] !== value) {
      state[key] = value;
      /* 换了设备，原来选的项目可能做不了（比如游戏机不能换屏）。
         清空而不是自动顶替：下一步就会问「要修哪一项」，
         自动顶替会让读者以为自己选过。 */
      if (key === "device") {
        var svc = find(list(CFG.services), state.service);
        if (svc && !supports(svc, value)) state.service = "";
      }
    }

    /* 只改这一组按钮的选中态，不整卡重画 ——
       重画会把刚加上去的动画一起抹掉，看起来像闪了一下。 */
    var opts = mount.querySelectorAll('[data-opt="' + key + '"]');
    Array.prototype.forEach.call(opts, function (b) {
      var on = b.getAttribute("data-value") === value;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("is-picked", on);
    });

    /* 说明行跟着换到刚选中的那一项 —— 高亮的同一时刻，
       下面那行小字要说明"你刚选的是什么"，否则确认感只落在按钮上。 */
    var noteBox = mount.querySelector("[data-note]");
    var picked = find(pool(key), value);
    if (noteBox && picked) noteBox.textContent = noteOf(key, picked);

    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      advance(stepIdx);
    }, CONFIRM_MS);
  }

  function reset() {
    /* 重置也要清掉排着的前进，否则点了「重新估价」之后
       那个旧定时器还会把界面推到下一步。 */
    clearTimeout(pendingTimer);
    pendingTimer = null;
    state.device = state.service = state.material = state.extra = "";
    cursor = 0;
  }

  /* 清空并重画。
     reset() 只动状态、不碰 DOM（渲染是另一个职责），所以真实入口点需要一个
     把两件事串起来的函数 —— 否则每个调用方都得记得"reset 之后还要 render"。
     早先 onClick 里是手写这两句，测试脚本漏了 render，结果界面还停在上一步、
     点选项命中了别的步骤的按钮。把两件事绑在一起，这个坑就不存在了。 */
  function resetAll() {
    reset();
    render();
    focusStep();
  }

  /* 「上一步」：纯粹往回退一格，不清任何选项。
     上一步按钮不进历史（它是"撤销历史"），用 replaceState 把当前位置
     改写成新步骤 —— 否则连点几次上一步会压出一串条目，
     再按浏览器后退反而"往前"走。 */
  function back() {
    if (cursor <= 0) return;
    clearTimeout(pendingTimer);
    pendingTimer = null;
    cursor -= 1;
    try {
      var st = history.state && typeof history.state === "object" ? history.state : {};
      st[HKEY] = cursor;
      history.replaceState(st, "", location.href);
    } catch (e) {}
    render();
    focusStep();
  }

  /* 跳转后把焦点交给新的问题块。
     不直接聚焦第一个选项：那样鼠标用户手一抖按到回车，就替自己选了一项。
     聚焦容器后按 Tab 才进入选项，读屏也会先念出问题。 */
  function focusStep() {
    if (!mount) return;
    var t = mount.querySelector(cursor >= STEPS.length ? ".calc__result" : ".calc__stage");
    if (t && document.activeElement !== t) t.focus({ preventScroll: true });
  }

  /* 指针掠过或键盘移焦时，把那一条的说明换到下面 —— 不改变任何状态，
     所以可以随便划过，不会误选。 */
  function onHover(e) {
    var t = e.target;
    if (!t.closest) return;
    var el = t.closest("[data-opt]");
    if (!el || !mount.contains(el)) return;
    var key = el.getAttribute("data-opt");
    var it = find(pool(key), el.getAttribute("data-value"));
    var box = mount.querySelector("[data-note]");
    if (box && it) box.textContent = noteOf(key, it);
  }

  function onClick(e) {
    var t = e.target;
    if (!t.closest) return;

    var opt = t.closest("[data-opt]");
    if (opt && mount.contains(opt)) {
      e.preventDefault();
      pick(opt.getAttribute("data-opt"), opt.getAttribute("data-value"));
      return;
    }
    /* 「上一步」与进度条的跳转都要先撤掉排队中的前进 ——
       否则用户在 240ms 内点「上一步」，两帧后又被推回下一步。 */
    var jump = t.closest("[data-goto]");
    if (jump && mount.contains(jump)) {
      e.preventDefault();
      clearTimeout(pendingTimer);
      pendingTimer = null;
      go(+jump.getAttribute("data-goto"));
      return;
    }
    if (t.closest("[data-calc-back]") && mount.contains(t.closest("[data-calc-back]"))) {
      e.preventDefault();
      back();
      return;
    }
    if (t.closest("[data-calc-reset]")) {
      e.preventDefault();
      resetAll();
    }
  }

  /* 方向键在同一组选项里挪焦点，但**不**替人选中：
     这里一选中就会跳到下一步，用方向键「浏览」会变成连环跳。
     Enter / 空格是原生按钮行为，选中并前进。 */
  function onKey(e) {
    var k = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(k) < 0) return;

    var btn = document.activeElement;
    if (!btn || !btn.getAttribute || !btn.getAttribute("data-opt")) return;

    var key = btn.getAttribute("data-opt");
    var all = Array.prototype.slice.call(mount.querySelectorAll('[data-opt="' + key + '"]'));
    var i = all.indexOf(btn);
    if (i < 0) return;

    var next = (k === "ArrowRight" || k === "ArrowDown") ? i + 1 : i - 1;
    if (next < 0) next = all.length - 1;
    if (next >= all.length) next = 0;

    e.preventDefault();
    all[next].focus();
  }

  /* --------------------------------------------------------------- 初始化 */
  /* 手机上把报价表默认收起。
     为什么放在 repair.js 而不是 render.js：
       render.js 只负责产出结构，不知道"当前该不该展开"这种设备相关的策略；
       而 repair.js 本来就是 Q4 的交互层，折叠状态属于它。
     为什么不在 CSS 里做：<details> 的展开态是 DOM 属性，CSS 改不了，
       只能用 JS 摘掉 open。 */
  var phoneMQ = window.matchMedia("(max-width: 680px)");

  /* 什么时候该折叠报价表？
       手机（≤680px）           —— 竖屏一屏根本放不下展开的价目
       矮窗口（density 的 tight/mini）—— 展开时它一张就吃掉整屏（实测 535px）
     第二个判断交给 density.js 统一出（它是"视口能吃多少"的唯一决策处），
     这里只问结果，不自己再写一套阈值 —— 否则又变成两处逻辑打架。 */
  function shouldFold() {
    if (phoneMQ.matches) return true;
    if (window.SITE_DENSITY && typeof window.SITE_DENSITY.quoteFolded === "function") {
      return window.SITE_DENSITY.quoteFolded();
    }
    return false;
  }

  /* 只设初值，不参与之后的每次决策。
     ⚠️ 这个函数曾经被 main.js、boot()、以及跨 680px 三处调用，
     每次都按"手机就折、桌面就开"强制改 open ——
     而 density.fitQuote 是按"展开后装不装得下"决定，两者结论常常相反。
     实测放大回 1440×900：fitQuote 在 3052ms 正确展开，foldQuote 在 3552ms
     又把它折回去（那时 level 已是 full，但 shouldFold 读到的中间态是 true）。
     所以现在用 foldedOnce 锁住：首帧给个合理初值，之后交给 fitQuote。 */
  var foldedOnce = false;

  function foldQuote() {
    var d = document.getElementById("quoteDetails");
    if (!d) return;
    if (!foldedOnce) {
      foldedOnce = true;
      if (shouldFold()) d.removeAttribute("open");
      else d.setAttribute("open", "");
    }
    watchQuote(d);
  }

  /* 展开/收起会让 Q4 的高度跨过一屏，必须让翻页引擎重算一次：
     展开后它会把 Q4 标成 data-tall、吸附降级为 proximity，
     用户才能滚着把价目表看完（否则一次滑动就直接翻页，下半截永远看不到）。
     收起后重算会把状态还原。 */
  /* ---------------------------------------------------------- 展开高度
     谁知道"报价表展开后有多高"？只有 repair 自己。
     它生成了这个 <details>、知道里面几行、也知道 Q4 的容器是谁。

     为什么必须由 repair 出这个数、而不是让 density 去数 DOM 再乘常数：
       · 数行 × 猜行高，是**估算**。估算必须在"偏大"和"偏小"之间精确落位：
         偏大则大屏也判装不下（表再也展不开），偏小则矮屏保持展开（溢出 75px）。
         实测两个方向都踩到了，调常数只是在两种错误之间来回。
       · 这个高度可以**直接读**，只要在"展开状态"下读一次，然后记下来。

     折叠时 .quote__body 是 display:none，量不到 —— 那就不要在折叠时量。
     在展开时量一次、缓存住，之后折展都用缓存值。这是缓存，不是估算。 */
  var openDeltaH = 0;      // 展开比折叠多出来的高度
  var openDeltaKey = "";   // 量它时的"环境指纹"，环境一变就作废

  /* 环境指纹：这份缓存只在同样的排版条件下有效。
     ⚠️ 早先只存数字、不存条件，于是 full 档量的 270px 被 tight 档直接拿去用 ——
     而 tight 档内边距更小、字号更小，真实增量只有 ~180px。
     拿大数去判断"装不下"，结果矮窗口里报价表该折却一直展开（实测 1100×580）。
     指纹由三样决定：档位、密度级别、根字号（等比缩放的产物）。 */
  function envKey() {
    return [
      document.documentElement.dataset.vp || "",
      document.documentElement.dataset.scale || "",
      (mount && mount.closest("[data-fit]") && mount.closest("[data-fit]").dataset.fit) || ""
    ].join("|");
  }

  /* 量一次并缓存。调用方负责确保此刻是展开态，或接受它自己临时展开。 */
  function measureOpenDelta() {
    var d = document.getElementById("quoteDetails");
    if (!d) return openDeltaH;
    var wasOpen = d.open;
    if (!wasOpen) {
      d.setAttribute("open", "");
      void d.offsetHeight;                // 强制回流，确保展开态已渲染
    }
    var body = d.querySelector(".quote__body");
    var h = body ? body.getBoundingClientRect().height : 0;
    if (!wasOpen) {
      d.removeAttribute("open");
      void d.offsetHeight;
    }
    if (h > 0) {
      openDeltaH = h;
      openDeltaKey = envKey();
    }
    return openDeltaH;
  }

  /* 供 density 问：现在的价格表展开会占多高（基准是当前折叠态的页高）。 */
  function quoteDelta() {
    /* 缓存为空、或排版环境已经变了（切档位 / 缩放变化）时重新量。
       重量的代价是"临时展开一次再折回"，只在真正的环境变化时发生，
       不是每次调用都做。 */
    if (!openDeltaH || openDeltaKey !== envKey()) measureOpenDelta();
    return openDeltaH;
  }

  function watchQuote(d) {
    if (d.dataset.bound === "1") return;
    d.dataset.bound = "1";
    /* 每次展开都刷新缓存：档位/字号变了高度也会变，
       而展开的那一刻正是量得最准的时刻。 */
    d.addEventListener("toggle", function () {
      if (d.open) measureOpenDelta();
    });
    d.addEventListener("toggle", function () {
      if (!window.SITE_PAGED) return;
      /* 记下点击前的阅读位置。展开会让 Q4 突然高出 100~300px，
         翻页引擎重算后可能把画面吸附到别的页边界上 ——
         用户点了下表头却被甩到上一屏，属于明确的坏体验。
         重算完把位置还原，读者停在原地往下滚就行。 */
      var y = window.scrollY;
      window.requestAnimationFrame(function () {
        window.SITE_PAGED.refresh();
        window.scrollTo(0, y);
      });
    });
  }

  var inited = false;

  function init() {
    mount = document.getElementById("repairCalc");
    if (!mount) return;

    /* 幂等：repair.js 的 DOMContentLoaded 早于 main.js，
       那时报价表还没渲染出来；main.js 渲染完会再调一次 init()。
       没有这个开关，第二次调用会给计算器重复绑一遍事件。 */
    if (inited) return;
    inited = true;

    // 配置不完整就没必要渲染一个空壳
    if (!list(CFG.devices).length || !list(CFG.services).length) {
      mount.innerHTML = '<p class="calc__fallback">还没有配置报价数据，' +
        "请在 config.js 的 <code>repair.calculator</code> 里填写。</p>";
      return;
    }

    reset();
    render();

    mount.addEventListener("click", onClick);
    mount.addEventListener("keydown", onKey);
    mount.addEventListener("pointerover", onHover);
    mount.addEventListener("focusin", onHover);

    /* 建立历史基线：把"当前这一步"写进当前位置（不新增条目）。
       这样第一次前进 push 出来的条目，退回时正好落在第 1 步。
       失败（隐私模式）也不影响功能 —— 只是后退会离开页面而已。 */
    try {
      var base = history.state && typeof history.state === "object" ? history.state : {};
      base[HKEY] = cursor;
      history.replaceState(base, "", location.href);
    } catch (e) {}

    window.addEventListener("popstate", onPopState);
  }

  function boot() {
    if (!document.getElementById("repairCalc")) return;
    init();
    foldQuote();
  }

  window.SITE_REPAIR = {
    init: init, reset: reset, state: state, compute: compute,
    foldQuote: foldQuote, go: go, step: function () { return cursor; },
    /* 交互层新增能力，供自检调用：
       back —— 上一步（供键盘党/测试直接驱动）
       validate —— 出结果前的校验，返回问题数组（空 = 通过）
       tone —— 结果页那句人话（供测试断言"它不是随机文案"） */
    back: back,
    resetAll: resetAll,
    validate: validate,
    tone: function () { var r = compute(); return r ? toneOf(r) : ""; },
    /* density 用：报价表展开比折叠多占多少高度（缓存的真实值） */
    quoteDelta: quoteDelta,
    measureOpenDelta: measureOpenDelta
  };

  /* 竖屏 ↔ 横屏、或把浏览器窗口拉宽跨过 680px 时，跟着切换折叠状态。
     只监听跨档，不监听每次 resize —— 用户手动展开过的表不该被强行改回去。 */
  /* ⚠️ 跨 680px 时不再强制重设开合。
     早先这里调 foldQuote()，它按"手机就折、桌面就开"直接改 open ——
     会把 density.fitQuote 的内容驱动判断整个覆盖掉：
     实测 1440×900 明明装得下展开态，因为这条规则被折上。
     现在只通知 density 重算一次，由它按真实高度决定。 */
  var onMQ = function () {
    if (window.SITE_DENSITY && window.SITE_DENSITY.refresh) window.SITE_DENSITY.refresh();
  };
  if (phoneMQ.addEventListener) phoneMQ.addEventListener("change", onMQ);
  else if (phoneMQ.addListener) phoneMQ.addListener(onMQ);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
