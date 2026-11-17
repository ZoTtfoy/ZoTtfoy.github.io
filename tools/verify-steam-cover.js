#!/usr/bin/env node
/* ==========================================================================
 *  Steam 封面兜底自检：验证 pickCover 在静态 CDN 全 404 时能从商店 API
 *  拿到带哈希的真实封面（回归场景：How to Fish / 4001890）。
 * --------------------------------------------------------------------------
 *  测试拆两层，避免外部网络抖动污染全量测试：
 *    A. 逻辑层（永远跑，打桩 fetch）：守"旧 CDN 全挂 → 调商店 API → 解析
 *       header_image → 返回哈希直链；全失败返回空串"。这是真正要守的行为，
 *       打桩照样能验证，且不受 Steam 服务状态影响。
 *    B. 真网络层（可达时才跑）：确认线上确实能取到那张图；Steam API 不可达
 *       时明确 SKIP，不算失败 —— 外部故障不该让一个回归闸门长期飘红。
 *  从 sync-steam.mjs 源码截取真实函数执行，避免测试和实现两套逻辑。
 *
 *  用法：node tools/verify-steam-cover.js
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-steam.mjs'), 'utf8');
const notes = [], fails = [], skips = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* 从源码里抠出常量与两个函数：从 `const CDN =` 到 `async function readApiKey` 之前。 */
const START = SRC.indexOf('const CDN =');
const END = SRC.indexOf('async function readApiKey');
if (START < 0 || END < 0) {
  console.error('无法从 sync-steam.mjs 提取封面函数，测试终止');
  process.exit(2);
}
const snippet = SRC.slice(START, END).replace(/export\s+/g, '');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* 用哪套 fetch 执行源码片段：打桩版（逻辑层）或真实版（网络层） */
function makePick(fetchImpl) {
  const ctx = {
    fetch: fetchImpl, AbortController, setTimeout, clearTimeout, URL, console, UA,
    Uint8Array, ArrayBuffer, TextDecoder, Headers, Request, Response
  };
  vm.createContext(ctx);
  vm.runInContext(snippet + '\nthis.__pickCover = pickCover;', ctx);
  return ctx.__pickCover;
}

const HASH_IMG =
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4001890/' +
  '45c4ddff4901e32c4b8b643e1b97d0d01898d299/header.jpg?t=1792508550';

/* 打桩：所有旧 CDN 路径返回 404，商店 API 对 4001890 返回带哈希的 header_image。
   这样"CDN 全挂 → API 兜底"的逻辑每次都能被确定性地验证。 */
function stubFetch(url) {
  const u = String(url);
  if (/appdetails\?appids=4001890/.test(u)) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        '4001890': { success: true, data: { header_image: HASH_IMG, capsule_image: '' } }
      })
    });
  }
  if (/appdetails/.test(u)) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ '999999999': { success: false } }) });
  }
  // 所有 CDN 图片 HEAD 一律 404
  return Promise.resolve({ ok: false });
}

async function reachSteam() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://store.steampowered.com/api/appdetails?appids=4001890&l=schinese',
      { signal: ctl.signal, headers: { 'User-Agent': UA } });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

(async () => {
  /* ========== A. 逻辑层（打桩，永远跑） ========== */
  const stubPick = makePick(stubFetch);
  const stubFish = await stubPick(4001890);
  ok(!!stubFish, 'CDN 全 404 时兜底返回封面（不再空串）');
  ok(/store_item_assets|shared\.akamai/.test(stubFish || ''), '兜底封面来自商店 API 的哈希路径');
  ok((stubFish || '') === HASH_IMG, '正确解析 header_image 字段');

  let bogus = '';
  try { bogus = await stubPick(999999999); } catch (e) { fails.push('不存在的 appid 抛错：' + e.message); }
  ok(bogus === '', '所有数据源都失败时返回空串（前端兜底图标）');

  /* ========== B. 真网络层（可达才跑） ========== */
  const online = await reachSteam();
  if (!online) {
    skips.push('Steam 商店 API 当前不可达，跳过真网络校验（外部故障，不影响逻辑闸门）');
  } else {
    const livePick = makePick(fetch);
    const liveFish = await livePick(4001890);
    ok(!!liveFish, '真网络：How to Fish 能拿到封面');
    if (liveFish) {
      // HEAD 校验返回的是图片
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 10000);
        const r = await fetch(liveFish, { method: 'HEAD', signal: ctl.signal, headers: { 'User-Agent': UA } });
        clearTimeout(t);
        ok(r.ok && /^image\//.test(r.headers.get('content-type') || ''), '真网络：封面 URL 返回 image/*');
      } catch { skips.push('真网络：封面 HEAD 校验超时，跳过'); }
    }
  }

  console.log(notes.join('\n'));
  if (skips.length) console.log('\nSKIP:\n' + skips.map(s => '· ' + s).join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + fails.length);
  if (fails.length) { console.log('\n失败明细:\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch(e => { console.error(e); process.exit(2); });
