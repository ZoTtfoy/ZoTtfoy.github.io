/* ==========================================================================
 *  视觉基线像素对比：node tools/compare-baseline.js
 * --------------------------------------------------------------------------
 *  对比 baseline/<name>.png（基准）与 baseline/current/<name>.png（本次截图）。
 *  判定口径与旧版 Python 脚本一致：
 *    · 单像素通道差 > 8 才算「差异像素」
 *    · 差异像素占比 ≤ 0.30% 判 OK
 *
 *  为什么从 Python + PIL 换成 Node + Chromium：
 *    这台机器的 Python 环境里 Pillow 装不上（镜像无 3.13 wheel），
 *    `import PIL` 直接失败 —— 而失败被 `2>/dev/null` 吞掉时，
 *    「基线 12/12 通过」会变成一句没有依据的假话（踩过）。
 *    改用已经有的 playwright-core：把两张图丢进 canvas 逐像素比，
 *    零额外依赖，和其它工具同一条工具链，环境再变也不会静默失效。
 *
 *  用法：
 *    node tools/visual-baseline.js --make    # 生成基准
 *    node tools/visual-baseline.js --check   # 生成 current
 *    node tools/compare-baseline.js          # 对比并给结论
 * ========================================================================== */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'baseline');
const CUR = path.join(BASE, 'current');

const THRESHOLD = 8;      // 单通道差阈值（0~255）
const TOLERANCE = 0.30;   // 允许的差异像素占比（%）

function toDataUrl(file) {
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
}

async function diffPair(page, baseFile, curFile) {
  return page.evaluate(async ({ a, b, threshold }) => {
    const load = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('decode failed'));
      img.src = src;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) {
      return {
        error: 'size',
        a: ia.naturalWidth + '×' + ia.naturalHeight,
        b: ib.naturalWidth + '×' + ib.naturalHeight
      };
    }
    const w = ia.naturalWidth, h = ia.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(ia, 0, 0);
    const da = cx.getImageData(0, 0, w, h).data;
    cx.clearRect(0, 0, w, h);
    cx.drawImage(ib, 0, 0);
    const db = cx.getImageData(0, 0, w, h).data;

    let bad = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) > threshold ||
          Math.abs(da[i + 1] - db[i + 1]) > threshold ||
          Math.abs(da[i + 2] - db[i + 2]) > threshold) bad++;
    }
    return { bad, total: w * h, pct: bad * 100 / (w * h), w, h };
  }, { a: baseFile, b: curFile, threshold: THRESHOLD });
}

(async () => {
  if (!fs.existsSync(CUR)) {
    console.error('没有 baseline/current —— 先跑 node tools/visual-baseline.js --check');
    process.exit(2);
  }
  const names = fs.readdirSync(CUR).filter(n => n.endsWith('.png')).sort();
  if (!names.length) {
    console.error('baseline/current 里没有 png');
    process.exit(2);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');

  const rows = [];
  for (const name of names) {
    const baseFile = path.join(BASE, name);
    if (!fs.existsSync(baseFile)) {
      rows.push({ name, error: '缺基准' });
      continue;
    }
    const r = await diffPair(page, toDataUrl(baseFile), toDataUrl(path.join(CUR, name)));
    rows.push(Object.assign({ name }, r));
  }
  await browser.close();

  const pad = (s, n) => {
    let w = 0;
    for (const ch of s) w += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
    return s + ' '.repeat(Math.max(0, n - w));
  };

  let failed = 0;
  for (const r of rows) {
    if (r.error === 'size') {
      console.log(pad(r.name, 32) + '  尺寸不同 ' + r.a + ' vs ' + r.b + '   FAIL');
      failed++;
    } else if (r.error) {
      console.log(pad(r.name, 32) + '  ' + r.error + '   FAIL');
      failed++;
    } else {
      const pass = r.pct <= TOLERANCE;
      if (!pass) failed++;
      console.log(pad(r.name, 32) + (r.pct.toFixed(3) + '%').padStart(9) + '   ' + (pass ? 'OK' : 'FAIL'));
    }
  }

  console.log('\n共 ' + rows.length + ' 张，' + failed + ' 张超出容差（' + TOLERANCE.toFixed(2) + '%）');
  if (failed) {
    console.log('提示：先确认 baseline/*.png 是「改动前」的基准；');
    console.log('      如果这次改动本来就要改视觉，用 --make 重建后再 --check 自检。');
    process.exit(1);
  }
  console.log('全部通过');
})().catch(e => { console.error('ERR', e); process.exit(1); });
