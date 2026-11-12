/* ==========================================================================
 *  复制入口回归测试：node tools/verify-copy.js
 * --------------------------------------------------------------------------
 *  这个脚本守的是一个真实发生过的 BUG：
 *
 *  点联系卡复制时，图标会被「已复制」三个字顶掉，整张卡塌一下再弹回来。
 *  根因在 motion.js 的反馈代码——它用 btn.querySelector("span") 找"那个要改文案
 *  的元素"，而它命中的是**第一个** span。对联系卡来说第一个 span 是图标容器
 *  .ccard__icon，于是图标被文字替换。同一个写法还潜伏在另外两个入口里：
 *  Q5 的 copy 型社交按钮（第一个 span 是 .social__icon）、
 *  游戏卡 UID（第一个 span 是 .game__uid-label）。
 *
 *  现在的约定，也就是这里逐条断言的东西：
 *    · 反馈只能落在显式标了 [data-copy-hint] 的元素上，别的节点一个字都不许变
 *    · 复制前后，按钮内**第一个子元素**（图标位）的盒子与内容都不变
 *    · 按钮整体高度不变（不许因为换文案而抖动）
 *    · Toast 说「已复制 QQ」这类话，绝不回显账号明文
 *    · 1.6s 后提示文字自动还原，不会永久停在「已复制」
 *    · 剪贴板里拿到的确实是 data-copy 里那个值
 *
 *  ⚠️ 需要剪贴板权限：context 里显式给了 clipboard-read / clipboard-write，
 *     否则 navigator.clipboard.writeText 会以 NotAllowedError 拒绝，
 *     测试会误报成"复制失败"。
 *
 *  依赖：playwright-core + 本地 chromium
 *
 *  可以指到线上跑：node tools/verify-copy.js https://zottfoy.github.io/
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* 三个复制入口，各代表一种 DOM 形状：
   卡（有自己的图标块）/ 纯图标按钮 / 带文字标签的按钮

   ⚠️ 2026-11-12：摘掉了 `.game__uid`（游戏好友码）。
   「一卡一游戏」那版之后好友码改成了战绩板顶栏的说明文字
   （.gb-head__id），**不再是按钮** —— 点击由整块 .game-board 链接接管，
   所以它本来就不该出现在"复制入口"这张表里（原来这项一直是 0 个）。 */
const KINDS = [
  { sel: '.ccard', page: 'top', name: '联系卡', hint: true },
  { sel: '.social[data-copy]', page: 'links', name: '社交复制按钮', hint: false },
  { sel: '.btn[data-copy]', page: 'contact', name: '复制邮箱按钮', hint: true }
];

