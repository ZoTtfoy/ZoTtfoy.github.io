/* ==========================================================================
 *  主题自检：node tools/verify-theme.js
 * --------------------------------------------------------------------------
 *  这套检查的意义：主题不是"看着差不多"，而是逐项可验证。
 *  1. 结构：每套主题的变量键必须完全一致，漏一个就串色
 *  2. 格式：颜色 / 数值 / 复合值 各有各的合法形式
 *  3. 可读性：用 WCAG 公式算真实对比度，正文、辅助文字、按钮文字都要达标
 *  4. 一致性：CSS 兜底值必须与默认主题相同，否则无 JS 时会跳色
 * ========================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const notes = [];
function check(cond, msg) { if (!cond) failures.push(msg); else notes.push('OK  ' + msg); }
function fail(msg) { failures.push(msg); }

/* ---------------------------------------------------------------- 加载主题 */
const ctx = { window: null, console };
ctx.window = ctx;
vm.createContext(ctx);
try {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/themes.js'), 'utf8'), ctx, { filename: 'themes.js' });
} catch (e) {
  console.log('themes.js 无法执行: ' + e.message);
  process.exit(1);
}
const T = ctx.SITE_THEMES;
check(!!T && Array.isArray(T.list), 'themes.js 已加载并暴露 SITE_THEMES.list');
check(T.list.length >= 5, `主题数量 ≥ 5（当前 ${T.list.length} 套）`);
check(T.list.some(t => t.id === T.defaultSkin), 'defaultSkin 指向存在的主题');

/* ------------------------------------------------------------ 变量键的约定 */
const BASE_KEYS = ['font-sans', 'font-display', 'font-mono', 'r-sm', 'r-md', 'r-lg', 'tracking-title', 'border-w'];
const COLOR_KEYS = ['bg', 'bg-elev', 'bg-soft', 'text', 'text-2', 'text-3', 'accent', 'accent-fg', 'toast-bg', 'toast-fg'];
const RGBA_KEYS = ['line', 'line-strong', 'accent-soft', 'glow-a', 'glow-b', 'header-bg'];
const SHADOW_KEYS = ['shadow-sm', 'shadow-md'];
const NUM_KEYS = ['grain-opacity'];
const ALL_COLOR_KEYS = [...COLOR_KEYS, ...RGBA_KEYS, ...SHADOW_KEYS, ...NUM_KEYS];

/* ---------------------------------------------------------------- 颜色工具 */
function parseColor(c) {
  c = String(c).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [1, 3, 5].map(i => parseInt(m[1][i] + m[1][i], 16));
  m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16));
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}
function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const L1 = luminance(parseColor(a)), L2 = luminance(parseColor(b));
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
const isHex = v => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v).trim());
const isRgba = v => /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(String(v).trim());

/* ------------------------------------------------------------ 逐套主题检查 */
const seenIds = new Set();
const lightKeySets = [];
const darkKeySets = [];

