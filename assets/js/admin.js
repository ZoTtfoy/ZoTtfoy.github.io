/* ==========================================================================
 *  admin.js —— 内容编辑器
 * --------------------------------------------------------------------------
 *  1) 顶部 ADMIN 区块是访问凭据（只存加盐哈希，不存明文）。
 *  2) 下面是「字段表」：想给编辑器加一个可编辑项，在 SCHEMA 里加一行即可。
 *  3) 编辑结果存在本机浏览器（localStorage），点「发布」时生成新的 config.js。
 * ========================================================================== */

/* ---------------------------------------------------------------------------
 *  凭据：这里只存「盐 + 加盐 SHA-256 摘要」，不含口令明文。
 *  口令在首次交付时单独给到你，记在仓库外的本地文件里（已被 .gitignore 排除）。
 *  忘记口令：用 editor 抽屉里的「更改管理账户 / 口令」重新生成一套替换下面三行。
 *
 *  注意：这是本机内容的入口锁，挡的是随手乱点与好奇，不是密码学意义上的
 *        安全边界。真正的发布权限在你的 GitHub 账号手里——没有仓库写权限，
 *        改什么都传不上去。
 * ------------------------------------------------------------------------- */

window.ADMIN = {
  salt: "4044a63a8e4e6997",
  userHash: "d6aec8ea816df41de6130e11d21e2b137d10d7852495bf8dc09d541b034782ab",
  passHash: "e665e0d3b47281ca1665f04eaf3ec719fe11a8b0b87f45fc7cf09db55fa84ca0",

  // 「一键推送」需要的仓库信息
  repo: "ZoTtfoy/ZoTtfoy.github.io",
  branch: "main",
  configPath: "assets/js/config.js",
  siteUrl: "https://zottfoy.github.io/"
};

