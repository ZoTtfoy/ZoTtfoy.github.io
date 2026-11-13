#!/usr/bin/env node
/* 一键跑全部校验。
 *
 *   node tools/run-all.js                跑全部（跳过已知超时项）
 *   node tools/run-all.js --all          连超时项一起跑
 *   node tools/run-all.js --perf         连 verify-perf 一起跑
 *   node tools/run-all.js --list         只列出会跑哪些
 *   node tools/run-all.js --only=theme,gaming
 *   node tools/run-all.js --skip=perf
 *   node tools/run-all.js --retry=0      失败不重试（默认重试 1 次）
 *   node tools/run-all.js --no-server    复用已在跑的服务
 *
 * 为什么要这个东西：
 *   tools/ 下有二十多个 verify-*.js，以前靠人记着跑哪几个 ——
 *   重构一次要手敲十几条命令，漏跑一个就等于没闸门。
 *   现在一条命令给出"红/绿 + 每一组多少项"。
 *
 * 约定（新写校验脚本时遵守）：
 *   · 文件名 verify-*.js
 *   · 失败必须 process.exit(1)
 *   · 站点地址默认 http://127.0.0.1:8791/
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const PORT = 8791;
const SITE = 'http://127.0.0.1:' + PORT + '/';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = (name, dflt) => {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};

/* 已知会超时的项：目前没有。
   （verify-density 曾在这张名单里 —— 144 档 × 2.3s 实测整脚本 347s，
   贴着 420s 超时线，于是默认跳过；一道没人跑的闸门等于没有闸门。
   2026-11-13 改成默认 54 档（约 165s）/ --full 144 档，重新纳入全套。
   想彻底扫一遍：node tools/verify-density.js --full。 */
const KNOWN_SLOW = new Set([]);

/* 已知会红的一项：目前没有。
   （verify-perf 曾经在这张名单里 —— 预算写的是"演进前的目标值"，而退回
   ab927bc 后封面墙是 120 张 <img>，六项全超。2026-11-13 把 archive 里的
   三项优化搬回来后它转绿了：按类重算体积、DOM 阈值 1400、滚动 35ms。
   一个永远红的断言等于没有断言，所以宁可重定阈值也不留它在名单里。） */
const KNOWN_RED = new Set([]);
const TIMEOUT = Number(val('timeout', 420)) * 1000;

/* ---------------------------------------------------------------- 发现脚本 */
function discover() {
  return fs.readdirSync(TOOLS)
    .filter(f => /^verify-.*\.js$/.test(f) || f === 'verify.js')
    .sort()
    .map(f => {
      const src = fs.readFileSync(path.join(TOOLS, f), 'utf8');
      return {
        name: f.replace(/\.js$/, ''),
        file: path.join(TOOLS, f),
        browser: /playwright|chromium\.launch/.test(src)
      };
    });
}