T.list.forEach((t, i) => {
  const tag = t.id || ('#' + i);

  /* --- 元信息 --- */
  check(typeof t.id === 'string' && /^[a-z][a-z0-9-]*$/.test(t.id), `${tag}: id 格式合法`);
  check(!seenIds.has(t.id), `${tag}: id 唯一`);
  seenIds.add(t.id);
  check(typeof t.name === 'string' && t.name.length > 0, `${tag}: 有中文名`);
  check(typeof t.desc === 'string' && t.desc.length >= 6, `${tag}: 有描述文案`);
  check(Array.isArray(t.swatch) && t.swatch.length === 3, `${tag}: 色板为 3 色`);
  (t.swatch || []).forEach((c, k) => {
    check(isHex(c) || isRgba(c), `${tag}: 色板第 ${k + 1} 色格式合法（${c}）`);
  });

  /* --- base 形态层 --- */
  check(!!t.base && typeof t.base === 'object', `${tag}: 有 base 层`);
  const baseKeys = Object.keys(t.base || {}).sort();
  BASE_KEYS.forEach(k => check(baseKeys.includes(k), `${tag}: base 含 ${k}`));
  BASE_KEYS.forEach(k => {
    const v = (t.base || {})[k];
    if (v === undefined) return;
    if (['r-sm', 'r-md', 'r-lg', 'border-w'].includes(k)) {
      check(/^\d+(\.\d+)?(px|rem|em)$/.test(v), `${tag}: base.${k} 是长度值（${v}）`);
    } else if (k === 'tracking-title') {
      check(/^-?[\d.]+(px|em|rem)$/.test(v), `${tag}: base.tracking-title 是字距值（${v}）`);
    } else {
      check(typeof v === 'string' && v.length > 3, `${tag}: base.${k} 是字体栈`);
    }
  });
  // 圆角应递增，否则形态层级会乱
  const rsm = parseFloat(t.base?.['r-sm']), rmd = parseFloat(t.base?.['r-md']), rlg = parseFloat(t.base?.['r-lg']);
  check(rsm <= rmd && rmd <= rlg, `${tag}: 圆角层级递增（${rsm} ≤ ${rmd} ≤ ${rlg}）`);

  /* --- light / dark 配色层 --- */
  ['light', 'dark'].forEach(mode => {
    const c = t[mode];
    check(!!c && typeof c === 'object', `${tag}: 有 ${mode} 配色`);
    if (!c) return;

    const keys = Object.keys(c).sort();
    if (mode === 'light') lightKeySets.push({ id: t.id, keys });
    else darkKeySets.push({ id: t.id, keys });

    // 缺键 = 会串到别的主题的颜色
    const missing = ALL_COLOR_KEYS.filter(k => !(k in c));
    const extra = keys.filter(k => !ALL_COLOR_KEYS.includes(k));
    check(missing.length === 0, `${tag}.${mode}: 无缺失变量` + (missing.length ? `（缺 ${missing.join(', ')}）` : ''));
    check(extra.length === 0, `${tag}.${mode}: 无多余变量` + (extra.length ? `（多 ${extra.join(', ')}）` : ''));

    COLOR_KEYS.forEach(k => {
      if (k in c) check(isHex(c[k]) || isRgba(c[k]), `${tag}.${mode}.${k} 是纯色（${c[k]}）`);
    });
    RGBA_KEYS.forEach(k => {
      if (k in c) check(isRgba(c[k]), `${tag}.${mode}.${k} 是 rgba（${c[k]}）`);
    });
    SHADOW_KEYS.forEach(k => {
      if (k in c) check(/rgba?\(/.test(c[k]) && /\d+px/.test(c[k]), `${tag}.${mode}.${k} 是阴影值`);
    });
    NUM_KEYS.forEach(k => {
      if (k in c) {
        const n = parseFloat(c[k]);
        check(!isNaN(n) && n >= 0 && n <= 1, `${tag}.${mode}.${k} 在 0–1 之间（${c[k]}）`);
      }
    });

    // 背景分层：elev 应最亮（浅色）或最亮（深色也成立），soft 介于两者之外
    if (isHex(c['bg']) && isHex(c['bg-elev'])) {
      const lb = luminance(parseColor(c['bg'])), le = luminance(parseColor(c['bg-elev']));
      check(lb !== le, `${tag}.${mode}: 底色与卡片色有区分`);
    }
  });

  /* --- 可读性（真实对比度） --- */
  const PAIRS = [
    ['text', 'bg', 12, '正文 / 背景'],
    ['text', 'bg-elev', 12, '正文 / 卡片'],
    ['text-2', 'bg', 5.5, '次级文字 / 背景'],
    ['text-2', 'bg-elev', 5.5, '次级文字 / 卡片'],
    ['text-3', 'bg', 3.5, '辅助文字 / 背景'],
    ['text-3', 'bg-elev', 3.5, '辅助文字 / 卡片'],
    ['accent', 'bg', 4.0, '主色 / 背景'],
    ['accent-fg', 'accent', 4.5, '按钮文字 / 主色']
  ];
  ['light', 'dark'].forEach(mode => {
    const c = t[mode];
    if (!c) return;
    PAIRS.forEach(([a, b, min, label]) => {
      if (!parseColor(c[a]) || !parseColor(c[b])) return;
      const r = contrast(c[a], c[b]);
      check(r >= min, `${tag}.${mode}: ${label} 对比度 ${r.toFixed(2)} ≥ ${min}`);
    });
    // toast 是反色块，也必须看得清
    const tr = contrast(c['toast-fg'], c['toast-bg']);
    check(tr >= 4.5, `${tag}.${mode}: 提示条文字对比度 ${tr.toFixed(2)} ≥ 4.5`);
  });
});

/* ------------------------------------------------- 所有主题的键集合必须一致 */
const baseKeys = lightKeySets[0]?.keys.join(',') || '';
lightKeySets.forEach(s => {
  check(s.keys.join(',') === baseKeys, `${s.id}.light: 变量集合与第一套一致`);
});
darkKeySets.forEach(s => {
  check(s.keys.join(',') === baseKeys, `${s.id}.dark: 变量集合与第一套一致`);
});

/* --------------------------------------------- CSS 兜底值 = 默认主题（防跳色） */
const tokens = fs.readFileSync(path.join(ROOT, 'assets/css/00-base/tokens.css'), 'utf8');
const def = T.get(T.defaultSkin) || T.list[0];

// 取出 :root,[data-theme="light"] 区块里的变量
function blockVars(css, startMarker) {
  const start = css.indexOf(startMarker);
  if (start < 0) return null;
  const open = css.indexOf('{', start);
  let depth = 0, end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = css.slice(open + 1, end);
  const out = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2].trim();
  return out;
}

