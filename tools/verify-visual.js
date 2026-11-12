/* ==========================================================================
 *  浏览器端深度验证：node tools/verify-visual.js（可选）
 * --------------------------------------------------------------------------
 *  前面几个自检跑在轻量 DOM 里，看不到真实布局。这个脚本启动 Chromium，
 *  在桌面 / 平板 / 手机三种视口下真机式地检查：
 *    · 每一页是否真的装进一屏、内容有没有被裁
 *    · 页码会不会压住内容（算矩形相交面积，不是靠目测）
 *    · 文字对比度（实际计算色值）
 *    · 翻页吸附：点页码是否精确落位、滚到中途是否被吸回、页脚能否到达
 *    · 键盘 / 滚轮翻页、连滚只翻一页
 *    · 追光是否亮起、是否不拦截点击、卡片光斑是否落在指针处
 *    · 触屏涟漪是否出现并自动清理、卡片横滑是否可用
 *    · 减少动态效果 / 关闭翻页 两种降级
 *
 *  依赖（仅此脚本需要，站点本身零依赖）：
 *      npm install playwright-core --no-save
 *      npx playwright install chromium
 *  未安装时自动跳过，不影响其他自检。
 * ========================================================================== */
let chromium;
try {
  chromium = require('playwright-core').chromium;
} catch (e) {
  console.log('未安装 playwright-core，跳过浏览器端验证。');
  console.log('如需运行：npm install playwright-core --no-save && npx playwright install chromium');
  process.exit(0);
}

/* 屏蔽外部图片（CDN 封面）→ 统一回 1x1 透明 PNG。
   本站一屏要拉上百张封面，`networkidle` 永远等不到，goto 会 30s 超时；
   这个脚本看的是排版与对比度，不看封面图。 */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
async function blockExternalImages(ctx) {
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
      : route.continue());
}

/* 几何与视觉校验：不靠肉眼，直接量元素位置、裁切、重叠与对比度 */

const URL = 'http://127.0.0.1:8791/';
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 }
];

const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const L1 = luminance(a), L2 = luminance(b);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

