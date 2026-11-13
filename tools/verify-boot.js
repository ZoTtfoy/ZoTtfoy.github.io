/* ==========================================================================
 *  启动表验证：node tools/verify-boot.js [URL]
 * --------------------------------------------------------------------------
 *  守的是「写了模块却忘了启动」这一类错。
 *
 *  坏掉的表现很隐蔽：某个模块的 init 从没被调用，页面**看起来基本正常**，
 *  只是那一块功能静默失效 —— 没有报错、没有空白，只有"这个按钮怎么没反应"。
 *
 *  三条断言：
 *    ① 页面上每一个暴露了 init 的 SITE_* 模块，要么在 SITE_BOOT.plan() 里，
 *       要么在 selfInit() 里写明为什么不用调。
 *    ② 启动表里每一步都真的跑成功了（没有 skip、没有 error）。
 *    ③ 四条「必须」的顺序约束：render 第一；scale → density → foldQuote →
 *       paged 依次；live 早于 paged；readable 晚于 paged。
 *
 *  这些以前只写在 main.js 的注释里，注释不会拦人；现在是断言。
 *
 *  依赖：playwright-core + 本地 chromium
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });

  await page.goto(SITE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);   // 等 DOMContentLoaded 那条启动链跑完

  const info = await page.evaluate(() => {
    const boot = window.SITE_BOOT;
    if (!boot) return { missing: true };
    const plan = boot.plan();
    const self = boot.selfInit();
    const report = boot.report();
    /* 页面上真实的「有 init 的模块」全集 —— 以运行时为准，
       不去猜源码里写了什么 */
    const withInit = Object.keys(window).filter(function (k) {
      if (!/^SITE_[A-Z]+$/.test(k)) return false;
      const v = window[k];
      return v && typeof v.init === "function";
    });
    return {
      plan: plan.map(s => ({ name: s.name, mod: s.mod, fn: s.fn || "init" })),
      self: self.map(s => s.mod),
      report: report,
      withInit: withInit
    };
  });

  ok(!info.missing, '页面暴露了 SITE_BOOT 启动表');
  if (info.missing) {
    console.log('\n失败：找不到 window.SITE_BOOT —— main.js 还是旧版？');
    process.exit(1);
  }

  /* ---------- ① 有没有漏启动的模块 ---------- */
  const inPlan = new Set(info.plan.filter(s => s.fn === "init").map(s => s.mod));
  const selfSet = new Set(info.self);
  const orphans = info.withInit.filter(m => !inPlan.has(m) && !selfSet.has(m));
  ok(orphans.length === 0,
     '暴露 init 的模块都在启动表或 selfInit 里'
     + (orphans.length ? '（漏掉：' + orphans.join(', ') + '）' : '')
     + '（共 ' + info.withInit.length + ' 个）');

  /* ---------- ② 每一步都跑成功了 ---------- */
  const reported = new Set(info.report.map(r => r.name));
  const notRun = info.plan.map(s => s.name).filter(n => !reported.has(n));
  ok(notRun.length === 0, '启动表每一行都执行过'
     + (notRun.length ? '（没跑：' + notRun.join(', ') + '）' : ''));

  const skipped = info.report.filter(r => r.skip);
  ok(skipped.length === 0, '没有模块因为缺失被跳过'
     + (skipped.length ? '（' + skipped.map(r => r.name + ': ' + r.error).join('; ') + '）' : ''));

  const errored = info.report.filter(r => !r.ok && !r.skip);
  ok(errored.length === 0, '没有模块在 init 里抛错'
     + (errored.length ? '（' + errored.map(r => r.name + ': ' + r.error).join('; ') + '）' : ''));

  /* ---------- ③ 顺序约束 ---------- */
  const idx = name => info.plan.findIndex(s => s.name === name);
  const order = (...names) => names.every((n, i) =>
    i === 0 || (idx(names[i - 1]) >= 0 && idx(n) > idx(names[i - 1])));

  ok(idx("render") === 0, 'render 第一个启动（它的产物是后面所有步骤的前提）');
  ok(order("scale", "density", "repair.foldQuote", "paged"),
     'scale → density → foldQuote → paged 依次执行（measure 三连不能提前）');
  ok(order("live", "paged"), 'live 早于 paged（时钟/一言会撑高首页）');
  ok(idx("readable") > idx("paged"), 'readable 晚于 paged（要读最终生效的字号）');

  /* ---------- 输出 ---------- */
  ok(jsErrors.length === 0, '页面没有 JS 报错'
     + (jsErrors.length ? '（' + jsErrors.slice(0, 3).join(' | ') + '）' : '（0）'));

  await browser.close();

  notes.forEach(n => console.log(n));
  if (fails.length) console.log('\n失败明细:\n' + fails.map(f => '· ' + f).join('\n') + '\n');
  console.log('检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) process.exit(1);
  console.log('\n全部通过');
})().catch(e => {
  console.error('ERR', e);
  process.exit(1);
});
