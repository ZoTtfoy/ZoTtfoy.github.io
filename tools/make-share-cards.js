/* ==========================================================================
 *  make-share-cards.js —— 生成 QQ / 微信 / X 用的分享素材
 * --------------------------------------------------------------------------
 *  为什么需要三张：
 *   · 宽幅 1200×630  → X / TG / Discord / 大部分 OG 抓取器
 *   · 方形 600×600   → QQ / 微信 的小方块缩略图（宽图会被中心裁掉文字）
 *   · 竖版海报       → 微信没有公众号时，最可靠的"卡片"其实是发一张图
 *                      （里面带二维码，对方长按识别即可打开）
 *
 *  ⚠️ 全部输出 JPEG 且压到 300KB 以下：微信 JS-SDK 的 imgUrl 与部分抓取器
 *     对 PNG 大图会直接放弃（原 og-cover.png 是 401KB）。
 *  ⚠️ 文件名带版本号：QQ/微信对同一 URL 的卡片缓存可达 24 小时，
 *     换标签不换文件名等于没改。
 *
 *  用法：node tools/make-share-cards.js
 * ========================================================================== */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "assets/meta");
const SITE = "https://zottfoy.github.io/";
const VER = "v3";

const qr = fs.readFileSync(path.join(OUT, "qr.png")).toString("base64");
const QR = "data:image/png;base64," + qr;

/* 共用的视觉：深色渐变 + 细网格 + 薄荷绿点缀，和站点本身一套语言 */
const BASE = `
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html,body { width:100%; height:100%; overflow:hidden; background:#0d1210; }
    body { font-family:"Microsoft YaHei","PingFang SC","Hiragino Sans GB",Arial,sans-serif;
           color:#f2f5f3; -webkit-font-smoothing:antialiased; }
    .card { position:relative; width:100%; height:100%; overflow:hidden;
      background:
        radial-gradient(120% 100% at 12% 8%, rgba(74,150,115,.20), transparent 58%),
        linear-gradient(125deg, #16231d 0%, #101715 48%, #17110f 100%); }
    .grid { position:absolute; inset:0; opacity:.5;
      background-image:linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
                       linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); }
    .rule { background:#7fe0ad; border-radius:2px; }
    .mark { display:flex; align-items:center; justify-content:center;
      background:#1c2621; border:1px solid rgba(255,255,255,.09); color:#fff; font-weight:800; }
    .name { font-weight:800; letter-spacing:-.02em; }
    .slogan { color:#b9c8bf; }
    .meta { color:#8fa79a; letter-spacing:.06em; }
    .url { color:#7b9085; font-family:Consolas,monospace; letter-spacing:.04em; }
  </style>`;

/* ---------------------------------------------------------- 1. 宽幅 OG 图 */
/* 2026-11-15 用户定稿：只留「Zotrod，我的名片」，其余文字全部省略 */
const WIDE_TEXT = "Zotrod，我的名片";
const wide = `<!doctype html><meta charset="utf-8">${BASE}
<body><div class="card" style="width:1200px;height:630px">
  <div class="grid" style="background-size:60px 60px"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;
              align-items:center;justify-content:center">
    <div class="rule" style="width:52px;height:5px"></div>
    <div class="mark" style="width:112px;height:112px;border-radius:26px;font-size:64px;margin-top:44px">Z</div>
    <div class="name" style="font-size:78px;line-height:1.2;margin-top:30px">${WIDE_TEXT}</div>
  </div>
</div></body>`;

/* ---------------------------------------------------------- 2. 方形缩略图
   全部居中：不管抓取器按中心裁成正方形，还是压到 120×120，都还认得出 */
const square = `<!doctype html><meta charset="utf-8">${BASE}
<body><div class="card" style="width:600px;height:600px">
  <div class="grid" style="background-size:50px 50px"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;
              align-items:center;justify-content:center;text-align:center">
    <div class="rule" style="width:44px;height:4px"></div>
    <div class="mark" style="width:112px;height:112px;border-radius:26px;font-size:64px;margin-top:36px">Z</div>
    <div class="name" style="font-size:52px;line-height:1.25;margin-top:30px">${WIDE_TEXT}</div>
  </div>
</div></body>`;

/* ---------------------------------------------------------- 3. 微信海报
   微信不支持普通静态站自定义链接卡片；发一张带二维码的图反而稳。
   这张图本身在聊天里就是"一张卡片"。 */
const poster = `<!doctype html><meta charset="utf-8">${BASE}
<body><div class="card" style="width:750px;height:1000px">
  <div class="grid" style="background-size:56px 56px"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;
              align-items:center;justify-content:center">
    <div class="rule" style="width:52px;height:5px"></div>
    <div class="mark" style="width:108px;height:108px;border-radius:25px;font-size:62px;margin-top:48px">Z</div>
    <div class="name" style="font-size:60px;line-height:1.25;margin-top:30px">${WIDE_TEXT}</div>
    <div style="background:#fff;padding:20px;border-radius:22px;margin-top:86px;
                box-shadow:0 14px 48px rgba(0,0,0,.4)">
      <img src="${QR}" width="260" height="260" style="display:block">
    </div>
    <div class="meta" style="font-size:19px;margin-top:34px;letter-spacing:.12em">长按识别二维码</div>
  </div>
</div></body>`;

(async () => {
  const browser = await chromium.launch();
  const jobs = [
    { name: "og-cover-" + VER + ".jpg", html: wide, w: 1200, h: 630 },
    { name: "og-square-" + VER + ".jpg", html: square, w: 600, h: 600 },
    { name: "share-poster-" + VER + ".jpg", html: poster, w: 750, h: 1000 }
  ];
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
    await page.setContent(j.html);
    await page.waitForTimeout(200);
    const file = path.join(OUT, j.name);
    await page.screenshot({ path: file, type: "jpeg", quality: 84, clip: { x: 0, y: 0, width: j.w, height: j.h } });
    console.log(j.name.padEnd(26), (j.w + "×" + j.h).padEnd(10), (fs.statSync(file).size / 1024).toFixed(0) + "KB");
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
