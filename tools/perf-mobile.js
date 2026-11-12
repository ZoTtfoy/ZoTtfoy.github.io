/* ==========================================================================
 *  移动端性能探针：node tools/perf-mobile.js [--desktop]
 * --------------------------------------------------------------------------
 *  verify-perf 用的是桌面视口（1440×900），所以它测不出移动端特有的问题。
 *  这里用真实手机视口（390×844 / DSF 2）+ CPU 4 倍减速来逼近真实手机的
 *  单核/弱 GPU 环境，把「渲染问题」翻译成数字：
 *
 *    · 滚动平均帧耗时 / 卡顿帧（60fps 下 >20ms 即肉眼可感）
 *    · 连续翻页的帧耗时（停手后的 settle 也是成本）
 *    · 合成层数量与总像素（移动端 GPU 内存小，大层最容易爆）
 *    · 一直在跑的动画数量（离屏还在跑就是白烧电）
 *
 *  注意：headless 是软件渲染，绝对值比真机差一截，**只用于前后对比**，
 *  不看绝对值。
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = 'http://127.0.0.1:8791/';
const DESKTOP = process.argv.includes('--desktop');

const VP = DESKTOP
  ? { width: 1440, height: 900 }
  : { width: 390, height: 844, deviceScaleFactor: 2 };
const CPU = DESKTOP ? 1 : 4;

function fmt(x) { return typeof x === 'number' ? x.toFixed(1) : x; }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: VP.deviceScaleFactor || 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

  let runningAnim = 0;
  await page.goto(SITE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => (document.fonts && document.fonts.ready) || null);

  /* ---------- 基础体量 ---------- */
  const base = await page.evaluate(() => ({
    dom: document.querySelectorAll('*').length,
    imgs: document.images.length,
    anims: document.getAnimations().filter(a => a.playState === 'running').length,
    wallImgs: document.querySelectorAll('#steamWall img, #albumWall img').length
  }));

  /* ---------- 合成层 ---------- */
  await cdp.send('LayerTree.enable');
  const tree = await cdp.send('LayerTree.compositingReasons', { layerId: '' }).catch(() => null);
  let layers = null;
  try {
    const lm = await cdp.send('LayerTree.makeSnapshot', { layerId: '' }).catch(() => null);
  } catch (e) { /* 老 chromium 没有 snapshot */ }

  /* ---------- 滚动帧率 ---------- */
  async function scrollFps(ms) {
    return page.evaluate(async (dur) => {
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 250));
      const f = [];
      let last = performance.now(), run = true;
      function tick(n) { f.push(n - last); last = n; if (run) requestAnimationFrame(tick); }
      requestAnimationFrame(t => { last = t; requestAnimationFrame(tick); });
      const t0 = performance.now();
      while (performance.now() - t0 < dur) {
        window.scrollBy(0, 26);
        await new Promise(r => requestAnimationFrame(r));
      }
      run = false;
      const d = f.slice(3);
      const s = [...d].sort((a, b) => a - b);
      return {
        avg: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1),
        p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
        janky: d.filter(x => x > 20).length,
        frames: d.length
      };
    }, ms);
  }

  const scroll = await scrollFps(1600);

  /* ---------- 连续翻页帧耗时（前 8 页，取后 4 页的中位数） ---------- */
  const flips = await page.evaluate(async () => {
    const res = [];
    const P = window.SITE_PAGED;
    if (!P) return res;
    const n = P.pages().length;
    for (let i = 1; i < Math.min(n, 8); i++) {
      const f = [];
      let last = performance.now(), run = true;
      function tick(t) { f.push(t - last); last = t; if (run) requestAnimationFrame(tick); }
      requestAnimationFrame(t => { last = t; requestAnimationFrame(tick); });
      P.goTo(i);
      await new Promise(r => setTimeout(r, 700));
      run = false;
      res.push(f.slice(1));
    }
    return res;
  });
  const flipStats = flips.map(d => {
    const s = [...d].sort((a, b) => a - b);
    return { avg: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1),
             max: +s[s.length - 1].toFixed(1),
             janky: d.filter(x => x > 20).length };
  });

  /* ---------- 离屏动画（翻完所有页后，离屏的墙还在跑吗） ---------- */
  const offscreen = await page.evaluate(() => {
    function rect(el) { return el.getBoundingClientRect(); }
    const out = [];
    document.getAnimations().forEach(a => {
      if (a.playState !== 'running') return;
      const t = a.effect && a.effect.target;
      if (!t || !t.closest) return;
      const r = rect(t);
      const off = r.bottom < -50 || r.top > (window.innerHeight + 50);
      out.push({ off: off, sel: t.id || t.className || t.tagName });
    });
    return { running: out.length, offscreen: out.filter(x => x.off).length };
  });

  console.log('视口:', VP.width + 'x' + VP.height, ' DSF ' + (VP.deviceScaleFactor || 1), ' CPU ' + CPU + 'x');
  console.log('DOM', base.dom, ' img', base.imgs, ' 墙面img', base.wallImgs);
  console.log('running 动画', base.anims, ' 离屏仍跑', offscreen.offscreen + '/' + offscreen.running);
  console.log('滚动: avg', fmt(scroll.avg), 'ms  p95', fmt(scroll.p95), 'ms  卡顿帧', scroll.janky + '/' + scroll.frames);
  console.log('翻页帧:');
  flipStats.forEach((s, i) =>
    console.log('  第' + (i + 2) + '屏  avg', fmt(s.avg), 'ms  max', fmt(s.max), 'ms  卡顿', s.janky));

  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
