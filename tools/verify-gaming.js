/* ==========================================================================
 *  游戏模块 + 章节衔接验证：node tools/verify-gaming.js
 * --------------------------------------------------------------------------
 *  重点检查三件容易出错的事：
 *    1. 加了 6 张游戏卡后，那一页是否还装得进一屏（否则「锁定单屏」破功）
 *    2. 横向滑动游戏卡片时，会不会误触发竖向翻页
 *    3. 章节入场动画只作用于「刚翻到的那一页」，且会自动清理
 *       —— 这里曾经出过真 bug：平滑滚动途经中间页，多页同时挂动画
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cfgSrc = fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8');
const renderSrc = fs.readFileSync(path.join(ROOT, 'assets/js/render.js'), 'utf8');
const pagedSrc = fs.readFileSync(path.join(ROOT, 'assets/js/paged.js'), 'utf8');
const pagedCss = fs.readFileSync(path.join(ROOT, 'assets/css/paged.css'), 'utf8');
const gameCss = fs.readFileSync(path.join(ROOT, 'assets/css/gaming.css'), 'utf8');

/* ------------------------------------------------ 1. 静态接线与结构 */
ok(html.includes('assets/css/gaming.css'), 'index.html 引入 gaming.css');
ok(html.includes('id="gaming"') && html.includes('data-section="gaming"'), '页面含游戏区块');
ok(html.includes('id="gameRail"'), '页面含横向轨道容器');
ok(/renderGaming/.test(renderSrc), 'render.js 有 renderGaming');
ok(/renderGaming\(\);/.test(renderSrc), 'renderGaming 已在 init 中调用');

/* ---- 配置结构 ---- */
const c = { window: null, console };
c.window = c;
vm.createContext(c);
vm.runInContext(cfgSrc, c);
const C = c.SITE_CONFIG;
const games = C.gaming && C.gaming.items;

ok(Array.isArray(games), 'config 含 gaming.items');
ok(games.length === 6, '内置 6 个游戏（实际 ' + games.length + '）');
ok(!!C.sections.gaming, 'sections 里注册了 gaming');

