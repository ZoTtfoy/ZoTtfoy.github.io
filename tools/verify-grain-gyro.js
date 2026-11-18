#!/usr/bin/env node
/* ==========================================================================
 *  颗粒层视差 + 陀螺仪自检：node tools/verify-grain-gyro.js
 * --------------------------------------------------------------------------
 *  2026-11-18 三项守门：
 *    ① 颗粒层跟随滚动做视差，方向与图片层相反、幅度更小
 *    ② 滚动期间颗粒层**不再 display:none 硬切**（用户反馈的"闪一下"），
 *       只做轻微 opacity 过渡
 *    ③ 移动端 deviceorientation 能驱动视差；桌面 / 减少动效 /
 *       低端档 / parallax=false 均不启用
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = (process.argv[2] || 'http://127.0.0.1:8791/').replace(/\/$/, '/');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);
const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const yOf = v => {
  if (!v) return 0;
  const n = String(v).match(/(-?[\d.]+)px/g);
  return n && n.length ? parseFloat(n[n.length - 1]) : 0;
};

async function ctx(browser, opt) {
  const c = await browser.newContext(opt);
  await c.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r =>
    r.request().resourceType() === 'image'
      ? r.fulfill({ status: 200, contentType: 'image/png', body: BLANK })
      : r.continue());
  return c;
}
const state = page => page.evaluate(() => {
  const g = document.querySelector('.ambient__grain');
  const i = document.querySelector('.ambient__image');
  const cs = getComputedStyle(g);
  return {
    scrolling: document.documentElement.dataset.scrolling,
    display: cs.display, opacity: parseFloat(cs.opacity),
    gTranslate: g.style.translate, iTranslate: i.style.translate,
    gyro: window.SITE_BACKDROP ? window.SITE_BACKDROP.gyro() : null,
    ambientTf: getComputedStyle(document.getElementById('ambient')).transform
  };
});

(async () => {
  const browser = await chromium.launch();

  /* ---------- ①② 桌面：颗粒视差与不闪烁 ---------- */
  const c1 = await ctx(browser, { viewport: { width: 1440, height: 900 } });
  const p1 = await c1.newPage();
  await p1.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p1.waitForTimeout(1700);
  const top = await state(p1);
  ok(top.display === 'block', '颗粒层默认可见（' + top.display + '）');
  ok(Math.abs(yOf(top.gTranslate)) < 1, '顶部时颗粒位移为 0');

  await p1.evaluate(() => window.scrollBy(0, 700));
  const seen = [];
  for (const ms of [80, 250, 600, 1200]) {
    await p1.waitForTimeout(ms === 80 ? 80 : ms - seen[seen.length - 1].ms);
    const s = await state(p1);
    seen.push({ ms, s });
    ok(s.display === 'block', '滚动 +' + ms + 'ms 颗粒层仍为 block（无 display 硬切）');
  }
  const mid = seen.find(x => x.s.scrolling === 'on');
  ok(!!mid, '捕捉到 data-scrolling=on 状态');
  if (mid) {
    ok(mid.s.opacity > 0 && mid.s.opacity < top.opacity,
      '滚动时仅轻微降透明度（' + mid.s.opacity.toFixed(3) + ' vs ' + top.opacity + '），不是隐藏');
  }
  const last = seen[seen.length - 1].s;
  const gY = yOf(last.gTranslate), iY = yOf(last.iTranslate);
  ok(Math.abs(gY) > 1, '颗粒层滚动后发生视差位移（' + gY.toFixed(2) + 'px）');
  ok(Math.abs(iY) > 1, '图片层同样发生视差位移（' + iY.toFixed(2) + 'px）');
  ok(gY * iY < 0, '颗粒与图片位移方向相反（前景/背景分离）');
  ok(Math.abs(gY) < Math.abs(iY), '颗粒幅度小于图片（' + Math.abs(gY).toFixed(2) + ' < ' + Math.abs(iY).toFixed(2) + '）');
  await p1.evaluate(() => window.scrollTo(0, 0));
  await p1.waitForTimeout(1500);
  ok(Math.abs(yOf((await state(p1)).gTranslate)) < 1, '回顶后颗粒位移归零');
  await c1.close();

  /* ---------- ③ 移动端陀螺仪 ---------- */
  const c2 = await ctx(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p2 = await c2.newPage();
  await p2.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  ok((await state(p2)).gyro.on === true, '移动端陀螺仪已启用');

  const fire = async (beta, gamma) => {
    await p2.evaluate(([b, g]) => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',
        { alpha: 0, beta: b, gamma: g, absolute: true }));
    }, [beta, gamma]);
    await p2.waitForTimeout(800);
    return state(p2);
  };
  const a = await fire(60, 12);
  ok(Math.abs(a.gyro.px) > 1 && Math.abs(a.gyro.py) > 1,
    '倾斜事件写入 px/py（' + a.gyro.px.toFixed(1) + ', ' + a.gyro.py.toFixed(1) + '）');
  ok(a.ambientTf !== 'none' && a.ambientTf !== 'matrix(1, 0, 0, 1, 0, 0)',
    '倾斜后 ambient 有位移（' + a.ambientTf + '）');
  const bState = await fire(25, -14);
  ok(bState.gyro.px * a.gyro.px < 0, '反向倾斜后方向翻转');
  ok(Math.abs(bState.gyro.beta) <= 18.001 && Math.abs(bState.gyro.gamma) <= 18.001,
    '角度限幅在 ±18° 内（beta=' + bState.gyro.beta + ', gamma=' + bState.gyro.gamma + '）');
  await c2.close();

  /* ---------- ③ 门禁：不该启用的场景 ---------- */
  const gates = [
    ['桌面', { viewport: { width: 1440, height: 900 } }, ''],
    ['移动端+减少动效', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' }, ''],
    ['移动端+低端档', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, '&perf=low']
  ];
  for (const [name, opt, q] of gates) {
    const c = await ctx(browser, opt);
    const p = await c.newPage();
    await p.goto(SITE + '?bg=0' + q, { waitUntil: 'load' });
    await p.waitForTimeout(700);
    ok((await state(p)).gyro.on === false, name + '不启用陀螺仪');
    await c.close();
  }

  await browser.close();
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch(e => { console.error('ERR', e); process.exit(2); });
