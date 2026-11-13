/* ==========================================================================
 *  设备档位 / 静态背景墙：node tools/verify-perf-tier.js
 * --------------------------------------------------------------------------
 *  2026-11-13 起档位**只看实测帧表现**（平均帧耗时 + 帧数/慢帧数），
 *  不再看核心数、内存、网络类型这些静态猜测。这里守四条：
 *
 *    1. ?perf=low  → data-perf=low / data-wall=static，两面墙动画一个都不许跑，
 *       但**图还在**（列/行元素与 background-image 保留），内容一点都不能少。
 *    2. ?perf=high → 不写 data-wall，墙按原来的节奏滚。
 *    3. 源码里不许再出现硬件猜测指标（防有人图省事又加回去）。
 *    4. 真实采样链路走得通：默认档位跑完两轮采样；把 rAF 打桩成 34ms/帧
 *       模拟掉帧设备后，档位必须自动降到 low 并把墙停掉。
 * ========================================================================== */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

async function probe(browser, url, waitSample) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  if (waitSample) {
    /* 采样在 load 后 900ms 起、两轮各 800ms，等它出结论 */
    await page.waitForFunction(
      () => window.SITE_PERF && window.SITE_PERF.metrics().length >= 2,
      { timeout: 10000 }
    ).catch(() => {});
  } else {
    await page.waitForTimeout(1200);
  }
  /* 2026-11-14：两面墙的列图/行图改成 load 后 2s 才铺（首屏省 1.45MB），
     所以这里要等它们真的到位再断言"背景图仍在"，否则测的是"还没加载"。
     等的是"元素有了 background-image"，不是固定时长。 */
  await page.waitForFunction(() => {
    const els = [...document.querySelectorAll('.steamwall__col, .albumwall__row')];
    return els.length > 0 && els.every(el => getComputedStyle(el).backgroundImage !== 'none');
  }, { timeout: 6000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const root = document.documentElement;
    const cols = document.querySelectorAll('.steamwall__col');
    const rows = document.querySelectorAll('.albumwall__row');
    const wallEls = [].slice.call(cols).concat([].slice.call(rows));
    const running = wallEls.reduce((n, el) =>
      n + el.getAnimations().filter(a => a.playState === 'running').length, 0);
    const withBg = wallEls.filter(el => {
      const bg = getComputedStyle(el).backgroundImage;
      return bg && bg !== 'none';
    }).length;
    return {
      perf: root.getAttribute('data-perf'),
      wall: root.getAttribute('data-wall'),
      cols: cols.length, rows: rows.length,
      running, withBg,
      metrics: window.SITE_PERF ? window.SITE_PERF.metrics() : [],
      summary: window.SITE_PERF ? window.SITE_PERF.summary() : '(无 SITE_PERF)'
    };
  });
  await page.close();
  return r;
}

