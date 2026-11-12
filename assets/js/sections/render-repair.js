/* ==========================================================================
 *  render-repair.js —— Q4「维修」屏的渲染
 * --------------------------------------------------------------------------
 *  原 render.js 第 244–317 行，逐行搬来，未改一字。
 *
 *  ⚠️ 唯一的外部依赖：renderRepair() 里用 paintPreviews() 画闲鱼卡，
 *     那是 Q1 的函数（摘要卡组件本来就是共用的）。所以本文件加载顺序
 *     必须排在 render-profile.js 之后 —— index.html 里已经是这个顺序。
 *     这里在文件头取一次别名，函数体就不用改。
 * ========================================================================== */

(function (K) {
  "use strict";

  var C = K.C, esc = K.esc, text = K.text, icon = K.icon;
  var $ = K.$, set = K.set, arr = K.arr, delay = K.delay;

  /* 摘要卡是 Q1 的组件，这里借来画闲鱼卡 */
  var paintPreviews = (K.parts.profile || {}).paintPreviews;

  /* ========================================================== Q4 · 维修 */
  /* 报价单 → 闲鱼在售物品（2026-11-11 改版）
     ---------------------------------------------------------------------
     为什么换：原来的报价单是 10 行长静态价目表，读起来像一份"公告"，
     而访客真正想看的是"你现在手上有什么、卖多少钱"。
     闲鱼在售列表同时满足两件事：价格可信（有具体链接与状态），
     也能顺势引到闲鱼店铺。

     数据来源只支持快照（config.js 的 repair.quote.items）：
       试过抓 https://www.goofish.com/personal，它是 SPA，
       服务端只回空壳；h5api 的 mtop 接口需要 appKey + 签名，
       裸请求直接返回 FAIL_SYS_API_NOT_FOUNDED。
       这跟网易云不同 —— 那边的公开接口是可读的。
       所以这里不做抓取，改成"快照 + 一键重抓"的边界：
       结构对齐闲鱼的字段（title / price / condition / note / url），
       将来若有了合法数据源，只需替换 source 的读取方式，渲染层不用动。 */
  function renderQuote() {
    var q = (C.repair || {}).quote || {};
    var el = $("repairQuote");
    if (!el) return;

    var items = arr(q.items);
    if (!items.length) { el.innerHTML = ""; return; }

    var rows = items.map(function (it) {
      /* 每条都尽量是一个可点链接：有 url 用 <a>，没有就退化成 <div>，
         不让"看起来能点但其实点不动"的元素出现。 */
      var tag = it.url ? "a" : "div";
      var attrs = it.url
        ? ' href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer"'
        : "";
      var cond = it.condition || "";
      /* 「已成交」的置灰：它还有参考价值（能看出这一单大概多少钱），
         但不该和「在售」抢注意力。 */
      var sold = /已(成交|售出|下架)/.test(cond);

      return "<" + tag + ' class="xy' + (sold ? " is-sold" : "") + '"' + attrs + ">" +
          '<span class="xy__main">' +
            '<span class="xy__title">' + esc(it.title) + "</span>" +
            (it.note ? '<span class="xy__note">' + esc(it.note) + "</span>" : "") +
          "</span>" +
          '<span class="xy__side">' +
            '<span class="xy__price">' + esc(it.price) + "</span>" +
            (cond ? '<span class="xy__cond">' + esc(cond) + "</span>" : "") +
          "</span>" +
        "</" + tag + ">";
    }).join("");

    var onSale = items.filter(function (it) { return !/已(成交|售出|下架)/.test(it.condition || ""); }).length;

    el.innerHTML =
      '<details class="quote" id="quoteDetails" open>' +
        '<summary class="quote__summary">' +
          '<span class="quote__title">' + icon("shop") + esc(q.title || "闲鱼在售") + "</span>" +
          '<span class="quote__count">' + onSale + " 件在售 · 共 " + items.length + " 件</span>" +
          '<span class="quote__caret" aria-hidden="true">' + icon("chevron-right") + "</span>" +
        "</summary>" +
        '<div class="quote__body">' +
          '<div class="xy-list">' + rows + "</div>" +
          (q.note ? '<p class="quote__note">' + esc(q.note) + "</p>" : "") +
          (q.profileUrl
            ? '<a class="xy__more" href="' + esc(q.profileUrl) + '" target="_blank" rel="noopener noreferrer">' +
                "去闲鱼看全部" + icon("arrow-up-right") + "</a>"
            : "") +
        "</div>" +
      "</details>";
  }

  function renderRepair() {
    var d = C.repair || {};
    paintPreviews("repairPreview", d.xianyu ? [d.xianyu] : []);
    renderQuote();
    // 计算器由 repair.js 负责（它有状态和交互，放在渲染层里不合适）
  }

  K.register("repair", {
    renderQuote: renderQuote,
    renderRepair: renderRepair
  });
})(window.SITE_RENDER_KIT);
