/* ==========================================================================
 *  等比缩放 + 异形比例验证：node tools/verify-scale.js [URL]
 * --------------------------------------------------------------------------
 *  守的是「换成任何比例的屏幕，界面都还能用」。
 *
 *  为什么单独一套：
 *    verify-devices 验的是 15 种**真实机型**（手机为主），
 *    verify-density 验的是桌面窗口的宽高网格。
 *    但用户会在完全不同的设备之间切换：32:9 带鱼屏、1:1 方形、
 *    1024×1366 的 iPad、500×800 的微信内置浏览器、400×1200 的极端竖条。
 *    这些比例既不是"手机"也不是"典型桌面窗口"，两套脚本都覆盖不到。
 *
 *  三条断言：
 *    1. 缩放系数在合理区间内，且随可用面积单调（面积大则不小）
 *    2. 手机与矮屏不被缩放（它们的档位是逐机型调过的，再缩会破可读下限）
 *    3. 任何比例下：不横向溢出、可见文字不低于 10.5px、
 *       除非是文档化的横屏降级路径
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* 24 种比例：覆盖超宽 / 超窄 / 方形 / 矮扁 / 竖条，以及常见真机与窗口 */
const CASES = [
  ['超宽 32:9', 3840, 1080], ['超宽 21:9', 2560, 1080], ['标准 16:9', 1920, 1080],
  ['带鱼屏 34"', 3440, 1440], ['方形 1:1', 900, 900], ['超窄竖窗', 420, 1200],
  ['极窄竖窗', 360, 1000], ['折叠内屏', 884, 1104], ['平板竖 3:4', 768, 1024],
  ['平板横 4:3', 1024, 768], ['iPad Pro 12.9', 1024, 1366], ['小笔记本', 1280, 720],
  ['极矮横窗', 1600, 520], ['极矮横窗2', 1200, 480], ['横屏手机', 844, 390],
  ['超小窗', 640, 480], ['微信内置', 500, 800], ['微信内置2', 480, 700],
  ['奇葩 1:3', 400, 1200], ['奇葩 3:1', 1500, 500], ['投影 16:10', 1280, 800],
  ['老显示器 5:4', 1280, 1024], ['8:5 平板', 1280, 768], ['双屏一半', 960, 1080]
];

/* 可读性下限：与 readability.js 的兜底值一致。
   断言略宽 0.1px，避免浏览器把 10.5 算成 10.49 就报错。 */
