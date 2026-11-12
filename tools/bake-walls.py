#!/usr/bin/env python3
"""把两面封面墙烘焙成静态图（WebP），运行时只显示图片 + 循环平移。

为什么这么做：
  · 现在游戏墙 = 48 个 <img> + 6 个巨型合成层，专辑墙 = 144 个 <img> + 6 层；
  · 翻页时 Chromium 要为这些元素反复栅格化，长帧可达 97~126ms；
  · 烘焙后每面墙只剩 6 个「背景图 + transform」层，图片请求从 120 降到 12，
    解码次数、合成元素数、纹理数量都大幅下降，且画面与原来逐格一致。

输入：`.cache/wall-order.json`（由 tools/extract-wall-order.js 从运行页面导出）
输出：`assets/wall/steam-0..5.webp`、`assets/wall/album-0..5.webp`、`assets/wall/meta.json`

用法：
  node tools/extract-wall-order.js
  python tools/bake-walls.py
"""
import hashlib
import io
import json
import os
import sys
import urllib.request
from datetime import datetime

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDER = os.path.join(ROOT, '.cache', 'wall-order.json')
CACHE = os.path.join(ROOT, '.cache', 'covers')
OUT = os.path.join(ROOT, 'assets', 'wall')

STEAM_TILE = (300, 450)      # Steam library_600x900.jpg 的实际尺寸
ALBUM_TILE = (400, 400)      # 网易云 param=400y400
QUALITY = 82


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha1(url.encode('utf-8')).hexdigest() + '.img'
    path = os.path.join(CACHE, key)
    if os.path.isfile(path) and os.path.getsize(path) > 1024:
        return path
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
        'Referer': 'https://zottfoy.github.io/',
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    with open(path, 'wb') as f:
        f.write(data)
    return path


def cover(im, size):
    """等比缩放 + 居中裁切，等价 CSS object-fit: cover。"""
    tw, th = size
    w, h = im.size
    s = max(tw / w, th / h)
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return im.crop((left, top, left + tw, top + th))


def bake_columns(urls_list, tile, out_prefix, vertical=True):
    tw, th = tile
    made = []
    for i, urls in enumerate(urls_list):
        if not urls:
            raise RuntimeError('%s 第 %d 组为空' % (out_prefix, i))
        ims = [cover(Image.open(fetch(u)).convert('RGB'), tile) for u in urls]
        if vertical:
            canvas = Image.new('RGB', (tw, th * len(ims)))
            for k, im in enumerate(ims):
                canvas.paste(im, (0, k * th))
        else:
            canvas = Image.new('RGB', (tw * len(ims), th))
            for k, im in enumerate(ims):
                canvas.paste(im, (k * tw, 0))
        path = os.path.join(OUT, '%s-%d.webp' % (out_prefix, i))
        canvas.save(path, 'WEBP', quality=QUALITY, method=6)
        made.append({'file': '%s-%d.webp' % (out_prefix, i), 'w': canvas.width,
                     'h': canvas.height, 'bytes': os.path.getsize(path), 'sources': urls})
        print('  %-16s %4dx%-4d %6.1f KB' % (os.path.basename(path), canvas.width,
                                             canvas.height, os.path.getsize(path) / 1024))
    return made


def main():
    if not os.path.isfile(ORDER):
        sys.exit('缺少 %s，先运行 node tools/extract-wall-order.js' % ORDER)
    data = json.load(open(ORDER, encoding='utf-8'))
    os.makedirs(OUT, exist_ok=True)

    print('Steam 墙（6 列 × 4 格）')
    steam = bake_columns([[x['src'] for x in col] for col in data['steam']],
                         STEAM_TILE, 'steam', vertical=True)

    print('专辑墙（6 行 × 6 格）')
    album = bake_columns(data['album'], ALBUM_TILE, 'album', vertical=False)

    meta = {
        'generatedAt': datetime.now().isoformat(timespec='seconds'),
        'week': data.get('week'),
        'steam': {'tile': STEAM_TILE, 'files': steam},
        'album': {'tile': ALBUM_TILE, 'files': album},
    }
    with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    total = sum(x['bytes'] for x in steam + album)
    print('\n合计 %.1f KB / %d 张' % (total / 1024, len(steam) + len(album)))
    old_count = 48 + 72
    print('原来：%d 个 <img>、%d 个请求；现在：%d 个背景图、%d 个请求'
          % (old_count, old_count, len(steam) + len(album), len(steam) + len(album)))


if __name__ == '__main__':
    main()
