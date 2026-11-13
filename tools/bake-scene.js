/* ==========================================================================
 *  把素材照片烘成网页背景：node tools/bake-scene.js [素材目录]
 * --------------------------------------------------------------------------
 *  素材是 Redmi K80 / MI 11 拍的手机照片，水印全在**底部**：
 *    左下 相机标（K80 带图标，MI 11 是纯文字）
 *    右下 时间戳
 *  高度约占画面 6~10%，随设备不同。
 *
 *  去水印走「裁掉」（方案 A）：直接切掉底部 12%，零痕迹、零算法。
 *  本机没有 PIL / numpy / cv2，.NET 的 System.Drawing 也被安全策略拦住，
 *  所以用已有的 playwright-core + canvas 做裁切与压缩 —— 这条路一定通。
 *
 *  为什么是 12%：水印最靠上的一张也在 90% 处，留 2% 余量。
 *  代价是底部一点路面/墙面被切掉，但背景本来就是 cover 铺满、只透出 12%，
 *  看不出来。
 *
 *  输出：assets/backdrop/scene-desktop.webp / scene-mobile.webp（WebP：同样画质约为 JPEG 的 6 成）
 *  用法：node tools/bake-scene.js            （素材在 ../_materials）
 *        node tools/bake-scene.js D:/素材    （指定别处）
 * ========================================================================== */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = process.argv[2] || path.resolve(ROOT, '../_materials');
const OUT_DIR = path.join(ROOT, 'assets/backdrop');

const CUT_BOTTOM = 0.12;   // 切掉底部 12%（水印带 + 余量）

const JOBS = [
  /* 桌面：巷子那张，生活/维修气质最贴，横向 4096×2304 */
  { src: '4B46386E1FB716DE67B301120CA5FFE0.jpg', dst: 'scene-desktop.webp', width: 1600, quality: 74 },
  /* 手机：黄昏停车场，原生 9:16 竖图 1440×2560 */
  { src: '396E569DA00C271700E5267676EA6EEA.jpg', dst: 'scene-mobile.webp', width: 900, quality: 74 }
];

(async () => {
  const browser = await chromium.launch();
  let okCount = 0;

  for (const job of JOBS) {
    const srcPath = path.join(SRC_DIR, job.src);
    if (!fs.existsSync(srcPath)) {
      console.log('跳过（找不到）', srcPath);
      continue;
    }
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto('file:///' + srcPath.replace(/\\/g, '/'));

    const dataUrl = await page.evaluate(async ({ cut, width, quality }) => {
      const img = document.querySelector('img');
      if (!img) throw new Error('no img');
      if (img.decode) { try { await img.decode(); } catch (e) {} }
      const sw = img.naturalWidth;
      const sh = Math.round(img.naturalHeight * (1 - cut));   // 只取上方 (1-cut)
      const scale = Math.min(1, width / sw);
      const tw = Math.round(sw * scale);
      const th = Math.round(sh * scale);
      const cv = document.createElement('canvas');
      cv.width = tw; cv.height = th;
      const cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, sw, sh, 0, 0, tw, th);
      return { url: cv.toDataURL('image/webp', quality), w: tw, h: th };
    }, { cut: CUT_BOTTOM, width: job.width, quality: job.quality });

    await page.close();

    const buf = Buffer.from(dataUrl.url.split(',')[1], 'base64');
    const outPath = path.join(OUT_DIR, job.dst);
    fs.writeFileSync(outPath, buf);
    console.log(job.src.slice(0, 8) + ' → ' + job.dst + '  ' + dataUrl.w + '×' + dataUrl.h +
      '  ' + Math.round(buf.length / 1024) + 'KB');
    okCount++;
  }

  await browser.close();
  console.log('\n完成 %d 张。裁掉底部 %d%%，输出在 assets/backdrop/。',
    okCount, Math.round(CUT_BOTTOM * 100));
  if (!okCount) process.exit(1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
