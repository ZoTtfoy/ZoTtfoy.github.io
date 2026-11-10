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
          '<div class="calc__foot"><button class="calc__reset" type="button" data-goto="0">' +
            window.siteIcon("refresh") + "重新选设备</button></div>" +
        "</div>";
    }

    return '<div class="calc__stage" tabindex="-1">' +
        '<p class="calc__label" id="calcQ"><b>' + (cursor + 1) + "</b>" + esc(q) +
          (cursor === 0 ? "<i>选完自动到下一步</i>" : "") +
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
      "</div>";
  }

  function resultHtml(r) {
    return '<div class="calc__result" tabindex="-1" aria-live="polite">' +
        '<p class="calc__price"><small>' + esc(CUR) + "</small>" +
          r.lo + " – " + r.hi + "</p>" +
        '<p class="calc__detail">' +
          esc(r.svc.name) + " " + esc(CUR) + r.svc.price +
          " × " + esc(r.dev.name) + " " + r.dev.factor +
          " × " + esc(r.mat.name) + " " + r.mat.factor +
          (r.ext.add ? " + " + esc(r.ext.name) + " " + esc(CUR) + r.ext.add : "") +
        "</p>" +
        '<div class="calc__foot">' +
          '<button class="calc__reset" type="button" data-calc-reset>' +
            window.siteIcon("refresh") + "重新估价</button>" +
          '<span class="calc__more">实际以拆机检测为准</span>' +
        "</div>" +
      "</div>";
  }

  function render() {
    if (!mount) return;

    var atEnd = cursor >= STEPS.length;
    var r = compute();

    mount.innerHTML =
      '<div class="calc__head">' +
        '<h3 class="calc__title">' + window.siteIcon("calc") + esc(CFG.title || "估个价") + "</h3>" +
        (CFG.hint ? '<span class="calc__hint">' + esc(CFG.hint) + "</span>" : "") +
      "</div>" +

      trailHtml() +

      (atEnd
        ? (r ? resultHtml(r)
             : '<div class="calc__result" tabindex="-1">' +
                 '<p class="calc__detail">选项不完整，无法估价。</p>' +
                 '<div class="calc__foot"><button class="calc__reset" type="button" ' +
                 'data-calc-reset>' + window.siteIcon("refresh") + "重新估价</button></div>" +
               "</div>")
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

  function go(i) {
    cursor = Math.max(0, Math.min(STEPS.length, i));
    render();
    focusStep();
  }

  function pick(key, value) {
    // 重复点同一个答案 = 「确认，继续」，不该原地不动
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
    advance(STEPS.findIndex(function (s) { return s.key === key; }));
  }

  function reset() {
    state.device = state.service = state.material = state.extra = "";
    cursor = 0;
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
    var jump = t.closest("[data-goto]");
    if (jump && mount.contains(jump)) {
      e.preventDefault();
      go(+jump.getAttribute("data-goto"));
      return;
    }
    if (t.closest("[data-calc-reset]")) {
      e.preventDefault();
      reset();
      render();
      focusStep();
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

  function foldQuote() {
    var d = document.getElementById("quoteDetails");
    if (!d) return;
    if (phoneMQ.matches) d.removeAttribute("open");
    else d.setAttribute("open", "");
    watchQuote(d);
  }

  /* 展开/收起会让 Q4 的高度跨过一屏，必须让翻页引擎重算一次：
     展开后它会把 Q4 标成 data-tall、吸附降级为 proximity，
     用户才能滚着把价目表看完（否则一次滑动就直接翻页，下半截永远看不到）。
     收起后重算会把状态还原。 */
  function watchQuote(d) {
    if (d.dataset.bound === "1") return;
    d.dataset.bound = "1";
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
  }

  function boot() {
    if (!document.getElementById("repairCalc")) return;
    init();
    foldQuote();
  }

  window.SITE_REPAIR = {
    init: init, reset: reset, state: state, compute: compute,
    foldQuote: foldQuote, go: go, step: function () { return cursor; }
  };

  /* 竖屏 ↔ 横屏、或把浏览器窗口拉宽跨过 680px 时，跟着切换折叠状态。
     只监听跨档，不监听每次 resize —— 用户手动展开过的表不该被强行改回去。 */
  var onMQ = function () { foldQuote(); };
  if (phoneMQ.addEventListener) phoneMQ.addEventListener("change", onMQ);
  else if (phoneMQ.addListener) phoneMQ.addListener(onMQ);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