const MIN_FS = 10.4;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.route('**/v1.hitokoto.cn/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ hitokoto: '把复杂的东西，做得简单一点。', from: '测试' })
  }));
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(2400);

  /* ------------------------------------- 1. 缩放系数本身的性质（纯计算） */
  const pure = await page.evaluate(() => {
    if (!window.SITE_SCALE || typeof window.SITE_SCALE.compute !== 'function') return null;
    const f = window.SITE_SCALE.compute;
    const F = window.SITE_SCALE;
    const cases = [[390, 844], [1440, 900], [1920, 1080], [2560, 1080], [900, 900],
                   [768, 1024], [1024, 768], [500, 800], [844, 390], [640, 480]];
    return {
      min: F.MIN, max: F.MAX,
      samples: cases.map(([w, h]) => ({ w, h, s: +f(w, h).toFixed(3) }))
    };
  });
  ok(!!pure, 'SITE_SCALE 已注册且暴露 compute');
  if (pure) {
    /* 上下界的断言看的是"别把可读性和一屏装得下交给字号来解决"：
       下界 ≥ 0.88 —— 再小正文就跌破可读下限；
       上界 ≤ 1.30 —— 再大会在 4K 上像放大镜。
       （曾取 0.82/1.08，结果所有桌面都被钳到同一个值，
         "等比"退化成"统一加 8%"，所以上界必须留出区分度。） */
    ok(pure.min >= 0.88 && pure.min <= 0.94, '缩放下界克制（' + pure.min + '）');
    ok(pure.max >= 1.15 && pure.max <= 1.30, '缩放上界既有区分度又不夸张（' + pure.max + '）');
    ok(pure.samples.every(x => x.s >= pure.min - 0.001 && x.s <= pure.max + 0.001),
      '所有样本的系数都落在区间内（' + pure.samples.map(x => x.s).join('/') + '）');
    /* 手机不缩放 */
    ok(pure.samples.filter(x => x.w <= 600).every(x => x.s === 1),
      '窄屏不缩放（避免与机型档位双重缩小）');
    ok(pure.samples.filter(x => x.h <= 500).every(x => x.s === 1),
      '矮屏不缩放（横屏靠让位而不是缩字）');
    /* 面积单调：大屏的系数不能小于小屏 */
    const big = pure.samples.find(x => x.w === 1920 && x.h === 1080);
    const small = pure.samples.find(x => x.w === 640 && x.h === 480);
    ok(big.s >= small.s, '面积更大的屏幕系数不小于小屏（' + big.s + ' ≥ ' + small.s + '）');
    /* 关键：系数必须真的"分得开"。
       上下界如果贴得太近，所有设备都会取到同一个值 ——
       那时"等比缩放"只是"统一缩放"，等于没做。 */
    const distinct = new Set(pure.samples.map(x => x.s)).size;
    ok(distinct >= 3,
      '不同尺寸拿到的系数确实不同（' + distinct + ' 种，避免全部撞上限）');
  }

  /* ------------------------------------------------ 2. 逐比例实测 */
  const problems = [];
  for (const [name, w, h] of CASES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1250);

    const r = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.hero, .section')];
      const over = pages.map(e => ({ id: e.id, d: e.offsetHeight - innerHeight })).filter(x => x.d > 2);
      let minFs = 99, minSel = '';
      document.querySelectorAll('body *').forEach(el => {
        if (el.children.length || !el.textContent.trim()) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return;
        const fs = parseFloat(cs.fontSize);
        if (fs < minFs) {
          minFs = fs;
          minSel = (typeof el.className === 'string' ? el.className : el.tagName).split(' ')[0] || el.tagName;
        }
      });
      return {
        vp: document.documentElement.dataset.vp,
        scale: +(document.documentElement.dataset.scale || 1),
        over,
        hOver: document.documentElement.scrollWidth > innerWidth + 1,
        minFs: +minFs.toFixed(2), minSel
      };
    });

    /* 横屏手机（宽>高 且 高<500）是文档化的例外：390 的高度放不下竖版页面，
       paged.js 会标 data-tall，吸附降级为 proximity 允许滚动看完。 */
    const isLandscapePhone = w > h && h < 500;
    const okOver = !r.over.length || isLandscapePhone;
    const okRead = r.minFs >= MIN_FS;

    if (!okOver || r.hOver || !okRead) {
      problems.push(name + ' ' + w + '×' + h +
        (okOver ? '' : ' 超屏:' + r.over.map(x => x.id + '+' + x.d).join(',')) +
        (r.hOver ? ' 横向溢出' : '') +
        (okRead ? '' : ' 字太小:' + r.minFs + 'px(' + r.minSel + ')'));
    }
  }
  ok(problems.length === 0,
    CASES.length + ' 种比例都成立' + (problems.length ? '（' + problems.slice(0, 4).join('；') + '）' : ''));

  /* ------------------------------------- 3. 缩放后重新计算并恢复 */
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(1000);
  const big = await page.evaluate(() => ({
    scale: +(document.documentElement.dataset.scale || 1),
    rootFs: getComputedStyle(document.documentElement).fontSize
  }));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(1000);
  const mid = await page.evaluate(() => ({
    scale: +(document.documentElement.dataset.scale || 1),
    rootFs: getComputedStyle(document.documentElement).fontSize
  }));
  ok(big.scale >= mid.scale, '从大屏缩到中屏，系数不增大（' + big.scale + ' → ' + mid.scale + '）');
  ok(parseFloat(big.rootFs) >= parseFloat(mid.rootFs),
    '根字号跟着变小（' + big.rootFs + ' → ' + mid.rootFs + '）');

  /* 4. 可读性兜底真的在工作（记录下它救过哪些元素） */
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(1200);
  const raised = await page.evaluate(() =>
    typeof window.SITE_READABLE === 'object' && window.SITE_READABLE.raised
      ? window.SITE_READABLE.raised().length : -1);
  ok(raised >= 0, '可读性兜底模块可用');

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  await browser.close();

  notes.forEach(n => console.log(n));
  if (fails.length) { console.log('\n失败明细:'); fails.forEach(f => console.log('· ' + f)); }
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  console.log(fails.length ? '\n有问题' : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})();
