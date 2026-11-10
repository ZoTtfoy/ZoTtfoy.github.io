/* ==========================================================================
 *  自检脚本 —— 在项目根目录运行：node tools/verify.js
 *  在最小 DOM 环境里真实执行站点脚本，检查渲染、图标名、资源引用、
 *  模块开关与旧浏览器降级逻辑。零第三方依赖，改完 config.js 跑一次即可。
 * ========================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const failures = [];
const notes = [];
function check(cond, msg) { if (!cond) failures.push(msg); else notes.push('OK  ' + msg); }

/* ---------- 极简 DOM ---------- */
class El {
  constructor(tag, attrs = {}) {
    this.tag = tag;
    this.attrs = attrs;
    this.id = attrs.id || '';
    this.innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.children = [];
    this.style = { transform: '', cssText: '', minHeight: '', alignItems: '', setProperty() {} };
    this.dataset = {};
    this.offsetHeight = 0;
    this.offsetTop = 0;
    this._classes = new Set();
    this.classList = {
      add: c => this._classes.add(c),
      remove: c => this._classes.delete(c),
      toggle: (c, f) => { if (f === undefined) f = !this._classes.has(c); f ? this._classes.add(c) : this._classes.delete(c); },
      contains: c => this._classes.has(c)
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  matches() { return false; }
  appendChild(el) {
    this.children = this.children.filter(c => c !== el);
    this.children.push(el);
    return el;
  }
  contains() { return false; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
  querySelector(sel) {
    const m = sel.match(/^\[([\w-]+)="([^"]+)"\]$/);
    if (m) return this.children.find(c => c.attrs[m[1]] === m[2]) || null;
    return null;
  }
  querySelectorAll(sel) {
    const m = sel.match(/^\[([\w-]+)\]$/);
    if (m) return this.children.filter(c => m[1] in c.attrs);
    return [];
  }
  addEventListener() {}
}

/* 从 index.html 解析出所有带 id / data-field / data-section 的元素 */
const byId = new Map();
const sections = [];
const metaStubs = new Map();
const missingIds = new Set();
let currentSection = null;
const tagRe = /<([a-zA-Z][\w-]*)\s([^>]*?)>/g;
let m;
while ((m = tagRe.exec(html)) !== null) {
  const tag = m[1], raw = m[2];
  const attrs = {};
  const attrRe = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let a;
  while ((a = attrRe.exec(raw)) !== null) attrs[a[1]] = a[2];
  // 布尔属性（如 data-reveal、hidden）没有 =""，单独补进来
  const remainder = raw.replace(/([\w-]+)\s*=\s*"[^"]*"/g, '');
  for (const word of remainder.split(/\s+/)) {
    if (/^[\w-]+$/.test(word) && !(word in attrs)) attrs[word] = '';
  }
  const el = new El(tag, attrs);
  if (attrs.id) {
    byId.set(attrs.id, el);
    if (attrs.id === 'sections') currentSection = null;
  }
  if (attrs['data-section']) {
    sections.push(el);
    currentSection = el;
  }
  if (attrs['data-field'] && currentSection) currentSection.children.push(el);
}
const wrap = byId.get('sections');
if (wrap) wrap.children = sections.slice();

const metaSel = {
  'meta[name="description"]': new El('meta'),
  'meta[property="og:title"]': new El('meta'),
  'meta[property="og:description"]': new El('meta'),
  'meta[name="theme-color"]': new El('meta'),
  '.ambient': new El('div')
};

const documentStub = {
  readyState: 'complete',
  title: '',
  documentElement: Object.assign(new El('html'), {
    dataset: { theme: 'light' },
    scrollHeight: 4000,
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    classList: { add(){}, remove(){}, contains(){ return false; } }
  }),
  body: new El('body'),
  getElementById(id) {
    const el = byId.get(id);
    /* 少数 id 是渲染期才产出的（index.html 里没有），不算缺失：
       quoteDetails —— 报价表由 render.js 用字符串拼进 #repairQuote，
       结构是 <details id="quoteDetails">，所以 HTML 里搜不到。 */
    if (!el && id !== 'quoteDetails') missingIds.add(id);
    return el || null;
  },
  querySelector(sel) { return metaSel[sel] || null; },
  querySelectorAll(sel) {
    if (sel === '.section') return sections;
    if (sel === '[data-reveal]') return allReveal();
    if (sel === '[data-nav]') return [];
    return [];
  },
  addEventListener() {},
  createElement(tag) { return new El(tag); },
  createDocumentFragment() {
    const frag = new El('#fragment');
    frag.appendChild = function (el) { this.children.push(el); return el; };
    return frag;
  }
};
function allReveal() {
  return [...byId.values()].filter(e => 'data-reveal' in e.attrs);
}

const matchMedia = () => ({ matches: false, addEventListener(){}, addListener(){} });
class FakeIO {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
  unobserve() {}
}
const ctx = {
  console: { log(){}, error(...a) { failures.push('console.error: ' + a.join(' ')); }, warn(){} },
  document: documentStub,
  matchMedia,
  localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: (fn) => { fn(); return 1; },
  setTimeout: (fn) => 0,
  setInterval: () => 0,
  clearInterval() {},
  clearTimeout() {},
  IntersectionObserver: FakeIO,
  navigator: {},
  isSecureContext: false,
  innerWidth: 1440,
  innerHeight: 900,
  scrollY: 0,
  pageYOffset: 0,
  scrollTo() {},
  addEventListener() {},
  history: { pushState(){} },
  Promise, String, Array, Object, Math, Number, JSON, Date, RegExp, Error
};
ctx.window = ctx;
vm.createContext(ctx);

/* ---------- 依次执行站点脚本 ---------- */
/* sync.js / repair.js 也一起加载：它们都有「元素不存在就直接退出」的保护，
   在这里跑一遍能确保这两个新文件本身没有语法或运行时问题。 */
const scripts = ['assets/js/config.js','assets/js/themes.js','assets/js/icons.js','assets/js/render.js',
                 'assets/js/sync.js','assets/js/repair.js',
                 'assets/js/skin.js','assets/js/live.js','assets/js/paged.js','assets/js/effects.js',
                 'assets/js/motion.js','assets/js/main.js'];
for (const rel of scripts) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  try { vm.runInContext(code, ctx, { filename: rel }); }
  catch (e) { failures.push('执行 ' + rel + ' 抛错: ' + e.message); }
}

/* ---------- 断言 ---------- */
const C = ctx.SITE_CONFIG || {};
const H = id => (byId.get(id)?.innerHTML) || '';
const count = (id, re) => (H(id).match(re) || []).length;
const orderedKeys = Object.keys(C.sections || {})
  .sort((a, b) => (C.sections[a].order || 0) - (C.sections[b].order || 0));
const enabledKeys = orderedKeys.filter(k => C.sections[k].enabled !== false);

check(!!C.site, 'config.js 已加载');
check(Object.keys(ctx.SITE_ICONS || {}).length > 30, '图标库已加载（' + Object.keys(ctx.SITE_ICONS || {}).length + ' 个图标）');
check(!!ctx.SITE_RENDER && !!ctx.SITE_MOTION, '渲染层与交互层已注册');
check(documentStub.title.indexOf(C.site.name) === 0, 'document.title 已按配置设置');

// config 中用到的图标名必须存在（改图标名拼错时这里会报错）
const usedIcons = new Set();
for (const key of ['links']) {
  (C[key]?.items || []).forEach(it => usedIcons.add(it.icon));
}
(C.profile?.contacts || []).forEach(it => usedIcons.add(it.icon));
(C.profile?.previews || []).forEach(it => usedIcons.add(it.icon));
if (C.repair?.xianyu) usedIcons.add(C.repair.xianyu.icon);
(C.gaming?.items || []).forEach(it => { if (!it.iconImage) usedIcons.add(it.icon); });
for (const name of usedIcons) check(!!ctx.SITE_ICONS[name], '图标存在: ' + name);

/* ============================================================ Q1 · 我 */
check(H('heroName').includes(C.site.name), 'Q1 名字渲染');
check(H('heroGreet').includes(C.profile.greet), 'Q1 问候语渲染');
check(H('heroTagline').includes(C.profile.tagline), 'Q1 副标题渲染');
check(H('heroIntro').length > 0, 'Q1 简介渲染');
check(count('heroContacts', /class="ccard"/g) === (C.profile.contacts || []).length,
  'QQ / 微信 复制按钮数量与配置一致');
check((C.profile.contacts || []).every(c =>
  H('heroContacts').includes('data-copy="' + ctx.SITE_RENDER.esc(c.value) + '"')),
  '每个联系方式都带 data-copy（点一下能复制）');
check(count('heroPreviews', /class="preview"/g) === (C.profile.previews || []).length,
  'Q1 主页摘要卡数量与配置一致');
check((C.profile.previews || []).every(p => H('heroPreviews').includes('data-preview-id="' + p.id + '"')),
  '每张摘要卡都有 data-preview-id（供 sync.js 回填）');

/* ============================================================ Q2 · 在听 */
check(count('trackList', /class="track"/g) === Math.min(
  (C.listen?.limit || 6), (C.listen?.fallback || []).length),
  'Q2 兜底曲目数量正确（不超过 limit）');
check((C.listen?.fallback || []).length === 0 || H('trackList').includes('track__title'),
  '曲目有标题节点');
check(!/undefined|NaN/.test(H('trackList')), '曲目列表没有 undefined / NaN 泄漏');
check(H('listenFoot').includes('music.163.com') || H('listenFoot').includes('网易云'),
  'Q2 有跳转网易云的入口');
check(typeof ctx.SITE_SYNC === 'object' && typeof ctx.SITE_SYNC.applyTracks === 'function',
  '同步模块已注册且暴露 applyTracks');

/* 同步数据契约：applyTracks 必须能接受真实返回的形状，并拒绝脏数据 */
{
  const before = H('trackList');
  ctx.SITE_SYNC.applyTracks({ tracks: [{ title: 'A', artist: 'B', album: 'C' }] });
  check(H('trackList').includes('A'), 'applyTracks 能吃掉标准格式');
  ctx.SITE_SYNC.applyTracks({ tracks: [] });
  check(H('trackList').includes('A'), '空数据不会把已有列表清空');
  ctx.SITE_SYNC.applyTracks({ tracks: [{ nope: 1 }] });
  check(H('trackList').includes('A'), '脏数据不会覆盖已有列表');
  ctx.SITE_SYNC.applyTracks(null);
  check(H('trackList').includes('A'), 'null 不会导致崩溃');
  void before;
}

/* ============================================================ Q3 · 游戏 */
const games = (C.gaming?.items || []);
check(count('gameRail', /class="game"/g) === games.length, 'Q3 游戏卡片数量正确');
check(count('gameRail', /data-copy="/g) === games.filter(g => g.uid || g.copy).length,
  '每张游戏卡都有可复制的 ID');
check(!/game__stats|game__note/.test(H('gameRail')), 'Q3 卡片不含介绍性内容（只有图标/名称/ID）');
games.forEach(g => {
  if (!g.iconImage) check(!!ctx.SITE_ICONS[g.icon], '游戏图标存在: ' + g.name + ' → ' + g.icon);
});
check(!games.some(g => g.iconImage) || H('gameRail').includes('game__logo'),
  '配了自定义图标时渲染 <img>');
check(!/undefined|NaN/.test(H('gameRail')), '游戏卡片没有 undefined / NaN 泄漏');
check(games.every(g => !g.color || /^#[0-9a-f]{3,8}$/i.test(g.color)), '品牌色都是合法色值');

/* ============================================================ Q4 · 维修 */
check(count('repairPreview', /class="preview"/g) === (C.repair?.xianyu ? 1 : 0),
  'Q4 闲鱼摘要卡渲染');
const quoteRows = (C.repair?.quote?.rows || []);
check(count('repairQuote', /class="quote__row"/g) === quoteRows.length,
  '报价表行数与配置一致');
check(count('repairQuote', /class="quote__group"/g) ===
  new Set(quoteRows.map(r => r.group)).size, '报价表按 group 正确分栏');
check((quoteRows.length === 0) || H('repairQuote').includes(quoteRows[0].item), '报价表项目名来自配置');

/* 计算器：配置层校验 + 渲染校验 */
const calc = C.repair?.calculator || {};
check((calc.devices || []).length > 0, '计算器配了设备选项');
check((calc.services || []).length > 0, '计算器配了项目选项');
check((calc.materials || []).length > 0, '计算器配了材料选项');
check((calc.extras || []).length > 0, '计算器配了加项选项');
check([...(calc.devices || []), ...(calc.materials || [])].every(
  x => typeof x.factor === 'number' && x.factor > 0), '系数都是正数');
check((calc.services || []).every(x => typeof x.price === 'number' && x.price >= 0),
  '项目价格都是非负数');
check((calc.extras || []).every(x => typeof x.add === 'number'), '加项都是固定金额');
check(Array.isArray(calc.range) && calc.range.length === 2 && calc.range[0] < calc.range[1],
  '区间上下限合法');
check((calc.services || []).every(x => !x.devices ||
  x.devices.every(d => (calc.devices || []).some(dev => dev.id === d))),
  '项目支持列表里的设备 id 都存在（拼错会导致该选项永远不可选）');
check(typeof ctx.SITE_REPAIR === 'object' && typeof ctx.SITE_REPAIR.compute === 'function',
  '计算器模块已注册且暴露 compute');

/* 算法校验：手算一遍和 compute() 对一次 */
{
  const dev = calc.devices?.[0], svc = calc.services?.[0], mat = calc.materials?.[0];
  const ext = (calc.extras || []).find(e => e.id === 'none') || calc.extras?.[0];
  if (dev && svc && mat && ext) {
    ctx.SITE_REPAIR.state.device = dev.id;
    ctx.SITE_REPAIR.state.service = svc.id;
    ctx.SITE_REPAIR.state.material = mat.id;
    ctx.SITE_REPAIR.state.extra = ext.id;
    const r = ctx.SITE_REPAIR.compute();
    const mid = svc.price * dev.factor * mat.factor + ext.add;
    check(r && r.lo === Math.round(mid * calc.range[0]) && r.hi === Math.round(mid * calc.range[1]),
      '计算器结果 = 项目价 × 设备系数 × 材料系数 + 加项，再按区间展开');
  }
}

/* ============================================================ Q5 · 其他 */
check(count('linksGrid', /class="social"/g) === (C.links?.items || []).length,
  'Q5 链接数量正确');
check(H('linksGrid').includes('rel="noopener noreferrer"'), '外链 noopener');
const copyItems = (C.links?.items || []).filter(it => it.copy);
check(count('linksGrid', /data-copy="/g) === copyItems.length, 'copy 类型链接数量正确');
check(copyItems.length === 0 || H('linksGrid').includes('<button class="social"'), 'copy 类型渲染为按钮');
check(copyItems.every(it => !it.url), 'copy 类型不带无效链接');

/* ============================================================ Q6 · 邮箱 */
check(H('contactBox').includes('data-copy="' + ctx.SITE_RENDER.esc(C.site.email) + '"'),
  'Q6 复制邮箱按钮渲染');
check(H('contactBox').includes('mailto:'), 'Q6 发邮件链接渲染');
check(H('contactBox').includes(C.site.email), 'Q6 邮箱地址来自配置');

/* ==================================================== 导航与结构一致性 */
check(count('navList', /<li>/g) === enabledKeys.length, '桌面导航与模块开关一致');
check(count('mobileNavList', /<li>/g) === enabledKeys.length, '移动导航与模块开关一致');
/* 导航编号从 02 起（01 是首屏 Q1，不占导航项） */
check(!H('navList').includes('>01<') || enabledKeys.length === 0,
  '导航编号从 02 开始（01 留给首屏）');
/* 六个页面 id 必须都在 DOM 里，否则翻页引擎会漏页 */
for (const id of ['top', 'listen', 'gaming', 'repair', 'links', 'contact']) {
  check(byId.has(id), '页面存在: #' + id);
}
check(H('themeToggle').includes('<svg'), '主题按钮图标');
check(H('toTop').includes('<svg'), '回到顶部图标');
check(H('menuToggle').includes('<svg'), '菜单按钮图标');
check(missingIds.size === 0, '所有 getElementById 都能命中（缺失: ' + [...missingIds].join(',') + '）');
check(wrap && wrap.children.map(c => c.attrs['data-section']).join(',') === orderedKeys.join(','), '模块顺序与 config 一致');
for (const key of Object.keys(C.sections || {})) {
  const sec = sections.find(s => s.attrs['data-section'] === key);
  if (sec) check(sec.hidden === (C.sections[key].enabled === false), '模块开关生效: ' + key);
}

// index.html 引用的本地资源
const refs = [...html.matchAll(/(?:src|href)="((?:assets|[\w.-]+)\/[^"#:]+|\.nojekyll)"/g)].map(x => x[1]);
for (const ref of new Set(refs)) {
  if (ref.startsWith('http') || ref.startsWith('#') || ref.startsWith('data:')) continue;
  check(fs.existsSync(path.join(ROOT, ref)), '资源存在: ' + ref);
}

// CSS / JS 括号平衡
for (const rel of ['assets/css/tokens.css','assets/css/layout.css','assets/css/components.css',
                   'assets/css/motion.css','assets/css/skin.css']) {
  const css = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const open = (css.match(/{/g) || []).length, close = (css.match(/}/g) || []).length;
  check(open === close, 'CSS 括号平衡: ' + rel + ' (' + open + '/' + close + ')');
}

/* ---------- 头像 ---------- */
const setAvatar = (v) => { ctx.SITE_CONFIG.site.avatar = v; };
check(typeof H('brandMark') === 'string', '品牌标记已渲染');
const letterHtml = H('brandMark');
check(letterHtml.includes('brand__mark') && !letterHtml.includes('<img'), '未设头像时用字母方块');
setAvatar('https://example.com/a.png');
try { ctx.SITE_RENDER.init(); } catch (e) { failures.push('设置头像后重渲染失败: ' + e.message); }
check(H('brandMark').includes('<img class="brand__avatar"'), '设了头像后页头渲染为图片');
check(H('brandMark').includes('https://example.com/a.png'), '头像地址写入正确');
check(H('footerMark').includes('brand__avatar--sm'), '页脚头像使用小尺寸变体');
check(byId.get('heroAvatar').hidden === false, '首页头像显示');
check(H('heroAvatar').includes('<img'), '首页头像渲染为图片');
setAvatar('');
try { ctx.SITE_RENDER.init(); } catch (e) { failures.push('清空头像后重渲染失败: ' + e.message); }
check(!H('brandMark').includes('<img'), '清空头像后回到字母方块');
check(byId.get('heroAvatar').hidden === true, '清空头像后首页头像隐藏');

/* ---------- 主题 ---------- */
check(Array.isArray(ctx.SITE_THEMES && ctx.SITE_THEMES.list), 'themes.js 已加载');
check(ctx.SITE_THEMES.list.length >= 5, '主题数量 ≥ 5');
check(!!ctx.SITE_THEMES.get('ink'), '可按 id 取到主题');
check(html.includes('assets/js/skin.js') && html.includes('assets/css/skin.css'), '页面引入主题脚本与样式');

/* ---------- 第二遍：模拟不支持 IntersectionObserver 的环境，验证降级 ---------- */
const before = failures.length;
const ctx2 = Object.assign({}, ctx, {
  IntersectionObserver: undefined,
  console: { log(){}, error(...a) { failures.push('[降级] console.error: ' + a.join(' ')); }, warn(){} }
});
ctx2.window = ctx2;
vm.createContext(ctx2);
for (const rel of scripts) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx2, { filename: rel }); }
  catch (e) { failures.push('[降级] 执行 ' + rel + ' 抛错: ' + e.message); }
}
check(failures.length === before, '无 IntersectionObserver 时降级正常且无报错');
/* Q1 重构后不再有 heroTitle（大标题换成了 profile__name），
   这里挑首屏任意一个 [data-reveal] 元素验证降级即可。 */
check(byId.get('heroName')._classes.has('is-visible'), '降级环境下内容仍然可见');

console.log(notes.join('\n'));
console.log('\n检查项: ' + notes.length + '，失败: ' + failures.length);
if (failures.length) { console.log('\n失败明细:\n' + failures.join('\n')); process.exit(1); }
console.log('\n全部通过');
