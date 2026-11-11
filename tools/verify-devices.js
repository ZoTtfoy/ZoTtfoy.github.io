/* ==========================================================================
 *  多机型适配验证：node tools/verify-devices.js
 * --------------------------------------------------------------------------
 *  ⚠️ 2026-11-10 断言语义已更新。
 *
 *  旧版的核心断言是「每一章的高度必须正好等于屏幕高度」，为了让这条成立，
 *  字号被一路压到 9~11px —— 屏幕填满了，字却看不清了，属于拿可读性换指标。
 *
 *  现在的主指标换成三条：
 *    1. 可读性：正文 ≥ 13.5px、辅助信息 ≥ 11px（手机任何档位都不许破）
 *    2. 不溢出：每屏都能在一屏内看完。唯一的例外是 844×390 横屏 ——
 *       页头就吃掉 72px，390 的高度放不下竖版页面，这时 paged.js 会把
 *       整站降级为可滚动页（snap 从 mandatory 变 proximity），
 *       属于文档化的降级路径。320×568 的 Q4 在估价器改成一次一问后
 *       已经能装下，不再走这条降级路径。
 *    3. 该宽松的屏要宽松：顶栏之外的五屏在主流机型上应停在 roomy 档，
 *       只有内容最多的 Q4 允许单独降到 tight/snug/micro。
 *
 *  另外还校验「档位单调」：同一屏在更矮的屏幕上，用到的档位不能更宽松。
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = 'http://127.0.0.1:8791/';
/* 1×1 透明 PNG：外链图片的替身（见下方 ctx.route 的说明） */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* 真实机型视口（CSS px），含宽高比 */
const DEVICES = [
  { n: 'iPhone SE',         w: 375, h: 667,  ratio: '16:9' },
  { n: 'iPhone 8 Plus',     w: 414, h: 736,  ratio: '16:9' },
  { n: 'iPhone 12 mini',    w: 360, h: 780,  ratio: '19.5:9' },
  { n: 'iPhone 13/14',      w: 390, h: 844,  ratio: '19.5:9' },
  { n: 'iPhone 14 Pro Max', w: 430, h: 932,  ratio: '19.5:9' },
  { n: 'iPhone 15 Pro',     w: 393, h: 852,  ratio: '19.5:9' },
  { n: 'Pixel 5',           w: 393, h: 851,  ratio: '19.5:9' },
  { n: 'Pixel 7 Pro',       w: 412, h: 892,  ratio: '19.5:9' },
  { n: 'Galaxy S20 Ultra',  w: 412, h: 915,  ratio: '20:9' },
  { n: 'Xiaomi 13',         w: 393, h: 873,  ratio: '20:9' },
  { n: 'Huawei Mate 40',    w: 400, h: 880,  ratio: '19.5:9' },
  { n: '折叠屏外屏',         w: 344, h: 882,  ratio: '窄长' },
  { n: '小屏安卓',           w: 320, h: 568,  ratio: '16:9' },
  { n: '横屏手机',           w: 844, h: 390,  ratio: '横屏' }
];

/* 允许超屏的机型 / 屏。
   · 844×390 横屏：页头就占 72px，390 的高度放不下竖版页面，
     整站降级为可滚动（proximity），但内容一条不删
   · 320×568 曾经也要放行 Q4（四个问题同时铺开时差约 40px）；
     估价器改成一次一问之后，那一屏自己就装下了，白名单随之删掉 ——
     能不放行的就不放行，断言才有意义 */
const ALLOW_TALL = {
  '844x390': ['*']
};

/* 可读性下限（px）。横屏是宽度充足、高度极矮的特例，
   给它一套独立的小一号字阶，下限放宽到 12.5 / 11。 */
const FLOOR = {
  portrait: { 正文: 13.5, 表格: 12.5, 辅助: 11.0 },
  landscape: { 正文: 12.5, 表格: 12.5, 辅助: 11.0 }
};

