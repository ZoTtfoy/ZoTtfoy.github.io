/* 模拟真实操作：node tools/verify-push-ui.js
 * 用 jsdom 打开 admin.html，登录、切到令牌路线、点「先检查连接」，
 * 检查诊断清单真的逐项渲染出来，且结论正确。 */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (e) {
  console.log('未安装 jsdom，跳过。npm install jsdom --no-save');
  process.exit(0);
}

const ROOT = path.resolve(__dirname, '..');
const notes = [], failures = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : failures.push(m);

const token = process.env.GH_TOKEN_FOR_TEST || '';
const credPath = path.join(ROOT, '..', '管理凭据.txt');

const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'https://zottfoy.github.io/admin.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.matchMedia = q => ({ matches: false, addEventListener() {}, addListener() {} });
    win.fetch = (...a) => fetch(...a);          // 用 Node 的 fetch
    win.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} };
    win.scrollTo = () => {};
  }
});

for (const src of ['assets/js/config.js', 'assets/js/themes.js', 'assets/js/icons.js', 'assets/js/admin.js']) {
  const el = dom.window.document.createElement('script');
  el.textContent = fs.readFileSync(path.join(ROOT, src), 'utf8');
  dom.window.document.body.appendChild(el);
}

const w = dom.window, d = w.document;

/* 登录 */
if (!fs.existsSync(credPath)) {
  console.log('缺少仓库外的 管理凭据.txt，跳过');
  process.exit(0);
}
const cred = fs.readFileSync(credPath, 'utf8');
d.getElementById('gateUser').value = /账户[:：]\s*(\S+)/.exec(cred)[1];
d.getElementById('gatePass').value = /口令[:：]\s*(\S+)/.exec(cred)[1];
d.getElementById('gateForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
ok(d.getElementById('app').hidden === false, '登录成功');

/* 打开发布抽屉 */
d.getElementById('publishBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok(d.getElementById('publishSheet').hidden === false, '发布抽屉打开');

/* 默认应是「不用令牌」路线 */
ok(d.getElementById('paneManual').hidden === false, '默认显示「不用令牌」路线');
ok(d.getElementById('paneToken').hidden === true, '令牌路线默认隐藏');
const ghEdit = d.getElementById('editOnGithub').getAttribute('href');
ok(ghEdit === 'https://github.com/ZoTtfoy/ZoTtfoy.github.io/edit/main/assets/js/config.js',
   '「打开 GitHub 编辑页」链接正确：' + ghEdit);

/* 切到令牌路线 */
const tokTab = [...d.querySelectorAll('[data-pub]')].find(b => b.getAttribute('data-pub') === 'token');
tokTab.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok(d.getElementById('paneToken').hidden === false, '切到令牌路线');
ok(d.getElementById('paneManual').hidden === true, '「不用令牌」面板隐藏');
ok(d.getElementById('pushBtn').disabled === true, '未检查前提交按钮禁用');

/* 先测一个明显错误的令牌：应被格式检查挡下，不发网络请求 */
const ti = d.getElementById('tokenInput');
ti.value = 'not-a-token';
ti.dispatchEvent(new w.Event('input', { bubbles: true }));
d.getElementById('checkBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

setTimeout(async () => {
  const list = d.getElementById('diagList');
  ok(list.hidden === false, '诊断清单已展开');
  ok(list.innerHTML.includes('令牌格式不对'), '格式错误被立即拦下：' + /令牌格式不对/.test(list.innerHTML));
  ok(d.getElementById('pushBtn').disabled === true, '格式错误时仍禁止提交');

  if (!token) {
    console.log(notes.join('\n'));
    console.log('\n（未提供 GH_TOKEN_FOR_TEST，跳过真实令牌的完整诊断）');
    console.log('检查项: ' + notes.length + '，失败: ' + failures.length);
    process.exit(failures.length ? 1 : 0);
  }

  /* 用真实令牌跑完整诊断 */
  ti.value = token;
  ti.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.getElementById('checkBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  setTimeout(() => {
    const out = d.getElementById('diagList').innerHTML;
    const rows = (out.match(/diag__row/g) || []).length;
    ok(rows === 5, '诊断清单完整渲染 ' + rows + ' 项（格式/有效性/仓库/文件/结论）');
    ok(/令牌有效/.test(out), '判定「令牌有效」');
    ok(/ZoTtfoy/.test(out), '报告了令牌所属账号');
    ok(/能访问仓库且有写权限/.test(out), '判定「可写」');
    ok(/能读到配置文件/.test(out), '判定「能读到配置文件」');
    ok(/可以提交了/.test(out), '最终结论为可提交');
    ok(!/is-bad/.test(out), '没有 ✕ 项');
    ok(d.getElementById('pushBtn').disabled === false, '检查通过后提交按钮启用');

    /* 再测一个无效但格式合法的令牌 */
    ti.value = 'ghp_' + 'x'.repeat(36);
    ti.dispatchEvent(new w.Event('input', { bubbles: true }));
    ok(d.getElementById('pushBtn').disabled === true, '改令牌后提交按钮重新禁用');

    d.getElementById('checkBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    setTimeout(() => {
      const o2 = d.getElementById('diagList').innerHTML;
      ok(/令牌无效/.test(o2), '无效令牌被判为「令牌无效」');
      ok(/过期|无效/.test(o2), '给出的是失效原因而非笼统失败');
      ok(d.getElementById('pushBtn').disabled === true, '无效令牌时禁止提交');

      console.log(notes.join('\n'));
      console.log('\n检查项: ' + notes.length + '，失败: ' + failures.length);
      if (failures.length) { console.log('\n失败明细:\n' + failures.join('\n')); process.exit(1); }
      console.log('\n全部通过');
    }, 2500);
  }, 8000);
}, 400);
