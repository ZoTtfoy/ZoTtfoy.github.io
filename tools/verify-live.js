/* ==========================================================================
 *  首页细节验证：node tools/verify-live.js
 * --------------------------------------------------------------------------
 *  轻量部分（不需要浏览器）：用假 DOM 跑 live.js，验证时间/进度计算、开关、降级。
 *  浏览器部分（可选，需 playwright-core）：验证载入动画三条路径、一言换句、
 *  音乐浮窗两种形态、以及首页是否仍守得住「一屏一页」。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const notes = [], failures = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : failures.push(m);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const liveSrc = fs.readFileSync(path.join(ROOT, 'assets/js/live.js'), 'utf8');
const liveCss = fs.readFileSync(path.join(ROOT, 'assets/css/30-sections/live.css'), 'utf8');
const cfgSrc = fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8');

/* ------------------------------------------------------ 1. 接线与结构 */
ok(html.includes('assets/css/30-sections/live.css'), 'index.html 引入 live.css');
ok(html.includes('assets/js/live.js'), 'index.html 引入 live.js');
ok(html.indexOf('assets/js/live.js') < html.indexOf('assets/js/paged.js'),
   'live.js 在 paged.js 之前加载（否则会误判一屏装不下）');
ok(html.includes('id="splash"'), '页面含载入动画容器');
ok(html.includes('<noscript><style>.splash'), '无 JS 时有兜底样式，不会白屏卡住');
ok(html.includes('id="liveQuote"'), '页面含一言容器');
ok(html.includes('id="liveMeta"') && html.includes('id="liveClock"'), '页面含时钟容器');
ok(html.includes('id="liveProgress"') && html.includes('id="liveProgressFill"'), '页面含时光进度条');
ok(html.includes('id="soundOn"'), '页面含音乐挂载点');
ok(/dataset\.loading/.test(html), '首屏内联脚本决定了是否显示载入动画');

/* ⚠️ 2026-11-13：原来这里用 indexOf('SITE_LIVE.init') 比较出现位置，
   守「live 先于 paged」「报价表折叠先于 paged 测量」两条顺序。
   main.js 改成启动表（STEPS）之后，顺序是数据不再是文本，
   这两条断言搬到了 tools/verify-boot.js（它同时守 render 第一、
   scale→density→foldQuote→paged 依次、readable 晚于 paged）。
   一个约束只留一个守门人，免得两处各写一半、改一处忘另一处。 */

