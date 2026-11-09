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
      window.SITE_MOTION.init();
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
