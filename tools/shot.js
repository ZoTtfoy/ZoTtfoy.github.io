/* ==========================================================================
 *  逐屏截图 + 版式体检：node tools/shot.js [url] [outDir] [--mobile]
 * --------------------------------------------------------------------------
 *  为什么需要这个工具：
 *    这一轮排查里，我先后三次被"截图抢在动画之前"骗过 ——
 *    拍到的是 入场动画的中间帧：
 *      · 歌单白卡还是 opacity:0 → 看起来"整块列表消失了"
 *      · 换来换去以为墙没盖满
 *    每次都去改代码，其实代码是对的。代价是来回折腾。
 *
 *  所以这里把"拍到稳定帧"的条件写死：
 *    1. 等 DOM 就绪 + 字体就绪（MiSans 是分片加载的，字体落地会改变行高）
 *    2. 逐屏 goTo，并且**校验 activeIndex 真的到了**（平滑滚动 + 吸附会迟到）
 *    3. 等 .is-entering 消失（章节入场动画 0.62s + 最多 0.34s 延迟）
 *    4. 等 [data-reveal] 全部拿到 .is-visible（元素逐个浮现）
 *    5. 再多等一帧，避免合成器还没提交
 *
 *  同时输出一份版式体检表：区块高度 / 是否超屏 / 内容是否溢出容器。
 *  这样"看起来不对"与"几何上不对"能一眼分开 —— 前者才需要看截图。
 *
 *  用法：
 *    python tools/serve.py 8791 &
 *    node tools/shot.js                        # 桌面 1440×900 → .shots/
 *    node tools/shot.js http://127.0.0.1:8791/ .shots --mobile   # 手机 392×744
 * ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const MOBILE = args.includes('--mobile');
const positional = args.filter(a => !a.startsWith('--'));
const BASE = positional[0] || 'http://127.0.0.1:8791/';
const OUT = path.resolve(__dirname, '..', positional[1] || '.shots');

const VP = MOBILE ? { width: 392, height: 744 } : { width: 1440, height: 900 };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VP,
    deviceScaleFactor: MOBILE ? 2.75 : 1,
    isMobile: MOBILE,
    hasTouch: MOBILE
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });

  /* 外链图片替身：这一屏有上百张境外封面，一张卡住就等不到 load。
     版式体检与截图都不关心图片内容，用 1×1 透明 PNG 最稳。 */
  const BLANK = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r =>
    r.request().resourceType() === 'image'
      ? r.fulfill({ status: 200, contentType: 'image/png', body: BLANK })
      : r.continue());

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.SITE_PAGED && window.SITE_RENDER), { timeout: 60000 });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await page.waitForTimeout(600);

  const count = await page.evaluate(() =>
    [...document.querySelectorAll('.hero, .section')].filter(e => !e.hidden).length);

  console.log(`视口 ${VP.width}×${VP.height}${MOBILE ? '（手机）' : ''} · ${count} 屏 · 输出 ${OUT}`);
  console.log('屏  区块      高/视口     内容溢出   文件');
  console.log('--  --------  ----------  ---------  --------------------');

  for (let i = 0; i < count; i++) {
    /* goTo 是平滑滚动 + scroll-snap，落位可能迟到；最多重试 4 次 */
    let landed = false;
    for (let k = 0; k < 4 && !landed; k++) {
      await page.evaluate(n => window.SITE_PAGED.goTo(n), i);
      landed = await page.waitForFunction(n => window.SITE_PAGED.activeIndex() === n, i, { timeout: 2600 })
        .then(() => true).catch(() => false);
    }
    await page.waitForFunction(() => !document.querySelector('.section.is-entering'), { timeout: 6000 }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelectorAll('[data-reveal]:not(.is-visible)').length === 0,
      { timeout: 4000 }).catch(() => {});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const m = await page.evaluate(() => {
      const secs = [...document.querySelectorAll('.hero, .section')].filter(e => !e.hidden);
      const idx = window.SITE_PAGED.activeIndex();
      const s = secs[idx];
      const sr = s.getBoundingClientRect();
      const cont = s.querySelector('.container');
      const cr = cont && cont.getBoundingClientRect();
      return {
        idx, id: s.id || s.className,
        h: Math.round(sr.height), vh: window.innerHeight,
        overflow: cr ? Math.round(cr.bottom - sr.bottom) : null
      };
    });

    const name = String(i + 1).padStart(2, '0') + '-' + m.id + '.png';
    await page.screenshot({ path: path.join(OUT, name) });
    console.log(
      String(i + 1).padStart(2) + '  ' +
      m.id.padEnd(8) + '  ' +
      (String(m.h) + '/' + m.vh).padEnd(10) + '  ' +
      String(m.overflow === null ? '-' : m.overflow + 'px').padEnd(9) + '  ' + name
    );
  }

  if (errs.length) {
    console.log('\n控制台报错 ' + errs.length + ' 条：');
    errs.slice(0, 5).forEach(e => console.log('  · ' + e));
  } else {
    console.log('\n控制台无报错');
  }

  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
