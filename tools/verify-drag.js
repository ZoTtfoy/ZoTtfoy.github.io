/* ==========================================================================
 *  拖拽光效验证：node tools/verify-drag.js
 * --------------------------------------------------------------------------
 *  这个功能有个非常容易踩的坑，必须用真实手势测：
 *
 *    在可滚动页面上，浏览器一旦判定为滚动手势就发 pointercancel，
 *    之后 pointermove 完全停止。实测一次 12 步竖直拖动：
 *        pointermove 触发 1 次、pointercancel 1 次、touchmove 9 次
 *    所以触屏必须监听 touch 事件，桌面才用 pointer 事件。
 *    用 PointerEvent 手工派发是测不出这个问题的 —— 必须走 CDP 真实触摸。
 *
 *  覆盖：
 *    · 桌面：按下出现 / 跟随 / 拖尾 / 抬手收起 / 轻点不留痕 / 追光暂隐
 *    · 触屏：真实触摸下跟随 / 拖尾 / 与滚动共存 / 抬手收起
 *    · 性能：拖拽期间不破坏帧率
 *    · 降级：减少动效、关闭光效
 * ========================================================================== */
const { chromium } = require('playwright-core');

/* 屏蔽外部图片（CDN 封面）→ 统一回 1x1 透明 PNG。
   本站一屏要拉上百张封面，`networkidle` 永远等不到，goto 会 30s 超时；
   这些脚本不看封面图（由 verify-steam / verify-albumwall 专门验）。
   用 fulfill 而不是 abort：abort 会在控制台留 ERR_FAILED，带红断言。 */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
async function blockExternalImages(ctx) {
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
      : route.continue());
}

