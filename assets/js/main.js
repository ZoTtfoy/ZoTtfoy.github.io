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
      /* 顺序有依赖，别随手调：
           1) density 先算"视口能吃多少"，把级别写到 <html data-vp>
              —— 它决定哪些装饰退场，直接影响每屏高度。
           2) repair.foldQuote() 问 density 要不要折叠报价表
              —— 报价表展开与否是 Q4 高度的大头。
           3) paged.init() 最后测量、定档。
         任何一步提前，测量到的都是"还没让位"的旧高度，档位就会判错。 */
      /* scale 必须第一个：它改 <html> 的 font-size，而全站字号/间距都是 rem，
         等于给后面所有测量定下了基准。放后面的话，density 与 paged 量到的
         还是旧根字号的尺寸。 */
      if (window.SITE_SCALE) window.SITE_SCALE.init();
      if (window.SITE_DENSITY) window.SITE_DENSITY.init();
      if (window.SITE_REPAIR) window.SITE_REPAIR.foldQuote();
      if (window.SITE_PAGED) window.SITE_PAGED.init();
      /* 可读性兜底放在最后：它要读"最终生效"的字号，
         前面 scale/density/档位都定下来之后才知道谁真的太小。 */
      if (window.SITE_READABLE) window.SITE_READABLE.init();
      window.SITE_MOTION.init();
      /* 游戏屏的 Steam 拼贴背景：纯装饰，放最后初始化，
         它挂了也不影响任何功能。 */
      if (window.SITE_STEAMWALL) window.SITE_STEAMWALL.init();
      /* 在听页的专辑封面墙：同样是纯装饰，放最后，挂了不影响任何功能 */
      if (window.SITE_ALBUMWALL) window.SITE_ALBUMWALL.init();
      if (window.SITE_EFFECTS) window.SITE_EFFECTS.init();
      /* 站内播放器：只挂事件委托，不改布局，所以放最后。
         它必须在 render 之后 —— 委托节点 #trackList 那时才存在。 */
      if (window.SITE_PLAYER) window.SITE_PLAYER.init();
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
