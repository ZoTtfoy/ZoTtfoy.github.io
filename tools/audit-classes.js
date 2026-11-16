#!/usr/bin/env node
/* ==========================================================================
 *  一次性审计：确认 CSS 里的"疑似死选择器"在真实 DOM 中是否还有元素命中。
 * --------------------------------------------------------------------------
 *  ARCHITECTURE.md 欠账清单第 5 条要求：删 .card / .interest / .game 之前
 *  必须先做「HTML + JS 生成的 class 全集」比对，别凭 grep 词边界猜。
 *  这个脚本起本地服务、用 Chromium 加载首页与 themes.html，把每个候选
 *  选择器用 querySelectorAll 实测命中数打印出来。只读，不改任何文件。
 *
 *  用法：node tools/audit-classes.js
 * ========================================================================== */
const { spawn } = require('child_process');
const path = require('path');

let chromium;
try {
  chromium = require('playwright-core').chromium;
} catch (e) {
  console.log('未安装 playwright-core，无法实测 DOM。');
  process.exit(2);
}

const PORT = 8797;
const URL = 'http://127.0.0.1:' + PORT + '/';

const CANDIDATES = [
  // 疑似死类（ARCHITECTURE 欠账清单点名）
  '.card', '.interest', '.game', '.game-rail',
  '.card-grid', '.interest-grid',
  '.card__icon', '.card__tags', '.card__index', '.card__title', '.card__desc',
  '.interest__icon', '.interest__meta', '.interest__text',
  '.game__icon', '.game__name', '.game__uid', '.game__uid-value', '.game__stat',
  '.repair',
  // 同一条规则里的兄弟类 —— 必须确认为活，才能安全摘除死类
  '.social', '.contact', '.about__side',
  '.ccard', '.game-board', '.track', '.preview'
];

const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(PORT), '--silent'], {
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 600));

  const browser = await chromium.launch();
  try {
    for (const pagePath of ['', 'themes.html']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route =>
        route.request().resourceType() === 'image'
          ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
          : route.continue());
      const page = await ctx.newPage();
      await page.goto(URL + pagePath, { waitUntil: 'load' });
      await page.waitForTimeout(500);

      const result = await page.evaluate((sels) => {
        const out = {};
        sels.forEach(s => {
          try { out[s] = document.querySelectorAll(s).length; }
          catch (e) { out[s] = 'ERR'; }
        });
        // 顺便采集所有出现过的 class，便于核对
        const all = new Set();
        document.querySelectorAll('[class]').forEach(el => {
          (el.getAttribute('class') || '').split(/\s+/).forEach(c => { if (c) all.add(c); });
        });
        out.__allClasses = Array.from(all).sort();
        return out;
      }, CANDIDATES);

      const label = pagePath || 'index.html';
      console.log('\n===== ' + label + ' =====');
      CANDIDATES.forEach(s => console.log(s.padEnd(16) + ' -> ' + result[s]));
      const hits = CANDIDATES.filter(s => s.startsWith('.') && result[s] > 0);
      console.log('命中的候选选择器: ' + (hits.join(', ') || '（无）'));
      console.log('class 全集数量: ' + result.__allClasses.length);
      if (process.env.SHOW_ALL) console.log(result.__allClasses.join('\n'));
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
