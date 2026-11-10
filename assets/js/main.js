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
      /* 计算器在 repair.js 里自举（它的 DOMContentLoaded 早于这里），
         但报价表是 render 才产出的 —— 再调一次 init() 是空操作（内部有幂等开关），
         真正要做的是紧接着把报价表按设备折叠好。 */
      if (window.SITE_REPAIR) window.SITE_REPAIR.init();
      if (window.SITE_SKIN) window.SITE_SKIN.init();
      // 背景要在翻页测量之前就位（图片 kenBurns / 视差会改变观感但不改高度）
      if (window.SITE_BACKDROP) window.SITE_BACKDROP.init();
      // live 要先于 paged：时钟/一言/进度条会改变首页高度，
      // 必须在测量「这一页装不装得下」之前就位，否则会误判。
      if (window.SITE_LIVE) window.SITE_LIVE.init();
      /* 报价表的展开/收起会直接改变 Q4 高度，必须赶在 paged 测量之前定下来。 */
      if (window.SITE_REPAIR) window.SITE_REPAIR.foldQuote();
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
