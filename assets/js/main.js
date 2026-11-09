/* ==========================================================================
 *  main.js —— 启动入口
 *  加载顺序：config → icons → render → motion → main
 * ========================================================================== */

(function () {
  "use strict";

  function boot() {
    try {
      if (!window.SITE_CONFIG) {
        console.error("[Zotrod] 找不到 config.js，页面无法渲染。");
        return;
      }
      window.SITE_RENDER.init();
      if (window.SITE_SKIN) window.SITE_SKIN.init();
      // 背景要在翻页测量之前就位（图片 kenBurns / 视差会改变观感但不改高度）
      if (window.SITE_BACKDROP) window.SITE_BACKDROP.init();
      // live 要先于 paged：时钟/一言/进度条会改变首页高度，
      // 必须在测量「这一页装不装得下」之前就位，否则会误判。
      if (window.SITE_LIVE) window.SITE_LIVE.init();
      if (window.SITE_PAGED) window.SITE_PAGED.init();
      window.SITE_MOTION.init();
      if (window.SITE_EFFECTS) window.SITE_EFFECTS.init();
    } catch (err) {
      // 出错时至少保证内容可见，不要留一个空白页面
      console.error("[Zotrod] 初始化失败：", err);
      document.documentElement.classList.remove("js");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
