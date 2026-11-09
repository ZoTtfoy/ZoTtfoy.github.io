/* ==========================================================================
 *  深度验证：node tools/verify-dom.js（可选，需要 jsdom）
 * --------------------------------------------------------------------------
 *  前面三个自检用轻量桩，够快但看不到真实样式。这个脚本用 jsdom 真正加载
 *  页面、执行脚本、模拟点击，验证：
 *    · 主题变量是否真的注入到了元素上（逐个变量核对）
 *    · 风格面板能否展开 / 收起 / 切换，选中态是否同步
 *    · 头像从字母切到图片后，页头 / 页脚 / 首页是否都正确
 *    · 风格总览页 14 张卡的变量是否各不相同（说明按格注入生效）
 *    · 内容编辑器能否用凭据登录、外观页能否选风格
 *
 *  安装依赖（仅此一个脚本需要，站点本身零依赖）：
 *      npm install jsdom --no-save
 *  没有安装时会自动跳过，不影响其他自检。
 * ========================================================================== */
let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  console.log('未安装 jsdom，跳过深度验证。');
  console.log('如需运行：npm install jsdom --no-save && node tools/verify-dom.js');
  process.exit(0);
}

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const notes = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : failures.push(m);

function load(file, opts = {}) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://zottfoy.github.io/' + (file === 'index.html' ? '' : file),
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: undefined,
    beforeParse(win) {
      // jsdom 不实现 IntersectionObserver / matchMedia 的部分用法
      win.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe(el) { this.cb([{ isIntersecting: true, target: el }], this); }
        unobserve() {}
        disconnect() {}
      };
      win.matchMedia = q => ({
        matches: false, media: q,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
      });
      win.scrollTo = () => {};
      if (opts.beforeParse) opts.beforeParse(win);
    }
  });
  // 手动注入本地脚本（jsdom 默认不加载外部资源）
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  for (const src of scripts) {
    if (/^https?:/.test(src)) continue;
    const p = path.join(ROOT, src);
    if (!fs.existsSync(p)) { failures.push('缺少脚本 ' + src); continue; }
    const el = dom.window.document.createElement('script');
    el.textContent = fs.readFileSync(p, 'utf8');
    dom.window.document.body.appendChild(el);
  }
  return dom;
}

/* ============================ index.html ============================ */
const dom = load('index.html');
const win = dom.window;
const doc = win.document;
const root = doc.documentElement;

ok(!!win.SITE_THEMES, 'themes.js 在真实 DOM 中加载');
ok(!!win.SITE_SKIN, 'skin.js 在真实 DOM 中加载');
ok(!!win.SITE_RENDER && !!win.SITE_MOTION, '渲染层与交互层就绪');

// 首屏内联脚本应当已经设置了 skin/theme
ok(!!root.dataset.skin, '首屏即确定风格：' + root.dataset.skin);
ok(['light', 'dark'].includes(root.dataset.theme), '首屏即确定明暗：' + root.dataset.theme);

// 变量是否真的注入到了 :root 的行内样式
const injected = (root.getAttribute('style') || '');
ok(injected.includes('--bg'), '行内注入了 --bg');
ok(injected.includes('--font-sans'), '行内注入了字体变量');
ok(injected.includes('--r-md'), '行内注入了圆角变量');

// 主题面板是否由 JS 生成
const skinList = doc.getElementById('skinList');
const items = skinList.querySelectorAll('[data-skin]');
ok(items.length === win.SITE_THEMES.list.length, `面板列出 ${items.length} 套风格`);
const activeCount = skinList.querySelectorAll('.skin-item.is-active').length;
ok(activeCount === 1, '面板中恰有一项处于选中态');
ok(doc.getElementById('skinCount').textContent.includes(String(win.SITE_THEMES.list.length)),
   '面板显示风格数量');

// 明暗三段控件
const modeBtns = doc.querySelectorAll('[data-mode]');
ok(modeBtns.length === 3, '明暗控件有三段');
ok(doc.querySelector('[data-mode="auto"]').classList.contains('is-active') ===
   (root.dataset.modeRaw === 'auto'), '明暗控件高亮与实际状态一致');

// 点一个风格，检查变量是否真的变了
const before = root.getAttribute('style');
const target = items[2]; // 第三套
const targetId = target.getAttribute('data-skin');
target.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(root.dataset.skin === targetId, `点击后风格切到 ${targetId}`);
ok(root.getAttribute('style') !== before, '点击后变量表确实重新注入');
const skin = win.SITE_THEMES.get(targetId);
const wantBg = skin[root.dataset.theme].bg;
ok(injected_now(root).includes(wantBg) || (root.getAttribute('style') || '').includes(wantBg),
   '注入的 --bg 与新风格一致（' + wantBg + '）');

function injected_now(el) { return el.getAttribute('style') || ''; }

// 面板开合
const panel = doc.getElementById('skinPanel');
const skinBtn = doc.getElementById('skinBtn');
ok(panel.hidden === true, '面板初始收起');
skinBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(panel.hidden === false, '点击按钮后面板展开');
ok(skinBtn.getAttribute('aria-expanded') === 'true', '展开时 aria-expanded 同步');
skinBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(panel.hidden === true, '再次点击收起');

// 明暗切换按钮
const themeBtn = doc.getElementById('themeToggle');
const modeBefore = root.dataset.theme;
themeBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(root.dataset.theme !== modeBefore, `明暗快切生效（${modeBefore} → ${root.dataset.theme}）`);

// 图标
ok(skinBtn.innerHTML.includes('<svg'), '风格按钮有图标');
ok(themeBtn.innerHTML.includes('<svg'), '明暗按钮有图标');

