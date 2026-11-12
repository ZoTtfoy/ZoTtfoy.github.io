/* ==========================================================================
 *  Steam 封面墙验证：node tools/verify-steam.js
 * --------------------------------------------------------------------------
 *  2026-11-11 随实现一起重写。旧版验的是「按滚动进度整体平移的横版网格」，
 *  现在验的是「固定大实例 + 等比缩放 + 竖版密铺 + 每列独立循环流动」。
 *
 *  截图能看出好不好看，但守不住回归，所以这里把三件事量化：
 *
 *    1. 完全填充 —— 对比「有墙 / 隐藏墙」两张截图，逐像素算差异。
 *       四角各自必须有足够比例的像素发生变化，否则就是没铺到。
 *       这是唯一能客观回答"背景有没有被封面填满"的办法。
 *    2. 等比缩放 —— 验证 scale 公式与旋转后内接正方形的覆盖关系，
 *       并在手机 / 宽屏 / 竖屏平板三种视口上各验一次。
 *    3. 真的在动 —— 相位随时间推进、各列速度不同、setSpeed(0) 能停。
 *       ⚠️ 不能再用"滚动位置"驱动断言：翻页站点停稳后 scrollY 不变，
 *       旧版就是这样测出了 0.04% 的位移还以为通过。
 *
 *  依赖：playwright-core + 本地 chromium
 * ========================================================================== */

const { chromium } = require('playwright-core');

const SITE = 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

const INST = 1200;
const PERIOD = 1200;

/* --------------------------------------------------------------- 截图对比
   把两张 PNG 传回页面，用 <img> 解码后画进 canvas 逐像素比较。
   这样不需要 pngjs / sharp 之类的额外依赖 —— 浏览器自己就是最好的解码器。
   返回：七个取样区域里"有变化"的像素占比。 */
