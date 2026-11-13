/* ==========================================================================
 *  stamp-assets.js —— 给 index/admin/themes.html 里的本地 CSS/JS 打版本戳
 * --------------------------------------------------------------------------
 *  为什么需要：GitHub Pages 对**所有**静态文件都发 `Cache-Control: max-age=600`，
 *  而路径不带指纹时，浏览器在 10 分钟内不会重新取。实际后果是"我这边推送完，
 *  用户那边看到的还是旧样式"，为此来回确认过两次（页码的位置问题）。
 *
 *  做法：把 `assets/xxx.css` 改写成 `assets/xxx.css?v=<戳>`。
 *  URL 变了 = 缓存必然失效，不用改服务器配置，也不用上构建工具。
 *  按 F5 就够了 —— 浏览器导航会重新校验 HTML，HTML 里的新 URL 自然拿到新文件。
 *
 *  用法：
 *    node tools/stamp-assets.js              # 用当前时间戳（YYYYMMDDHHmm）
 *    node tools/stamp-assets.js 20261114a    # 指定戳（调试/回滚对照用）
 *
 *  ⚠️ 幂等：重复跑只会把已有的 ?v= 换成新的，不会叠成 ?v=1?v=2。
 *  ⚠️ 只戳 assets/ 下的 css/js，data/*.json 由 sync.js 自己带 cache 策略。
 * ========================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILES = ["index.html", "admin.html", "themes.html"];

function stamp() {
  const t = process.argv[2];
  if (t) return String(t).replace(/[^0-9A-Za-z._-]/g, "");
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes());
}

const tag = stamp();
let total = 0;

for (const name of FILES) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, "utf8");
  let n = 0;
  /* 只匹配 assets/ 下以 .css / .js 结尾、且已经清掉旧 ?v= 的引用 */
  const after = before.replace(
    /(\s(?:src|href)=")(assets\/[^"?#]+\.(?:css|js))(?:\?v=[^"#]*)?"/g,
    (m, head, url) => {
      n++;
      return head + url + "?v=" + tag + '"';
    }
  );
  if (n) fs.writeFileSync(file, after);
  total += n;
  console.log((n ? "✓ " : "· ") + name + "：" + n + " 处");
}

console.log("版本戳 " + tag + "，共 " + total + " 处");
if (!total) {
  console.log("（没有改动。如果刚跑过，说明已经是这个版本了）");
}