/* ------------------------------------------------------ 2. 配置项齐全 */
['loading', 'clock', 'progress', 'quote', 'quoteRemote'].forEach(k => {
  ok(new RegExp(k + ':').test(cfgSrc), 'config 含 live.' + k);
});
ok(/quotes:\s*\[/.test(cfgSrc), 'config 含 quotes 本地列表');
['enabled', 'title', 'artist', 'src', 'link', 'loop', 'volume'].forEach(k => {
  ok(new RegExp(k + ':').test(cfgSrc), 'config 含 music.' + k);
});
/* ⚠️ 这一条原来断言的是「出厂默认 enabled: false」。
   music.enabled 是编辑器里随时能改的开关 —— 用户一打开，断言就永久变红，
   而且红了之后也指不出任何代码问题。它真正想守的约束是**不要自动出声**，
   所以改成验那条：live.js 不设 autoplay、不预载。
   （浏览器里另有一条 [音乐] 绝不自动播放，从行为侧再验一遍。） */
ok(!/audio\.autoplay\s*=\s*true/.test(liveSrc) && !/\bautoplay\b/.test(liveSrc),
  '音乐浮窗不会自动播放（代码里没有 autoplay）');
ok(/audio\.preload\s*=\s*"none"/.test(liveSrc), '音源不预载（preload=none，不抢带宽）');

/* ------------------------------------------- 3. 假 DOM 跑 live.js */
function makeCtx(configSource, opts = {}) {
  const store = {};
  function el(id) {
    const e = {
      id, hidden: opts.hidden !== false, textContent: '', innerHTML: '',
      style: { transform: '', setProperty() {} },
      dataset: {},
      _on: {},
      addEventListener(t, fn) { (e._on[t] = e._on[t] || []).push(fn); },
      fire(t, ev) { (e._on[t] || []).forEach(fn => fn(ev || {})); },
      querySelector: () => null,
      removeChild() {},
      parentNode: { removeChild() {} },
      _attrs: {},
      setAttribute(k, v) { e._attrs[k] = String(v); },
      getAttribute(k) { return k in e._attrs ? e._attrs[k] : null; },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
    };
    return e;
  }
  const nodes = {};
  ['splash', 'liveMeta', 'liveClock', 'liveWeek', 'liveDate',
   'liveProgress', 'liveProgressFill', 'liveProgressLabel', 'liveQuote', 'soundOn']
    .forEach(id => { nodes[id] = el(id); });

  const document = {
    readyState: 'complete',
    documentElement: { dataset: { loading: opts.loading === undefined ? '1' : opts.loading } },
    getElementById: id => nodes[id] || null,
    querySelector: sel => (sel === '.splash__mark' || sel === '.splash__name') ? el('q') : null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => el('made'),
    body: { appendChild() {}, removeChild() {} }
  };

  const ctx = {
    window: null,
    document,
    console: { log() {}, warn() {}, error(...a) { failures.push('console.error: ' + a.join(' ')); } },
    matchMedia: q => ({
      matches: q.indexOf('prefers-reduced-motion') >= 0 ? !!opts.reduced : false,
      addEventListener() {}, addListener() {}
    }),
    requestAnimationFrame: fn => { fn(); return 1; },
    setTimeout: (fn) => { if (fn) fn(); return 0; },
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem(k) { delete store[k]; } },
    sessionStorage: { getItem: k => store['s_' + k] || null, setItem: (k, v) => { store['s_' + k] = v; }, removeItem(k) { delete store['s_' + k]; } },
    addEventListener() {},
    fetch: () => Promise.resolve({ ok: false }),
    siteIcon: () => '<svg></svg>',
    location: { protocol: 'https:' },
    Promise, String, Array, Object, Math, Number, JSON, Date, RegExp, Error, Boolean, parseInt, parseFloat, isNaN
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  // 必要的图标桩
  vm.runInContext('window.siteIcon = function(){ return "<svg></svg>"; };', ctx);
  nodes.splash.parentNode = { removeChild() {} };
  return { ctx, nodes, store };
}

/* --- 时钟 / 一言 / 进度都应能正常工作 ---
   注意：6 屏重构后 config.js 里 clock / quote / progress 默认是 **false**
   （Q1 要塞 QQ/微信 + 两张摘要卡，没有空间放这些装饰）。
   所以这里不直接跑默认配置，而是先打开它们再验功能 ——
   验的是「打开后能正常工作」，而不是「默认就是开的」。 */
/* ⚠️ quote 的替换必须带上后文 quoteRemote 做锚点。
   config 里 `quote: true` 出现**两次**：一次是 live 的一言开关，
   另一次是 repair.calculator.services 里「复杂问题」的报价标记
   （那个 true 表示"这项要单独聊，不自动报价"）。
   不带锚点的 replace(/quote: true/, 'quote: false') 只换第一个 ——
   也就是**把维修的业务数据改坏了**，而一言开关根本没动，断言于是失败。
   顺带说明：这类"用字符串替换去改配置"的测试很脆，能不这么做就别这么做。 */
const LIVE_QUOTE_ON = /quote: true,(\s*\n\s*quoteRemote)/;
const LIVE_QUOTE_OFF = /quote: false,(\s*\n\s*quoteRemote)/;

const onCfg = cfgSrc
  .replace(/clock: false/, 'clock: true')
  .replace(/progress: false/, 'progress: true')
  .replace(LIVE_QUOTE_OFF, 'quote: true,$1');
const a = makeCtx(onCfg);
vm.runInContext(onCfg, a.ctx);
vm.runInContext(liveSrc, a.ctx, { filename: 'live.js' });
ok(!!a.ctx.SITE_LIVE, 'live.js 暴露 SITE_LIVE');
a.ctx.SITE_LIVE.init();

const clockTxt = a.nodes.liveClock.textContent;
ok(/^\d{2}:\d{2}$/.test(clockTxt), '时钟格式正确（' + clockTxt + '）');
ok(a.nodes.liveMeta.hidden === false, '时钟区域已显示');
ok(a.nodes.liveQuote.hidden === false, '一言已显示');
ok(a.nodes.liveQuote.innerHTML.length > 5, '一言有内容');
ok(a.nodes.liveProgress.hidden === false, '时光进度条已显示');

const label = a.nodes.liveProgressLabel.textContent;
const m = /今年已过 ([\d.]+)%/.exec(label);
ok(!!m, '进度文案格式正确（' + label + '）');
if (m) {
  const pct = parseFloat(m[1]);
  ok(pct >= 0 && pct <= 100, '进度在 0–100 之间（' + pct + '）');
  /* 与独立算出的真实值比对（允许 1% 误差，因为跨天边界） */
  const now = new Date();
  const s = new Date(now.getFullYear(), 0, 1);
  const e = new Date(now.getFullYear() + 1, 0, 1);
  const real = (now - s) / (e - s) * 100;
  ok(Math.abs(pct - real) < 1.2, '进度与实际日期吻合（页面 ' + pct + ' vs 实算 ' + real.toFixed(1) + '）');
}
const fill = a.nodes.liveProgressFill.style.transform;
ok(/^scaleX\(0?\.\d+\)$/.test(fill), '进度条填充比例已设置（' + fill + '）');

/* --- 全部关掉 --- */
const offCfg = onCfg
  .replace(/loading: true/, 'loading: false')
  .replace(/clock: true/, 'clock: false')
  .replace(/progress: true/, 'progress: false')
  .replace(LIVE_QUOTE_ON, 'quote: false,$1');
const b2 = makeCtx(offCfg, { loading: '0' });
vm.runInContext(offCfg, b2.ctx);
vm.runInContext(liveSrc, b2.ctx, { filename: 'live-off.js' });
b2.ctx.SITE_LIVE.init();
ok(b2.nodes.liveMeta.hidden === true, '关掉 clock 后时钟区域保持隐藏');
ok(b2.nodes.liveProgress.hidden === true, '关掉 progress 后进度条保持隐藏');
ok(b2.nodes.liveQuote.hidden === true, '关掉 quote 后一言保持隐藏');

/* --- 减少动态效果：不联网、不换句 --- */
const rc = makeCtx(onCfg, { reduced: true });
vm.runInContext(onCfg, rc.ctx);
vm.runInContext(liveSrc, rc.ctx, { filename: 'live-rm.js' });
rc.ctx.SITE_LIVE.init();
ok(rc.nodes.liveQuote.hidden === false, '减少动效下仍然显示一言');
/* 2026-11-14 改：减少动效关掉的应该是淡入淡出，不是功能本身。
   之前这里直接 return，导致这批用户点了完全没反应。 */
ok(rc.nodes.liveQuote.getAttribute('role') === 'button', '减少动效下仍可点击换句（只是不做动画）');

/* --- 一言：本地列表随机且会换 ---
   2026-11-14：点击换句改成**两种模式都挂**（远程模式以前是纯被动的，
   线上 quoteRemote=true 于是点了没反应 —— 用户报的就是这个）。
   这里只测本地分支的取词逻辑；远程分支见浏览器段。 */
const noRemote = onCfg.replace(/quoteRemote:\s*true/, 'quoteRemote: false');
const qc = makeCtx(noRemote);
vm.runInContext(noRemote, qc.ctx);
vm.runInContext(liveSrc, qc.ctx, { filename: 'live-q.js' });
qc.ctx.SITE_LIVE.init();
ok(qc.nodes.liveQuote.getAttribute('role') === 'button', '本地一言模式可点击换句');
const first = qc.nodes.liveQuote.innerHTML;
qc.nodes.liveQuote.fire('click');
const second = qc.nodes.liveQuote.innerHTML;
ok(!!second && second.length > 5, '点击后仍有一言内容');
/* 列表有 7 条，两次相同概率很低；但为避免偶发，允许相同但要求内容合法 */
ok(second === first || second.length > 5, '点击换句不报错');

/* --- 音乐：默认关闭时不应生成浮窗 --- */
ok(!/music-dock/.test(html), '默认不渲染音乐浮窗（HTML 里没有残留）');

/* ------------------------------------------------------ 4. CSS 断言 */
ok(/\.splash\s*\{[\s\S]{0,120}display:\s*none/.test(liveCss), '载入动画默认不显示');
ok(/html\[data-loading="1"\]\s*\.splash\s*\{\s*display:\s*grid/.test(liveCss), '由 data-loading 控制显示');
ok(/prefers-reduced-motion:\s*reduce[\s\S]{0,160}\.splash\s*\{\s*display:\s*none\s*!important/.test(liveCss),
   '减少动效时载入动画强制关闭');
ok(/font-variant-numeric:\s*tabular-nums/.test(liveCss), '数字等宽，时钟跳动不抖');
ok(/@media \(max-width: 680px\)[\s\S]{0,220}\.music-dock__text\s*\{\s*display:\s*none/.test(liveCss),
   '手机上音乐浮窗收成小圆钮，不压底部分段页码');

/* --------------------------------------- 5. 浏览器验证（有则跑） */
let chromium;
try { chromium = require('playwright-core').chromium; } catch (e) { chromium = null; }

async function browserChecks() {
  if (!chromium) {
    notes.push('--  未安装 playwright-core，跳过浏览器端校验');
    return;
  }
  const URL = 'http://127.0.0.1:8791/';
  const browser = await chromium.launch();

  // 5.1 载入动画三条路径
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    const first = await page.evaluate(() => ({
      attr: document.documentElement.dataset.loading,
      shown: !!document.getElementById('splash') &&
             getComputedStyle(document.getElementById('splash')).display === 'grid'
    }));
    ok(first.attr === '1' && first.shown, '[浏览器] 首次访问出现载入动画');
    /* 等条件成立而不是等固定 1500ms。
       载入动画的移除要看主线程什么时候空下来；页面重一点（比如封面墙有
       几十张图要解码）时 1500ms 可能不够，断言就会假失败。
       给 4s 上限，超时才算真没移除。 */
    const splashGone = await page.waitForFunction(
      () => !document.getElementById('splash'), null, { timeout: 4000 }
    ).then(() => true).catch(() => false);
    ok(splashGone, '[浏览器] 载入动画会自动移除');

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    const second = await page.evaluate(() => ({
      attr: document.documentElement.dataset.loading,
      gone: !document.getElementById('splash')
    }));
    ok(second.attr === '0' && second.gone, '[浏览器] 同一会话再次访问不再出现');

    /* 一言：默认关不关由 config 决定（Q1 要塞 QQ/微信和两张摘要卡，
       再加一句话就可能装不下）。所以这里不写死"默认不显示"，
       而是断言「页面状态 == 配置声明」—— 配了关就得关，配了开就得开。
       之前写死成"默认不显示"，用户在编辑器里打开一言之后这条就永远红。 */
    await page.waitForTimeout(600);
    const quoteCfg = await page.evaluate(() =>
      !!((window.SITE_CONFIG || {}).live || {}).quote);
    const quoteOff = await page.evaluate(() => {
      const el = document.getElementById('liveQuote');
      return { hidden: el.hidden, visible: el.getClientRects().length > 0 };
    });
    ok(quoteCfg ? (!quoteOff.hidden && quoteOff.visible) : (quoteOff.hidden && !quoteOff.visible),
      '[浏览器] 一言显隐与配置一致（配置 ' + (quoteCfg ? '开' : '关') + '）');

    const q1 = await page.evaluate(() => {
      // 临时打开，再 init 一次即可生效（live.js 的 init 是幂等的）
      window.SITE_CONFIG.live.quote = true;
      window.SITE_CONFIG.live.clock = true;
      window.SITE_LIVE.init();
      return document.getElementById('liveQuote').textContent;
    });
    await page.waitForTimeout(300);
    await page.locator('#liveQuote').click();
    /* 远程模式点了要发一次 hitokoto（1.4s 超时后回落本地），所以等得比一帧久。
       300ms 只看"有字"是测不出毛病的 —— 之前这条断言从来没验到"真的换了"。 */
    await page.waitForTimeout(2600);
    const q2 = await page.evaluate(() => document.getElementById('liveQuote').textContent);
    ok(!!q1 && !!q2 && q1 !== q2,
      '[浏览器] 点一言真的换了一句（' + q1.slice(0, 8) + ' → ' + q2.slice(0, 8) + '）');
    ok(await page.evaluate(() => document.getElementById('liveQuote').getAttribute('role') === 'button'),
      '[浏览器] 一言带 button 语义（键盘也能换）');
    await ctx.close();
  }

  // 5.2 减少动效
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    ok(await page.evaluate(() => document.documentElement.dataset.loading === '0'),
       '[浏览器] 减少动效时不出现载入动画');
    await ctx.close();
  }

  // 5.3 逐视口：一屏约束 + 对比度 + 无报错
  function lum(rgb) {
    const [r, g, b] = rgb.map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const contrast = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const vp of [
    { n: '桌面', w: 1440, h: 900 },
    { n: '平板', w: 820, h: 1180 },
    { n: '手机', w: 390, h: 844 }
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: vp.w <= 900, isMobile: vp.w <= 900
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', c => { if (c.type() === 'error') errs.push(c.text()); });
    /* 这三档验的是「时钟 / 一言 / 进度在真实布局下是否可读、是否挤坏首屏」，
       而它们默认是关闭的，所以注入一次配置再重载。 */
    await page.addInitScript(() => {
      // config.js 先于本脚本执行，等它加载完再改
      Object.defineProperty(window, '__forceLive', { value: true, configurable: true });
    });
    /* ⚠️ 不能用 networkidle：这一页有 150+ 张外链封面，
       "网络静默 500ms" 永远不会成立，goto 会一直等到超时。
       改成 DOM 就绪 + 等脚本初始化完成。 */
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SITE_LIVE, { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => {
      const L = window.SITE_CONFIG && window.SITE_CONFIG.live;
      if (!L) return;
      L.clock = true; L.quote = true; L.progress = true;
      if (window.SITE_LIVE) window.SITE_LIVE.init();
    });
    await page.waitForTimeout(900);

    const r = await page.evaluate(() => {
      const hero = document.querySelector('.hero');
      const inner = hero.querySelector('.hero__inner');
      const parse = s => {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map(Number);
        return p.slice(0, 3);
      };
      const bgOf = el => {
        let e = el;
        while (e) {
          const c = getComputedStyle(e).backgroundColor;
          if (c !== 'rgba(0, 0, 0, 0)') { const v = parse(c); if (v) return v; }
          e = e.parentElement;
        }
        return [255, 255, 255];
      };
      const meta = document.getElementById('liveMeta');
      const quote = document.getElementById('liveQuote');
      const lab = document.getElementById('liveProgressLabel');
      return {
        heroH: hero.offsetHeight,
        vh: innerHeight,
        tall: hero.getAttribute('data-tall'),
        slack: Math.round(hero.getBoundingClientRect().bottom - inner.getBoundingClientRect().bottom),
        metaFg: parse(getComputedStyle(meta).color), metaBg: bgOf(meta),
        quoteFg: parse(getComputedStyle(quote).color), quoteBg: bgOf(quote),
        labFg: parse(getComputedStyle(lab).color), labBg: bgOf(lab),
        clock: document.getElementById('liveClock').textContent,
        label: lab.textContent,
        fill: document.getElementById('liveProgressFill').style.transform
      };
    });

    ok(r.tall === null, '[' + vp.n + '] 首页未被标记为高个页');
    ok(r.heroH <= r.vh + 2, '[' + vp.n + '] 首页仍是一屏（' + r.heroH + ' / ' + r.vh + '）');
    ok(r.slack > 0, '[' + vp.n + '] 首页内容有留白余量（' + r.slack + 'px）');
    ok(/^\d{2}:\d{2}$/.test(r.clock), '[' + vp.n + '] 时钟已渲染（' + r.clock + '）');
    ok(/今年已过 [\d.]+%/.test(r.label), '[' + vp.n + '] 进度文案已渲染（' + r.label + '）');
    ok(/scaleX\(0?\.\d+\)/.test(r.fill), '[' + vp.n + '] 进度条已填充');

    if (r.metaFg && r.metaBg) {
      const c = contrast(r.metaFg, r.metaBg);
      ok(c >= 3.5, '[' + vp.n + '] 时钟文字对比度 ' + c.toFixed(2) + ' ≥ 3.5（辅助信息）');
    }
    if (r.quoteFg && r.quoteBg) {
      const c = contrast(r.quoteFg, r.quoteBg);
      ok(c >= 4.5, '[' + vp.n + '] 一言对比度 ' + c.toFixed(2) + ' ≥ 4.5');
    }
    if (r.labFg && r.labBg) {
      const c = contrast(r.labFg, r.labBg);
      ok(c >= 3.5, '[' + vp.n + '] 进度标签对比度 ' + c.toFixed(2) + ' ≥ 3.5');
    }
    if (errs.length) failures.push('[' + vp.n + '] 控制台错误: ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  // 5.4 音乐浮窗两种形态
  {
    const cfgPath = path.join(ROOT, 'assets/js/config.js');
    const original = fs.readFileSync(cfgPath, 'utf8');

    // 形态一：有音源 → 播放按钮（用正则替换，避免换行符差异）
    /* ⚠️ 这段原来假设 config 里是 `enabled: false` + `src: ""`（出厂默认）。
       用户在编辑器里打开浮窗、填上地址之后，两条 replace 全部落空，
       写进文件的还是原配置 —— 于是"有播放按钮 / 创建了 audio"必然失败。
       改成**直接改这两个值本身**，不管原来是什么：
         · enabled  → 一律改成 true
         · src      → 一律换成一个真实存在的音频文件名
       换进来的是 .mp3 扩展名，正好也验证了 live.js「按扩展名判断是不是音频」那一段。 */
    const withSrc = original
      .replace(/(music:\s*\{[\s\S]*?)enabled:\s*(?:true|false)/, '$1enabled: true')
      .replace(/(music:\s*\{[\s\S]*?)src:\s*"[^"]*"/, '$1src: "./assets/audio/test.mp3"')
      .replace(/(music:\s*\{[\s\S]*?)title:\s*"[^"]*"/, '$1title: "测试曲目"');
    fs.writeFileSync(cfgPath, withSrc);
    ok(/enabled:\s*true/.test(withSrc) && /test\.mp3/.test(withSrc),
      '[音乐] 测试配置写入成功（enabled=true，src 指向 .mp3）');
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => {
        const d = document.querySelector('.music-dock');
        if (!d) return null;
        const audio = d.querySelector('audio');
        return {
          isButton: d.tagName === 'DIV',
          hasBtn: !!d.querySelector('#musicBtn'),
          title: (d.querySelector('.music-dock__title') || {}).textContent,
          hasAudio: !!audio,
          autoplay: audio ? !audio.paused : null,
          preload: audio ? audio.preload : null
        };
      });
      ok(!!r, '[音乐] 配置音源后出现浮窗');
      if (r) {
        ok(r.hasBtn, '[音乐] 有播放按钮');
        ok(r.title === '测试曲目', '[音乐] 标题来自配置（' + r.title + '）');
        ok(r.hasAudio, '[音乐] 创建了 audio 元素');
        ok(r.autoplay === false, '[音乐] 绝不自动播放');
        ok(r.preload === 'none', '[音乐] preload=none，不抢带宽');
      }
      await ctx.close();
    }

    // 形态二：只有链接 → 跳转入口
    const withLink = original.replace(/music:\s*\{[\s\S]*?enabled:\s*false/, 'music: {\n    enabled: true');
    fs.writeFileSync(cfgPath, withLink);
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => {
        const d = document.querySelector('.music-dock');
        return d ? { tag: d.tagName, href: d.getAttribute('href'), noAudio: !d.querySelector('audio') } : null;
      });
      ok(!!r && r.tag === 'A', '[音乐] 只有链接时渲染为跳转入口');
      ok(!!r && /music\.163\.com/.test(r.href || ''), '[音乐] 链接指向配置地址');
      ok(!!r && r.noAudio, '[音乐] 无音源时不创建 audio');
      await ctx.close();
    }

    // 恢复原配置
    fs.writeFileSync(cfgPath, original);
    ok(true, '[音乐] 测试后已恢复原配置');
  }

  await browser.close();
}

browserChecks().then(() => {
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + failures.length);
  if (failures.length) { console.log('\n失败明细:\n' + failures.join('\n')); process.exit(1); }
  console.log('\n全部通过');
}).catch(e => {
  console.log(notes.join('\n'));
  console.log('\n运行中断: ' + e.message);
  process.exit(1);
});
