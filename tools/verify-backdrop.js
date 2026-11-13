/* 背景系统自检：各层显隐 + 8 套主题 × 2 明暗的图片可读性 */
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

function lum(rgb) {
  const [r, g, b] = rgb.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const L1 = lum(a), L2 = lum(b);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
};
const solid = hex => 'data:image/svg+xml;base64,' +
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${hex}"/></svg>`).toString('base64');

const probe = () => {
  const parse = s => {
    s = String(s).trim();
    let m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return { rgb: [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16)), a: 1 };
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return { rgb: [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16)), a: 1 };
    m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const a = m[1].split(',').map(Number);
    return { rgb: a.slice(0, 3), a: a.length > 3 ? a[3] : 1 };
  };
  const imgEl = document.querySelector('.ambient__image');
  const scrimEl = document.querySelector('.ambient__scrim');
  const imgOp = parseFloat(getComputedStyle(imgEl).opacity) || 0;
  const scrimOp = parseFloat(getComputedStyle(scrimEl).opacity) || 0;
  const scrimBg = parse(getComputedStyle(scrimEl).backgroundColor);
  const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
  const imgRgb = JSON.parse(imgEl.dataset.rgb || '[255,255,255]');

  let base = bodyBg.rgb.slice();
  base = base.map((v, i) => imgRgb[i] * imgOp + v * (1 - imgOp));
  if (scrimBg) base = base.map((v, i) => scrimBg.rgb[i] * scrimOp + v * (1 - scrimOp));

  const pick = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const c = parse(getComputedStyle(el).color);
    return c ? c.rgb : null;
  };
  return {
    composed: base.map(Math.round),
    imgOp, scrimOp,
    /* 6 屏重构后首屏的大标题/说明换成了 profile__*，
       卡片说明换成 preview__meta / game 卡片（不再有 note）。
       这里取的是「背景图上仍需保证可读的几类小字」，换 class 要同步改这里。 */
    title: pick('.profile__name'),
    lead: pick('.profile__intro'),
    meta: pick('.preview__meta'),
    eyebrow: pick('.eyebrow'),
    cardDesc: pick('.preview__meta'),
    gameNote: pick('.game__uid-value')
  };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  /* ---------- 1. 默认层显隐 ---------- */
  const def = await page.evaluate(() => {
    const d = document.documentElement;
    const disp = sel => getComputedStyle(document.querySelector(sel)).display;
    const amb = getComputedStyle(document.querySelector('.ambient'));
    return {
      aurora: d.dataset.bdAurora, grain: d.dataset.bdGrain,
      grid: d.dataset.bdGrid, stars: d.dataset.bdStars,
      image: d.dataset.backdropImage,
      orbA: disp('.ambient__orb--a'), gridD: disp('.ambient__grid'),
      starsD: disp('.ambient__stars'), grainD: disp('.ambient__grain'),
      z: amb.zIndex, pe: amb.pointerEvents, pos: amb.position
    };
  });
  /* ⚠️ 这五条原来写死「网格 / 微粒 / 背景图默认关」。
     那是**出厂默认**，而这几个开关在编辑器里随时能改 ——
     用户一打开，断言就变成对配置的复读机，红了也指不出任何代码问题。
     改成「页面状态必须等于配置声明」，验的是接线，不是口味。 */
  const cfg = await page.evaluate(() => {
    const b = (window.SITE_CONFIG || {}).backdrop || {};
    const m = b.motion || {};
    return {
      aurora: m.aurora !== false,
      grain: m.grain !== false,
      grid: m.grid === true,
      stars: m.stars === true,
      image: !!b.image
    };
  });
  const onOff = v => v ? 'on' : 'off';
  const blockNone = v => v ? 'block' : 'none';

  ok(def.aurora === onOff(cfg.aurora) && def.orbA === blockNone(cfg.aurora),
    '光晕显隐跟配置一致（配置 ' + (cfg.aurora ? '开' : '关') + '）');
  ok(def.grain === onOff(cfg.grain) && def.grainD === blockNone(cfg.grain),
    '噪点显隐跟配置一致（配置 ' + (cfg.grain ? '开' : '关') + '）');
  ok(def.grid === onOff(cfg.grid) && def.gridD === blockNone(cfg.grid),
    '网格显隐跟配置一致（配置 ' + (cfg.grid ? '开' : '关') + '）');
  ok(def.stars === onOff(cfg.stars) && def.starsD === blockNone(cfg.stars),
    '微粒显隐跟配置一致（配置 ' + (cfg.stars ? '开' : '关') + '）');
  ok(def.image === onOff(cfg.image),
    '背景图开关跟配置一致（配置 ' + (cfg.image ? '有图' : '无图') + '）');
  ok(def.z === '0', '背景层在 z-index 0（内容之下）');
  ok(def.pe === 'none', '背景层不拦截点击');
  ok(def.pos === 'fixed', '背景层固定，不随内容滚动');

  /* ---------- 2. 打开网格 / 微粒 ---------- */
  await page.evaluate(() => {
    document.documentElement.dataset.bdGrid = 'on';
    document.documentElement.dataset.bdStars = 'on';
  });
  await page.waitForTimeout(200);
  const extra = await page.evaluate(() => ({
    grid: getComputedStyle(document.querySelector('.ambient__grid')).display,
    stars: getComputedStyle(document.querySelector('.ambient__stars')).display,
    starsOp: getComputedStyle(document.querySelector('.ambient__stars')).opacity
  }));
  ok(extra.grid === 'block', '开启后网格层出现');
  ok(extra.stars === 'block' && parseFloat(extra.starsOp) > 0, '开启后微粒层出现且有透明度');
  await page.evaluate(() => {
    document.documentElement.dataset.bdGrid = 'off';
    document.documentElement.dataset.bdStars = 'off';
  });

  /* ---------- 3. 坏图自动退回 ---------- */
  /* 2026-11-12：原来用 https://example.invalid/x.jpg 触发坏链，但它依赖 DNS
     在 1.6s 内失败 —— 本机实测要 1360ms，页面一忙就超时，断言会偶发假红。
     改成无效的 data URL：浏览器立刻报 decode 错误，测的还是「坏链回退」。 */
  await page.evaluate(() => window.SITE_BACKDROP.setImage('data:image/png;base64,AAAA'));
  await page.waitForTimeout(600);
  const broken = await page.evaluate(() => ({
    flag: document.documentElement.dataset.backdropImage,
    bg: getComputedStyle(document.querySelector('.ambient__image')).backgroundImage,
    text3: document.documentElement.style.getPropertyValue('--text-3')
  }));
  ok(broken.flag === 'off', '坏链自动退回纯色背景');
  ok(broken.bg === 'none', '坏链不残留 background-image');
  ok(!broken.text3, '无图时不覆盖 --text-3（不影响原主题）');

  /* ---------- 4. 八套主题 × 两明暗，最坏图片下的可读性 ---------- */
  const THEMES = await page.evaluate(() => window.SITE_THEMES.list.map(t => t.id));
  ok(THEMES.length >= 5, '读到 ' + THEMES.length + ' 套主题');

  let worst = { meta: 99, eyebrow: 99, lead: 99, title: 99 };
  let worstCase = '';

  for (const skin of THEMES) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(([s, t]) => {
        localStorage.setItem('zotrod-skin', s);
        localStorage.setItem('zotrod-theme', t);
      }, [skin, theme]);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);

      // 最危险的图：浅色主题配纯黑，深色主题配纯白
      const hex = theme === 'light' ? '#111111' : '#ffffff';
      const rgb = theme === 'light' ? [17, 17, 17] : [255, 255, 255];
      await page.evaluate(([u, r]) => {
        document.querySelector('.ambient__image').dataset.rgb = JSON.stringify(r);
        window.SITE_BACKDROP.setImage(u);
      }, [solid(hex), rgb]);
      await page.waitForTimeout(700);

      const r = await page.evaluate(probe);
      const cT = contrast(r.title, r.composed);
      const cL = contrast(r.lead, r.composed);
      const cM = contrast(r.meta, r.composed);
      const cE = contrast(r.eyebrow, r.composed);

      if (cM < worst.meta) { worst = { meta: cM, eyebrow: cE, lead: cL, title: cT }; worstCase = skin + '.' + theme; }

      ok(cT >= 4.5, `[${skin}.${theme}] 标题对比 ${cT.toFixed(2)} ≥ 4.5`);
      ok(cL >= 4.5, `[${skin}.${theme}] 正文对比 ${cL.toFixed(2)} ≥ 4.5`);
      ok(cM >= 3.5, `[${skin}.${theme}] 辅助小字对比 ${cM.toFixed(2)} ≥ 3.5`);
      ok(cE >= 4.5, `[${skin}.${theme}] eyebrow 对比 ${cE.toFixed(2)} ≥ 4.5`);
    }
  }

  /* ---------- 5. 关闭图片后文字色恢复 ---------- */
  await page.evaluate(() => window.SITE_BACKDROP.setImage(''));
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => {
    const d = document.documentElement;
    const skin = window.SITE_THEMES.get(d.dataset.skin);
    const mode = d.dataset.theme;
    return {
      flag: d.dataset.backdropImage,
      inline: d.style.getPropertyValue('--text-3'),
      theme: skin[mode]['text-3']
    };
  });
  ok(restored.flag === 'off', '清空图片后回到无图状态');
  ok(!restored.inline, '清空图片后移除了 --text-3 覆盖，恢复主题原色');

  /* ---------- 6. 减少动效：背景动画应静止 ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(900);
  const rm = await p2.evaluate(() => {
    const d = document.documentElement;
    const orb = getComputedStyle(document.querySelector('.ambient__orb--a'));
    return {
      motion: d.dataset.motion,
      orbAnim: orb.animationName,
      ken: d.dataset.kenBurns
    };
  });
  ok(rm.motion === 'off', '减少动效时 data-motion=off（光晕/微粒静止）');
  ok(rm.orbAnim === 'none', '减少动效时光晕无动画（' + rm.orbAnim + '）');
  ok(rm.ken === 'off', '减少动效时关闭 Ken Burns');
  await ctx2.close();

  /* 坏链测试会故意触发一次网络失败，那是预期行为，过滤掉 */
  const realErrs = errs.filter(e => !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(e));
  if (realErrs.length) fails.push('控制台错误: ' + JSON.stringify(realErrs.slice(0, 3)));

  console.log(notes.join('\n'));
  console.log('\n最差组合：' + worstCase +
    ' —— 标题 ' + worst.title.toFixed(2) + ' / 正文 ' + worst.lead.toFixed(2) +
    ' / 小字 ' + worst.meta.toFixed(2) + ' / eyebrow ' + worst.eyebrow.toFixed(2));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
  await browser.close();
})();
