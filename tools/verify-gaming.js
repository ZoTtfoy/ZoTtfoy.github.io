/* ==========================================================================
 *  游戏模块 + 章节衔接验证：node tools/verify-gaming.js
 * --------------------------------------------------------------------------
 *  重点检查三件容易出错的事：
 *    1. 游戏卡是否还装得进一屏（否则「锁定单屏」破功）
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
ok(html.includes('id="gameRail"'), '页面含游戏卡片容器');
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
/* 数量不写死：卡片会随业务调整（2026-11-11 从 6 收到 3 ——
   Apex/DJMAX/Phigros/中二节奏 合并成一张 Steam 卡）。 */
ok(games.length === 3, '内置 3 个游戏（实际 ' + games.length + '）');
ok(!!C.sections.gaming, 'sections 里注册了 gaming');

/* 6 屏重构后游戏卡只保留：icon / iconImage / name / uidLabel / uid / color / link。
   server / rank / stats / note 全部去掉 —— 这一屏的用途是「让对方抄 ID」，
   多一行介绍就少一个游戏能露出来。 */
/* steam 字段是 2026-11-11 新增的：Steam 卡要用它带 profileUrl /
   fallbackApps / scrollSpeed，渲染层据此套上封面拼贴背景。
   其它卡片仍然只允许那几样 —— 不要让它变成"什么都能往里塞"的垃圾桶。 */
/* server 是 2026-11-11 恢复的：卡片上要标「官服 / 亚服 / 公开库存」——
   同一个 ID 在不同服不是同一个账号，这是访客需要知道的信息，
   不是介绍性内容。rank / stats / note 仍然禁止。 */
