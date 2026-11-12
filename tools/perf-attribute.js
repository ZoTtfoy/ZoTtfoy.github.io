/* 逐项归因：关掉一个东西再测滚动帧耗时，看它占了多少。
   用法：node tools/perf-attribute.js
   全部在 --uncapped（关垂直同步）+ 手机视口 + CPU 4x 下测。
*/
const { chromium } = require('playwright-core');

const SITE = 'http://127.0.0.1:8791/';
const VP = { width: 390, height: 844 };
const CASES = [
  ['基线', null],
  ['关背景光晕(#ambient)', () => { const e = document.getElementById('ambient'); if (e) e.style.display = 'none'; }],
  ['关追光(#spotlight)', () => { const e = document.getElementById('spotlight'); if (e) e.style.display = 'none'; }],
  ['关两面墙', () => { ['steamWall', 'albumWall'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; }); }],
  ['关进度条(#scrollProgressBar)', () => { const e = document.getElementById('scrollProgressBar'); if (e) e.style.display = 'none'; }],
  ['关全部装饰（上面全关）', () => {
    ['ambient', 'spotlight', 'steamWall', 'albumWall', 'scrollProgressBar'].forEach(id => {
      const e = document.getElementById(id); if (e) e.style.display = 'none';
    });
  }],
  ['data-motion=off', () => { document.documentElement.dataset.motion = 'off'; }]
];

async function scrollFps(page) {
  return page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 300));
    const f = [];
    let last = performance.now(), run = true;
    function tick(n) { f.push(n - last); last = n; if (run) requestAnimationFrame(tick); }
    requestAnimationFrame(t => { last = t; requestAnimationFrame(tick); });
    const t0 = performance.now();
    while (performance.now() - t0 < 1600) {
      window.scrollBy(0, 26);
      await new Promise(r => requestAnimationFrame(r));
    }
    run = false;
    const d = f.slice(3);
    const s = [...d].sort((a, b) => a - b);
    return { avg: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1),
             p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
             janky: d.filter(x => x > 20).length };
  });
}

(async () => {
  const browser = await chromium.launch({
    args: ['--disable-frame-rate-limit', '--disable-gpu-vsync']
  });
  const rows = [];
  for (const [name, fn] of CASES) {
    const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(SITE, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1500);
    if (fn) await page.evaluate(fn);
    await page.waitForTimeout(600);
    /* 单次测量的方差实测能到 40%，跑 3 次取中位数 */
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await scrollFps(page));
    runs.sort((a, b) => a.avg - b.avg);
    rows.push([name, runs[1]]);
    await ctx.close();
  }
  await browser.close();

  const base = rows[0][1].avg;
  console.log('（390×844 DSF2 CPU4x，垂直同步关闭；越低越好）\n');
  const pad = (s, n) => {
    /* 中文按两格宽算，否则对不齐 */
    let w = 0;
    for (const ch of s) w += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
    return s + ' '.repeat(Math.max(0, n - w));
  };
  rows.forEach(([name, r]) => {
    const save = (base - r.avg) / base * 100;
    console.log(pad(name, 26) + 'avg ' + r.avg.toFixed(1).padStart(5) + 'ms  p95 '
      + r.p95.toFixed(1).padStart(5) + 'ms  卡顿 ' + String(r.janky).padStart(3)
      + (name === '基线' ? '' : '   省 ' + save.toFixed(0) + '%'));
  });
})().catch(e => { console.error('ERR', e); process.exit(1); });
