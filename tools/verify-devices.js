/* ==========================================================================
 *  多机型适配验证：node tools/verify-devices.js
 * --------------------------------------------------------------------------
 *  核心断言：**每一章的高度必须正好等于屏幕高度**（用户要的"填充满一屏"）。
 *  只断言"不超屏"是不够的 —— 高度不足一屏会出现半截空白，同样是缺陷。
 *
 *  覆盖 15 种真实比例，从 16:9 老机型到 20:9 长条、折叠屏外屏、横屏：
 *    375×667 / 414×736 / 360×780 / 390×844 / 393×852 / 412×892 / 430×932
 *    412×915 / 393×873 / 400×880 / 344×882 / 320×568 / 844×390
 *
 *  同时校验档位分配合理：主流机型应留在 roomy（不牺牲留白），
 *  只有真的装不下才降到 tight / snug / micro。
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* 真实机型视口（CSS px），含宽高比 */
const DEVICES = [
  { n: 'iPhone SE',        w: 375, h: 667,  ratio: '16:9' },
  { n: 'iPhone 8 Plus',    w: 414, h: 736,  ratio: '16:9' },
  { n: 'iPhone 12 mini',   w: 360, h: 780,  ratio: '19.5:9' },
  { n: 'iPhone 13/14',     w: 390, h: 844,  ratio: '19.5:9' },
  { n: 'iPhone 14 Pro Max',w: 430, h: 932,  ratio: '19.5:9' },
  { n: 'iPhone 15 Pro',    w: 393, h: 852,  ratio: '19.5:9' },
  { n: 'Pixel 5',          w: 393, h: 851,  ratio: '19.5:9' },
  { n: 'Pixel 7 Pro',      w: 412, h: 892,  ratio: '19.5:9' },
  { n: 'Galaxy S20 Ultra', w: 412, h: 915,  ratio: '20:9' },
  { n: 'Galaxy S23',       w: 360, h: 780,  ratio: '20:9' },
  { n: 'Xiaomi 13',        w: 393, h: 873,  ratio: '20:9' },
  { n: 'Huawei Mate 40',   w: 400, h: 880,  ratio: '19.5:9' },
  { n: '折叠屏外屏',        w: 344, h: 882,  ratio: '窄长' },
  { n: '小屏安卓',          w: 320, h: 568,  ratio: '16:9' },
  { n: '横屏手机',          w: 844, h: 390,  ratio: '横屏' }
];

(async () => {
  const b = await chromium.launch();
  for (const d of DEVICES) {
    const ctx = await b.newContext({
      viewport: { width: d.w, height: d.h },
      hasTouch: true, isMobile: true,
      deviceScaleFactor: 2
    });
    const p = await ctx.newPage();
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1400);

    const r = await p.evaluate(() => {
      const pages = [...document.querySelectorAll('.hero, .section')];
      const vh = innerHeight;
      return {
        vh,
        snap: document.documentElement.dataset.snap,
        fit: document.documentElement.dataset.fit,
        pages: pages.map(el => {
          const box = el.getBoundingClientRect();
          const inner = el.querySelector('.container') || el.querySelector('.hero__inner');
          const ib = inner ? inner.getBoundingClientRect() : null;
          return {
            id: el.id,
            h: Math.round(el.offsetHeight),
            tall: el.getAttribute('data-tall') === '1',
            // 内容底边到页面底边的距离（正值=还有余量）
            slack: ib ? Math.round(box.bottom - ib.bottom) : null
          };
        })
      };
    });

    const tag = '[' + d.n + ' ' + d.w + '×' + d.h + '] ';
    const overflow = r.pages.filter(x => x.h > r.vh + 2);
    const slacks = r.pages.map(x => x.slack).filter(v => v !== null);
    const minSlack = Math.min(...slacks);
    const notFull = r.pages.filter(x => Math.abs(x.h - r.vh) > 1);

    /* 1) 不超屏 */
    ok(overflow.length === 0,
      tag + '没有章节超出屏幕' + (overflow.length ? '（' + overflow.map(o => o.id).join(',') + '）' : ''));

    /* 2) 正好填满：每章高度等于屏高（这是"填充满一屏"的核心） */
    ok(notFull.length === 0,
      tag + '每章高度 = 屏高 ' + r.vh + (notFull.length
        ? '（异常：' + notFull.map(x => x.id + ' ' + x.h).join(',') + '）'
        : ''));

    /* 3) 内容有余量，不能贴底 */
    ok(minSlack >= 0, tag + '内容未贴到页底（最小余量 ' + minSlack + 'px）');

    /* 4) 保持强制吸附（不该因适配而降级） */
    ok(r.snap === 'mandatory', tag + '保持强制吸附（' + r.snap + '）');

    /* 5) 档位合理：主流机型不该被过度压缩 */
    const isMainstream = d.h >= 800 && d.w >= 360;
    if (isMainstream) {
      ok(r.fit === 'roomy', tag + '主流机型保持 roomy 档（实际 ' + r.fit + '）');
    }

    // 打印一行便于人看
    console.log(tag.padEnd(34) + 'fit=' + r.fit.padEnd(7) +
      '页高 ' + r.vh + ' 余量 ' + minSlack + '~' + Math.max(...slacks) + 'px');

    await ctx.close();
  }

  await b.close();

  console.log('\n' + notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})();
