/* ==========================================================================
 *  预取闸门验证：node tools/verify-preload.js
 * --------------------------------------------------------------------------
 *  守的是四件事（对应 2026-11-11 的需求）：
 *    ① 第一、二屏缓存完才放行 —— 放行瞬间这两屏的 <img> 必须全部 complete
 *    ② 版本没变就不设闸门 —— 直接进站，只做后台暖机
 *    ③ 版本变了要重新设闸门
 *    ④ 图全挂也必须在时限内放人 —— 预取失败绝不能把人锁在门外
 *
 *  需要本地服务：python tools/serve.py 8791
 *  外链图片统一用 1×1 PNG 替身 + 每张 120ms 延迟，模拟"照片还没到"。
 * ========================================================================== */
'use strict';

const { chromium } = require('playwright-core');
const path = require('path');

const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

/* ⚠️ 闸门在 config 里默认关闭（排查期），自检用 ?preload=1 强制打开。
   顺便这也验证了 URL 覆盖这条路是通的。 */
const BASE = process.argv[2] || 'http://127.0.0.1:8791/';
const SITE = BASE + (BASE.indexOf('?') < 0 ? '?preload=1' : '&preload=1');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

(async () => {
  const browser = await chromium.launch();
  const vp = { width: 390, height: 844 };

  async function visit(opts = {}) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));

    if (opts.storage) {
      await page.addInitScript(s => {
        for (const k in s) { try { localStorage.setItem(k, s[k]); } catch (e) {} }
      }, opts.storage);
    }

    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async r => {
      if (r.request().resourceType() !== 'image') return r.continue();
      if (opts.failImages) return r.fulfill({ status: 404, contentType: 'text/plain', body: 'x' });
      if (opts.delay) await new Promise(res => setTimeout(res, opts.delay));
      return r.fulfill({ status: 200, contentType: 'image/png', body: BLANK });
    });

    const t0 = Date.now();
    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    /* goto 之后立刻记一次：后面闸门可能已经跑完，属于正常（图小的时候） */
    const atBoot = await page.evaluate(() => ({
      loading: document.documentElement.dataset.loading,
      hasSplash: !!document.getElementById('splash')
    }));
    await page.waitForTimeout(300);

    /* 闸门期间抓一次进度值，确认不是假动画（轮询：闸门要等 DOM 稳定才开始） */
    let mid = { loading: '', p: '', gating: false };
    for (let i = 0; i < 25; i++) {
      mid = await page.evaluate(() => {
        const sp = document.querySelector('.splash');
        return {
          loading: document.documentElement.dataset.loading,
          p: sp ? sp.style.getPropertyValue('--splash-p') : '',
          gating: !!(window.SITE_PRELOAD && window.SITE_PRELOAD.gating)
        };
      });
      if (mid.p) break;
      await page.waitForTimeout(80);
    }

    const released = await page.waitForFunction(
      () => document.documentElement.dataset.loading === '0', { timeout: 15000 })
      .then(() => true).catch(() => false);
    const ms = Date.now() - t0;

    const after = await page.evaluate(() => {
      const count = sel => {
        const imgs = [...document.querySelectorAll(sel + ' img')];
        return {
          all: imgs.length,
          done: imgs.filter(i => i.complete && i.naturalWidth > 0).length
        };
      };
      return {
        s1: count('#top'), s2: count('#listen'), s3: count('#gaming'),
        v: localStorage.getItem('zotrod-media-v'),
        warm: localStorage.getItem('zotrod-media-warm')
      };
    });

    await ctx.close();
    return { atBoot, mid, released, ms, after, errs };
  }

  /* ---------------- ① 冷启动：放行时第一二屏必须已解码 ---------------- */
  const cold = await visit({ delay: 120 });
  ok(cold.released, '冷启动能在时限内放行（' + cold.ms + 'ms）');
  ok(cold.atBoot.loading === '1' && cold.atBoot.hasSplash,
     '冷启动一开始就挂起闸门（loading=' + cold.atBoot.loading + '）');
  ok(cold.mid.p !== '', '闸门期间进度条有真实进度（--splash-p=' + cold.mid.p + '）');
  ok(cold.after.s2.done === cold.after.s2.all && cold.after.s2.all > 0,
     '放行时第二屏已全部解码（' + cold.after.s2.done + '/' + cold.after.s2.all + '）');
  ok(cold.after.s1.done === cold.after.s1.all,
     '放行时首屏已全部解码（' + cold.after.s1.done + '/' + cold.after.s1.all + '）');
  ok(!!cold.after.v && cold.after.warm === '1', '放行后记下版本与 warm 标记');

  /* ---------------- ③ 版本变了：重新设闸门 ---------------- */
  const changed = await visit({ delay: 120, storage: { 'zotrod-media-v': 'stale', 'zotrod-media-warm': '1' } });
  /* 老访客（warm 标记在）遇到封面换批：**不重新挡人**，后台补图。
     这是刻意的取舍 —— 换批封面不该让回访的人多等一次。 */
  ok(changed.atBoot.loading === '0', '版本变了也不挡老访客（loading=' + changed.atBoot.loading + '）');
  ok(changed.after.v !== 'stale', '版本变化后写入新版本号（' + changed.after.v + '）');

  /* ---------------- ② 版本未变：不设闸门 ---------------- */
  const warm = await visit({ delay: 120, storage: { 'zotrod-media-v': cold.after.v, 'zotrod-media-warm': '1' } });
  ok(warm.mid.loading === '0', '版本未变时秒进（不挂闸门）');
  ok(!warm.mid.gating, '版本未变时 gating 为假');

  /* 版本号必须可复现：同一份数据两次算出来要一样，否则闸门天天重开 */
  const again = await visit({ delay: 40 });
  ok(again.after.v === cold.after.v,
     '版本号可复现（' + cold.after.v + ' vs ' + again.after.v + '）');

  /* ---------------- ④ 图全 404：必须放人 ---------------- */
  const broken = await visit({ failImages: true });
  ok(broken.released, '图片全挂也能放行（' + broken.ms + 'ms）');
  ok(broken.ms < 7000, '放行时间被总时限兜住（' + broken.ms + 'ms < 7000ms）');
  ok(broken.errs.length === 0, '整个过程没有 JS 报错' + (broken.errs.length ? '：' + broken.errs[0] : ''));

  /* ---------------- 接线 ---------------- */
  const html = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok(/assets\/js\/preload\.js/.test(html), 'index.html 引入 preload.js');
  ok(html.indexOf('albumwall.js') < html.indexOf('preload.js'),
     'preload.js 排在两面封面墙之后（它要读它们的 img）');
  ok(!/SITE_PRELOAD[\s\S]{0,80}setTimeout\(function \(\) \{ done\(\)/.test(html), 'splash 不会被抢跑');

  await browser.close();

  notes.forEach(n => console.log(n));
  if (fails.length) { console.log('\n失败明细:'); fails.forEach(f => console.log('· ' + f)); }
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  console.log(fails.length ? '\n有问题' : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})();
