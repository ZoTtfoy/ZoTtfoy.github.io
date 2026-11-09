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
    this.style = { transform: '', cssText: '' };
    this.dataset = {};
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
    classList: { add(){}, remove(){}, contains(){ return false; } }
  }),
  body: new El('body'),
  getElementById(id) {
    const el = byId.get(id);
    if (!el) missingIds.add(id);
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
  createElement(tag) { return new El(tag); }
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
const scripts = ['assets/js/config.js','assets/js/icons.js','assets/js/render.js','assets/js/motion.js','assets/js/main.js'];
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
for (const key of ['services','interests','social']) {
  (C[key]?.items || []).forEach(it => usedIcons.add(it.icon));
}
for (const name of usedIcons) check(!!ctx.SITE_ICONS[name], '图标存在: ' + name);

// 渲染结果：全部按当前 config 动态比对，改内容不会误报
check(H('heroTitle').includes(String(C.site.tagline).split('\n')[0]), 'Hero 大标题渲染');
check(!String(C.site.tagline).includes('\n') || H('heroTitle').includes('<br>'), 'Hero 换行渲染');
check(H('heroStatus').includes('status-dot') === !!C.site.available, '合作状态徽章与开关一致');
check(count('serviceGrid', /class="card"/g) === (C.services?.items || []).length, '业务卡片数量正确');
check(count('interestGrid', /class="interest"/g) === (C.interests?.items || []).length, '喜好卡片数量正确');
check(count('socialGrid', /class="social"/g) === (C.social?.items || []).length, '社交链接数量正确');
check(count('navList', /<li>/g) === enabledKeys.length, '桌面导航与模块开关一致');
check(count('mobileNavList', /<li>/g) === enabledKeys.length, '移动导航与模块开关一致');
check(count('aboutFacts', /facts__row/g) === (C.about?.facts || []).length, '关于信息表行数正确');
check(count('aboutTags', /class="tag"/g) === (C.about?.tags || []).length, '关键词标签数量正确');
check(H('contactBlock').includes('data-copy="' + ctx.SITE_RENDER.esc(C.site.email) + '"'), '复制邮箱按钮渲染');
check(H('contactBlock').includes('mailto:'), '发邮件链接渲染');
check(H('socialGrid').includes('target="_blank"'), '外链安全属性');
check(H('socialGrid').includes('rel="noopener noreferrer"'), '外链 noopener');
check(byId.get('about').querySelector('[data-field="title"]')?.innerHTML === (C.about?.title || ''), '区块标题填充');
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
for (const rel of ['assets/css/tokens.css','assets/css/layout.css','assets/css/components.css','assets/css/motion.css']) {
  const css = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const open = (css.match(/{/g) || []).length, close = (css.match(/}/g) || []).length;
  check(open === close, 'CSS 括号平衡: ' + rel + ' (' + open + '/' + close + ')');
}

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
check(byId.get('heroTitle')._classes.has('is-visible'), '降级环境下内容仍然可见');

console.log(notes.join('\n'));
console.log('\n检查项: ' + notes.length + '，失败: ' + failures.length);
if (failures.length) { console.log('\n失败明细:\n' + failures.join('\n')); process.exit(1); }
console.log('\n全部通过');
