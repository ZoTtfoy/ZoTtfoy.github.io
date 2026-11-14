/* ==========================================================================
 *  编辑器「背景」面板验证：node tools/verify-backdrop-admin.js
 * --------------------------------------------------------------------------
 *  这个面板最容易出的问题是「点了没反应」——写操作落到不存在的字段上，
 *  不报错、界面也不变。所以这里逐项模拟真实操作并检查草稿是否真的更新：
 *    · 预设选择 / 上传 / 清除
 *    · 三个滑杆（不透明度 / 模糊 / 遮罩）与预览块是否联动
 *    · 旧草稿缺新字段时能否自动补全（升级兼容）
 * ========================================================================== */
/* 编辑器背景面板实测：预设选择、上传、滑杆、预览同步 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

/* ⚠️ 不再写死 D:/2026-11-09-12-47-30/…。
   项目一度放在 D 盘，脚本里留下了绝对路径，工作区搬到别处后
   这一行直接 ENOENT 把整个脚本弄崩 —— 而且崩在 require 阶段之前的读取，
   连一行检查项都跑不出来。改成"从当前工作目录往上找 管理凭据.txt"：
   项目在 zotrod-homepage/ 下，凭据在它上一级。 */
const ROOT = process.cwd();
const URL = 'http://127.0.0.1:8791/admin.html';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

function findCred() {
  const tries = [
    path.join(ROOT, '..', '管理凭据.txt'),
    path.join(ROOT, '管理凭据.txt')
  ];
  for (const f of tries) { if (fs.existsSync(f)) return f; }
  return null;
}

