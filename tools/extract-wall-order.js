/* 从运行中的页面读出两面墙的真实排列顺序，供 bake-walls.py 拼图。
   为什么不在 Python 里重算：选图依赖 JS 的 LCG（seed*1103515245 会超 2^53，
   double 精度丢失），Python 整数运算复现不出同样的序列。直接读 DOM 最可靠。
   用法：node tools/extract-wall-order.js [站点URL] */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.cache', 'wall-order.json');

(async () => {
  const browser = await chromium.connectOverCDP('ws://127.0.0.1:9222/devtools/browser');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => /127\.0\.0\.1|zottfoy/.test(p.url())) || ctx.pages()[0];
  await page.goto(SITE + '?v=bake' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5200);

  const data = await page.evaluate(() => {
    const steam = [...document.querySelectorAll('.steamwall__col')].map(col => {
      const imgs = [...col.querySelectorAll('img')];
      return imgs.slice(0, 4).map(i => ({ src: i.getAttribute('src'), appid: i.getAttribute('data-appid') }));
    });
    const album = [...document.querySelectorAll('.albumwall__row')].map(row => {
      const imgs = [...row.querySelectorAll('img')];
      return imgs.slice(0, 6).map(i => i.getAttribute('src'));
    });
    return {
      generatedAt: new Date().toISOString(),
      week: document.getElementById('albumWall') && document.getElementById('albumWall').getAttribute('data-week'),
      steam, album
    };
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1), 'utf8');
  console.log('steam cols:', data.steam.length, 'album rows:', data.album.length, '->', OUT);
  console.log('steam sample:', JSON.stringify(data.steam[0]));
  console.log('album sample:', JSON.stringify(data.album[0] && data.album[0][0]));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
