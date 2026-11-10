/* ==========================================================================
 *  触摸翻页验证：node tools/verify-swipe.js
 * --------------------------------------------------------------------------
 *  为什么必须用 CDP 的真实触摸序列：
 *   用 new TouchEvent('touchstart', {...}) 手工派发是测不出来的 ——
 *   合成事件不会触发浏览器的滚动手势识别，也就不会走 preventDefault 那条路径。
 *   必须用 Input.dispatchTouchEvent 才能复现真实手指行为。
 *   这个坑在 verify-drag.js 里已经踩过一次，这里沿用同样的做法。
 *
 *  验证九件事：
 *    1. 短距离上滑（40px）也翻页   —— 用户明确要求「不管距离」
 *    2. 长距离上滑（500px）只翻一页 —— 不是"滑多远翻多远"
 *    3. 连滑两下（40ms 间隔）只翻一页 —— 锁生效
 *    4. 隔 420ms 的两下各翻一页      —— 锁不会太长
 *    5. 下滑回上一页
 *    6. 轻点不翻页（点复制按钮不能连带翻走）
 *    7. 横向滑动不翻页
 *    8. 最后一页继续上滑不越界
 *    9. 全程无控制台错误
 * ========================================================================== */

import { chromium } from "playwright-core";

const EXE = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

async function launch() {
  for (const p of EXE) {
    try { return await chromium.launch({ executablePath: p }); } catch (e) { /* 换下一个 */ }
  }
  throw new Error("找不到 Chrome / Edge");
}

const URL = "http://127.0.0.1:8791/index.html";
const notes = [];
const fails = [];
const ok = (c, m) => (c ? notes.push("OK  " + m) : fails.push(m));

const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true, hasTouch: true, deviceScaleFactor: 3,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);

const cdp = await ctx.newCDPSession(page);

/* 真实触摸序列：按下 → 分步移动 → 抬起 */
async function swipe(fromY, toY, steps = 6, delay = 14, x = 195) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: fromY }] });
  for (let i = 1; i <= steps; i++) {
    const y = fromY + ((toY - fromY) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(delay);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const state = () => page.evaluate(() => ({
  y: Math.round(window.scrollY),
  active: window.SITE_PAGED.activeIndex(),
  snap: document.documentElement.dataset.snap,
  pages: window.SITE_PAGED.pages().length,
}));

/* ------------------------------------------------------------- 前置检查 */
const init = await state();
ok(init.pages >= 2, "页面数量 ≥ 2（实际 " + init.pages + "）");
ok(init.snap === "mandatory", "当前处于强制吸附模式（snap=" + init.snap + "）");

const lock = await page.evaluate(() => window.SITE_PAGED.swipeLock());
ok(lock.ms > 0, "连翻锁不为 0（" + lock.ms + "ms）");

/* ------------------------------------------------------- 1. 短距离也翻页 */
await swipe(600, 560);
await page.waitForTimeout(700);
let s = await state();
ok(s.active === 1, "短距离上滑 40px 也翻一页（active=" + s.active + "）");

/* --------------------------------------------------- 2. 长距离只翻一页 */
const before2 = s.active;
await swipe(700, 200);
await page.waitForTimeout(700);
s = await state();
ok(s.active === before2 + 1, "长距离上滑 500px 只翻一页（" + before2 + " → " + s.active + "）");

/* --------------------------------------------------- 3. 连滑两下只翻一页 */
const before3 = s.active;
await swipe(700, 400, 4, 6);
await page.waitForTimeout(40);
await swipe(700, 400, 4, 6);
await page.waitForTimeout(900);
s = await state();
ok(s.active === before3 + 1,
  "连滑两下（间隔 40ms）只翻一页（" + before3 + " → " + s.active + "）");

/* ----------------------------------------------- 4. 间隔够久则各翻一页 */
const before4 = s.active;
await swipe(700, 400, 4, 6);
await page.waitForTimeout(420);
await swipe(700, 400, 4, 6);
await page.waitForTimeout(1000);
s = await state();
ok(s.active === before4 + 2,
  "间隔 420ms 的两下各翻一页（" + before4 + " → " + s.active + "）");

/* ------------------------------------------------------- 5. 下滑回上一页 */
const before5 = s.active;
await swipe(300, 620);
await page.waitForTimeout(800);
s = await state();
ok(s.active === before5 - 1, "下滑回上一页（" + before5 + " → " + s.active + "）");

/* --------------------------------------------------------- 6. 轻点不翻页 */
let before6 = (await state()).active;
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 400 }] });
await page.waitForTimeout(60);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(700);
s = await state();
ok(s.active === before6, "轻点（无位移）不翻页（" + before6 + " → " + s.active + "）");

/* ------------------------------------------------------- 7. 横滑不翻页 */
before6 = s.active;
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 300, y: 420 }] });
for (let i = 1; i <= 5; i++) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 300 - i * 28, y: 420 }] });
  await page.waitForTimeout(12);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(700);
s = await state();
ok(s.active === before6, "横向滑动不翻页（" + before6 + " → " + s.active + "）");

/* -------------------------------------------------- 8. 最后一页不越界 */
await page.evaluate(() => window.SITE_PAGED.goTo(window.SITE_PAGED.pages().length - 1));
await page.waitForTimeout(700);
const lastIdx = (await state()).active;
await swipe(700, 300);
await page.waitForTimeout(800);
s = await state();
ok(s.active === lastIdx,
  "最后一页继续上滑不越界（仍在第 " + s.active + " 页，会滚到页脚）");

/* ------------------------------------------------------- 9. 控制台干净 */
ok(errs.length === 0, "全程无控制台错误" + (errs.length ? "：" + errs.join(" | ") : ""));

/* ---------------------------------------------------------------- 输出 */
console.log(notes.join("\n"));
console.log("\n检查项: " + notes.length + "，失败: " + fails.length);
if (fails.length) {
  console.log("\n失败明细:\n" + fails.join("\n"));
  await browser.close();
  process.exit(1);
}
console.log("\n全部通过");
await browser.close();
