#!/usr/bin/env node
/* 本地静态服务器（Node 版，零依赖）。
 *
 * 为什么不用 `python -m http.server`：
 *   · 它是单线程的。一屏要并发拉几十张封面（游戏屏 48 + 在听屏 72），
 *     单线程排队时浏览器会等到超时，测试里表现为 goto timeout /
 *     ERR_CONNECTION_REFUSED —— 曾经为此排查了很久。
 *   · node 的 http 天生并发，还省掉"机器上有没有 python"这个问题。
 *
 * 为什么禁缓存：改完 CSS/JS 刷新就该立刻看到，而不是等浏览器自己失效。
 * 这也让每次请求都真的读盘，所以并发能力必须跟得上。
 *
 * 用法：
 *   node tools/serve.js [端口]        # 默认 8791
 *   node tools/serve.js 8791 --silent # 给测试跑器用，不打印
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARGV = process.argv.slice(2);
const PORT = Number(ARGV.find(a => /^\d+$/.test(a)) || process.env.PORT || 8791);
const SILENT = ARGV.includes('--silent');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8'
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    return send(res, 400, 'bad request');
  }

  let file = path.join(ROOT, pathname);
  /* 目录穿越防护：解析后必须仍在 ROOT 之内 */
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      const index = path.join(file, 'index.html');
      if (fs.existsSync(index)) return stream(index);
      return send(res, 404, 'not found');
    }
    if (err) return send(res, 404, 'not found');
    stream(file);
  });

  function stream(file) {
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store, max-age=0' });
    const s = fs.createReadStream(file);
    s.on('error', () => { res.destroy(); });
    s.pipe(res);
  }
});

/* 监听队列默认只有几十，并发拉封面时会排队等 accept。
   这里放宽到 511（Linux/macOS 上限），Windows 上会被内核截断，无害。 */
server.listen({ port: PORT, host: '127.0.0.1', backlog: 511 }, () => {
  if (!SILENT) console.log('serving ' + ROOT + '  ->  http://127.0.0.1:' + PORT + '/');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