(function () {
  "use strict";

  var A = window.ADMIN;
  var DRAFT_KEY = "zotrod-draft-v1";
  var TOKEN_KEY = "zotrod-gh-token";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var draft = null;
  var dirty = false;
  var activeTab = "basic";

  /* ============================================================ SHA-256 */
  /* 自带实现：不依赖 crypto.subtle，file:// 下打开编辑器也能校验 */
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];

  function sha256(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xd800 || c >= 0xe000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        var cp = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(++i) & 0x3ff));
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var s = 56; s >= 0; s -= 8) bytes.push((bitLen / Math.pow(2, s)) & 0xff);

    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var w = new Array(64);
    for (var blk = 0; blk < bytes.length; blk += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] = (bytes[blk + t * 4] << 24) | (bytes[blk + t * 4 + 1] << 16) |
               (bytes[blk + t * 4 + 2] << 8) | bytes[blk + t * 4 + 3];
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c2 = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c2) ^ (b & c2);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c2; c2 = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c2) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function hash(v) { return sha256(A.salt + "::" + v); }

  /* 对外暴露，供自检脚本调用 */
  window.ADMIN_HASH = { sha256: sha256, hash: hash };

  /* ============================================================ 工具 */
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("is-visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("is-visible"); }, 2200);
  }

  function mark(d) {
    dirty = d !== false;
    var el = $("#draftState");
    if (el) {
      el.textContent = dirty ? "· 有未发布的改动" : "· 已同步";
      el.classList.toggle("is-dirty", dirty);
    }
    if (dirty) saveDraft();
    else clearDraft();
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }
  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setPath(obj, path, value) {
    var cur = obj;
    for (var i = 0; i < path.length - 1; i++) cur = cur[path[i]];
    cur[path[path.length - 1]] = value;
    mark();
  }
  function getPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null) return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* 当前风格在某明暗下的主色，用于色板预览 */
  function currentSkinAccent(mode) {
    var T = window.SITE_THEMES;
    if (!T) return mode === "dark" ? "#84cbb2" : "#2f6b5b";
    var t = T.get((draft.ui || {}).skin || T.defaultSkin);
    if (!t) return mode === "dark" ? "#84cbb2" : "#2f6b5b";
    return (t[mode] || t.light).accent;
  }

  /* 头像预览：有图用图，没图用字母 */
  function avatarPreviewHtml() {
    var s = draft.site || {};
    if (s.avatar) {
      return '<img src="' + esc(s.avatar) + '" alt="头像预览">';
    }
    return '<span class="avatar-preview__letter">' +
      esc(s.initials || (s.name || "Z").slice(0, 1)) + '</span>';
  }

  /* ============================================================ 字段表 */
  /* 想加一个可编辑项？往 groups 里加一行 { path:[...], label:"..." } */
  function scalarFields(list) {
    return list.map(function (f) {
      return '<label class="field' + (f.full ? ' field--full' : '') + '">' +
        '<span class="field__label">' + esc(f.label) + '</span>' +
        (f.type === "area"
          ? '<textarea class="area" data-path="' + f.path.join(".") + '">' + esc(f.value) + '</textarea>'
          : f.type === "bool"
            ? '<label class="switch"><input type="checkbox" data-path="' + f.path.join(".") + '"' +
              (f.value ? ' checked' : '') + '><span class="switch__track"></span></label>'
            : '<input class="input' + (f.mono ? ' input--mono' : '') + '" type="text" data-path="' +
              f.path.join(".") + '" value="' + esc(f.value) + '">') +
        '</label>';
    }).join("");
  }

  var TABS = [
    { id: "basic", label: "基础" },
    { id: "about", label: "关于" },
    { id: "services", label: "业务" },
    { id: "interests", label: "喜好" },
    { id: "social", label: "社交" },
    { id: "theme", label: "外观" }
  ];

  /* 列表型内容（可增删排序）的字段定义 */
  var LISTS = {
    services: {
      path: ["services", "items"], title: "业务卡片", desc: "首屏下方「业务范畴」的卡片",
      make: function () { return { icon: "sparkles", title: "新业务", desc: "", tags: [] }; },
      fields: [
        { k: "icon",  label: "图标名", hint: "icons.js 里的名字，如 code / palette" },
        { k: "title", label: "标题" },
        { k: "desc",  label: "说明", type: "area", full: true },
        { k: "tags",  label: "标签（逗号分隔）", type: "csv", full: true }
      ]
    },
    interests: {
      path: ["interests", "items"], title: "喜好卡片", desc: "「个人喜好」区",
      make: function () { return { icon: "heart", title: "新喜好", desc: "", meta: "" }; },
      fields: [
        { k: "icon",  label: "图标名" },
        { k: "title", label: "标题" },
        { k: "desc",  label: "说明", type: "area", full: true },
        { k: "meta",  label: "右下角小字", full: true }
      ]
    },
    social: {
      path: ["social", "items"], title: "社交链接", desc: "填 url 会跳转；填 copy 则点一下复制（适合 QQ / 微信）",
      make: function () { return { icon: "link", label: "新平台", handle: "", url: "https://" }; },
      fields: [
        { k: "icon",   label: "图标名" },
        { k: "label",  label: "平台名" },
        { k: "handle", label: "显示的小字" },
        { k: "url",    label: "链接（可留空）", full: true },
        { k: "copy",   label: "或：点击复制的账号", full: true }
      ]
    },
    facts: {
      path: ["about", "facts"], title: "信息表", desc: "「关于」右侧的几行小资料",
      make: function () { return { label: "新项目", value: "" }; },
      fields: [
        { k: "label", label: "名称" },
        { k: "value", label: "内容" }
      ]
    }
  };

  /* ============================================================ 渲染 */
  function renderTabs() {
    $("#tabs").innerHTML = TABS.map(function (t) {
      return '<button class="tab' + (t.id === activeTab ? ' is-active' : '') +
             '" type="button" data-tab="' + t.id + '">' + t.label + '</button>';
    }).join("");
  }

  function group(title, desc, body) {
    return '<section class="group"><header class="group__head"><div><h2>' + esc(title) + '</h2>' +
           (desc ? '<p>' + esc(desc) + '</p>' : '') + '</div></header>' +
           '<div class="group__body">' + body + '</div></section>';
  }

  function renderList(key) {
    var def = LISTS[key];
    var items = getPath(draft, def.path) || [];
    var rows = items.map(function (it, i) {
      var fields = def.fields.map(function (f) {
        var v = it[f.k];
        if (f.type === "csv") v = (Array.isArray(v) ? v.join(", ") : (v || ""));
        if (f.type === "area") {
          return '<label class="field' + (f.full ? ' field--full' : '') + '">' +
                 '<span class="field__label">' + esc(f.label) + '</span>' +
                 '<textarea class="area" data-idx="' + i + '" data-key="' + key + '" data-f="' + f.k + '">' +
                 esc(v) + '</textarea></label>';
        }
        return '<label class="field' + (f.full ? ' field--full' : '') + '">' +
               '<span class="field__label">' + esc(f.label) + '</span>' +
               '<input class="input" type="text" data-idx="' + i + '" data-key="' + key +
               '" data-f="' + f.k + '" value="' + esc(v == null ? "" : v) + '"></label>';
      }).join("");

      return '<div class="item"><div class="item__top"><span class="item__no">' +
        String(i + 1).padStart(2, "0") + '</span><div class="item__tools">' +
        '<button class="icon-btn" type="button" data-move="up" data-idx="' + i + '" data-key="' + key +
          '" aria-label="上移"' + (i === 0 ? " disabled" : "") + '>↑</button>' +
        '<button class="icon-btn" type="button" data-move="down" data-idx="' + i + '" data-key="' + key +
          '" aria-label="下移"' + (i === items.length - 1 ? " disabled" : "") + '>↓</button>' +
        '<button class="icon-btn" type="button" data-del="' + i + '" data-key="' + key +
          '" aria-label="删除">✕</button>' +
        '</div></div><div class="item__grid">' + fields + '</div></div>';
    }).join("");

    return group(def.title, def.desc, rows +
      '<div class="row"><button class="btn btn--quiet btn--sm" type="button" data-add="' + key +
      '">+ 添加一项</button></div>');
  }

  function renderPanel() {
    var body = "";

    if (activeTab === "basic") {
      var s = draft.site || {};
      body += group("站点信息", "名字、身份、首页大标题", scalarFields([
        { path: ["site", "name"], label: "名字", value: s.name },
        { path: ["site", "initials"], label: "头像字母（1-2 个）", value: s.initials },
        { path: ["site", "role"], label: "身份一行字", value: s.role },
        { path: ["site", "tagline"], label: "首页大标题（换行用 \\n）", value: s.tagline, type: "area", full: true },
        { path: ["site", "description"], label: "首页简介 / 搜索摘要", value: s.description, type: "area", full: true },
        { path: ["site", "location"], label: "坐标", value: s.location },
        { path: ["site", "email"], label: "联系邮箱", value: s.email }
      ]));

      body += group("头像", "可以在页头、页脚和首页顶部显示",
        '<div class="avatar-row">' +
          '<span class="avatar-preview" data-avatar-preview>' + avatarPreviewHtml() + '</span>' +
          '<div class="avatar-actions">' +
            '<div class="row" style="margin-top:0">' +
              '<button class="btn btn--quiet btn--sm" type="button" data-avatar-up>选择图片</button>' +
              '<button class="btn btn--quiet btn--sm" type="button" data-avatar-clear>清除</button>' +
            '</div>' +
            '<p class="sheet__hint" style="margin-top:8px">' +
              '会自动居中裁成正方形、缩到 256×256 并压缩，通常只有几十 KB。' +
              '也可以直接在上面填一个图片网址。' +
            '</p>' +
          '</div>' +
          '<input type="file" accept="image/*" data-avatar-file hidden>' +
        '</div>' +
        scalarFields([
          { path: ["site", "avatar"], label: "头像图片地址（留空则显示字母）", value: s.avatar || "", full: true, mono: true }
        ]));

      body += group("合作状态与页脚", "", scalarFields([
        { path: ["site", "available"], label: "显示「开放合作」标记", value: s.available, type: "bool" },
        { path: ["site", "availableText"], label: "标记文字", value: s.availableText },
        { path: ["site", "copyright"], label: "版权行", value: s.copyright },
        { path: ["site", "footerNote"], label: "页脚小字", value: s.footerNote }
      ]));

      body += group("首页按钮与模块开关", "关掉某个模块，导航栏会自动去掉它",
        scalarFields([
          { path: ["hero", "primary", "label"], label: "主按钮文字", value: getPath(draft, ["hero", "primary", "label"]) },
          { path: ["hero", "primary", "target"], label: "主按钮跳转（#services）", value: getPath(draft, ["hero", "primary", "target"]), mono: true },
          { path: ["hero", "secondary", "label"], label: "副按钮文字", value: getPath(draft, ["hero", "secondary", "label"]) },
          { path: ["hero", "secondary", "target"], label: "副按钮跳转（#social）", value: getPath(draft, ["hero", "secondary", "target"]), mono: true }
        ]) +
        ["about", "services", "interests", "social"].map(function (k) {
          var sec = getPath(draft, ["sections", k]) || {};
          return '<div class="row" style="align-items:center">' +
            '<label class="switch"><input type="checkbox" data-path="sections.' + k + '.enabled"' +
            (sec.enabled !== false ? " checked" : "") + '><span class="switch__track"></span>' +
            '<span>' + esc(sec.label || k) + ' 模块</span></label>' +
            '<input class="input" style="flex:0 0 90px" type="text" data-path="sections.' + k + '.order" value="' +
            esc(sec.order == null ? "" : sec.order) + '" aria-label="排序">' +
            '</div>';
        }).join(""));
    }

    if (activeTab === "about") {
      body += group("标题文案", "", scalarFields([
        { path: ["about", "eyebrow"], label: "小标签（01 / ABOUT）", value: getPath(draft, ["about", "eyebrow"]) },
        { path: ["about", "title"], label: "标题", value: getPath(draft, ["about", "title"]) },
        { path: ["about", "lead"], label: "副标题", value: getPath(draft, ["about", "lead"]), full: true }
      ]));

      var paras = getPath(draft, ["about", "paragraphs"]) || [];
      body += group("正文段落", "每个段落一个文本框", paras.map(function (p, i) {
        return '<label class="field"><span class="field__label">第 ' + (i + 1) + ' 段</span>' +
               '<textarea class="area" data-par="' + i + '">' + esc(p) + '</textarea></label>' +
               '<div class="row"><button class="btn btn--quiet btn--sm" type="button" data-par-del="' + i +
               '">删除这段</button></div>';
      }).join("") + '<div class="row"><button class="btn btn--quiet btn--sm" type="button" data-par-add>' +
        '+ 添加一段</button></div>');

      body += renderList("facts");
      body += group("关键词标签", "逗号分隔", 
        '<label class="field"><span class="field__label">标签</span>' +
        '<input class="input" type="text" data-csv="about.tags" value="' +
        esc(((getPath(draft, ["about", "tags"]) || []).join(", "))) + '"></label>');
    }

    if (activeTab === "services") {
      body += group("标题文案", "", scalarFields([
        { path: ["services", "eyebrow"], label: "小标签", value: getPath(draft, ["services", "eyebrow"]) },
        { path: ["services", "title"], label: "标题", value: getPath(draft, ["services", "title"]) },
        { path: ["services", "lead"], label: "副标题", value: getPath(draft, ["services", "lead"]), full: true }
      ]));
      body += renderList("services");
    }

    if (activeTab === "interests") {
      body += group("标题文案", "", scalarFields([
        { path: ["interests", "eyebrow"], label: "小标签", value: getPath(draft, ["interests", "eyebrow"]) },
        { path: ["interests", "title"], label: "标题", value: getPath(draft, ["interests", "title"]) },
        { path: ["interests", "lead"], label: "副标题", value: getPath(draft, ["interests", "lead"]), full: true }
      ]));
      body += renderList("interests");
    }

    if (activeTab === "social") {
      body += group("标题文案", "", scalarFields([
        { path: ["social", "eyebrow"], label: "小标签", value: getPath(draft, ["social", "eyebrow"]) },
        { path: ["social", "title"], label: "标题", value: getPath(draft, ["social", "title"]) },
        { path: ["social", "lead"], label: "副标题", value: getPath(draft, ["social", "lead"]), full: true },
        { path: ["social", "contactHint"], label: "底部联系提示语", value: getPath(draft, ["social", "contactHint"]), full: true }
      ]));
      body += renderList("social");
    }

    if (activeTab === "theme") {
      var ui = draft.ui || {};
      body += group("风格", "选一套整体气质；下面还能单独调明暗与主色",
        '<div class="skin-grid" id="skinPick">' +
        (window.SITE_THEMES ? window.SITE_THEMES.list : []).map(function (t) {
          var on = (ui.skin || "ink") === t.id;
          return '<button class="skin-cell' + (on ? ' is-active' : '') + '" type="button" data-pick-skin="' + t.id + '">' +
            '<span class="skin-cell__swatch">' +
              t.swatch.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join("") +
            '</span>' +
            '<strong>' + esc(t.name) + '</strong>' +
            '<small>' + esc(t.desc) + '</small>' +
          '</button>';
        }).join("") + '</div>' +
        '<p class="sheet__hint">当前默认风格：<code data-skin-label>' +
        esc((window.SITE_THEMES && window.SITE_THEMES.get(ui.skin || "ink")
          ? window.SITE_THEMES.get(ui.skin || "ink").name : ui.skin || "ink")) +
        '</code>。访客仍可在页面上自己切换，这里只决定首次打开的默认值。</p>' +
        '<p class="sheet__hint"><a href="themes.html" target="_blank" rel="noopener" ' +
        'style="color:var(--accent)">把所有风格并排看一遍 →</a></p>');

      body += group("主题与动效", "", scalarFields([
        { path: ["ui", "themeDefault"], label: "默认明暗（auto / light / dark）", value: ui.themeDefault, mono: true },
        { path: ["ui", "accent"], label: "覆盖浅色主色（留空则用风格自带）", value: ui.accent || "", mono: true },
        { path: ["ui", "accentDark"], label: "覆盖深色主色", value: ui.accentDark || "", mono: true },
        { path: ["ui", "showSkinPicker"], label: "右上角风格切换按钮", value: ui.showSkinPicker, type: "bool" },
        { path: ["ui", "showThemeToggle"], label: "右上角深浅快切按钮", value: ui.showThemeToggle, type: "bool" },
        { path: ["ui", "showProgress"], label: "顶部滚动进度条", value: ui.showProgress, type: "bool" },
        { path: ["ui", "showBackToTop"], label: "右下角回到顶部", value: ui.showBackToTop, type: "bool" },
        { path: ["ui", "ambientMotion"], label: "背景光晕流动", value: ui.ambientMotion, type: "bool" }
      ]));

      body += group("主色预览", "改了上面的覆盖主色，这里跟着变",
        '<div class="row"><span data-swatch="accent" style="width:64px;height:64px;border-radius:14px;background:' +
        esc(ui.accent || currentSkinAccent("light")) + '"></span>' +
        '<span data-swatch="accentDark" style="width:64px;height:64px;border-radius:14px;background:' +
        esc(ui.accentDark || currentSkinAccent("dark")) + '"></span></div>' +
        '<p class="sheet__hint">背景、文字灰阶、圆角、字体这些更细的项在 ' +
        '<code>assets/js/themes.js</code> 里，每套风格都有独立的一段。</p>');
    }

    $("#panel").innerHTML = body;
  }

  /* ============================================================ 交互 */
  /* 把图片居中裁成正方形、缩放并压缩，返回 data URL */
  function compressImage(file, done) {
    if (!file || !/^image\//.test(file.type)) { toast("请选择图片文件"); return; }
    var reader = new FileReader();
    reader.onerror = function () { toast("文件读取失败"); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { toast("图片无法解析，换一张试试"); };
      img.onload = function () {
        var SIZE = 256;
        var canvas = document.createElement("canvas");
        canvas.width = canvas.height = SIZE;
        var g = canvas.getContext("2d");
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2;
        var sy = (img.height - side) / 2;
        if (g.imageSmoothingQuality) g.imageSmoothingQuality = "high";
        // 先铺一层底色，避免透明 PNG 变黑
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, SIZE, SIZE);
        g.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);

        var out = canvas.toDataURL("image/webp", 0.82);
        if (out.indexOf("data:image/webp") !== 0) {
          out = canvas.toDataURL("image/jpeg", 0.85);
        }
        done(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* 估算 data URL 的实际体积（KB） */
  function dataUrlKb(dataUrl) {
    var b64 = String(dataUrl).split(",")[1] || "";
    return Math.round(b64.length * 0.75 / 1024);
  }

  window.ADMIN_COMPRESS = compressImage;
  window.ADMIN_KB = dataUrlKb;

  function bindEditor() {
    $("#tabs").addEventListener("click", function (e) {
      var t = e.target.closest("[data-tab]");
      if (!t) return;
      activeTab = t.getAttribute("data-tab");
      renderTabs();
      renderPanel();
    });

    var panel = $("#panel");

    panel.addEventListener("input", function (e) {
      var el = e.target;

      // 列表里的字段
      if (el.dataset.key && el.dataset.f != null) {
        var key = el.dataset.key, i = +el.dataset.idx, f = el.dataset.f;
        var arr = getPath(draft, LISTS[key].path);
        var def = LISTS[key].fields.filter(function (x) { return x.k === f; })[0];
        arr[i][f] = def && def.type === "csv"
          ? el.value.split(",").map(function (x) { return x.trim(); }).filter(Boolean)
          : el.value;
        mark();
        return;
      }

      // 通用路径
      if (el.dataset.path) {
        var path = el.dataset.path.split(".");
        var last = path[path.length - 1];

        // 头像网址改动时同步预览
        if (el.dataset.path === "site.avatar") {
          draft.site.avatar = el.value.trim();
          mark();
          var pv = $("[data-avatar-preview]");
          if (pv) pv.innerHTML = avatarPreviewHtml();
          return;
        }

        var val = el.type === "checkbox" ? el.checked : el.value;
        if (last === "order") val = Number(val) || 0;
        setPath(draft, path, val);
        // 改主色时只更新色块，避免整块重绘导致输入框失焦
        if (last === "accent" || last === "accentDark") {
          var sw = document.querySelector('[data-swatch="' + last + '"]');
          if (sw) sw.style.background = val || (last === "accent" ? "#2f6b5b" : "#84cbb2");
        }
        return;
      }

      // 段落
      if (el.dataset.par != null) {
        draft.about.paragraphs[+el.dataset.par] = el.value;
        mark();
        return;
      }

      // 逗号列表
      if (el.dataset.csv) {
        var p2 = el.dataset.csv.split(".");
        var obj = draft; for (var j = 0; j < p2.length - 1; j++) obj = obj[p2[j]];
        obj[p2[p2.length - 1]] = el.value.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
        mark();
      }
    });

    panel.addEventListener("change", function (e) {
      var el = e.target;
      if (!el.hasAttribute || !el.hasAttribute("data-avatar-file")) return;
      var file = el.files && el.files[0];
      if (!file) return;

      compressImage(file, function (dataUrl) {
        draft.site.avatar = dataUrl;
        mark();
        var pv = $("[data-avatar-preview]");
        if (pv) pv.innerHTML = avatarPreviewHtml();
        var field = $('[data-path="site.avatar"]');
        if (field) field.value = dataUrl;
        var kb = dataUrlKb(dataUrl);
        toast("头像已就绪（约 " + kb + " KB）" + (kb > 120 ? "，偏大，建议换更简洁的图" : ""));
      });
      el.value = "";
    });

    panel.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;

      /* ---- 选择风格 ---- */
      if (b.dataset.pickSkin) {
        draft.ui = draft.ui || {};
        draft.ui.skin = b.dataset.pickSkin;
        mark();
        renderPanel();
        var t = window.SITE_THEMES && window.SITE_THEMES.get(b.dataset.pickSkin);
        var label = $("[data-skin-label]");
        if (label && t) label.textContent = t.name;
        toast("默认风格已设为「" + (t ? t.name : b.dataset.pickSkin) + "」");
        return;
      }

      /* ---- 头像上传 ---- */
      if (b.hasAttribute("data-avatar-up")) {
        var fileInput = $("[data-avatar-file]");
        if (fileInput) fileInput.click();
        return;
      }
      if (b.hasAttribute("data-avatar-clear")) {
        draft.site.avatar = "";
        mark();
        var prev = $("[data-avatar-preview]");
        if (prev) prev.innerHTML = avatarPreviewHtml();
        var urlField = $('[data-path="site.avatar"]');
        if (urlField) urlField.value = "";
        toast("已清除头像");
        return;
      }

      if (b.dataset.add) {
        var key = b.dataset.add;
        getPath(draft, LISTS[key].path).push(LISTS[key].make());
        mark(); renderPanel(); return;
      }

      if (b.dataset.del != null) {
        var k1 = b.dataset.key, i1 = +b.dataset.del;
        var a1 = getPath(draft, LISTS[k1].path);
        if (!confirm("确定删除这一项？")) return;
        a1.splice(i1, 1);
        mark(); renderPanel(); return;
      }

      if (b.dataset.move) {
        var k2 = b.dataset.key, i2 = +b.dataset.idx;
        var a2 = getPath(draft, LISTS[k2].path);
        var to = b.dataset.move === "up" ? i2 - 1 : i2 + 1;
        if (to < 0 || to >= a2.length) return;
        var tmp = a2[i2]; a2[i2] = a2[to]; a2[to] = tmp;
        mark(); renderPanel(); return;
      }

      if (b.dataset.parAdd != null) {
        draft.about.paragraphs.push("");
        mark(); renderPanel(); return;
      }
      if (b.dataset.parDel != null) {
        draft.about.paragraphs.splice(+b.dataset.parDel, 1);
        mark(); renderPanel(); return;
      }
    });
  }

  /* ============================================================ 序列化 */
  function fmt(v, indent) {
    var pad = new Array(indent + 1).join("  ");
    var padIn = new Array(indent + 2).join("  ");

    if (v === null) return "null";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      // 纯字符串数组压成一行，读起来更紧凑
      var allStr = v.every(function (x) { return typeof x === "string"; });
      if (allStr) return "[" + v.map(function (x) { return JSON.stringify(x); }).join(", ") + "]";
      return "[\n" + v.map(function (x) {
        return padIn + fmt(x, indent + 2);
      }).join(",\n") + "\n" + pad + "]";
    }
    var keys = Object.keys(v);
    if (!keys.length) return "{}";
    return "{\n" + keys.map(function (k) {
      var key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      return padIn + key + ": " + fmt(v[k], indent + 2);
    }).join(",\n") + "\n" + pad + "}";
  }

  function serialize(cfg) {
    return "/* ==========================================================================\n" +
      " *  Zotrod · 个人主页  ——  内容配置（由内容编辑器生成）\n" +
      " *  修改方式二选一：直接改本文件，或用 /admin.html 图形化编辑后发布。\n" +
      " * ========================================================================== */\n\n" +
      "window.SITE_CONFIG = " + fmt(cfg, 0) + ";\n";
  }

  /* 供自检脚本使用：验证序列化结果可无损还原 */
  window.ADMIN_SERIALIZE = serialize;

  /* ============================================================ 发布 */
  function b64utf8(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function openSheet() { $("#publishSheet").hidden = false; }
  function closeSheet() { $("#publishSheet").hidden = true; }

  async function pushToGithub() {
    var input = $("#tokenInput");
    var msg = $("#pushMsg");
    var token = (input.value || localStorage.getItem(TOKEN_KEY) || "").trim();
    if (!token) { msg.textContent = "请先填 GitHub Token。"; return; }
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}

    msg.textContent = "正在提交…";
    var api = "https://api.github.com/repos/" + A.repo + "/contents/" + A.configPath;
    var headers = {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    try {
      var cur = await fetch(api + "?ref=" + A.branch, { headers: headers });
      var sha = null;
      if (cur.ok) { sha = (await cur.json()).sha; }
      else if (cur.status !== 404) {
        throw new Error("读取现有文件失败（" + cur.status + "），请检查令牌权限。");
      }

      var res = await fetch(api, {
        method: "PUT",
        headers: headers,
        body: JSON.stringify({
          message: "content: update from admin",
          content: b64utf8(serialize(draft)),
          branch: A.branch,
          sha: sha || undefined
        })
      });

      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error("提交失败（" + res.status + "）" + (err.message ? "：" + err.message : ""));
      }

      msg.textContent = "已提交。GitHub Pages 约 1–2 分钟后自动上线。";
      mark(false);
      toast("已提交到 GitHub");
    } catch (err) {
      msg.textContent = err.message || "提交失败，请重试。";
    }
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy") ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  function bindSheet() {
    $("#publishBtn").addEventListener("click", openSheet);
    $$("[data-close]").forEach(function (el) { el.addEventListener("click", closeSheet); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });

    $("#copyCfg").addEventListener("click", function () {
      copy(serialize(draft)).then(function () { toast("config.js 已复制"); })
        .catch(function () { toast("复制失败，请改用下载"); });
    });

    $("#editOnGithub").href = "https://github.com/" + A.repo + "/edit/" + A.branch + "/" + A.configPath;

    $("#downloadCfg").addEventListener("click", function () {
      download("config.js", serialize(draft));
      toast("已下载 config.js");
    });

    $("#pushBtn").addEventListener("click", pushToGithub);
    $("#forgetToken").addEventListener("click", function () {
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      $("#tokenInput").value = "";
      $("#pushMsg").textContent = "已清除本机保存的令牌。";
    });

    $("#genHash").addEventListener("click", function () {
      var u = $("#newUser").value.trim();
      var p = $("#newPass").value;
      if (!u || p.length < 8) { toast("账户必填，口令至少 8 位"); return; }
      var out = $("#hashOut");
      out.hidden = false;
      out.textContent =
        'salt:     "' + A.salt + '"\n' +
        'userHash: "' + hash(u) + '"\n' +
        'passHash: "' + hash(p) + '"';
      toast("已生成，复制到 admin.js 顶部");
    });

    var saved = null;
    try { saved = localStorage.getItem(TOKEN_KEY); } catch (e) {}
    if (saved) $("#tokenInput").placeholder = "已保存令牌，可直接提交";
  }

  /* ============================================================ 登录 */
  function bindGate() {
    var form = $("#gateForm");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var u = $("#gateUser").value.trim();
      var p = $("#gatePass").value;
      if (hash(u) === A.userHash && hash(p) === A.passHash) {
        try { sessionStorage.setItem("zotrod-admin", "1"); } catch (err) {}
        enter();
      } else {
        $("#gateMsg").textContent = "账户或口令不对，请再试一次。";
        $("#gatePass").value = "";
        $("#gatePass").focus();
      }
    });
  }

  function enter() {
    var restored = loadDraft();
    draft = restored || JSON.parse(JSON.stringify(window.SITE_CONFIG));
    $("#gate").hidden = true;
    $("#app").hidden = false;
    renderTabs();
    renderPanel();
    bindEditor();
    bindSheet();
    if (restored) {
      mark(true);
      toast("已恢复上次未发布的草稿");
    } else {
      mark(false);
    }
    $("#resetBtn").addEventListener("click", function () {
      if (!confirm("放弃所有未发布的改动，回到线上版本？")) return;
      draft = JSON.parse(JSON.stringify(window.SITE_CONFIG));
      mark(false); renderPanel(); toast("已还原");
    });
    $("#previewBtn").href = "./";
  }

  /* ============================================================ 启动 */
  function boot() {
    if (!window.SITE_CONFIG) {
      document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">' +
        '找不到 assets/js/config.js，编辑器无法载入。</p>';
      return;
    }
    var authed = false;
    try { authed = sessionStorage.getItem("zotrod-admin") === "1"; } catch (e) {}
    if (authed) enter();
    else bindGate();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
