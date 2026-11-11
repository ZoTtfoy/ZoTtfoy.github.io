#!/usr/bin/env python3
"""本地预览服务器（多线程）。

为什么不用 `python -m http.server`：
    那个是**单线程**的。这个站点一屏就要并发拉几十张封面
    （游戏屏 48 张竖版封面 + 在听屏 72 张专辑封面 + 各种 CSS/JS），
    单线程排队时浏览器会等到超时，测试脚本里就表现为
      · page.goto: Timeout ... waiting until "networkidle"
      · Failed to load resource: net::ERR_CONNECTION_REFUSED
    而这些都不是代码问题 —— 排查了很久才定位到是服务器在瓶颈。

用法：
    python tools/serve.py [端口]      # 默认 8791
然后浏览器打开 http://127.0.0.1:8791/
"""
import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791


class Handler(http.server.SimpleHTTPRequestHandler):
    """静音访问日志 + 禁掉缓存。

    禁缓存是因为改完 CSS/JS 刷新就该立刻看到，而不是等浏览器自己失效。
    这会让每次请求都真的读盘，所以必须配合下面的多线程。
    """

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    # 允许端口立刻复用，重启时不会卡在 TIME_WAIT
    allow_reuse_address = True
    daemon_threads = True
# ⚠️ 监听队列默认只有 5。本站一屏要并发拉上百张 CDN 封面，
    # 5 个 backlog 瞬间被占满，内核直接回 RST —— 浏览器侧看到的就是
    # ERR_CONNECTION_REFUSED，和"服务器没启动"一模一样，极难区分。
    # 调到 128 之后这类假故障消失。
    request_queue_size = 128


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with Server(("127.0.0.1", PORT), handler) as httpd:
        print(f"serving {ROOT} at http://127.0.0.1:{PORT}/")
        httpd.serve_forever()
