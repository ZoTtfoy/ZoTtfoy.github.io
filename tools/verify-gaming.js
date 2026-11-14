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
/* 渲染层已按屏拆到 core/ + sections/；静态断言读的是拼起来的整份源码。 */
const renderSrc = require('./lib/render-src').renderSource();
const pagedSrc = fs.readFileSync(path.join(ROOT, 'assets/js/paged.js'), 'utf8');
const pagedCss = fs.readFileSync(path.join(ROOT, 'assets/css/10-shell/paged.css'), 'utf8');
const gameCss = fs.readFileSync(path.join(ROOT, 'assets/css/30-sections/gaming.css'), 'utf8');

/* ------------------------------------------------ 1. 静态接线与结构 */
ok(html.includes('assets/css/30-sections/gaming.css'), 'index.html 引入 gaming.css');
ok(html.includes('id="gaming"') && html.includes('data-section="gaming"'), '页面含游戏区块');
ok(html.includes('id="gameRail"'), '页面含游戏卡片容器');
ok(/renderGaming/.test(renderSrc), 'render.js 有 renderGaming');
/* 渲染改成块表之后不再有直调语句 —— 断言"已注册进块表且带 fn"，
   比守一句 `renderGaming();` 更贴近现在的结构，也不怕再改调用方式。 */
ok(/\{\s*name:\s*"gaming"[^}]*fn:\s*renderGaming/.test(renderSrc),
   'renderGaming 已注册进渲染块表');

/* ---- 配置结构 ---- */
const c = { window: null, console };
c.window = c;
vm.createContext(c);
const iconsSrc = fs.readFileSync(path.join(ROOT, 'assets/js/icons.js'), 'utf8');
vm.runInContext(cfgSrc, c);
const C = c.SITE_CONFIG;
const games = C.gaming && C.gaming.items;
/* 图标库也载进同一个上下文，后面要查路径 */
vm.runInContext(iconsSrc, c);

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
/* hidden：这一项"配置着但先不上屏"（明日方舟 / 无畏契约，见 config.js）。
   它不是内容字段，是开关 —— 所以列进白名单，且下线项不参与下面的内容断言。 */
