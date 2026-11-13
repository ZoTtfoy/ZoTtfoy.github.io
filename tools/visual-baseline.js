/* 视觉基线：重构每一步都必须 0 差异。
   用法：
     node tools/visual-baseline.js --make     生成基线到 baseline/
     node tools/visual-baseline.js --check    截图到 baseline/current/，再跑 compare-baseline.py
   确定性处理（否则每次都不一样）：
     · 两面封面墙 setSpeed(0) + step(0) 归零相位
     · 关掉 ambient 的 orb / stars / grid / grain / ken-burns
     · 「一言」文本固定
     · 等入场动画（1.15s）结束再截
*/
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'baseline');
const SITE = process.argv.includes('--site')
  ? process.argv[process.argv.indexOf('--site') + 1]
  : 'http://127.0.0.1:8791/';

const SCREENS = [
  { id: 'top', label: 'home' },
  { id: 'listen', label: 'listen' },
  { id: 'gaming', label: 'gaming' }
];
const VIEWPORTS = [
  { w: 390, h: 844, tag: 'phone' },
  { w: 1440, h: 900, tag: 'desktop' }
];
const THEMES = ['light', 'dark'];

async function freeze(page) {
  await page.evaluate(() => {
    const root = document.documentElement;
    root.dataset.motion = 'off';
    root.dataset.kenBurns = 'off';
    root.dataset.bdAurora = 'off';
    root.dataset.bdStars = 'off';
    root.dataset.bdGrid = 'off';
    root.dataset.bdGrain = 'off';
    /* 别用 setSpeed(0)：时长会变成 Infinity，step() 写不进 currentTime。
       直接把两面墙上的所有动画归零并暂停 —— WAAPI 与 CSS 动画都适用。 */
    document.getAnimations().forEach(function (a) {
      var t = a.effect && a.effect.target;
      if (!t || !t.closest) return;
      if (t.closest('#steamWall') || t.closest('#albumWall')) {
        try { a.currentTime = 0; a.pause(); } catch (e) {}
      }
    });
    /* 还有一类随机源：**无限循环**的装饰动画（翻页提示的上下浮、卡片的呼吸光）。
       有限次的入场动画到这时候早跑完了，不用管；把 iterations 为 Infinity 的
       统一归零相位，这样每次截到的都是同一个相位。
       实测：不清这一批，首页两次同版本截图能差出 0.7%。 */
    document.getAnimations().forEach(function (a) {
      var timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
      if (!timing || timing.iterations !== Infinity) return;
      try { a.currentTime = 0; a.pause(); } catch (e) {}
    });
    /* 时钟和「今年已过 %」都读系统时间：两次截图跨过一分钟就整行变字。
       和一言同理，钉成固定值。 */
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('liveClock', '00:00');
    set('liveWeek', '周一');
    set('liveDate', '1 月 1 日');
    set('liveProgressLabel', '今年已过 0%');
    const fill = document.getElementById('liveProgressFill');
    if (fill) fill.style.transform = 'scaleX(0)';
    const q = document.getElementById('liveQuote');
    if (q) q.textContent = 'BASELINE';
  });
}

async function setTheme(page, theme) {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  if (cur !== theme) {
    await page.evaluate(() => {
      const b = document.getElementById('themeToggle');
      if (b) b.click();
    });
    await page.waitForTimeout(500);
  }
}

async function shoot(page, target) {
  await page.waitForTimeout(1300);   // 入场动画 1.15s
  await page.screenshot({ path: target });
}

(async () => {
  const mode = process.argv.includes('--make') ? 'make'
    : process.argv.includes('--check') ? 'check' : '';
  if (!mode) {
    console.error('用法：node tools/visual-baseline.js --make | --check');
    process.exit(1);
  }
  const outDir = mode === 'make' ? BASE : path.join(BASE, 'current');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  let n = 0;
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    /* 「一言」是异步 fetch，两次返回的内容/时机都不同，会污染首页对比。
       固定成同一个响应（内容与时机都确定）。 */
    await page.route('**/v1.hitokoto.cn/**', r => r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"hitokoto":"BASELINE","from":"baseline"}'
    }));
    await page.goto(SITE + (SITE.indexOf('?') >= 0 ? '&' : '?') + 'bg=0', { waitUntil: 'load', timeout: 90000 });
    /* 字体分片是异步加载的：不等它，两次截图的换行/行高会差一档，
       内容区就会出现 5~20% 的假差异（实测踩到过）。 */
    await page.evaluate(() => (document.fonts && document.fonts.ready) || null);
    await page.waitForTimeout(2500);
    await freeze(page);

    for (const theme of THEMES) {
      await setTheme(page, theme);
      for (let i = 0; i < SCREENS.length; i++) {
        /* 先让 paged 走一遍（它要更新页码/类），再**强制精确落点**。
           只靠 goTo 的平滑滚动，停手后的 snapToNearest 可能差 1px，
           整屏内容跟着位移，差异会被放大成十几个百分点。 */
        await page.evaluate((i) => window.SITE_PAGED.goTo(i), i);
        await page.waitForTimeout(900);
        await page.evaluate((i) => {
          const el = window.SITE_PAGED.pages()[i];
          const top = el.getBoundingClientRect().top + (window.scrollY || 0);
          window.scrollTo({ top: Math.round(top), behavior: 'auto' });
        }, i);
        await page.waitForTimeout(500);
        await freeze(page);
        const file = path.join(outDir, SCREENS[i].label + '-' + theme + '-' + vp.tag + '.png');
        await shoot(page, file);
        n++;
        console.log('  shot', path.basename(file));
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(mode === 'make'
    ? '\n基线已生成：' + n + ' 张 -> ' + BASE
    : '\n本次截图：' + n + ' 张 -> ' + outDir + '\n运行 python tools/compare-baseline.py 对比');
})().catch(e => { console.error('ERR', e); process.exit(1); });
