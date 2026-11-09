/* 诊断引擎验证：node tools/verify-push.js
 * 用真实 GitHub API 走一遍 diagnose()，确认各种失败都能说清楚原因。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const notes = [], failures = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : failures.push(m);

const ctx = {
  window: null,
  document: { readyState: 'loading', querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: { innerHTML: '' }, createElement: () => ({ style: {} }) },
  console: { log() {}, error(...a) { failures.push('console.error: ' + a.join(' ')); }, warn() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {} },
  fetch: (...a) => fetch(...a),
  TextEncoder, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  setTimeout: () => 0, clearTimeout() {},
  location: { protocol: 'https:' },
  Promise, String, Array, Object, Math, Number, JSON, Date, RegExp, Error, Boolean, encodeURIComponent
};
ctx.window = ctx;
vm.createContext(ctx);

for (const rel of ['assets/js/config.js', 'assets/js/admin.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
}

ok(!!ctx.ADMIN, 'admin.js 加载');

/* 把内部函数暴露出来以便测试 */
const src = fs.readFileSync(path.join(ROOT, 'assets/js/admin.js'), 'utf8');
const probe = src.replace(
  'window.ADMIN_SERIALIZE = serialize;',
  'window.ADMIN_SERIALIZE = serialize;\n  window.__explain = explain;'
);
const ctx2 = Object.assign({}, ctx, { document: ctx.document, console: ctx.console });
ctx2.window = ctx2;
vm.createContext(ctx2);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8'), ctx2);
vm.runInContext(probe, ctx2, { filename: 'admin-probe.js' });

/* ---------- 1. 状态码翻译是否覆盖并说清 ---------- */
const explain = ctx2.__explain;
ok(typeof explain === 'function', 'explain() 可用');
const cases = [
  [401, /过期|无效/, '401 应提示令牌无效'],
  [403, /Contents|频率/, '403 应提示权限或限流'],
  [404, /授权|写权限/, '404 必须提到「授权/写权限」而不是「不存在」'],
  [409, /冲突|刷新/, '409 应提示冲突并刷新'],
  [422, /编码|太大/, '422 应提到编码或体积'],
  [429, /频繁/, '429 应提示限流']
];
for (const [code, re, label] of cases) {
  const out = explain(code, '提交');
  ok(re.test(out), label + ' —— 实际：' + out.slice(0, 46) + '…');
  ok(out.includes('提交阶段'), code + ' 的提示带阶段标记');
}
const unknown = explain(599, '提交');
ok(/599/.test(unknown), '未知状态码也带上具体码值');

/* ---------- 2. 关键：404 的文案不能再误导 ---------- */
const e404 = explain(404, '读取');
ok(!/不存在这个文件/.test(e404), '404 文案不再断言「文件不存在」');
ok(/Only select repositories/.test(e404), '404 给出了 Fine-grained token 的具体设置路径');
ok(/Contents/.test(e404), '404 提示了 Contents 权限');

/* ---------- 3. 真实 API：用当前 gh 令牌跑一遍，确认判断准确 ---------- */
const token = process.env.GH_TOKEN_FOR_TEST || null;

async function realChecks() {
  if (!token) {
    notes.push('--  未提供测试令牌，跳过真实 API 校验（设置 GH_TOKEN_FOR_TEST 可启用）');
    return;
  }
  const H = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const repo = ctx2.ADMIN.repo;

  const r1 = await fetch('https://api.github.com/user', { headers: H });
  ok(r1.ok, '真实令牌可读 /user（' + r1.status + '）');
  if (r1.ok) {
    const u = await r1.json();
    notes.push('--  令牌属于账号：' + u.login);
  }

  const r2 = await fetch('https://api.github.com/repos/' + repo, { headers: H });
  ok(r2.ok, '真实令牌可读目标仓库（' + r2.status + '）');
  if (r2.ok) {
    const d = await r2.json();
    ok(d.permissions && d.permissions.push === true, '仓库返回 push 权限，诊断会判为可写');
  }

  // 故意用不存在的仓库，验证我们把它归为「访问不到」而不是「文件不存在」
  const r3 = await fetch('https://api.github.com/repos/' + repo.split('/')[0] + '/no-such-repo-xyz', { headers: H });
  ok(r3.status === 404, '不存在的仓库返回 404（' + r3.status + '）');
  ok(/授权|写权限/.test(explain(r3.status, '读取仓库')), '该 404 被翻译成权限问题而非文件缺失');

  // 无效令牌应 401
  const r4 = await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ghp_' + 'x'.repeat(36) }
  });
  ok(r4.status === 401, '伪造令牌返回 401（' + r4.status + '）');
  ok(/过期|无效/.test(explain(r4.status, '验证令牌')), '401 被翻译为令牌无效');
}

/* ---------- 4. 界面元素是否就位 ---------- */
const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
['pubTabs', 'paneManual', 'paneToken', 'checkBtn', 'diagList', 'copyCfg', 'editOnGithub', 'pushBtn']
  .forEach(id => ok(html.includes('id="' + id + '"'), 'admin.html 含 #' + id));
ok(/data-pub="manual"/.test(html) && /data-pub="token"/.test(html), '两条路线都有切换入口');
ok(/Content-Type/.test(src), '提交请求带 Content-Type');
ok(/先检查连接/.test(html), '有「先检查连接」按钮');
ok(/pushBtn" type="button" id="pushBtn"|id="pushBtn"[^>]*disabled/.test(html), '提交按钮默认禁用，检查通过后才可用');

realChecks().then(() => {
  console.log(notes.join('\n'));
  console.log('\n检查项: ' + notes.length + '，失败: ' + failures.length);
  if (failures.length) { console.log('\n失败明细:\n' + failures.join('\n')); process.exit(1); }
  console.log('\n全部通过');
});
