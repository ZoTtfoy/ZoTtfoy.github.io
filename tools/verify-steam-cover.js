#!/usr/bin/env node
/* ==========================================================================
 *  Steam 封面兜底自检：验证 pickCover 在静态 CDN 全 404 时能从商店 API
 *  拿到带哈希的真实封面（回归场景：How to Fish / 4001890）。
 * --------------------------------------------------------------------------
 *  为什么直接跑真网络：这个 bug 的根因就是"CDN 404 但 API 有图"，
 *  打桩测不出真相对比。脚本只发几个 HEAD + 一次公开 API，不写任何文件。
 *  从 sync-steam.mjs 源码里截取真实函数执行，避免测试和实现两套逻辑。
 *
 *  用法：node tools/verify-steam-cover.js
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-steam.mjs'), 'utf8');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* 从源码里抠出常量与两个函数：从 `const CDN =` 到 `async function readApiKey` 之前。
   这样测的就是线上同一份实现，改了实现测试会跟着变。 */
const START = SRC.indexOf('const CDN =');
const END = SRC.indexOf('async function readApiKey');
if (START < 0 || END < 0) {
  console.error('无法从 sync-steam.mjs 提取封面函数，测试终止');
  process.exit(2);
}
const snippet = SRC.slice(START, END)
  .replace(/export\s+/g, '');   // mjs 片段里若有导出，去掉

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ctx = {
  fetch, AbortController, setTimeout, clearTimeout, URL, console, UA,
  Uint8Array, ArrayBuffer, TextDecoder, Headers, Request, Response
};
vm.createContext(ctx);
try {
  vm.runInContext(snippet + '\nthis.__pickCover = pickCover;', ctx);
} catch (e) {
  console.error('执行封面函数片段失败：' + e.message);
  process.exit(2);
}
const pickCover = ctx.__pickCover;

async function isImage(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(url, { method: 'HEAD', signal: ctl.signal, headers: { 'User-Agent': UA } });
    clearTimeout(t);
    return r.ok && /^image\//.test(r.headers.get('content-type') || '');
  } catch { return false; }
}

(async () => {
  /* ① 正常游戏：旧路径仍应命中，且是 CDN 直链（不被哈希路径取代） */
  const normal = await pickCover(1078920);
  ok(!!normal && /steam\/apps\/1078920\//.test(normal),
    '正常游戏走旧 CDN 直链（' + (normal || '空') + '）');

  /* ② 回归场景：How to Fish 旧路径全 404，兜底应给出可用的哈希图 */
  const fish = await pickCover(4001890);
  ok(!!fish, 'How to Fish(4001890) 现在能拿到封面（不再空串）');
  if (fish) {
    ok(/store_item_assets|shared\.akamai/.test(fish),
      '封面来自商店 API 的哈希路径（' + fish.slice(0, 70) + '…）');
    ok(await isImage(fish), '该封面 URL 实测返回 image/*（HEAD 200）');
  }

  /* ③ 不存在的 appid：所有数据源都失败时返回空串，走前端兜底，不抛错 */
  let bogus = '';
  try { bogus = await pickCover(999999999); } catch (e) { fails.push('不存在的 appid 抛错：' + e.message); }
  ok(bogus === '', '取不到的 appid 返回空串（前端兜底图标）');

  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch(e => { console.error(e); process.exit(2); });
