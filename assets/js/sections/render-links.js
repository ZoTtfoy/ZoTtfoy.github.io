/* ==========================================================================
 *  render-links.js —— Q5「其他」外链屏 + Q6「邮箱」屏
 * --------------------------------------------------------------------------
 *  原 render.js 第 158–185 行（Q5）与 187–201 行（Q6），逐行搬来，未改一字。
 *
 *  为什么两屏共用一个文件：加起来 43 行、各自只有一个渲染函数。
 *  按屏拆的目的是"改一屏不用在一千行里找"，这两个文件各自就是全部内容，
 *  再拆成两个物理文件只会多两个请求，没有任何可读性收益。
 *
 *  ⚠️ 同段里的 pad2() 没有搬走 —— 它属于导航（renderSections 排版日期用），
 *     不是这两屏的东西，留在 render.js 的外壳区。
 * ========================================================================== */

(function (K) {
  "use strict";

  var C = K.C, esc = K.esc, text = K.text, icon = K.icon;
  var $ = K.$, set = K.set, arr = K.arr, delay = K.delay;

  /* ========================================================== Q5 · 其他 */
  function renderLinks() {
    var d = C.links || {};
    set("linksGrid", arr(d.items).map(function (it, i) {
      var inner =
        '<span class="social__icon">' + icon(it.icon) + "</span>" +
        '<span class="social__text">' +
          '<span class="social__label">' + esc(it.label) + "</span>" +
          '<span class="social__handle">' + esc(it.handle) + "</span>" +
        "</span>";

      // copy 模式：没有公开主页的账号，点击即复制
      if (it.copy) {
        return '<button class="social" type="button" style="' + delay(i, 55) + '" data-reveal ' +
               'data-copy="' + esc(it.copy) + '"' +
               ' data-copy-toast="已复制 ' + esc(it.label) + '"' +
               ' aria-label="复制' + esc(it.label) + "：" + esc(it.copy) + '">' +
               inner + icon("copy", "social__arrow") + "</button>";
      }

      var url = it.url || "#";
      var external = url.charAt(0) !== "#" && url.indexOf("mailto:") !== 0;
      return '<a class="social" style="' + delay(i, 55) + '" data-reveal ' +
             'href="' + esc(url) + '"' +
             (external ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" +
             inner + icon("arrow-up-right", "social__arrow") + "</a>";
    }).join(""));
  }

  /* ========================================================== Q6 · 邮箱 */
  function renderContact() {
    var s = C.site || {}, d = C.contact || {};
    var mail = s.email || "";
    set("contactBox",
      '<p class="mailbox__hint">' + esc(d.hint || "欢迎来信") + "</p>" +
      '<a class="mailbox__mail" href="mailto:' + esc(mail) + '">' + esc(mail) + "</a>" +
      '<div class="mailbox__actions">' +
        '<a class="btn btn--primary" href="mailto:' + esc(mail) + '">' +
          "<span>发封邮件</span>" + icon("send", "btn__icon") + "</a>" +
        '<button class="btn btn--quiet" type="button" data-copy="' + esc(mail) + '"' +
          ' data-copy-toast="已复制邮箱">' +
          icon("copy", "btn__icon") + '<span data-copy-hint>复制邮箱</span></button>' +
      "</div>");
  }

  K.register("links", {
    renderLinks: renderLinks,
    renderContact: renderContact
  });
})(window.SITE_RENDER_KIT);
