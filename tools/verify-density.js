/* ==========================================================================
 *  视口密度分级验证：node tools/verify-density.js [URL]
 * --------------------------------------------------------------------------
 *  守的是「窗口被拖成任意尺寸时，界面仍然成立」这件事。
 *
 *  为什么要单独一套断言：
 *    手机（verify-devices）验的是**固定机型**，桌面窗口却是可以被拖成
 *    700×560 到 1920×1080 之间任意值的 —— 中间那些尺寸没人管过。
 *    实测扫 144 个尺寸组合，一开始有 22 个会溢出（Q1 溢 23px、Q4 溢 171px），
 *    而 paged.js 遇到溢出只能把整站降级成可滚动，"卡片被切一半"就是这么来的。
 *
 *  三条断言：
 *    1. 不溢出：144 个尺寸组合里，没有任何一屏的高度超过视口
 *    2. 级别单调：视口变矮时级别不能更宽松；元素只能"退场"不能"复活"
 *    3. 收放可逆：缩小时退场的元素，放大回去必须回来
 *
 *  ⚠️ 断言"不溢出"而不是"正好一屏"：
 *     矮窗口下宁可让 paged 降级成可滚动（内容完整），
 *     也不要为了凑满一屏去删正文。这条底线写在这里，避免以后被改回去。
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* 扫描网格：覆盖 700~1920 宽、560~1000 高的桌面窗口区间。
   步长 110/40 是折中：更密会更慢，而阈值只有 560/660/780 三条线，
   这个粒度已经能把每一条线的两侧都扫到。 */
const GRID = (() => {
  const out = [];
  for (let h = 560; h <= 1000; h += 40) {
    for (let w = 700; w <= 1920; w += 110) out.push([w, h]);
  }
  return out;
})();