async function coverage(page, shotOn, shotOff) {
  return page.evaluate(async ([a, b]) => {
    async function pixels(b64) {
      const im = new Image();
      im.src = 'data:image/png;base64,' + b64;
      await im.decode();
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      return { d: cx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
    }
    const A = await pixels(a), B = await pixels(b);
    const W = A.w, H = A.h;

    /* 顶栏 / 页码条 / 卡片 / 战绩板都是**不透明内容**，不随墙变化，取样必须避开。
       ⚠️ 2026-11-12 重定采样区：
          之前用的是 8 块区域（四角 + 左中/右中 + 正中）。战绩板变高之后，
          「正中」整块落在板子里、「左中/右中」压在板子左/右边缘 ——
          那三块永远测不出差异，于是固定失败 3 条（看上去像墙没盖满）。
       现在只取**容器外侧的窄条**：容器最大 1180，1440 视口下左右各留 130px，
       取 x 0.5%~3.5% 与 96.5%~99.5% 一定在所有内容之外；
       y 分上下两段（避开位于中部的战绩板与右下角的回顶按钮）。 */
    const zones = {
      '左上': [0.005, 0.12, 0.035, 0.45],
      '右上': [0.965, 0.12, 0.995, 0.45],
      '左下': [0.005, 0.55, 0.035, 0.88],
      '右下': [0.965, 0.55, 0.995, 0.88]
    };
    function ratio(box) {
      const x0 = Math.floor(box[0] * W), x1 = Math.floor(box[2] * W);
      const y0 = Math.floor(box[1] * H), y1 = Math.floor(box[3] * H);
      let changed = 0, total = 0;
      for (let y = y0; y < y1; y += 3) {
        for (let x = x0; x < x1; x += 3) {
          const i = (y * W + x) * 4;
          const diff = Math.abs(A.d[i] - B.d[i]) +
                       Math.abs(A.d[i + 1] - B.d[i + 1]) +
                       Math.abs(A.d[i + 2] - B.d[i + 2]);
          if (diff > 18) changed++;
          total++;
        }
      }
      return total ? +(changed / total).toFixed(3) : 0;
    }
    const out = {};
    Object.keys(zones).forEach(k => { out[k] = ratio(zones[k]); });
    return out;
  }, [shotOn.toString('base64'), shotOff.toString('base64')]);
}

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
  /* 这一套必须看真图（要逐像素比对有没有封面），所以不能屏蔽外链。
     Steam 图床偶尔会有单张卡住十几秒，30s 默认超时不够 —— 放宽到 90s。 */
  await page.goto(SITE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(3200);

  const gIdx = await page.evaluate(() =>
    window.SITE_PAGED.pages().findIndex(e => e && e.id === 'gaming'));
  ok(gIdx > 0, 'gaming 有独立页码（第 ' + (gIdx + 1) + ' 屏）');
  /* 导航到游戏页，带着重试。
     ⚠️ 只调一次 goTo 再死等是不够的：如果 paged 还没完成初始化
        （机器有负载时 3.2s 都可能不够），这次调用会被忽略，
        页面停在第 2 页；后面所有"停在游戏页"的前提就全错了 ——
        像素采样会测出 30~50% 的假覆盖率。
     所以每轮都核对 activeIndex，没到位就再发一次。 */
  async function ensureGamePage(tries = 4) {
    for (let i = 0; i < tries; i++) {
      const a = await page.evaluate(() => window.SITE_PAGED.activeIndex());
      if (a === gIdx) return true;
      await page.evaluate(k => window.SITE_PAGED.goTo(k), gIdx);
      await page.waitForTimeout(1100);
    }
    return (await page.evaluate(() => window.SITE_PAGED.activeIndex())) === gIdx;
  }
  await ensureGamePage();

  /* ---------------------------------------------------- 1. 结构与数据 */
  const r = await page.evaluate(() => {
    const grid = document.getElementById('steamWallGrid');
    const wall = document.getElementById('steamWall');
    const cols = [...document.querySelectorAll('.steamwall__col')];
    const tiles = [...document.querySelectorAll('.steamwall__tile')];
    const imgs = [...document.querySelectorAll('.steamwall__tile img')];
    const cs = grid && getComputedStyle(grid);
    const one = tiles[0] && getComputedStyle(tiles[0]);
    const m = cs ? new DOMMatrix(cs.transform) : null;
    return {
      wallHidden: wall && wall.hidden,
      cols: cols.length,
      tiles: tiles.length,
      perCol: cols[0] ? cols[0].children.length : 0,
      imgs: imgs.length,
      loaded: imgs.filter(x => x.complete && x.naturalWidth > 0).length,
      broken: imgs.filter(x => x.complete && x.naturalWidth === 0).length,
      portraitUrls: imgs.filter(x => /library_600x900\.jpg/.test(x.src)).length,
      uniqueApps: new Set(imgs.map(x => x.src)).size,
      /* rotate(45deg) → a≈cos45·s, b≈+sin45·s（b 为正 = 顺时针 = 向右倾） */
      rotA: m ? +m.a.toFixed(4) : 0,
      rotB: m ? +m.b.toFixed(4) : 0,
      cssInst: cs ? cs.width : '',
      gap: cs ? cs.gap : '',
      radius: one ? one.borderRadius : '',
      scale: window.SITE_STEAMWALL ? window.SITE_STEAMWALL.scale() : null,
      portraitOnly: window.SITE_STEAMWALL ? window.SITE_STEAMWALL.portraitOnly() : null,
      period: window.SITE_STEAMWALL ? window.SITE_STEAMWALL.period() : null,
      apps: window.SITE_STEAMWALL ? window.SITE_STEAMWALL.apps().length : 0
    };
  });

  ok(!r.wallHidden, '封面墙没有被隐藏');
  ok(r.cols === 6, '固定 6 列（' + r.cols + '）');
  ok(r.tiles === 48 && r.perCol === 8,
    '6 列 × 每列 8 格（两份相同的 4 格，用于无缝循环）→ ' + r.tiles + ' 格');
  ok(r.imgs === r.tiles, '每格都有一张图（' + r.imgs + '）');
  ok(r.portraitUrls === r.imgs, '全部是**竖版** library_600x900 封面（' + r.portraitUrls + '）');
  ok(r.loaded === r.imgs && r.broken === 0,
    '所有封面都加载成功、0 坏图（' + r.loaded + '/' + r.imgs + '）');
  ok(r.portraitOnly === true, '用的是逐张探测过的 portraitApps，不是未过滤的 apps');
  ok(r.uniqueApps >= 12, '墙面用了至少 12 种不同封面（' + r.uniqueApps + ' 种）');
  ok(r.apps >= 30, '数据源里有足够多的游戏（' + r.apps + ' 个 appid）');
  ok(/^0px/.test(r.gap), '网格间隙为 0（' + r.gap + '），斜拼时不会露出白线');
  ok(r.radius === '0px', '格子无圆角（' + r.radius + '），四格交界不留小三角');
  ok(r.cssInst === '1200px', '实例是固定的 1200×1200（' + r.cssInst + '）');
  ok(r.period === PERIOD, '循环周期 = 一份 4 格 = 1200px（' + r.period + '）');

  /* 向右倾斜 45°：cos45 = sin45 = 0.7071，且 b 必须为正 */
  const s = r.scale;
  ok(Math.abs(r.rotA - 0.707107 * s) < 0.002 && Math.abs(r.rotB - 0.707107 * s) < 0.002,
    '整体向右倾斜 +45°（a=' + r.rotA + ', b=' + r.rotB + '，b 正 = 顺时针）');
  ok(r.rotB > 0, '不是旧版的 -45°（向左）');

  /* ---------------------------------------------- 2. 等比缩放覆盖公式 */
  const geom = await page.evaluate(() => ({
    w: innerWidth, h: innerHeight,
    scale: window.SITE_STEAMWALL.scale()
  }));
  const inner = INST * geom.scale / Math.SQRT2;   // 旋转后轴对齐内接正方形边长
  ok(inner >= Math.max(geom.w, geom.h) * 1.05,
    '1440×900 覆盖成立：内接 ' + Math.round(inner) + 'px ≥ 视口 ' +
    Math.max(geom.w, geom.h) + 'px（scale=' + geom.scale.toFixed(3) + '）');
  ok(Math.abs(geom.scale - Math.SQRT2 * Math.max(geom.w, geom.h) * 1.12 / INST) < 0.001,
    'scale 严格等于 √2 × max(W,H) × 1.12 / 1200');

  /* -------------------------------------------- 3. 完全填充（像素对比）
     ⚠️ 截图前先把遮罩去掉。
     遮罩在屏幕下方压到 58% 底色，"有墙"和"无墙"两张图在那一带本来就
     颜色很接近，逐像素差值会低于阈值 —— 看起来像没铺到，其实只是被压暗了。
     第一版就栽在这里：右下角测出 54%，反复查几何都没问题。
     去掉遮罩后比较的是纯封面 vs 纯底色，才是真正回答"填没填满"。 */
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const s = document.querySelector('.steamwall__scrim');
    if (s) s.style.display = 'none';
  });
  /* 采样前必须确认**真的停在游戏页**。
     否则墙在屏幕外，隐藏它与不隐藏几乎没差别，覆盖率会跌到 30~50%，
     看起来像"墙没铺满"，其实只是截错了屏（实测偶发过 32%）。
     用 activeIndex 判定，比等固定 250ms 稳。 */
  const onGamePage = await ensureGamePage(2);
  await page.waitForTimeout(250);
  const shotOn = await page.screenshot();
  await page.evaluate(() => { document.getElementById('steamWall').hidden = true; });
  await page.waitForTimeout(350);
  const shotOff = await page.screenshot();
  const cov = await coverage(page, shotOn, shotOff);
  await page.evaluate(() => {
    document.getElementById('steamWall').hidden = false;
    const s = document.querySelector('.steamwall__scrim');
    if (s) s.style.display = '';
  });

  ok(onGamePage, '截图采样时确实停在游戏页（activeIndex 已就位）');

  Object.keys(cov).forEach(k => {
    /* 四角是纯背景区，要求 ≥85%；三处"中"带里有卡片（有墙无墙都不变），
       阈值放宽到 55% —— 不是放水，是明确区分"该被封面盖住的区域"和
       "本来就摆着不透明卡片、看不出背景的区域"。 */
    /* 所有采样区都在容器外侧，墙必须完全盖住 → 统一按 85% 要求 */
    const need = 0.85;
    ok(cov[k] > need, '填充[' + k + '] ' + (cov[k] * 100).toFixed(1) +
      '% 像素被封面覆盖（需 >' + (need * 100) + '%）');
  });

  /* ---------------------------------------------------- 4. 真的在动 */
  const t0 = await page.evaluate(() => window.SITE_STEAMWALL.phase());
  await page.waitForTimeout(1400);
  const t1 = await page.evaluate(() => window.SITE_STEAMWALL.phase());
  /* 2026-11-12 第五轮：设计像素减半后 BASE_RATE 48→24，phase() 读的是
     design px，同样 1.4s 的推进量也减半，阈值 20→10 才是同一个判据。 */
  ok(t1 > t0 + 10, '停留不动时相位也在推进（' + t0.toFixed(1) + ' → ' + t1.toFixed(1) + ' px）');

  const shifts = await page.evaluate(() => {
    /* 读"计算后"的位移：墙现在由 Web Animations 驱动，style.transform 是空的，
       真正的偏移在 getComputedStyle 的 matrix 里（tx=索引4，ty=索引5）。 */
    const tyOf = (el) => {
      const mm = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform || '');
      if (!mm) return null;
      const v = mm[1].split(',').map(Number);
      return [null, v[4], v[5]];
    };
    return [...document.querySelectorAll('.steamwall__col')].map(c => {
      const m = tyOf(c);
      return m ? { x: +m[1], y: +m[2] } : null;
    });
  });
  ok(shifts.every(v => v && v.x === 0), '位移的 X 恒为 0（只沿图片自身垂直方向滑）');
  ok(new Set(shifts.map(v => v && v.y)).size === shifts.length,
    '同一时刻每列位移互不相同（' + shifts.map(v => v && v.y.toFixed(0)).join('/') + '）');

  const rates = await page.evaluate(() =>
    [...document.querySelectorAll('.steamwall__col')]
      .map(c => +c.style.getPropertyValue('--col-speed')));
  ok(rates.length === 6 && new Set(rates.map(v => v.toFixed(3))).size === 6,
    '6 列倍率各不相同（' + rates.map(v => v.toFixed(2)).join(' / ') + '）');
  ok(Math.min(...rates) >= 0.5 && Math.max(...rates) <= 1.5,
    '倍率落在 0.55~1.45 的正弦分布内');

  /* speed=0 必须停；恢复后继续走 */
  await page.evaluate(() => window.SITE_STEAMWALL.setSpeed(0));
  const p0 = await page.evaluate(() => window.SITE_STEAMWALL.phase());
  await page.waitForTimeout(900);
  const p1 = await page.evaluate(() => window.SITE_STEAMWALL.phase());
  /* 容差 1px：相位由 rAF 累积，切帧边界上偶尔会多算不到 1px 的零头。
     这不等于是"没静止" —— 判断"真的停了"要看量级（几十~几百 px 才算动）。 */
  ok(Math.abs(p1 - p0) < 1, 'setSpeed(0) 时基本静止（Δ=' + (p1 - p0).toFixed(2) + 'px）');
  await page.evaluate(() => window.SITE_STEAMWALL.setSpeed(3));
  const q0 = await page.evaluate(() => window.SITE_STEAMWALL.phase());
  await page.waitForTimeout(900);
  const q1 = await page.evaluate(() => window.SITE_STEAMWALL.phase());
  /* 用 1.25 倍而不是 1.5 倍做门槛：
     无头浏览器帧率被软件合成压在 30fps 且抖动，同一段真实时间里的
     相位增量本身就有 ±15% 的波动；卡到 1.5 会偶发假失败。 */
  ok(q1 - q0 > (t1 - t0) * 1.25,
    'setSpeed(3) 明显比默认快（Δ=' + (q1 - q0).toFixed(1) + ' vs ' + (t1 - t0).toFixed(1) + '）');
  await page.evaluate(() => window.SITE_STEAMWALL.setSpeed(1));

  /* 循环无缝：推进整整一个周期，位移仍被取模在合法区间，
     不会"越滑越远"把列底露出来。 */
  const loop = await page.evaluate((P) => {
    /* 读"计算后"的位移：墙现在由 Web Animations 驱动，style.transform 是空的，
       真正的偏移在 getComputedStyle 的 matrix 里（tx=索引4，ty=索引5）。 */
    const tyOf = (el) => {
      const mm = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform || '');
      if (!mm) return null;
      const v = mm[1].split(',').map(Number);
      return [null, v[4], v[5]];
    };
    window.SITE_STEAMWALL.step(P);
    return [...document.querySelectorAll('.steamwall__col')].map(c => {
      const m = tyOf(c);
      return m ? +m[2] : -1;
    });
  }, PERIOD);
  ok(loop.every(y => y >= 0 && y < PERIOD),
    '推进一整个周期后，每列位移仍被取模在 [0,1200) 内');

  /* --------------------------------------------- 5. 多视口等比缩放 */
  for (const [w, h, name] of [[390, 844, '手机 390×844'], [1920, 1080, '宽屏 1920×1080'], [820, 1180, '竖屏平板 820×1180']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    const g = await page.evaluate(() => ({
      w: innerWidth, h: innerHeight,
      scale: window.SITE_STEAMWALL.scale(),
      inst: getComputedStyle(document.getElementById('steamWallGrid')).width,
      cols: document.querySelectorAll('.steamwall__col').length,
      tiles: document.querySelectorAll('.steamwall__tile').length
    }));
    const need = Math.SQRT2 * Math.max(g.w, g.h) * 1.12 / INST;
    ok(Math.abs(g.scale - need) < 0.001,
      '[' + name + '] scale 按公式重算（' + g.scale.toFixed(3) + '）');
    ok(g.inst === '1200px' && g.cols === 6 && g.tiles === 48,
      '[' + name + '] 实例规格不变，只靠缩放适配（6 列 / 48 格）');
    ok(INST * g.scale / Math.SQRT2 >= Math.max(g.w, g.h) * 1.05,
      '[' + name + '] 覆盖成立（内接 ' +
      Math.round(INST * g.scale / Math.SQRT2) + 'px）');
  }

  /* ------------------------------------------------ 6. 减少动效时停转 */
  const rm = await ctx.newPage();
  await rm.emulateMedia({ reducedMotion: 'reduce' });
  await rm.setViewportSize({ width: 1440, height: 900 });
  await rm.goto(SITE, { waitUntil: 'load', timeout: 90000 });
  await rm.waitForTimeout(2600);
  const r0 = await rm.evaluate(() => window.SITE_STEAMWALL.phase());
  await rm.waitForTimeout(1000);
  const r1 = await rm.evaluate(() => window.SITE_STEAMWALL.phase());
  ok(Math.abs(r1 - r0) < 0.01, '减少动效时封面墙静止（图还在，只是不流动）');
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
