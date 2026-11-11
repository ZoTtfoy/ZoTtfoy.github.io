/* ==========================================================================
 *  站内播放器验证：node tools/verify-player.js
 * --------------------------------------------------------------------------
 *  这一版给 Q2 加了三样东西，每一样都有"看起来没问题、其实没生效"的坑，
 *  所以各配一组断言：
 *
 *   1. 封面
 *      —— data/netease.json 里 100 首全有 cover，页面上却可能一张都不显示。
 *         真因是 sync.js 用字段白名单归一化，漏写的字段会被静默丢掉。
 *         所以这里断言的是"数据文件里有 → 页面上有 → 图真的加载了"这条完整链路。
 *
 *   2. 站内播放
 *      —— 网易云对 VIP / 付费版权曲返回的是 HTML 提示页（状态还是 200），
 *         所以"能不能播"必须靠 sync 阶段探测、写进 playable 字段。
 *         断言：可播的必须是 <button data-play>，不可播的必须是外链 <a>，
 *         两者数量之和 = 显示曲目数（不许有"既不播也不跳"的哑按钮）。
 *
 *   3. 事件委托
 *      —— 列表是 innerHTML 重建的。如果播放器给每个按钮逐个绑事件，
 *         第二次渲染后就全部失效（这正是之前网易云列表"看得见点不动"的坑）。
 *         所以断言里有一条专门"重建列表之后再点"。
 *
 *  依赖：playwright-core + 本地 chromium
 * ========================================================================== */
const { chromium } = require('playwright-core');

const SITE = 'http://127.0.0.1:8791/';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);
const skip = (m) => notes.push('--  ' + m);

