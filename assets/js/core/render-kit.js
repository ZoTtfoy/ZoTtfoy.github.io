/* ==========================================================================
 *  render-kit.js —— 渲染层的公共底座
 * --------------------------------------------------------------------------
 *  这个文件只做两件事：
 *    ① 给所有屏模块提供同一套小工具（转义、图标、取元素、写 innerHTML…）
 *    ② 收一张「屏模块登记表」，让 render.js 的核心块表能找到它们
 *
 *  为什么要有它：原生 <script> 之间没有共享闭包，一旦把 render.js 按屏拆开，
 *  原来那些 IIFE 内部的局部函数就互相看不见了。要么把它们全挂到全局（污染），
 *  要么给一个**唯一的**命名空间 —— 这里选后者，且名字写死成 SITE_RENDER_KIT。
 *
 *  ⚠️ 加载顺序（见 index.html）：
 *      config/themes（数据） → icons → render-kit → sections/* → render → …
 *    kit 必须在任何屏模块之前，render.js 必须在所有屏模块之后。
 *
 *  ⚠️ kit 里不要放业务逻辑。它一旦变成"什么都往里塞的工具箱"，
 *      这次拆分就等于白拆了。新工具先问一句：是不是只有一屏用？
 *      只有一屏用的，就留在那个屏文件里。
 * ========================================================================== */

window.SITE_RENDER_KIT = (function () {
  "use strict";

  var C = window.SITE_CONFIG || {};

  /* ---------- 共用小工具 ---------- */
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function text(v) { return esc(v).replace(/\n/g, "<br>"); }
  function icon(name, cls) { return window.siteIcon(name, cls); }
  function $(id) { return document.getElementById(id); }
  function set(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function delay(i, step) { return "--reveal-delay:" + (i * (step || 70)) + "ms;"; }

  /* ---------- 屏模块登记表 ----------
     屏模块在自己的文件末尾调 register("gaming", {…})。
     这里故意不做「自动发现」：登记是显式的，谁提供什么接口一目了然；
     也避免以后有人靠文件名猜接口。 */
  var parts = {};
  function register(name, api) {
    if (parts[name]) {
      if (window.console && console.warn) console.warn("[render-kit] 重复登记：" + name);
    }
    parts[name] = api || {};
    return parts[name];
  }

  return {
    C: C,
    esc: esc, text: text, icon: icon,
    $: $, set: set, arr: arr, delay: delay,
    parts: parts,
    register: register
  };
})();
