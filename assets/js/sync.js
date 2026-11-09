/* ==========================================================================
 *  sync.js —— 把「站外抓来的数据」贴回页面（渐进增强）
 * --------------------------------------------------------------------------
 *  为什么需要这一层：
 *    网易云的「最近播放」没法从浏览器直连（要 MUSIC_U cookie + weapi 加密），
 *    所以由仓库里的 GitHub Actions 定时抓取，写成两个 JSON 文件：
 *
 *      data/netease.json   →  { tracks: [ { title, artist, album, url } ] }
 *      data/previews.json  →  { items: { netease: { title, meta, cover, stats } } }
 *
 *    这个脚本只做一件事：fetch 这两个文件，成功就覆盖页面上的占位内容，
 *    失败（404 / 网络错误 / 格式不对）就静默保持 config.js 里的兜底数据。
 *
 *  设计原则：**任何一步失败都不影响页面可用**。
 *    这两个请求是纯增强，不阻塞首屏，也不会因为 404 在控制台留下红色报错。
 * ========================================================================== */

(function () {
  "use strict";

  var C = window.SITE_CONFIG || {};
  var TIMEOUT = 4000;

  /* --------------------------------------------------------------- 工具 */
  function getJSON(url) {
    if (!url || typeof fetch !== "function") return Promise.resolve(null);

    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);

    return fetch(url, {
      cache: "no-cache",                       // 每次都跟服务器核对，避免看到上次的旧歌单
      signal: ctl ? ctl.signal : undefined,
      headers: { accept: "application/json" }
    })
      .then(function (r) {
        if (!r.ok) return null;                // 404 → 当作"还没同步过"，不是错误
        return r.json();
      })
      .catch(function () { return null; })     // 超时 / 断网 / JSON 坏 → 一律降级
      .then(function (v) { clearTimeout(timer); return v; });
  }

  function setText(root, sel, value) {
    var el = root.querySelector(sel);
    if (el && value) el.textContent = String(value);
  }

  /* ------------------------------------------------- Q2：最近在听 */
  function applyTracks(data) {
    if (!data || !Array.isArray(data.tracks) || !data.tracks.length) return false;
    if (!window.SITE_RENDER || typeof window.SITE_RENDER.setTracks !== "function") return false;

    // 只接受长得对的条目，脏数据直接跳过而不是把整列表画崩
    var clean = data.tracks.filter(function (t) {
      return t && typeof t.title === "string" && t.title.trim();
    }).map(function (t) {
      return {
        title: t.title,
        artist: t.artist || "",
        album: t.album || "",
        url: typeof t.url === "string" && /^https?:\/\//.test(t.url) ? t.url : ""
      };
    });

    if (!clean.length) return false;
    window.SITE_RENDER.setTracks(clean, "live");
    return true;
  }

  /* --------------------------------------- Q1 / Q4：外链摘要卡回填 */
  function applyPreview(id, d) {
    var node = document.querySelector('[data-preview-id="' + id + '"]');
    if (!node || !d) return false;

    if (d.title) setText(node, "[data-preview-title]", d.title);
    if (d.meta) setText(node, "[data-preview-meta]", d.meta);

    // 封面：原来没有就补一个 <span class="preview__cover">，并切换成带图形态
    var cover = typeof d.cover === "string" && /^https?:\/\//.test(d.cover) ? d.cover : "";
    if (cover && !node.querySelector(".preview__cover")) {
      var span = document.createElement("span");
      span.className = "preview__cover";
      var img = document.createElement("img");
      img.src = cover;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      span.appendChild(img);
      node.insertBefore(span, node.firstChild);
      node.classList.add("preview--cover");
    }

    // 数据格：歌单数 / 粉丝数 / 信用分 这类
    if (Array.isArray(d.stats) && d.stats.length) {
      var box = node.querySelector("[data-preview-stats]");
      if (box) {
        box.innerHTML = d.stats
          .filter(function (s) { return s && s.value != null && s.value !== ""; })
          .map(function (s) {
            var b = document.createElement("b");
            b.textContent = String(s.value);
            var wrap = document.createElement("span");
            wrap.className = "preview__stat";
            wrap.appendChild(b);
            wrap.appendChild(document.createTextNode(String(s.label || "")));
            return wrap.outerHTML;
          }).join("");
        box.hidden = false;
      }
    }

    return true;
  }

  function applyPreviews(data) {
    if (!data || !data.items || typeof data.items !== "object") return 0;
    var n = 0;
    Object.keys(data.items).forEach(function (id) {
      if (applyPreview(id, data.items[id])) n++;
    });
    return n;
  }

  /* --------------------------------------------------------------- 启动 */
  function run() {
    var listen = C.listen || {};
    var tasks = [
      getJSON(listen.dataFile || "data/netease.json").then(applyTracks),
      getJSON("data/previews.json").then(applyPreviews)
    ];

    if (typeof Promise.allSettled === "function") {
      Promise.allSettled(tasks).then(function () {
        // 内容可能变高了（比如多了封面图），让翻页引擎重新量一遍
        if (window.Paged && typeof window.Paged.refresh === "function") window.Paged.refresh();
      });
    }
  }

  // 不抢首屏：等页面进入空闲再拉数据
  function boot() {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 600);
    }
  }

  window.SITE_SYNC = { run: run, applyTracks: applyTracks, applyPreviews: applyPreviews };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
