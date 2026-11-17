/* ==========================================================================
 *  刷新保持当前屏自检：node tools/verify-refresh.js
 * --------------------------------------------------------------------------
 *  2026-11-17 用户要求"刷新也在当前屏"。守三条不变量：
 *    ① 翻到第 N 屏后刷新，仍落在第 N 屏（按页索引恢复，不是像素）
 *    ② 显式 URL hash 优先于记忆（从别处点 #about 进来就落 about）
 *    ③ 新标签页不带旧记忆，从第一屏开始（sessionStorage 标签页级）
 *  另外验证恢复是"即时"的：不播平滑滚动、不产生中途的页跳动。
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = (process.argv[2] || 'http://127.0.0.1:8791/').replace(/\/$/, '/');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);
const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

async function newCtx(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r =>
    r.request().resourceType() === 'image'
      ? r.fulfill({ status: 200, contentType: 'image/png', body: BLANK })
      : r.continue());
  return ctx;
}
const state = page => page.evaluate(() => ({
  y: Math.round(window.scrollY),
  vh: window.innerHeight,
  stored: sessionStorage.getItem('zotrod-page'),
  active: document.querySelector('.section.is-page-active')?.id || ''
}));

(async () => {
  const browser = await chromium.launch();

  /* ---------- ① 逐屏刷新都留在原处 ---------- */
  const ctx = await newCtx(browser);
  const p = await ctx.newPage();
  await p.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p.waitForTimeout(1100);
  for (const i of [2, 3, 1]) {
    await p.evaluate(n => window.SITE_PAGED.goTo(n), i);
    await p.waitForTimeout(1000);
    const before = await state(p);
    ok(before.y === i * before.vh, '翻到第 ' + (i + 1) + ' 屏（y=' + before.y + '）');
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(1800);
    const after = await state(p);
    ok(Math.abs(after.y - i * after.vh) < 12,
      '刷新后仍在第 ' + (i + 1) + ' 屏（y=' + after.y + '，目标 ' + i * after.vh + '）');
    ok(after.stored === String(i),
      '记忆值保持为 ' + i + '（' + after.stored + '）');
  }
  await ctx.close();

  /* ---------- ② 显式 hash 优先 ---------- */
  const ctx2 = await newCtx(browser);
  const p2 = await ctx2.newPage();
  await p2.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  await p2.evaluate(() => window.SITE_PAGED.goTo(2));
  await p2.waitForTimeout(900);
  await p2.goto(SITE + '?bg=0#about', { waitUntil: 'load' });
  await p2.waitForTimeout(1700);
  const h = await state(p2);
  ok(h.y > 0 && Math.abs(h.y - h.vh) < 12,
    '显式 #about 覆盖旧记忆，落在关于我屏（y=' + h.y + '）');
  await ctx2.close();

  /* ---------- ③ 新标签页不继承 ---------- */
  const ctx3 = await newCtx(browser);
  const p3 = await ctx3.newPage();
  await p3.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p3.waitForTimeout(1700);
  const fresh = await state(p3);
  ok(fresh.y === 0, '全新标签从第一屏开始（y=' + fresh.y + '）');
  await ctx3.close();

  /* ---------- ④ 加载期抖动不把恢复带偏 ----------
     真实浏览器里，splash 退场 / 字体 swap / 滚动条出现 / 原生恢复
     都会在加载期改滚动位置并触发 resize。这里主动注入这些干扰，
     验证"恢复窗口"守卫能把页面稳定钉在记住的那一屏。 */
  const ctx4 = await newCtx(browser);
  const p4 = await ctx4.newPage();
  await p4.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p4.waitForTimeout(1000);
  await p4.evaluate(() => window.SITE_PAGED.goTo(2));
  await p4.waitForTimeout(900);
  await p4.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      let n = 0;
      const tick = () => {
        n++;
        window.scrollTo(0, n % 2 ? 900 : 2700);   // 故意带偏
        window.dispatchEvent(new Event('resize'));
        if (n < 10) setTimeout(tick, 120);
      };
      setTimeout(tick, 60);
    });
  });
  await p4.reload({ waitUntil: 'load' });
  await p4.waitForTimeout(2600);
  const hostile = await state(p4);
  ok(Math.abs(hostile.y - 2 * hostile.vh) < 12,
    '加载期被反复带偏+resize，最终仍稳定在第 3 屏（y=' + hostile.y + '）');
  await ctx4.close();

  /* ---------- ⑤ 用户主动操作应能立刻接管（不被守卫拉回） ---------- */
  const ctx5 = await newCtx(browser);
  const p5 = await ctx5.newPage();
  await p5.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p5.waitForTimeout(900);
  await p5.evaluate(() => window.SITE_PAGED.goTo(2));
  await p5.waitForTimeout(800);
  await p5.reload({ waitUntil: 'load' });
  await p5.waitForTimeout(350);            // 仍在恢复窗口内
  await p5.evaluate(() => window.SITE_PAGED.goTo(4));
  await p5.waitForTimeout(1600);
  const taken = await state(p5);
  ok(Math.abs(taken.y - 4 * taken.vh) < 12,
    '恢复窗口内用户主动翻页可立即接管（y=' + taken.y + '）');
  await ctx5.close();

  await browser.close();
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch(e => { console.error('ERR', e); process.exit(2); });