(async () => {
  const browser = await chromium.launch({
    // 允许无手势自动播放：无头环境里模拟点击的"用户手势"有时不被认，
    // 会变成 NotAllowedError，那样断言测的就不是我们的代码了。
    args: ['--autoplay-policy=no-user-gesture-required']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  // 一言走外网，会时不时 ERR_CONNECTION_CLOSED，那条 error 会污染"无 JS 报错"
  await page.route('**/v1.hitokoto.cn/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ hitokoto: '把复杂的东西，做得简单一点。', from: '测试' })
  }));

  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(2600);

  /* 翻到 Q2。页码不写死 —— listen 排第几屏由 config 的 sections.*.order 决定。 */
  const idx = await page.evaluate(() =>
    window.SITE_PAGED.pages().findIndex((e) => e && e.id === 'listen'));
  ok(idx > 0, 'listen 有独立页码（第 ' + (idx + 1) + ' 屏）');
  await page.evaluate((i) => window.SITE_PAGED.goTo(i), idx);
  await page.waitForTimeout(1600);

  /* ------------------------------------------------------- 1. 封面 */
  const data = await page.evaluate(() =>
    fetch('data/netease.json').then((r) => r.json()).catch(() => null));

  const covers = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#trackList .track')];
    const pics = [...document.querySelectorAll('.track__pic')];
    return {
      rows: rows.length,
      pics: pics.length,
      imgs: pics.filter((e) => e.tagName === 'IMG').length,
      loaded: pics.filter((e) => e.tagName === 'IMG' && e.complete && e.naturalWidth > 0).length,
      /* 尺寸必须是固定的：图片没加载时若不定宽高，行高会先塌再弹，
         整屏高度跟着变，paged.js 量到的落点就偏了。 */
      fixedSize: pics.every((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 20 && r.width < 60 && Math.abs(r.width - r.height) < 2;
      }),
      /* 每行都有封面 —— 允许占位块（.track__pic--none），但不许缺元素 */
      everyRow: rows.every((r) => !!r.querySelector('.track__pic'))
    };
  });

  ok(covers.rows > 0, '曲目渲染出来了（' + covers.rows + ' 首）');
  ok(covers.everyRow, '每一行都有封面位（图或占位块）');
  ok(covers.pics === covers.rows, '封面元素数 = 曲目数（' + covers.pics + '/' + covers.rows + '）');
  ok(covers.fixedSize, '封面是固定小方图（不随加载状态跳高度）');

  if (data && Array.isArray(data.tracks) && data.tracks.length) {
    const withCover = data.tracks.filter((t) => t.cover).length;
    ok(withCover > 0, '数据文件里有封面地址（' + withCover + '/' + data.tracks.length + ' 首）');
    /* 这条是"白名单漏字段"的守门人：
       数据里有封面，页面却没渲染成 <img>，说明中间某层把字段丢了。 */
    ok(covers.imgs === covers.pics,
      '数据里的封面没有被中间层丢掉（img ' + covers.imgs + ' / 位 ' + covers.pics + '）');
    ok(covers.loaded === Math.min(covers.imgs, covers.rows),
      '封面图真的加载成功（' + covers.loaded + '/' + covers.imgs + '）');
  } else {
    skip('data/netease.json 还没有曲目，跳过封面数据断言');
  }

  /* --------------------------------------------- 2. 可播 / 外链的划分 */
  const split = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#trackList .track')];
    return {
      total: rows.length,
      play: rows.filter((r) => r.querySelector('button[data-play]')).length,
      go: rows.filter((r) => r.querySelector('a.track__go')).length,
      /* 哑按钮：既没有播放能力也不是链接 —— 点了没反应，最该防的一种 */
      dead: rows.filter((r) => {
        const b = r.querySelector('.track__go');
        if (!b) return false;
        return !(b.tagName === 'BUTTON' && b.hasAttribute('data-play')) && b.tagName !== 'A';
      }).length,
      /* 播放按钮必须带 data-src，否则点下去不知道放什么 */
      withSrc: rows.filter((r) => {
        const b = r.querySelector('button[data-play]');
        return b && /^https:\/\//.test(b.getAttribute('data-src') || '');
      }).length
    };
  });

  ok(split.play + split.go === split.total,
    '每行要么能播要么能跳（' + split.play + ' 播 + ' + split.go + ' 跳 = ' + split.total + '）');
  ok(split.dead === 0, '没有点了没反应的哑按钮');
  ok(split.withSrc === split.play, '每个播放按钮都带合法音频地址');

  /* 数据侧对照：playable 为 true 的必须渲染成播放按钮 */
  if (data && Array.isArray(data.tracks)) {
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll('#trackList .track')].map((r) => {
        const b = r.querySelector('button[data-play]');
        return {
          playable: !!b,
          key: b ? b.getAttribute('data-play') : '',
          title: (r.querySelector('.track__title') || {}).textContent || ''
        };
      }));
    const expectPlay = data.tracks.slice(0, shown.length)
      .filter((t) => t.playable === true).length;
    ok(shown.filter((s) => s.playable).length === expectPlay,
      'playable=true 的曲目都渲染成了播放按钮（' + expectPlay + ' 首）');
    /* 不可播的必须带"为什么"的说明，而不是一个没有解释的图标 */
    ok(await page.evaluate(() => {
      const links = [...document.querySelectorAll('a.track__go')];
      return links.every((a) => (a.getAttribute('title') || '').indexOf('网易云') >= 0);
    }), '外链按钮都写清了去向（在网易云打开）');
  }

  /* ---------------------------------------------------- 3. 真实播放 */
  const playBtn = page.locator('button[data-play]').first();
  if (await playBtn.count() === 0) {
    skip('这批曲目里没有可站内播放的，跳过播放行为断言（真实数据里约 56% 可播）');
  } else {
    const before = await page.evaluate(() => window.SITE_PLAYER.state());
    ok(!before.playing, '初始状态没有在播');

    await playBtn.click();
    /* 音频要联网。给它最多 9s；拿到 playing 或时间在走就算成功。 */
    const started = await page.waitForFunction(() => {
      const s = window.SITE_PLAYER.state();
      return s.playing && s.duration > 0;
    }, null, { timeout: 9000 }).then(() => true).catch(() => false);

    const after = await page.evaluate(() => ({
      st: window.SITE_PLAYER.state(),
      playingRows: document.querySelectorAll('.track.is-playing').length,
      pressed: (document.querySelector('button[data-play]') || {}).getAttribute
        ? document.querySelector('button[data-play]').getAttribute('aria-pressed') : null,
      hasPauseIcon: !!document.querySelector('.track.is-playing .track__play rect'),
      /* 只数"播放器自己的"那个 audio。
         页面上还可能有 live.js 的音乐浮窗，它也是一个 <audio> —— 但那是另一回事，
         把它算进来会让"单例"这条断言永远失败，且指向错误的代码。 */
      /* ⚠️ 只匹配 media/outer。
         写成 audio[src*="media/outer"], audio[src*="music.163"] 是一个**并集**，
         而浮窗那个 audio 的 src 正是 music.163.com 的网页地址，会被一起数进来 ——
         断言于是恒为 2，看起来像"播放器创建了多个元素"，其实是选择器写错了。 */
      audioEls: document.querySelectorAll('audio[src*="media/outer"]').length,
      playerOwned: (function () {
        var a = window.SITE_PLAYER.audio();
        return !!a && document.body.contains(a);
      })()
    }));

    if (started) {
      ok(true, '点播放后真的开始播了（时长 ' + Math.round(after.st.duration) + 's）');
      ok(after.playingRows === 1, '只有一行进入播放态（' + after.playingRows + ' 行）');
      ok(after.pressed === 'true', '播放按钮 aria-pressed=true（读屏能听出状态）');
      ok(after.hasPauseIcon, '图标换成了暂停');
      ok(after.audioEls === 1 && after.playerOwned,
        '播放器只有一个 <audio>（单例，换歌是换 src 不新建元素）');

      /* 进度：等一会儿看 time 有没有往前走，以及 --p 有没有跟着变 */
      const t0 = await page.evaluate(() => window.SITE_PLAYER.state().time);
      await page.waitForTimeout(2200);
      const t1 = await page.evaluate(() => ({
        time: window.SITE_PLAYER.state().time,
        p: (document.querySelector('.track.is-playing') || { style: { getPropertyValue: () => '' } })
          .style.getPropertyValue('--p')
      }));
      ok(t1.time > t0, '播放进度在推进（' + t0.toFixed(1) + 's → ' + t1.time.toFixed(1) + 's）');
      ok(parseFloat(t1.p) > 0, '行内进度条跟着更新（--p=' + t1.p + '）');

      /* 再点一次 = 暂停 */
      await playBtn.click();
      await page.waitForTimeout(500);
      const paused = await page.evaluate(() => ({
        st: window.SITE_PLAYER.state(),
        playingRows: document.querySelectorAll('.track.is-playing').length,
        pressed: document.querySelector('button[data-play]').getAttribute('aria-pressed')
      }));
      ok(!paused.st.playing, '再点一次暂停了');
      ok(paused.playingRows === 0, '暂停后没有行停留在播放态');
      ok(paused.pressed === 'false', '按钮 aria-pressed 复位');
    } else {
      /* 网络拿不到音频：这不该算代码错，但必须说清楚，否则会被当成"播放器坏了" */
      skip('这次没连上音频 CDN，跳过真实播放断言（状态机断言见下）');
      ok(await page.evaluate(() => !!window.SITE_PLAYER), '播放器模块仍然可用');
    }
  }

  /* ----------------------------------- 4. 事件委托：列表重建后仍能点 */
  /* 这是最容易悄悄坏掉的一条：setTracks 会 innerHTML 重建列表，
     如果事件是逐个绑定在按钮上的，重建之后就全是死键。 */
  await page.evaluate(() => window.SITE_RENDER.setTracks(
    [
      { title: '重建测试 A', artist: 'X', album: '', playCount: 0, url: 'https://music.163.com/song?id=1', playable: false },
      { title: '重建测试 B', artist: 'Y', album: '', playCount: 0, url: 'https://music.163.com/song?id=2', playable: false }
    ], 'live', { totalSongs: 1 }
  ));
  await page.waitForTimeout(300);
  const rebuilt = await page.evaluate(() => ({
    rows: document.querySelectorAll('#trackList .track').length,
    /* 重建后每个按钮仍然是"可播按钮或外链"之一 */
    alive: [...document.querySelectorAll('#trackList .track')].every((r) => {
      const b = r.querySelector('.track__go');
      return b && (b.tagName === 'A' || b.hasAttribute('data-play'));
    })
  }));
  ok(rebuilt.rows === 2, '重建列表后曲目数正确（' + rebuilt.rows + '）');

  /* ------------------------------------------- 4b. 键盘可达
     播放按钮必须是"真的 <button>"，不是套了 role 的 <div> ——
     只有原生按钮才自动获得 Tab 聚焦 / Enter 与空格触发。
     这里换个可播曲目，验这三件事。 */
  await page.evaluate(() => window.SITE_RENDER.setTracks(
    [{
      title: '键盘测试', artist: 'K', album: '', playCount: 0,
      url: 'https://music.163.com/song?id=414980898', playable: true
    }], 'live', { totalSongs: 1 }
  ));
  await page.waitForTimeout(250);

  /* 焦点环必须走**真实的 Tab 路径**才测得出来。
     ⚠️ 用 element.focus() 之后读 outline 会是 none ——
     因为 :focus-visible 对"脚本聚焦"通常不匹配（浏览器假定用户没在用键盘）。
     这不是没有焦点环，是测法不对。所以这里一路按 Tab，直到焦点落进播放按钮。 */
  let landed = null;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    landed = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || !a.matches || !a.matches('button[data-play]')) return null;
      const cs = getComputedStyle(a);
      return {
        isButton: a.tagName === 'BUTTON',
        tabIndex: a.tabIndex,
        focusVisible: a.matches(':focus-visible'),
        outline: cs.outlineStyle + ' ' + cs.outlineWidth,
        outlineColor: cs.outlineColor
      };
    });
    if (landed) break;
  }

  ok(!!landed, '能一路 Tab 到播放按钮（键盘可用）');
  if (landed) {
    ok(landed.isButton && landed.tabIndex === 0,
      '播放控件是原生 <button>（tabIndex=' + landed.tabIndex + '）');
    ok(landed.focusVisible && landed.outline.indexOf('none') !== 0,
      '聚焦时有可见焦点环（' + landed.outline + ' ' + landed.outlineColor + '）');
  }
  /* Enter 触发（原生 button 的行为）：按下去应该进入播放或至少被状态机接收 */
  await page.evaluate(() => document.querySelector('button[data-play]').focus());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => window.SITE_PLAYER.state().key) ===
     'https://music.163.com/song?id=414980898',
     'Enter 键能触发播放（不用鼠标也行）');
  await page.evaluate(() => window.SITE_PLAYER.stop());
  ok(rebuilt.alive, '重建后每个按钮仍然是有效控件');

  /* 注入一首"探测说能播"的曲目，验证委托真的还能触发播放 */
  await page.evaluate(() => window.SITE_RENDER.setTracks(
    [{
      title: '委托测试', artist: 'Z', album: '', playCount: 0,
      url: 'https://music.163.com/song?id=414980898', playable: true
    }], 'live', { totalSongs: 1 }
  ));
  await page.waitForTimeout(250);
  const injected = await page.locator('button[data-play]').count();
  ok(injected === 1, '注入的可播曲目渲染出了播放按钮');
  if (injected) {
    await page.locator('button[data-play]').first().click();
    await page.waitForTimeout(1200);
    /* 只要状态机认了这次点击就算委托没问题；
       能不能出声取决于网络，上一条已经单独验过 */
    const st = await page.evaluate(() => window.SITE_PLAYER.state());
    ok(st.key === 'https://music.163.com/song?id=414980898',
      '重建出来的新按钮点了也有反应（委托没断）');
    await page.evaluate(() => window.SITE_PLAYER.stop());
  }

  /* ------------------------------------------------ 5. 背景：黑胶已下架
     2026-11-11 用户要求去掉黑胶，换成整屏专辑封面墙。
     详细的墙结构/方向/每周轮换/无缝断言在 verify-albumwall.js。
     这里只守一条"别把黑胶加回来"，顺带确认新墙确实挂上了。 */
  const bg = await page.evaluate(() => ({
    vinyl: document.querySelectorAll('.vinyl, .vinyl__art').length,
    wall: !!document.getElementById('albumWall'),
    rows: document.querySelectorAll('.albumwall__row').length
  }));
  ok(bg.vinyl === 0, '黑胶已移除（DOM 里没有 .vinyl）');
  ok(bg.wall && bg.rows === 6, '换成 6 行专辑封面墙（' + bg.rows + ' 行）');

  /* 减少动效：专辑墙不流动 */
  const rm = await ctx.newPage();
  await rm.emulateMedia({ reducedMotion: 'reduce' });
  await rm.goto(SITE, { waitUntil: 'load' });
  await rm.waitForTimeout(2200);
  const r0 = await rm.evaluate(() => window.SITE_ALBUMWALL.phase());
  await rm.waitForTimeout(1000);
  const r1 = await rm.evaluate(() => window.SITE_ALBUMWALL.phase());
  ok(Math.abs(r1 - r0) < 0.01, '减少动效时专辑墙静止（图还在，只是不流动）');
  await rm.close();

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  await browser.close();

  /* ------------------------------------------------------------- 输出 */
  notes.forEach((n) => console.log(n));
  if (fails.length) {
    console.log('\n失败明细:');
    fails.forEach((f) => console.log('· ' + f));
  }
  console.log('\n检查项: ' + (notes.filter((n) => n.startsWith('OK')).length + fails.length) +
    '，失败: ' + fails.length);
  if (!fails.length) console.log('\n全部通过');
  else { console.log('\n有问题'); process.exitCode = 1; }
})();
