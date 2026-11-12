/* ==========================================================================
 *  render-profile.js —— Q1「我」屏的渲染
 * --------------------------------------------------------------------------
 *  原 render.js 第 130–230 行（Q2/Q3 拆完之后的行号），逐行搬来，未改一字。
 *
 *  包含三样东西：
 *    · renderProfile   名片式首屏
 *    · previewCard     外链摘要卡（一个组件两种形态）
 *    · paintPreviews   成组画摘要卡
 *
 *  ⚠️ previewCard / paintPreviews 不是 Q1 专属：Q4 维修屏的闲鱼卡用的就是它，
 *     sync.js 也通过 SITE_RENDER.previewCard 回填。所以这三个都要登记出去。
 * ========================================================================== */

(function (K) {
  "use strict";

  var C = K.C, esc = K.esc, text = K.text, icon = K.icon;
  var $ = K.$, set = K.set, arr = K.arr, delay = K.delay;

  /* ============================================================ Q1 · 我 */
  function renderProfile() {
    var s = C.site || {}, p = C.profile || {}, h = C.hero || {};

    set("heroGreet", esc(p.greet || "你好，我是"));
    set("heroName", esc(s.name || "Zotrod"));
    set("heroTagline", esc(p.tagline || ""));
    set("heroRole", esc(s.role || ""));
    set("heroIntro", text(p.intro || ""));
    if (!p.tagline) { var t = $("heroTagline"); if (t) t.hidden = true; }

    // 微信 / QQ：只印平台名，点一下复制账号。
    // 用 <button> 而不是 <a>，因为它不跳转。
    //
    // ⚠️ 账号本身不再上屏（2026-11-10 改）：QQ 号 10 位、微信号 12 位，
    // 摆在卡上要么被挤成第二行、要么吃省略号；而"看见再手抄"本来就不如
    // "点一下进剪贴板"。账号仍留在 data-copy 与 aria-label 里 ——
    // 读屏用户照样听得到，复制也照样拿到。
    // data-copy-toast 让 Toast 只说"已复制 QQ"，不把号码复述一遍。
    set("heroContacts", arr(p.contacts).map(function (c, i) {
      return '<button class="ccard" type="button" ' +
             'data-copy="' + esc(c.value) + '" ' +
             'data-copy-toast="已复制 ' + esc(c.label) + '" ' +
             'aria-label="复制' + esc(c.label) + '：' + esc(c.value) + '" ' +
             'style="' + delay(i, 70) + '">' +
               '<span class="ccard__icon">' + icon(c.icon) + "</span>" +
               '<span class="ccard__label">' + esc(c.label) + "</span>" +
               '<span class="ccard__act">' +
                 '<span class="ccard__hint" data-copy-hint>点击复制</span>' +
                 icon("copy") +
               "</span>" +
             "</button>";
    }).join(""));

    // 两个主页的摘要卡（左右各一张）。compact：只要「图标 + 平台名 + 箭头」
    paintPreviews("heroPreviews", p.previews, true);

    // 首屏按钮
    var a = $("heroPrimary"), b = $("heroSecondary");
    var pri = h.primary || { label: "看看我在听", target: "#listen" };
    var sec = h.secondary || { label: "游戏 ID", target: "#gaming" };
    if (a) {
      a.innerHTML = "<span>" + esc(pri.label) + "</span>" + icon("arrow-down", "btn__icon");
      if (pri.target) a.setAttribute("href", pri.target);
    }
    if (b) {
      b.innerHTML = "<span>" + esc(sec.label) + "</span>" + icon("arrow-up-right", "btn__icon");
      if (sec.target) b.setAttribute("href", sec.target);
    }
  }

  /* ---------- 外链摘要卡（Q1 两个 + Q4 闲鱼一个） ----------
     一个组件两种形态：
       有 cover → 上方封面 + 下方文字，像一张缩略图卡
       无 cover → 纯文字信息卡，左边一块平台图标
     sync.js 拿到 data/previews.json 后，会按 [data-preview-id] 回填
     标题 / 副标题 / 数据 / 封面 —— 优先用抓到的真实信息。

     ⚠️ 2026-11-11 第二轮：用户要「磁贴内文字去掉，只要网易云音乐和小黑盒」。
        Q1 那两张卡改成**单行**（compact）——不渲染标题 / 副标题 / 数据三块，
        只留 图标 + 平台名 + 外链箭头。数据本身还在 data/previews.json 里，
        只是不再上屏；哪天想摆回来，把 compact 去掉即可。 */
  function previewCard(p, i, compact) {
    var cover = String(p.cover || "").trim();
    var stats = compact ? [] : arr(p.stats).filter(function (s) { return s && s.value != null; });
    var statsHtml = stats.map(function (s) {
      return '<span class="preview__stat"><b>' + esc(s.value) + "</b>" + esc(s.label || "") + "</span>";
    }).join("");

    var style = (p.accent ? "--pc:" + esc(p.accent) + ";" : "") + delay(i, 80);

    return '<a class="preview' + (cover ? " preview--cover" : "") +
             (compact ? " preview--slim" : "") + '"' +
             ' href="' + esc(p.url || "#") + '" target="_blank" rel="noopener noreferrer"' +
             ' data-preview-id="' + esc(p.id || "") + '"' +
             ' style="' + style + '" data-reveal>' +
             (cover
               ? '<span class="preview__cover"><img src="' + esc(cover) +
                 '" alt="" loading="lazy" decoding="async"></span>'
               : "") +
             '<span class="preview__body">' +
               '<span class="preview__top">' +
                 '<span class="preview__icon">' + icon(p.icon) + "</span>" +
                 '<span class="preview__platform">' + esc(p.platform || "") + "</span>" +
                 icon("arrow-up-right", "preview__go") +
               "</span>" +
               (compact ? "" :
                 '<span class="preview__title" data-preview-title>' + esc(p.title || "") + "</span>" +
                 '<span class="preview__meta" data-preview-meta>' + esc(p.meta || "") + "</span>") +
               (compact ? "" :
                 '<span class="preview__stats" data-preview-stats' +
                   (statsHtml ? "" : " hidden") + ">" + statsHtml + "</span>") +
             "</span>" +
           "</a>";
  }

  function paintPreviews(mountId, list, compact) {
    var el = $(mountId);
    if (!el) return;
    el.innerHTML = arr(list).map(function (p, i) { return previewCard(p, i, compact); }).join("");
  }

  K.register("profile", {
    renderProfile: renderProfile,
    previewCard: previewCard,
    paintPreviews: paintPreviews
  });
})(window.SITE_RENDER_KIT);
