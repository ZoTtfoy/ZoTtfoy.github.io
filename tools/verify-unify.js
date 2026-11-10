/* ==========================================================================
 *  设计一致性验证：node tools/verify-unify.js [URL]
 * --------------------------------------------------------------------------
 *  这个脚本守的是「同一种东西长得应该一样」这件事。
 *
 *  起因是一次真实反馈：「元素太不统一了」。量了一遍才发现有多散：
 *    · 圆角  10/16/22 之外还有 7px、8px、1px 的手写近似值
 *    · 阴影  只有 .ccard 有，Q3/Q5 同样是白卡却贴平
 *    · hover .ccard 描边+阴影+上浮 / .game 只描边 / .social 描边+图标变色
 *    · 字号  同一个「卡片副标题」角色出现 11.36 / 11.52 / 12.32 三种值
 *    · 小标签 .game__uid-label 只有 8.96px，低于 11px 可读下限
 *
 *  统一的做法是新增 unify.css（最后加载），只在那一处定义"白卡"的最终值。
 *  这个脚本负责三件事：
 *    1. 白卡家族（.ccard/.game/.social/.calc）的圆角 / 边框 / 底色 / 阴影一致
 *    2. hover 在桌面端一致（悬停时三件事一起做）
 *    3. 同角色字号一致，且没有低于可读下限的辅助文字
 *
 *  ⚠️ 断言的是"家族内部一致"，不是"所有人都长一样"：
 *     .preview 是下沉的次要卡、.track 是紧凑磁贴，它们有权不同 ——
 *     但它们的不同必须是**有理由的**（底色不同 / 尺寸不同），而不是随手的近似值。
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* 白卡家族：实心抬升底 + 1px 细线 + 可点击 */
const FAMILY = ['.ccard', '.game', '.social', '.calc'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.route('**/v1.hitokoto.cn/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ hitokoto: '把复杂的东西，做得简单一点。', from: '测试' })
  }));
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  /* ---------------------------------------- 1. 白卡家族：四样属性对齐 */
  const styles = await page.evaluate((sels) => {
    const out = {};
    sels.forEach(s => {
      const el = document.querySelector(s);
      if (!el) { out[s] = null; return; }
      const c = getComputedStyle(el);
      out[s] = {
        radius: c.borderTopLeftRadius,
        borderW: c.borderTopWidth,
        borderC: c.borderTopColor,
        bg: c.backgroundColor,
        shadow: c.boxShadow === 'none' ? 'none' : 'has'
      };
    });
    return out;
  }, FAMILY);

  const present = FAMILY.filter(s => styles[s]);
  ok(present.length === FAMILY.length,
    '白卡家族全部存在（' + present.join(' ') + '）');

  const uniqBy = (key) => [...new Set(present.map(s => styles[s][key]))];
  const r = uniqBy('radius');
  ok(r.length === 1, '白卡圆角统一（' + r.join(' / ') + '）');
  const bw = uniqBy('borderW');
  ok(bw.length === 1 && bw[0] === '1px', '白卡描边宽度统一 1px（' + bw.join(' / ') + '）');
  const bc = uniqBy('borderC');
  ok(bc.length === 1, '白卡描边颜色统一（' + bc.join(' / ') + '）');
  const bg = uniqBy('bg');
  ok(bg.length === 1, '白卡底色统一（' + bg.join(' / ') + '）');
  const sh = uniqBy('shadow');
  ok(sh.length === 1 && sh[0] === 'has', '白卡都带同一道投影（' + sh.join(' / ') + '）');

  /* ---------------------------------------------- 2. hover 语言一致 */
  /* 桌面端悬停时，家族里除了 .calc（表单容器）之外都应同时
     加深描边 + 抬阴影 + 上浮 1px。用 CDP 之外的办法：读规则不如真悬停。 */
  const hoverables = ['.ccard', '.game', '.social'];
  for (const sel of hoverables) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;

    /* ⚠️ 先翻到它所在的那一屏，等吸附停稳，再悬停。
       直接 el.hover() 会让 Playwright 自己滚过去，而滚动会触发翻页吸附 ——
       两股力互相拉扯，停稳后元素已经离开指针，:hover 丢失，
       读到的描边自然「没变」。（实测 social：120ms 时已加深，700ms 被挤走又复原。） */
    await page.evaluate((s) => {
      const node = document.querySelector(s);
      const sec = node && node.closest('section');
      const P = window.SITE_PAGED;
      if (!sec || !P || typeof P.pages !== 'function') return;
      const i = P.pages().findIndex(e => e && e.id === sec.id);
      if (i >= 0) P.goTo(i);
    }, sel);
    await page.waitForTimeout(1000);

    const read = () => el.evaluate(e => {
      const c = getComputedStyle(e);
      return { bc: c.borderTopColor, sh: c.boxShadow, tf: c.transform };
    });
    const before = await read();
    await el.hover();

    /* 过渡是 var(--t-fast)，但帧率由环境决定（无头下 ~18fps），
       所以等条件成立而不是等固定时长。 */
    let after = before;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(140);
      after = await read();
      if (after.bc !== before.bc) break;
    }
    ok(after.bc !== before.bc, sel + ' 悬停时描边加深');
    ok(after.tf !== before.tf, sel + ' 悬停时上浮（transform 变化）');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(220);
  }

  /* -------------------------------- 3. 圆角只有设计 token 里的那几种 */
  const radii = await page.evaluate(() => {
    const allowedPrefix = ['0px'];
    const seen = {};
    document.querySelectorAll('body *').forEach(el => {
      const c = getComputedStyle(el);
      if (c.borderTopWidth === '0px' && c.backgroundColor === 'rgba(0, 0, 0, 0)') return;
      if (c.borderRadius === '0px') return;
      const k = c.borderRadius;
      seen[k] = (seen[k] || 0) + 1;
    });
    return { seen, allowedPrefix };
  });
  /* token: --r-xs 4 / --r-sm 10 / --r-md 16 / --r-lg 22 / --r-full 999 / 50% / 1px(细条) */
  const LEGAL = ['4px', '10px', '16px', '22px', '999px', '50%', '1px'];
  const weird = Object.keys(radii.seen).filter(k => {
    if (LEGAL.includes(k)) return false;
    /* 四角写法（药丸色块）允许，但每一角也必须是合法值 */
    const parts = k.split(' ');
    return !(parts.length === 4 && parts.every(p => LEGAL.includes(p)));
  });
  ok(weird.length === 0,
    '没有游离在设计刻度之外的圆角' + (weird.length ? '（' + weird.join(', ') + '）' : ''));

  /* ------------------------------------- 4. 同角色字号一致 + 可读下限 */
  const type = await page.evaluate(() => {
    const g = s => { const el = document.querySelector(s); return el ? parseFloat(getComputedStyle(el).fontSize) : null; };
    return {
      titles: {
        '.game__name': g('.game__name'),
        '.social__label': g('.social__label'),
        '.preview__title': g('.preview__title')
      },
      subs: {
        '.social__handle': g('.social__handle'),
        '.preview__meta': g('.preview__meta')
      },
      tiny: {
        '.game__uid-label': g('.game__uid-label'),
        '.track__meta': g('.track__meta'),
        '.ccard__hint': g('.ccard__hint')
      }
    };
  });

  const tVals = Object.values(type.titles).filter(v => v != null);
  ok(new Set(tVals).size === 1,
    '卡片主标题字号一致（' + tVals.join(' / ') + '）');
  const sVals = Object.values(type.subs).filter(v => v != null);
  ok(new Set(sVals).size === 1,
    '卡片副标题字号一致（' + sVals.join(' / ') + '）');

  /* 11px 是可读下限：比这更小的辅助文字，读者得凑近看 */
  const tooSmall = Object.entries(type.tiny).filter(([, v]) => v != null && v < 11);
  ok(tooSmall.length === 0,
    '辅助文字都不低于 11px' + (tooSmall.length ? '（' + tooSmall.map(([k, v]) => k + '=' + v + 'px').join(', ') + '）' : ''));

  /* -------------------------------------------- 5. 统一层被真正加载 */
  const loaded = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')));
  const idx = loaded.findIndex(h => /unify\.css$/.test(h || ''));
  ok(idx === loaded.length - 1,
    'unify.css 是最后一张样式表（第 ' + (idx + 1) + '/' + loaded.length + ' 张）');

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  await browser.close();

  notes.forEach(n => console.log(n));
  if (fails.length) { console.log('\n失败明细:'); fails.forEach(f => console.log('· ' + f)); }
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  console.log(fails.length ? '\n有问题' : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})();
