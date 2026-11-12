/* ==========================================================================
 *  设备档位 / 静态背景墙：node tools/verify-perf-tier.js
 * --------------------------------------------------------------------------
 *  守的是「低端设备不该被背景运算拖住」这条：
 *    · ?perf=low  → <html data-perf="low" data-wall="static">，两面墙的
 *      动画一个都不许在跑；但**图还在**（列/行元素与 background-image 保留），
 *      内容一点都不能少。
 *    · ?perf=high → 不写 data-wall，墙按原来的节奏滚。
 *  另外守一条防退化：默认档位不能把所有人都判成 low ——
 *  那样墙就永远不滚了，等于把功能做没了。
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

async function probe(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);
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
      summary: window.SITE_PERF ? window.SITE_PERF.summary() : '(无 SITE_PERF)'
    };
  });
  await page.close();
  return r;
}

(async () => {
  const browser = await chromium.launch();
  const base = SITE.replace(/\/$/, '/');

  /* ---------- 低端档 ---------- */
  const low = await probe(browser, base + '?perf=low');
  ok(low.perf === 'low', '?perf=low 时 <html data-perf="low">（' + low.summary + '）');
  ok(low.wall === 'static', '?perf=low 时 <html data-wall="static">');
  ok(low.running === 0, '低端档两面墙没有任何动画在跑（实测 ' + low.running + ' 条）');
  ok(low.cols === 6 && low.rows === 6,
     '低端档墙面结构不变（列 ' + low.cols + ' / 行 ' + low.rows + '）');
  ok(low.withBg === low.cols + low.rows,
     '低端档背景图仍在（' + low.withBg + ' 个元素有 background-image）');

  /* ---------- 高端档 ---------- */
  const high = await probe(browser, base + '?perf=high');
  ok(high.perf === 'high', '?perf=high 时 <html data-perf="high">');
  ok(high.wall === null, '高端档不写 data-wall');

  /* ---------- 默认档位不能把所有人判成 low ---------- */
  const def = await probe(browser, base);
  ok(def.perf === 'high' || (def.perf === 'low' && def.summary !== 'low'),
     '默认档位是按能力判的，不是无条件降级（' + def.summary + '）');

  await browser.close();

  notes.forEach(n => console.log(n));
  if (fails.length) console.log('\n失败明细:\n' + fails.map(f => '· ' + f).join('\n') + '\n');
  console.log('检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  if (fails.length) process.exit(1);
  console.log('\n全部通过');
})().catch(e => { console.error('ERR', e); process.exit(1); });
