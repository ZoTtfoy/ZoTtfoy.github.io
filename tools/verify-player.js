/* ==========================================================================
 *  站内播放已退役：node tools/verify-player.js
 * --------------------------------------------------------------------------
 *  2026-11-13 用户要求「听歌磁贴不加入播放，点击跳歌曲主页，播放键也去掉」。
 *  于是 player.js（单例 <audio>、事件委托、进度条、浮窗联动）整个删掉，
 *  磁贴改成整行外链。
 *
 *  这个脚本不删，改成守「退役之后别再长回来」：
 *    · index.html 不许再引 player.js
 *    · main.js 启动表里不许再有 SITE_PLAYER
 *    · 渲染层不许再产出 data-play / .track__play / .track__go
 *    · 每个磁贴必须有一个 .track__hit，href 指向 music.163.com（运行时由
 *      verify-listen 验，这里守代码形状）
 *    · 播放相关的 CSS（播放态进度条、热区）与页脚同步状态不许残留
 *
 *  纯静态检查，不开浏览器 —— 它守的是"代码形状"，不是运行时行为。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const html = read('index.html');
const mainSrc = read('assets/js/main.js');
const listenSrc = read('assets/js/sections/render-listen.js');
const listenCss = read('assets/css/30-sections/listen.css');

/* ---------- 1. 播放器本身彻底退场 ---------- */
ok(!/<script[^>]+player\.js/.test(html), 'index.html 不再引 player.js');
ok(!fs.existsSync(path.join(ROOT, 'assets/js/player.js')), 'assets/js/player.js 已删除');
ok(!/SITE_PLAYER/.test(mainSrc), 'main.js 启动表里没有 SITE_PLAYER');

/* ---------- 2. 渲染层不再产生播放控件 ---------- */
ok(!/data-play|outer\/url\?id=/.test(listenSrc), '渲染层不再输出 data-play / 外链音频地址');
ok(!/track__play\b|track__go\b/.test(listenSrc), '渲染层不再输出 .track__play / .track__go');
ok(/class="track__hit"/.test(listenSrc), '每行都有整行链接 .track__hit');
ok(/aria-label="在网易云打开/.test(listenSrc), '整行链接带可读的 aria-label');

/* ---------- 3. 样式也清干净 ---------- */
ok(!/\.track__play\b|\.track__go\b/.test(listenCss), 'listen.css 里没有播放键样式');
ok(!/\.track\.is-playing/.test(listenCss), 'listen.css 里没有播放态 / 进度条');
ok(/\.track__hit\s*\{[^}]*position:\s*absolute/.test(listenCss),
  '.track__hit 是覆盖整行的绝对定位层');

/* ---------- 4. 页脚状态指示器已移到后台 ---------- */
ok(!/class="listen__src/.test(listenSrc), '页脚不再渲染「已同步 / 待同步」状态');
ok(!/listen__note/.test(listenSrc), '页脚不再渲染「x/y 可试听」（站内已不播放）');

notes.forEach(n => console.log(n));
if (fails.length) console.log('\n失败明细:\n' + fails.map(f => '· ' + f).join('\n') + '\n');
console.log('检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
if (fails.length) process.exit(1);
console.log('\n全部通过');
