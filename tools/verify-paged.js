/* ==========================================================================
 *  翻页与光效验证：node tools/verify-paged.js
 * --------------------------------------------------------------------------
 *  jsdom 没有布局引擎（offsetHeight 恒为 0），所以这里重点验证
 *  「逻辑与接线」是否正确，布局相关的部分交给真实浏览器：
 *    · 是否进入翻页模式、页码是否按区块生成
 *    · 高个页判定：用假布局喂给 markTall，验证阈值判断
 *    · 页码点击 / 键盘翻页 / 边界不越界
 *    · 光效开关、触屏不跑追光
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const notes = [], failures = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : failures.push(m);
const fail = m => failures.push(m);

/* ---------------------------------------------------------------- 读文件 */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pagedSrc = fs.readFileSync(path.join(ROOT, 'assets/js/paged.js'), 'utf8');
const effectsSrc = fs.readFileSync(path.join(ROOT, 'assets/js/effects.js'), 'utf8');
const pagedCss = fs.readFileSync(path.join(ROOT, 'assets/css/paged.css'), 'utf8');
const effectsCss = fs.readFileSync(path.join(ROOT, 'assets/css/effects.css'), 'utf8');

/* ------------------------------------------------------ 1. 接线是否完整 */
['assets/css/paged.css', 'assets/css/effects.css'].forEach(f => {
  ok(html.includes(f), 'index.html 引入 ' + f);
});
['assets/js/paged.js', 'assets/js/effects.js'].forEach(f => {
  ok(html.includes(f), 'index.html 引入 ' + f);
});
// 顺序：paged 必须在 motion 之前（motion 的锚点要调 paged.goTo）
const iPaged = html.indexOf('assets/js/paged.js');
const iMotion = html.indexOf('assets/js/motion.js');
const iEffects = html.indexOf('assets/js/effects.js');
const iMain = html.indexOf('assets/js/main.js');
ok(iPaged > 0 && iPaged < iMotion, 'paged.js 在 motion.js 之前加载');
ok(iEffects > 0 && iEffects < iMain, 'effects.js 在 main.js 之前加载');
ok(html.includes('id="spotlight"'), '页面含追光元素');
ok(html.includes('id="pager"') && html.includes('id="pagerList"'), '页面含页码容器');
ok(html.includes('class="page-sweep"'), '页面含翻页光扫元素');

/* --------------------------------------------- 2. 用假 DOM 跑翻页逻辑 */
const HEIGHT = { vh: 900 };

function makeEl(id, attrs = {}, opts = {}) {
  const el = {
    id,
    attrs: Object.assign({}, attrs),
    hidden: false,
    style: { minHeight: '', alignItems: '', setProperty() {}, getPropertyValue() { return ''; } },
    _children: [],
    _classes: new Set(),
    classList: {
      add: c => el._classes.add(c),
      remove: c => el._classes.delete(c),
      toggle: (c, f) => { if (f === undefined) f = !el._classes.has(c); f ? el._classes.add(c) : el._classes.delete(c); },
      contains: c => el._classes.has(c)
    },
    getAttribute: k => (k in el.attrs ? el.attrs[k] : null),
    setAttribute: (k, v) => { el.attrs[k] = String(v); },
    removeAttribute: k => { delete el.attrs[k]; },
    hasAttribute: k => k in el.attrs,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, fn) { (el._on[type] = el._on[type] || []).push(fn); },
    _on: {},
    fire(type, ev) { (el._on[type] || []).forEach(fn => fn(ev)); },
    getBoundingClientRect() { return { top: HEIGHT.top != null ? HEIGHT.top : 0, left: 0, width: 1200, height: el.offsetHeight }; },
    appendChild(c) { el._children.push(c); c.parentNode = el; return c; },
    matches: sel => String(sel).split(',').some(s => s.trim() === '.section' && el.attrs['data-section'] || s.trim() === '.hero' && el.id === 'top'),
    // 由测试注入
    offsetHeight: 0,
    offsetTop: 0,
    textContent: opts.text || ''
  };
  return el;
}

/* 造 5 个页面：首页 + 4 个区块；第 3 个刻意做成高个页 */
const pages = [];
const hero = makeEl('top', {});
hero.offsetHeight = 900;
const secIds = ['about', 'services', 'interests', 'social'];
secIds.forEach((id, i) => {
  const s = makeEl(id, { 'data-section': id });
  s.offsetHeight = 900;
  s.querySelector = sel => sel === '.section__title' ? { textContent: id } : null;
  pages.push(s);
});

const pagerList = makeEl('pagerList');
const pagerEl = makeEl('pager');
const sweepEl = makeEl('sweep');

const allPages = [hero, ...pages];
let scrollY = 0;
const scrollCalls = [];

