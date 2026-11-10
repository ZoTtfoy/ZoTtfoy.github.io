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

  /* 一言走外网，偶尔会 ERR_CONNECTION_CLOSED —— 那会在控制台留下一条
     error，把"没有 JS 报错"这条断言误判成失败。固定成本地响应。 */
  await page.route('**/v1.hitokoto.cn/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ hitokoto: '把复杂的东西，做得简单一点。', from: '测试' })
  }));
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.locator('#repair').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const card = page.locator('#repairCalc');
  /* 出结果后没有 .calc__label —— 用空串代替，省得每次先判空 */
  const label = async () => (await card.locator('.calc__label').count())
    ? card.locator('.calc__label').innerText() : '';
  const opts = () => card.locator('.calc__opt').allInnerTexts();
  const trail = () => card.locator('.calc__trail__item').allInnerTexts();
  /* 点击后要等「确认窗口」走完再断言。
     ⚠️ 这里原来是 140ms —— 那时是"点下即跳"。
     现在选中后会有 240ms 的高亮确认（给误触留反悔时间，见 repair.js 的
     CONFIRM_MS），140ms 时还停在本步，断言会全部落空。
     400ms = 240 确认 + 160 渲染余量。 */
  const press = async (name) => {
    await card.locator('.calc__opt', { hasText: new RegExp('^' + name + '$') }).first().click();
    await page.waitForTimeout(400);
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
  ok(/哪一项/.test(await label()), '选中设备后自动跳到「项目」，不需要点下一步');
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
  /* 与点击同一条路径：键盘选中同样要过 240ms 的确认窗口 */
  await page.waitForTimeout(400);
  ok(/哪一项/.test(await label()), 'Enter 选中并前进到下一步');

  /* ============================================ 5. 选中确认（防误触）
     点下去到跳步之间有一段 CONFIRM_MS 的停顿，用来给误触留反悔余地。
     这条断言守两件事：那段窗口真的存在，且窗口里按钮已经高亮。 */
  await page.evaluate(() => window.SITE_REPAIR.resetAll());
  await page.waitForTimeout(220);
  await card.locator('.calc__opt', { hasText: /^手机$/ }).first().click();
  await page.waitForTimeout(90);
  ok(await page.evaluate(() => window.SITE_REPAIR.step()) === 0,
    '点击后 90ms 仍停在本步（还没跳走）');
  ok(await page.locator('.calc__opt.is-picked').count() > 0,
    '窗口期内被选中的按钮带 is-picked（视觉确认）');
  await page.waitForTimeout(340);
  ok(await page.evaluate(() => window.SITE_REPAIR.step()) === 1,
    '窗口结束后才前进');

  /* ================================================== 6. 上一步 / 重置 */
  ok(await card.locator('[data-calc-back]').first().evaluate(el => getComputedStyle(el).visibility) === 'visible',
    '第 2 步的「上一步」可见');
  await card.locator('[data-calc-back]').first().click();
  await page.waitForTimeout(260);
  ok(await page.evaluate(() => window.SITE_REPAIR.step()) === 0, '点「上一步」回到第 1 步');
  ok(await card.locator('[data-calc-back]').first().evaluate(el => getComputedStyle(el).visibility) === 'hidden',
    '第 1 步的「上一步」是隐藏占位（保持卡片等高）');

  /* ================================================== 7. 浏览器后退键 */
  await press('手机');
  await press('换电池');
  const beforePop = await page.evaluate(() => window.SITE_REPAIR.step());
  await page.goBack();
  await page.waitForTimeout(420);
  const afterPop = await page.evaluate(() => window.SITE_REPAIR.step());
  ok(beforePop === 2 && afterPop === 1,
    '浏览器后退回到上一步（' + beforePop + ' → ' + afterPop + '），没有跳出页面');
  await page.goForward();
  await page.waitForTimeout(420);
  ok(await page.evaluate(() => window.SITE_REPAIR.step()) === 2, '浏览器前进回到下一步');

  /* ================================================ 8. 防抖（连点保护） */
  await page.evaluate(() => window.SITE_REPAIR.resetAll());
  await page.waitForTimeout(220);
  const dbBefore = await page.evaluate(() => window.SITE_REPAIR.step());
  const one = card.locator('.calc__opt').first();
  await one.click({ force: true });
  await one.click({ force: true });
  await one.click({ force: true });
  await one.click({ force: true });
  await page.waitForTimeout(520);
  ok(await page.evaluate(() => window.SITE_REPAIR.step()) - dbBefore === 1,
    '连点 4 次只前进一步（防抖生效）');

  /* ==================================================== 9. 校验与兜底 */
  const conflictMsg = await page.evaluate(() => {
    const S = window.SITE_REPAIR.state;
    S.device = 'console'; S.service = 'screen';   // 游戏机不能换屏
    S.material = 'oem'; S.extra = 'none';
    return window.SITE_REPAIR.validate();
  });
  ok(conflictMsg.length > 0, '设备与项目冲突被校验拦下（' + conflictMsg.join('；') + '）');

  const emptyMsg = await page.evaluate(() => {
    const S = window.SITE_REPAIR.state;
    S.device = 'phone'; S.service = ''; S.material = ''; S.extra = '';
    return window.SITE_REPAIR.validate();
  });
  ok(emptyMsg.length >= 3, '缺项被逐条列出（' + emptyMsg.length + ' 条）');

  const warnView = await page.evaluate(() => {
    const S = window.SITE_REPAIR.state;
    S.device = 'console'; S.service = 'screen'; S.material = 'oem'; S.extra = 'none';
    window.SITE_REPAIR.go(4);
    return {
      hasWarn: !!document.querySelector('.calc__result--warn'),
      hasPrice: !!document.querySelector('.calc__price'),
      text: (document.querySelector('.calc__warn-list') || {}).textContent || ''
    };
  });
  ok(warnView.hasWarn && !warnView.hasPrice, '冲突时显示提示块而不是价格');
  ok(warnView.text.indexOf('做不了') >= 0, '提示说清了哪一项做不了');

  /* ================================================= 10. 结果页的人话 */
  await page.evaluate(() => {
    const S = window.SITE_REPAIR.state;
    S.device = 'phone'; S.service = 'screen'; S.material = 'oem'; S.extra = 'none';
    window.SITE_REPAIR.go(4);
  });
  await page.waitForTimeout(260);
  const tone = await page.locator('.calc__tone').innerText();
  ok(tone.length > 8, '结果页有一句解释性文案（' + tone + '）');
  /* 文案必须与所选配件对应，不能是随机夸奖 */
  const toneBrand = await page.evaluate(() => {
    window.SITE_REPAIR.state.material = 'value';
    window.SITE_REPAIR.go(4);
    return window.SITE_REPAIR.tone();
  });
  ok(tone !== toneBrand, '换材料后文案跟着变（不是写死的一句）');
  const again = page.locator('.calc__again');
  ok(await again.count() > 0, '结果页有「重新估价」主按钮');
  ok(await again.evaluate(el => getComputedStyle(el).backgroundColor) !== 'rgba(0, 0, 0, 0)',
    '「重新估价」是实心强调色，不是灰字');

  await again.click();
  await page.waitForTimeout(280);
  ok(await page.evaluate(() => window.SITE_REPAIR.step()) === 0, '「重新估价」回到第 1 步');
  ok(await page.evaluate(() => {
    const S = window.SITE_REPAIR.state;
    return Object.keys(S).every(k => S[k] === '');
  }), '「重新估价」清空全部选项');

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs.join(' | ') : ''));

  await ctx.close();
  await browser.close();

  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})();