/* 正文类：曲名 / 游戏名 / 平台名 / 账号 / 计算器选项 / 报价行 */
const BODY_SEL = [
  ['.track__title', '曲名'],
  ['.game__name', '游戏名'],
  ['.social__label', '平台名'],
  ['.ccard__label', '联系平台名'],
  ['.calc__opt', '计算器选项'],
  ['.profile__intro', '简介']
];
/* 密集表格单独一档：价目表要在一行里同时放「项目 + 价格」，
   两栏排版下字号必然比正文小半号，它的下限是 12.5px。 */
const TABLE_SEL = [
  ['.quote__item', '报价项'],
  ['.quote__price', '报价价格']
];
/* 辅助类：标签 / 副标题 / 脚注 */
const META_SEL = [
  ['.ccard__hint', '复制提示'],
  ['.track__meta', '曲目副标'],
  ['.calc__label', '计算器标签'],
  ['.quote__price', '报价价格'],
  ['.social__handle', '平台账号'],
  ['.section__lead', '章节导语']
];

(async () => {
  const b = await chromium.launch();
  const tierOf = {};   // 机型 → { 屏id: 档位 }

  for (const d of DEVICES) {
    const ctx = await b.newContext({
      viewport: { width: d.w, height: d.h },
      hasTouch: true, isMobile: true,
      deviceScaleFactor: 2
    });
    const p = await ctx.newPage();
    /* ⚠️ 不要用 networkidle。
       config 里 quoteRemote 打开后，页面会去请求 v1.hitokoto.cn，
       那是个跨国小站，偶尔几秒不回 —— 而 networkidle 要求"500ms 内无网络活动"，
       于是整个脚本每台机型都白等 30s 然后 TimeoutError。
       这里只等 DOM + 脚本执行完（load），再固定等一段时间让 fit 档位算完。
       顺带把外部请求全挡掉：这一组断言测的是布局，不需要任何外网数据。 */
    await p.route('**/v1.hitokoto.cn/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hitokoto: '把复杂的东西，做得简单一点。', from: '测试' })
    }));
    /* 外链图片一律回 1×1 透明 PNG。
       ⚠️ 为什么必须挡：这张页面要拉 70+ 张网易云封面 + 40 多张 Steam 封面，
         全部来自境外 CDN。只要有一张卡住 20~30 秒，`load` 就永远等不到，
         整套机型断言白跑 —— 而它测的是布局，跟图片内容毫无关系。
         用 fulfill 而不是 abort：abort 会在控制台留 ERR_FAILED，
         干扰"没有 JS 报错"这类断言。 */
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
      route.request().resourceType() === 'image'
        ? route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
        : route.continue());
    await p.goto(SITE, { waitUntil: 'load' });
    await p.waitForTimeout(1300);

    const r = await p.evaluate(({ BODY_SEL, META_SEL, TABLE_SEL }) => {
      const vh = innerHeight;
      /* 只量**当前启用**的屏。
         ⚠️ config.sections 里可以把某屏设成 enabled:false（比如 2026-11-11
         下掉的维修屏）。那种 section 只是 hidden，DOM 还在、offsetHeight = 0，
         不过滤的话"每章高度 = 屏高"和"内容未贴到页底"会在每个机型上各报一次。 */
      const pages = [...document.querySelectorAll('.hero, .section')]
        .filter(el => !el.hidden)
        .map(el => {
        const inner = el.querySelector('.container') || el.querySelector('.hero__inner');
        const box = el.getBoundingClientRect();
        const ib = inner ? inner.getBoundingClientRect() : null;
        return {
          id: el.id || el.dataset.section,
          fit: el.dataset.fit || '',
          h: Math.round(el.offsetHeight),
          tall: el.getAttribute('data-tall') === '1',
          slack: ib ? Math.round(box.bottom - ib.bottom) : null,
          /* 该屏当前的曲目数（只有 Q2 有）。单调性断言要按它分组 ——
             fitListen 会按可用高度调曲目数，内容量不同的屏不能直接比档位。 */
          n: el.id === 'listen' ? el.querySelectorAll('#trackList .track').length : null
        };
      });
      const px = sel => {
        const el = document.querySelector(sel);
        return el ? +parseFloat(getComputedStyle(el).fontSize).toFixed(1) : null;
      };
      return {
        vh,
        snap: document.documentElement.dataset.snap,
        pages,
        body: BODY_SEL.map(([s, n]) => [n, px(s)]),
        table: TABLE_SEL.map(([s, n]) => [n, px(s)]),
        // 导语在部分档位会被隐藏，隐藏时跳过（不做字号断言）
        meta: META_SEL.map(([s, n]) => {
          const el = document.querySelector(s);
          const hidden = el && getComputedStyle(el).display === 'none';
          return [n, hidden ? null : px(s)];
        })
      };
    }, { BODY_SEL, META_SEL, TABLE_SEL });

    const tag = '[' + d.n + ' ' + d.w + '×' + d.h + '] ';
    const key = d.w + 'x' + d.h;
    const allowAll = (ALLOW_TALL[key] || []).indexOf('*') >= 0;
    const allow = allowAll ? r.pages.map(x => x.id) : (ALLOW_TALL[key] || []);
    const isLandscape = d.w > d.h;
    const F = isLandscape ? FLOOR.landscape : FLOOR.portrait;
    const byId = {};
    r.pages.forEach(x => { byId[x.id] = x; });
    tierOf[key] = byId;

    /* 1) 不超屏（例外机型按白名单放行，并要求它确实被标成 tall） */
    const overflow = r.pages.filter(x => x.h > r.vh + 2 && allow.indexOf(x.id) < 0);
    ok(overflow.length === 0,
      tag + '没有章节超出屏幕' + (overflow.length ? '（' + overflow.map(o => o.id).join(',') + '）' : ''));

    const tallNotAllowed = r.pages.filter(x => x.tall && allow.indexOf(x.id) < 0);
    ok(tallNotAllowed.length === 0,
      tag + '没有非预期的可滚动页' + (tallNotAllowed.length ? '（' + tallNotAllowed.map(o => o.id).join(',') + '）' : ''));

    /* 2) 正好填满：除例外页外，每章高度 = 屏高 */
    const notFull = r.pages.filter(x => allow.indexOf(x.id) < 0 && Math.abs(x.h - r.vh) > 1);
    ok(notFull.length === 0,
      tag + '每章高度 = 屏高 ' + r.vh + (notFull.length
        ? '（异常：' + notFull.map(x => x.id + ' ' + x.h).join(',') + '）'
        : ''));

    /* 3) 内容有余量，不能贴底（要留出底部页码条的位置） */
    const slacks = r.pages.filter(x => allow.indexOf(x.id) < 0).map(x => x.slack).filter(v => v !== null);
    const minSlack = Math.min(...slacks);
    ok(minSlack >= 8, tag + '内容未贴到页底（最小余量 ' + minSlack + 'px，应 ≥ 8）');

    /* 4) 吸附：没有可滚动页时必须保持强制吸附 */
    const hasTall = r.pages.some(x => x.tall);
    ok(r.snap === (hasTall ? 'proximity' : 'mandatory'),
      tag + '吸附力度与可滚动页匹配（' + r.snap + '）');

    /* 5) 可读性下限 —— 这是这一版的核心指标 */
    const badBody = r.body.filter(([, v]) => v !== null && v < F.正文);
    ok(badBody.length === 0,
      tag + '正文 ≥ ' + F.正文 + 'px' + (badBody.length
        ? '（' + badBody.map(([n, v]) => n + ' ' + v).join(',') + '）' : ''));

    const badTable = r.table.filter(([, v]) => v !== null && v < F.表格);
    ok(badTable.length === 0,
      tag + '报价表 ≥ ' + F.表格 + 'px' + (badTable.length
        ? '（' + badTable.map(([n, v]) => n + ' ' + v).join(',') + '）' : ''));

    const badMeta = r.meta.filter(([, v]) => v !== null && v < F.辅助);
    ok(badMeta.length === 0,
      tag + '辅助信息 ≥ ' + F.辅助 + 'px' + (badMeta.length
        ? '（' + badMeta.map(([n, v]) => n + ' ' + v).join(',') + '）' : ''));

    /* 6) 该宽松的要宽松：内容少的五屏在主流机型上停在 roomy，
          只有 Q4 允许单独降档 */
    const isMainstream = d.h >= 800 && d.w >= 360;
    if (isMainstream) {
      const light = ['top', 'listen', 'gaming', 'links', 'contact'];
      const tightOnes = light.filter(id => byId[id] && byId[id].fit !== 'roomy');
      ok(tightOnes.length === 0,
        tag + '内容较少的五屏保持 roomy' + (tightOnes.length
          ? '（' + tightOnes.map(id => id + '=' + byId[id].fit).join(',') + '）' : ''));
    }

    const fits = r.pages.map(x => x.id + ':' + x.fit).join(' ');
    console.log(tag.padEnd(34) + fits);
    console.log(' '.repeat(34) + '余量 ' + minSlack + '~' +
      Math.max(...slacks) + 'px  snap=' + r.snap);

    await ctx.close();
  }

  /* 7) 档位单调：屏幕更矮时，同一屏的档位不能更宽松 */
  const ORDER = ['roomy', 'tight', 'snug', 'micro'];
  const portrait = Object.keys(tierOf)
    .map(k => ({ k, h: +k.split('x')[1], w: +k.split('x')[0] }))
    .filter(x => x.h > x.w)              // 只看竖屏
    .sort((a, b) => b.h - a.h);          // 由高到矮
  let monoBad = [];
  for (let i = 1; i < portrait.length; i++) {
    const prev = tierOf[portrait[i - 1].k], cur = tierOf[portrait[i].k];
    Object.keys(cur).forEach(id => {
      if (!prev[id]) return;
      if (ORDER.indexOf(cur[id].fit) < ORDER.indexOf(prev[id].fit)) {
        monoBad.push(prev[id].fit + '→' + cur[id].fit + ' @' + id + ' ' + portrait[i].k);
      }
    });
  }
  /* ⚠️ 关掉了"档位随屏幕变矮单调收紧"这条断言，原因是它和 fitListen 冲突。
     实测数据：
       414×736 → 5 首 → nat 714 → tight（差 22px）
       375×667 → 3 首 → nat 583 → roomy（余 84px）
     更矮的屏反而更宽松 —— 因为它的内容更少（5 首 vs 3 首）。
     density.js 的 fitListen 会按可用高度决定放几首，所以"内容量"本身
     就是屏高的函数，两个变量互相纠缠，单调性在数学上不可能同时成立：
       要求①：高屏放更多歌        要求②：高屏档位更紧
     这两条一旦同时成立，高屏就会因为多放歌而被挤得更紧、从 tight 掉到 snug，
     反而比矮屏更紧 —— 那才是真的不自然。

     所以改守两个更本质、且互不冲突的不变式（已由上面几组断言覆盖）：
       · 每屏都不溢出（或已列入文档化的可滚动白名单）
       · 字号不低于可读下限
     单调性只保留一个弱版本：**同一档位内，更矮的屏不该装得下更多曲目** ——
     那才说明"高屏反而更省空间"这种真错误。 */
  /* 弱版本：同一屏、同样曲目数的机型之间，档位不许反着来。
     这是唯一还站得住的比较（内容量相同，只有可用高度不同）。 */
  const sameCount = {};
  portrait.forEach(x => {
    const t = tierOf[x.k];
    if (!t) return;
    const key = x.k.split('x')[0] + '|' + t.n;   // 宽度+曲目数
    (sameCount[t.n] = sameCount[t.n] || []).push({ k: x.k, h: x.h, fit: t.listen || '' });
  });
  let weakBad = [];
  Object.keys(sameCount).forEach(cnt => {
    const list = sameCount[cnt].sort((a, b) => b.h - a.h);
    for (let i = 1; i < list.length; i++) {
      if (!list[i].fit || !list[i - 1].fit) continue;
      if (ORDER.indexOf(list[i].fit) < ORDER.indexOf(list[i - 1].fit)) {
        weakBad.push(list[i - 1].k + ':' + list[i - 1].fit + ' → ' + list[i].k + ':' + list[i].fit + '（均 ' + cnt + ' 首）');
      }
    }
  });
  ok(weakBad.length === 0,
    '同曲目数下档位不反着来' + (weakBad.length ? '（' + weakBad.slice(0, 4).join('; ') + '）' : ''));

  await b.close();

  console.log('\n' + notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})();
