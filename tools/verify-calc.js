/* ==========================================================================
 *  估价器（Q4）交互验证：node tools/verify-calc.js
 * --------------------------------------------------------------------------
 *  其它脚本验的是"页面长什么样"，这个脚本验的是"点下去会发生什么"：
 *    · 一次只问一件事，选完自动跳到下一问
 *    · 四步走完才出价格，价格 = 项目价 × 设备系数 × 材料系数 + 加项
 *    · 卡片高度在四步之间不变（变了下面两张卡会跟着跳）
 *    · 回头改答案：直接出结果，不会把读者又拖回后面的问题
 *    · 换设备后原来的项目不适用时会被清空，并重新问「要修哪一项」
 *    · 选项触控高度 ≥ 44px（拇指能点中）
 *    · 键盘可用：Tab 进得去，Enter 能选中并前进，方向键只挪焦点不误选
 *
 *  依赖（仅浏览器脚本需要）：playwright-core + 本地 chromium
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.locator('#repair').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const card = page.locator('#repairCalc');
  /* 出结果后没有 .calc__label —— 用空串代替，省得每次先判空 */
  const label = async () => (await card.locator('.calc__label').count())
    ? card.locator('.calc__label').innerText() : '';
  const opts = () => card.locator('.calc__opt').allInnerTexts();
  const trail = () => card.locator('.calc__trail__item').allInnerTexts();
  const press = async (name) => {
    await card.locator('.calc__opt', { hasText: new RegExp('^' + name + '$') }).first().click();
    await page.waitForTimeout(140);
  };
  const height = () => card.evaluate(el => Math.round(el.getBoundingClientRect().height));

  /* 配置里的原始数值：手算一遍去对页面上的数字，而不是让 compute() 自证 */
  const CFG = await page.evaluate(() => window.SITE_CONFIG.repair.calculator);
  const by = (arr, id) => (arr || []).find(x => x.id === id);
  const CUR = CFG.currency || '¥';
  const money = (svc, dev, mat, ext) => {
    const mid = svc.price * dev.factor * mat.factor + (ext.add || 0);
    return [Math.round(mid * CFG.range[0]), Math.round(mid * CFG.range[1])];
  };

  /* ---------------------------------------------------------- 1. 首问 */
  ok((await opts()).length === 4, '第一步只显示设备，四选一（当前 ' + (await opts()).join('/') + '）');
  ok(/这是.*设备/.test(await label()), '第一步问的是设备');
  ok((await trail()).length === 4, '顶部有四格进度');
  ok((await trail()).every(t => /^\d\s*(设备|项目|材料|加项)$/.test(t.trim())),
    '未开始时进度格显示的是四个步骤名');

  const h0 = await height();
  const optH = await card.locator('.calc__opt').first().evaluate(el => Math.round(el.getBoundingClientRect().height));
  ok(optH >= 44, '选项触控高度 ' + optH + 'px ≥ 44');

  /* -------------------------------------------------- 2. 自动跳转 */
  await press('手机');
  ok(/哪一项/.test(await label()), '选完设备自动跳到「项目」，不需要点下一步');
  ok((await trail())[0].includes('手机'), '第一格变成已选答案「手机」');
  const h1 = await height();
  ok(h1 === h0, '第 2 步卡片高度不变（' + h0 + 'px）');
  ok(!(await opts()).some(t => t === '清灰保养'),
    '手机做不了的项目被过滤掉（清灰保养只给笔记本/游戏机）');

  await press('换屏');
  ok(/什么料/.test(await label()), '选完项目自动跳到「材料」');
  const h2 = await height();
  ok(h2 === h0, '第 3 步卡片高度不变（材料只有 3 个选项也没塌陷）');

  await press('品牌');
  ok(/加急|上门/.test(await label()), '选完材料自动跳到「加项」');
  ok(await page.locator('.calc__price').count() === 0, '四步没走完不报价');
  const h3 = await height();
  ok(h3 === h0, '第 4 步卡片高度不变');

  await press('加急');
  const price = (await card.locator('.calc__price').innerText()).replace(/\s+/g, '');
  const [lo, hi] = money(by(CFG.services, 'screen'), by(CFG.devices, 'phone'),
    by(CFG.materials, 'brand'), by(CFG.extras, 'rush'));
  ok(price === CUR + lo + '–' + hi, '价格 = ' + CUR + lo + '–' + hi + '（页面：' + price + '）');
  ok((await trail()).every((t, i) => t.includes(['手机', '换屏', '品牌', '加急'][i])),
    '四格进度都换成了答案');
  ok((await card.locator('.calc__opt').count()) === 0, '出结果后不再显示选项');

  /* ---------------------------------------------- 3. 回头改答案 */
  await card.locator('.calc__trail__item').nth(1).click();
  await page.waitForTimeout(160);
  ok(/哪一项/.test(await label()), '点第 2 格回到「项目」');
  await press('换电池');
  const p2 = (await card.locator('.calc__price').innerText()).replace(/\s+/g, '');
  const [lo2, hi2] = money(by(CFG.services, 'battery'), by(CFG.devices, 'phone'),
    by(CFG.materials, 'brand'), by(CFG.extras, 'rush'));
  ok(p2 === CUR + lo2 + '–' + hi2, '改完项目直接出新价 ' + CUR + lo2 + '–' + hi2 + '（页面：' + p2 + '）');
  ok((await card.locator('.calc__price').count()) === 1,
    '没有把读者又拖回「材料」或「加项」，改完直接停在结果');

  /* -------------------------------------------- 4. 换设备后的清理 */
  /* 4a. 新设备仍然能做原来那项 → 直接按新系数出价 */
  await card.locator('.calc__trail__item').nth(0).click();
  await page.waitForTimeout(160);
  await press('游戏机');
  ok((await card.locator('.calc__price').count()) === 1,
    '换成游戏机后直接出价（换电池游戏机也能做，不必重问项目）');
  const p3 = (await card.locator('.calc__price').innerText()).replace(/\s+/g, '');
  const [lo3, hi3] = money(by(CFG.services, 'battery'), by(CFG.devices, 'console'),
    by(CFG.materials, 'brand'), by(CFG.extras, 'rush'));
  ok(p3 === CUR + lo3 + '–' + hi3, '价格按游戏机系数重算 ' + CUR + lo3 + '–' + hi3 + '（页面：' + p3 + '）');

  /* 4b. 新设备做不了原来那项 → 清空并重新问「项目」 */
  await card.locator('.calc__trail__item').nth(0).click();
  await page.waitForTimeout(160);
  await press('手机');
  await card.locator('.calc__trail__item').nth(1).click();
  await page.waitForTimeout(160);
  await press('换屏');
  await card.locator('.calc__trail__item').nth(0).click();
  await page.waitForTimeout(160);
  await press('游戏机');
  ok(/哪一项/.test(await label()), '游戏机做不了换屏 → 清空原项目并重新问「项目」');
  const conOpts = await opts();
  ok(conOpts.length === 2 && conOpts.includes('清灰保养') && !conOpts.includes('换屏'),
    '游戏机只剩两个可修项目且不含换屏（' + conOpts.join('/') + '）');
  await press('清灰保养');
  const p4 = (await card.locator('.calc__price').innerText()).replace(/\s+/g, '');
  const [lo4, hi4] = money(by(CFG.services, 'clean'), by(CFG.devices, 'console'),
    by(CFG.materials, 'brand'), by(CFG.extras, 'rush'));
  ok(p4 === CUR + lo4 + '–' + hi4, '游戏机清灰价格 ' + CUR + lo4 + '–' + hi4 + '（页面：' + p4 + '）');

  /* ------------------------------------------- 5. 重新估价 + 键盘 */
  await card.locator('[data-calc-reset]').click();
  await page.waitForTimeout(160);
  ok(/这是.*设备/.test(await label()), '「重新估价」回到第一步');

  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    return a && a.className && a.className.indexOf('calc__') === 0 ? a.textContent.trim() : a.tagName;
  });
  ok(/手机|平板|笔记本|游戏机/.test(focused), 'Tab 能进到选项（当前焦点：' + focused + '）');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  ok(/这是.*设备/.test(await label()), '方向键只挪焦点，不会替人选中并跳步');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(160);
  ok(/哪一项/.test(await label()), 'Enter 选中并前进到下一步');

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs.join(' | ') : ''));

  await ctx.close();
  await browser.close();

  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})();