const SITE = 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* ---------- 桌面 ---------- */
async function testMouse(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await blockExternalImages(p.context());
await p.goto(SITE, { waitUntil: 'load' });
  await p.waitForTimeout(1400);

  const tag = '[桌面] ';

  const initial = await p.evaluate(() => {
    const g = document.getElementById('dragGlow');
    return {
      hasGlow: !!g,
      hasTrail: !!document.getElementById('dragTrail'),
      opacity: getComputedStyle(g).opacity,
      pool: document.querySelectorAll('.drag-trail__dot').length
    };
  });
  ok(initial.hasGlow, tag + '光团元素存在');
  ok(initial.hasTrail, tag + '拖尾容器存在');
  ok(parseFloat(initial.opacity) === 0, tag + '初始隐藏（opacity 0）');
  ok(initial.pool >= 14, tag + '拖尾点对象池已预建（' + initial.pool + ' 个）');

  /* 按下 */
  await p.mouse.move(500, 350);
  await p.mouse.down();
  /* ⚠️ 淡入是一条 CSS 过渡，别用固定 280ms 去截中间态。
     无头 chromium 没有 GPU 合成，实测 500ms 只跑到 9 帧（≈18fps），
     280ms 时 opacity 还在 0.77 —— 看起来像"淡入坏了"，其实是没等够。
     改成等条件成立，超时才算失败。 */
  const fadedIn = await p.waitForFunction(
    () => parseFloat(getComputedStyle(document.getElementById('dragGlow')).opacity) > 0.9,
    null, { timeout: 4000 }
  ).then(() => true).catch(() => false);

  const onDown = await p.evaluate(() => {
    const g = document.getElementById('dragGlow');
    return {
      dragging: g.classList.contains('is-dragging'),
      opacity: getComputedStyle(g).opacity,
      kind: g.getAttribute('data-kind'),
      w: Math.round(g.getBoundingClientRect().width),
      spotlightHeld: document.getElementById('spotlight').classList.contains('is-hold')
    };
  });
  ok(onDown.dragging, tag + '按下后进入拖拽态');
  ok(fadedIn, tag + '光团已淡入（opacity=' + onDown.opacity + '）');
  ok(onDown.kind === 'mouse', tag + '识别为鼠标拖拽');
  ok(onDown.w <= 200, tag + '鼠标光团较小（' + onDown.w + 'px，指尖精确不需大光）');
  ok(onDown.spotlightHeld, tag + '按住时收起常驻追光，避免两光重叠');

  /* 拖动 */
  for (let i = 1; i <= 6; i++) {
    await p.mouse.move(500 + i * 42, 350 + i * 20);
    await p.waitForTimeout(40);
  }
  const readGlow = () => p.evaluate(() => {
    const g = document.getElementById('dragGlow');
    const r = g.getBoundingClientRect();
    const dots = [...document.querySelectorAll('.drag-trail__dot')];
    return {
      cx: Math.round(r.x + r.width / 2),
      cy: Math.round(r.y + r.height / 2),
      live: dots.filter(d => d.getAnimations ? d.getAnimations().length > 0 : false).length,
      visible: dots.filter(d => parseFloat(getComputedStyle(d).opacity) > 0).length
    };
  });

  /* 拖尾是即时的，先读 —— 等光团收敛会拖到动画结束，点就"不活跃"了 */
  const onMove = await readGlow();
  ok(onMove.live > 0, tag + '拖动产生拖尾点（' + onMove.live + ' 个活跃）');
  ok(onMove.visible > 0, tag + '拖尾点可见');

  /* 光团跟随是插值（每帧向指针靠 14%），低帧率下要走十几帧才到位。
     同样改成等条件成立：中心收敛到目标 12px 以内算跟随成功。 */
  const followed = await p.waitForFunction(() => {
    const g = document.getElementById('dragGlow');
    const r = g.getBoundingClientRect();
    return Math.abs(r.x + r.width / 2 - 752) < 12 && Math.abs(r.y + r.height / 2 - 470) < 12;
  }, null, { timeout: 4000 }).then(() => true).catch(() => false);
  const settled = await readGlow();
  ok(followed, tag + '光团跟随指针（收敛到 ' + settled.cx + ',' + settled.cy + '，目标约 752,470）');

  /* 抬手 */
  await p.mouse.up();
  /* 淡出同理：过渡时长是固定的，帧率却是环境决定的。等它真的收干净。 */
  const fadedOut = await p.waitForFunction(
    () => parseFloat(getComputedStyle(document.getElementById('dragGlow')).opacity) < 0.1,
    null, { timeout: 4000 }
  ).then(() => true).catch(() => false);
  const onUp = await p.evaluate(() => {
    const g = document.getElementById('dragGlow');
    return {
      dragging: g.classList.contains('is-dragging'),
      opacity: parseFloat(getComputedStyle(g).opacity),
      held: document.getElementById('spotlight').classList.contains('is-hold')
    };
  });
  ok(!onUp.dragging, tag + '抬手退出拖拽态');
  ok(fadedOut, tag + '光团已淡出（opacity=' + onUp.opacity + '）');
  ok(!onUp.held, tag + '常驻追光已恢复');

  /* 轻点：不应留拖尾 */
  await p.evaluate(() => {
    document.querySelectorAll('.drag-trail__dot').forEach(d => {
      if (d.getAnimations) d.getAnimations().forEach(a => a.cancel());
    });
  });
  await p.mouse.move(800, 600);
  await p.mouse.down();
  await p.waitForTimeout(70);
  await p.mouse.up();
  await p.waitForTimeout(150);
  const tap = await p.evaluate(() =>
    [...document.querySelectorAll('.drag-trail__dot')]
      .filter(d => d.getAnimations ? d.getAnimations().length > 0 : false).length);
  ok(tap === 0, tag + '轻点不留拖尾（<8px 位移不撒点）');

  if (errs.length) fails.push(tag + '控制台错误: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
}

/* ---------- 触屏：CDP 真实触摸 ---------- */
async function testTouch(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await blockExternalImages(p.context());
await p.goto(SITE, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(p);
  const tag = '[触屏] ';

  ok(await p.evaluate(() =>
    getComputedStyle(document.getElementById('spotlight')).display === 'none'),
    tag + '不显示桌面追光（触屏没有指针）');

  /* 先确认 pointer 事件确实会被掐断 —— 这是必须用 touch 事件的原因 */
  await p.evaluate(() => {
    window.__ev = { pm: 0, pc: 0, tm: 0 };
    document.addEventListener('pointermove', () => window.__ev.pm++, { passive: true });
    document.addEventListener('pointercancel', () => window.__ev.pc++, { passive: true });
    document.addEventListener('touchmove', () => window.__ev.tm++, { passive: true });
  });

  /* 真实触摸拖动，逐帧采样 */
  const samples = [];
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: 195, y: 620, id: 1 }]
  });
  for (let i = 1; i <= 10; i++) {
    const fy = 620 - i * 28;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: 195, y: fy, id: 1 }]
    });
    await p.waitForTimeout(32);
    const s = await p.evaluate(() => {
      const g = document.getElementById('dragGlow');
      const r = g.getBoundingClientRect();
      const dots = [...document.querySelectorAll('.drag-trail__dot')];
      return {
        cx: Math.round(r.x + r.width / 2),
        cy: Math.round(r.y + r.height / 2),
        w: Math.round(r.width),
        dragging: g.classList.contains('is-dragging'),
        kind: g.getAttribute('data-kind'),
        live: dots.filter(d => d.getAnimations ? d.getAnimations().length > 0 : false).length,
        scrollY: Math.round(window.scrollY)
      };
    });
    samples.push({ fy, ...s });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);

  const ev = await p.evaluate(() => window.__ev);

  /* ⚠️ 这条断言在「触摸翻页」上线后反转了。
     原先它在验证一个坑：在可滚动页面上，浏览器一旦判定为滚动手势
     就会发 pointercancel，pointermove 随之停止（实测 12 步只触发 1 次），
     结论是「触屏必须用 touch 事件而不是 pointer 事件」。
     现在 paged.js 在竖向手势的第一次 touchmove 就 preventDefault 接管了，
     页面根本不会滚动，浏览器也就不会发 pointercancel —— pointermove 全程可用。
     所以改成断言「没有被掐断」，同时下面单独验证 touch 路径仍能拿到完整轨迹。 */
  ok(ev.pm >= 5, tag + 'pointermove 未被掐断（' + ev.pm + ' 次，触摸已由翻页层接管）');
  ok(ev.tm >= 6, tag + 'touchmove 持续触发（' + ev.tm + ' 次），可用来追踪轨迹');

  const held = samples.filter(s => s.dragging).length;
  ok(held >= 8, tag + '拖动全程保持拖拽态（' + held + '/' + samples.length + '）');
  ok(samples[0].kind === 'touch', tag + '识别为触屏拖拽');

  const drift = Math.max(...samples.map(s => Math.abs(s.cx - 195)));
  ok(drift <= 4, tag + '光团横向贴合手指（偏差 ' + drift + 'px）');

  const yOffsets = samples.map(s => s.cy - s.fy);
  const avgOffset = yOffsets.reduce((a, c) => a + c, 0) / yOffsets.length;
  ok(avgOffset < 0 && avgOffset > -50,
    tag + '光团中心在指尖上方（' + Math.round(avgOffset) + 'px），避免被手指遮挡');

  ok(samples[0].w >= 260, tag + '触屏光团更大（' + samples[0].w + 'px）');

  const maxDots = Math.max(...samples.map(s => s.live));
  ok(maxDots >= 4, tag + '拖动产生拖尾（最多 ' + maxDots + ' 个活跃点）');

  /* 同上：以前拖拽会带着页面滚（原生滚动 + 停手后归位），
     现在竖向手势被翻页层完全接管，页面**一动不动**。
     这正是「上滑不管距离都算一次翻页」想要的效果：
     手指在动、光效在跟、页面等抬手才翻。 */
  const scrolled = samples[samples.length - 1].scrollY;
  ok(scrolled === 0, tag + '拖拽期间页面不滚动（scrollY=' + scrolled + '，抬手才翻页）');

  const after = await p.evaluate(() => {
    const g = document.getElementById('dragGlow');
    return {
      dragging: g.classList.contains('is-dragging'),
      opacity: parseFloat(getComputedStyle(g).opacity)
    };
  });
  ok(!after.dragging && after.opacity < 0.1, tag + '抬手后光团收起');

  /* 多指：应直接结束拖拽（缩放手势） */
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 100, y: 500, id: 1 }, { x: 290, y: 500, id: 2 }]
  });
  await p.waitForTimeout(120);
  ok(await p.evaluate(() => !document.getElementById('dragGlow').classList.contains('is-dragging')),
    tag + '双指手势不触发拖拽光效');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(200);

  /* 拖拽期间的帧率 —— 改成**相对比较**，不再用绝对阈值。
   *
   *  为什么改（2026-11-11）：
   *    原来的断言是 p50 ≤ 18ms（约 55fps），隐含假设"这一屏除了光效没有别的
   *    大面积合成"。给「在听」页加了 6 行全屏专辑封面背景之后，无头浏览器
   *    （没有 GPU，纯软件合成）在这一屏的静止帧率就是 33.3ms。
   *
   *    实测证据：把封面墙的动画暂停，仍然是 33.3ms；只渲染 3 行才回到 16.7ms
   *    —— 说明开销来自"6 层全屏图片的静态合成"，与光效、与动画都无关，
   *    更不是本次代码退化。用绝对阈值量出来的其实是运行环境的显卡能力。
   *
   *  现在量的是这条断言**本来要证明的事**：光效本身有没有额外开销。
   *  同一页面、同一时刻，比较「光效显示」与「光效 display:none」两种状态的 p50。
   *  这样在有 GPU 的机器上量到 16.7ms、在无头软件合成下量到 33.3ms，都成立。 */
  const measure = () => p.evaluate(async () => {
    const t = [];
    let run = true;
    function tick(n) { t.push(n); if (run) requestAnimationFrame(tick); }
    requestAnimationFrame(n => { t.push(n); requestAnimationFrame(tick); });
    const t0 = performance.now();
    while (performance.now() - t0 < 900) {
      await new Promise(r => requestAnimationFrame(r));
    }
    run = false;
    const d = [];
    for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
    const c = d.slice(3);
    const s = [...c].sort((a, b) => a - b);
    return +s[Math.floor(s.length / 2)].toFixed(1);
  });

  const glow = await p.evaluate(() => !!document.getElementById('dragGlow'));
  ok(glow, tag + '存在拖拽光效层（#dragGlow）');

  const p50With = await measure();
  await p.evaluate(() => {
    const g = document.getElementById('dragGlow');
    if (g) g.style.display = 'none';
  });
  const p50Without = await measure();
  await p.evaluate(() => {
    const g = document.getElementById('dragGlow');
    if (g) g.style.display = '';
  });

  /* 允许 30% + 2ms 的抖动：软件合成下帧时间本来就在 16.7/33.3 之间跳。 */
  ok(p50With <= p50Without * 1.3 + 2,
    tag + '拖拽光效未拖慢渲染（带光效 ' + p50With + 'ms vs 无光效 ' +
    p50Without + 'ms）');

  if (errs.length) fails.push(tag + '控制台错误: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
}

