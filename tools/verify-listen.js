/* ==========================================================================
 *  听歌排行验证：node tools/verify-listen.js [URL]
 * --------------------------------------------------------------------------
 *  这一屏从「最近在听」改成「听歌排行」之后，多了三样以前没有的东西，
 *  每一样都踩过坑，所以各配一组断言：
 *
 *   1. 播放次数（每首歌右侧的「128 次」）
 *      —— 最早的抓取脚本把 playCount 整段丢掉了，接口明明给了。
 *   2. 累计听歌（页脚「累计听歌 77,025 首」）
 *      —— 这个数走的是另一个接口，而且**不需要登录**。
 *         以前整套逻辑只有一个接口，cookie 一缺就什么都不显示。
 *   3. 一屏装得下
 *      —— 真实排行有 6 首，示例数据只有 3 首。
 *         320×568 上六行单列会撑到 787px，整站被迫降级成可滚动。
 *         所以曲目数按可用高度倒推（render.js 的 trackCap）。
 *
 *  前两条依赖 data/netease.json 里真的有数据。没有时会「跳过」而不是失败，
 *  因为仓库里的占位文件本来就是空的 —— 那种情况下断言数据就等于在测天气。
 *  想强制验渲染，可以先用样本数据覆盖：
 *      node tools/verify-listen.js --sample
 * ========================================================================== */
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const ARG = process.argv[2] || '';
const SITE = /^https?:/.test(ARG) ? ARG : 'http://127.0.0.1:8791/';
const notes = [], fails = [], skips = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);
const skip = (m) => skips.push(m);

const DATA = path.resolve(process.cwd(), 'data/netease.json');

/* --sample：临时塞一份六首的排行进 data/netease.json，跑完还原。
   不能直接把样本提交进仓库 —— 那是假数据，会被下一次同步覆盖，
   而且在没有 cookie 的世界里看起来像"抓到了"。

   两种样本，对应两种真实情况：
     --sample        配了 cookie：playCount 有真实次数
     --sample-score  匿名读公开排行：只有 score（百分制相对热度） */
const SAMPLE = {
  updated: new Date().toISOString(),
  uid: '1695307327',
  totalSongs: 77025,
  level: 10,
  source: 'rank',
  week: [
    { title: '反方向的钟', artist: '周杰伦', album: '范特西', playCount: 128, url: 'https://music.163.com/song?id=1' },
    { title: '我用什么把你留住', artist: '房东的猫', album: '春生', playCount: 96, url: 'https://music.163.com/song?id=2' },
    { title: 'vampire', artist: 'Olivia Rodrigo', album: 'GUTS', playCount: 74, url: 'https://music.163.com/song?id=3' },
    { title: '若能绽放光芒', artist: 'Goose house', album: '四月是你的谎言', playCount: 61, url: 'https://music.163.com/song?id=4' },
    { title: 'Time to Pretend', artist: 'MGMT', album: 'Oracular Spectacular', playCount: 43, url: 'https://music.163.com/song?id=5' },
    { title: '海底', artist: '一支榴莲', album: '海底', playCount: 12800, url: 'https://music.163.com/song?id=6' }
  ]
};
SAMPLE.tracks = SAMPLE.week;

/* 匿名排行形态：次数换成百分制 score（实测 top1=100，其次 75/50…） */
const SAMPLE_SCORE = JSON.parse(JSON.stringify(SAMPLE));
SAMPLE_SCORE.week.forEach((t, i) => {
  t.score = [100, 75, 50, 50, 25, 25][i];
  t.playCount = 0;
});
SAMPLE_SCORE.tracks = SAMPLE_SCORE.week;

let backup = null;
function useSample(which) {
  try { backup = fs.readFileSync(DATA, 'utf8'); } catch { backup = null; }
  const data = which === 'score' ? SAMPLE_SCORE : SAMPLE;
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return data.tracks.length;
}
function restore() {
  if (backup != null) fs.writeFileSync(DATA, backup, 'utf8');
}