/* ============================ 头像 ============================ */
const dom2 = load('index.html', {
  beforeParse(w) {
    // 在脚本执行前改配置不现实，改为加载后重渲染
  }
});
const w2 = dom2.window, d2 = w2.document;
ok(d2.querySelector('.brand__mark') && !d2.querySelector('.brand__avatar'), '默认用字母方块');
ok(d2.getElementById('heroAvatar').hidden === true, '默认不显示首页头像');

w2.SITE_CONFIG.site.avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
w2.SITE_RENDER.init();
ok(!!d2.querySelector('.brand__avatar'), '设头像后页头出现图片');
ok(d2.getElementById('heroAvatar').hidden === false, '设头像后首页头像显示');
const heroImg = d2.querySelector('#heroAvatar img');
ok(!!heroImg, '首页头像渲染出 img');
ok(heroImg && heroImg.getAttribute('alt').length > 0, '头像有 alt 文本');

/* ============================ themes.html ============================ */
const dom3 = load('themes.html');
const d3 = dom3.window.document;
const cards = d3.querySelectorAll('.g-card');
ok(cards.length === dom3.window.SITE_THEMES.count(), `总览页渲染 ${cards.length} 张卡`);
let allStyled = true, allVars = true, allFont = true, allRadius = true;
cards.forEach(c => {
  if (!c.style.getPropertyValue('--bg')) allStyled = false;
  if (!c.style.getPropertyValue('--accent')) allVars = false;
  if (!c.style.getPropertyValue('--font-sans')) allFont = false;
  if (!c.style.getPropertyValue('--r-md')) allRadius = false;
});
ok(allStyled, '每张总览卡都注入了 --bg');
ok(allVars, '每张总览卡都注入了 --accent');
ok(allFont, '每张卡注入字体变量');
ok(allRadius, '每张卡注入圆角变量');
// 抽查：卡片变量的值应与 resolve() 完全一致
const sample = cards[5];
const sv = dom3.window.SITE_THEMES.resolve(sample.getAttribute('data-skin'), sample.getAttribute('data-mode'));
ok(sample.style.getPropertyValue('--bg') === sv['bg'], '抽检卡片 --bg 与主题定义一致（' + sv['bg'] + '）');
ok(sample.style.getPropertyValue('--accent') === sv['accent'], '抽检卡片 --accent 与主题定义一致');
// 两张卡片的变量不应相同（否则说明没按格注入）
ok(cards[0].style.getPropertyValue('--bg') !== cards[1].style.getPropertyValue('--bg'),
   '相邻卡片的底色不同（说明按格注入生效）');

// 点击会写入 localStorage 并标记
const first = cards[0];
first.dispatchEvent(new dom3.window.MouseEvent('click', { bubbles: true }));
ok(first.classList.contains('is-current'), '点击后该卡标记为当前');
ok(dom3.window.localStorage.getItem('zotrod-skin') === first.getAttribute('data-skin'),
   '选择已写入 localStorage');

/* ============================ admin.html ============================ */
const dom4 = load('admin.html');
const w4 = dom4.window, d4 = w4.document;
ok(!!d4.getElementById('gate'), '管理页显示登录门');
ok(d4.getElementById('app').hidden === true, '未登录时编辑器隐藏');

// 用正确凭据登录
const credPath = path.join(ROOT, '..', '管理凭据.txt');
if (!fs.existsSync(credPath)) {
  console.log('未找到仓库外的 管理凭据.txt，跳过编辑器登录验证。');
  console.log('\n前序检查项: ' + notes.length + '，失败: ' + failures.length);
  process.exit(failures.length ? 1 : 0);
}
const cred = fs.readFileSync(credPath, 'utf8');
const mPass = /口令[:：]\s*(\S+)/.exec(cred);
const mUser = /账户[:：]\s*(\S+)/.exec(cred);
d4.getElementById('gateUser').value = mUser[1];
d4.getElementById('gatePass').value = mPass[1];
d4.getElementById('gateForm').dispatchEvent(new w4.Event('submit', { bubbles: true, cancelable: true }));
ok(d4.getElementById('app').hidden === false, '正确凭据可以进入编辑器');
ok(d4.getElementById('gate').hidden === true, '登录后登录门隐藏');

// 切到外观页，检查风格选择器
const themeTab = [...d4.querySelectorAll('[data-tab]')].find(b => b.getAttribute('data-tab') === 'theme');
themeTab.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
const skinCells = d4.querySelectorAll('[data-pick-skin]');
ok(skinCells.length === w4.SITE_THEMES.list.length, `外观页列出 ${skinCells.length} 套风格`);
ok(d4.querySelectorAll('[data-swatch]').length === 2, '外观页有主色预览块');

// 点一个风格，检查草稿被改
skinCells[1].dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
ok(d4.querySelector('[data-pick-skin="' + w4.SITE_THEMES.list[1].id + '"]').classList.contains('is-active'),
   '选中风格高亮切换正确');
ok(d4.getElementById('draftState').textContent.includes('未发布'), '改动后标记为未发布');

// 基础页应有头像控件
const basicTab = [...d4.querySelectorAll('[data-tab]')].find(b => b.getAttribute('data-tab') === 'basic');
basicTab.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
ok(!!d4.querySelector('[data-avatar-preview]'), '基础页有头像预览');
ok(!!d4.querySelector('[data-avatar-up]'), '基础页有上传按钮');
ok(!!d4.querySelector('[data-avatar-file]'), '基础页有文件选择器');
ok(!!d4.querySelector('[data-path="site.avatar"]'), '基础页可填头像网址');

console.log(notes.join('\n'));
console.log('\n检查项: ' + notes.length + '，失败: ' + failures.length);
if (failures.length) { console.log('\n失败明细:\n' + failures.join('\n')); process.exit(1); }
console.log('\n全部通过（jsdom 真实 DOM）');