const doc = {
  readyState: 'complete',
  documentElement: {
    dataset: {},
    style: { setProperty() {}, getPropertyValue() { return '72px'; } },
    offsetHeight: 1000
  },
  getElementById(id) {
    if (id === 'top') return hero;
    if (id === 'pagerList') return pagerList;
    if (id === 'pager') return pagerEl;
    return null;
  },
  querySelectorAll(sel) {
    if (sel === '.section') return pages;
    if (sel === '.page-sweep') return sweepEl;
    return [];
  },
  querySelector(sel) {
    if (sel === '.page-sweep') return sweepEl;
    return null;
  },
  createElement(tag) {
    const el = makeEl('made-' + tag);
    el.tagName = tag.toUpperCase();
    el.className = '';
    el.type = '';
    el.innerHTML = '';
    return el;
  },
  addEventListener() {},
  body: { appendChild() {}, removeChild() {} }
};

const ctx = {
  window: null,
  document: doc,
  console: { log() {}, error(...a) { fail('console.error: ' + a.join(' ')); }, warn() {} },
  matchMedia: q => ({
    matches: q.indexOf('prefers-reduced-motion') >= 0 ? false :
             q.indexOf('pointer: fine') >= 0 ? true : false,
    addEventListener() {}, addListener() {}, removeEventListener() {}
  }),
  requestAnimationFrame: fn => { fn(); return 1; },
  cancelAnimationFrame() {},
  setTimeout: (fn) => { if (fn) fn(); return 0; },
  clearTimeout() {},
  getComputedStyle: () => ({ getPropertyValue: () => '72px' }),
  innerHeight: HEIGHT.vh,
  innerWidth: 1200,
  scrollY: 0,
  pageYOffset: 0,
  scrollTo: (o) => { scrollCalls.push(o.top); scrollY = o.top; ctx.window.scrollY = o.top; },
  addEventListener() {},
  location: { protocol: 'https:' },
  history: { pushState() {} },
  Promise, String, Array, Object, Math, Number, JSON, Date, RegExp, Error, Boolean, parseInt, parseFloat, isNaN
};
ctx.window = ctx;
vm.createContext(ctx);

vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8'), ctx);
vm.runInContext(pagedSrc, ctx, { filename: 'paged.js' });

ok(!!ctx.SITE_PAGED, 'paged.js 暴露 SITE_PAGED');

ctx.SITE_PAGED.init();

/* --- 模式开关 --- */
ok(doc.documentElement.dataset.paged === 'on', '初始化为翻页模式');

/* --- 页码生成 --- */
ok(pagerList._children.length === 5, '生成 5 个页码项（首页 + 4 区块）');
const dotBtns = pagerList._children.map(li => li._children[0]);
ok(dotBtns.every(b => b && b.className === 'pager__dot'), '每项都是一个页码按钮');
ok(dotBtns[0].attrs['aria-label'].includes('首页'), '第一页标签是「首页」');
ok(dotBtns[1].attrs['aria-label'].includes('关于'), '区块页标签取自 sections.label（中文名）');
ok(dotBtns.every(b => b.innerHTML.includes('pager__label')), '每个页码都带悬停标签');

/* --- 高个页判定：把第 3 页撑到 1400px --- */
pages[1].offsetHeight = 1400;   // interests（索引 1 在 pages 数组里）
ctx.SITE_PAGED.refresh();
ok(pages[1].attrs['data-tall'] === '1', '内容超出一屏的页被标记为高个页');
ok(pages[0].attrs['data-tall'] === undefined, '刚好一屏的页不会被误标');
pages[1].offsetHeight = 900;
ctx.SITE_PAGED.refresh();
ok(pages[1].attrs['data-tall'] === undefined, '内容回落后标记被清除');

/* --- 点击页码跳转 --- */
scrollCalls.length = 0;
dotBtns[2].fire('click', {});
ok(scrollCalls.length === 1, '点击页码触发一次滚动');
ok(scrollCalls[0] === pages[1].getBoundingClientRect().top, '滚动目标是该页顶部');

/* --- 当前页高亮 --- */
ctx.SITE_PAGED.refresh();
const currentCount = dotBtns.filter(b => b._classes.has('is-current')).length;
ok(currentCount === 1, '同时只有一个页码处于当前态');
ok(dotBtns.some(b => b.attrs['aria-current'] === 'page'), '当前页有 aria-current');

/* --- 键盘：不越界 --- */
const keyHandlers = [];
ctx.document.addEventListener = (t, fn) => { if (t === 'keydown') keyHandlers.push(fn); };
/* init 时已经注册过，这里重新注册以拿到引用 */
ctx.SITE_PAGED.init();
const onKey = (k) => {
  let prevented = false;
  keyHandlers.forEach(fn => fn({
    key: k, target: { tagName: 'BODY' },
    metaKey: false, ctrlKey: false, altKey: false,
    preventDefault: () => { prevented = true; }
  }));
  return prevented;
};
scrollCalls.length = 0;
onKey('End');
ok(scrollCalls.length >= 1, 'End 键触发跳转');
onKey('1');
ok(scrollCalls.length >= 2, '数字键 1 跳到首页');