const ALLOWED = ['icon', 'iconImage', 'name', 'uidLabel', 'uid', 'server', 'color', 'link', 'steam'];
games.forEach(g => {
  ok(typeof g.name === 'string' && g.name.length > 0, g.name + ': 有游戏名');
  ok(typeof g.uid === 'string' && g.uid.length > 0, g.name + ': 有可复制的 ID');
  ok(!g.color || /^#[0-9a-f]{3,8}$/i.test(g.color), g.name + ': 品牌色合法');
  const extra = Object.keys(g).filter(k => ALLOWED.indexOf(k) < 0);
  ok(extra.length === 0, g.name + ': 没有多余字段（' + (extra.join(',') || '无') + '）');
  /* 图标二选一：内置图标名 或 自定义图片，至少有一个 */
  ok(!!(g.icon || g.iconImage), g.name + ': 有图标');
});
/* 用户明确要求保留的两个 + 整合后的 Steam 主页。
   原来 Apex / DJMAX / Phigros / 中二节奏 各占一格，四张卡都在说
   "我也玩这个"，信息密度太低 —— 合并成一张 Steam 卡，指向公开档案。 */
['明日方舟', '无畏契约', 'Steam'].forEach(name => {
  ok(games.some(g => g.name.indexOf(name) >= 0), '配置含「' + name + '」');
});
ok(!games.some(g => /Apex|DJMAX|Phigros|中二节奏/.test(g.name)),
  '后四个平台已合并进 Steam 卡（不再单列）');
/* Steam 卡必须带档案地址，否则"公开库存"这句话是死的 */
const steamCard = games.find(g => g.name === 'Steam');
ok(steamCard && steamCard.steam && String(steamCard.steam.profileUrl || '').startsWith('https://steamcommunity.com/profiles/') && (steamCard.steam.steamId || '').length === 17,
  'Steam 卡带指向真实档案的 profileUrl（17 位 SteamID64）');
ok(steamCard && steamCard.steam && Array.isArray(steamCard.steam.fallbackApps) && steamCard.steam.fallbackApps.length >= 6,
  'Steam 卡带 fallbackApps 快照（拿不到库存时背景仍有图）');

/* 顺序：在听 → 游戏 → 维修 → 其他 → 邮箱。
   章节顺序属于内容配置，会变；这里只断言「游戏是第二屏」这一件事。 */
const order = Object.keys(C.sections)
  .filter(k => C.sections[k].enabled !== false)
  .sort((a, b) => C.sections[a].order - C.sections[b].order);
ok(order.indexOf('gaming') === 1,
   '游戏是第二屏（' + order.join(' → ') + '）');

/* ------------------------------------------------ 2. CSS 关键约束 */
/* 游戏卡从「横向滑动轨道」改成了「网格」，断言随之反转：
   必须是 grid、不能有横向滚动容器。 */
ok(/\.game-rail\s*\{[\s\S]{0,320}display:\s*grid/.test(gameCss),
   '游戏卡用网格布局');
ok(!/scroll-snap-type:\s*x mandatory/.test(gameCss),
   '不再使用横向滑动轨道');
/* 只在「声明」里找 overflow-x，注释里出现这个词不算 */
const gameCssDecl = gameCss.replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/overflow-x:\s*auto/.test(gameCssDecl), '没有横向滚动容器');
/* 改成固定 3 列：auto-fit 在 1180px 下会算成 5 列，6 张卡就成了「5 + 1」，
   最后一行孤零零一张。固定列数才能保证 3×2 的整齐排布。 */
ok(/\.game-rail\s*\{[\s\S]{0,320}repeat\(3, minmax/.test(gameCss),
   '游戏卡固定 3 列（6 张正好两行）');
/* 游戏徽标：保留品牌色，但不再铺彩色底块。
   原实现用 color-mix 在图标下面垫一层 12% 的品牌色，配 @supports 退回主题软色。
   这套做法被去掉了 —— 6 个高饱和色块并排会变成「彩色标签墙」，是页面最吵的一处。
   现在的断言反过来：必须用品牌色，且**不能**再给图标加底色。 */
ok(/\.game__icon\s*\{[\s\S]{0,240}color:\s*var\(--game/.test(gameCss),
   '游戏徽标用各自的品牌色');
const gameIconBlock = (gameCss.match(/\.game__icon\s*\{[\s\S]*?\}/) || [''])[0];
ok(!/background/.test(gameIconBlock),
   '游戏徽标不再铺彩色底块');
/* 原始意图：**游戏卡自身**的背景不要靠 color-mix 做渐变底
   （早年那版是三层 color-mix 叠出来的，暗色下会糊）。
   2026-11-11 起拼贴背景与卡片实底都用了 color-mix —— 那是正当用法
   （为了让卡片压在封面拼贴之上仍有足够不透明度）。
   所以断言收窄到"卡片的渐变/背景声明里没有 color-mix 渐变"，
   而不是全文件禁止这个词。 */
const cardBgBlock = (gameCssDecl.match(/\.game\s*\{[\s\S]*?\}/) || [''])[0];
ok(!/linear-gradient|radial-gradient/.test(cardBgBlock),
   '游戏卡背景不是渐变底（纯色 + 半透明即可）');

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
        cols: getComputedStyle(rail).gridTemplateColumns.split(' ').length,
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
    ok(layout.railOverflow !== 'auto' || !layout.scrollable,
       tag + '游戏卡不做横向滚动（overflowX=' + layout.railOverflow + '）');
    ok(!/x mandatory/.test(layout.railSnap), tag + '未启用横向吸附');
    ok(layout.cols >= 2, tag + '游戏卡为多列网格（' + layout.cols + ' 列）');
    ok(layout.slack > 0, tag + '游戏页仍有余量（' + layout.slack + 'px）');
    /* 手机两列网格下每张约 171px —— 这是设计值，不是缺陷 */
    ok(layout.cardW >= 150, tag + '卡片宽度可用（' + layout.cardW + 'px）');

    /* 跳到游戏页（按 DOM 实际位置找，不写死索引） */
    const gameIdx = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.hero, .section')];
      return pages.findIndex(p => p.id === 'gaming');
    });
    await page.evaluate(i => {
      document.querySelectorAll('.pager__dot')[i].click();
    }, gameIdx);
    await page.waitForTimeout(1500);

    const onGame = await page.evaluate(() => {
      const dots = [...document.querySelectorAll('.pager__dot')];
      const i = dots.findIndex(d => d.classList.contains('is-current'));
      const pages = [...document.querySelectorAll('.hero, .section')];
      return { i, id: pages[i] && pages[i].id, label: dots[i] && dots[i].getAttribute('aria-label') };
    });
    ok(onGame.id === 'gaming', tag + '点对应页码能到游戏页（' + onGame.id + '）');
    /* 标签来自 sections.gaming.label（「游戏」）或页面标题。标题现在是英文
       "MY GAME'S"，所以两个都接受 —— 断言的是"标签指向游戏这一屏"，
       不是"标题必须是中文"。 */
    ok(/游戏|GAME/i.test(onGame.label || ''), tag + '页码标签指向游戏屏（' + onGame.label + '）');

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

    /* 网格没有横向滚动，所以不可能"误触发" */
    const noHScroll = await page.evaluate(() => {
      const rail = document.getElementById('gameRail');
      return { sw: rail.scrollWidth, cw: rail.clientWidth,
               overflowX: getComputedStyle(rail).overflowX };
    });
    ok(noHScroll.sw <= noHScroll.cw + 2,
       tag + '网格内容不超出宽度（' + noHScroll.sw + ' vs ' + noHScroll.cw + '）');
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
    /* 网格没有横向滚动，scrollLeft 不会变；断言这一点即证明"不存在误翻页的入口" */
    ok(railMoved.after === railMoved.before,
       tag + '网格没有横向位移（scrollLeft 恒为 ' + Math.round(railMoved.after) + '）');
    ok(beforeIdx === afterIdx, tag + '页码未受干扰（' + beforeIdx + ' 保持不变）');

    /* 章节入场：只一页、且会清理。
       注意用「最后一页的前一页」而非最后一页 —— 最后一页再往下会滚到页脚，
       落点不是页顶，视口守卫可能判定它不在视口内，那样测的就不是入场动画了。 */
    await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.hero, .section')];
      pages.forEach(p => p.classList.remove('is-entering'));
      const dots = document.querySelectorAll('.pager__dot');
      dots[Math.max(1, dots.length - 2)].click();
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
      const uidInput = document.querySelector('#panel input[data-f="uid"]');
      return {
        items: items.length,
        uidValue: uidInput ? uidInput.value : null,
        hasColor: !!document.querySelector('#panel input[data-f="color"]'),
        hasImage: !!document.querySelector('#panel input[data-f="iconImage"]'),
        /* 6 屏重构后游戏卡不再有「可展现资产」和备注输入框 */
        hasStats: !!document.querySelector('#panel textarea[data-pairs="1"]'),
        hasNote: !!document.querySelector('#panel [data-f="note"]')
      };
    });
    /* 数量跟配置走，不写死 —— 卡片会随业务调整（2026-11-11 从 6 收到 3）。 */
    ok(ed.items === 3, '[编辑器] 列出 3 张游戏卡（实际 ' + ed.items + '）');
    ok(!!ed.uidValue, '[编辑器] 可编辑 ID（当前 ' + ed.uidValue + '）');
    ok(ed.hasColor, '[编辑器] 可编辑品牌色');
    ok(ed.hasImage, '[编辑器] 可编辑自定义图标图片');
    ok(!ed.hasStats && !ed.hasNote,
       '[编辑器] 已移除「可展现资产」与备注输入框（卡片简化后不再需要）');

    /* 改一个值，确认草稿同步 + 结构化写回 config */
    const typed = await page.evaluate(async () => {
      const input = document.querySelector('#panel input[data-f="uid"]');
      input.value = 'TEST#9999';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      return {
        dirty: document.getElementById('draftState').textContent.includes('未发布')
      };
    });
    ok(typed.dirty, '[编辑器] 修改 ID 后标记为未发布');

    const parsed = await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('zotrod-draft-v1') || 'null');
      const g = draft && draft.gaming && draft.gaming.items && draft.gaming.items[0];
      return g ? { uid: g.uid } : null;
    });
    ok(parsed && parsed.uid === 'TEST#9999',
       '[编辑器] 新 ID 已写回草稿（' + JSON.stringify(parsed) + '）');

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