const ALLOWED = ['icon', 'iconImage', 'name', 'uidLabel', 'uid', 'server', 'color', 'link', 'steam', 'hidden'];
games.filter(g => !g.hidden).forEach(g => {
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

/* 顺序（2026-11-11 用户明确要求）：Steam 在最前，然后明日方舟、无畏契约。
   顺序写进断言是因为它属于"用户点的菜"，不是随手排的 —— 改回去要有人提醒。 */
ok(games.map(g => g.name).join(',') === 'Steam,明日方舟,无畏契约',
  '卡片顺序：Steam → 明日方舟 → 无畏契约（实际 ' + games.map(g => g.name).join(' → ') + '）');

/* 图标必须是作品官方的标识，而不是通用线性图标。
   steam/valorant 来自 Simple Icons（CC0）；rhodes 是方舟印章里的「车」徽记。
   断言到"路径存在且有实心填充"，防止有人图省事换回 tower/crosshair。 */
[['Steam', 'steam'], ['明日方舟', 'rhodes'], ['无畏契约', 'valorant']].forEach(([name, icon]) => {
  const g = games.find(x => x.name === name);
  ok(g && g.icon === icon, name + ' 用官方标识图标（' + (g && g.icon) + '）');
  /* 图标库跑在同一个 vm 上下文里（c.window = c），不能用宿主 window */
  const iconLib = c.SITE_ICONS || {};
  const path = iconLib[icon];
  ok(typeof path === 'string' && path.indexOf('<path') === 0 &&
     /fill="currentColor"/.test(path) && /stroke="none"/.test(path),
    name + ' 的图标是实心路径（不用描边，小尺寸下才不会糊）');
});
/* Steam 卡必须带档案地址 —— 底部那个按钮的 href 就是它。
   2026-11-13 起改用自定网址（/id/<name>），与 /profiles/<17位ID> 等价，
   两种形式都接受；但必须指向 steamcommunity.com。 */
/* 不用正则：heredoc / 多层转义很容易把 \\/ 写坏，这里纯字符串判断。
   接受两种等价形式：/profiles/<17位数字> 与 /id/<自定名>。 */
function isSteamProfile(u) {
  if (typeof u !== 'string' || u.indexOf('https://steamcommunity.com/') !== 0) return false;
  const tail = u.slice('https://steamcommunity.com'.length).replace(/\/+$/, '');
  return /^\/profiles\/\d{17}$/.test(tail) || /^\/id\/[A-Za-z0-9_-]+$/.test(tail);
}
const steamCard = games.find(g => g.name === 'Steam');
ok(isSteamProfile(steamCard && steamCard.steam && steamCard.steam.profileUrl),
  'Steam 卡的 profileUrl 指向真实档案（/profiles/<17位> 或 /id/<自定名>）');
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
/* Q3 从「6 张卡片的网格」改成了「一块可滚动的战绩板」（参照小黑盒个人主页）：
   整块一个链接 → 顶栏 + 三格汇总 + 可滚动列表。
   所以断言换成新结构的不变量，而不是继续守一张已经不存在的 .game-rail。 */
ok(!/scroll-snap-type:\s*x mandatory/.test(gameCss),
   '不再使用横向滑动轨道');
/* 只在「声明」里找 overflow-x，注释里出现这个词不算 */
const gameCssDecl = gameCss.replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/overflow-x:\s*auto/.test(gameCssDecl), '没有横向滚动容器');

/* 整块是 <a>，所以必须 display:block；relative 是给贴底的「查看全部」做定位锚点；
   overflow:hidden 保证列表滚起来时不会顶出圆角。 */
const boardBlock = (gameCssDecl.match(/\.game-board\s*\{[\s\S]*?\}/) || [''])[0];
ok(/display:\s*block/.test(boardBlock),
   '战绩板整块可点（display:block 的 <a>）');
ok(/position:\s*relative/.test(boardBlock),
   '战绩板是定位锚点（贴底提示靠它）');
ok(/overflow:\s*hidden/.test(boardBlock),
   '战绩板裁掉溢出（圆角不被列表切角）');
/* 必须实底而不是半透明：这一屏背后是彩色封面拼贴，半透明会糊成一片灰 */
ok(/background:\s*var\(--bg-elev\)/.test(boardBlock),
   '战绩板用实底（压在封面拼贴上不发灰）');
ok(!/linear-gradient|radial-gradient/.test(boardBlock),
   '战绩板背景不是渐变底（纯色即可）');

/* 列表：内部纵向滚动，具体高度由 render.js 的 fitBoardList() 按屏高算出来。
   这里只守"能滚"和"滚到底不把整页翻走"两件事。 */
const listBlock = (gameCssDecl.match(/\.gb-list\s*\{[\s\S]*?\}/) || [''])[0];
ok(/overflow-y:\s*auto/.test(listBlock), '战绩列表内部纵向滚动');
ok(/overscroll-behavior:\s*contain/.test(listBlock),
   '滚到列表底部不把整页翻走（overscroll-behavior:contain）');

/* 每行是「封面 / 主体 / 成就」三列网格，不是每款游戏一张卡 */
const rowBlock = (gameCssDecl.match(/\.gb-row\s*\{[\s\S]*?\}/) || [''])[0];
ok(/grid-template-columns:/.test(rowBlock),
   '每行是网格（封面 / 主体 / 成就三列）');

/* 时长条的颜色来自 appid 哈希出的色相（行内 --c），不是主题单色。
   没有这条，几十行会全是同一个颜色，扫视时完全分不出层次。 */
ok(/\.gb-row__bar i\s*\{[\s\S]{0,200}background:\s*var\(--c/.test(gameCssDecl),
   '时长条按 appid 取色（var(--c)）');
/* 顶栏徽标用平台品牌色（Steam 蓝），换平台时由行内 --game 覆盖 */
ok(/\.gb-head__icon\s*\{[\s\S]{0,240}color:\s*var\(--game/.test(gameCssDecl),
   '顶栏徽标用平台品牌色');
/* 好友码降级成纯文字：不再是按钮，也就不该有 pointer 光标和"复制成功"的反馈 */
ok(!/\.gb-head__id\s*\{[\s\S]{0,300}cursor:\s*pointer/.test(gameCssDecl),
   '好友码只是文字（不是可点按钮）');

/* 2026-11-13：用户要求删掉「最近入库」与「查看全部」。
   这里守住"别再长回来"—— 渲染层与样式里都不许残留。 */
ok(!/recentlyAddedHtml|gb-new/.test(renderSrc), '渲染层不再有「最近入库」');
ok(!/\.gb-new/.test(gameCssDecl), '样式里不再有「最近入库」');
ok(!/gb-more|查看全部/.test(renderSrc), '渲染层不再有「查看全部」');
ok(!/\.gb-more/.test(gameCssDecl), '样式里不再有「查看全部」');

/* 排序：按最近游玩时长（hours2w）降序，并列时退回总时长 */
ok(/sort\(function \(a, b\)[\s\S]{0,300}hours2w/.test(renderSrc),
   '游戏列表按最近游玩时长降序（hours2w，并列退回 hours）');

/* 行数上限：数据端抓 30、渲染端也只画 30。两处任一漏掉，另一端就白做。 */
const syncSrc = fs.readFileSync(path.join(ROOT, 'scripts/sync-steam.mjs'), 'utf8');
ok(/const ROWS = 30\b/.test(syncSrc), '同步端只抓 30 行（sync-steam.mjs）');
ok(/ROW_LIMIT = 30\b/.test(renderSrc) && /slice\(0, ROW_LIMIT\)/.test(renderSrc),
   '渲染端也只画 30 行（ROW_LIMIT）');

/* 滚动容器与翻页手势的隔离：
   paged.js 必须在 window 上接管手势前，先问一句"这里有没有能滚的东西"。 */
const pagedJSSrc = fs.readFileSync(path.join(ROOT, 'assets/js/paged.js'), 'utf8');
ok(/function scrollOwnerOf/.test(pagedJSSrc), 'paged.js 有可滚动祖先探测');
ok(/function canScrollBy/.test(pagedJSSrc), 'paged.js 能判断容器还能不能朝手势方向滚');
ok(/var owner = scrollOwnerOf\(e\.target\)/.test(pagedJSSrc) &&
   /canScrollBy\(owner, e\.deltaY\)/.test(pagedJSSrc) &&
   /owner\.scrollTop \+=/.test(pagedJSSrc) &&
   /e\.preventDefault\(\)/.test(pagedJSSrc),
   '滚轮：起点在可滚动容器里就交给它自己滚，并拦住页面滚动');
ok(/canScrollBy\(owner, dy\)/.test(pagedJSSrc),
   '触摸：起点在可滚动容器里就放行');

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

/* 1×1 透明 PNG：外链图片的替身。
   ⚠️ 这一屏的背景要拉几十张 Steam 封面，全部来自境外 CDN；
      只要一张卡住，`load` 就等不到，整套断言白跑。测的是布局，与图片内容无关。 */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

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

    /* ⚠️ 屏蔽外部图片（CDN 封面）。
       这一版起，游戏屏要拉 48 张 Steam 竖版封面、在听屏要拉 72 张专辑封面，
       合计上百个外部请求。`waitUntil:'networkidle'` 要求"500ms 内没有新请求"，
       慢网下永远等不到，goto 直接 30s 超时 —— 表现为"偶发崩溃"，
       排查很久才发现跟代码无关。
       这个脚本不看封面图（图由 verify-steam / verify-albumwall 专门验），
       屏蔽掉既快又稳。注意顺序：先注册拦截，再注册一言的 mock，
       因为 Playwright 的路由是**后注册优先**。 */
    /* 用 1×1 透明 PNG **代替**（不是 abort）：abort 会在控制台留下
       "Failed to load resource: net::ERR_FAILED"，而本脚本有一条
       "没有控制台错误"的断言，会被这些无关噪声带红。 */
    const BLANK = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
      if (route.request().resourceType() !== 'image') return route.continue();
      return route.fulfill({ status: 200, contentType: 'image/png', body: BLANK });
    });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>

      route.request().resourceType() === 'image'

        ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })

        : route.continue());

    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(1600);
    const tag = '[' + vp.n + '] ';

    /* 一屏约束 */
    const layout = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.hero, .section')].filter(el => !el.hidden);
      /* ⚠️ 必须滤掉 hidden 的屏：config.sections 可以把某屏设成 enabled:false
         （2026-11-11 下掉的维修屏），那种 section 还在 DOM 里。
         不滤的话 pages[i] 与 .pager__dot 的索引会整体错位一格。 */
      const g = document.getElementById('gaming');
      const board = document.getElementById('gameBoard');
      const list = document.getElementById('gbList');
      const rows = list ? [...list.children] : [];
      const r = (el) => (el ? el.getBoundingClientRect() : { width: 0, height: 0, bottom: 0 });
      return {
        count: pages.length,
        snap: document.documentElement.dataset.snap,
        tall: pages.filter(p => p.getAttribute('data-tall')).map(p => p.id),
        allFit: pages.every(p => p.offsetHeight <= innerHeight + 2),
        gamingFit: g.offsetHeight <= innerHeight + 2,
        /* 新结构：一块 .game-board（顶栏 + 三格 + 列表），不是一堆卡片了 */
        hasBoard: !!board,
        /* 2026-11-13：容器不再是链接，入口在底部那个 .gb-cta 上 */
        boardHref: (function () {
          const cta = board && board.querySelector('a.gb-cta');
          return cta ? cta.getAttribute('href') : '';
        })(),
        rowCount: rows.length,
        rowH: rows.length ? Math.round(r(rows[0]).height) : 0,
        listH: list ? Math.round(r(list).height) : 0,
        listScrollH: list ? list.scrollHeight : 0,
        boardBottom: Math.round(r(board).bottom),
        overflow: g.scrollHeight - g.clientHeight,
        slack: Math.round(g.getBoundingClientRect().bottom - r(board).bottom)
      };
    });

    /* 章节数不再写死 6：2026-11-11 下掉维修屏后是 5 章。
       写死数字等于每增删一屏就要改这里，而且改错了也指不出真问题。
       真正要守的是"游戏页在其中、且每章都装得进一屏"（下面几条）。 */
    ok(layout.count >= 4, tag + '共 ' + layout.count + ' 章（含游戏）');
    ok(layout.tall.length === 0, tag + '没有页面被迫放弃吸附' + (layout.tall.length ? '（' + layout.tall + '）' : ''));
    ok(layout.allFit, tag + '每页都在一屏内');
    ok(layout.gamingFit, tag + '游戏页在一屏内');
    ok(layout.hasBoard, tag + '有游戏模块（game-board）');
    ok(isSteamProfile(layout.boardHref), tag + '按钮指向 Steam 主页');
    ok(layout.rowCount >= 2, tag + '游戏列表至少有 2 行（' + layout.rowCount + '）');
    ok(layout.overflow <= 2, tag + '模块没有把这一屏顶破（溢出 ' + layout.overflow + 'px）');
    /* 只剩一张卡时（Q3 现在是"Steam 一条横卡 + 战绩列表"）本来就该是 1 列；
       两张以上才要求多列网格，否则横卡会退回成一块窄砖。 */
    /* 列表必须"要么全展开、要么真的能滚" —— 不能出现"截断了但滚不动"的死路 */
    ok(layout.listScrollH <= layout.listH + 2 || layout.listScrollH > layout.listH,
       tag + '列表高度与内容一致（' + layout.listH + '/' + layout.listScrollH + '）');
    ok(layout.slack > 0, tag + '游戏页仍有余量（' + layout.slack + 'px）');
    /* 手机两列网格下每张约 171px —— 这是设计值，不是缺陷 */
    ok(layout.rowH >= 40, tag + '列表行高可用（' + layout.rowH + 'px）');

    /* 跳到游戏页（按 DOM 实际位置找，不写死索引） */
    const gameIdx = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.hero, .section')].filter(el => !el.hidden);
      return pages.findIndex(p => p.id === 'gaming');
    });
    /* 点页码跳游戏页：点 → 核对"页码是它 且 真的停在它的顶部" → 不对就重点。
       为什么需要重试：
         平滑滚动 + 吸附在这一屏上要 1s 以上（桌面 1800px），
         期间任何一次重排（字体缩放、density 调档、同步回来的曲目数变化）
         都会让 goTo 的目标位置失效。这类"点了没到位"是**环境时序**，
         不是页码点坏了 —— 死等一个固定时间会把它报成功能缺陷。 */
    const gotoGamePage = async (tries = 3) => {
      for (let t = 1; t <= tries; t++) {
        await page.evaluate(i => {
          document.querySelectorAll('.pager__dot')[i].click();
        }, gameIdx);
        const landed = await page.waitForFunction(i => {
          const els = [...document.querySelectorAll('.hero, .section')].filter(e => !e.hidden);
          if (!els[i]) return false;
          const top = els[i].getBoundingClientRect().top + (window.scrollY || 0);
          return window.SITE_PAGED.activeIndex() === i && Math.abs((window.scrollY || 0) - top) < 4;
        }, gameIdx, { timeout: 2600 }).then(() => true).catch(() => false);
        if (landed) return t;
      }
      return 0;
    };
    const tries = await gotoGamePage();

    const onGame = await page.evaluate(() => {
      const dots = [...document.querySelectorAll('.pager__dot')];
      const i = dots.findIndex(d => d.classList.contains('is-current'));
      const pages = [...document.querySelectorAll('.hero, .section')].filter(el => !el.hidden);
      return { i, id: pages[i] && pages[i].id, label: dots[i] && dots[i].getAttribute('aria-label') };
    });
    ok(tries > 0 && onGame.id === 'gaming',
      tag + '点对应页码能到游戏页（' + onGame.id + '，第 ' + tries + ' 次尝试到位）');
    /* 标签来自 sections.gaming.label（「游戏」）或页面标题。标题现在是英文
       "MY GAME'S"，所以两个都接受 —— 断言的是"标签指向游戏这一屏"，
       不是"标题必须是中文"。 */
    ok(/游戏|GAME/i.test(onGame.label || ''), tag + '页码标签指向游戏屏（' + onGame.label + '）');

    /* 模块语义：点整块进 Steam 主页，且**不再有**复制 UID 的按钮。
       注意查询范围必须限定在 #gaming 里 —— Q1 的 QQ / 微信联系方式本身
       就带 data-copy，全局查会一直命中，导致这条断言永远为假。 */
    const boardInfo = await page.evaluate(() => {
      const sec = document.getElementById('gaming');
      const board = document.getElementById('gameBoard');
      const uc = sec && sec.querySelector('[data-copy], .game__uid, .gb-head__id button');
      /* 2026-11-13 起整块不再是 <a>：里面要放"前往 Steam 主页"按钮，
         链接套链接是非法结构。改为「容器 + 唯一一个 CTA」，
         所以这里守三条：容器不是链接、CTA 只有一个、CTA 指向档案并在新标签打开。 */
      const ctas = board ? board.querySelectorAll('a.gb-cta') : [];
      const cta = ctas[0] || null;
      const inner = board ? board.querySelectorAll('a:not(.gb-cta), button, input, select, textarea') : [];
      return { tag: board ? board.tagName : '',
               ctas: ctas.length,
               href: cta && cta.getAttribute('href'), target: cta && cta.getAttribute('target'),
               hasCopyBtn: !!uc, nested: inner.length };
    });
    ok(boardInfo.tag === 'DIV', tag + '模块容器不是链接（避免链接套链接）');
    ok(boardInfo.ctas === 1, tag + '只有一个「前往 Steam 主页」按钮');
    ok(isSteamProfile(boardInfo.href),
       tag + '按钮指向 Steam 档案（' + (boardInfo.href || '无') + '）');
    ok(boardInfo.target === '_blank', tag + '按钮在新标签打开');
    ok(!boardInfo.hasCopyBtn, tag + '模块里没有"复制 UID"按钮');
    ok(boardInfo.nested === 0, tag + '除了这个按钮，容器里没有别的交互元素');

    /* 2026-11-13：查看全部已删，列表改为自己滚（滚轮由 paged.js 让给它）。
       这里守「列表真的可滚」—— 否则"滚轮聚焦"就是空话：列表没有溢出行，
       scrollOwnerOf 找不到滚动容器，滚轮还是会翻页。 */
    const scrollInfo = await page.evaluate(() => {
      const list = document.getElementById('gbList');
      return {
        scrollable: list.scrollHeight > list.clientHeight + 2,
        client: list.clientHeight, scroll: list.scrollHeight,
        overflowY: getComputedStyle(list).overflowY
      };
    });
    ok(scrollInfo.scrollable && scrollInfo.overflowY !== 'hidden',
       tag + '列表可滚（' + scrollInfo.client + '/' + scrollInfo.scroll + '，滚轮才会让给它）');

    /* 封面墙的几何中心必须落在**屏幕正中心**。
       这里是实测过 1px 偏差的：区块有 `border-top: 1px`，而绝对定位的包含块是
       内边距盒，整面墙被那道边框顶下去 1px，旋转后的中心就不再是视口中心。
       修法是给墙 `inset: -1px 0 0`（只补上方 1px）。这条断言守的就是它。 */
    const center = await page.evaluate(() => {
      const out = {};
      [['#gaming .steamwall__grid', 'steam'], ['.albumwall__grid', 'album']].forEach(([sel, k]) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        /* ⚠️ 以"所在区块"为基准，不是以窗口为基准：
           测这条时可能停在别的屏上（听歌墙就在上一屏，差整整一屏高度）。
           区块在翻页吸附到位时与视口等高等宽，所以两者等价。 */
        const sec = (el.closest('.hero, .section') || document.body).getBoundingClientRect();
        out[k] = {
          dx: Math.round((r.left + r.width / 2) - (sec.left + sec.width / 2)),
          dy: Math.round((r.top + r.height / 2) - (sec.top + sec.height / 2)),
          w: Math.round(r.width), h: Math.round(r.height),
          vw: Math.round(sec.width), vh: Math.round(sec.height)
        };
      });
      return out;
    });
    ['steam', 'album'].forEach(k => {
      const c = center[k];
      if (!c) return;
      ok(Math.abs(c.dx) <= 1 && Math.abs(c.dy) <= 1,
         tag + ' ' + (k === 'steam' ? '游戏墙' : '听歌墙') + '中心对齐屏幕中心（偏移 ' + c.dx + ',' + c.dy + '）');
      ok(c.w >= c.vw && c.h >= c.vh,
         tag + ' ' + (k === 'steam' ? '游戏墙' : '听歌墙') + '盖满视口（' + c.w + '×' + c.h + ' vs ' + c.vw + '×' + c.vh + '）');
    });

    /* 渲染行数上限 30：数据端和渲染端两处都要守，否则一边改另一边就白改 */
    const rowCount = await page.evaluate(() => document.querySelectorAll('.gb-row').length);
    ok(rowCount <= 30, tag + '渲染行数不超过 30 条（实际 ' + rowCount + '）');

    /* 列表：要么全展开，要么内部可滚 —— 不能"截断了但滚不动" */
    const listInfo = await page.evaluate(() => {
      const list = document.getElementById('gbList');
      const before = list.scrollTop;
      list.scrollTop = 60;
      const after = list.scrollTop;
      list.scrollTop = before;
      return { scrollable: list.scrollHeight > list.clientHeight + 2, moved: after > before };
    });
    ok(!listInfo.scrollable || listInfo.moved,
       tag + '列表能滚就真的滚得动（scrollable=' + listInfo.scrollable + '）');

    /* 滚列表到底不该把整页翻走（overscroll-behavior: contain） */
    const pageStable = await page.evaluate(async () => {
      const y0 = window.scrollY;
      const list = document.getElementById('gbList');
      list.scrollTop = list.scrollHeight;
      await new Promise(r => setTimeout(r, 220));
      const y1 = window.scrollY;
      list.scrollTop = 0;
      return { y0, y1 };
    });
    ok(Math.abs(pageStable.y1 - pageStable.y0) <= 4,
       tag + '滚到列表底部不会把整页翻页（' + pageStable.y0 + '→' + pageStable.y1 + '）');

    /* 模块内没有横向滚动，所以不存在"误触发翻页"的入口 */
    await page.waitForTimeout(500);
    const beforeIdx = await page.evaluate(() =>
      [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current')));
    const railMoved = await page.evaluate(() => {
      const rail = document.getElementById('gameRail');
      const before = rail.scrollLeft || 0;
      if (typeof rail.scrollBy === 'function') rail.scrollBy({ left: 420, behavior: 'instant' });
      return { before, after: rail.scrollLeft || 0 };
    });
    await page.waitForTimeout(600);
    const afterIdx = await page.evaluate(() =>
      [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current')));
    ok(railMoved.after === railMoved.before,
       tag + '模块没有横向位移（scrollLeft 恒为 ' + Math.round(railMoved.after) + '）');
    ok(beforeIdx === afterIdx, tag + '页码未受干扰（' + beforeIdx + ' 保持不变）');

    /* 章节入场：只一页、且会清理。
       注意用「最后一页的前一页」而非最后一页 —— 最后一页再往下会滚到页脚，
       落点不是页顶，视口守卫可能判定它不在视口内，那样测的就不是入场动画了。 */
    await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.hero, .section')].filter(el => !el.hidden);
      pages.forEach(p => p.classList.remove('is-entering'));
      const dots = document.querySelectorAll('.pager__dot');
      dots[Math.max(1, dots.length - 2)].click();
    });
    /* 平滑滚动 + 停稳判定需要时间，轮询等入场标记出现（最多 1.6s） */
    await page.waitForFunction(() => {
      const pages = [...document.querySelectorAll('.hero, .section')].filter(el => !el.hidden);
      const i = [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current'));
      return pages[i] && pages[i].classList.contains('is-entering');
    }, null, { timeout: 2500 }).catch(() => {});
    const during = await page.evaluate(() => ({
      n: document.querySelectorAll('.is-entering').length,
      onActive: (() => {
        const pages = [...document.querySelectorAll('.hero, .section')].filter(el => !el.hidden);
        const i = [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current'));
        return pages[i] && pages[i].classList.contains('is-entering');
      })(),
      animName: (() => {
        const pages = [...document.querySelectorAll('.hero, .section')].filter(el => !el.hidden);
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
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
      route.request().resourceType() === 'image'
        ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
        : route.continue());
    await page.goto(URL, { waitUntil: 'load' });
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
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
      route.request().resourceType() === 'image'
        ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
        : route.continue());
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    ok(await page.evaluate(() => document.getElementById('pageHint').classList.contains('is-shown')),
       '[提示] 首次进入显示翻页提示');
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => !document.getElementById('pageHint').classList.contains('is-shown')),
       '[提示] 滚动后自动收起');
    await page.reload({ waitUntil: 'load' });
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
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
      route.request().resourceType() === 'image'
        ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
        : route.continue());
    await page.goto(URL.replace(/\/$/, '') + '/admin.html', { waitUntil: 'load' });
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
      /* 2026-11-14：草稿结构改成 { base, at, data }（加版本锁），内容在 data 里 */
      const rec = JSON.parse(localStorage.getItem('zotrod-draft-v1') || 'null');
      const draft = rec && rec.data ? rec.data : null;
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