/* --- 关掉翻页 --- */
ctx.SITE_CONFIG.ui.paged = false;
const ctx2 = Object.assign({}, ctx);
ctx2.window = ctx2;
vm.createContext(ctx2);
const cfgPagedOff = fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8')
  .replace('paged: true', 'paged: false');
vm.runInContext(cfgPagedOff, ctx2);
vm.runInContext(pagedSrc, ctx2, { filename: 'paged-off.js' });
ctx2.SITE_PAGED.init();
ok(ctx2.document.documentElement.dataset.paged === 'off', 'ui.paged=false 时关闭翻页');

/* --------------------------------------------- 3. 光效逻辑（同样用假 DOM） */
const spot = makeEl('spotlight');
const ctx3 = {
  window: null,
  document: {
    readyState: 'complete',
    documentElement: { dataset: {} },
    getElementById: id => (id === 'spotlight' ? spot : null),
    addEventListener(t, fn) { (doc._lis = doc._lis || {})[t] = fn; },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => makeEl('ripple')
  },
  matchMedia: q => ({
    matches: q.indexOf('pointer: fine') >= 0,
    addEventListener() {}, addListener() {}
  }),
  requestAnimationFrame: fn => { fn(); return 1; },
  setTimeout: fn => { if (fn) fn(); return 0; },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1200,
  innerHeight: 900,
  Promise, String, Array, Object, Math, JSON, Number, Date, RegExp, Error
};
ctx3.window = ctx3;
vm.createContext(ctx3);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8'), ctx3);
vm.runInContext(effectsSrc, ctx3, { filename: 'effects.js' });
ok(!!ctx3.SITE_EFFECTS, 'effects.js 暴露 SITE_EFFECTS');
ctx3.SITE_EFFECTS.init();
ok(ctx3.document.documentElement.dataset.effects === 'on', '光效默认开启');

/* 关掉光效 */
const ctx4 = Object.assign({}, ctx3);
ctx4.window = ctx4;
ctx4.document = Object.assign({}, ctx3.document, {
  documentElement: { dataset: {} },
  getElementById: () => null
});
vm.createContext(ctx4);
const cfgOff = fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8')
  .replace('lightEffects: true', 'lightEffects: false');
vm.runInContext(cfgOff, ctx4);
vm.runInContext(effectsSrc, ctx4, { filename: 'effects-off.js' });
ctx4.SITE_EFFECTS.init();
ok(ctx4.document.documentElement.dataset.effects === 'off', 'ui.lightEffects=false 时关闭光效');

/* -------------------------------------------------------- 4. CSS 断言 */
// 吸附与高个页
ok(/scroll-snap-type:\s*y proximity/.test(pagedCss), '用 proximity 而不是 mandatory（避免卡住高个页）');
ok(/scroll-snap-stop:\s*always/.test(pagedCss), '设置了 scroll-snap-stop 保证一页一页翻');
ok(/data-tall="1"/.test(pagedCss) && /scroll-snap-align:\s*none/.test(pagedCss), '高个页放弃吸附');
ok(/scroll-padding-top:\s*0/.test(pagedCss), '翻页模式清零 scroll-padding，避免差一个页头');
ok(/min-height:\s*100svh/.test(pagedCss), '用 svh 处理手机地址栏');
ok(/overflow-x:\s*hidden/.test(pagedCss), '横向裁切放到 html（否则 body 抢滚动容器）');
// 无障碍
/* 在 reduced-motion 块内搜索，不限制字符距离（中间允许有注释） */
const rmSnap = pagedCss.slice(pagedCss.indexOf('prefers-reduced-motion: reduce'));
ok(/scroll-snap-type:\s*none/.test(rmSnap), '减少动态效果时关闭吸附');
ok(/\[data-snap\]/.test(rmSnap),
   '关闭吸附的选择器权重足够（否则会被强制吸附规则覆盖）');
ok(/prefers-reduced-motion:\s*reduce[\s\S]{0,260}\.spotlight\s*\{\s*display:\s*none/.test(effectsCss),
   '减少动态效果时关闭追光');
ok(/@media \(hover: none\), \(pointer: coarse\)/.test(effectsCss), '触屏设备不渲染追光');
ok(/@media \(hover: hover\) and \(pointer: fine\)/.test(effectsCss), '卡片光斑只在精确指针设备启用');
// 光斑变量
ok(/--mx/.test(effectsCss) && /--my/.test(effectsCss), '卡片光斑用 --mx/--my 定位');
ok(/z-index:\s*1/.test(effectsCss), '追光在内容之下，不挡点击');

/* ------------------------------------------------- 5. 站点自检的接线项 */
const verifySrc = fs.readFileSync(path.join(ROOT, 'tools/verify.js'), 'utf8');
ok(/paged\.js/.test(verifySrc), '站点自检已纳入 paged.js');

console.log(notes.join('\n'));
console.log('\n检查项: ' + notes.length + '，失败: ' + failures.length);
if (failures.length) { console.log('\n失败明细:\n' + failures.join('\n')); process.exit(1); }
console.log('\n全部通过');
