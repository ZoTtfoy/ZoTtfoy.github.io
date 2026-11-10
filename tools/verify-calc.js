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
  /* 新公式：项目价 × 种类系数 × 材料系数（固定原装）+ 方式附加 + 加急附加 */
  const money = (svc, dev, met, rsh) => {
    const mat = (CFG.materials || []).find(m => m.id === (CFG.materialDefault || 'oem')) || { factor: 1 };
    const mid = svc.price * dev.factor * mat.factor + (met.add || 0) + (rsh.add || 0);
    return [Math.round(mid * CFG.range[0]), Math.round(mid * CFG.range[1])];
  };

  /* ---------------------------------------------------------- 1. 首问 */
  const devCount = (CFG.devices || []).length;
  ok((await opts()).length === devCount,
    '第一步只显示维修种类，' + devCount + ' 选一（当前 ' + (await opts()).join('/') + '）');
  ok(/要修的是什么/.test(await label()), '第一步问的是维修种类');
  /* 纯跳转式：没有进度条。这条断言是反向的 —— 有人把进度条加回来就会被拦下。 */
  ok((await trail()).length === 0, '顶部没有进度条（用户要的是纯跳转式）');

  const h0 = await height();
  const optH = await card.locator('.calc__opt').first().evaluate(el => Math.round(el.getBoundingClientRect().height));
  ok(optH >= 44, '选项触控高度 ' + optH + 'px ≥ 44');

  /* -------------------------------------------------- 2. 自动跳转 */
  /* 业务已改为「鼠标维修」（2026-11-11）：
       种类 鼠标/旗舰鼠标/键盘 → 项目 换微动/换编码器/微动+编码器/换脚贴/复杂问题
       → 方式 同城到店/快递寄修 → 加急 不着急/加急 */
  await press('鼠标');
  ok(/哪一项坏了/.test(await label()), '选中种类后自动跳到「项目」，不需要点下一步');
  ok(await card.locator('.calc__trail').count() === 0, '没有顶部进度条（纯跳转式）');
  const recap1 = await card.locator('.calc__recap__btn').innerText();
  ok(/鼠标/.test(recap1), '当前步上方有一行回执显示上一步的答案（' + recap1.replace(/\s+/g, ' ') + '）');
  /* ⚠️ 等高基线不再取第 1 步。
     第 1 步没有回执行（cursor=0 时不显示），第 2 步起才有，
     所以两者天然差一行。改成"从第 2 步起，各步之间必须等高" ——
     那才是真正要守的（避免每走一步卡片就长一截）。 */
  const h1 = await height();
  const base = h1;

  await press('换微动');
  ok(/怎么送过来/.test(await label()), '选完项目自动跳到「方式」');
  const h2 = await height();
  ok(h2 === base, '第 3 步与第 2 步等高（' + base + 'px）');

  await press('同城到店');
  ok(/着急要吗/.test(await label()), '选完方式自动跳到「加急」');
  ok(await page.locator('.calc__price').count() === 0, '四步没走完不报价');
  const h3 = await height();
  ok(h3 === base, '第 4 步与第 2 步等高（' + base + 'px）');

  await press('加急');
  const price = (await card.locator('.calc__price').innerText()).replace(/\s+/g, '');
  const [lo, hi] = money(by(CFG.services, 'switch'), by(CFG.devices, 'mouse'),
    by(CFG.methods, 'local'), by(CFG.rushes, 'rush'));
  ok(price === CUR + lo + '–' + hi, '价格 = ' + CUR + lo + '–' + hi + '（页面：' + price + '）');
  ok(await card.locator('.calc__opt').count() === 0, '出结果后不再显示选项');

  /* ---------------------------------------------- 3. 回头改答案 */
  /* 结果页没有进度条，改答案走「回去改一项」按钮（退一格回加急） */
  await card.locator('[data-calc-back]').first().click();
  await page.waitForTimeout(260);
  ok(/着急要吗/.test(await label()), '点「回去改一项」回到上一步「加急」');
  await press('不着急');
  const p2 = (await card.locator('.calc__price').innerText()).replace(/\s+/g, '');
  const [lo2, hi2] = money(by(CFG.services, 'switch'), by(CFG.devices, 'mouse'),
    by(CFG.methods, 'local'), by(CFG.rushes, 'normal'));
  ok(p2 === CUR + lo2 + '–' + hi2, '改完加急直接出新价 ' + CUR + lo2 + '–' + hi2 + '（页面：' + p2 + '）');
  ok((await card.locator('.calc__price').count()) === 1, '改完直接停在结果，没有把读者拖回后面的步骤');

  /* --------------------------------------- 4. 回执可点：退到上一步并重答 */
  /* 结果页本身不显示回执（那时四项都答完了，挂一行"上一步是加急"没意义）。
     要测回执，得先退回到某个中间步骤 —— 那里才有上一格可显示。
     退回「加急」→ 它上方应出现「方式 同城到店」的回执。 */
  await card.locator('[data-calc-back]').first().click();
  await page.waitForTimeout(260);
  ok(/着急要吗/.test(await label()), '先退回「加急」这一步');
  const recap2 = await card.locator('.calc__recap__btn').count();
  ok(recap2 === 1, '中间步骤显示一行回执');
  await card.locator('.calc__recap__btn').first().click();
  await page.waitForTimeout(260);
  ok(/怎么送过来/.test(await label()), '点回执行可以退回上一步「方式」');
  await press('快递寄修');
  const p3 = (await card.locator('.calc__price').innerText()).replace(/\s+/g, '');
  const [lo3, hi3] = money(by(CFG.services, 'switch'), by(CFG.devices, 'mouse'),
    by(CFG.methods, 'express'), by(CFG.rushes, 'normal'));
  ok(p3 === CUR + lo3 + '–' + hi3, '换成快递后价格含运费 ' + CUR + lo3 + '–' + hi3 + '（页面：' + p3 + '）');

  /* ------------------------------- 4b. 复杂问题不报价，改说「需要先看一眼」 */
  await page.evaluate(() => window.SITE_REPAIR.resetAll());
  await page.waitForTimeout(260);
  await press('鼠标');
  await press('复杂问题');
  await press('同城到店');
  await press('不着急');
  const ask = await page.evaluate(() => ({
    price: (document.querySelector('.calc__price') || {}).textContent || '',
    hasAskClass: !!document.querySelector('.calc__result--ask'),
    tone: (document.querySelector('.calc__tone') || {}).textContent || ''
  }));
  ok(ask.hasAskClass, '「复杂问题」走到结果页走的是 ask 分支');
  ok(/需要先看一眼/.test(ask.price), '不报数字，而是说「需要先看一眼」（' + ask.price + '）');
  ok(ask.tone.length > 10, '并给出一句引导（' + ask.tone.slice(0, 24) + '…）');

  /* ------------------------------------------- 5. 重新估价 + 键盘 */
  await card.locator('[data-calc-reset]').click();
  await page.waitForTimeout(160);
  ok(/要修的是什么/.test(await label()), '「重新估价」回到第一步');

  /* ⚠️ 先重载再按 Tab：浏览器的「顺序聚焦起点」会记住最后一次点击的位置。
     上面点了十几下卡片里的按钮，Tab 就从那里往下走，永远轮不到第一步的选项。
     blur() 清不掉这个起点，只有重新导航才行。 */
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.locator('#repair').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  /* 键盘可达性分三步验，不用"从页面顶部盲按 Tab"——
     那要穿过 Q1~Q3 的几十个链接（光网易云歌单就十几条），停在半路说明不了任何问题。 */
  const kb = await page.evaluate(() => {
    const opts = Array.prototype.slice.call(
      document.querySelectorAll('#repairCalc .calc__opt'));
    const allTabbable = opts.every(b => b.tabIndex === 0 && !b.disabled);
    opts[0].focus();
    return {
      count: opts.length,
      allTabbable,
      focused: document.activeElement === opts[0],
      first: (opts[0].textContent || '').trim()
    };
  });
  /* ① 选项本身可聚焦，且都不是 tabindex="-1"（那样只能靠脚本聚焦，键盘用户够不着） */
  ok(kb.focused && kb.allTabbable,
    '选项都是可聚焦的按钮且在 tab 序列里（' + kb.count + ' 个，当前焦点：' + kb.first + '）');

  /* ② Tab 能在选项之间顺序移动 —— 证明确实排在 tab 序里，不只是"能 .focus()" */
  await page.keyboard.press('Tab');
  const second = await page.evaluate(() => {
    const a = document.activeElement;
    const cls = typeof a.className === 'string' ? a.className : '';
    return cls.indexOf('calc__opt') >= 0 ? (a.textContent || '').trim() : a.tagName;
  });
  ok(second && second !== kb.first && !/^[A-Z]+$/.test(second),
    'Tab 从第一个选项走到第二个（' + second + '）');

  /* ③ 回到第一个选项，接着验方向键与 Enter */
  await page.evaluate(() => {
    document.querySelector('#repairCalc .calc__opt').focus();
  });
  const focused = kb.first;
  /* 机型名跟着 config 走：现在是 鼠标 / 旗舰鼠标 / 键盘。
     写死旧机型（手机、平板、游戏机）的话，配置一改这条就永远失败。 */
  const DEVICE_RE = /鼠标|键盘|手柄|耳机|平板|手机|游戏机/;
  ok(DEVICE_RE.test(focused), '焦点落在「要修的是什么」的选项上（' + focused + '）');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  ok(/要修的是什么/.test(await label()), '方向键只挪焦点，不会替人选中并跳步');
  await page.keyboard.press('Enter');
  /* 与点击同一条路径：键盘选中同样要过 240ms 的确认窗口 */
  await page.waitForTimeout(400);
  ok(/哪一项坏了/.test(await label()), 'Enter 选中并前进到下一步');

  /* ============================================ 5. 选中确认（防误触）
     点下去到跳步之间有一段 CONFIRM_MS 的停顿，用来给误触留反悔余地。
     这条断言守两件事：那段窗口真的存在，且窗口里按钮已经高亮。 */
  await page.evaluate(() => window.SITE_REPAIR.resetAll());
  await page.waitForTimeout(220);
  await card.locator('.calc__opt', { hasText: /^鼠标$/ }).first().click();
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
  await press('鼠标');
  await press('换编码器');
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
  /* 冲突用例：拿一个"配置里确实不支持"的组合。
     当前数据里 services 都没有限制 devices（鼠标/键盘都能换微动），
     所以这里用一个不存在的 service id 来构造"选了个做不了的项目"，
     验证校验层确实会拦 —— 将来给某个项目挂上 devices 限制时，
     这条断言会继续有效。 */
  const conflictMsg = await page.evaluate(() => {
    const S = window.SITE_REPAIR.state;
    S.device = 'keyboard';
    S.service = 'screen';            // 配置里没有 screen 这一项
    S.method = 'local'; S.rush = 'normal';
    return window.SITE_REPAIR.validate();
  });
  ok(conflictMsg.length > 0, '不认识的项目被校验拦下（' + conflictMsg.join('；') + '）');
  /* 文案要指认出那个失效的 id，而不是笼统一句"还没选项目" ——
     否则访客明明选了，界面却说他没选，无法自查。 */
  ok(conflictMsg.some(m => m.indexOf('不存在') >= 0 || m.indexOf('重新选') >= 0),
    '校验文案点明了"这一项已不存在"（' + conflictMsg[0] + '）');

  const emptyMsg = await page.evaluate(() => {
    const S = window.SITE_REPAIR.state;
    S.device = 'mouse'; S.service = ''; S.method = ''; S.rush = '';
    return window.SITE_REPAIR.validate();
  });
  ok(emptyMsg.length >= 3, '缺项被逐条列出（' + emptyMsg.length + ' 条）');

  /* ① 选了配置里已不存在的项目 —— 结果页必须是提示块，且不能同时露出半个价格。
     ⚠️ 这里曾经写的是 mouse + switch（一个**合法**组合）却断言"冲突"，
     于是永远渲染成价格页、断言必然落空。构造冲突就得真的构造冲突。 */
  const warnView = await page.evaluate(() => {
    const S = window.SITE_REPAIR.state;
    S.device = 'mouse'; S.service = 'screen'; S.method = 'local'; S.rush = 'normal';
    window.SITE_REPAIR.go(4);
    return {
      hasWarn: !!document.querySelector('.calc__result--warn'),
      hasPrice: !!document.querySelector('.calc__price'),
      text: (document.querySelector('.calc__warn-list') || {}).textContent || ''
    };
  });
  ok(warnView.hasWarn && !warnView.hasPrice, '冲突时显示提示块而不是价格');
  ok(warnView.text.indexOf('screen') >= 0,
    '提示点名了出问题的是哪一项（' + warnView.text.slice(0, 34) + '…）');

  /* ② 真正走 supports()：设备做不了这个项目。
     现在业务数据里没有任何 services 挂 devices（鼠标、键盘列同样的项目），
     所以这一支平时跑不到 —— 这里临时给「换微动」挂上"仅鼠标"再验，
     验完立刻还原。只动内存里的对象，不改 config.js，也不影响后面的断言。 */
  const incompat = await page.evaluate(() => {
    const cfg = window.SITE_CONFIG.repair.calculator;
    const svc = cfg.services.filter(s => s.id === 'switch')[0];
    const had = 'devices' in svc, backup = svc.devices;
    svc.devices = ['mouse', 'mouse_high'];

    const S = window.SITE_REPAIR.state;
    S.device = 'keyboard'; S.service = 'switch'; S.method = 'local'; S.rush = 'normal';
    window.SITE_REPAIR.go(4);
    const out = {
      hasPrice: !!document.querySelector('.calc__price'),
      text: (document.querySelector('.calc__warn-list') || {}).textContent || ''
    };

    if (had) svc.devices = backup; else delete svc.devices;
    return out;
  });
  ok(!incompat.hasPrice && incompat.text.indexOf('做不了') >= 0,
    '设备做不了这个项目时被拦下（' + incompat.text.slice(0, 40) + '）');

  /* 换设备时，原来那个做不了的项目要就地清空并重新问 —— 不能自动顶替，
     否则读者会以为自己选过。这条同时验证了 supports() 在交互层的接线。 */
  const switchClear = await page.evaluate(() => {
    const cfg = window.SITE_CONFIG.repair.calculator;
    const svc = cfg.services.filter(s => s.id === 'switch')[0];
    const had = 'devices' in svc, backup = svc.devices;
    svc.devices = ['mouse', 'mouse_high'];

    window.SITE_REPAIR.resetAll();     // 回到第 1 步并重画，让"种类"按钮回到 DOM 里
    const S = window.SITE_REPAIR.state;
    S.device = 'mouse'; S.service = 'switch';   // 先构造"选了鼠标 + 换微动"
    /* 走真实的点选路径（pick 挂的清空逻辑），不是直接写 state */
    const btn = document.querySelector('[data-opt="device"][data-value="keyboard"]');
    if (btn) btn.click();
    const out = { device: S.device, service: S.service, keyboardBtn: !!btn };

    if (had) svc.devices = backup; else delete svc.devices;
    return out;
  });
  ok(switchClear.keyboardBtn && switchClear.device === 'keyboard' && switchClear.service === '',
    '换到做不了的设备后，原项目被清空而不是自动顶替（device=' + switchClear.device
    + ', service="' + switchClear.service + '"）');

  /* ================================================= 10. 结果页的人话 */
  await page.evaluate(() => {
    const S = window.SITE_REPAIR.state;
    S.device = 'mouse'; S.service = 'switch'; S.method = 'local'; S.rush = 'normal';
    window.SITE_REPAIR.go(4);
  });
  await page.waitForTimeout(260);
  const tone = await page.locator('.calc__tone').innerText();
  ok(tone.length > 8, '结果页有一句解释性文案（' + tone + '）');
  /* 文案必须随选择变化，不能是写死的一句话。
     材料已不由读者选，所以改用「加急」来验证：它会往文案里追加一句运费/加急说明。 */
  const toneRush = await page.evaluate(() => {
    window.SITE_REPAIR.state.rush = 'rush';
    window.SITE_REPAIR.go(4);
    return window.SITE_REPAIR.tone();
  });
  ok(tone !== toneRush, '换加急后文案跟着变（不是写死的一句）');
  ok(toneRush.indexOf('加急') >= 0, '加急时文案点明了加急费已含在内');
  const again = page.locator('.calc__again');
  ok(await again.count() > 0, '结果页有「重新估价」主按钮');
  ok(await again.evaluate(el => getComputedStyle(el).backgroundColor) !== 'rgba(0, 0, 0, 0)',
    '「重新估价」是实心强调色，不是灰字');

  /* 用 DOM 里现存的按钮点，并把"清空"放在同一个 evaluate 里读完 ——
     分两次 evaluate 会有竞态：click 触发的 render 会重建 innerHTML，
     第二次读到的 state 可能还没被 reset 覆盖（实测偶发失败）。
     另外顺便断言界面真的回到了第一步的选项（而不只是内部变量为空）。 */
  await page.locator('[data-calc-reset]').first().click();
  await page.waitForTimeout(320);
  const afterReset = await page.evaluate(() => ({
    step: window.SITE_REPAIR.step(),
    state: JSON.parse(JSON.stringify(window.SITE_REPAIR.state)),
    label: (document.querySelector('.calc__label') || {}).textContent || '',
    opts: [...document.querySelectorAll('.calc__opt')].map(e => e.textContent.trim()),
    hasPrice: !!document.querySelector('.calc__price')
  }));
  ok(afterReset.step === 0, '「重新估价」回到第 1 步');
  ok(Object.keys(afterReset.state).every(k => afterReset.state[k] === ''),
    '「重新估价」清空全部选项（' + JSON.stringify(afterReset.state) + '）');
  ok(/要修的是什么/.test(afterReset.label), '界面回到第一步的问题');
  ok(!afterReset.hasPrice, '结果页的价格已消失');

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs.join(' | ') : ''));

  await ctx.close();
  await browser.close();

  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})();