(async () => {
  const browser = await chromium.launch();
  const base = SITE.replace(/\/$/, '/');

  /* ---------- 低端档（强制） ---------- */
  const low = await probe(browser, base + '?perf=low');
  ok(low.perf === 'low', '?perf=low 时 <html data-perf="low">（' + low.summary + '）');
  ok(low.wall === 'static', '?perf=low 时 <html data-wall="static">');
  ok(low.running === 0, '低端档两面墙没有任何动画在跑（实测 ' + low.running + ' 条）');
  /* 列数自 2026-11-13 起随视口自适应（6~12），这里只守"墙还在、结构没塌" */
  ok(low.cols >= 6 && low.rows === 6,
     '低端档墙面结构不变（列 ' + low.cols + ' / 行 ' + low.rows + '）');
  ok(low.withBg === low.cols + low.rows,
     '低端档背景图仍在（' + low.withBg + ' 个元素有 background-image）');

  /* ---------- 高端档（强制） ---------- */
  const high = await probe(browser, base + '?perf=high');
  ok(high.perf === 'high', '?perf=high 时 <html data-perf="high">');
  ok(high.wall === null, '高端档不写 data-wall');
  ok(high.metrics.length === 0, '强制档位跳过采样（不浪费两轮 rAF）');

  /* ---------- 源码里不许有静态硬件猜测 ---------- */
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/core/perf-tier.js'), 'utf8');
  /* 只看**可执行代码**：文件头特意写了「刻意不看 hardwareConcurrency…」，
     把注释也扫进去会误报。 */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const key of ['hardwareConcurrency', 'deviceMemory', 'effectiveType', 'saveData']) {
    ok(!code.includes(key), '判档代码不含 ' + key + '（不靠硬件猜）');
  }
  ok(/sampleRound/.test(code) && /avgMs/.test(code) && /slowRatio/.test(code),
     '判档代码确实按「渲染时间 + 帧数」采样');

  /* ---------- 默认档位：两轮实测真的跑完了 ---------- */
  /* 自动化环境下默认跳过采样（软件渲染不代表真机），
     用 ?perf=auto 显式打开，验证的才是采样链路本身。 */
  const def = await probe(browser, base + '?perf=auto', true);
  ok(def.metrics.length >= 2, '默认档位完成两轮帧采样（' + def.metrics.length + ' 轮）');
  ok(def.metrics.every(m => typeof m.avgMs === 'number' && m.frames > 0 && typeof m.slow === 'number'),
     '每轮都记录了平均帧耗时 / 实际帧数 / 慢帧数');
  ok(def.perf === 'high' || (def.perf === 'low' && def.summary.includes('实测')),
     '默认档位按实测结论，不是无条件降级（' + def.summary + '）');

  /* ---------- 自动化环境默认不降级：墙照常滚，行为校验才测得准 ---------- */
  const auto = await probe(browser, base);
  ok(auto.metrics.length === 0 && auto.summary.includes('自动化环境'),
     'webdriver 环境跳过实测、保持 high（' + auto.summary + '）');
  ok(auto.wall === null, '自动化环境不写 data-wall，墙动画照常运行');

  /* ---------- 模拟掉帧设备：rAF 打桩成 34ms/帧（≈29fps） ---------- */
  const slow = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await slow.addInitScript(() => {
    /* 用真实 performance.now() 当时间戳，只是把投递节奏拉到 34ms */
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 34);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  });
  await slow.goto(base + '?perf=auto', { waitUntil: 'load', timeout: 60000 });
  await slow.waitForFunction(
    () => document.documentElement.getAttribute('data-perf') === 'low',
    { timeout: 12000 }
  ).catch(() => {});
  const dropped = await slow.evaluate(() => {
    const P = window.SITE_PERF;
    const els = document.querySelectorAll('.steamwall__col, .albumwall__row');
    const running = [].slice.call(els).reduce((n, el) =>
      n + el.getAnimations().filter(a => a.playState === 'running').length, 0);
    return {
      perf: document.documentElement.getAttribute('data-perf'),
      wall: document.documentElement.getAttribute('data-wall'),
      running: running,
      metrics: P ? P.metrics() : [],
      summary: P ? P.summary() : ''
    };
  });
  await slow.close();
  ok(dropped.perf === 'low', '模拟 29fps 设备后自动判为 low（' + dropped.summary + '）');
  ok(dropped.metrics.length >= 2 && dropped.metrics.every(m => m.avgMs > 22),
     '判低依据是实测帧耗时超标（' + dropped.metrics.map(m => m.avgMs + 'ms').join(' / ') + '）');
  ok(dropped.wall === 'static' && dropped.running === 0,
     '运行中降级后墙动画确实停了（running=' + dropped.running + '）');

  await browser.close();

  notes.forEach(n => console.log(n));
  if (fails.length) console.log('\n失败明细:\n' + fails.map(f => '· ' + f).join('\n') + '\n');
  console.log('检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) process.exit(1);
  console.log('\n全部通过');
})().catch(e => { console.error('ERR', e); process.exit(1); });
