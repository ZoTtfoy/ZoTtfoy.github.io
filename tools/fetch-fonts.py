#!/usr/bin/env python3
"""把 MiSans 的 woff2 分片抓到 assets/fonts/，并把 fonts.css 改成相对路径。

为什么要自托管：字体走 jsDelivr 时，CN 网络下 CDN 抖动会直接变成
「字没换过来」。仓库本来就是静态站，字体和 CSS 一样该进来。
"""
import concurrent.futures as cf
import os
import re
import sys
import urllib.request

BASE = "https://fastly.jsdelivr.net/npm/misans@4.1.0/lib/Normal/"
OUT = os.path.join("assets", "fonts")
CSS = os.path.join("assets", "css", "fonts.css")
PLAN = [("Regular", 400), ("Semibold", 600), ("Bold", 700)]

os.makedirs(OUT, exist_ok=True)


def fetch(url, binary=True, tries=3):
    last = None
    for _ in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
                return r.read() if binary else r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"{url}: {last}")


def main():
    head = (
        "/* ==========================================================================\n"
        " *  fonts.css —— MiSans（小米开源字体，免费商用）\n"
        " * --------------------------------------------------------------------------\n"
        " *  ⚠️ 字体文件就在 assets/fonts/ 里，**不再走 CDN**。\n"
        " *     之前是从 jsDelivr 按需取片：体积小，但 CN 网络下 CDN 一抖，\n"
        " *     换字体的效果就直接变成「系统字体」。静态站本来就该把这些收进来。\n"
        " *\n"
        " *  为什么是 300 条 @font-face 而不是 3 条：\n"
        " *     每个字重被切成 100 个 unicode-range 分片（按用字频率排的）。\n"
        " *     浏览器只下载页面真正用到的那几片 —— 首屏实测 30~40 片、约 300KB；\n"
        " *     换成单个 2MB 的全量 woff2，首屏要等 2MB 才能换字。\n"
        " *     所以「分片」这件事本身就是性能设计，别合并。\n"
        " *\n"
        " *  字重被**重新标定**为 400 / 600 / 700：\n"
        " *     上游包写的是 MiSans 的原生重量（Regular 330 / Semibold 520 /\n"
        " *     Bold 630）。CSS 里写 font-weight:600 时浏览器按「就近取大」\n"
        " *     会挑到 630、写 500 会挑到 520 —— 整套映射全乱。\n"
        " *\n"
        " *  来源：https://github.com/dsrkafuu/misans（Apache-2.0，字形版权小米）\n"
        " *  这份文件由 tools/fetch-fonts.py 生成，改之前先看那个脚本。\n"
        " * ========================================================================== */\n"
    )

    parts = [head]
    total_files = 0
    total_bytes = 0

    for name, weight in PLAN:
        css = fetch(BASE + f"MiSans-{name}.min.css", binary=False)
        urls = re.findall(r"url\('(MiSans-[A-Za-z]+\.[^']+)'\)", css)

        def grab(fn):
            data = fetch(BASE + fn)
            with open(os.path.join(OUT, fn), "wb") as f:
                f.write(data)
            return len(data)

        with cf.ThreadPoolExecutor(max_workers=8) as ex:
            sizes = list(ex.map(grab, urls))
        total_files += len(urls)
        total_bytes += sum(sizes)
        print(f"  {name}: {len(urls)} 片, {sum(sizes)/1024/1024:.2f} MB")

        body = re.sub(r"/\*\[\d+\]\*/", "", css)
        body = re.sub(r"font-weight:(330|380|520|630)", f"font-weight:{weight}", body)
        body = re.sub(
            r"url\('(MiSans-[A-Za-z]+\.[^']+)'\)",
            lambda m: f"url('../fonts/{m.group(1)}')",
            body,
        )
        parts.append(f"\n/* ---------- {name} → font-weight: {weight} ---------- */\n")
        parts.append(body.replace(";}", "}\n"))

    with open(CSS, "w", encoding="utf-8") as f:
        f.write("".join(parts))

    print(f"共 {total_files} 个文件 / {total_bytes/1024/1024:.2f} MB → {OUT}")
    print(f"CSS 写入 {CSS}")


if __name__ == "__main__":
    sys.exit(main())
