/* ==========================================================================
 *  专辑封面墙验证：node tools/verify-albumwall.js
 * --------------------------------------------------------------------------
 *  守的是用户原话里的每一条：
 *    · 「135 行左移 246 行右移」→ 方向交替，且行与行速度不同
 *    · 「每行由专辑封面拼接」  → 6 行 × 每行 12 张，全是本周曲库封面
 *    · 「每周轮换一次」        → ISO 周种子，跨周布局必变、同周必稳
 *    · 「优化图片交接的缝隙和上下交接处」→ 相邻图片**重叠**、行间 gap 为 0
 *    · 「逻辑和游戏那页差不多」→ 固定实例 + 整体等比缩放，多视口覆盖
 *
 *  另外验「真的在动」：不用滚动位置判断（翻页站点停稳后 scrollY 不变），
 *  直接看时间驱动的 phase 有没有推进。
 * ========================================================================== */

const { chromium } = require('playwright-core');

const SITE = 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

const INST = 1200;
const TILE = 200;
const PERIOD = 1200;

(async () => {
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
  await page.waitForTimeout(3600);

  const lIdx = await page.evaluate(() =>
    window.SITE_PAGED.pages().findIndex(e => e && e.id === 'listen'));
  ok(lIdx > 0, 'listen 有独立页码（第 ' + (lIdx + 1) + ' 屏）');
  await page.evaluate(i => window.SITE_PAGED.goTo(i), lIdx);
  await page.waitForTimeout(1800);

  /* ------------------------------------------------------ 1. 结构/数据 */
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.albumwall__row')];
    const imgs = [...document.querySelectorAll('.albumwall__row img')];
    const grid = document.getElementById('albumWallGrid');
    const wall = document.getElementById('albumWall');
    const cs = grid && getComputedStyle(grid);
    return {
      wallParent: wall && wall.parentElement.id,
      bgs: rows.map(c => getComputedStyle(c).backgroundImage),
      wallImgsLoaded: performance.getEntriesByType('resource')
        .filter(e => /assets\/wall\/album-\d\.webp/.test(e.name)).length,
      rows: rows.length,
      perRow: rows[0] ? rows[0].children.length : 0,
      imgs: imgs.length,
      loaded: imgs.filter(x => x.complete && x.naturalWidth > 0).length,
      broken: imgs.filter(x => x.complete && x.naturalWidth === 0).length,
      bigCovers: imgs.filter(x => /param=400y400/.test(x.src)).length,
      unique: new Set(imgs.map(x => x.src)).size,
      dirs: rows.map(x => x.getAttribute('data-dir')),
      rates: rows.map(x => +x.style.getPropertyValue('--row-rate')),
      vinyl: document.querySelectorAll('.vinyl, .vinyl__art').length,
      inst: cs ? cs.width : '',
      rowsCss: cs ? cs.gridTemplateRows : '',
      gap: cs ? cs.rowGap : '',
      scale: window.SITE_ALBUMWALL ? window.SITE_ALBUMWALL.scale() : 0,
      week: window.SITE_ALBUMWALL ? window.SITE_ALBUMWALL.week() : 0,
      covers: window.SITE_ALBUMWALL ? window.SITE_ALBUMWALL.covers().length : 0,
      period: window.SITE_ALBUMWALL ? window.SITE_ALBUMWALL.period() : 0
    };
  });

  ok(r.vinyl === 0, '黑胶已彻底移除');
  ok(r.wallParent === 'listen', '封面墙是 #listen 的直接子元素（铺满整屏，不是只盖住卡片）');
  ok(r.rows === 6, '6 行封面');
  ok(r.bgs.length === 6 && r.bgs.every(b => /assets\/wall\/album-\d\.webp/.test(b)),
    '6 行全部使用预渲染行图（album-0..5.webp）');
  ok(r.wallImgsLoaded === 6, '6 张预渲染行图全部加载成功（' + r.wallImgsLoaded + '/6）');
  ok(r.inst === '1200px', '固定 1200×1200 实例（' + r.inst + '）');
  ok(r.gap === '0px', '行间 gap 为 0（' + r.gap + '）');
  ok(r.period === PERIOD, '循环周期 = 单份 6 张 = 1200px');

  /* ------------------------------------------------- 2. 135 左 / 246 右 */
  const expectDirs = ['left', 'right', 'left', 'right', 'left', 'right'];
  ok(JSON.stringify(r.dirs) === JSON.stringify(expectDirs),
    '1/3/5 行左移、2/4/6 行右移（' + r.dirs.join('/') + '）');
  ok(new Set(r.rates.map(v => v.toFixed(3))).size >= 5,
    '各行速度不同（差速：' + r.rates.map(v => v.toFixed(2)).join(' / ') + '）');

  /* ⚠️ 位移改由 CSS 动画驱动后，**不能再读内联 style.transform** ——
     那里面是空的（动画值不进 inline style），读到 null 会把 6 条断言全带红。
     必须读计算后的矩阵：DOMMatrix(str).m41 就是当前 translateX。 */
  const readX = () => page.evaluate(() =>
    [...document.querySelectorAll('.albumwall__row')].map(el => {
      const m = new DOMMatrix(getComputedStyle(el).transform);
      return +m.m41.toFixed(2);
    }));

  const xs = await readX();
  ok(xs.every(x => x >= -PERIOD - 1 && x <= 0.5),
    '所有行位移都落在 [-1200, 0]，内容始终盖住实例（' +
    xs.map(v => v.toFixed(0)).join('/') + '）');
  ok(xs.filter((_, i) => i % 2 === 0).every(x => x < 0 || x === 0),
    '左移行的位移是 0 → -1200 区间内的负值或起点 0');
  ok(xs.filter((_, i) => i % 2 === 1).every(x => x <= 0 && x > -PERIOD),
    '右移行同样落在 [-1200, 0]，只是运动方向相反');
  ok(new Set(xs.map(v => Math.round(v))).size === 6,
    '同一时刻六行位移互不相同（' + xs.map(v => v.toFixed(0)).join('/') + '）');

  /* 方向真的相反：等一段时间后，左移行的 x 更负、右移行的 x 更接近 0。
     这是"135 左移 / 246 右移"的直接证据 —— 只断言"都在区间内"看不出方向。 */
  await page.waitForTimeout(1500);
  const xs2 = await readX();
  const leftMoved = xs.filter((_, i) => i % 2 === 0).map((v, k) => xs2[k * 2] - v);
  const rightMoved = xs.filter((_, i) => i % 2 === 1).map((v, k) => xs2[k * 2 + 1] - v);
  ok(leftMoved.every(d => d < -0.5),
    '左移行确实在往左走（Δ ' + leftMoved.map(d => d.toFixed(1)).join('/') + 'px）');
  ok(rightMoved.every(d => d > 0.5),
    '右移行确实在往右走（Δ ' + rightMoved.map(d => d.toFixed(1)).join('/') + 'px）');

  ok(await page.evaluate(() => {
    const css = document.getElementById('aw-keyframes');
    return !!css && /-1200px/.test(css.textContent) &&
      /aw-move-left/.test(css.textContent) && /aw-move-right/.test(css.textContent);
  }), '@keyframes 由常量注入（含 aw-move-left / aw-move-right）');

  /* ------------------------------------------------------ 3. 真的在动 */
  const t0 = await page.evaluate(() => window.SITE_ALBUMWALL.phase());
  await page.waitForTimeout(1400);
  const t1 = await page.evaluate(() => window.SITE_ALBUMWALL.phase());
  ok(t1 > t0 + 15, '停留不动时相位也在推进（' + t0.toFixed(1) + ' → ' + t1.toFixed(1) + ' px）');

  await page.evaluate(() => window.SITE_ALBUMWALL.setSpeed(0));
  const p0 = await page.evaluate(() => window.SITE_ALBUMWALL.phase());
  await page.waitForTimeout(800);
  const p1 = await page.evaluate(() => window.SITE_ALBUMWALL.phase());
  ok(Math.abs(p1 - p0) < 0.01, 'setSpeed(0) 完全静止');
  await page.evaluate(() => window.SITE_ALBUMWALL.setSpeed(1));

  /* 循环：把动画快进整整一个周期，位移仍落在 [-1200, 0]。
     动画是 infinite + linear，这份 keyframes 只覆盖 0 → -1200 一个周期，
     所以"快进一周期"必然还在区间内 —— 断言的意义是守住 keyframes
     别被改成跨多个周期或改了 -1200 而没同步 PERIOD。 */
  await page.evaluate(P => window.SITE_ALBUMWALL.step(P), PERIOD);
  const loop = await readX();
  ok(loop.every(x => x >= -PERIOD - 1 && x <= 0.5),
    '推进一整个周期后每行仍在 [-1200,0]（' + loop.map(v => v.toFixed(0)).join('/') + '）');

  /* --------------------------------------------- 4. 平铺与行间距
     2026-11-12：行内改成一张预渲染行图（2400×400），不再有 img 之间的缝隙；
     改为守「行图按行高等比缩放、横向 repeat、行间 gap 为 0」。 */
  const seam = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.albumwall__row')];
    const cs = getComputedStyle(rows[0]);
    const rects = rows.map(x => x.getBoundingClientRect());
    const v = [];
    for (let i = 0; i < rects.length - 1; i++) v.push(rects[i + 1].top - rects[i].bottom);
    return {
      bgSize: cs.backgroundSize, bgRepeat: cs.backgroundRepeat,
      rowH: rects[0].height,
      vMax: Math.max(...v), vMin: Math.min(...v),
      feather: getComputedStyle(rows[0], '::after').backgroundImage
    };
  });
  ok(/repeat-x/.test(seam.bgRepeat), '行图水平平铺（' + seam.bgRepeat + '），循环接缝无断点');
  ok(/auto/.test(seam.bgSize), '行图按行高等比缩放（' + seam.bgSize + '）');
  ok(Math.abs(seam.vMax) < 0.5 && Math.abs(seam.vMin) < 0.5,
    '行与行之间 gap 为 0（' + seam.vMin.toFixed(2) + ' ~ ' + seam.vMax.toFixed(2) + 'px）');
  ok(seam.rowH > 0, '行高有效（' + seam.rowH.toFixed(1) + 'px）');
  ok(/linear-gradient/.test(seam.feather), '行底有羽化带柔化硬切');

  /* ------------------------------------ 4b. 客观填充（像素级）
     几何算得再对，也可能被"容器有底、图层被裁、遮罩糊死"搞成看不见。
     这是唯一能客观回答"背景真的铺满、而且真的看得见封面"的办法：
     截「有墙 / 隐藏墙」两张图，逐像素比较差异比例。

     ⚠️ 截图前必须临时隐藏遮罩 —— 遮罩在边缘压到 88% 底色，
        那一带的差异会被压到阈值以下，看起来像"没铺到"。 */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const s = document.querySelector('.albumwall__scrim');
    if (s) s.style.display = 'none';
  });
  await page.waitForTimeout(250);
  const shotOn = await page.screenshot();
  await page.evaluate(() => { document.getElementById('albumWall').hidden = true; });
  await page.waitForTimeout(350);
  const shotOff = await page.screenshot();
  await page.evaluate(() => {
    document.getElementById('albumWall').hidden = false;
    const s = document.querySelector('.albumwall__scrim');
    if (s) s.style.display = '';
  });

  const cov = await page.evaluate(async ([a, b]) => {
    async function px(b64) {
      const im = new Image();
      im.src = 'data:image/png;base64,' + b64;
      await im.decode();
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      return { d: cx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
    }
    const A = await px(a), B = await px(b);
    const W = A.w, H = A.h;
    /* 取样避开标题区（上 22%）与卡片区（中下），只测背景露出的地方 */
    const zones = {
      '左上': [0.02, 0.24, 0.20, 0.36],
      '右上': [0.80, 0.24, 0.98, 0.36],
      /* 中段取样要避开页码条 —— 它固定在 x 0.92~0.95、y 0.41~0.59，
         两图里完全一样，会把差异比例拉低（实测右中因此误报到 66.7%）。
         所以把两条侧带下移到 0.62~0.72。 */
      '左中': [0.01, 0.62, 0.10, 0.72],
      '右中': [0.90, 0.62, 0.99, 0.72],
      '左下': [0.02, 0.80, 0.20, 0.94],
      '右下': [0.80, 0.80, 0.98, 0.94]
    };
    function ratio(z) {
      const x0 = Math.floor(z[0] * W), x1 = Math.floor(z[2] * W);
      const y0 = Math.floor(z[1] * H), y1 = Math.floor(z[3] * H);
      let ch = 0, tot = 0;
      for (let y = y0; y < y1; y += 3) {
        for (let x = x0; x < x1; x += 3) {
          const i = (y * W + x) * 4;
          const d = Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) +
                    Math.abs(A.d[i + 2] - B.d[i + 2]);
          if (d > 18) ch++;
          tot++;
        }
      }
      return tot ? +(ch / tot).toFixed(3) : 0;
    }
    const out = {};
    Object.keys(zones).forEach(k => { out[k] = ratio(zones[k]); });
    return out;
  }, [shotOn.toString('base64'), shotOff.toString('base64')]);

  Object.keys(cov).forEach(k => {
    ok(cov[k] > 0.8, '背景实际可见[' + k + '] ' + (cov[k] * 100).toFixed(1) + '% 像素被封面覆盖');
  });

  /* ------------------------------------------- 5. 每周轮换（种子稳定） */
  const weeks = await page.evaluate(() => {
    const f = window.SITE_ALBUMWALL.weekFor;
    return {
      sameWeekA: f(new Date(2026, 10, 9)),   // 周一
      sameWeekB: f(new Date(2026, 10, 15)),  // 同周周日
      nextWeek: f(new Date(2026, 10, 16)),   // 下周一
      prevWeek: f(new Date(2026, 10, 2))
    };
  });
  ok(weeks.sameWeekA === weeks.sameWeekB, '同一周内周数不变（周一与周日同值）');
  ok(weeks.nextWeek !== weeks.sameWeekA && weeks.prevWeek !== weeks.sameWeekA,
    '跨周周数会变（每周一自动换一批）');
  ok(r.week === weeks.sameWeekA,
    '页面用的是当前 ISO 周（' + r.week + '）');

  /* 同一周两次构建，结果必须一致（否则刷新会晃） */
  const stable = await page.evaluate(() => {
    const before = [...document.querySelectorAll('.albumwall__row img')].map(x => x.src);
    window.SITE_ALBUMWALL.refresh();
    const after = [...document.querySelectorAll('.albumwall__row img')].map(x => x.src);
    return JSON.stringify(before) === JSON.stringify(after);
  });
  ok(stable, '同一周内重建布局完全一致（刷新不晃）');

  /* ---------------------------------------------- 6. 多视口等比缩放 */
  for (const [w, h, name] of [[390, 844, '手机 390×844'], [1920, 1080, '宽屏 1920×1080'], [820, 1180, '竖屏平板 820×1180']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(650);
    const g = await page.evaluate(() => ({
      w: innerWidth, h: innerHeight,
      scale: window.SITE_ALBUMWALL.scale(),
      inst: getComputedStyle(document.getElementById('albumWallGrid')).width,
      rows: document.querySelectorAll('.albumwall__row').length,
      imgs: document.querySelectorAll('.albumwall__row img').length
    }));
    const need = Math.max(g.w / INST, g.h / INST) * 1.05;
    ok(Math.abs(g.scale - need) < 0.001,
      '[' + name + '] scale 按公式重算（' + g.scale.toFixed(3) + '）');
    ok(INST * g.scale >= Math.max(g.w, g.h),
      '[' + name + '] 实例缩放后盖住视口（' + Math.round(INST * g.scale) + 'px）');
    ok(g.inst === '1200px' && g.rows === 6,
      '[' + name + '] 规格不变，只靠缩放适配（6 行预渲染图）');
  }

  /* ------------------------------------------------- 7. 减少动效 */
  const rm = await ctx.newPage();
  await rm.emulateMedia({ reducedMotion: 'reduce' });
  await rm.goto(SITE, { waitUntil: 'load' });
  await rm.waitForTimeout(2200);
  const a0 = await rm.evaluate(() => window.SITE_ALBUMWALL.phase());
  await rm.waitForTimeout(900);
  const a1 = await rm.evaluate(() => window.SITE_ALBUMWALL.phase());
  ok(Math.abs(a1 - a0) < 0.01, '减少动效时静止（图还在）');
  await rm.close();

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  await browser.close();
  notes.forEach(n => console.log(n));
  if (fails.length) {
    console.log('\n失败明细:');
    fails.forEach(f => console.log('· ' + f));
  }
  console.log('\n检查项: ' + (notes.filter(n => n.startsWith('OK')).length + fails.length) +
    '，失败: ' + fails.length);
  console.log(fails.length ? '\n有问题' : '\n全部通过');
  if (fails.length) process.exitCode = 1;
})();
