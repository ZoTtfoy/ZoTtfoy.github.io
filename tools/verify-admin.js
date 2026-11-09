/* ==========================================================================
 *  编辑器自检：node tools/verify-admin.js
 *  校验口令哈希、序列化无损、以及生成的 config.js 能被站点正常渲染。
 * ========================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const notes = [];
function check(cond, msg) {
  if (!cond) failures.push(msg); else notes.push('OK  ' + msg);
}

/* ---------- 最小 DOM 桩：让 admin.js 只注册、不启动 ---------- */
const stubs = {
  readyState: 'loading',
  body: { innerHTML: '' },
  documentElement: { dataset: {}, style: { setProperty() {} }, classList: { add(){}, remove(){} } },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => ({ style: {}, click() {}, setAttribute() {} })
};
const ctx = {
  window: null,
  document: stubs,
  console: { log(){}, error(...a) { failures.push('console.error: ' + a.join(' ')); }, warn(){} },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  sessionStorage: { getItem: () => null, setItem(){} },
  TextEncoder, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  setTimeout: () => 0, clearTimeout(){},
  fetch: () => Promise.reject(new Error('no network in test')),
  Promise, String, Array, Object, Math, Number, JSON, Date, RegExp, Error, Boolean
};
ctx.window = ctx;
vm.createContext(ctx);

for (const rel of ['assets/js/config.js', 'assets/js/admin.js']) {
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  } catch (e) {
    failures.push('执行 ' + rel + ' 抛错: ' + e.message);
  }
}

const A = ctx.ADMIN;
check(!!A, 'admin.js 已加载并暴露 ADMIN 配置');
check(!!ctx.ADMIN_HASH, '已暴露哈希工具');
check(!!ctx.ADMIN_SERIALIZE, '已暴露序列化函数');

/* ---------- 1. SHA-256 与 Node 原生实现一致 ---------- */
const samples = ['', 'a', 'abc', 'zotrod', 'admin-test-pass-1',
  '中文口令测试', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000)];
let shaOk = true;
for (const s of samples) {
  const mine = ctx.ADMIN_HASH.sha256(s);
  const real = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  if (mine !== real) { shaOk = false; failures.push(`SHA-256 不一致: ${JSON.stringify(s.slice(0, 20))} -> ${mine} vs ${real}`); }
}
check(shaOk, `SHA-256 实现与 Node 原生一致（${samples.length} 组，含中文与长文本）`);

/* ---------- 2. 凭据格式与拒绝行为 ---------- */
check(/^[0-9a-f]{64}$/.test(A.userHash) && /^[0-9a-f]{64}$/.test(A.passHash), '存的是 SHA-256 十六进制摘要');
check(ctx.ADMIN_HASH.hash('zotrod') === A.userHash, '账户哈希与配置一致（用户名为公开信息）');
check(ctx.ADMIN_HASH.hash('zotrod ') !== A.userHash, '错误账户被拒绝（含尾随空格）');
['', 'password', '123456', 'admin', 'zotrod', 'zotrod123'].forEach(function (wrong) {
  check(ctx.ADMIN_HASH.hash(wrong) !== A.passHash, '弱口令 / 常见值被拒绝: ' + (wrong || '(空)'));
});

/* ADMIN 区块本身不得出现口令明文：只允许 salt + 两个 64 位摘要 */
const adminSrc = fs.readFileSync(path.join(ROOT, 'assets/js/admin.js'), 'utf8');
const block = adminSrc.slice(adminSrc.indexOf('window.ADMIN'), adminSrc.indexOf('repo:'));
const literals = (block.match(/"[^"]{6,}"/g) || []).filter(function (s) {
  return !/^"[0-9a-f]{16}"$/.test(s) && !/^"[0-9a-f]{64}"$/.test(s);
});
check(literals.length === 0, 'ADMIN 区块只含盐与摘要，无其他明文' +
  (literals.length ? '（发现: ' + literals.join(', ') + '）' : ''));

