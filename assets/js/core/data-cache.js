/* ==========================================================================
 *  data-cache.js —— 共享 JSON 请求（2026-11-18）
 * --------------------------------------------------------------------------
 *  背景：载入时 data/netease.json 与 data/steam.json 各被 fetch 两次 ——
 *    · sync.js 读 netease（画曲目）/ steam（画战绩）
 *    · albumwall.js 读 netease（拿真实封面）/ steamwall.js 读 steam（自检）
 *  浏览器 HTTP 缓存能挡住第二次的真实网络往返，但两个请求各自解析 JSON、
 *  各自占一次 fetch 调度，而且 no-cache 下仍会各发一次条件请求。
 *
 *  这里做进程内去重：同一 URL 在**同一页面生命周期**内只发一次请求，
 *  后来者共享同一个 Promise。各模块原有的超时 / 降级语义由调用方保留。
 *
 *  ⚠️ 只缓存成功的解析结果；失败不缓存，避免一次网络抖动让整页永久降级。
 *  ⚠️ 不改变数据新鲜度：仍是 no-cache（每次刷新页面重新取）。
 * ========================================================================== */
window.SITE_DATA = (function () {
  "use strict";

  var pending = {};   // url -> Promise（含进行中的）

  function getJSON(url, opts) {
    if (!url || typeof fetch !== "function") return Promise.resolve(null);
    opts = opts || {};
    if (pending[url]) return pending[url];

    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeout || 8000);

    var p = fetch(url, {
      cache: "no-cache",
      signal: ctl ? ctl.signal : undefined,
      headers: { accept: "application/json" }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) {
        clearTimeout(timer);
        /* 成功才留在缓存里；失败（null）删掉，下次允许重试 */
        if (v === null || v === undefined) delete pending[url];
        return v;
      });

    pending[url] = p;
    return p;
  }

  return {
    getJSON: getJSON,
    /* 自检用：本页已发起的请求数（验证去重是否生效） */
    stats: function () { return { keys: Object.keys(pending).length }; }
  };
})();