const cssLight = blockVars(tokens, '[data-theme="light"]');
check(!!cssLight, 'tokens.css 中存在浅色兜底区块');
if (cssLight && def) {
  COLOR_KEYS.concat(RGBA_KEYS, SHADOW_KEYS, NUM_KEYS).forEach(k => {
    const want = def.light[k];
    const got = cssLight[k];
    if (want === undefined || got === undefined) return;
    const norm = s => String(s).replace(/\s+/g, '').toLowerCase();
    check(norm(want) === norm(got),
      `CSS 兜底 ${k} 与默认主题 ${def.id} 一致` + (norm(want) !== norm(got) ? `（CSS: ${got} / 主题: ${want}）` : ''));
  });
}

const cssDark = blockVars(tokens, '[data-theme="dark"]');
check(!!cssDark, 'tokens.css 中存在深色兜底区块');
if (cssDark && def) {
  ['bg', 'text', 'accent', 'accent-fg'].forEach(k => {
    const want = def.dark[k], got = cssDark[k];
    if (want === undefined || got === undefined) return;
    check(String(want).toLowerCase() === String(got).toLowerCase(),
      `CSS 深色兜底 ${k} 与默认主题一致` + (String(want).toLowerCase() !== String(got).toLowerCase() ? `（CSS: ${got} / 主题: ${want}）` : ''));
  });
}

/* ------------------------------------------------------------ 接线是否完整 */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
['assets/js/themes.js', 'assets/js/skin.js', 'assets/css/20-components/skin.css'].forEach(f => {
  check(html.includes(f), `index.html 已引入 ${f}`);
});
// themes.js 必须在首屏内联脚本之前，否则首屏拿不到主题
const iTheme = html.indexOf('assets/js/themes.js');
const iInline = html.indexOf("d.classList.add('js')");
check(iTheme > 0 && iInline > iTheme, 'themes.js 在首屏内联脚本之前加载');
check(html.includes('id="skinPanel"') && html.includes('id="skinList"'), '页面含风格面板容器');
check(html.includes('id="skinBtn"'), '页面含风格切换按钮');

