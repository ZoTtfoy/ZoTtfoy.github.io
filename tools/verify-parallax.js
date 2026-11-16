/* ==========================================================================
 *  滚动视差自检：确认效果真的会动、方向正确、且不露出背景图边缘。
 * --------------------------------------------------------------------------
 *  起因（2026-11-17）：视差代码写了却长期失效 —— hasImage 在 setImage 的
 *  异步 onload 之前被快照成 false，loop 里的位移分支从不执行。加这条闸门
 *  防止"开关打开但效果没动"再次溜过去。
 *
 *  验证：
 *    · config.backdrop.parallax 打开、且系统未要求减少动效时，滚动会写
 *      imageEl.style.translate，方向与滚动相反（向上滚 → 图片下移补偿）
 *    · 位移幅度不超过视口高度的 4%+1px（与 backdrop.js 的 maxShift 对齐），
 *      确保小于 .ambient__image 的 inset:-6% 余量，不露边
 *    · 回到顶部后位移归零
 *    · prefers-reduced-motion 下不启用视差（位移始终为空）
 * ========================================================================== */
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

function parseTranslate(v) {
  // 浏览器回读形如 "0px -36px"：第一个是 X，第二个才是 Y（视差位移）。
  // 必须取最后一个带 px 的数，否则会误读成 X=0，误判"视差没动"。
  if (!v) return 0;
  const nums = String(v).match(/(-?[\d.]+)px/g);
  return nums && nums.length ? parseFloat(nums[nums.length - 1]) : 0;
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- 正常动效档 ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK })
      : route.continue());
  const page = await ctx.newPage();
  await page.goto(URL + '?bg=0', { waitUntil: 'load' });
  await page.waitForTimeout(2600); // 等背景图 onload + 入场

  const enabled = await page.evaluate(() =>
    window.SITE_CONFIG && window.SITE_CONFIG.backdrop &&
    window.SITE_CONFIG.backdrop.parallax === true &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches &&
    document.documentElement.dataset.backdropImage === 'on');
  ok(enabled, '视差开关打开且背景图已加载（具备生效前提）');

  const atTop = parseTranslate(await page.evaluate(() =>
    document.getElementById('ambientImage').style.translate));
  ok(Math.abs(atTop) < 1, '顶部时位移为 0（' + atTop.toFixed(2) + 'px）');

  // 滚到第二屏（约 900px）
  await page.evaluate(() => {
    const p = window.SITE_PAGED.pages()[1];
    window.scrollTo(0, Math.round(p.getBoundingClientRect().top + window.scrollY));
  });
  await page.waitForTimeout(1600); // smoothScrollY 以 0.08 逐帧逼近，等它收敛

  const scrollY = await page.evaluate(() => Math.round(window.scrollY));
  const shifted = parseTranslate(await page.evaluate(() =>
    document.getElementById('ambientImage').style.translate));
  ok(scrollY > 400, '确实滚动到了下一屏（scrollY=' + scrollY + '）');
  ok(Math.abs(shifted) > 1, '滚动后图片发生位移（' + shifted.toFixed(2) + 'px）—— 视差真的在动');
  ok(shifted < 0, '位移方向与滚动相反（向上滚 → translate 为负，' + shifted.toFixed(2) + 'px）');

  const limit = Math.min(40, Math.round(900 * 0.04)) + 1;
  ok(Math.abs(shifted) <= limit,
    '位移 ' + Math.abs(shifted).toFixed(2) + 'px ≤ ' + limit + 'px（小于 inset:-6% 余量，不露边）');

  // 滚回顶部
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1600);
  const backTop = parseTranslate(await page.evaluate(() =>
    document.getElementById('ambientImage').style.translate));
  ok(Math.abs(backTop) < 1, '滚回顶部后位移归零（' + backTop.toFixed(2) + 'px）');
  await ctx.close();

  /* ---------- 减少动效档 ---------- */
  const ctx2 = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce'
  });
  await ctx2.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK })
      : route.continue());
  const page2 = await ctx2.newPage();
  await page2.goto(URL + '?bg=0', { waitUntil: 'load' });
  await page2.waitForTimeout(1200);
  await page2.evaluate(() => window.scrollTo(0, 900));
  await page2.waitForTimeout(600);
  const rmShift = parseTranslate(await page2.evaluate(() =>
    document.getElementById('ambientImage').style.translate));
  ok(Math.abs(rmShift) < 1,
    '减少动效下视差不启用（位移 ' + rmShift.toFixed(2) + 'px）');
  await ctx2.close();

  await browser.close();
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch(e => { console.error(e); process.exit(2); });
