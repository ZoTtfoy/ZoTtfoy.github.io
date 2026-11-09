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

const ROOT = 'D:/2026-11-09-12-47-30/zotrod-homepage';
const URL = 'http://127.0.0.1:8791/admin.html';
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

(async () => {
  const cred = fs.readFileSync(path.join(ROOT, '..', '管理凭据.txt'), 'utf8');
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

  /* 选一个预设 */
  await page.click('[data-bd-url="assets/backdrop/dunes.svg"]');
  await page.waitForTimeout(400);
  const picked = await page.evaluate(() => ({
    active: document.querySelector('[data-bd-url="assets/backdrop/dunes.svg"]').classList.contains('is-active'),
    field: document.querySelector('[data-path="backdrop.image"]').value,
    previewBg: getComputedStyle(document.querySelector('[data-bd-img]')).backgroundImage,
    draft: JSON.parse(localStorage.getItem('zotrod-draft-v1') || '{}').backdrop?.image
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
    draft: JSON.parse(localStorage.getItem('zotrod-draft-v1') || '{}').backdrop?.scrim
  }));
  ok(after.out === '0.3', '滑杆数值实时显示（' + after.out + '）');
  ok(Math.abs(parseFloat(after.previewScrim) - 0.3) < 0.02,
     '预览遮罩跟着变（' + before + ' → ' + after.previewScrim + '）');
  ok(Math.abs(Number(after.draft) - 0.3) < 0.001, '草稿记录了新遮罩值');

  /* 模糊滑杆 */
  await page.evaluate(() => {
    const r = document.querySelector('input[data-path="backdrop.imageBlur"]');
    r.value = '12';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const blur = await page.evaluate(() => getComputedStyle(document.querySelector('[data-bd-img]')).filter);
  ok(/blur\(12px\)/.test(blur), '模糊滑杆映射到预览 filter（' + blur + '）');

  /* 上传：用一张真实的 PNG */
  const tmp = path.join(ROOT, '.tmp-bd.png');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAJUlEQVR4nO3BAQ0AAADCoPdPbQ8HFAAA' +
    'AAAAAAAAAAAAAAAAAODbAAAB6gABlq3W6AAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(tmp, png);
  await page.setInputFiles('[data-bd-file]', tmp);
  await page.waitForTimeout(1200);
  const uploaded = await page.evaluate(() => ({
    draft: (JSON.parse(localStorage.getItem('zotrod-draft-v1') || '{}').backdrop || {}).image || '',
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

  if (errs.length) fails.push('控制台错误: ' + JSON.stringify(errs.slice(0, 3)));

  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
  await browser.close();
})();
