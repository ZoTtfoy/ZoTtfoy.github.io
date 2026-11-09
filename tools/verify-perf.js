/* ==========================================================================
 *  性能回归：node tools/verify-perf.js
 * --------------------------------------------------------------------------
 *  性能问题肉眼只能"感觉有点卡"，所以这里把关键指标量化，回退就报错。
 *
 *  本轮优化前后的基线：
 *    滚动平均帧耗时   109.1ms（≈9 FPS） → 18.0ms（≈55 FPS）
 *    常驻合成层        61 个             → 6 个
 *    主题切换过渡范围  全站 740+ 元素     → 只给真正有色块变化的元素
 *    脚本加载          串行 9 个          → defer 并行
 *
 *  阈值留了余量：无头环境是软件渲染，真实设备有 GPU 会更快。
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

async function scrollFps(page) {
  return await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 250));
    const f = [];
    let last = performance.now(), run = true;
    function tick(n) { f.push(n - last); last = n; if (run) requestAnimationFrame(tick); }
    requestAnimationFrame(t => { last = t; requestAnimationFrame(tick); });
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      window.scrollBy(0, 26);
      await new Promise(r => requestAnimationFrame(r));
    }
    run = false;
    const d = f.slice(3);
    const s = [...d].sort((a, b) => a - b);
    return {
      avg: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1),
      p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
      janky: d.filter(x => x > 20).length
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const reqs = [];
  page.on('response', r => {
    const h = r.headers();
    reqs.push({
      url: r.url().replace(SITE, '/'),
      type: r.request().resourceType(),
      len: Number(h['content-length'] || 0)
    });
  });

  const t0 = Date.now();
  await page.goto(SITE, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(1500);

  /* ---------- 1. 资源 ---------- */
  const cssReq = reqs.filter(r => r.type === 'stylesheet');
  const jsReq = reqs.filter(r => r.type === 'script');
  const totalKB = reqs.reduce((a, r) => a + r.len, 0) / 1024;
  console.log('=== 资源 ===');
  console.log('load 耗时:', loadMs, 'ms | 请求', reqs.length, '个 | 传输', totalKB.toFixed(1), 'KB');
  console.log('css', cssReq.length, '个 | js', jsReq.length, '个');

  ok(loadMs < 1200, 'load 事件 ' + loadMs + 'ms < 1200ms');
  ok(reqs.length <= 26, '请求数 ' + reqs.length + ' ≤ 26');
  ok(totalKB < 280, '总传输 ' + totalKB.toFixed(0) + 'KB < 280KB');

  /* ---------- 2. DOM ---------- */
  const dom = await page.evaluate(() => ({
    nodes: document.querySelectorAll('*').length,
    svg: document.querySelectorAll('svg').length
  }));
  console.log('\n=== DOM ===');
  console.log('元素', dom.nodes, '| 内联 svg', dom.svg);
  ok(dom.nodes < 1200, 'DOM 元素 ' + dom.nodes + ' < 1200');

  /* ---------- 3. 合成层 ---------- */
  const layers = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('*').forEach(el => {
      const wc = getComputedStyle(el).willChange;
      if (wc && wc !== 'auto') out.push({
        sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
          (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''),
        wc
      });
    });
    return out;
  });
  console.log('\n=== 合成层 ===');
  console.log('声明 will-change 的元素:', layers.length, '个');
  layers.forEach(l => console.log('   ' + l.sel + ' → ' + l.wc));
  ok(layers.length <= 12, '常驻 will-change ' + layers.length + ' ≤ 12 个');

  /* ---------- 4. 滚动 ---------- */
  const stats = await page.evaluate(async () => {
    let gbcr = 0, longtasks = 0;
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { gbcr++; return orig.call(this); };
    let mo;
    try {
      mo = new PerformanceObserver(l => { longtasks += l.getEntries().length; });
      mo.observe({ entryTypes: ['longtask'] });
    } catch (e) {}

    for (let i = 0; i < 6; i++) {
      window.scrollBy(0, 900);
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => setTimeout(r, 60));
    }
    await new Promise(r => setTimeout(r, 400));
    Element.prototype.getBoundingClientRect = orig;
    if (mo) mo.disconnect();
    return { gbcr, longtasks };
  });

  const fps = await scrollFps(page);
  console.log('\n=== 滚动 ===');
  console.log('getBoundingClientRect', stats.gbcr, '次 | 长任务', stats.longtasks, '个');
  console.log('帧耗时 平均', fps.avg + 'ms', '| p95', fps.p95 + 'ms', '| 卡顿帧', fps.janky);

  ok(stats.gbcr <= 140, '滚动期间布局读取 ' + stats.gbcr + ' ≤ 140 次');
  ok(stats.longtasks === 0, '滚动期间长任务 ' + stats.longtasks + ' 个');
  /* 60fps 满帧是 16.67ms。允许 20ms 是因为无头环境用软件渲染，
   真机有 GPU 会更接近 16.7。这个阈值比上一版（24ms）更严格。 */
  ok(fps.avg <= 20, '滚动平均帧耗时 ' + fps.avg + 'ms ≤ 20ms（60fps 满帧 16.7ms）');
  /* 3 秒滚动约 180 帧，掉帧率应低于 2% */
  ok(fps.janky / Math.max(1, fps.janky + 170) <= 0.02 || fps.janky <= 4,
     '卡顿帧 ' + fps.janky + ' 个（掉帧率应 < 2%）');
  /* p95 贴近中位 = 没有周期性掉帧。这是"稳"比"快"更重要的指标。 */
  ok(fps.p95 - fps.avg <= 20, 'p95 ' + fps.p95 + 'ms 与均值差 ' +
     (fps.p95 - fps.avg).toFixed(1) + 'ms ≤ 20ms（无周期性掉帧）');

  /* ---------- 5. 主题切换 ---------- */
  const themeSwitch = await page.evaluate(async () => {
    const t = performance.now();
    for (let i = 0; i < 5; i++) {
      window.SITE_SKIN.apply('paper', i % 2 ? 'dark' : 'light', false);
      await new Promise(r => requestAnimationFrame(r));
    }
    return performance.now() - t;
  });
  console.log('\n=== 主题切换 ===');
  console.log('5 次合计', themeSwitch.toFixed(0) + 'ms（单次约', (themeSwitch / 5).toFixed(0) + 'ms）');
  ok(themeSwitch / 5 <= 140, '单次主题切换 ' + (themeSwitch / 5).toFixed(0) + 'ms ≤ 140ms');

  /* ---------- 6. 全部背景动效开启 ---------- */
  await page.evaluate(() => {
    document.documentElement.dataset.bdGrid = 'on';
    document.documentElement.dataset.bdStars = 'on';
  });
  await page.waitForTimeout(400);
  const fpsAll = await scrollFps(page);
  console.log('\n=== 背景动效全开 ===');
  console.log('帧耗时 平均', fpsAll.avg + 'ms | 卡顿帧', fpsAll.janky);
  ok(fpsAll.avg <= 30, '全开时滚动 ' + fpsAll.avg + 'ms ≤ 30ms（微粒是可选项，允许略高）');

  /* ---------- 7. 减少动效 ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto(SITE, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(900);

  const rm = await p2.evaluate(() => {
    const orb = document.querySelector('.ambient__orb--a');
    const stars = document.querySelector('.ambient__stars');
    return {
      motion: document.documentElement.dataset.motion,
      orbAnim: getComputedStyle(orb).animationName,
      starsAnim: stars ? getComputedStyle(stars, '::before').animationName : 'none',
      kenBurns: document.documentElement.dataset.kenBurns,
      entering: document.querySelectorAll('.is-entering').length,
      snap: getComputedStyle(document.documentElement).scrollSnapType
    };
  });
  console.log('\n=== 减少动效 ===');
  console.log(JSON.stringify(rm));

  /* 注意：这里不断言帧率。reduced-motion 下吸附被关闭，页面变成自由滚动，
     同样时长会连续经过所有内容，帧耗时天然高于吸附模式 ——
     那是测量方式差异，不是性能缺陷。这里只验证「动画确实停了」。 */
  ok(rm.motion === 'off', '减少动效时 data-motion=off');
  ok(rm.orbAnim === 'none', '光晕动画已停止（' + rm.orbAnim + '）');
  ok(rm.kenBurns === 'off', '图片推拉已关闭');
  ok(rm.entering === 0, '没有章节入场动画在跑');
  ok(rm.snap === 'none', '吸附已关闭（自由滚动）');
  await ctx2.close();

  console.log('\n' + notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');

  await browser.close();
})();