/* 若仓库外的凭据文件存在，校验其中的口令确实能通过 */
const credPath = path.join(ROOT, '..', '管理凭据.txt');
if (fs.existsSync(credPath)) {
  const text = fs.readFileSync(credPath, 'utf8');
  const m = /口令[:：]\s*(\S+)/.exec(text);
  const u = /账户[:：]\s*(\S+)/.exec(text);
  if (m) check(ctx.ADMIN_HASH.hash(m[1]) === A.passHash, '凭据文件中的口令可通过校验');
  if (u) check(ctx.ADMIN_HASH.hash(u[1]) === A.userHash, '凭据文件中的账户可通过校验');
  // 若口令已轮换，旧摘要必须失效（用当前的 passHash 与文件里的口令交叉验证即可）
} else {
  notes.push('--  未找到仓库外凭据文件，跳过口令实值校验');
}

/* ---------- 3. 序列化无损 ---------- */
const original = JSON.parse(JSON.stringify(ctx.SITE_CONFIG));
const source = ctx.ADMIN_SERIALIZE(original);
check(/^\/\*/.test(source) && source.includes('window.SITE_CONFIG ='), '生成的源码结构完整');

const round = {};
const ctx2 = { window: null, console };
ctx2.window = ctx2;
vm.createContext(ctx2);
try {
  vm.runInContext(source, ctx2, { filename: 'generated-config.js' });
} catch (e) {
  failures.push('生成的 config.js 无法执行: ' + e.message);
}

// 深比较
function diff(a, b, p = '') {
  const out = [];
  if (a === b) return out;
  if (typeof a !== typeof b || a === null || b === null) { out.push(`${p}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); return out; }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${p}: 数组长度 ${a.length} != ${b.length}`); return out; }
    a.forEach((x, i) => out.push(...diff(x, b[i], `${p}[${i}]`)));
    return out;
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.join() !== kb.join()) out.push(`${p}: 键不一致 [${ka}] vs [${kb}]`);
    ka.forEach(k => out.push(...diff(a[k], b[k], `${p}.${k}`)));
    return out;
  }
  out.push(`${p}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return out;
}
const d = diff(original, ctx2.SITE_CONFIG);
check(d.length === 0, '序列化后内容完全一致（深比较）' + (d.length ? '\n  差异:\n  ' + d.slice(0, 8).join('\n  ') : ''));

/* ---------- 4. 往返稳定：再序列化一次结果应相同 ---------- */
const again = ctx.ADMIN_SERIALIZE(ctx2.SITE_CONFIG);
check(again === source, '序列化幂等（两次输出完全一致）');

/* ---------- 5. 生成的文件能被站点渲染层正常使用 ---------- */
const renderSrc = fs.readFileSync(path.join(ROOT, 'assets/js/render.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check(renderSrc.includes('SITE_CONFIG'), '渲染层依赖 SITE_CONFIG 全局');
check(htmlSrc.includes('assets/js/config.js'), '页面已引入 config.js');
check(/window\.SITE_CONFIG\s*=/.test(source), '生成文件导出的是 window.SITE_CONFIG');

/* ---------- 6. admin.html 资源引用齐全 ---------- */
const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
[[/<link rel="stylesheet" href="(assets\/css\/[^"]+)"/g, 'CSS'],
 [/<script src="(assets\/js\/[^"]+)"/g, 'JS']].forEach(([re, kind]) => {
  let m;
  while ((m = re.exec(adminHtml)) !== null) {
    check(fs.existsSync(path.join(ROOT, m[1])), `admin.html 引用的 ${kind} 存在: ${m[1]}`);
  }
});
check(/name="robots" content="noindex/.test(adminHtml), '管理页已设为不被搜索引擎收录');

console.log(notes.join('\n'));
console.log('\n检查项: ' + notes.length + '，失败: ' + failures.length);
if (failures.length) { console.log('\n失败明细:\n' + failures.join('\n')); process.exit(1); }
console.log('\n全部通过');