const skinSrc = fs.readFileSync(path.join(ROOT, 'assets/js/skin.js'), 'utf8');
check(skinSrc.includes('SITE_THEMES'), 'skin.js 从主题注册表读取');
check(/KEY_SKIN/.test(skinSrc) && /KEY_MODE/.test(skinSrc), '风格与明暗分别记忆');

const adminSrc = fs.readFileSync(path.join(ROOT, 'assets/js/admin.js'), 'utf8');
check(adminSrc.includes('SITE_THEMES'), '内容编辑器可读取主题列表');
check(/avatar/i.test(adminSrc), '内容编辑器支持头像');

/* ------------------------------------------------------ 风格总览页能否渲染 */
const galleryHtml = path.join(ROOT, 'themes.html');
check(fs.existsSync(galleryHtml), '存在风格总览页 themes.html');
if (fs.existsSync(galleryHtml)) {
  const gh = fs.readFileSync(galleryHtml, 'utf8');
  ['assets/js/themes.js', 'assets/js/gallery.js', 'assets/css/30-sections/gallery.css'].forEach(f => {
    check(gh.includes(f), `themes.html 已引入 ${f}`);
  });

  // 用最小 DOM 跑一遍 gallery.js，确认真的生成了 N×2 张卡
  const grid = { innerHTML: '', addEventListener() {} };
  const nodes = {
    gGrid: grid,
    gLead: { textContent: '' },
    gToast: { textContent: '', classList: { add() {}, remove() {} } }
  };
  const gctx = {
    window: null,
    console: { log() {}, warn() {}, error(...a) { fail('gallery 报错: ' + a.join(' ')); } },
    document: {
      getElementById: id => nodes[id] || null,
      querySelectorAll: () => [],
      addEventListener() {},
      body: { innerHTML: '' }
    },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    String, Array, Object, Number, JSON, RegExp, Date, Error, Math
  };
  gctx.window = gctx;
  vm.createContext(gctx);
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8'), gctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/themes.js'), 'utf8'), gctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/gallery.js'), 'utf8'), gctx);
  } catch (e) {
    fail('gallery.js 执行失败: ' + e.message);
  }

  const html = grid.innerHTML || '';
  const cards = (html.match(/class="g-card"/g) || []).length;
  check(cards === T.list.length * 2, `总览页生成 ${T.list.length * 2} 张卡（实际 ${cards}）`);
  // 变量注入用 setProperty 逐个设置（字符串拼接会被字体栈里的引号截断），
  // 所以这里校验的是结构与注入方式，实际颜色由 jsdom / 浏览器验证。
  const gallerySrc = fs.readFileSync(path.join(ROOT, 'assets/js/gallery.js'), 'utf8');
  check(/style\.setProperty\("--"/.test(gallerySrc), '总览页用 setProperty 逐个注入变量');
  T.list.forEach(t => {
    check(html.includes('data-skin="' + t.id + '"'), `总览页含风格 ${t.id}`);
  });
  check(html.includes('data-mode="light"') && html.includes('data-mode="dark"'), '总览页含明暗两种版本');
  // resolve 必须给出完整变量，否则卡片会退回全局配色
  T.list.forEach(t => {
    ['light', 'dark'].forEach(m => {
      const v = T.resolve(t.id, m);
      check(v['bg'] && v['accent'] && v['font-sans'], `${t.id}.${m} 变量表含 bg / accent / 字体`);
    });
  });
}

/* ---------------------------------------------------------------- 输出 */
const total = T.list.length * 2;
console.log(notes.join('\n'));
console.log('\n主题: ' + T.list.map(t => t.name + '(' + t.id + ')').join('  ') + `\n共 ${T.list.length} 套风格 × 2 种明暗 = ${total} 种组合`);
console.log('\n检查项: ' + notes.length + '，失败: ' + failures.length);
if (failures.length) {
  console.log('\n失败明细:\n' + failures.slice(0, 40).join('\n'));
  process.exit(1);
}
console.log('\n全部通过');