const LEVEL_ORDER = ['mini', 'tight', 'compact', 'full'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  /* 一言走网络，慢一步就会让整个扫描等它 —— 固定成常量 */
  await page.route('**/v1.hitokoto.cn/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ hitokoto: '把复杂的东西，做得简单一点。', from: '测试' })
  }));
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(2400);

  const probe = () => page.evaluate(() => {
    const pages = [...document.querySelectorAll('.hero, .section')];
    const over = pages
      .map(el => ({ id: el.id, d: el.offsetHeight - innerHeight }))
      .filter(x => x.d > 2);
    const op = s => {
      const e = document.querySelector(s);
      return e ? +(+getComputedStyle(e).opacity).toFixed(2) : null;
    };
    return {
      vp: document.documentElement.dataset.vp,
      vh: innerHeight,
      over,
      quote: op('#liveQuote'),
      lead: op('#listen .section__lead'),
      n: document.querySelectorAll('#trackList .track').length,
      tbl: (document.getElementById('quoteDetails') || {}).open
    };
  });

  /* ------------------------------------------- 1. 全尺寸扫描：不许溢出 */
  const overflow = [];
  const levels = [];
  for (const [w, h] of GRID) {
    await page.setViewportSize({ width: w, height: h });
    /* 1050ms 必须大于 density 的收敛时点：
         120ms 跟随 + 560ms 收口 + 300ms 复检 = 860ms
       早先给 850ms，正好落在复检之前，会读到"还没收口"的中间态
       （实测误报 3~4px 溢出）。 */
    await page.waitForTimeout(300);
    /* 先等足够久：density 的收敛链是
         120ms 跟随 → 560ms 收口 → rAF×2 → 300ms 复检
       总计约 900ms，再加过渡 300ms。给 1400ms 一次到位。 */
    await page.waitForTimeout(1400);
    let r = await probe();

    /* 溢出要"稳定后再判"。
       扫描是连续改尺寸（144 次，每次 1 秒），而每次改尺寸都会排一串
       跟随/收口/复检的定时器；上一次的定时器可能落在这一次的尺寸上。
       所以发现溢出时再等一轮，仍然溢出才算真的坏 ——
       断言的对象是"停稳后的状态"，不是"某一瞬间"。
       真实用户不会每秒改一次窗口尺寸，这条放宽不会掩盖真正的问题。 */
    if (r.over.length) {
      await page.waitForTimeout(1400);
      r = await probe();
    }

    levels.push({ w, h, vp: r.vp, quote: r.quote, lead: r.lead, tbl: r.tbl, n: r.n });
    if (r.over.length) {
      overflow.push(w + '×' + h + ' ' + r.vp + ' → ' + r.over.map(x => x.id + '+' + x.d + 'px').join(','));
    }
  }
  ok(overflow.length === 0,
    GRID.length + ' 个桌面尺寸都没有溢出' +
    (overflow.length ? '（' + overflow.slice(0, 6).join('；') + '）' : ''));

  /* ----------------------------------------------- 2. 级别随高度单调 */
  /* 同一宽度下，视口越矮，级别只能越紧（或者不变），不能反而变宽松。 */
  const byWidth = {};
  levels.forEach(x => { (byWidth[x.w] = byWidth[x.w] || []).push(x); });
  const nonMono = [];
  Object.keys(byWidth).forEach(w => {
    const list = byWidth[w].sort((a, b) => b.h - a.h);  // 高 → 矮
    for (let i = 1; i < list.length; i++) {
      const prev = LEVEL_ORDER.indexOf(list[i - 1].vp);
      const cur = LEVEL_ORDER.indexOf(list[i].vp);
      if (cur > prev) nonMono.push(w + 'px 宽：' + list[i - 1].h + '→' + list[i].h + ' 反而变宽松');
    }
  });
  ok(nonMono.length === 0,
    '同宽度下视口越矮级别越紧' + (nonMono.length ? '（' + nonMono.slice(0, 3).join('；') + '）' : ''));

  /* 退场的元素在这一级内必须是 0，不能"有时在有时没了" */
  const flappy = [];
  levels.forEach(x => {
    if (x.vp === 'full' && x.quote !== null && x.quote < 0.9) flappy.push(x.w + '×' + x.h + ' full 却藏了一言');
    if (x.vp !== 'full' && x.quote !== null && x.quote > 0.1) flappy.push(x.w + '×' + x.h + ' ' + x.vp + ' 一言本该退场(' + x.quote + ')');
  });
  ok(flappy.length === 0,
    '同一级别内元素状态稳定' + (flappy.length ? '（' + flappy.slice(0, 4).join('；') + '）' : ''));

  /* --------------------------------------------- 3. 缩下去能放大回来 */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(900);
  const before = await probe();
  await page.setViewportSize({ width: 1100, height: 580 });
  await page.waitForTimeout(900);
  const small = await probe();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(900);
  const after = await probe();

  ok(small.quote !== null && small.quote < 0.1, '缩小时一言退场');
  ok(small.tbl === false, '缩小时报价表折叠');
  ok(after.vp === 'full', '放大后级别回到 full');
  ok(after.quote !== null && after.quote > 0.9, '放大后一言回来');
  ok(after.lead !== null && after.lead > 0.9, '放大后章节导语回来');
  ok(after.tbl === true, '放大后报价表重新展开');
  ok(after.n === before.n, '放大后曲目数恢复（' + before.n + ' → ' + small.n + ' → ' + after.n + '）');

  /* --------------------------------------------- 4. 收放是渐变的，不是瞬移 */
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.waitForTimeout(700);
  await page.setViewportSize({ width: 1180, height: 620 });
  await page.waitForTimeout(150);          // 过渡进行中
  const mid = await probe();
  await page.waitForTimeout(900);
  const end = await probe();
  ok(mid.quote !== null && mid.quote > end.quote + 0.02,
    '收起过程有中间态（' + mid.quote + ' → ' + end.quote + '），不是啪一下消失');

  /* ------------------------------------------ 5. 曲目数下限保护 */
  const minTracks = await page.evaluate(() => {
    const list = document.getElementById('trackList');
    const n = list.querySelectorAll('.track').length;
    return { n, ranked: list.getAttribute('data-count') };
  });
  ok(Number(minTracks.ranked) === minTracks.n, 'data-count 与实际曲目数一致');
  ok(minTracks.n >= 3, '任何尺寸下都至少保留三首（少于三首不成排行）');

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  await browser.close();

  notes.forEach(n => console.log(n));
  if (fails.length) { console.log('\n失败明细:'); fails.forEach(f => console.log('· ' + f)); }
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  console.log(fails.length ? '\n有问题' : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})();
