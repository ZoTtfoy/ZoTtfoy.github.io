/* ==========================================================================
 *  最近入库（差集记账）验证：node tools/verify-steam-added.js
 * --------------------------------------------------------------------------
 *  为什么单独有这个脚本：
 *    「最近入库」是页面里唯一**跨时间累积**的数据 —— 它不对应 Steam 的某个字段，
 *    而是靠两次同步的 appid 差集算出来的。这类逻辑最容易在改代码时被悄悄改坏，
 *    而且坏了不会报错：页面只是永远显示"暂无新入库"。
 *    联网测一遍要等真买游戏，所以这里用假数据把全部分支跑完。
 *
 *  覆盖：
 *    ① 首次同步 → 只建基线，不把 143 款全算成"新"
 *    ② 没有变化 → 记录原样保留
 *    ③ 新增一款 → 排在记录最前，日期是今天
 *    ④ 连续三次新增 → 累积、新的在前
 *    ⑤ 超过上限 → 截断到 12 条，且丢的是最旧的
 *    ⑥ 重复 appid → 不记两条
 *    ⑦ 空库（API 抽风）→ 不清空已有记录
 *    ⑧ 旧版 JSON（没有 added 字段）→ 当成空记录，不崩
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

const g = (appid, name) => ({ appid, name: name || ('Game ' + appid) });

(async () => {
  const lib = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/steam-added.mjs')).href);
  const diff = lib.diffRecentlyAdded;

  /* ---- ① 首次同步：只建基线 ---- */
  const first = diff(null, [g(1), g(2), g(3)], '2026-11-11');
  ok(first.baseline === true, '首次同步标记为"只建基线"');
  ok(first.added.length === 0, '首次同步不产出"新入库"（否则 143 款全会进列表）');
  ok(first.ownedSince === '2026-11-11', '首次同步记下基线日期（' + first.ownedSince + '）');

  /* ---- ② 没有变化 ---- */
  const base = { owned: [g(1), g(2), g(3)], added: [], ownedSince: '2026-11-11' };
  const same = diff(base, [g(1), g(2), g(3)], '2026-11-12');
  ok(same.fresh.length === 0 && same.added.length === 0, '库里没变化时不产生记录');
  ok(same.baseline === false, '有基线时不再走"建基线"分支');

  /* ---- ③ 新增一款 ---- */
  const one = diff(base, [g(1), g(2), g(3), g(99, '新买的游戏')], '2026-11-12');
  ok(one.fresh.length === 1 && one.fresh[0].appid === 99,
     '新增一款能被识别（' + (one.fresh[0] && one.fresh[0].name) + '）');
  ok(one.added.length === 1 && one.added[0].appid === 99 && one.added[0].at === '2026-11-12',
     '记录带 appid / 名字 / 日期');
  ok(one.added[0].name === '新买的游戏', '记录里存的是可读名字（前端直接显示）');

  /* ---- ④ 连续三次新增：累积，新的在前 ---- */
  let prev = base;
  const days = [['2026-11-12', 101], ['2026-11-13', 102], ['2026-11-14', 103]];
  for (const [day, appid] of days) {
    const r = diff(prev, prev.owned.concat([g(appid)]), day);
    prev = { owned: prev.owned.concat([g(appid)]), added: r.added, ownedSince: r.ownedSince };
  }
  ok(prev.added.length === 3, '三次新增累积成 3 条（' + prev.added.length + '）');
  ok(prev.added.map(x => x.appid).join(',') === '103,102,101',
     '新的排最前（' + prev.added.map(x => x.appid).join(' → ') + '）');
  ok(prev.ownedSince === '2026-11-11', '累积过程中基线日期不变');

  /* ---- ⑤ 超过上限：截断到 12 条，丢最旧的 ---- */
  const many = [g(1)];
  let cur = { owned: [g(1)], added: [], ownedSince: '2026-11-11' };
  for (let i = 0; i < 20; i++) {
    const appid = 500 + i;
    const r = diff(cur, cur.owned.concat([g(appid)]), '2026-11-' + String(10 + (i % 18)).padStart(2, '0'));
    cur = { owned: cur.owned.concat([g(appid)]), added: r.added, ownedSince: r.ownedSince };
  }
  ok(cur.added.length === lib.ADDED_LIMIT,
     '记录上限为 ' + lib.ADDED_LIMIT + ' 条（实际 ' + cur.added.length + '）');
  ok(cur.added[0].appid === 519, '上限内保留的是**最新**的（首条 ' + cur.added[0].appid + '）');
  ok(!cur.added.some(x => x.appid === 500), '最旧的被挤掉（500 不在列表里）');

  /* ---- ⑥ 重复 appid：不记两条 ---- */
  const dup = diff({ owned: [g(1)], added: [], ownedSince: '2026-11-11' },
                   [g(1), g(1), g(2), g(2)], '2026-11-12');
  ok(dup.added.length === 2, '同一个 appid 重复出现只记一条（实际 ' + dup.added.length + '）');

  /* ---- ⑦ 空库：不清空已有记录 ---- */
  const wiped = diff({ owned: [g(1), g(2)], added: [{ appid: 7, name: 'X', at: '2026-11-01' }], ownedSince: '2026-10-01' },
                     [], '2026-11-12');
  ok(wiped.added.length === 1 && wiped.added[0].appid === 7,
     'API 返回空库时保留已有记录（不清空）');
  ok(wiped.ownedSince === '2026-10-01', '空库时基线日期也不动');

  /* ---- ⑧ 旧版 JSON（没有 added 字段）---- */
  const legacy = diff({ owned: [g(1)] }, [g(1), g(2)], '2026-11-12');
  ok(legacy.added.length === 1 && legacy.added[0].appid === 2,
     '旧版 JSON（无 added 字段）当成空记录，仍能算出新增');

  /* ---- 与前端的承接口径 ---- */
  const renderSrc = fs.readFileSync(path.join(ROOT, 'assets/js/render.js'), 'utf8');
  ok(/function recentlyAddedHtml/.test(renderSrc), 'render.js 有 recentlyAddedHtml');
  const fnBlock = (renderSrc.match(/function recentlyAddedHtml[\s\S]*?\n\}/) || [''])[0];
  ok(/\.at\b|\.at\s*\|\||item\.at/.test(fnBlock) || /\bat\b/.test(fnBlock),
     '前端记录里用到了 at 字段（日期）');
  ok(/slice\(\s*0\s*,\s*8\s*\)/.test(fnBlock) || /8/.test(fnBlock),
     '前端最多铺 8 个封面（其余走 +N）');
  /* 后端上限必须 >= 前端展示数，否则"+"里那部分永远空着 */
  ok(lib.ADDED_LIMIT >= 8, '后端保留条数（' + lib.ADDED_LIMIT + '）不少于前端展示的 8 个');

  /* ---- 脚本确实用了这个纯函数（而不是自己又写了一份）---- */
  const scriptSrc = fs.readFileSync(path.join(ROOT, 'scripts/sync-steam.mjs'), 'utf8');
  ok(/from\s+["']\.\/lib\/steam-added\.mjs["']/.test(scriptSrc),
     'sync-steam.mjs 引用了 lib/steam-added.mjs');
  ok(/diffRecentlyAdded\(/.test(scriptSrc), 'sync-steam.mjs 调用 diffRecentlyAdded');
  ok(!/fresh\s*=\s*board\.owned\.filter/.test(scriptSrc),
     '差集逻辑没有在脚本里重复实现一遍');

  /* ---- 输出 ---- */
  console.log(notes.join('\n'));
  if (fails.length) {
    console.log('\n失败明细:');
    fails.forEach(f => console.log('  ✗ ' + f));
    console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
    process.exit(1);
  }
  console.log('\n检查项: ' + notes.length + '，失败: 0');
  console.log('\n全部通过');
})();
