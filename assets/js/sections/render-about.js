/* ==========================================================================
 *  render-about.js —— Q2「关于我」
 * --------------------------------------------------------------------------
 *  2026-11-15 新增：维修屏整屏下线，在首屏与「在听」之间补这一屏。
 *  内容全部来自 config.about，后台「关于我」页可直接改，前后统一。
 *
 *  ⚠️ facts 是数组，后台可增删排序 —— 这里不要写死四张卡的数量。
 *  ⚠️ body 里的 \n 用 K.text() 转成 <br>，所以后台换行是所见即所得。
 * ========================================================================== */
(function (K) {
  "use strict";

  var C = K.C, esc = K.esc, text = K.text, icon = K.icon;
  var set = K.set, arr = K.arr, delay = K.delay;

  function renderAbout() {
    var d = C.about || {};

    set("aboutBody", '<p class="about__text">' + text(d.body || "") + "</p>");

    set("aboutFacts", arr(d.facts).map(function (f, i) {
      return '<div class="about__fact" style="' + delay(i, 65) + '" data-reveal>' +
               '<span class="about__fact__icon">' + icon(f.icon || "sparkles") + "</span>" +
               '<span class="about__fact__label">' + esc(f.label || "") + "</span>" +
               '<span class="about__fact__value">' + esc(f.value || "") + "</span>" +
             "</div>";
    }).join(""));
  }

  K.register("about", { renderAbout: renderAbout });
})(window.SITE_RENDER_KIT);