(async () => {
  const credFile = findCred();
  if (!credFile) {
    console.log('--  找不到 管理凭据.txt（在项目上一级），跳过编辑器登录相关断言');
    process.exit(0);
  }
  const cred = fs.readFileSync(credFile, 'utf8');
  const user = /账户[:：]\s*(\S+)/.exec(cred)[1];
  const pass = /口令[:：]\s*(\S+)/.exec(cred)[1];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.fill('#gateUser', user);
  await page.fill('#gatePass', pass);
  await page.click('.gate__btn');
  await page.waitForTimeout(500);

  /* 打开背景页 */
  await page.click('[data-tab="backdrop"]');
  await page.waitForTimeout(400);

  const panel = await page.evaluate(() => {
    const presets = document.querySelectorAll('[data-bd-url]');
    const thumbs = [...presets].map(p => {
      const t = p.querySelector('.bd-pick__thumb');
      return { label: p.getAttribute('title'), bg: getComputedStyle(t).backgroundImage };
    });
    return {
      presets: presets.length,
      thumbs,
      hasPreview: !!document.getElementById('bdPreview'),
      ranges: document.querySelectorAll('input[data-range]').length,
      rangeVals: [...document.querySelectorAll('input[data-range]')].map(r => ({
        path: r.dataset.path, val: r.value, out: (document.querySelector('[data-out-for="' + r.dataset.path + '"]') || {}).textContent
      })),
      toggles: document.querySelectorAll('#panel .switch input').length,
      hasUpload: !!document.querySelector('[data-bd-upload]'),
      hasClear: !!document.querySelector('[data-bd-clear]'),
      hasFile: !!document.querySelector('[data-bd-file]')
    };
  });

  ok(panel.presets === 5, '预设按钮 5 个（含「不用图」）');
  ok(panel.thumbs.filter(t => /url\(/.test(t.bg)).length === 4, '4 个内置预设都有缩略图');
  ok(panel.thumbs.some(t => t.label === '不用图'), '有「不用图」选项');
  ok(panel.hasPreview, '有实时预览块');
  ok(panel.ranges === 3, '3 个滑杆（不透明度 / 模糊 / 遮罩）');
  ok(panel.rangeVals.every(r => r.out === r.val || Number(r.out) === Number(r.val)),
     '滑杆初始数值与显示一致: ' + JSON.stringify(panel.rangeVals.map(r => r.out)));
  ok(panel.toggles >= 6, '有 6 个以上开关（4 个动效 + Ken Burns + 视差）');
  ok(panel.hasUpload && panel.hasClear && panel.hasFile, '上传 / 清除 / 文件选择器齐全');

  /* ---------------------------------------------- 随机图库（2026-11-14 新增）
     站点是"每次打开从图库随机抽一张"，后台必须能增删，否则只能手改 config。 */
  const lib = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.bd-lib')];
    return {
      groups: groups.length,
      heads: groups.map(g => g.querySelector('.bd-lib__head').textContent.replace(/\s+/g, ' ').trim()),
      thumbs: document.querySelectorAll('.bd-thumb').length,
      broken: [...document.querySelectorAll('.bd-thumb img')].filter(i => i.complete && i.naturalWidth === 0).length,
      addInputs: document.querySelectorAll('[data-bd-new]').length,
      addBtns: document.querySelectorAll('[data-bd-add]').length,
      removeBtns: document.querySelectorAll('[data-bd-rm]').length
    };
  });
  ok(lib.groups === 2, '图库分桌面 / 手机两组（' + lib.groups + '）');
  ok(lib.thumbs === lib.removeBtns && lib.thumbs >= 4,
    '每张缩略图都有移除按钮（' + lib.thumbs + ' 张）');
  ok(lib.broken === 0, '缩略图没有破图（坏 ' + lib.broken + ' 张）');
  ok(lib.addInputs === 2 && lib.addBtns === 2, '每组都有"加入图库"的输入框与按钮');

  /* 增删真的改到 draft：移除第一张 → 计数减一；再加回来 → 计数复原 */
  const libBefore = lib.thumbs;
  await page.evaluate(() => document.querySelector('[data-bd-rm="d"][data-bd-i="0"]').click());
  await page.waitForTimeout(250);
  const afterRm = await page.evaluate(() => document.querySelectorAll('.bd-thumb').length);
  ok(afterRm === libBefore - 1, '点 ✕ 后少一张（' + libBefore + ' → ' + afterRm + '）');
  await page.evaluate(() => {
    const inp = document.querySelector('[data-bd-new="d"]');
    inp.value = 'assets/backdrop/scene-d1.webp';
    document.querySelector('[data-bd-add="d"]').click();
  });
  await page.waitForTimeout(250);
  const afterAdd = await page.evaluate(() => ({
    n: document.querySelectorAll('.bd-thumb').length,
    head: document.querySelector('.bd-lib__head').textContent.replace(/\s+/g, ' ').trim(),
    dup: [...document.querySelectorAll('.bd-thumb img')].filter(i => /scene-d1/.test(i.src)).length
  }));
  ok(afterAdd.n === libBefore, '加回来后又成 ' + afterAdd.n + ' 张（' + afterAdd.head + '）');
  ok(afterAdd.dup === 1, '同一张不会被重复加入（scene-d1 出现 ' + afterAdd.dup + ' 次）');

  /* 选一个预设 */
  await page.click('[data-bd-url="assets/backdrop/dunes.svg"]');
  await page.waitForTimeout(400);
  const picked = await page.evaluate(() => ({
    active: document.querySelector('[data-bd-url="assets/backdrop/dunes.svg"]').classList.contains('is-active'),
    field: document.querySelector('[data-path="backdrop.image"]').value,
    previewBg: getComputedStyle(document.querySelector('[data-bd-img]')).backgroundImage,
    draft: (JSON.parse(localStorage.getItem('zotrod-draft-v1') || '{}').data || {}).backdrop?.image
  }));
  ok(picked.active, '点击预设后高亮');
  ok(/dunes\.svg/.test(picked.field), '图片地址框同步（' + picked.field + '）');
  ok(/dunes\.svg/.test(picked.previewBg), '预览块同步显示该图');
  ok(/dunes\.svg/.test(picked.draft || ''), '草稿已记录');

  /* 拖滑杆：数值与预览都要变 */
  const before = await page.evaluate(() =>
    document.querySelector('[data-bd-scrim]') ? getComputedStyle(document.querySelector('[data-bd-scrim]')).opacity : null);
  await page.evaluate(() => {
    const r = document.querySelector('input[data-path="backdrop.scrim"]');
    r.value = '0.3';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(450);
  const after = await page.evaluate(() => ({
    out: document.querySelector('[data-out-for="backdrop.scrim"]').textContent,
    previewScrim: getComputedStyle(document.querySelector('[data-bd-scrim]')).opacity,
    draft: (JSON.parse(localStorage.getItem('zotrod-draft-v1') || '{}').data || {}).backdrop?.scrim
  }));
  ok(after.out === '0.3', '滑杆数值实时显示（' + after.out + '）');
  ok(Math.abs(parseFloat(after.previewScrim) - 0.3) < 0.02,
     '预览遮罩跟着变（' + before + ' → ' + after.previewScrim + '）');
  ok(Math.abs(Number(after.draft) - 0.3) < 0.001, '草稿记录了新遮罩值');

  /* 模糊滑杆：上限 2026-11-14 从 40 收到 8（全屏那层超过 8px 照片就糊成色块，
     旧草稿里的 24 正是"背景图不显示"那次事故的元凶）。这里直接把 value 设成
     超过上限的值，浏览器会夹到 max，所以断言按 max=8 来。 */
  const blurMax = await page.evaluate(() => {
    const r = document.querySelector('input[data-path="backdrop.imageBlur"]');
    r.value = '12';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return { max: r.max, val: r.value };
  });
  ok(Number(blurMax.max) === 8, '模糊上限被收到 8（' + blurMax.max + '）');
  await page.waitForTimeout(400);
  /* 断言带容差：滑杆值走一遍 Number → style → getComputedStyle，
     浮点往返后会得到 11.9932px 这类值（偶发，不是 bug）。
     卡死 bl=12 会变成 flaky test —— 那种测试比没有更糟。 */
  const blur = await page.evaluate(() => getComputedStyle(document.querySelector('[data-bd-img]')).filter);
  const blurNum = parseFloat((/blur\(([\d.]+)px\)/.exec(blur) || [])[1]);
  ok(Math.abs(blurNum - Number(blurMax.val)) < 0.5,
     '模糊滑杆映射到预览 filter（' + blur + '，滑杆值 ' + blurMax.val + '）');

  /* 上传：用一张真实的 PNG */
  const tmp = path.join(ROOT, '.tmp-bd.png');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAJUlEQVR4nO3BAQ0AAADCoPdPbQ8HFAAA' +
    'AAAAAAAAAAAAAAAAAODbAAAB6gABlq3W6AAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(tmp, png);
  await page.setInputFiles('[data-bd-file]', tmp);
  await page.waitForTimeout(1200);
  const uploaded = await page.evaluate(() => ({
    draft: ((JSON.parse(localStorage.getItem('zotrod-draft-v1') || '{}').data || {}).backdrop || {}).image || '',
    field: document.querySelector('[data-path="backdrop.image"]').value,
    previewBg: getComputedStyle(document.querySelector('[data-bd-img]')).backgroundImage
  }));
  ok(/^data:image\//.test(uploaded.draft), '上传后转成 data URL（' + uploaded.draft.slice(0, 22) + '…）');
  ok(/^data:image\//.test(uploaded.field), '地址框同步为内嵌图');
  ok(/^url\("data:image\//.test(uploaded.previewBg) || /data:image/.test(uploaded.previewBg),
     '预览块显示上传的图');
  fs.unlinkSync(tmp);

  /* 清除 */
  await page.click('[data-bd-clear]');
  await page.waitForTimeout(350);
  const cleared = await page.evaluate(() => ({
    field: document.querySelector('[data-path="backdrop.image"]').value,
    active: [...document.querySelectorAll('[data-bd-url]')].filter(b => b.classList.contains('is-active')).length,
    previewBg: getComputedStyle(document.querySelector('[data-bd-img]')).backgroundImage
  }));
  ok(cleared.field === '', '清除后地址框为空');
  ok(cleared.active === 1, '清除后只有「不用图」高亮');
  ok(cleared.previewBg === 'none', '清除后预览无图');

  /* ------------------------------------------------ 草稿版本锁（2026-11-14）
     事故背景：编辑器里躺着一份 11-12 的旧草稿，用户点发布 → 整份 config.js
     被旧值覆盖（抖音/小红书消失、掘金回来、背景被 mesh.svg + 24px 模糊顶掉）。
     现在草稿带 base 指纹，对不上就丢弃。这里把两种情况都验一遍。 */
  await page.evaluate(() => {
    /* 老格式：直接存 draft，没有 base —— 正是把线上配置倒灌回去的那批数据 */
    localStorage.setItem("zotrod-draft-v1", JSON.stringify({ site: { role: "旧草稿里的角色" } }));
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(900);
  const stale = await page.evaluate(() => ({
    role: (document.querySelector('[data-path="site.role"]') || {}).value,
    live: window.SITE_CONFIG && window.SITE_CONFIG.site ? window.SITE_CONFIG.site.role : null,
    stillThere: !!localStorage.getItem("zotrod-draft-v1")
  }));
  ok(stale.role === stale.live,
    '旧格式草稿被丢弃，界面显示线上值（' + String(stale.role).slice(0, 10) + '）');
  ok(stale.stillThere === false, '过期草稿同时从 localStorage 清掉');

  /* 正常路径：改一个字段 → 草稿带上指纹 → 刷新后能恢复 */
  await page.fill('[data-path="site.role"]', "验证用的临时值");
  await page.waitForTimeout(400);
  const stamped = await page.evaluate(() => {
    const raw = localStorage.getItem("zotrod-draft-v1");
    if (!raw) return null;
    try { const o = JSON.parse(raw); return { hasBase: !!o.base, role: o.data && o.data.site && o.data.site.role }; }
    catch (e) { return "parse-error"; }
  });
  ok(stamped && stamped.hasBase, '新草稿带上了版本指纹（' + JSON.stringify(stamped) + '）');
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(900);
  const restored = await page.evaluate(() => (document.querySelector('[data-path="site.role"]') || {}).value);
  ok(restored === "验证用的临时值", '指纹一致时草稿能正常恢复（' + restored + '）');
  /* 收尾：把草稿清掉，免得影响别的断言 */
  await page.evaluate(() => localStorage.removeItem("zotrod-draft-v1"));

  if (errs.length) fails.push('控制台错误: ' + JSON.stringify(errs.slice(0, 3)));

  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
  await browser.close();
})();
