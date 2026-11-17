#!/usr/bin/env node
/* ==========================================================================
 *  刷新归位自检：node tools/verify-refresh.js
 * --------------------------------------------------------------------------
 *  2026-11-18 定稿行为：**刷新一律回第一屏（top / 主页屏）**。
 *  屏序：0:top(主页) 1:about 2:listen(音乐) 3:gaming(游戏) 4:links 5:contact
 *
 *  ⚠️ 历史教训：曾误把需求理解成"记住当前屏并恢复"，用 sessionStorage
 *     记忆页索引。结果记忆值一旦是 2/3，人在主页屏刷新也会被强行拉到
 *     音乐/游戏屏 —— 用户反复反馈的"刷新跳到第三屏"就是这么来的。
 *     现在整套记忆机制已删除，本自检守住正确行为，防止再被改回去。
 *
 *  守四条：
 *    ① 在任意屏刷新，都回到主页屏（y=0）
 *    ② 即使 sessionStorage 里残留脏值 2/3，也不影响落点
 *    ③ 显式 URL hash 仍优先（外部链接能直达指定屏）
 *    ④ 加载期干扰（强行滚动 + resize）不能把页面带离主页屏；
 *       但用户主动翻页必须能立刻接管，不被守卫拉回
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
  active: document.querySelector('.section.is-page-active')?.id || ''
}));

(async () => {
  const browser = await chromium.launch();

  /* ---------- ① 在任意屏刷新，都回主页屏 ---------- */
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
    await p.waitForTimeout(2200);
    const after = await state(p);
    ok(after.y === 0, '从第 ' + (i + 1) + ' 屏刷新后回到主页屏（y=' + after.y + '）');
  }
  await ctx.close();

  /* ---------- ② 脏记忆值不影响落点 ----------
     模拟历史遗留：sessionStorage 里残留 zotrod-page=2（音乐屏）。
     现在代码不该再读它，刷新仍应回主页屏。 */
  const ctx2 = await newCtx(browser);
  const p2 = await ctx2.newPage();
  await p2.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  await p2.evaluate(() => sessionStorage.setItem('zotrod-page', '2'));
  await p2.reload({ waitUntil: 'load' });
  await p2.waitForTimeout(2200);
  const dirty = await state(p2);
  ok(dirty.y === 0, '残留脏值 zotrod-page=2 时，刷新仍回主页屏（y=' + dirty.y + '）');
  await ctx2.close();

  /* ---------- ③ 显式 hash 仍优先 ---------- */
  const ctx3 = await newCtx(browser);
  const p3 = await ctx3.newPage();
  await p3.goto(SITE + '?bg=0#about', { waitUntil: 'load' });
  await p3.waitForTimeout(1900);
  const h = await state(p3);
  ok(h.y > 0 && Math.abs(h.y - h.vh) < 12,
    '显式 #about 直达关于我屏（y=' + h.y + '）');
  await ctx3.close();

  /* ---------- ④ 加载期干扰不能带偏，用户能立刻接管 ---------- */
  const ctx4 = await newCtx(browser);
  const p4 = await ctx4.newPage();
  await p4.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p4.waitForTimeout(900);
  await p4.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      let n = 0;
      const tick = () => {
        n++;
        window.scrollTo(0, n % 2 ? 1800 : 2700);   // 故意带到音乐/游戏屏
        window.dispatchEvent(new Event('resize'));
        if (n < 10) setTimeout(tick, 120);
      };
      setTimeout(tick, 60);
    });
  });
  await p4.reload({ waitUntil: 'load' });
  await p4.waitForTimeout(2600);
  const hostile = await state(p4);
  ok(hostile.y === 0, '加载期被反复带偏+resize，最终仍回主页屏（y=' + hostile.y + '）');

  await ctx4.close();

  /* 用户主动翻页（用干净页面，避免上一个用例注入的干扰脚本继续捣乱） */
  const ctx5 = await newCtx(browser);
  const p5 = await ctx5.newPage();
  await p5.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p5.waitForTimeout(350);
  await p5.evaluate(() => window.SITE_PAGED.goTo(3));
  await p5.waitForTimeout(1600);
  const taken = await state(p5);
  ok(Math.abs(taken.y - 3 * taken.vh) < 12,
    '用户主动翻页可立即接管，不被守卫拉回（y=' + taken.y + '）');
  await ctx5.close();

  await browser.close();
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch(e => { console.error('ERR', e); process.exit(2); });
