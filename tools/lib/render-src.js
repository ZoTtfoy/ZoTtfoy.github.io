/* 把渲染层的源码当成"一个逻辑文件"读。
 *
 * 拆屏之后，`render.js` 只是核心；各屏的函数在 core/ 与 sections/ 里。
 * 那些对源码做静态断言的校验脚本（verify-gaming / verify-steam-added /
 * verify-admin）关心的是"渲染层有没有这条规则"，不关心它落在哪个物理文件。
 * 所以统一从这里取拼接后的源码 —— 以后再拆一屏，工具不用跟着改。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = 'assets/js/core/render-kit.js';
const SECTIONS_DIR = path.join(ROOT, 'assets/js/sections');
const MAIN = 'assets/js/render.js';

function files() {
  const sections = fs.existsSync(SECTIONS_DIR)
    ? fs.readdirSync(SECTIONS_DIR).filter(f => /^render-.*\.js$/.test(f)).sort()
      .map(f => 'assets/js/sections/' + f)
    : [];
  return [CORE].concat(sections, [MAIN]);
}

function renderSource() {
  return files()
    .map(rel => fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    .join('\n');
}

module.exports = { renderSource: renderSource, files: files };
