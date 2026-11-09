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

  /* 用当前配置补全旧草稿。
     为什么必须有这一步：草稿存在用户浏览器里，而配置结构会随版本新增
     （比如后来加的 backdrop / gaming）。老草稿缺这些键时，
     界面上那些字段的写操作会静默失败——用户点了没反应，也没有报错。
     合并规则：对象递归补全，数组整体以草稿为准（用户可能删过卡片）。 */
  function mergeDefaults(base, override) {
    var out = JSON.parse(JSON.stringify(base));
    (function walk(target, src) {
      if (!src || typeof src !== "object") return;
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        if (Array.isArray(v)) {
          target[k] = JSON.parse(JSON.stringify(v));
        } else if (v && typeof v === "object") {
          if (!target[k] || typeof target[k] !== "object" || Array.isArray(target[k])) {
            target[k] = {};
          }
          walk(target[k], v);
        } else {
          target[k] = v;
        }
      });
    })(out, override);
    return out;
  }

  window.ADMIN_MERGE = mergeDefaults;

  /* 6 屏重构后被删掉的顶层字段。
     老用户浏览器里存着旧草稿，mergeDefaults 会把整个 about / services 对象
     原样搬回来，然后又被序列化进新的 config.js —— 页面不读它们，
     但它们会一直占着文件、让人以为还有用。这里直接丢掉。 */
  var DROPPED_KEYS = ["about", "services", "interests", "social"];
  var DROPPED_SITE = ["tagline", "available", "availableText"];

  function pruneDraft(d) {
    if (!d || typeof d !== "object") return d;
    DROPPED_KEYS.forEach(function (k) { delete d[k]; });
    if (d.site) DROPPED_SITE.forEach(function (k) { delete d.site[k]; });
    return d;
  }
  window.ADMIN_PRUNE = pruneDraft;

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
      var path = f.path.join(".");

      /* range：用于遮罩强度这类「必须边调边看」的参数，
         数值实时显示在标签右侧，避免瞎猜。 */
      if (f.type === "range") {
        return '<label class="field field--full">' +
          '<span class="field__label">' + esc(f.label) +
            '<b class="range-out" data-out-for="' + path + '">' + esc(f.value) + '</b>' +
          '</span>' +
          '<input class="range" type="range" min="' + (f.min != null ? f.min : 0) +
            '" max="' + (f.max != null ? f.max : 1) +
            '" step="' + (f.step != null ? f.step : 0.05) +
            '" data-path="' + path + '" data-range="1" value="' + esc(f.value) + '">' +
          (f.hint ? '<span class="field__hint">' + esc(f.hint) + '</span>' : '') +
          '</label>';
      }

      return '<label class="field' + (f.full ? ' field--full' : '') + '">' +
        '<span class="field__label">' + esc(f.label) + '</span>' +
        (f.type === "area"
          ? '<textarea class="area" data-path="' + path + '">' + esc(f.value) + '</textarea>'
          : f.type === "bool"
            ? '<label class="switch"><input type="checkbox" data-path="' + path + '"' +
              (f.value ? ' checked' : '') + '><span class="switch__track"></span></label>'
            : '<input class="input' + (f.mono ? ' input--mono' : '') + '" type="text" data-path="' +
              path + '" value="' + esc(f.value) + '">') +
        '</label>';
    }).join("");
  }

  var TABS = [
    { id: "basic", label: "基础" },
    { id: "profile", label: "我" },
    { id: "listen", label: "在听" },
    { id: "gaming", label: "游戏" },
    { id: "repair", label: "维修" },
    { id: "links", label: "其他" },
    { id: "contact", label: "邮箱" },
    { id: "backdrop", label: "背景" },
    { id: "theme", label: "外观" }
  ];

  /* 列表型内容（可增删排序）的字段定义 */
  /* 列表型内容（可增删排序）的字段定义。
     每一项都是「一层数组」，嵌套结构（比如旧版的 groups[].rows[]）
     在编辑器里没法好好编辑，所以 config.js 里也相应改成了扁平结构。 */
  var LISTS = {
    contacts: {
      path: ["profile", "contacts"], title: "直接联系方式",
      desc: "QQ / 微信这类，点一下就复制，访客不用手动输入",
      make: function () { return { icon: "qq", label: "新联系方式", value: "", hint: "点击复制" }; },
      fields: [
        { k: "icon",  label: "图标名（qq / wechat / mail / phone …）" },
        { k: "label", label: "名称（QQ / 微信）" },
        { k: "value", label: "账号（点击复制的内容）" },
        { k: "hint",  label: "右侧小字（可留空）" }
      ]
    },

    previews: {
      path: ["profile", "previews"], title: "主页摘要卡",
      desc: "网易云 / 小黑盒这类主页入口。填 cover 就是缩略图卡，留空就是纯文字卡",
      make: function () {
        return {
          id: "custom-" + Date.now(), icon: "link", platform: "新平台",
          url: "https://", title: "", meta: "", cover: "", stats: [], accent: ""
        };
      },
      fields: [
        { k: "icon",     label: "图标名（netease / box / shop …）" },
        { k: "platform", label: "平台名" },
        { k: "title",    label: "标题" },
        { k: "meta",     label: "副标题 / 一句说明", full: true },
        { k: "url",      label: "主页链接", full: true, mono: true },
        { k: "cover",    label: "封面图地址（留空则为纯文字卡）", full: true, mono: true,
          hint: "把截图放进 assets/img/，这里填 assets/img/netease.jpg" },
        { k: "accent",   label: "平台主色（如 #c20c0c，留空用默认灰）" }
      ]
    },

    tracks: {
      path: ["listen", "fallback"], title: "兜底曲目",
      desc: "只在自动同步没拿到数据时显示。想换成真实歌单，去配 NETEASE_COOKIE（见 README）",
      make: function () { return { title: "新曲目", artist: "", album: "" }; },
      fields: [
        { k: "title",  label: "曲名" },
        { k: "artist", label: "歌手" },
        { k: "album",  label: "专辑" }
      ]
    },

    gaming: {
      path: ["gaming", "items"], title: "游戏卡片",
      desc: "只有 图标 + 名称 + ID。想加游戏就加一项，布局会自动排",
      make: function () {
        return { icon: "gamepad", iconImage: "", name: "新游戏", uidLabel: "ID", uid: "", color: "", link: "" };
      },
      fields: [
        { k: "icon",      label: "图标名（tower / crosshair / target / note / disc / music）" },
        { k: "iconImage", label: "或：自定义图标图片地址", hint: "填了就用图片，忽略上面的图标名" },
        { k: "name",      label: "游戏名" },
        { k: "uidLabel",  label: "ID 标签（博士 ID / Riot ID …）" },
        { k: "uid",       label: "ID（点卡片复制）" },
        { k: "color",     label: "品牌色（如 #ff4655）" },
        { k: "link",      label: "主页链接（可留空）", full: true, mono: true }
      ]
    },

    quoteRows: {
      path: ["repair", "quote", "rows"], title: "报价表",
      desc: "同一个「分组」名会自动排到同一栏；改分组名就能重新分栏",
      make: function () { return { group: "手机", item: "新项目", price: "", note: "" }; },
      fields: [
        { k: "group", label: "分组（手机 / 电脑 …）" },
        { k: "item",  label: "项目" },
        { k: "price", label: "价格（可写区间：120 – 260）" },
        { k: "note",  label: "备注（可留空）", full: true }
      ]
    },

    links: {
      path: ["links", "items"], title: "其他平台",
      desc: "填 url 会跳转；填 copy 则点一下复制账号",
      make: function () { return { icon: "link", label: "新平台", handle: "", url: "https://" }; },
      fields: [
        { k: "icon",   label: "图标名" },
        { k: "label",  label: "平台名" },
        { k: "handle", label: "显示的小字" },
        { k: "url",    label: "链接（可留空）", full: true },
        { k: "copy",   label: "或：点击复制的账号", full: true }
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

        /* pairs：{label,value} 数组 ↔ 「名称: 内容」多行文本。
           用文本而不用嵌套小表单，是因为一行一个最好改，也不容易点错。 */
        if (f.type === "pairs") {
          var lines = Array.isArray(v)
            ? v.map(function (p) {
                return (p.label || "") + ": " + (p.value == null ? "" : p.value);
              }).join("\n")
            : (v || "");
          return '<label class="field field--full">' +
                 '<span class="field__label">' + esc(f.label) +
                 (f.hint ? '　<em style="font-style:normal;color:var(--text-3)">' + esc(f.hint) + '</em>' : '') +
                 '</span>' +
                 '<textarea class="area" style="min-height:74px" data-idx="' + i + '" data-key="' + key +
                 '" data-f="' + f.k + '" data-pairs="1">' + esc(lines) + '</textarea></label>';
        }

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
      body += group("站点信息", "名字、身份、页面摘要、页脚", scalarFields([
        { path: ["site", "name"], label: "名字", value: s.name },
        { path: ["site", "initials"], label: "头像字母（1-2 个）", value: s.initials },
        { path: ["site", "role"], label: "身份一行字", value: s.role },
        { path: ["site", "description"], label: "页面摘要（搜索结果 / 分享卡片里显示）", value: s.description, type: "area", full: true },
        { path: ["site", "location"], label: "坐标", value: s.location },
        { path: ["site", "email"], label: "邮箱", value: s.email, mono: true },
        { path: ["site", "copyright"], label: "版权行", value: s.copyright },
        { path: ["site", "footerNote"], label: "页脚小字", value: s.footerNote }
      ]));

      body += group("头像", "显示在页头、页脚和 Q1 首屏",
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

      body += group("模块开关", "关掉某一屏，导航栏会自动去掉它（Q1 首屏不受影响）",
        ["listen", "gaming", "repair", "links", "contact"].map(function (k) {
          var sec = getPath(draft, ["sections", k]) || {};
          return '<div class="row" style="align-items:center">' +
            '<label class="switch"><input type="checkbox" data-path="sections.' + k + '.enabled"' +
            (sec.enabled !== false ? " checked" : "") + '><span class="switch__track"></span>' +
            '<span>' + esc(sec.label || k) + ' 屏</span></label>' +
            '<input class="input" style="flex:0 0 90px" type="text" data-path="sections.' + k + '.order" value="' +
            esc(sec.order == null ? "" : sec.order) + '" aria-label="排序">' +
            '</div>';
        }).join(""));
    }

    /* ------------------------------------------------------------ Q1 · 我 */
    if (activeTab === "profile") {
      body += group("首屏文案", "访客打开页面第一眼看到的东西", scalarFields([
        { path: ["profile", "greet"], label: "名字上方的小字", value: getPath(draft, ["profile", "greet"]) },
        { path: ["profile", "tagline"], label: "名字下方的副标题", value: getPath(draft, ["profile", "tagline"]), full: true },
        { path: ["profile", "intro"], label: "简介（2~3 句就够，太长会把联系方式挤下去）",
          value: getPath(draft, ["profile", "intro"]), type: "area", full: true }
      ]));

      body += group("首屏按钮", "指向下面任意一屏", scalarFields([
        { path: ["hero", "primary", "label"], label: "主按钮文字", value: getPath(draft, ["hero", "primary", "label"]) },
        { path: ["hero", "primary", "target"], label: "主按钮跳转（#listen）", value: getPath(draft, ["hero", "primary", "target"]), mono: true },
        { path: ["hero", "secondary", "label"], label: "副按钮文字", value: getPath(draft, ["hero", "secondary", "label"]) },
        { path: ["hero", "secondary", "target"], label: "副按钮跳转（#gaming）", value: getPath(draft, ["hero", "secondary", "target"]), mono: true }
      ]));

      body += renderList("contacts");
      body += renderList("previews");
    }

    /* ---------------------------------------------------------- Q2 · 在听 */
    if (activeTab === "listen") {
      body += group("标题文案", "", scalarFields([
        { path: ["listen", "eyebrow"], label: "小标签（02 / LISTENING）", value: getPath(draft, ["listen", "eyebrow"]) },
        { path: ["listen", "title"], label: "标题", value: getPath(draft, ["listen", "title"]) },
        { path: ["listen", "lead"], label: "副标题", value: getPath(draft, ["listen", "lead"]), full: true }
      ]));

      body += group("网易云账号", "",
        '<p class="sheet__hint">' +
          'UID 这样找：打开 music.163.com → 点自己头像进主页 → 地址栏 <code>id=</code> 后面那串数字。<br>' +
          '填了 UID 之后，「最近在听」会由仓库的定时任务自动同步（每天一次）。' +
          '同步需要在仓库里配一个 <code>NETEASE_COOKIE</code> Secret，具体见 README。' +
          '<strong>没配也不影响页面</strong> —— 会一直显示下面的兜底曲目。' +
        '</p>' +
        scalarFields([
          { path: ["listen", "neteaseUid"], label: "网易云数字 UID", value: getPath(draft, ["listen", "neteaseUid"]), mono: true },
          { path: ["listen", "limit"], label: "最多显示几首", value: getPath(draft, ["listen", "limit"]) }
        ]));

      body += renderList("tracks");
    }

    /* ---------------------------------------------------------- Q3 · 游戏 */
    if (activeTab === "gaming") {
      body += group("标题文案", "", scalarFields([
        { path: ["gaming", "eyebrow"], label: "小标签", value: getPath(draft, ["gaming", "eyebrow"]) },
        { path: ["gaming", "title"], label: "标题", value: getPath(draft, ["gaming", "title"]) },
        { path: ["gaming", "lead"], label: "副标题", value: getPath(draft, ["gaming", "lead"]), full: true }
      ]));

      body += group("小提示", "",
        '<p class="sheet__hint">' +
          '这一屏只放「图标 + 名称 + ID」，不写介绍 —— 它的用途是让对方抄 ID 加好友。<br>' +
          '想用自己的游戏图标：把图片放进 <code>assets/img/</code>，' +
          '在「自定义图标图片地址」里填 <code>assets/img/arknights.png</code> 即可。' +
        '</p>');
      body += renderList("gaming");
    }

    /* ---------------------------------------------------------- Q4 · 维修 */
    if (activeTab === "repair") {
      body += group("标题文案", "", scalarFields([
        { path: ["repair", "eyebrow"], label: "小标签", value: getPath(draft, ["repair", "eyebrow"]) },
        { path: ["repair", "title"], label: "标题", value: getPath(draft, ["repair", "title"]) },
        { path: ["repair", "lead"], label: "副标题", value: getPath(draft, ["repair", "lead"]), full: true }
      ]));

      body += group("闲鱼主页卡", "和 Q1 那两个摘要卡是同一个组件",
        scalarFields([
          { path: ["repair", "xianyu", "platform"], label: "平台名", value: getPath(draft, ["repair", "xianyu", "platform"]) },
          { path: ["repair", "xianyu", "icon"], label: "图标名", value: getPath(draft, ["repair", "xianyu", "icon"]) },
          { path: ["repair", "xianyu", "title"], label: "标题", value: getPath(draft, ["repair", "xianyu", "title"]) },
          { path: ["repair", "xianyu", "meta"], label: "副标题", value: getPath(draft, ["repair", "xianyu", "meta"]), full: true },
          { path: ["repair", "xianyu", "url"], label: "闲鱼主页链接", value: getPath(draft, ["repair", "xianyu", "url"]), full: true, mono: true },
          { path: ["repair", "xianyu", "cover"], label: "封面图地址（留空则为纯文字卡）",
            value: getPath(draft, ["repair", "xianyu", "cover"]), full: true, mono: true },
          { path: ["repair", "xianyu", "accent"], label: "平台主色", value: getPath(draft, ["repair", "xianyu", "accent"]) }
        ]));

      body += group("报价表抬头", "", scalarFields([
        { path: ["repair", "quote", "title"], label: "标题", value: getPath(draft, ["repair", "quote", "title"]) },
        { path: ["repair", "quote", "note"], label: "底部说明", value: getPath(draft, ["repair", "quote", "note"]), type: "area", full: true }
      ]));

      body += renderList("quoteRows");

      body += group("价格计算器", "",
        '<p class="sheet__hint">' +
          '计算器是「设备 → 项目 → 材料 → 加项」四步向导，价格公式：<br>' +
          '<code>项目价 × 设备系数 × 材料系数 + 加项固定价</code>，再按 ±15% 展开成区间。<br>' +
          '这四组选项的系数需要细调，请在 <code>config.js</code> 的 ' +
          '<code>repair.calculator</code> 里改（编辑器不提供，避免误操作把公式弄乱）。' +
        '</p>' +
        scalarFields([
          { path: ["repair", "calculator", "title"], label: "计算器标题", value: getPath(draft, ["repair", "calculator", "title"]) },
          { path: ["repair", "calculator", "hint"], label: "计算器副标题", value: getPath(draft, ["repair", "calculator", "hint"]), full: true }
        ]));
    }

    /* ---------------------------------------------------------- Q5 · 其他 */
    if (activeTab === "links") {
      body += group("标题文案", "", scalarFields([
        { path: ["links", "eyebrow"], label: "小标签", value: getPath(draft, ["links", "eyebrow"]) },
        { path: ["links", "title"], label: "标题", value: getPath(draft, ["links", "title"]) },
        { path: ["links", "lead"], label: "副标题", value: getPath(draft, ["links", "lead"]), full: true }
      ]));
      body += group("小提示", "",
        '<p class="sheet__hint" style="margin:0">' +
          'Q1 已经放了 QQ / 微信 / 网易云 / 小黑盒，这里只放剩下的，别重复。' +
        '</p>');
      body += renderList("links");
    }

    /* ---------------------------------------------------------- Q6 · 邮箱 */
    if (activeTab === "contact") {
      body += group("标题文案", "", scalarFields([
        { path: ["contact", "eyebrow"], label: "小标签", value: getPath(draft, ["contact", "eyebrow"]) },
        { path: ["contact", "title"], label: "标题", value: getPath(draft, ["contact", "title"]) },
        { path: ["contact", "lead"], label: "副标题", value: getPath(draft, ["contact", "lead"]), full: true },
        { path: ["contact", "hint"], label: "邮箱上方那句话", value: getPath(draft, ["contact", "hint"]), full: true }
      ]));
      body += group("邮箱地址", "",
        '<p class="sheet__hint">邮箱本身在「基础」页的站点信息里改，整站共用同一个。</p>' +
        scalarFields([
          { path: ["site", "email"], label: "邮箱", value: (draft.site || {}).email, mono: true, full: true }
        ]));
    }

    if (activeTab === "backdrop") {
      var bd = draft.backdrop || {};
      var bm = bd.motion || {};

      body += group("动效元素", "可以任意叠加，互不冲突", scalarFields([
        { path: ["backdrop", "motion", "aurora"], label: "光晕（两团缓慢漂移，跟着主题色走）", value: bm.aurora, type: "bool" },
        { path: ["backdrop", "motion", "grain"], label: "噪点（让大面积纯色不呆板）", value: bm.grain, type: "bool" },
        { path: ["backdrop", "motion", "grid"], label: "网格线（偏工程感）", value: bm.grid, type: "bool" },
        { path: ["backdrop", "motion", "stars"], label: "微粒（缓慢上浮，偏夜色感）", value: bm.stars, type: "bool" }
      ]) +
      '<div class="row">' +
        '<label class="field" style="flex:1 1 140px"><span class="field__label">网格间距 px</span>' +
          '<input class="input" type="number" min="24" max="200" step="4" data-path="backdrop.gridSize" value="' +
          esc(bd.gridSize == null ? 64 : bd.gridSize) + '"></label>' +
        '<label class="field" style="flex:1 1 140px"><span class="field__label">微粒浓度</span>' +
          '<input class="input" type="number" min="0.05" max="1" step="0.05" data-path="backdrop.starsOpacity" value="' +
          esc(bd.starsOpacity == null ? 0.5 : bd.starsOpacity) + '"></label>' +
      '</div>' +
      '<p class="sheet__hint">这两个数值只在对应动效开启时才起作用。' +
      '系统开启「减少动态效果」时，光晕与微粒会自动静止。</p>');

      /* 内置背景：都是本地小 SVG（单个不到 1KB），不依赖任何外部图床 */
      var PRESETS = [
        { id: "", label: "不用图", url: "" },
        { id: "mesh", label: "柔光", url: "assets/backdrop/mesh.svg" },
        { id: "dunes", label: "沙丘", url: "assets/backdrop/dunes.svg" },
        { id: "horizon", label: "地平线", url: "assets/backdrop/horizon.svg" },
        { id: "lines", label: "线格", url: "assets/backdrop/lines.svg" }
      ];
      var cur = (bd.image || "").trim();

      var presetHtml = PRESETS.map(function (pr) {
        var on = pr.url === cur;
        return '<button class="bd-pick' + (on ? ' is-active' : '') + '" type="button" ' +
          'data-bd-url="' + esc(pr.url) + '" title="' + esc(pr.label) + '">' +
          '<span class="bd-pick__thumb" style="' +
            (pr.url ? 'background-image:url(\'' + esc(pr.url) + '\')' : '') + '">' +
            (pr.url ? '' : '<span class="bd-pick__none">无</span>') +
          '</span>' +
          '<span class="bd-pick__label">' + esc(pr.label) + '</span>' +
        '</button>';
      }).join("");

      body += group("背景图片", "选一张内置的，或上传自己的", 
        '<div class="bd-grid">' + presetHtml + '</div>' +
        '<div class="row">' +
          '<button class="btn btn--quiet btn--sm" type="button" data-bd-upload>上传图片</button>' +
          '<button class="btn btn--quiet btn--sm" type="button" data-bd-clear>清除</button>' +
          '<input type="file" accept="image/*" data-bd-file hidden>' +
        '</div>' +
        scalarFields([
          { path: ["backdrop", "image"], label: "图片地址（也可直接填外部链接）", value: bd.image || "", full: true, mono: true }
        ]));

      /* 实时预览：遮罩强度这种参数，不看图根本判断不了 */
      body += group("图片参数", "改完下面几项，上面的预览会立刻跟着变",
        '<div class="bd-preview" id="bdPreview">' +
          '<div class="bd-preview__img" data-bd-img></div>' +
          '<div class="bd-preview__scrim" data-bd-scrim></div>' +
          '<div class="bd-preview__text">' +
            '<b>把复杂的东西，</b>' +
            '<span>做得简单一点。</span>' +
            '<em>15:32 · 周六 · 今年已过 86%</em>' +
          '</div>' +
        '</div>' +
        scalarFields([
          { path: ["backdrop", "imageOpacity"], label: "图片不透明度", value: bd.imageOpacity == null ? 0.35 : bd.imageOpacity,
            type: "range", min: 0.05, max: 1, step: 0.05, hint: "越大图片越明显" },
          { path: ["backdrop", "imageBlur"], label: "模糊", value: bd.imageBlur == null ? 0 : bd.imageBlur,
            type: "range", min: 0, max: 40, step: 1, hint: "想弱化图片细节就调大" },
          { path: ["backdrop", "scrim"], label: "遮罩强度", value: bd.scrim == null ? 0.65 : bd.scrim,
            type: "range", min: 0.15, max: 0.95, step: 0.05, hint: "★ 这个直接决定文字能不能读清，不建议低于 0.5" },
          { path: ["backdrop", "kenBurns"], label: "图片缓慢推近拉远（Ken Burns）", value: bd.kenBurns, type: "bool" },
          { path: ["backdrop", "parallax"], label: "背景随鼠标 / 滚动轻微位移", value: bd.parallax, type: "bool" }
        ]));
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

      body += group("翻页与光效", "这两个开关决定页面是「翻页式」还是「长滚动」，以及指针光效", 
        scalarFields([
          { path: ["ui", "paged"], label: "翻页式（一屏一章，上下吸附）", value: ui.paged, type: "bool" },
          { path: ["ui", "showPager"], label: "页码指示器", value: ui.showPager, type: "bool" },
          { path: ["ui", "showHint"], label: "首次进入时提示「上下滑动翻页」", value: ui.showHint, type: "bool" },
          { path: ["ui", "lightEffects"], label: "指针追光 / 卡片光斑 / 触控涟漪", value: ui.lightEffects, type: "bool" }
        ]) +
        '<p class="sheet__hint">关掉「翻页式」会回到普通长页面（原来的滚动手感）。' +
        '光效在触屏设备上只保留点按涟漪；系统开启「减少动态效果」时会全部自动关闭。</p>');

      body += group("首页细节", "载入动画 / 时钟 / 时光进度条 / 一言", 
        scalarFields([
          { path: ["live", "loading"], label: "载入动画（每次会话一次，最多 0.9 秒）", value: (draft.live || {}).loading, type: "bool" },
          { path: ["live", "clock"], label: "实时时钟 + 日期", value: (draft.live || {}).clock, type: "bool" },
          { path: ["live", "progress"], label: "时光进度条（今年已过 %）", value: (draft.live || {}).progress, type: "bool" },
          { path: ["live", "quote"], label: "一言", value: (draft.live || {}).quote, type: "bool" },
          { path: ["live", "quoteRemote"], label: "一言改为联网获取（内容随机，不推荐）", value: (draft.live || {}).quoteRemote, type: "bool" }
        ]) +
        '<p class="sheet__hint">一言列表在 config.js 的 <code>quotes</code> 里，' +
        '写纯文字或 <code>{ text, from }</code> 都行，点首页那句话可以换一句。</p>');

      body += group("音乐浮窗", "默认关闭，避免在正式场合意外出声", 
        scalarFields([
          { path: ["music", "enabled"], label: "显示音乐浮窗", value: (draft.music || {}).enabled, type: "bool" },
          { path: ["music", "title"], label: "曲名 / 歌单名", value: (draft.music || {}).title },
          { path: ["music", "artist"], label: "副标题", value: (draft.music || {}).artist },
          { path: ["music", "src"], label: "音频直链（留空则只做跳转）", value: (draft.music || {}).src, full: true, mono: true },
          { path: ["music", "link"], label: "点击后跳转的地址", value: (draft.music || {}).link, full: true, mono: true }
        ]) +
        '<p class="sheet__hint">填了音频直链会出现播放按钮（绝不自动播放）；' +
        '只填链接则变成一个「去听歌」的入口。</p>');

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
    if (activeTab === "backdrop") syncBackdropPreview();
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

  /* 背景图压缩：比头像宽松得多（1920 宽、质量 0.82），
     因为背景要铺满屏幕，太小会糊。仍然限宽限质，避免 config.js 变成几 MB。 */
  function compressBackdrop(file, done) {
    if (!file || !/^image\//.test(file.type)) { toast("请选择图片文件"); return; }
    var reader = new FileReader();
    reader.onerror = function () { toast("文件读取失败"); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { toast("图片无法解析，换一张试试"); };
      img.onload = function () {
        var MAX_W = 1920;
        var scale = Math.min(1, MAX_W / img.width);
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);

        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var g = canvas.getContext("2d");
        if (g.imageSmoothingQuality) g.imageSmoothingQuality = "high";
        g.drawImage(img, 0, 0, w, h);

        var out = canvas.toDataURL("image/webp", 0.82);
        if (out.indexOf("data:image/webp") !== 0) out = canvas.toDataURL("image/jpeg", 0.85);
        done(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  window.ADMIN_COMPRESS_BD = compressBackdrop;

  /* 估算 data URL 的实际体积（KB） */
  function dataUrlKb(dataUrl) {
    var b64 = String(dataUrl).split(",")[1] || "";
    return Math.round(b64.length * 0.75 / 1024);
  }

  window.ADMIN_COMPRESS = compressImage;
  window.ADMIN_KB = dataUrlKb;

  /* 背景预览：把图片、模糊、不透明度、遮罩按真实参数合成出来，
     让人一眼看出「遮罩调低文字就糊了」。 */
  function syncBackdropPreview() {
    var box = $("#bdPreview");
    if (!box) return;
    var bd = draft.backdrop || {};

    var img = box.querySelector("[data-bd-img]");
    var scrim = box.querySelector("[data-bd-scrim]");
    var url = (bd.image || "").trim();

    if (img) {
      img.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '\\"') + '")' : "none";
      img.style.opacity = String(bd.imageOpacity == null ? 0.35 : bd.imageOpacity);
      img.style.filter = (Number(bd.imageBlur) || 0) > 0
        ? "blur(" + (Number(bd.imageBlur) || 0) + "px)" : "none";
    }
    if (scrim) scrim.style.opacity = String(bd.scrim == null ? 0.65 : bd.scrim);

    // 预设按钮高亮跟随当前地址
    Array.prototype.forEach.call(document.querySelectorAll("[data-bd-url]"), function (btn) {
      btn.classList.toggle("is-active", (btn.getAttribute("data-bd-url") || "") === url);
    });

    // 同步「图片地址」输入框（从预设点进来时）
    var field = document.querySelector('[data-path="backdrop.image"]');
    if (field && field.value.trim() !== url) field.value = url;
  }

  function bindEditor() {
    $("#tabs").addEventListener("click", function (e) {
      var t = e.target.closest("[data-tab]");
      if (!t) return;
      activeTab = t.getAttribute("data-tab");
      renderTabs();
      renderPanel();
      if (activeTab === "backdrop") syncBackdropPreview();
    });

    var panel = $("#panel");

    panel.addEventListener("input", function (e) {
      var el = e.target;

      // 列表里的字段
      if (el.dataset.key && el.dataset.f != null) {
        var key = el.dataset.key, i = +el.dataset.idx, f = el.dataset.f;
        var arr = getPath(draft, LISTS[key].path);
        var def = LISTS[key].fields.filter(function (x) { return x.k === f; })[0];

        if (def && def.type === "pairs") {
          // 「名称: 内容」→ [{label, value}]；半角/全角冒号都认，空行忽略
          arr[i][f] = el.value.split("\n").map(function (line) {
            var t = line.trim();
            if (!t) return null;
            var cut = t.search(/[:：]/);
            if (cut < 0) return { label: t, value: "" };
            return {
              label: t.slice(0, cut).trim(),
              value: t.slice(cut + 1).trim()
            };
          }).filter(function (x) { return x && x.label; });
          mark();
          return;
        }

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

        /* 背景图片地址：同步预览块与预设高亮 */
        if (el.dataset.path === "backdrop.image") {
          draft.backdrop.image = el.value.trim();
          mark();
          syncBackdropPreview();
          return;
        }

        /* 背景数值（不透明度 / 模糊 / 遮罩） */
        if (el.dataset.range || el.type === "number") {
          var rp = el.dataset.path.split(".");
          var rv = Number(el.value);
          if (!isNaN(rv)) {
            setPath(draft, rp, rv);
            var out = document.querySelector('[data-out-for="' + el.dataset.path + '"]');
            if (out) out.textContent = String(Math.round(rv * 100) / 100);
            syncBackdropPreview();
          }
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
      if (!el.hasAttribute) return;

      /* ---- 背景图上传：尺寸比头像大得多，单独走一套压缩 ---- */
      if (el.hasAttribute("data-bd-file")) {
        var bfile = el.files && el.files[0];
        if (bfile) {
          compressBackdrop(bfile, function (dataUrl) {
            draft.backdrop.image = dataUrl;
            mark();
            syncBackdropPreview();
            var kb = dataUrlKb(dataUrl);
            toast("背景已就绪（约 " + kb + " KB）" +
                  (kb > 400 ? "，偏大，建议换尺寸小一点的图" : ""));
          });
        }
        el.value = "";
        return;
      }

      if (!el.hasAttribute("data-avatar-file")) return;
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

      /* ---- 背景：选内置图 / 上传 / 清除 ---- */
      if (b.hasAttribute("data-bd-url")) {
        draft.backdrop.image = b.getAttribute("data-bd-url") || "";
        mark();
        syncBackdropPreview();
        toast(draft.backdrop.image ? "已选择背景图" : "已改为不用背景图");
        return;
      }
      if (b.hasAttribute("data-bd-upload")) {
        var bf = $("[data-bd-file]");
        if (bf) bf.click();
        return;
      }
      if (b.hasAttribute("data-bd-clear")) {
        draft.backdrop.image = "";
        mark();
        syncBackdropPreview();
        toast("已清除背景图");
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

  function ghHeaders(token) {
    return {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    };
  }

  /* 把状态码翻译成「发生了什么 + 怎么修」。
     关键背景：GitHub 对「无权限」和「不存在」都返回 404（避免泄露仓库是否存在），
     所以 404 绝不能只当成「文件不存在」——绝大多数情况其实是令牌没授权到。 */
  function explain(status, action) {
    var where = "https://github.com/settings/tokens";
    var map = {
      401: "令牌无效或已过期。请到 " + where + " 重新生成一个，注意复制完整、别带空格。",
      403: "被拒绝（403）。若是 Fine-grained token，可能是没勾 Contents 写权限；" +
           "也可能是触发了频率限制，等几分钟再试。",
      404: "GitHub 说「找不到」（404）。这一步通常是①令牌没被授权到这个仓库，" +
           "或②令牌所属账号对 " + A.repo + " 没有写权限。" +
           "前者请到 Fine-grained token 设置里把 Repository access 选成 Only select repositories → " +
           A.repo + "，并在 Permissions → Contents 选 Read and write。",
      409: "内容冲突（409）：远端文件在你编辑期间被改过。关掉抽屉、刷新页面再改一次即可。",
      422: "请求内容被拒（422）。常见原因是文件太大或 base64 编码异常，可以改用「不用令牌」那条路。",
      429: "请求太频繁（429），等几分钟再试。"
    };
    return (map[status] || (action + "失败（HTTP " + status + "）。")) +
           (map[status] ? "［" + action + "阶段］" : "");
  }

  /* ---------------------------------------------------------- 连接诊断 */
  function diagRow(ok, label, detail) {
    var icon = ok === true ? "✓" : ok === false ? "✕" : "•";
    var cls = ok === true ? "is-ok" : ok === false ? "is-bad" : "is-info";
    return '<li class="diag__row ' + cls + '">' +
      '<span class="diag__icon">' + icon + '</span>' +
      '<span class="diag__text"><strong>' + esc(label) + '</strong>' +
      (detail ? '<small>' + detail + '</small>' : '') + '</span></li>';
  }

  async function diagnose() {
    var input = $("#tokenInput");
    var list = $("#diagList");
    var msg = $("#pushMsg");
    var token = (input.value || localStorage.getItem(TOKEN_KEY) || "").trim();

    list.hidden = false;
    list.innerHTML = "";
    msg.textContent = "";

    // 所有结论先累积在 rows 里，最后一次渲染，避免后一步覆盖前一步的反馈
    var rows = [];
    var pass = true;

    if (!token) {
      list.innerHTML = diagRow(false, "没有填令牌",
        "先在上面粘贴一个 GitHub Token。建议用 Fine-grained token，只授权这一个仓库。");
      return false;
    }

    // 令牌格式自查：先挡掉一眼就能看出的问题，省一次网络往返
    if (!/^(gh[psour]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(token)) {
      list.innerHTML = diagRow(false, "令牌格式不对",
        "应以 <code>ghp_</code>、<code>github_pat_</code> 等开头，且没有多余空格或换行。" +
        "你现在填的以 <code>" + esc(token.slice(0, 6)) + "…</code> 开头，共 " +
        token.length + " 个字符。");
      return false;
    }
    rows.push(diagRow(true, "令牌格式正常", "共 " + token.length + " 个字符"));
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}

    var headers = ghHeaders(token);

    /* 1. 令牌是否有效 —— 顺便拿到它属于哪个账号 */
    var login = null, scopes = null;
    try {
      var r1 = await fetch("https://api.github.com/user", { headers: headers });
      scopes = r1.headers.get("X-OAuth-Scopes");
      if (r1.ok) {
        login = (await r1.json()).login;
        rows.push(diagRow(true, "令牌有效", "属于账号 <b>" + esc(login) + "</b>"));
      } else {
        rows.push(diagRow(false, "令牌无效", explain(r1.status, "验证令牌")));
        pass = false;
      }
    } catch (e) {
      rows.push(diagRow(false, "连不上 GitHub",
        "网络或浏览器拦截了请求。" + (location.protocol === "file:" ?
        "你似乎是用 file:// 直接打开的，请改用本地服务器或线上地址。" : "")));
      pass = false;
    }

    /* 2. 经典令牌（ghp_）的 scope 检查；Fine-grained 没有这个头，跳过 */
    if (login && token.indexOf("ghp_") === 0) {
      if (scopes && scopes.indexOf("repo") >= 0) {
        rows.push(diagRow(true, "权限范围够用", "scope: " + esc(scopes)));
      } else {
        rows.push(diagRow(false, "经典令牌缺少 repo 权限",
          "创建 <code>ghp_</code> 令牌时必须勾选 <b>repo</b>（完整控制私有/公开仓库），" +
          "否则连自己的公开仓库也写不进去。当前 scope: <code>" + esc(scopes || "空") + "</code>"));
        pass = false;
      }
    }

    /* 3. 能否访问这个仓库 + 有没有写权限 */
    try {
      var r2 = await fetch("https://api.github.com/repos/" + A.repo, { headers: headers });
      if (r2.ok) {
        var repoData = await r2.json();
        var perm = repoData.permissions || {};
        if (perm.push === true || (perm.admin === true) || (perm.maintain === true)) {
          rows.push(diagRow(true, "能访问仓库且有写权限", esc(A.repo) +
            " · " + (repoData.private ? "私有" : "公开")));
        } else if (perm.push === false || perm.admin === false) {
          rows.push(diagRow(false, "只读权限",
            "这个令牌能读 " + esc(A.repo) + " 但不能写。请到 Fine-grained token 的 " +
            "Permissions → Contents 改为 <b>Read and write</b>。"));
          pass = false;
        } else {
          rows.push(diagRow(null, "仓库可访问", "权限信息未返回，继续尝试提交"));
        }
      } else {
        rows.push(diagRow(false, "访问不到这个仓库", explain(r2.status, "读取仓库")));
        pass = false;
      }
    } catch (e) {
      rows.push(diagRow(false, "读取仓库时网络中断", esc(e.message)));
      pass = false;
    }

    /* 4. 目标文件是否可读（这一步能提前发现路径/分支问题） */
    if (pass) {
      try {
        var r3 = await fetch(
          "https://api.github.com/repos/" + A.repo + "/contents/" + A.configPath +
          "?ref=" + A.branch + "&t=" + Date.now(), { headers: headers });
        if (r3.ok) {
          var f = await r3.json();
          rows.push(diagRow(true, "能读到配置文件", A.configPath + " · " +
            Math.round((f.size || 0) / 1024) + " KB · 分支 " + esc(A.branch)));
        } else {
          rows.push(diagRow(false, "读不到配置文件", explain(r3.status, "读取 " + A.configPath) +
            "（也请确认分支名是 <code>" + esc(A.branch) + "</code>）"));
          pass = false;
        }
      } catch (e) {
        rows.push(diagRow(false, "读取文件时网络中断", esc(e.message)));
        pass = false;
      }
    }

    /* 5. 账号归属提醒：不是仓库主人时，后面很可能因权限不足失败 */
    if (login && A.repo.indexOf("/") > 0) {
      var owner = A.repo.split("/")[0];
      if (login.toLowerCase() !== owner.toLowerCase()) {
        rows.push(diagRow(null, "账号与仓库主人不同",
          "令牌属于 <b>" + esc(login) + "</b>，而仓库属于 <b>" + esc(owner) + "</b>。" +
          "只要你对这个仓库有写权限就没问题，否则会失败。"));
      }
    }

    rows.push(diagRow(pass, pass ? "可以提交了" : "先解决上面标 ✕ 的项",
      pass ? "点下面的「提交到 GitHub」即可。" : "改完再点一次「先检查连接」。"));

    list.innerHTML = rows.join("");
    var btn = $("#pushBtn");
    if (btn) btn.disabled = !pass;
    return pass;
  }

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

    var btn = $("#pushBtn");
    btn.disabled = true;
    msg.textContent = "正在提交…";

    var api = "https://api.github.com/repos/" + A.repo + "/contents/" + A.configPath;
    var headers = ghHeaders(token);

    try {
      // 先取当前 sha（更新已有文件必须带）
      var cur = await fetch(api + "?ref=" + A.branch + "&t=" + Date.now(), { headers: headers });
      var sha = null;
      if (cur.ok) {
        sha = (await cur.json()).sha;
      } else {
        throw new Error(explain(cur.status, "读取现有文件"));
      }

      var res = await fetch(api, {
        method: "PUT",
        headers: headers,
        body: JSON.stringify({
          message: "content: update from admin",
          content: b64utf8(serialize(draft)),
          branch: A.branch,
          sha: sha
        })
      });

      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        var hint = explain(res.status, "提交");
        throw new Error(hint + (err.message ? "（GitHub 原话：" + err.message + "）" : ""));
      }

      var data = await res.json();
      var commit = (data.commit && data.commit.sha) ? data.commit.sha.slice(0, 7) : "";
      msg.innerHTML = "已提交" + (commit ? "（" + commit + "）" : "") +
        "。GitHub Pages 通常 1–2 分钟后自动上线，稍后刷新主页即可。";
      mark(false);
      toast("已提交到 GitHub");
    } catch (err) {
      msg.textContent = err.message || "提交失败，请重试。";
      toast("提交失败");
    } finally {
      btn.disabled = false;
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

    /* ---- 两条路线的切换 ---- */
    var pubTabs = $("#pubTabs");
    if (pubTabs) {
      pubTabs.addEventListener("click", function (e) {
        var t = e.target.closest("[data-pub]");
        if (!t) return;
        var which = t.getAttribute("data-pub");
        Array.prototype.forEach.call(pubTabs.querySelectorAll("[data-pub]"), function (b) {
          b.classList.toggle("is-active", b === t);
        });
        $("#paneManual").hidden = which !== "manual";
        $("#paneToken").hidden = which !== "token";
      });
    }

    $("#copyCfg").addEventListener("click", function () {
      copy(serialize(draft)).then(function () {
        toast("已复制，去 GitHub 编辑页粘贴即可");
        var btn = $("#copyCfg");
        var old = btn.textContent;
        btn.textContent = "✓ 已复制";
        setTimeout(function () { btn.textContent = old; }, 2000);
      }).catch(function () { toast("复制失败，请改用下载"); });
    });

    $("#editOnGithub").href = "https://github.com/" + A.repo + "/edit/" + A.branch + "/" + A.configPath;

    $("#downloadCfg").addEventListener("click", function () {
      download("config.js", serialize(draft));
      toast("已下载 config.js");
    });

    var checkBtn = $("#checkBtn");
    if (checkBtn) checkBtn.addEventListener("click", function () {
      checkBtn.disabled = true;
      diagnose().then(function () { checkBtn.disabled = false; })
                .catch(function (e) { checkBtn.disabled = false; toast("检查出错：" + e.message); });
    });

    $("#pushBtn").addEventListener("click", pushToGithub);

    $("#forgetToken").addEventListener("click", function () {
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      $("#tokenInput").value = "";
      $("#pushMsg").textContent = "已清除本机保存的令牌。";
      $("#diagList").hidden = true;
      $("#pushBtn").disabled = true;
    });

    // 改令牌内容后，之前的诊断结论就不成立了，禁掉提交等重新检查
    var ti = $("#tokenInput");
    if (ti) ti.addEventListener("input", function () {
      $("#pushBtn").disabled = true;
      $("#diagList").hidden = true;
      $("#pushMsg").textContent = "";
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
    draft = pruneDraft(restored ? mergeDefaults(window.SITE_CONFIG, restored)
                                : JSON.parse(JSON.stringify(window.SITE_CONFIG)));
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
      draft = pruneDraft(JSON.parse(JSON.stringify(window.SITE_CONFIG)));
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

    /* 本地调试入口：只在 localhost / 127.0.0.1 下挂载，线上域名不会暴露。
       用途是让自检脚本（tools/verify-admin-ui.js）能跳过口令直接验证
       表单是否渲染正确 —— 否则每次改字段都得手输一次密码。 */
    try {
      if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
        window.ADMIN_ENTER = enter;
        window.ADMIN_RENDER = function () { renderTabs(); renderPanel(); };
      }
    } catch (e) { /* ignore */ }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
