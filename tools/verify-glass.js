/* ==========================================================================
 *  液态玻璃 / 综合纹章：node tools/verify-glass.js
 * --------------------------------------------------------------------------
 *  第 7、9 项的验收闸门，重点不是"好不好看"（那看视觉基线），而是：
 *    · 默认全局开启，八个主题都有（新主题 liquid 出现在面板里）
 *    · 玻璃**只在实测 high 档**做模糊；low 档退化为半透明实底
 *    · 手机顶栏永远不模糊（整屏宽 backdrop-filter 是实测过的掉帧大头）
 *    · ?glass=off / ?motif=off 能把效果干净地关掉，便于 A/B
 *    · 纹章 SVG 真的被当成 mask 加载，且随主题换色
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = (process.argv[2] || 'http://127.0.0.1:8791/').replace(/\/$/, '/');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

async function open(browser, query, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 1440, height: 900 } });
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url()));
  const res = await page.goto(SITE + query, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const root = document.documentElement;
    const card = document.querySelector('.ccard') || document.querySelector('.social');
    const cs = card ? getComputedStyle(card) : null;
    const header = document.querySelector('.site-header');
    const hs = header ? getComputedStyle(header) : null;
    const motif = document.querySelector('.ambient__motif');
    const ms = motif ? getComputedStyle(motif) : null;
    return {
      glass: root.dataset.glass,
      motifAttr: root.dataset.motif,
      perf: root.dataset.perf,
      themes: window.SITE_THEMES ? window.SITE_THEMES.list.map(t => t.id) : [],
      skinItems: document.querySelectorAll('[data-skin]').length,
      cardBg: cs ? cs.backgroundColor : '',
      cardBlur: cs ? (cs.backdropFilter || cs.webkitBackdropFilter || 'none') : '',
      cardShadow: cs ? cs.boxShadow : '',
      headerBlur: hs ? (hs.backdropFilter || hs.webkitBackdropFilter || 'none') : '',
      motifDisplay: ms ? ms.display : '',
      motifMask: ms ? (ms.maskImage || ms.webkitMaskImage || '') : '',
      motifColor: ms ? ms.backgroundColor : ''
    };
  });
  r.failed = failed;
  r.status = res ? res.status() : 0;
  return { page, r };
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- 默认：全局开启 ---------- */
  const { page: p1, r: base } = await open(browser, '');
  ok(base.glass === 'on', '默认 data-glass="on"（全局应用）');
  ok(base.motifAttr === 'on', '默认 data-motif="on"');
  ok(base.themes.length === 8 && base.themes.includes('liquid'),
     '主题注册表有 8 套且含 liquid（' + base.themes.join(', ') + '）');
  ok(base.skinItems >= 8, '主题面板出现 8 个可选项（实测 ' + base.skinItems + '）');
  ok(base.cardShadow.includes('inset'), '卡片有玻璃边缘内高光');
  ok(base.motifDisplay !== 'none' && base.motifMask.includes('motif.svg'),
     '综合纹章层以 motif.svg 作 mask 显示');
  ok(base.motifColor !== 'rgba(0, 0, 0, 0)' && base.motifColor !== '',
     '纹章颜色取自文字色变量（随主题换色）');
  ok(base.failed.length === 0, '没有资源加载失败（' + base.failed.join(', ') + '）');
  await p1.close();

  /* ---------- 关掉玻璃：回到实色 ---------- */
  const { page: p2, r: off } = await open(browser, '?glass=off&motif=off');
  ok(off.glass === 'off' && off.motifAttr === 'off', '?glass=off 与 ?motif=off 生效');
  ok(off.cardBg !== base.cardBg, '关掉玻璃后卡片底色变了（' + off.cardBg + '）');
  ok(off.cardBlur === 'none', '关掉玻璃后没有 backdrop-filter');
  ok(off.motifDisplay === 'none', '关掉纹章后该层不显示');
  await p2.close();

  /* ---------- 高端档：真的模糊 ---------- */
  const { page: p3, r: high } = await open(browser, '?perf=high');
  ok(high.perf === 'high', '?perf=high 强制高端档');
  ok(/blur\(/.test(high.headerBlur), '高端档浮层（顶栏）有玻璃模糊（' + high.headerBlur + '）');
  ok(high.cardBlur === 'none' && high.cardShadow.includes('inset'),
     '卡片不做逐卡模糊，用半透明 + 内高光表达玻璃（省一半滚动成本）');
  await p3.close();

  /* ---------- 低端档：半透明实底，不模糊 ---------- */
  const { page: p4, r: low } = await open(browser, '?perf=low');
  ok(low.perf === 'low', '?perf=low 强制低端档');
  ok(low.cardBlur === 'none', '低端档没有任何 backdrop-filter');
  ok(low.cardShadow.includes('inset'), '低端档仍保留高光描边（形式一致）');
  ok(low.cardBg !== off.cardBg, '低端档仍是半透明底，不是回到关玻璃的实色');
  await p4.close();

  /* ---------- 手机：顶栏永不模糊 ---------- */
  const { page: p5, r: phone } = await open(browser, '?perf=high', { width: 390, height: 844 });
  ok(phone.headerBlur === 'none', '390×844 且强制高端档，顶栏依然不模糊');
  ok(phone.headerBlur === 'none', '手机顶栏不模糊（整屏宽重算太贵）');
  ok(phone.cardShadow.includes('inset'), '手机卡片仍保留玻璃内高光');
  await p5.close();

  await browser.close();
  notes.forEach(n => console.log(n));
  if (fails.length) console.log('\n失败明细:\n' + fails.map(f => '· ' + f).join('\n') + '\n');
  console.log('检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) process.exit(1);
  console.log('\n全部通过');
})().catch(e => { console.error('ERR', e); process.exit(1); });
