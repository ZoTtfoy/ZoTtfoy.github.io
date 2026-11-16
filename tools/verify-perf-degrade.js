/* ==========================================================================
 *  低端档降级自检：node tools/verify-perf-degrade.js
 * --------------------------------------------------------------------------
 *  守 2026-11-17 的原则：**判低只减动效，不减内容**。
 *    · 装饰层（光晕/星点/噪点/网格、指针光效、扫光）在低端档不显示
 *    · 所有 data-reveal 内容直接可见（不能因为关了观察器就藏住内容）
 *    · Ken Burns / 背景视差停止
 *    · 主题切换、页面内容、卡片文字这些核心功能照样在
 *  高端档作为对照：装饰层照常显示，确保没有"一刀切全关掉"。
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = (process.argv[2] || 'http://127.0.0.1:8791/').replace(/\/$/, '/');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);
const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

async function probe(browser, query) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r =>
    r.request().resourceType() === 'image'
      ? r.fulfill({ status: 200, contentType: 'image/png', body: BLANK })
      : r.continue());
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(SITE + query, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1400);
  const r = await page.evaluate(() => {
    const disp = sel => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : '(缺元素)';
    };
    const reveals = [...document.querySelectorAll('[data-reveal]')];
    const hidden = reveals.filter(n => {
      const cs = getComputedStyle(n);
      return parseFloat(cs.opacity) < 0.9 || cs.display === 'none' || cs.visibility === 'hidden';
    }).length;
    return {
      perf: document.documentElement.getAttribute('data-perf'),
      motion: document.documentElement.dataset.motion,
      kenBurns: document.documentElement.dataset.kenBurns,
      orb: disp('.ambient__orb'), stars: disp('.ambient__stars'),
      grain: disp('.ambient__grain'), grid: disp('.ambient__grid'),
      spotlight: disp('.spotlight'), dragGlow: disp('.drag-glow'),
      revealTotal: reveals.length, revealHidden: hidden,
      // 内容还在：标题/卡片/链接的文字节点
      aboutCards: document.querySelectorAll('.about__card').length,
      socials: document.querySelectorAll('.social').length,
      themeSwitch: !!document.getElementById('themeToggle')
    };
  });
  r.errs = errs;
  await ctx.close();
  return r;
}

(async () => {
  const browser = await chromium.launch();
  const low = await probe(browser, '?perf=low');

  ok(low.perf === 'low', '强制低端档生效');
  ok(low.motion === 'off', '低端档 data-motion=off（背景动效停）');
  ok(low.kenBurns === 'off', '低端档 Ken Burns 关闭');
  ['orb', 'stars', 'grain', 'grid'].forEach(k =>
    ok(low[k] === 'none', '低端档装饰层 .' + k + ' 不显示（' + low[k] + '）'));
  ['spotlight', 'dragGlow'].forEach(k =>
    ok(low[k] === 'none', '低端档指针光效 .' + k + ' 不显示（' + low[k] + '）'));
  ok(low.revealTotal > 0 && low.revealHidden === 0,
    '低端档所有渐显内容直接可见（' + low.revealTotal + ' 个，隐藏 ' + low.revealHidden + '）');
  ok(low.aboutCards >= 2 && low.socials > 0 && low.themeSwitch,
    '低端档内容完整：关于我卡 ' + low.aboutCards + ' / 社交卡 ' + low.socials + ' / 主题按钮在');
  ok(low.errs.length === 0, '低端档无 JS 报错（' + low.errs.join(', ') + '）');

  /* 高端对照：装饰层照常，别一刀切 */
  const high = await probe(browser, '?perf=high');
  ok(high.perf === 'high' && high.motion === 'on', '高端档装饰动效照常开');
  ok(high.orb !== 'none', '高端档光晕层显示（' + high.orb + '）');
  ok(high.revealTotal > 0 && high.revealHidden > 0,
    '高端档仍用渐显（屏外内容等待进入视口，隐藏 ' + high.revealHidden + '/' + high.revealTotal + '）');
  ok(high.errs.length === 0, '高端档无 JS 报错');

  /* ---------- 运行中降级：已在跑的跟随循环必须立刻停 ----------
     真机上 perf-tier 是 load 后 2.6s 才实测判低，此刻指针光效早已初始化并在缓动。
     降级瞬间 CSS 隐藏了层，但 JS 的 rAF 若还在写变量就是白耗 CPU —— 这里守住"真停"。 */
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx3.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r =>
    r.request().resourceType() === 'image'
      ? r.fulfill({ status: 200, contentType: 'image/png', body: BLANK })
      : r.continue());
  const p3 = await ctx3.newPage();
  await p3.goto(SITE + '?perf=high', { waitUntil: 'load', timeout: 60000 });
  await p3.waitForTimeout(1000);
  await p3.mouse.move(1000, 200, { steps: 4 });
  await p3.waitForTimeout(500);
  const lxBefore = await p3.evaluate(() =>
    document.documentElement.style.getPropertyValue('--glass-lx'));
  await p3.evaluate(() => {
    document.documentElement.setAttribute('data-perf', 'low');
    document.dispatchEvent(new CustomEvent('site:perf', { detail: { low: true } }));
  });
  await p3.mouse.move(300, 700, { steps: 4 });
  await p3.waitForTimeout(600);
  const rt = await p3.evaluate(() => ({
    lx: document.documentElement.style.getPropertyValue('--glass-lx'),
    motion: document.documentElement.dataset.motion,
    ken: document.documentElement.dataset.kenBurns
  }));
  ok(!!lxBefore, '运行中降级前高光跟随在工作（lx=' + lxBefore + '）');
  ok(rt.lx === lxBefore, '降级后跟随立即停更（' + lxBefore + ' → ' + rt.lx + '）');
  ok(rt.motion === 'off' && rt.ken === 'off', '降级后背景动效/Ken Burns 同步停');
  await ctx3.close();

  await browser.close();
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch(e => { console.error('ERR', e); process.exit(2); });
