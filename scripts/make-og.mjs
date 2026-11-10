/* 生成社交分享卡 1200×630（一次性工具，跑完可留作重生成）
   为什么自己做而不是找图：
     微信 / TG / Twitter 抓取 og:image 时不渲染 SVG，
     必须是位图。项目里只有背景纹理，没有可用的图片资源，
     所以用无头浏览器把一张 HTML 卡片渲染成 PNG。
   重跑：node scripts/make-og.mjs */
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('assets/meta/og-cover.png');

const CARD = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0e1011"/>
      <stop offset="1" stop-color="#171a1c"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0.18" cy="0.12" r="0.62">
      <stop offset="0" stop-color="#84cbb2" stop-opacity=".22"/>
      <stop offset="1" stop-color="#84cbb2" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.88" cy="0.9" r="0.55">
      <stop offset="0" stop-color="#be825a" stop-opacity=".18"/>
      <stop offset="1" stop-color="#be825a" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glowA)"/>
  <rect width="1200" height="630" fill="url(#glowB)"/>

  <!-- 细网格，和站点的背景语言一致 -->
  <g stroke="#ffffff" stroke-opacity=".05" stroke-width="1">
    ${Array.from({ length: 15 }, (_, i) => `<line x1="${i * 86}" y1="0" x2="${i * 86}" y2="630"/>`).join('')}
    ${Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${i * 86}" x2="1200" y2="${i * 86}"/>`).join('')}
  </g>

  <!-- 头像方块 -->
  <g transform="translate(96 168)">
    <rect width="112" height="112" rx="26" fill="#1c2022" stroke="#ffffff" stroke-opacity=".14"/>
    <text x="56" y="76" font-family="Segoe UI, PingFang SC, Noto Sans, sans-serif"
          font-size="58" font-weight="700" text-anchor="middle" fill="#f1f3f1">Z</text>
  </g>

  <g font-family="Segoe UI, PingFang SC, Noto Sans, sans-serif" fill="#f1f3f1">
    <text x="96" y="352" font-size="70" font-weight="700" letter-spacing="-2">Zotrod</text>
    <text x="96" y="410" font-size="30" fill="#a8afb2">把复杂的东西，做得简单一点。</text>
  </g>

  <!-- 底部三行标签：说清这个页面有什么 -->
  <g font-family="Segoe UI, PingFang SC, Noto Sans, sans-serif" font-size="21" fill="#a8afb2">
    <text x="96" y="502">联系方式 · 听歌排行 · 游戏 ID · 维修报价</text>
  </g>

  <!-- 右下角署名 -->
  <g font-family="ui-monospace, Consolas, monospace" font-size="19" fill="#767e82" text-anchor="end">
    <text x="1104" y="560">zottfoy.github.io</text>
  </g>

  <!-- 顶部一道强调色短线，和站点的 eyebrow 语言一致 -->
  <rect x="96" y="120" width="46" height="3" rx="1.5" fill="#84cbb2"/>
</svg>`;

const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:1200px;height:630px;overflow:hidden;background:#0e1011}</style>
${CARD}`;

await fs.mkdir(path.dirname(OUT), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();

const st = await fs.stat(OUT);
console.log('已生成', path.relative(process.cwd(), OUT), Math.round(st.size / 1024) + 'KB');
