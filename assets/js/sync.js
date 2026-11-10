/* ==========================================================================
 *  sync.js —— 把「站外抓来的数据」贴回页面（渐进增强）
 * --------------------------------------------------------------------------
 *  为什么需要这一层：
 *    网易云的「最近播放」没法从浏览器直连（要 MUSIC_U cookie + weapi 加密），
 *    所以由仓库里的 GitHub Actions 定时抓取，写成两个 JSON 文件：
 *
 *      data/netease.json   →  { totalSongs, level, week: [ { title, artist, album, playCount, url } ], tracks }
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

  /* 当前这一屏实际在用的曲目（清洗过的完整列表，未被 trackCap 截断）。
     density.js 的 fitListen() 需要在溢出时"少放一首"，
     所以必须拿得到完整列表，而不是已经截断的结果。 */
  var current = [];

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

  /* ------------------------------------------------- Q2：听歌排行 */
  /* 数据可能来自三个来源，页脚要如实说明：
       rank  = 听歌排行（账号把排行设为公开了）
       liked = 我喜欢的音乐（排行私密时的兜底，零设置也能有真实内容）
       cache = 本次没抓到，沿用旧数据
     两种半成品也都要能用：
       · 只有排行、没有累计听歌（旧缓存） → 画排行，页脚不显示总数
       · 只有累计听歌、没有排行（没配 cookie） → 排行保持兜底，页脚照样有总数
     以前这里一上来就 `if (!tracks.length) return false`，把第二种情况直接丢了。 */
  function applyTracks(data) {
    if (!data) return false;
    if (!window.SITE_RENDER) return false;

    var meta = {
      totalSongs: Number(data.totalSongs) || 0,
      level: Number(data.level) || 0,
      updated: typeof data.updated === "string" ? data.updated : "",
      source: typeof data.source === "string" ? data.source : "rank",
      likedName: typeof data.likedName === "string" ? data.likedName : "",
      live: true
    };
    var hasMeta = meta.totalSongs > 0;

    // 只接受长得对的条目，脏数据直接跳过而不是把整列表画崩
    var raw = Array.isArray(data.tracks) && data.tracks.length ? data.tracks
            : Array.isArray(data.week) && data.week.length ? data.week
            : [];
    var clean = raw.filter(function (t) {
      return t && typeof t.title === "string" && t.title.trim();
    }).map(function (t) {
      return {
        title: t.title,
        artist: t.artist || "",
        album: t.album || "",
        playCount: Number(t.playCount) || 0,
        score: Number(t.score) || 0,
        url: typeof t.url === "string" && /^https?:\/\//.test(t.url) ? t.url : "",
        /* 封面与可播性也必须在白名单里。
           ⚠️ 这里是个"字段白名单"过滤 —— 少写一个字段，数据文件里明明有、
           页面上却永远不出现，而且不报错。加封面第一版就踩了这个坑：
           netease.json 里 100 首全有 cover，页面上却一张图都没有。 */
        cover: typeof t.cover === "string" && /^https?:\/\//.test(t.cover) ? t.cover : "",
        playable: typeof t.playable === "boolean" ? t.playable : undefined
      };
    });

    if (clean.length) {
      current = clean;
      window.SITE_RENDER.setTracks(clean, "live", meta);
      return true;
    }

    /* 没有曲目：至少把累计听歌写在页脚，而不是什么都不做。
       ⚠️ 这里**不能**带 live:true —— 页面上还是兜底曲目，
       页脚却写"已同步"，那就是拿一个真数字给一排假歌背书。
       交给 render 去显示「排行待同步」。 */
    if (hasMeta && typeof window.SITE_RENDER.setListenMeta === "function") {
      window.SITE_RENDER.setListenMeta({
        totalSongs: meta.totalSongs,
        level: meta.level,
        updated: meta.updated
      });
      return false;
    }
    return false;
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
        /* 数据是异步到的，落地时页高已经变了 —— 必须补一次测量。
           ⚠️ 顺序不能反：density 先决定"放几首"（它会把曲目数压到装得下），
           再让 paged 按新的内容定档。反过来就会出现"档位按 6 首算、
           实际渲染 4 首"的错配，那一屏会空出一大块。
           早先这里只调了 Paged.refresh，漏了 density —— 结果在
           810×640 这类窄矮窗口上，回填之后悄悄溢出 3~4px，谁也没发现。 */
        if (window.SITE_DENSITY && typeof window.SITE_DENSITY.refresh === "function") {
          window.SITE_DENSITY.refresh();
        }
        if (window.Paged && typeof window.Paged.refresh === "function") window.Paged.refresh();
        else if (window.SITE_PAGED && typeof window.SITE_PAGED.refresh === "function") {
          window.SITE_PAGED.refresh();
        }
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

  window.SITE_SYNC = {
    run: run,
    applyTracks: applyTracks,
    applyPreviews: applyPreviews,
    /* density.js 用：拿完整曲目列表做"少放一首"的自适应 */
    currentTracks: function () { return current.slice(); }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
