/* ==========================================================================
 *  verify-share.js —— 分享卡片的静态自检
 * --------------------------------------------------------------------------
 *  守的是"抓取器能看到什么"：平台爬虫只读**原始 HTML**，不会执行 JS，
 *  所以这里全部按字符串检查 index.html，不启动浏览器。
 *
 *  node tools/verify-share.js
 * ========================================================================== */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const notes = [], fails = [];
const ok = (c, m) => c ? notes.push("OK  " + m) : fails.push(m);

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const tags = (re) => [...html.matchAll(re)].map((m) => m[1]);
const one = (re) => { const m = re.exec(html); return m ? m[1] : null; };

const TITLE = "Zotrod，我的名片";
const SITE = "https://zottfoy.github.io/";

/* ---------- 1. 文案 ---------- */
ok(one(/<meta name="description" content="([^"]+)"/) === TITLE,
   "meta description 是定稿文案：" + one(/<meta name="description" content="([^"]+)"/));
ok(one(/<meta property="og:title" content="([^"]+)"/) === TITLE, "og:title 是定稿文案");
ok(one(/<meta property="og:description" content="([^"]+)"/) === TITLE, "og:description 是定稿文案");
ok(one(/<meta name="twitter:title" content="([^"]+)"/) === TITLE, "twitter:title 是定稿文案");
ok(!/把复杂的东西|维修报价|听歌排行/.test(html.slice(0, html.indexOf("<title>"))),
   "分享区没有残留的旧标语 / 已下线栏目");

/* ---------- 2. 标签齐全 ---------- */
ok(one(/<meta property="og:type" content="([^"]+)"/) === "website", "有 og:type");
ok(one(/<meta property="og:url" content="([^"]+)"/) === SITE, "og:url 是站点绝对地址");
ok(one(/<meta name="twitter:card" content="([^"]+)"/) === "summary_large_image",
   "twitter:card 是大图版式");
ok(/<link rel="image_src"/.test(html), "有 image_src 兜底（部分 QQ/微信老抓取器只认它）");
ok(/<meta itemprop="image"/.test(html), "有 itemprop=image 兜底");

/* ---------- 3. 图片能被抓取器拿到 ---------- */
const imgs = [
  ...tags(/<meta property="og:image" content="([^"]+)"/g),
  ...tags(/<meta name="twitter:image" content="([^"]+)"/g),
  ...tags(/<link rel="image_src" href="([^"]+)"/g),
  ...tags(/<meta itemprop="image" content="([^"]+)"/g)
];
ok(imgs.length >= 4, "分享图引用齐全（" + imgs.length + " 处）");
ok(imgs.every((u) => /^https:\/\//.test(u)), "所有图片都是绝对 HTTPS 地址");

const sizes = new Map();
for (const u of new Set(imgs)) {
  const rel = u.replace(SITE, "");
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { fails.push("图片不存在：" + rel); continue; }
  const b = fs.readFileSync(file);
  const isJpeg = b[0] === 0xff && b[1] === 0xd8;
  const isPng = b.slice(1, 4).toString() === "PNG";
  ok(isJpeg || isPng, rel + " 是位图（不是 SVG）");
  ok(b.length < 300 * 1024, rel + " 小于 300KB（" + Math.round(b.length / 1024) + "KB）");
  if (isPng) {
    sizes.set(rel, b.readUInt32BE(16) + "×" + b.readUInt32BE(20));
  } else {
    /* JPEG：扫 SOF 段拿尺寸 */
    let i = 2, dim = "?";
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        dim = b.readUInt16BE(i + 7) + "×" + b.readUInt16BE(i + 5); break;
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
    sizes.set(rel, dim);
  }
}
ok([...sizes.values()].some((d) => d === "1200×630"), "有 1200×630 宽幅图（" + [...sizes.entries()].map(e => e[1]).join(" / ") + "）");
ok([...sizes.values()].some((d) => d === "600×600"), "有 600×600 方形图（小方块缩略图不裁字）");

/* ---------- 4. 海报与工具页 ---------- */
ok(fs.existsSync(path.join(ROOT, "assets/meta/share-poster-v3.jpg")), "微信海报存在");
ok(fs.existsSync(path.join(ROOT, "assets/meta/qr.png")), "二维码已入库，海报可离线重生成");
const share = fs.existsSync(path.join(ROOT, "share.html"))
  ? fs.readFileSync(path.join(ROOT, "share.html"), "utf8") : "";
ok(/connect\.qq\.com\/widget\/shareqq/.test(share), "工具页提供 QQ 好友分享入口");
ok(/qzshare_onekey/.test(share), "工具页提供 QQ 空间分享入口");
ok(/share-poster-v3\.jpg/.test(share), "工具页展示微信海报");
ok(/navigator\.share/.test(share), "工具页支持系统分享（不支持时降级到复制）");

console.log(notes.join("\n"));
console.log("\n检查项: " + (notes.length + fails.length) + "，失败: " + fails.length);
if (fails.length) { console.log("\n失败明细:\n· " + fails.join("\n· ")); process.exit(1); }
console.log("\n全部通过");