/* 记下按钮的"骨架"：自身盒子、第一个子元素的盒子与内容、谁说出了「已复制」 */
const SNAP = ([sel, i]) => {
  const btn = document.querySelectorAll(sel)[i];
  if (!btn) return null;
  const box = el => {
    const b = el.getBoundingClientRect();
    return [Math.round(b.width * 100) / 100, Math.round(b.height * 100) / 100];
  };
  const first = btn.firstElementChild;
  const svgIn = el => !!el && (el.querySelector('svg') || el.tagName.toLowerCase() === 'svg');
  return {
    h: Math.round(btn.getBoundingClientRect().height * 100) / 100,
    firstBox: first ? box(first) : null,
    firstHadSvg: svgIn(first),
    firstStillHasSvg: svgIn(first),
    hintText: btn.querySelector('[data-copy-hint]')
      ? btn.querySelector('[data-copy-hint]').textContent : null,
    /* 叶子节点里有没有人正在说「已复制」——除 hint 之外都算越界 */
    sayers: [...btn.querySelectorAll('*')]
      .filter(el => !el.children.length && el.textContent.trim() === '已复制')
      .map(el => (el.hasAttribute('data-copy-hint') ? 'hint' : (el.getAttribute('class') || el.tagName))),
    text: (btn.innerText || '').replace(/\s+/g, ' ').trim(),
    want: btn.getAttribute('data-copy'),
    toast: btn.getAttribute('data-copy-toast')
  };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  /* ------------------------------------------------ 1. 全体必须自带提示语 */
  const bare = await page.evaluate(() =>
    [...document.querySelectorAll('[data-copy]')]
      .filter(el => !el.getAttribute('data-copy-toast'))
      .map(el => el.className || el.tagName));
  ok(bare.length === 0, '每个 [data-copy] 都声明了 data-copy-toast（Toast 不回显账号）'
    + (bare.length ? '（缺：' + bare.join(', ') + '）' : ''));

  /* ------------------------------------------------ 2. 逐个入口真点一遍 */
  for (const kind of KINDS) {
    await page.locator('#' + kind.page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(420);

    const n = await page.locator(kind.sel).count();
    ok(n > 0, kind.name + ' 存在（' + n + ' 个）');
    if (!n) continue;

    for (let i = 0; i < n; i++) {
      const tag = kind.name + ' #' + (i + 1) + ' ';
      const before = await page.evaluate(SNAP, [kind.sel, i]);
      const el = page.locator(kind.sel).nth(i);
      await el.scrollIntoViewIfNeeded();
      await el.click();
      await page.waitForTimeout(260);
      const during = await page.evaluate(SNAP, [kind.sel, i]);

      /* 剪贴板里到底有没有东西 */
      const got = await page.evaluate(async () => {
        try { return await navigator.clipboard.readText(); } catch (e) { return '(读不到)'; }
      });
      ok(got === before.want, tag + '剪贴板内容 = data-copy（' + before.want + '）');

      /* Toast 文案 */
      const toastTxt = await page.evaluate(() =>
        (document.getElementById('toast') || {}).textContent || '');
      ok(toastTxt === before.toast, tag + 'Toast 说的是配置的文案「' + before.toast + '」');
      ok(toastTxt.indexOf(before.want) < 0, tag + 'Toast 不回显复制的值');

      /* 图标位没被顶掉 —— 这就是原来那个 BUG */
      ok(JSON.stringify(during.firstBox) === JSON.stringify(before.firstBox),
        tag + '第一个子元素盒子不变（' + before.firstBox.join('×') + '）');
      ok(!before.firstHadSvg || during.firstStillHasSvg, tag + '第一个子元素里的图标没被文字替换');

      /* 高度不抖 */
      ok(during.h === before.h, tag + '复制期间高度不变（' + before.h + 'px）');

      /* 「已复制」只允许出现在 hint 上 */
      const stray = during.sayers.filter(s => s !== 'hint');
      ok(stray.length === 0, tag + '「已复制」只出现在 [data-copy-hint] 上'
        + (stray.length ? '（越界：' + stray.join(', ') + '）' : ''));

      /* 有 hint 的必须真的换了文案，没有的必须一个字不动 */
      if (kind.hint) {
        ok(during.hintText === '已复制', tag + '提示文字变成「已复制」');
        ok(before.hintText !== '已复制', tag + '原文不是「已复制」（还原有得可还）');
      } else {
        ok(during.text === before.text, tag + '没有 hint 的入口文字完全不变');
      }

      /* 1.6s 后还原 */
      await page.waitForTimeout(1500);
      const after = await page.evaluate(SNAP, [kind.sel, i]);
      if (before.hintText !== null) {
        ok(after.hintText === before.hintText, tag + '提示文字自动还原为「' + before.hintText + '」');
      }
      ok(after.sayers.length === 0, tag + '还原后没有任何元素还写着「已复制」');
    }
  }

  /* ----------------------------------------- 3. 联系卡上不该再有账号明文 */
  const cards = await page.evaluate(() => {
    const C = window.SITE_CONFIG || {};
    const list = (C.profile && C.profile.contacts) || [];
    const nodes = [...document.querySelectorAll('.ccard')];
    return nodes.map((el, i) => ({
      label: list[i] && list[i].label,
      value: list[i] && list[i].value,
      text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      hint: (el.querySelector('.ccard__hint') || {}).textContent || '',
      aria: el.getAttribute('aria-label') || ''
    }));
  });
  cards.forEach(c => {
    ok(c.text.indexOf(c.value) < 0, '[联系卡] 卡面不出现账号明文（' + c.label + '）');
    ok(c.text.indexOf(c.label) === 0, '[联系卡] 卡面第一行是平台名「' + c.label + '」');
    ok(c.hint === '点击复制', '[联系卡] 右侧是「点击复制」');
    ok(c.aria.indexOf(c.value) >= 0, '[联系卡] aria-label 仍带账号（读屏用户拿得到）');
  });

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  await browser.close();

  notes.forEach(n => console.log(n));
  if (fails.length) {
    console.log('\n失败明细:');
    fails.forEach(f => console.log('· ' + f));
  }
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  console.log(fails.length ? '\n有问题' : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})();
