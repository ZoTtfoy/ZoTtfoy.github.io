/* ==========================================================================
 *  main.js —— 启动表
 * --------------------------------------------------------------------------
 *  这个文件只有一件事：**按什么顺序把各个模块叫醒**。
 *
 *  以前它是 15 行连续的 `if (window.SITE_X) SITE_X.init()`，中间夹着大段
 *  「为什么这个必须在那个前面」的注释。顺序确实是语义，但它只活在注释里 ——
 *  后面的人插一行到错误的位置，注释不会拦住他。
 *
 *  现在顺序是数据：STEPS 表。加模块 = 在表里挑位置插一行 + index.html 加
 *  一个 <script>。`why` 只写**真正有约束**的那几条，不是给每行凑话。
 *
 *  tools/verify-boot.js 会核对两件事：
 *    ① 页面上凡是暴露了 init 的 SITE_* 模块，要么在 STEPS 里，要么在
 *       SELF_INIT 里写明了为什么不用调（防「写了模块忘了启动」）
 *    ② 运行时每一步都真的跑成功了（report() 里 ok 全为 true）
 * ========================================================================== */

window.SITE_BOOT = (function () {
  "use strict";

  var STEPS = [
    /* ---- 先骨架 ---- */
    { name: "render", mod: "SITE_RENDER", fn: "init",
      why: "把 config 填进 index.html 的骨架；后面每一步都假设 DOM 已经就位" },

    /* ---- 各就各位：这些会改变「一屏有多高」，必须在测量之前 ---- */
    { name: "repair", mod: "SITE_REPAIR", fn: "init",
      why: "计算器在自己的 DOMContentLoaded 里自举过一次；这里是幂等的补调" },
    { name: "skin", mod: "SITE_SKIN", fn: "init" },
    { name: "backdrop", mod: "SITE_BACKDROP", fn: "init",
      why: "背景要在翻页测量之前就位（kenBurns / 视差只改观感、不改高度）" },
    { name: "live", mod: "SITE_LIVE", fn: "init",
      why: "时钟 / 一言 / 进度条会撑高首页 —— 晚于它就量到没撑开的高度" },

    /* ---- 三连定档：scale → density → foldQuote → paged，一步都不能提前 ---- */
    { name: "scale", mod: "SITE_SCALE", fn: "init",
      why: "它改根字号，全站字号与间距都是 rem —— 它是后面所有测量的基准" },
    { name: "density", mod: "SITE_DENSITY", fn: "init",
      why: "写 <html data-vp>，决定哪些装饰退场；直接影响每屏高度" },
    { name: "repair.foldQuote", mod: "SITE_REPAIR", fn: "foldQuote",
      why: "问 density 要不要折起报价表；报价表展开与否是 Q4 高度的大头" },
    { name: "paged", mod: "SITE_PAGED", fn: "init",
      why: "最后测量、定档。上面任何一步提前，量到的都是「还没让位」的旧高度" },

    /* ---- 收尾 ---- */
    { name: "readable", mod: "SITE_READABLE", fn: "init",
      why: "要读「最终生效」的字号，所以必须等 scale / density / 档位都定下来" },
    { name: "motion", mod: "SITE_MOTION", fn: "init" },

    /* ---- 纯装饰与事件委托：挂在最后，挂了也不影响功能 ---- */
    { name: "steamwall", mod: "SITE_STEAMWALL", fn: "init" },
    { name: "albumwall", mod: "SITE_ALBUMWALL", fn: "init" },
    { name: "effects", mod: "SITE_EFFECTS", fn: "init" },
    { name: "player", mod: "SITE_PLAYER", fn: "init",
      why: "只在 #trackList 上挂事件委托，必须等 render 把列表画出来" }
  ];

  /* 不在表里启动的模块：它们自己在 DOMContentLoaded 里跑，重复调会重复请求。
     verify-boot 用这张表区分「漏启动」和「有意不启动」。 */
  var SELF_INIT = [
    { mod: "SITE_SYNC", why: "自己在 DOMContentLoaded 里拉 data/*.json，失败静默降级" },
    { mod: "SITE_PRELOAD", why: "预取闸门要在脚本一加载就生效，等不到 boot" },
    { mod: "SITE_THEMES", why: "纯数据表，没有 init" }
  ];

  var NOTES = [];

  function run() {
    NOTES.length = 0;
    try {
      for (var i = 0; i < STEPS.length; i++) {
        var s = STEPS[i];
        var mod = window[s.mod];
        var fn = s.fn || "init";
        if (!mod || typeof mod[fn] !== "function") {
          /* 缺模块不抛错：可能是这一屏没启用 / 脚本没加载。
             记一笔就够 —— verify-boot 会把它报出来。 */
          NOTES.push({ name: s.name, ok: false, skip: true, error: "缺少 " + s.mod + "." + fn });
          continue;
        }
        try {
          mod[fn]();
          NOTES.push({ name: s.name, ok: true });
        } catch (e) {
          NOTES.push({ name: s.name, ok: false, error: (e && e.message) || String(e) });
          throw e;   /* 交给外层：一处坏掉就整体收手，与拆分之前的行为一致 */
        }
      }
    } catch (err) {
      /* 出错时至少保证内容可见，不要留一个空白页面 */
      console.error("[Zotrod] 初始化失败：", err);
      document.documentElement.classList.remove("js");
    }
  }

  function boot() {
    if (!window.SITE_CONFIG) {
      console.error("[Zotrod] 找不到 config.js，页面无法渲染。");
      return;
    }
    run();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  return {
    /* 给自检与排查用 */
    plan: function () { return STEPS.slice(); },
    selfInit: function () { return SELF_INIT.slice(); },
    report: function () { return NOTES.slice(); },
    run: run
  };
})();
