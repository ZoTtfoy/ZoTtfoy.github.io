/* ==========================================================================
 *  Steam 拼贴背景验证：node tools/verify-steam.js [URL]
 * --------------------------------------------------------------------------
 *  守三件事：
 *    1. 数据链：data/steam.json 有真实 appid（来自公开库存），
 *       或者 config 里有 fallbackApps 快照 —— 两者至少有一个
 *    2. 渲染：拼贴格子铺出来了、图真的加载了、旋转是 -45°、遮罩在
 *    3. 交互：滚动只沿图片自身的垂直方向位移（translate3d 的 X 恒为 0），
 *       速度倍率生效（0 = 完全静止）
 *
 *  ⚠️ 为什么断言"X 恒为 0"而不是"看起来是垂直的"：
 *     网格先 rotate(-45°) 再 translate，所以局部 Y 轴在屏幕上指向右下。
 *     只改 Y = 顺着 45° 斜纹滑，这才是"贴合图片垂直方向"。
 *     如果同时改 X，就变成斜向漂移 —— 视觉上完全不同。
 * ========================================================================== */
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(SITE);
const notes = [], fails = [], skips = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push('· ' + m);
const skip = (m) => skips.push(m);

(async () => {
  /* --------------------------------------------- 1. 数据链（本地可查文件） */
  if (IS_LOCAL) {
    const p = path.resolve(process.cwd(), 'data/steam.json');
    let d = null;
    try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* 缺失 */ }
    ok(!!d, 'data/steam.json 存在');

    if (d) {
      const apps = Array.isArray(d.apps) ? d.apps : [];
      ok(apps.length > 0, 'data/steam.json 里有 appid（' + apps.length + ' 个，来源 ' + (d.source || '?') + '）');
      ok(apps.every(a => Number.isInteger(a) && a > 0), 'appid 都是正整数');
      /* 753 是 Steam 平台本身，不是游戏 —— 混进来会铺出一堆非游戏封面 */
      ok(!apps.includes(753), 'appid 列表里没有 Steam 平台本体（753）');
      if (d.source === 'inventory') {
        ok(Number(d.inventoryTotal) > 0, '记录了库存总数（' + d.inventoryTotal + ' 件）');
        ok(Array.isArray(d.events) && d.events.length >= 0,
          '特卖活动的 appid 单独存放，没有混进背景（' + (d.events || []).length + ' 个）');
      }
      if (!apps.length) skip('appid 为空，前端会用 config 的 fallbackApps 快照');
    }
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.route('**/v1.hitokoto.cn/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"hitokoto":"x","from":"x"}'
  }));
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(2400);
  /* gaming 排第几屏由 config 的 sections.*.order 决定，不写死数字 ——
     写死的话一调顺序，这段就失效，而且失效得很安静：
     gaming 在视口外 → update() 直接 return → transform 是空字符串。 */
  const gIdx = await page.evaluate(() =>
    window.SITE_PAGED.pages().findIndex(e => e && e.id === 'gaming'));
  const lastIdx = await page.evaluate(() => window.SITE_PAGED.pages().length - 1);
  await page.evaluate(i => window.SITE_PAGED.goTo(i), gIdx);
  await page.waitForTimeout(2400);

  /* ------------------------------------------------------- 2. 渲染 */
  const r = await page.evaluate(() => {
    const wall = document.getElementById('steamWall');
    const grid = document.getElementById('steamWallGrid');
    const tiles = [...document.querySelectorAll('.steamwall__tile')];
    if (!wall || !grid) return null;
    const cs = getComputedStyle(grid);
    const m = new DOMMatrix(cs.transform);
    return {
      hidden: wall.hidden,
      tiles: tiles.length,
      loaded: tiles.filter(t => {
        const i = t.querySelector('img');
        return i && i.complete && i.naturalWidth > 0;
      }).length,
      /* 旋转角：matrix 的 a/b = cos/sin。rotate(-45°) → a≈0.707, b≈-0.707 */
      rotA: +m.a.toFixed(3), rotB: +m.b.toFixed(3),
      hasScrim: !!document.querySelector('.steamwall__scrim'),
      ariaHidden: wall.getAttribute('aria-hidden'),
      pointerNone: cs.pointerEvents === 'none' ||
        getComputedStyle(wall).pointerEvents === 'none',
      gridBiggerThanSection: (() => {
        const gb = grid.getBoundingClientRect();
        const sb = document.getElementById('gaming').getBoundingClientRect();
        return gb.width > sb.width && gb.height > sb.height;
      })(),
      apps: window.SITE_STEAMWALL ? window.SITE_STEAMWALL.apps().length : -1,
      speed: window.SITE_STEAMWALL ? window.SITE_STEAMWALL.speed() : null
    };
  });

  ok(!!r, '拼贴背景节点存在');
  if (r) {
    ok(!r.hidden, '背景没有被隐藏');
    ok(r.tiles > 0, '铺出了拼贴格子（' + r.tiles + ' 个）');
    ok(r.apps > 0, '有可用的 appid 列表（' + r.apps + ' 个）');
    ok(r.loaded > 0, '封面图真的加载了（' + r.loaded + '/' + r.tiles + '）');
    /* 45°：cos45 = sin(-45) = 0.7071 */
    ok(Math.abs(r.rotA - 0.7071) < 0.01 && Math.abs(r.rotB + 0.7071) < 0.01,
      '网格旋转 -45°（a=' + r.rotA + ', b=' + r.rotB + '）');
    ok(r.hasScrim, '有遮罩层（不然文字会被封面图案吃掉对比度）');
    ok(r.ariaHidden === 'true', '背景对读屏隐藏（纯装饰）');
    ok(r.pointerNone, '背景不吃鼠标事件');
    ok(r.gridBiggerThanSection, '网格尺寸大于该屏（旋转后四角才不会露白）');
  }

  /* ------------------------------------- 3. 滚动方向：只沿图片垂直方向
     ⚠️ 两个坑都在这一版才暴露：
       ① 位移已经从「整个网格」挪到了「每一列」——网格只负责 rotate(-45deg)。
          拆列是为了让每列能有不同移速，所以这里必须读 .steamwall__col。
       ② 页码不能写死。gaming 排第几屏由 config 的 sections.*.order 决定，
          写死 goTo(1)/goTo(3) 的话，一调顺序就整段失效（而且失效得很安静：
          gaming 在视口外，update() 直接 return，transform 是空字符串）。 */
  ok(gIdx > 0, 'gaming 有独立的页码（第 ' + (gIdx + 1) + ' 屏）');
  const prevIdx = Math.max(0, gIdx - 1);
  const nextIdx = Math.min(lastIdx, gIdx + 1);

  /* 读出所有列的 transform。列数固定 7，相邻页各取一次就够判断方向了。 */
  const colsAt = async (idx) => {
    await page.evaluate(i => window.SITE_PAGED.goTo(i), idx);
    await page.waitForTimeout(1400);
    return page.evaluate(() => [...document.querySelectorAll('.steamwall__col')].map(c => ({
      t: c.style.transform || '',
      f: +getComputedStyle(c).getPropertyValue('--col-speed') || 1
    }))).then(list => list.map(o => {
      const m = /translate3d\(\s*([-\d.]+)(?:px|%)\s*,\s*([-\d.]+)%/.exec(o.t);
      return { x: m ? +m[1] : null, y: m ? +m[2] : null, f: o.f, raw: o.t };
    }));
  };

  const A = await colsAt(prevIdx);
  const B = await colsAt(nextIdx);

  ok(A.length > 1 && A.every(c => c.y !== null) && B.every(c => c.y !== null),
    '每列都有 translate3d（' + A.length + ' 列，首列 ' + (A[0] && A[0].raw || '空') + '）');

  if (A.every(c => c.y !== null) && B.every(c => c.y !== null)) {
    ok(A.concat(B).every(c => c.x === 0),
      '位移的 X 分量恒为 0 —— 只沿图片自身的垂直方向滑（' +
      A.map(c => c.x).join('/') + '）');
    ok(A.some((c, i) => c.y !== B[i].y),
      '滚动时 Y 确实变了（' + A.map(c => c.y).join('/') + ' → ' + B.map(c => c.y).join('/') + '）');

    /* 每列移速不同 —— 这是纵深感的来源，也是这一版的主要改动。 */
    const absA = A.map(c => Math.abs(c.y)).filter(v => v > 0);
    const spread = absA.length > 1 ? Math.max(...absA) / Math.min(...absA) : 1;
    ok(spread > 1.5,
      '同一时刻各列位移互不相同（最快是最慢的 ' + spread.toFixed(2) + ' 倍）');
    ok(new Set(A.map(c => c.f.toFixed(2))).size === A.length,
      '每列的 --col-speed 倍率各不相同（' + A.map(c => c.f.toFixed(2)).join(' / ') + '）');
  }

  /* --------------------------------------------- 4. 速度可调 */
  const measure = async (sp) => {
    await page.evaluate(s => window.SITE_STEAMWALL.setSpeed(s), sp);
    const p = await colsAt(prevIdx);
    const n = await colsAt(nextIdx);
    /* 用「各列位移变化量的最大值」衡量，避免刚好抽到最慢的那一列 */
    return Math.max(...p.map((c, i) => Math.abs((n[i].y || 0) - (c.y || 0))));
  };

  const d0 = await measure(0);
  const d1 = await measure(1);
  const d3 = await measure(3);
  ok(d0 < 0.2, 'speed=0 时完全静止（ΔY=' + d0.toFixed(2) + '）');
  ok(d1 > 1, 'speed=1 时有位移（ΔY=' + d1.toFixed(2) + '）');
  ok(d3 > d1 * 1.8, 'speed=3 明显比 speed=1 快（' + d3.toFixed(1) + ' vs ' + d1.toFixed(1) + '）');
  await page.evaluate(() => window.SITE_STEAMWALL.setSpeed(1));

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  await browser.close();

  notes.forEach(n => console.log(n));
  skips.forEach(s => console.log('--  ' + s));
  if (fails.length) { console.log('\n失败明细:'); fails.forEach(f => console.log(f)); }
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length
    + (skips.length ? '，跳过: ' + skips.length : ''));
  console.log(fails.length ? '\n有问题' : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})();
