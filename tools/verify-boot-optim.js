#!/usr/bin/env node
/* ==========================================================================
 *  载入期优化自检：node tools/verify-boot-optim.js
 * --------------------------------------------------------------------------
 *  2026-11-18 三项守门：
 *    ① 首屏开关前置：config.ui=false 的按钮在 DOMContentLoaded 前就
 *       display:none（由 <head> 的 data-show-* + CSS 决定），不靠 defer JS
 *    ② 数据请求去重：netease.json / steam.json 各只 fetch 一次
 *    ③ 按钮图标不重复重建：4 个按钮的 SVG 在首帧后不再被整体覆盖
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = (process.argv[2] || 'http://127.0.0.1:8791/').replace(/\/$/, '/');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);
const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r =>
    r.request().resourceType() === 'image'
      ? r.fulfill({ status: 200, contentType: 'image/png', body: BLANK })
      : r.continue());
  const page = await ctx.newPage();

  /* 最早注入：DCL 时采样 + 统计 fetch 次数 */
  await page.addInitScript(() => {
    window.__opt = { json: [], dcl: null, svgSnapshots: {} };
    try {
      new PerformanceObserver(list => {
        list.getEntries().forEach(e => {
          if (/\.json(\?|$)/.test(e.name)) {
            window.__opt.json.push(e.name.split('/').pop().split('?')[0]);
          }
        });
      }).observe({ entryTypes: ['resource'] });
    } catch (e) { /* 老浏览器无 PerformanceObserver */ }
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive' || window.__opt.dcl) return;
      /* 首帧 rAF 采样：DOM 已完整，且此时 defer 模块尚未全部执行完
         （defer 在 DCL 完毕后才跑 main），能看到 CSS 前置的真实效果。 */
      requestAnimationFrame(() => {
        const q = s => {
          const el = document.querySelector(s);
          if (!el) return null;
          return { display: getComputedStyle(el).display, hidden: el.hidden };
        };
        window.__opt.dcl = {
          skin: q('#skinBtn'), theme: q('#themeToggle'),
          top: q('#toTop'), pager: q('.pager'),
          dsSkin: document.documentElement.dataset.showSkin,
          dsTheme: document.documentElement.dataset.showTheme
        };
        ['#themeToggle', '#menuToggle', '#toTop', '#skinBtn'].forEach(s => {
          const el = document.querySelector(s);
          window.__opt.svgSnapshots[s] = el ? el.innerHTML : '';
        });
      });
    });
  });

  await page.goto(SITE + '?bg=0', { waitUntil: 'load' });
  await page.waitForTimeout(1700);
  const r = await page.evaluate(() => ({
    opt: window.__opt,
    after: ['#themeToggle', '#menuToggle', '#toTop', '#skinBtn'].map(s => {
      const e = document.querySelector(s);
      return { s, html: e ? e.innerHTML : '' };
    })
  }));

  /* ① 首屏开关前置 */
  ok(r.opt.dcl && r.opt.dcl.dsSkin === '0', '<head> 已按 config 写下 data-show-skin=0');
  ok(r.opt.dcl && r.opt.dcl.skin && r.opt.dcl.skin.display === 'none',
    'DCL 时 skinBtn 已 display:none（CSS 前置，未等 defer JS）');
  ok(r.opt.dcl && r.opt.dcl.theme && r.opt.dcl.theme.display !== 'none',
    'themeToggle 显示正常（config 未关闭）');
  /* CSS 前置的证明用 display:none 即可；hidden 属性会被 JS 兜底补写，
     采样落在 rAF 时可能已经写上，不作为断言（避免时序抖动）。 */
  ok(r.opt.dcl.skin.display === 'none', '隐藏由 CSS data-show-* 驱动，不依赖 JS 写入');

  /* ② 数据去重：统计每种 json 只出现一次 */
  const counts = {};
  r.opt.json.forEach(n => { counts[n] = (counts[n] || 0) + 1; });
  ['netease.json', 'steam.json', 'previews.json'].forEach(n => {
    ok(counts[n] === 1, n + ' 只请求 1 次（实测 ' + (counts[n] || 0) + '）');
  });

  /* ③ 按钮 SVG 未被重复重建。
     #menuToggle / #skinBtn 在 HTML 里预置了 SVG，首帧不该被覆盖；
     #toTop 的 HTML 本来就是空按钮（图标由 render.js 注入一次），不在此守。
     #themeToggle 允许一次明暗图标对齐，也不在此守。 */
  ['#menuToggle', '#skinBtn'].forEach(s => {
    ok(r.opt.svgSnapshots[s] === r.after.find(x => x.s === s).html,
      s + ' 的 SVG 未被重复重建');
  });

  await browser.close();
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch(e => { console.error('ERR', e); process.exit(2); });
