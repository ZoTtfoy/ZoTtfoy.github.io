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
 *    3. 连滑两下只翻一页 —— 锁生效（间隔需 < 300ms，无头环境常跳过）
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

/* ⚠️ 屏蔽外部图片（CDN 封面），统一换成 1×1 透明 PNG。
   这一版起首页要拉上百张封面（游戏屏 48 + 在听屏 72），
   `waitUntil:'networkidle'` 要求"500ms 内没有新请求"，慢网下永远等不到，
   goto 直接 30s 超时 —— 表现出来就像"偶发崩溃"，和代码无关。
   这里不看封面图（图由 verify-steam / verify-albumwall 专门验）。
   用 fulfill 而不是 abort：abort 会在控制台留 ERR_FAILED，
   把"无控制台错误"这类断言带红。 */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
async function blockExternalImages(ctx) {
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
      : route.continue());
}

const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

await blockExternalImages(ctx);
await page.goto(URL, { waitUntil: "load" });
await page.waitForTimeout(2200);

const cdp = await ctx.newCDPSession(page);

/* 真实触摸序列：按下 → 分步移动 → 抬起 */
async function swipe(fromY, toY, steps = 6, delay = 14, x = 195, onStart) {
  /* onStart 在发出 touchStart 之前的一刻调用，用来量"两下之间真正的间隔"。
     注意不能简单用两次 await 的时间差 —— 那量到的是"整段滑动耗时"，
     会把锁的正常失效误判成 bug。 */
  if (onStart) onStart();
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

/* --------------------------------------------------- 3. 连滑两下只翻一页
 *
 *  ⚠️ 这一条只能用**最短手势**（1 步、无 delay），而且必须按
 *     "两次 touchend 之间的间隔"判定，不能按"两次 touchStart"。
 *
 *  实测（CDP 插桩）：无头浏览器里每发一个 Input.dispatchTouchEvent 要走一次
 *  协议往返，约 150ms。于是默认的 6 步滑动光手势本身就要 550~800ms ——
 *  比 300ms 的锁还长。也就是说"连滑两下"在机器上真实间隔是 600ms+，
 *  锁本来就该放开，第二下翻页完全正确。用 6 步去测锁，测的其实是往返速度。
 *
 *  所以：手势压到 1 步（touchStart → touchMove → touchEnd），
 *  并把两次抬手间隔量出来；超过 250ms 就明说跳过，而不是报一个假失败。 */
/* 2026-11-13：必须回到首页再做这一组。
   上一组结束时停在游戏屏，而游戏列表现在是**可滚容器**（删掉"查看全部"
   之后它必须自己滚）—— 从列表上开始的手势会被让给列表，本来就不该翻页。
   在这里滑，测到的会是"列表滚了"而不是"锁生效"。 */
await page.evaluate(() => window.SITE_PAGED.goTo(0));
await page.waitForTimeout(900);
s = await state();
const before3 = s.active;
await page.waitForTimeout(400);          /* 先让上一组的锁自然过期 */
await swipe(700, 400, 1, 0);
const tEnd3 = Date.now();
await swipe(700, 400, 1, 0);
const between3 = Date.now() - tEnd3;     /* ≈ 两次 touchend 之间的间隔 */
await page.waitForTimeout(900);
s = await state();
if (between3 > 250) {
  notes.push("--  两次抬手间隔实测 " + between3 + "ms（无头环境往返太慢，已超过 300ms 锁，跳过）");
} else {
  ok(s.active === before3 + 1,
    "连滑两下只翻一页（抬手间隔 " + between3 + "ms，" + before3 + " → " + s.active + "）");
}

/* ----------------------------------------------- 4. 间隔够久则各翻一页
   ⚠️ 必须先确保后面还有**两屏**。
   早先写死了"翻两页"，靠着全站 6 屏才成立；2026-11-11 下掉维修屏后只剩 5 屏，
   跑到这一步时已经在第 3 屏，第二下直接撞到底 —— 断言变成"永远失败"，
   而真实的锁时长一点问题都没有。所以先把位置退回到后面确实还有两屏的地方。 */
{
  const total = s.pages;
  /* 回到第 2 屏（听歌）再滑：这里没有可滚容器，手势一定落到翻页逻辑上。
     游戏屏的列表会吃掉纵向手势（这是设计），不能用来测"两下各翻一页"。 */
  if (s.active !== 1 || s.active + 2 > total - 1) {
    await page.evaluate(() => window.SITE_PAGED.goTo(1));
    await page.waitForTimeout(900);
    s = await state();
  }
  ok(s.active + 2 <= s.pages - 1,
    "第 4 组起点后面还有两屏可翻（第 " + s.active + " 屏 / 共 " + s.pages + " 屏）");

  const before4 = s.active;
  /* 起点放在页面上部（y 300→100），不要用 y=700：
     第一下翻到游戏屏之后，第二下会落在可滚列表上而被让给列表 ——
     那不是锁失效，是列表该滚。 */
  await swipe(300, 100, 4, 6);
  await page.waitForTimeout(420);
  await swipe(300, 100, 4, 6);
  await page.waitForTimeout(1000);
  s = await state();
  ok(s.active === before4 + 2,
    "间隔 420ms 的两下各翻一页（" + before4 + " → " + s.active + "）");
}

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
