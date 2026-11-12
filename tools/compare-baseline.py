#!/usr/bin/env python3
"""对比 baseline/ 与 baseline/current/ 的截图差异。

用法：
  node tools/visual-baseline.js --check
  python tools/compare-baseline.py [容差百分比，默认 0.3]
"""
import os
import sys

from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'baseline')
CUR = os.path.join(BASE, 'current')
TOL = float(sys.argv[1]) if len(sys.argv) > 1 else 0.3


def main():
    if not os.path.isdir(CUR):
        sys.exit('缺少 baseline/current/，先跑 node tools/visual-baseline.js --check')
    names = sorted(f for f in os.listdir(BASE) if f.endswith('.png'))
    if not names:
        sys.exit('基线为空，先跑 --make')

    print('%-34s %8s  %s' % ('截图', '差异', '结论'))
    bad = 0
    for name in names:
        a_path = os.path.join(BASE, name)
        b_path = os.path.join(CUR, name)
        if not os.path.isfile(b_path):
            print('%-34s %8s  缺失' % (name, '-'))
            bad += 1
            continue
        a = Image.open(a_path).convert('RGB')
        b = Image.open(b_path).convert('RGB')
        if a.size != b.size:
            print('%-34s %8s  尺寸不同 %s vs %s' % (name, '-', a.size, b.size))
            bad += 1
            continue
        diff = ImageChops.difference(a, b)
        # 每个通道差 > 8 才算不同，压掉抗锯齿噪声
        mask = diff.convert('L').point(lambda v: 255 if v > 8 else 0)
        changed = sum(1 for p in mask.getdata() if p)
        pct = changed * 100.0 / (a.width * a.height)
        ok = pct <= TOL
        print('%-34s %7.3f%%  %s' % (name, pct, 'OK' if ok else '不一致'))
        if not ok:
            bad += 1

    print('\n共 %d 张，%d 张超出容差（%.2f%%）' % (len(names), bad, TOL))
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    main()