(async () => {
  const MODE = ARG === '--sample' ? 'count'
             : ARG === '--sample-score' ? 'score'
             : '';
  let injected = 0;
  if (MODE) injected = useSample(MODE);

  const browser = await chromium.launch();
  try {
    /* ------------------------------------------------ 桌面：3 列 + 次数 */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

    /* 只等 load + 挡掉外网：一言接口（v1.hitokoto.cn）偶尔几秒不回，
       networkidle 会让整个脚本每台机型白发 30s 然后超时。
       这一组断言只看第二屏的渲染与布局，不需要任何外部数据。 */
    await page.route('**/v1.hitokoto.cn/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hitokoto: '把复杂的东西，做得简单一点。', from: '测试' })
    }));
    await page.goto(SITE, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.SITE_PAGED.goTo(1));
    await page.waitForTimeout(1500);

    const d = await page.evaluate(() => {
      const ul = document.getElementById('trackList');
      const rows = [...ul.querySelectorAll('.track')];
      return {
        n: rows.length,
        ranked: ul.getAttribute('data-ranked'),
        plays: rows.map(r => {
          const e = r.querySelector('.track__plays');
          return e ? e.textContent : null;
        }),
        foot: document.getElementById('listenFoot').innerText.replace(/\s+/g, ' ').trim(),
        cols: getComputedStyle(ul).gridTemplateColumns.split(' ').length,
        titles: rows.map(r => r.querySelector('.track__title').textContent)
      };
    });

    /* 数据形态有三种，各自要验的东西不一样：
         count  = 配了 cookie，playCount 是真实次数，应当印「128 次」
         score  = 匿名读公开排行，次数被脱敏成百分制，应当画热度条而**不**印次数
         liked  = 排行私密时的兜底（我喜欢的音乐），无次数也无热度
       把三种分开断言，是因为"次数"和"热度"绝不能互相冒充 ——
       在只有 score 的时候印「100 次」就是一个编出来的数字。 */
    const shape = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#trackList .track')];
      const src = document.querySelector('.listen__src');
      return {
        hasPlays: rows.some(r => r.querySelector('.track__plays')),
        hasHeat: rows.some(r => r.querySelector('.track__heat')),
        srcText: src ? src.textContent.trim() : '',
        srcClass: src ? src.className : '',
        heatTitles: rows.map(r => {
          const h = r.querySelector('.track__heat');
          return h ? h.getAttribute('title') : null;
        }).filter(Boolean)
      };
    });

    if (shape.hasPlays) {
      /* ---- 形态 count：真实播放次数 ---- */
      ok(d.plays.every(p => p && /\d/.test(p)), '每首歌都印出播放次数');
      ok(!shape.hasHeat, '有真实次数时不画热度条（两者互斥）');
      ok(d.ranked === '1', '带次数时 ul[data-ranked=1]（手机靠它切单列）');
      ok(/1,?2800|12,800/.test(d.foot) || d.plays.some(p => /12,800/.test(p)),
        '上万的次数加千分位');

      /* 次数右端对齐 —— 只比同列：桌面 3 列，三列右端本来就不同 */
      const alignInfo = await page.evaluate(() => {
        const groups = {};
        [...document.querySelectorAll('#trackList .track')].forEach(row => {
          const col = Math.round(row.getBoundingClientRect().left);
          const pl = row.querySelector('.track__plays');
          if (!pl) return;
          (groups[col] = groups[col] || []).push(Math.round(pl.getBoundingClientRect().right));
        });
        return Object.keys(groups).map(k => [...new Set(groups[k])]);
      });
      ok(alignInfo.length > 0 && alignInfo.every(a => a.length === 1),
        '每列里播放次数右端对齐到同一条线（' + alignInfo.map(a => a.join('/')).join(' | ') + '）');

      ok(/累计听歌/.test(d.foot), '页脚有「累计听歌」');
      ok(/累计听歌\s*[\d,]{3,}/.test(d.foot), '累计听歌是个六位数级别的数字');
    } else if (shape.hasHeat) {
      /* ---- 形态 score：只有相对热度 ---- */
      ok(!shape.hasPlays, '只有热度时不印次数（不编造绝对量）');
      ok(shape.heatTitles.length > 0 && shape.heatTitles.every(t => /相对热度\s*\d+%/.test(t)),
        '热度条带「相对热度 N%」的无障碍标签');
      /* 归一化：最高分那条应当是 100% */
      ok(shape.heatTitles.some(t => /100%/.test(t)), '最高分归一化为 100%');
      ok(d.ranked === '1', '有热度条时 ul[data-ranked=1]（手机靠它切单列）');
      ok(/累计听歌/.test(d.foot), '页脚有「累计听歌」');
    } else if (/已同步/.test(shape.srcText)) {
      /* ---- 形态 liked：真实曲目，但没有阅读次数的能力 ---- */
      ok(!shape.hasPlays && !shape.hasHeat, '收藏来源下既无次数也无热度条');
      ok(/收藏/.test(shape.srcText), '页脚标明来源是「收藏」，不冒充排行（' + shape.srcText + '）');
      ok(/累计听歌/.test(d.foot), '页脚有「累计听歌」');
    } else {
      skip('data/netease.json 里没有曲目数据，跳过渲染断言');
      skip('提示：--sample（真实次数）/ --sample-score（相对热度）可强制验证');
    }

    /* 不重叠：所有形态都要成立（热度条和次数占同一格，更容易撞） */
    const noOverlap = await page.evaluate(() => {
      const ov = (a, c) => a.x < c.r - 0.5 && c.x < a.r - 0.5 && a.y < c.b - 0.5 && c.y < a.b - 0.5;
      return [...document.querySelectorAll('#trackList .track')].every(row => {
        const ps = ['track__idx', 'track__title', 'track__meta', 'track__plays', 'track__heat', 'track__go']
          .map(c => row.querySelector('.' + c)).filter(Boolean)
          .map(e => { const b = e.getBoundingClientRect(); return { x: b.x, r: b.right, y: b.y, b: b.bottom }; });
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (ov(ps[i], ps[j])) return false;
        return true;
      });
    });
    ok(noOverlap, '序号 / 曲名 / 副标 / 数值 / 播放键互不重叠');

    ok(d.cols === 3, '桌面 3 列（实际 ' + d.cols + '）');
    ok(errs.length === 0, '桌面没有 JS 报错' + (errs.length ? '：' + errs[0] : ''));
    await ctx.close();

    /* ------------------------------------------ 各机型：一屏装得下 + 单列 */
    const DEVICES = [
      { n: 'iPhone 13/14', w: 390, h: 844 },
      { n: 'iPhone SE', w: 375, h: 667 },
      { n: '小屏安卓', w: 320, h: 568 },
      { n: 'iPhone 14 Pro Max', w: 430, h: 932 }
    ];
    for (const dev of DEVICES) {
      const c = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, isMobile: true, hasTouch: true });
      const p = await c.newPage();
      await p.route('**/v1.hitokoto.cn/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hitokoto: '把复杂的东西，做得简单一点。', from: '测试' })
      }));
      await p.goto(SITE, { waitUntil: 'load' });
      await p.waitForTimeout(1500);
      /* 必须先翻到第二屏：页脚的 getBoundingClientRect 是相对视口的，
         停在 Q1 时它当然在屏幕外 —— 这条断言会无条件失败。 */
      await p.evaluate(() => window.SITE_PAGED.goTo(1));
      await p.waitForTimeout(1500);
      const tag = '[' + dev.n + ' ' + dev.w + '×' + dev.h + '] ';
      const r = await p.evaluate(() => {
        const sec = document.getElementById('listen');
        const ul = document.getElementById('trackList');
        const rows = [...ul.querySelectorAll('.track')];
        const cut = rows.filter(x => {
          const t = x.querySelector('.track__title');
          return t && t.scrollWidth > t.clientWidth + 1;
        }).length;
        return {
          h: Math.round(sec.offsetHeight), vh: innerHeight,
          cols: getComputedStyle(ul).gridTemplateColumns.split(' ').length,
          n: rows.length, cut,
          tall: sec.getAttribute('data-tall') === '1',
          footVisible: document.getElementById('listenFoot').getBoundingClientRect().bottom <= innerHeight + 1
        };
      });
      ok(r.h <= r.vh + 2, tag + '第二屏不超屏（' + r.h + ' ≤ ' + r.vh + '）');
      ok(!r.tall, tag + '没有被降级成可滚动页');
      ok(r.cols === 1, tag + '手机上单列（实际 ' + r.cols + '）');
      ok(r.cut === 0, tag + '曲名没有被截断（' + r.cut + ' 首）');
      ok(r.footVisible, tag + '页脚（含累计听歌）在屏内可见');
      await c.close();
    }
  } finally {
    await browser.close();
    if (injected) restore();
  }

  notes.forEach(n => console.log(n));
  skips.forEach(s => console.log('--  ' + s));
  if (fails.length) { console.log('\n失败明细:'); fails.forEach(f => console.log('· ' + f)); }
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length
    + (skips.length ? '，跳过: ' + skips.length : ''));
  console.log(fails.length ? '\n有问题' : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})();