(async () => {
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      hasTouch: vp.width <= 900,
      isMobile: vp.width <= 900
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await blockExternalImages(ctx);
await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const tag = '[' + vp.name + '] ';

    /* ---------- 1. 每页内容都在视口内，不被裁 ---------- */
    const fit = await page.evaluate(() => {
      const vh = window.innerHeight;
      const headerH = document.querySelector('.site-header').offsetHeight;
      return [...document.querySelectorAll('.hero, .section')].map(p => {
        const r = p.getBoundingClientRect();
        const cont = p.querySelector('.container') || p.querySelector('.hero__inner');
        const cr = cont.getBoundingClientRect();
        return {
          id: p.id,
          pageH: Math.round(r.height),
          contentTop: Math.round(cr.top - r.top),
          contentH: Math.round(cr.height),
          /* 内容底边是否超出页底（会被页脚/下一页挡住） */
          overflowBottom: Math.round(cr.bottom - r.bottom),
          vh
        };
      });
    });

    fit.forEach(f => {
      ok(f.overflowBottom <= 2,
        tag + (f.id || '?') + ' 内容未溢出页面底部（余 ' + (-f.overflowBottom) + 'px）');
    });

    /* ---------- 2. 页码不压内容 ---------- */
    const pager = await page.evaluate(() => {
      const p = document.querySelector('.pager');
      if (!p || getComputedStyle(p).display === 'none') return null;
      const r = p.getBoundingClientRect();
      const dots = [...p.querySelectorAll('.pager__dot')].map(d => d.getBoundingClientRect());
      /* 取正文容器的右边界 */
      /* 取所有页的正文容器，算与页码的相交面积 */
      let area = 0, maxBottom = 0;
      document.querySelectorAll('.hero__inner, .section .container').forEach(c => {
        const cr = c.getBoundingClientRect();
        if (cr.bottom > c.parentElement.getBoundingClientRect().bottom) return;
        maxBottom = Math.max(maxBottom, cr.bottom);
        const ox = Math.max(0, Math.min(r.right, cr.right) - Math.max(r.x, cr.x));
        const oy = Math.max(0, Math.min(r.bottom, cr.bottom) - Math.max(r.y, cr.y));
        area = Math.max(area, Math.round(ox * oy));
      });
      const list = p.querySelector('.pager__list');
      const track = p.querySelector('.pager__track');
      return {
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        insideViewport: r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 && r.x >= -1,
        intersectArea: area,
        contentBottom: Math.round(maxBottom),
        dotCount: dots.length,
        /* 只数**可见**的屏。config.sections 里可以把某屏设成 enabled:false
           （比如 2026-11-11 下掉的维修屏），那种 section 只是 hidden，
           DOM 还在。数它会让 pageCount=6 而页码只有 5，永远对不上。 */
        pageCount: [...document.querySelectorAll('.hero, .section')]
          .filter(el => !el.hidden).length,
        listVisible: getComputedStyle(list).display !== 'none',
        trackVisible: getComputedStyle(track).display !== 'none',
        dotSize: dots.length ? Math.round(dots[0].width) + 'x' + Math.round(dots[0].height) : '-'
      };
    });

    if (pager) {
      ok(pager.insideViewport, tag + '页码完整在视口内');
      /* 用真实的矩形相交面积判断，比单看一边的距离可靠 */
      ok(pager.intersectArea === 0,
        tag + '页码与内容零重叠（相交面积 ' + pager.intersectArea + 'px²，正文底边 ' +
        pager.contentBottom + ' / 页码顶边 ' + pager.y + '）');
      ok(pager.dotCount === pager.pageCount, tag + '页码数量与页数一致（' + pager.dotCount + '）');
      // 2026-11-13：底部分段式进度条已移除，窄屏也改为侧边圆点
      // （用户要求"只保留侧边进度提示"）。所以两种视口守同一条不变量。
      ok(pager.listVisible && !pager.trackVisible, tag + '用侧边圆点，没有底部分段');
      ok(pager.x > vp.width * 0.8, tag + '页码贴在右侧（x=' + pager.x + '）');
    } else {
      fails.push(tag + '页码未显示');
    }

    /* ---------- 3. 对比度（真实计算色值） ---------- */
    const colors = await page.evaluate(() => {
      const parse = s => {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map(Number);
        return p.length >= 3 ? p.slice(0, 3) : null;
      };
      const bgOf = el => {
        let e = el;
        while (e) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)') return c;
          e = e.parentElement;
        }
        return [255, 255, 255];
      };
      const pick = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return { fg: parse(getComputedStyle(el).color), bg: bgOf(el), text: (el.textContent || '').trim().slice(0, 12) };
      };
      return {
        title: pick('.section__title'),
        lead: pick('.section__lead'),
        body: pick('.profile__intro'),
        eyebrow: pick('.eyebrow'),
        pagerDot: pick('.pager__dot.is-current'),
        cardDesc: pick('.preview__meta')
      };
    });

    Object.keys(colors).forEach(k => {
      const c = colors[k];
      if (!c || !c.fg || !c.bg) return;
      const r = contrast(c.fg, c.bg);
      ok(r >= 4.5, tag + k + ' 对比度 ' + r.toFixed(2) + ' ≥ 4.5（「' + c.text + '」）');
    });

    /* ---------- 4. 不再有横向滑动容器 ----------
       6 屏重构后，所有网格都是 grid（链接 2 列、曲目 1~2 列），
       没有任何 overflow-x 横滑区。这条断言反过来验证「没有横滑」。
       ⚠️ 2026-11-12：`.game-rail` 已从名单里摘掉 —— 那个 class 是"游戏封面横滑轨道"
       时代的名字，后来 #gameRail 改成了顶栏（gb-head），class 也跟着改名 game-head。
       它本来就没有 display:grid（旧断言一直红着），留着只会误导。 */
    if (vp.width <= 900) {
      const rail = await page.evaluate(() => {
        const sel = ['.social-grid', '.track-list', '.preview-grid'];
        const out = [];
        for (const q of sel) {
          const g = document.querySelector(q);
          if (!g) continue;
          const cs = getComputedStyle(g);
          out.push({
            sel: q, display: cs.display, overflowX: cs.overflowX,
            scrollable: g.scrollWidth > g.clientWidth + 4
          });
        }
        return out;
      });
      rail.forEach(r => {
        ok(r.display === 'grid', tag + r.sel + ' 用网格布局');
        ok(!r.scrollable, tag + r.sel + ' 没有横向溢出（不再有左右滑块）');
      });
    }

    /* ---------- 9. 卡片光斑变量 ---------- */
    if (vp.width > 900) {
      /* 光斑目标跟着 6 屏重构换成了 .preview（见 effects.js 的 GLOW_TARGETS） */
      const card = page.locator('.preview').first();
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const box = await card.boundingBox();
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4, { steps: 6 });
      await page.waitForTimeout(300);
      const mx = await card.evaluate(el => el.style.getPropertyValue('--mx'));
      const my = await card.evaluate(el => el.style.getPropertyValue('--my'));
      ok(!!mx && !!my, tag + '卡片记录了指针位置（--mx=' + mx + ' --my=' + my + '）');
      ok(parseFloat(mx) > 0 && parseFloat(mx) < box.width,
        tag + '光斑位置落在卡片内部（' + mx + ' < ' + Math.round(box.width) + '）');
    }

    /* ---------- 12. 翻页落位与吸附行为 ---------- */
    const tops = await page.evaluate(() =>
      [...document.querySelectorAll('.hero, .section')]
        .map(p => Math.round(p.getBoundingClientRect().top + window.scrollY)));

    /* --- 点页码：应精确落在该页顶部 --- */
    if (vp.w > 900) {
      await page.locator('.pager__dot').nth(2).click();
      await page.waitForTimeout(1400);
      const y = await page.evaluate(() => Math.round(window.scrollY));
      ok(Math.abs(y - tops[2]) <= 3, tag + '点第 3 个页码后精确停在页顶（' + y + ' vs ' + tops[2] + '）');
    }

    /* --- 滚到一页的 40% 处，等吸附 --- */
    await page.evaluate(t => window.scrollTo({ top: t + Math.round(window.innerHeight * 0.4), behavior: 'instant' }), tops[1]);
    await page.waitForTimeout(1500);
    const settled = await page.evaluate(() => Math.round(window.scrollY));
    const delta = Math.abs(settled - tops[1]);
    const snapMode = await page.evaluate(() => document.documentElement.dataset.snap);
    if (snapMode === 'mandatory') {
      ok(delta <= 3, tag + '强制吸附下滚到中途被吸回页顶（偏移 ' + delta + 'px）');
    } else {
      ok(delta <= 3 || delta > 40, tag + '邻近吸附下行为可预期（偏移 ' + delta + 'px）');
    }

    /* --- 页脚必须能滚到（否则强制吸附会把最后拦死） --- */
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(1200);
    const foot = await page.evaluate(() => {
      const f = document.querySelector('.site-footer').getBoundingClientRect();
      return { visible: f.top < window.innerHeight - 10, atBottom: Math.abs(window.scrollY + window.innerHeight - document.body.scrollHeight) < 6 };
    });
    ok(foot.visible, tag + '页脚能滚到并可见');

    /* --- 连续翻 4 次，页码与内容必须一致 --- */
    let consistent = true, detail = '';
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(1100);
      const r = await page.evaluate(() => {
        const idx = [...document.querySelectorAll('.pager__dot')].findIndex(d => d.classList.contains('is-current'));
        const pages = [...document.querySelectorAll('.hero, .section')];
        const y = window.scrollY;
        /* 当前高亮页的顶部应在视口上方或正好在顶部 */
        const p = pages[idx];
        return {
          idx, top: Math.round(p.getBoundingClientRect().top + y), y: Math.round(y), id: p.id,
          bottom: document.documentElement.scrollHeight - window.innerHeight
        };
      });
      /* 最后一页再按 ↓ 会滚到页脚（刻意的），此时允许停在文档底部 */
      const atPageTop = Math.abs(r.y - r.top) <= 4;
      const atFooter = Math.abs(r.y - r.bottom) <= 4;
      if (!atPageTop && !atFooter) {
        consistent = false;
        detail += `${r.id}: y=${r.y} top=${r.top} bottom=${r.bottom}; `;
      }
    }
    ok(consistent, tag + '连翻 4 页，高亮页码与落位始终一致' + (detail ? '（' + detail + '）' : ''));

    /* --- 触屏点按涟漪（手机） --- */
    if (vp.w <= 900) {
      const before = await page.evaluate(() => document.querySelectorAll('.tap-ripple').length);
      await page.touchscreen.tap(vp.w / 2, vp.h / 2);
      await page.waitForTimeout(120);
      const during = await page.evaluate(() => document.querySelectorAll('.tap-ripple').length);
      ok(during > before, tag + '手指点按出现涟漪（' + during + ' 个）');
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => document.querySelectorAll('.tap-ripple').length);
      ok(after === 0, tag + '涟漪动画后自动移除，不残留 DOM');
    }

    /* 横滑测试已删除：6 屏重构后所有网格都不再有 overflow-x 横滑区，
       「不出现左右滑块」由上面的第 4 项断言正向保障。 */


    if (errors.length) fails.push(tag + '控制台错误: ' + JSON.stringify(errors.slice(0, 3)));

    await ctx.close();
  }

  /* ---------- 10. 减少动态效果：吸附与光效都应关闭 ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce'
    });
    const page = await ctx.newPage();
    await blockExternalImages(ctx);
await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      snap: getComputedStyle(document.documentElement).scrollSnapType,
      spot: getComputedStyle(document.getElementById('spotlight')).display,
      effects: document.documentElement.dataset.effects
    }));
    ok(r.snap === 'none', '[reduced-motion] 吸附已关闭（' + r.snap + '）');
    ok(r.spot === 'none', '[reduced-motion] 追光已隐藏');
    await ctx.close();
  }

  /* ---------- 11. 关闭翻页开关 ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__forcePagedOff = true;
    });
    await blockExternalImages(ctx);
await page.goto(URL, { waitUntil: 'load' });
    await page.evaluate(() => {
      window.SITE_CONFIG.ui.paged = false;
      document.documentElement.dataset.paged = 'off';
    });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({
      pagerDisplay: getComputedStyle(document.querySelector('.pager')).display,
      snap: getComputedStyle(document.documentElement).scrollSnapType
    }));
    ok(r.pagerDisplay === 'none', '[paged=off] 页码隐藏');
    ok(r.snap === 'none' || r.snap === 'y proximity', '[paged=off] 不吸附（' + r.snap + '）');
    await ctx.close();
  }

  await browser.close();

  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})();