const FIELDS = ['icon', 'name', 'uidLabel', 'uid', 'server', 'rank', 'color', 'stats', 'note'];
games.forEach(g => {
  ok(typeof g.name === 'string' && g.name.length > 0, g.name + ': 有游戏名');
  ok(typeof g.uid === 'string' && g.uid.length > 0, g.name + ': 有可复制的 ID');
  ok(Array.isArray(g.stats) && g.stats.length >= 1, g.name + ': 有可展现资产');
  ok(g.stats.every(s => s.label && s.value !== undefined), g.name + ': 资产每项都有名称与内容');
  ok(!g.color || /^#[0-9a-f]{3,8}$/i.test(g.color), g.name + ': 品牌色合法');
});
// 六款游戏都在
['明日方舟', '无畏契约', 'Apex', 'DJMAX', 'Phigros', '中二节奏'].forEach(name => {
  ok(games.some(g => g.name.indexOf(name) >= 0), '配置含「' + name + '」');
});

/* 顺序：游戏排在喜好之后、业务之前。
   注意这条断言跟着「配置里的 order」走 —— 章节顺序是用户可改的内容，
   不是硬编码规则。断言意图（游戏夹在喜好与业务之间）比断言具体序列更稳。 */
const order = Object.keys(C.sections)
  .filter(k => C.sections[k].enabled !== false)
  .sort((a, b) => C.sections[a].order - C.sections[b].order);
ok(order.indexOf('gaming') === order.indexOf('interests') + 1 &&
   order.indexOf('gaming') === order.indexOf('services') - 1,
   '章节顺序为 喜好 → 游戏 → 业务（' + order.join(' → ') + '）');

/* ------------------------------------------------ 2. CSS 关键约束 */
ok(/\.game-rail\s*\{[\s\S]{0,320}scroll-snap-type:\s*x mandatory/.test(gameCss),
   '轨道用横向吸附');
ok(/overscroll-behavior-x:\s*contain/.test(gameCss),
   '设了 overscroll-behavior-x，横滑不会触发浏览器后退');
ok(/\.game-rail > \.game\s*\{[\s\S]{0,120}flex:\s*0 0/.test(gameCss),
   '卡片定宽（不会因内容撑高）');
ok(/is-static/.test(gameCss), '少于 2 张时退回普通栅格');
ok(/@supports not \(background: color-mix/.test(gameCss),
   'color-mix 不支持时有退回方案');

/* 章节动画 */
ok(/@keyframes chapter-item/.test(pagedCss), '有章节入场关键帧');
ok(/\.section\.is-entering > \.container > \*/.test(pagedCss), '入场作用在页面直接子元素');
ok(/nth-child\(2\)/.test(pagedCss) && /nth-child\(3\)/.test(pagedCss), '子元素有错开延迟');
ok(/\.page-hint/.test(pagedCss), '有首次翻页提示样式');
const rmBlock2 = pagedCss.slice(pagedCss.indexOf('prefers-reduced-motion: reduce'));
ok(/\.section\.is-entering/.test(rmBlock2) && /animation:\s*none/.test(rmBlock2),
   '减少动效时章节动画被关掉');

/* ------------------------------------------- 3. 动画调度的逻辑（假 DOM） */
/* 关键：验证「停稳后才播」「只作用于当前页」「会清理」 */
function makePaged(opts = {}) {
  const pages = [];
  const mk = (id) => {
    const el = {
      id, attrs: { id }, hidden: false, offsetHeight: 900, offsetTop: 0,
      style: { minHeight: '', alignItems: '', transform: '' },
      _classes: new Set(),
      classList: {
        add: k => el._classes.add(k),
        remove: k => el._classes.delete(k),
        toggle: (k, f) => { if (f === undefined) f = !el._classes.has(k); f ? el._classes.add(k) : el._classes.delete(k); },
        contains: k => el._classes.has(k)
      },
      getAttribute: k => (k in el.attrs ? el.attrs[k] : null),
      setAttribute: (k, v) => { el.attrs[k] = String(v); },
      removeAttribute: k => { delete el.attrs[k]; },
      hasAttribute: k => k in el.attrs,
      matches: () => true,
      querySelector: () => null,
      querySelectorAll: () => [],
      appendChild(c) { (el._kids = el._kids || []).push(c); return c; },
      addEventListener() {},
      getBoundingClientRect() { return { top: 0, left: 0, width: 1200, height: el.offsetHeight }; }
    };
    return el;
  };
  const hero = mk('top');
  const s1 = mk('about'); s1.attrs['data-section'] = 'about';
  const s2 = mk('services'); s2.attrs['data-section'] = 'services';
  pages.push(s1, s2);

  const list = { innerHTML: '', appendChild() {}, _children: [] };
  const pager = mk('pager');
  const track = { innerHTML: '', appendChild() {} };

  const doc = {
    readyState: 'complete',
    documentElement: {
      dataset: {}, style: { setProperty() {}, getPropertyValue: () => '72px' },
      offsetHeight: 900
    },
    getElementById(id) {
      if (id === 'top') return hero;
      if (id === 'pagerList') return list;
      if (id === 'pager') return pager;
      if (id === 'pagerTrack') return track;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.section') return pages;
      if (sel === '.page-sweep') return { classList: { add() {}, remove() {} }, offsetWidth: 1 };
      return [];
    },
    querySelector: () => null,
    createElement: () => (mk('made')),
    addEventListener() {},
    body: { appendChild() {}, removeChild() {} }
  };

  let rafQ = [];
  const timers = [];
  const ctx = {
    window: null,
    document: doc,
    console: { log() {}, warn() {}, error(...a) { fails.push('console.error: ' + a.join(' ')); } },
    matchMedia: q => ({
      matches: !!opts.reduced && q.indexOf('reduced') >= 0,
      addEventListener() {}, addListener() {}
    }),
    requestAnimationFrame: fn => { rafQ.push(fn); return rafQ.length; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    setInterval: () => 0, clearInterval() {},
    getComputedStyle: () => ({ getPropertyValue: () => '72px' }),
    innerHeight: 900, innerWidth: 1200,
    scrollY: 0, pageYOffset: 0,
    scrollTo() {},
    addEventListener() {},
    sessionStorage: { getItem: () => null, setItem() {} },
    location: { protocol: 'https:' },
    Promise, String, Array, Object, Math, Number, JSON, Date, RegExp, Error, Boolean,
    parseInt, parseFloat, isNaN
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(cfgSrc, ctx);
  vm.runInContext(pagedSrc, ctx, { filename: 'paged.js' });
  ctx.SITE_PAGED.init();
  return { ctx, pages: [hero, ...pages], timers };
}

const A = makePaged();
ok(typeof A.ctx.SITE_PAGED === 'object', 'paged.js 在假 DOM 中可初始化');
/* 首帧不应有任何页带 is-entering */
ok(A.pages.every(p => !p._classes.has('is-entering')), '首帧没有页面处于入场状态');

/* 翻页后：停稳计时器应被安排，且只给当前页加入场 */
A.ctx.SITE_PAGED.goTo(2);
ok(A.pages.filter(p => p._classes.has('is-entering')).length <= 1,
   '翻页瞬间最多只有一页处于入场状态（防止多页打架）');

/* 触发调度：执行 pending 的 setTimeout（模拟「停稳」） */
const pending = A.timers.filter(t => t.fn && t.ms <= 200);
pending.forEach(t => { const f = t.fn; t.fn = null; f(); });
ok(A.pages.filter(p => p._classes.has('is-entering')).length <= 1,
   '停稳后仍只有一页带入场标记');

/* 减少动效：不应加入场 */
const R = makePaged({ reduced: true });
R.ctx.SITE_PAGED.goTo(2);
R.timers.filter(t => t.fn && t.ms <= 200).forEach(t => { const f = t.fn; t.fn = null; f(); });
ok(R.pages.every(p => !p._classes.has('is-entering')),
   '减少动效时不播入场动画');

/* ------------------------------------------- 4. 浏览器验证（有则跑） */
let chromium;
try { chromium = require('playwright-core').chromium; } catch (e) { chromium = null; }

async function browserChecks() {
  if (!chromium) {
    notes.push('--  未安装 playwright-core，跳过浏览器端校验');
    return;
  }
  const URL = 'http://127.0.0.1:8791/';
  const browser = await chromium.launch();
  const VIEWPORTS = [
    { n: '桌面', w: 1440, h: 900 },
    { n: '平板', w: 820, h: 1180 },
    { n: '手机', w: 390, h: 844 }
  ];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: vp.w <= 900, isMobile: vp.w <= 900,
      permissions: ['clipboard-read', 'clipboard-write']
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);
    const tag = '[' + vp.n + '] ';

    /* 一屏约束 */
    const layout = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.hero, .section')];
      const g = document.getElementById('gaming');
      const rail = document.getElementById('gameRail');
      const cards = [...rail.querySelectorAll('.game')];
      return {
        count: pages.length,
        snap: document.documentElement.dataset.snap,
        tall: pages.filter(p => p.getAttribute('data-tall')).map(p => p.id),
        allFit: pages.every(p => p.offsetHeight <= innerHeight + 2),
        gamingFit: g.offsetHeight <= innerHeight + 2,
        railFlex: getComputedStyle(cards[0]).flex,
        railOverflow: getComputedStyle(rail).overflowX,
        railSnap: getComputedStyle(rail).scrollSnapType,
        scrollable: rail.scrollWidth > rail.clientWidth + 4,
        cardW: Math.round(cards[0].getBoundingClientRect().width),
        railH: Math.round(rail.getBoundingClientRect().height),
        slack: Math.round(g.getBoundingClientRect().bottom - rail.getBoundingClientRect().bottom)
      };
    });

    ok(layout.count === 6, tag + '共 6 章（含游戏）');
    ok(layout.tall.length === 0, tag + '没有页面被迫放弃吸附' + (layout.tall.length ? '（' + layout.tall + '）' : ''));
    ok(layout.allFit, tag + '每页都在一屏内');
    ok(layout.gamingFit, tag + '游戏页在一屏内');
    ok(layout.railOverflow === 'auto', tag + '游戏轨道可横滑');
    ok(/x mandatory/.test(layout.railSnap), tag + '游戏轨道横向吸附（' + layout.railSnap + '）');
    ok(layout.scrollable, tag + '6 张卡片确实超出可视宽度');
    ok(layout.slack > 0, tag + '游戏页仍有余量（' + layout.slack + 'px）');
    ok(layout.cardW >= 200, tag + '卡片宽度可用（' + layout.cardW + 'px）');

    /* 跳到游戏页 */
    await page.evaluate(() => {
      const dots = [...document.querySelectorAll('.pager__dot')];
      dots[3].click();
    });
    await page.waitForTimeout(1500);

    const onGame = await page.evaluate(() => {
      const dots = [...document.querySelectorAll('.pager__dot')];
      const i = dots.findIndex(d => d.classList.contains('is-current'));
      const pages = [...document.querySelectorAll('.hero, .section')];
      return { i, id: pages[i] && pages[i].id, label: dots[3].getAttribute('aria-label') };
    });
    ok(onGame.id === 'gaming', tag + '点第 4 个页码到达游戏页（' + onGame.id + '）');
    ok(/游戏/.test(onGame.label || ''), tag + '页码标签是「游戏」（' + onGame.label + '）');

    /* 复制 ID */
    const copied = await page.evaluate(async () => {
      const btn = document.querySelector('.game__uid');
      const want = btn.getAttribute('data-copy');
      btn.click();
      await new Promise(r => setTimeout(r, 260));
      let got = null;
      try { got = await navigator.clipboard.readText(); } catch (e) { got = '(读不到)'; }
      return { want, got, toast: document.getElementById('toast').classList.contains('is-visible') };
    });
    ok(copied.want === copied.got, tag + '点 ID 复制到剪贴板（' + copied.got + '）');
    ok(copied.toast, tag + '复制后出现提示');

    /* 横滑不改变竖向页码 */
    const beforeIdx = await page.evaluate(() =>
      [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current')));
    const railMoved = await page.evaluate(() => {
      const rail = document.getElementById('gameRail');
      const before = rail.scrollLeft;
      rail.scrollBy({ left: 420, behavior: 'instant' });
      return { before, after: rail.scrollLeft };
    });
    await page.waitForTimeout(600);
    const afterIdx = await page.evaluate(() =>
      [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current')));
    ok(railMoved.after > railMoved.before, tag + '横滑确实移动了轨道（' + Math.round(railMoved.before) + '→' + Math.round(railMoved.after) + '）');
    ok(beforeIdx === afterIdx, tag + '横滑没有误触发竖向翻页（页码 ' + beforeIdx + ' 保持不变）');

    /* 章节入场：只一页、且会清理 */
    await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.hero, .section')];
      pages.forEach(p => p.classList.remove('is-entering'));
      document.querySelectorAll('.pager__dot')[5].click();
    });
    /* 平滑滚动 + 停稳判定需要时间，轮询等入场标记出现（最多 1.6s） */
    await page.waitForFunction(() => {
      const pages = [...document.querySelectorAll('.hero, .section')];
      const i = [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current'));
      return pages[i] && pages[i].classList.contains('is-entering');
    }, null, { timeout: 2500 }).catch(() => {});
    const during = await page.evaluate(() => ({
      n: document.querySelectorAll('.is-entering').length,
      onActive: (() => {
        const pages = [...document.querySelectorAll('.hero, .section')];
        const i = [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current'));
        return pages[i] && pages[i].classList.contains('is-entering');
      })(),
      animName: (() => {
        const pages = [...document.querySelectorAll('.hero, .section')];
        const i = [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current'));
        const first = pages[i] && pages[i].querySelector('.container > *');
        return first ? getComputedStyle(first).animationName : '-';
      })()
    }));
    ok(during.n <= 1, tag + '入场动画同时只有 1 页（实际 ' + during.n + '）');
    ok(during.onActive, tag + '入场动画落在当前页');
    ok(during.animName === 'chapter-item', tag + '用的是章节入场关键帧（' + during.animName + '）');

    await page.waitForFunction(
      () => document.querySelectorAll('.is-entering').length === 0,
      null, { timeout: 3000 }
    ).catch(() => {});
    const after = await page.evaluate(() => document.querySelectorAll('.is-entering').length);
    ok(after === 0, tag + '入场动画结束后自动清理（残留 ' + after + '）');

    if (errs.length) fails.push(tag + '控制台错误: ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  /* 减少动效：不播入场、不出提示 */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const h = document.getElementById('pageHint');
      return { hintShown: h.classList.contains('is-shown'), hintDisplay: getComputedStyle(h).display };
    });
    ok(!r.hintShown && r.hintDisplay === 'none', '[reduced-motion] 不出现翻页提示');

    await page.evaluate(() => document.querySelectorAll('.pager__dot')[3].click());
    await page.waitForTimeout(900);
    ok(await page.evaluate(() => document.querySelectorAll('.is-entering').length) === 0,
       '[reduced-motion] 不播章节入场动画');
    await ctx.close();
  }

  /* 首次提示：出现一次，动一下就收 */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    ok(await page.evaluate(() => document.getElementById('pageHint').classList.contains('is-shown')),
       '[提示] 首次进入显示翻页提示');
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => !document.getElementById('pageHint').classList.contains('is-shown')),
       '[提示] 滚动后自动收起');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    ok(await page.evaluate(() => !document.getElementById('pageHint').classList.contains('is-shown')),
       '[提示] 同会话不再重复出现');
    await ctx.close();
  }

  /* 编辑器：游戏页能改、pairs 能解析 */
  {
    const credPath = path.join(ROOT, '..', '管理凭据.txt');
    if (!fs.existsSync(credPath)) {
      notes.push('--  未找到仓库外凭据，跳过编辑器校验');
      await browser.close();
      return;
    }
    const cred = fs.readFileSync(credPath, 'utf8');
    const user = /账户[:：]\s*(\S+)/.exec(cred)[1];
    const pass = /口令[:：]\s*(\S+)/.exec(cred)[1];

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(URL.replace(/\/$/, '') + '/admin.html', { waitUntil: 'networkidle' });
    await page.fill('#gateUser', user);
    await page.fill('#gatePass', pass);
    await page.click('.gate__btn');
    await page.waitForTimeout(600);
    ok(await page.evaluate(() => !document.getElementById('app').hidden), '[编辑器] 登录成功');

    await page.click('[data-tab="gaming"]');
    await page.waitForTimeout(300);
    const ed = await page.evaluate(() => {
      const items = document.querySelectorAll('#panel .item');
      const pairArea = document.querySelector('#panel textarea[data-pairs="1"]');
      const uidInput = document.querySelector('#panel input[data-f="uid"]');
      return {
        items: items.length,
        pairCount: document.querySelectorAll('#panel textarea[data-pairs="1"]').length,
        pairValue: pairArea ? pairArea.value.split('\n').slice(0, 2) : [],
        uidValue: uidInput ? uidInput.value : null,
        hasColor: !!document.querySelector('#panel input[data-f="color"]')
      };
    });
    ok(ed.items === 6, '[编辑器] 列出 6 张游戏卡（实际 ' + ed.items + '）');
    ok(ed.pairCount === 6, '[编辑器] 每张卡都有「可展现资产」输入框');
    ok(ed.pairValue.length >= 2 && /:/.test(ed.pairValue[0]),
       '[编辑器] 资产以「名称: 内容」形式呈现（' + JSON.stringify(ed.pairValue[0]) + '）');
    ok(!!ed.uidValue, '[编辑器] 可编辑 ID（当前 ' + ed.uidValue + '）');
    ok(ed.hasColor, '[编辑器] 可编辑品牌色');

    /* 改一个值，确认草稿同步 */
    const typed = await page.evaluate(async () => {
      const area = document.querySelector('#panel textarea[data-pairs="1"]');
      area.value = '测试项: 123\n第二项: 456';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      return {
        dirty: document.getElementById('draftState').textContent.includes('未发布')
      };
    });
    ok(typed.dirty, '[编辑器] 修改资产后标记为未发布');

    /* 用序列化函数确认 pairs 已被解析成结构化数组 */
    const parsed = await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('zotrod-draft-v1') || 'null');
      const st = draft && draft.gaming && draft.gaming.items && draft.gaming.items[0].stats;
      return Array.isArray(st) ? st.slice(0, 2) : null;
    });
    ok(parsed && parsed.length === 2 && parsed[0].label === '测试项' && parsed[0].value === '123',
       '[编辑器] 「名称: 内容」已解析为 {label,value}（' + JSON.stringify(parsed && parsed[0]) + '）');

    await ctx.close();
  }

  await browser.close();
}

browserChecks().then(() => {
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
}).catch(e => {
  console.log(notes.join('\n'));
  console.log('\n运行中断: ' + e.message);
  process.exit(1);
});
