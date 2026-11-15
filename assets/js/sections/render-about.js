/* ==========================================================================
 *  render-about.js —— Q2「关于我」
 * --------------------------------------------------------------------------
 *  2026-11-15：内容按用户的小红书笔记里的「喜欢什么」重写，
 *  结构从「正文 + 4 张信息卡」变成「正文 + 描述卡 + 标签行」。
 *  ⚠️ 笔记里「对搭子的要求」那段按用户要求不用，别又加回来。
 *
 *  ⚠️ cards / tags 都是数组，后台可增删排序 —— 这里别写死数量。
 *  ⚠️ body 里的 \n 走 K.text() 转成 <br>，后台换行所见即所得。
 * ========================================================================== */
(function (K) {
  "use strict";

  var C = K.C, esc = K.esc, text = K.text, icon = K.icon;
  var set = K.set, arr = K.arr, delay = K.delay;

  function renderAbout() {
    var d = C.about || {};

    set("aboutBody", text(d.body || ""));

    set("aboutCards", arr(d.cards).map(function (c, i) {
      return '<div class="about__card" style="' + delay(i, 60) + '" data-reveal>' +
               '<span class="about__card__icon">' + icon(c.icon || "sparkles") + "</span>" +
               '<span class="about__card__label">' + esc(c.label || "") + "</span>" +
               '<span class="about__card__text">' + esc(c.text || "") + "</span>" +
             "</div>";
    }).join(""));

    set("aboutTags", arr(d.tags).map(function (t, i) {
      return '<span class="about__tag" style="' + delay(i, 35) + '" data-reveal>' +
               esc(t) + "</span>";
    }).join(""));
  }

  K.register("about", { renderAbout: renderAbout });
})(window.SITE_RENDER_KIT);
