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
 *  ⚠️⚠️ 2026-11-19 第四轮根因（前三轮全绿却仍复现）：
 *     motion.js 点锚点会 pushState 把 #listen / #gaming 写进 URL，
 *     首屏最显眼的主按钮就是 #listen。用户点过它之后按 F5，URL 仍带
 *     #listen，而 paged.js 原本把「有 hash」一律当外部深链处理 →
 *     jumpToHash(2) 直接送到第三屏，绕过「刷新回主页屏」。
 *     之前所有用例都用无 hash 的 ?bg=N URL，从没覆盖这条最典型路径。
 *     修复：用 Navigation Timing 的 type==='reload' 区分刷新与深链，
 *     刷新时忽略 hash、清掉 URL 残留并回主页；外部深链仍直达。
 *
 *  守五条：
 *    ① 在任意屏刷新，都回到主页屏（y=0）
 *    ② 即使 sessionStorage 里残留脏值 2/3，也不影响落点
 *    ③ 外部深链首次打开仍直达指定屏
 *    ④ 加载期干扰不能把页面带离主页屏；用户主动翻页能立刻接管
 *    ⑤ 【真实路径】点首屏主按钮产生 #listen 后刷新 → 回主页且清 hash；
 *       多种 hash 值刷新同样回主页（这条就是之前漏掉的）
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

  /* ---------- ③ 外部深链首次打开仍直达 ---------- */
  const ctx3 = await newCtx(browser);
  const p3 = await ctx3.newPage();
  await p3.goto(SITE + '?bg=0#about', { waitUntil: 'load' });
  await p3.waitForTimeout(1900);
  const h = await state(p3);
  ok(h.y > 0 && Math.abs(h.y - h.vh) < 12,
    '外部深链 #about 直达关于我屏（y=' + h.y + '）');
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

  /* ---------- ⑤ 真实路径：点主按钮产生 #listen 后刷新 ----------
     这正是用户反复反馈的操作序列，也是前三轮自检漏掉的用例。 */
  const ctx6 = await newCtx(browser);
  const p6 = await ctx6.newPage();
  await p6.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await p6.waitForTimeout(1300);
  const href = await p6.evaluate(() => {
    const a = document.getElementById('heroPrimary');
    if (!a) return null;
    a.click();
    return a.getAttribute('href');
  });
  ok(href === '#listen', '首屏主按钮指向 #listen（实际 ' + href + '）');
  await p6.waitForTimeout(1400);
  ok(p6.url().includes('#listen'), '点击后 URL 带上 #listen');
  const onListen = await state(p6);
  ok(onListen.y > 0, '点击后确实到了听歌屏（y=' + onListen.y + '）');

  await p6.reload({ waitUntil: 'load' });
  await p6.waitForTimeout(2400);
  const afterReload = await state(p6);
  ok(afterReload.y === 0,
    '★ 带 #listen 刷新后回到主页屏（y=' + afterReload.y + '）');
  ok(!p6.url().includes('#listen'), '刷新时清掉了 URL 残留的 hash');

  // 连刷第二次仍稳（hash 已清，且不会因历史状态再被带偏）
  await p6.reload({ waitUntil: 'load' });
  await p6.waitForTimeout(2200);
  ok((await state(p6)).y === 0, '再次刷新仍回主页屏');

  // 刷新之后用户主动翻页仍可正常接管
  await p6.evaluate(() => window.SITE_PAGED.goTo(2));
  await p6.waitForTimeout(1300);
  const canNav = await state(p6);
  ok(Math.abs(canNav.y - 2 * canNav.vh) < 12,
    '刷新后主动翻页不受影响（y=' + canNav.y + '）');
  await ctx6.close();

  /* ---------- ⑤b 多种 hash 值刷新一律回主页 ---------- */
  const ctx7 = await newCtx(browser);
  const p7 = await ctx7.newPage();
  for (const hsh of ['#gaming', '#about', '#top']) {
    await p7.goto(SITE + '?bg=0' + hsh, { waitUntil: 'load' });
    await p7.waitForTimeout(1700);
    await p7.reload({ waitUntil: 'load' });
    await p7.waitForTimeout(2200);
    const y = (await state(p7)).y;
    ok(y === 0, '深链 ' + hsh + ' 刷新后回主页屏（y=' + y + '）');
  }
  await ctx7.close();

  await browser.close();
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch(e => { console.error('ERR', e); process.exit(2); });
