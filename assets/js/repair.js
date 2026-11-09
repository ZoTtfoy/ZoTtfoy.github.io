/* ==========================================================================
 *  repair.js —— Q4 的维修估价器（四步向导）
 * --------------------------------------------------------------------------
 *  流程和你描述的一致：
 *      ① 选设备  →  ② 选项目  →  ③ 选材料  →  ④ 选加项  →  出价格
 *
 *  为什么放在独立文件、不塞进 render.js：
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

  /* 某个项目是否适用于当前设备。
     项目上的 devices 为空 = 全设备通用。 */
  function supports(service, deviceId) {
    return !service.devices || service.devices.indexOf(deviceId) >= 0;
  }

  /* 切换设备后，原来的项目可能不适用了 —— 自动落到第一个能做的项目上，
     否则用户会看到「已选换屏，但设备是游戏机」这种矛盾状态。 */
  function firstServiceFor(deviceId) {
    var svcs = list(CFG.services);
    for (var i = 0; i < svcs.length; i++) if (supports(svcs[i], deviceId)) return svcs[i].id;
    return svcs.length ? svcs[0].id : "";
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
  function optBtn(group, item, active, disabled) {
    return '<button class="calc__opt" type="button" role="radio"' +
           ' data-opt="' + group + '" data-value="' + esc(item.id) + '"' +
           ' aria-pressed="' + (active ? "true" : "false") + '"' +
           (disabled ? ' disabled aria-disabled="true"' : "") +
           ' title="' + esc(item.note || item.name) + '">' +
           esc(item.name) +
           "</button>";
  }

  function stepHtml(no, label, extra, group, items, activeId, disFn) {
    return '<div class="calc__step">' +
             '<div class="calc__label"><b>' + no + "</b>" + esc(label) +
               (extra ? "<i>" + esc(extra) + "</i>" : "") +
             "</div>" +
             '<div class="calc__opts" role="radiogroup" aria-label="' + esc(label) + '">' +
               items.map(function (it) {
                 return optBtn(group, it, it.id === activeId, disFn ? disFn(it) : false);
               }).join("") +
             "</div>" +
           "</div>";
  }

  function render() {
    if (!mount) return;

    var devices = list(CFG.devices);
    var services = list(CFG.services);
    var materials = list(CFG.materials);
    var extras = list(CFG.extras);
    var r = compute();

    var html =
      '<div class="calc__head">' +
        '<h3 class="calc__title">' + window.siteIcon("calc") + esc(CFG.title || "估个价") + "</h3>" +
        (CFG.hint ? '<span class="calc__hint">' + esc(CFG.hint) + "</span>" : "") +
      "</div>" +

      stepHtml("1", "设备", "", "device", devices, state.device) +
      stepHtml("2", "项目", "", "service", services, state.service, function (it) {
        return !supports(it, state.device);
      }) +
      /* 材料与加项并排一行。
         手机上一行只放得下 3~4 个短按钮，这两组的选项都很短（原装/品牌/国产、
         不需要/加急/上门/备份），并排后正好各占一半，省下约 50px 高度 ——
         这 50px 是 Q4 能不能一屏装下的关键。 */
      '<div class="calc__pair">' +
        stepHtml("3", "材料", "", "material", materials, state.material) +
        stepHtml("4", "加项", "", "extra", extras, state.extra) +
      "</div>" +

      '<div class="calc__result" aria-live="polite">' +
        (r
          ? '<p class="calc__price"><small>' + esc(CUR) + "</small>" +
              r.lo + " – " + r.hi + "</p>" +
            '<p class="calc__detail">' +
              esc(r.svc.name) + " " + esc(CUR) + r.svc.price +
              " × " + esc(r.dev.name) + " " + r.dev.factor +
              " × " + esc(r.mat.name) + " " + r.mat.factor +
              (r.ext.add ? " + " + esc(r.ext.name) + " " + esc(CUR) + r.ext.add : "") +
            "</p>"
          : '<p class="calc__detail">选项不完整，无法估价。</p>') +
        '<div class="calc__foot">' +
          '<button class="calc__reset" type="button" data-calc-reset>' +
            window.siteIcon("refresh") + "重新开始</button>" +
        "</div>" +
      "</div>";

    mount.innerHTML = html;

    // 高度变了，翻页引擎要重新量一次，否则吸附落点会偏
    if (window.Paged && typeof window.Paged.refresh === "function") window.Paged.refresh();
  }

  /* --------------------------------------------------------------- 交互 */
  function pick(group, value) {
    if (state[group] === value) return;

    state[group] = value;

    if (group === "device") {
      var svc = find(list(CFG.services), state.service);
      if (!svc || !supports(svc, value)) state.service = firstServiceFor(value);
    }

    var focusKey = group + ":" + value;

    if (mount) {
      // 只更新按钮状态和结果区，不整块重建 —— 避免焦点丢失和闪烁
      Array.prototype.forEach.call(mount.querySelectorAll("[data-opt]"), function (btn) {
        if (btn.getAttribute("data-opt") !== group) return;
        btn.setAttribute("aria-pressed", btn.getAttribute("data-value") === value ? "true" : "false");
      });

      // 设备变了，项目按钮的可用状态要跟着变
      if (group === "device") {
        Array.prototype.forEach.call(mount.querySelectorAll('[data-opt="service"]'), function (btn) {
          var svc = find(list(CFG.services), btn.getAttribute("data-value"));
          var ok = svc ? supports(svc, value) : false;
          btn.disabled = !ok;
          btn.setAttribute("aria-disabled", ok ? "false" : "true");
        });
        Array.prototype.forEach.call(mount.querySelectorAll('[data-opt="service"]'), function (btn) {
          btn.setAttribute("aria-pressed",
            btn.getAttribute("data-value") === state.service ? "true" : "false");
        });
      }

      updateResult(focusKey);
    }
  }

  function updateResult(focusKey) {
    var box = mount && mount.querySelector(".calc__result");
    if (!box) return;
    var r = compute();
    var old = box.querySelector(".calc__price");
    var det = box.querySelector(".calc__detail");
    if (r) {
      if (old) old.innerHTML = "<small>" + esc(CUR) + "</small>" + r.lo + " – " + r.hi;
      if (det) {
        det.textContent = r.svc.name + " " + CUR + r.svc.price +
          " × " + r.dev.name + " " + r.dev.factor +
          " × " + r.mat.name + " " + r.mat.factor +
          (r.ext.add ? " + " + r.ext.name + " " + CUR + r.ext.add : "");
      }
    }
    if (focusKey) {
      var b = mount.querySelector('[data-opt="' + focusKey.split(":")[0] + '"][data-value="' + focusKey.split(":")[1] + '"]');
      if (b && document.activeElement !== b) b.focus({ preventScroll: true });
    }
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest("[data-opt]") : null;
    if (btn && mount.contains(btn)) {
      e.preventDefault();
      pick(btn.getAttribute("data-opt"), btn.getAttribute("data-value"));
      return;
    }
    if (e.target.closest && e.target.closest("[data-calc-reset]")) {
      e.preventDefault();
      reset();
      render();
    }
  }

  /* 方向键在选项组之间移动（radio 的标准键盘行为） */
  function onKey(e) {
    var k = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(k) < 0) return;

    var btn = document.activeElement;
    if (!btn || !btn.getAttribute || !btn.getAttribute("data-opt")) return;

    var group = btn.getAttribute("data-opt");
    var all = Array.prototype.filter.call(
      mount.querySelectorAll('[data-opt="' + group + '"]'),
      function (b) { return !b.disabled; }
    );
    var i = all.indexOf(btn);
    if (i < 0) return;

    var next = (k === "ArrowRight" || k === "ArrowDown") ? i + 1 : i - 1;
    if (next < 0) next = all.length - 1;
    if (next >= all.length) next = 0;

    e.preventDefault();
    all[next].focus();
    pick(group, all[next].getAttribute("data-value"));
  }

  /* --------------------------------------------------------------- 初始化 */
  function reset() {
    var devices = list(CFG.devices);
    state.device = devices.length ? devices[0].id : "";
    state.service = firstServiceFor(state.device);
    var mats = list(CFG.materials);
    state.material = mats.length ? mats[0].id : "";
    var exts = list(CFG.extras);
    state.extra = exts.length ? exts[0].id : "";
  }

  function init() {
    mount = document.getElementById("repairCalc");
    if (!mount) return;

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
  }

  function boot() {
    if (!document.getElementById("repairCalc")) return;
    init();
  }

  window.SITE_REPAIR = { init: init, reset: reset, state: state, compute: compute };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