/* ---------- 降级 ---------- */
async function testFallback(browser) {
  const tag = '[降级] ';

  { // 减少动效
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await blockExternalImages(p.context());
await p.goto(SITE, { waitUntil: 'load' });
    await p.waitForTimeout(1000);
    await p.mouse.move(500, 400);
    await p.mouse.down();
    await p.waitForTimeout(250);
    const r = await p.evaluate(() => ({
      effects: document.documentElement.dataset.effects,
      display: getComputedStyle(document.getElementById('dragGlow')).display,
      opacity: getComputedStyle(document.getElementById('dragGlow')).opacity
    }));
    ok(r.effects === 'off', tag + '减少动效时 data-effects=off');
    ok(r.display === 'none' || parseFloat(r.opacity) === 0, tag + '减少动效时不显示拖拽光团');
    await p.mouse.up();
    await ctx.close();
  }

  { // 关闭光效开关
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await blockExternalImages(p.context());
await p.goto(SITE, { waitUntil: 'load' });
    await p.evaluate(() => { window.SITE_CONFIG.ui.lightEffects = false; window.SITE_EFFECTS.init(); });
    await p.waitForTimeout(300);
    await p.mouse.move(500, 400);
    await p.mouse.down();
    await p.waitForTimeout(250);
    const r = await p.evaluate(() => ({
      effects: document.documentElement.dataset.effects,
      dragging: document.getElementById('dragGlow').classList.contains('is-dragging'),
      opacity: parseFloat(getComputedStyle(document.getElementById('dragGlow')).opacity)
    }));
    ok(r.effects === 'off', tag + 'lightEffects=false 时 data-effects=off');
    ok(r.opacity < 0.1, tag + '关闭光效后不出现拖拽光团');
    await p.mouse.up();
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    await testMouse(browser);
    await testTouch(browser);
    await testFallback(browser);
  } catch (e) {
    fails.push('运行中断: ' + e.message);
  }
  await browser.close();

  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})();
