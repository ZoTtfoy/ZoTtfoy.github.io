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
      // 翻页要在渲染之后（区块顺序已定），且早于 motion（锚点跳转要用到它）
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