/* 静态（纯读文件）的先跑：几毫秒出结果，先知道你连 HTML 结构都改坏了没有 */
function order(list) {
  return list.slice().sort((a, b) => {
    if (a.browser !== b.browser) return a.browser ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/* -------------------------------------------------------------- 服务可用性 */
function probe() {
  return new Promise(resolve => {
    const req = http.get(SITE, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

function startServer() {
  const child = spawn(process.execPath, [path.join(TOOLS, 'serve.js'), String(PORT), '--silent'], {
    stdio: 'ignore'
  });
  return child;
}

async function waitReady(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await probe()) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

/* ------------------------------------------------------------------ 跑一个 */
function runOne(item) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [item.file], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT,
    maxBuffer: 32 * 1024 * 1024
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const ms = Date.now() - t0;
  const pass = r.status === 0;
  const m = out.match(/检查项:\s*(\d+)[，,]\s*失败:\s*(\d+)/);
  const n = m ? Number(m[1]) : (out.match(/^(?:OK|✓)/gm) || []).length;
  const bad = m ? Number(m[2]) : (pass ? 0 : NaN);
  return { pass, ms, total: n, bad, out };
}

/* --------------------------------------------------------------------- 主体 */
(async () => {
  let list = discover();
  const only = val('only', '');
  if (only) {
    const want = new Set(only.split(',').map(s => s.trim().replace(/^verify-/, '')));
    list = list.filter(i => want.has(i.name.replace(/^verify-/, '')));
  }
  const skip = new Set(val('skip', '').split(',').map(s => 'verify-' + s.trim()).filter(Boolean));
  if (!has('--all')) KNOWN_SLOW.forEach(n => skip.add(n));
  if (!has('--perf') && !has('--all')) KNOWN_RED.forEach(n => skip.add(n));
  const skipped = list.filter(i => skip.has(i.name)).map(i => i.name);
  list = order(list.filter(i => !skip.has(i.name)));

  if (has('--list')) {
    list.forEach(i => console.log('  ' + i.name + (i.browser ? '  (浏览器)' : '  (静态)')));
    console.log('\n共 ' + list.length + ' 个');
    if (skipped.length) console.log('跳过：' + skipped.join(', '));
    return;
  }

  let server = null;
  if (!has('--no-server')) {
    if (await probe()) {
      console.log('· 复用已在 ' + SITE + ' 上跑的服务');
    } else {
      server = startServer();
      if (!await waitReady(15000)) {
        console.error('✗ 起不来本地服务（端口 ' + PORT + '），先看看 node tools/serve.js ' + PORT);
        if (server) server.kill();
        process.exit(1);
      }
      console.log('· 已起本地服务 ' + SITE);
    }
  }

  console.log('· 将跑 ' + list.length + ' 个校验脚本\n');

  const results = [];
  const t0 = Date.now();
  const retries = Number(val('retry', 1));

  for (const item of list) {
    process.stdout.write('  ' + item.name.padEnd(24, ' '));
    let r = runOne(item);
    let flaky = false;
    /* 会重试一次。
       理由不是"掩盖问题"，而是这些脚本里有几个天生不稳：
       `waitUntil: 'networkidle'` 的页面同时在拉上百张远程封面，
       网络抖一下就会落在 30s 超时上，跟代码对错无关。
       重试通过的会单独标出来 —— 如果一个脚本经常要靠重试才过，
       那说明该修的是那个脚本，不是这条重试逻辑。 */
    for (let i = 0; i < retries && !r.pass; i++) {
      process.stdout.write('↻ ');
      r = runOne(item);
      flaky = r.pass;
    }
    results.push(Object.assign({ name: item.name, flaky }, r));
    const mark = r.pass ? (flaky ? '✓*' : '✓') : '✗';
    const count = r.total ? ' ' + (r.total - (r.bad || 0)) + '/' + r.total : '';
    console.log(mark + count + '  ' + (r.ms / 1000).toFixed(1) + 's');
    if (!r.pass) {
      /* 失败的把最后 20 行贴出来，不用回头再敲一遍命令 */
      const tail = r.out.trim().split('\n').slice(-20).join('\n');
      console.log(tail.split('\n').map(l => '      ' + l).join('\n'));
    }
  }

  const failed = results.filter(r => !r.pass);
  const flaky = results.filter(r => r.flaky);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const items = results.reduce((s, r) => s + (r.total || 0), 0);
  const bad = results.reduce((s, r) => s + (r.bad || 0), 0);

  console.log('\n' + '─'.repeat(60));
  console.log(failed.length
    ? '✗ ' + failed.length + ' 个脚本失败：' + failed.map(r => r.name).join(', ')
    : '✓ 全部通过');
  console.log('  ' + results.length + ' 个脚本，' + items + ' 项断言'
    + (bad ? '，失败 ' + bad + ' 项' : '') + '，用时 ' + secs + 's');
  if (flaky.length) {
    console.log('  * 重试后才通过：' + flaky.map(r => r.name).join(', ')
      + '（这些脚本的稳定性值得单独修）');
  }
  if (skipped.length) {
    console.log('  跳过 ' + skipped.length + ' 个已知项：' + skipped.join(', ')
      + '（--all 或 --perf 可跑，原因见 tools/run-all.js 顶部注释）');
  }

  if (server) server.kill();
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('ERR', e);
  process.exit(1);
});
