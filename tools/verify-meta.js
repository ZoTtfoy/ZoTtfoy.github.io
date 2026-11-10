/* ==========================================================================
 *  分享标签与跳转可达性验证：node tools/verify-meta.js [URL]
 * --------------------------------------------------------------------------
 *  守两件"看不见但一坏就很尴尬"的事：
 *
 *  一、社交分享卡（Open Graph / Twitter Card）
 *     坏掉的表现不是页面报错，而是别人把链接发到微信 / TG / X 时
 *     只显示一行灰字、没有图。这种事只有分享出去才会发现，
 *     所以必须自动断言：标签齐不齐、图是不是位图、是不是绝对地址、
 *     文件真的存在且尺寸合规。
 *
 *     ⚠️ 三条硬性要求，缺一条就退化：
 *        · og:image 必须是**位图**（PNG/JPG）—— 微信、TG 的抓取器不渲染 SVG
 *        · 必须是**绝对 URL** —— 相对路径在部分平台解析失败
 *        · 尺寸接近 1200×630 —— 小于 600×315 会被裁成小图
 *
 *  二、「跳到主要内容」是否真的跳到了
 *     坏掉的表现是"按了没反应"：视口滚了，但焦点还在原来的链接上，
 *     再按 Tab 就回到页头第一个链接，等于没跳。
 *     断言方式：Tab 一次应落在 skip-link，Enter 后焦点应在 main 上。
 *
 *  依赖：playwright-core + 本地 chromium
 *  可以指到线上跑：node tools/verify-meta.js https://zottfoy.github.io/
 * ========================================================================== */
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(SITE);
const notes = [], fails = [];
const ok = (c, m) => c ? notes.push('OK  ' + m) : fails.push(m);

/* OG 图的推荐尺寸（社交平台通用的 1.91:1） */
const OG_W = 1200, OG_H = 630;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/v1.hitokoto.cn/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ hitokoto: '把复杂的东西，做得简单一点。', from: '测试' })
  }));
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  /* ------------------------------------------ 1. 基础 SEO 与分享标签齐全 */
  const meta = await page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.getAttribute('content') || '').trim() : null;
    };
    return {
      title: document.title,
      desc: g('meta[name="description"]'),
      canonical: (document.querySelector('link[rel="canonical"]') || {}).href || null,
      ogType: g('meta[property="og:type"]'),
      ogSite: g('meta[property="og:site_name"]'),
      ogTitle: g('meta[property="og:title"]'),
      ogDesc: g('meta[property="og:description"]'),
      ogUrl: g('meta[property="og:url"]'),
      ogImg: g('meta[property="og:image"]'),
      ogImgW: g('meta[property="og:image:width"]'),
      ogImgH: g('meta[property="og:image:height"]'),
      ogImgType: g('meta[property="og:image:type"]'),
      ogLocale: g('meta[property="og:locale"]'),
      twCard: g('meta[name="twitter:card"]'),
      twTitle: g('meta[name="twitter:title"]'),
      twDesc: g('meta[name="twitter:description"]'),
      twImg: g('meta[name="twitter:image"]'),
      colorScheme: g('meta[name="color-scheme"]'),
      viewport: g('meta[name="viewport"]'),
      lang: document.documentElement.lang
    };
  });

  ok(!!meta.title && meta.title.length > 3, '有 document.title（' + meta.title + '）');
  ok(!!meta.desc && meta.desc.length > 20, '有 meta description');
  ok(meta.lang === 'zh-CN', '<html lang> 是 zh-CN（读屏选中正确语音）');
  ok(/width=device-width/.test(meta.viewport || ''), 'viewport 声明了 device-width');
  ok(/light/.test(meta.colorScheme || '') && /dark/.test(meta.colorScheme || ''),
    'color-scheme 同时声明 light/dark');

  ok(meta.ogType === 'website', 'og:type = website');
  ok(!!meta.ogSite, 'og:site_name 存在');
  ok(!!meta.ogTitle, 'og:title 存在');
  ok(!!meta.ogDesc && meta.ogDesc.length > 20, 'og:description 存在且不是一句话带过');
  ok(!!meta.ogUrl && /^https:\/\//.test(meta.ogUrl),
    'og:url 是绝对地址（' + meta.ogUrl + '）');
  ok(!!meta.ogLocale, 'og:locale 存在（中文站点应为 zh_CN）');

  /* 图的三条硬性要求 */
  ok(!!meta.ogImg && /^https:\/\//.test(meta.ogImg),
    'og:image 是绝对地址（' + meta.ogImg + '）');
  ok(/\.(png|jpe?g|webp)$/i.test(meta.ogImg || ''),
    'og:image 是位图（微信 / TG 不渲染 SVG）');
  ok(String(meta.ogImgW) === String(OG_W) && String(meta.ogImgH) === String(OG_H),
    'og:image 声明了 ' + OG_W + '×' + OG_H + '（实际 ' + meta.ogImgW + '×' + meta.ogImgH + '）');
  ok(meta.ogImgType === 'image/png' || meta.ogImgType === 'image/jpeg',
    'og:image:type 声明了真实 MIME');

  ok(meta.twCard === 'summary_large_image',
    'twitter:card = summary_large_image（大图版式）');
  ok(!!meta.twTitle && !!meta.twDesc && !!meta.twImg,
    'twitter:* 三件套齐全（缺了会退化成小卡片）');

  /* ----------------------------------- 2. 分享图真的存在、尺寸与声明一致 */
  /* 本地用相对路径读文件，线上用一次 HEAD 请求 */
  const imgUrl = meta.ogImg || '';
  const imgPath = imgUrl.replace(/^https?:\/\/[^/]+\//, '');
  if (IS_LOCAL) {
    const abs = path.resolve(process.cwd(), imgPath);
    const exists = fs.existsSync(abs);
    ok(exists, 'og:image 文件存在（' + imgPath + '）');
    if (exists) {
      const buf = fs.readFileSync(abs);
      const isPng = buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      ok(isPng, '分享图真的是 PNG（不是改了扩展名的其他格式）');
      if (isPng) {
        const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
        ok(w === OG_W && h === OG_H,
          '分享图实际尺寸 ' + w + '×' + h + ' = 声明的尺寸');
      }
      ok(buf.length < 5 * 1024 * 1024,
        '分享图体积 ' + Math.round(buf.length / 1024) + 'KB（< 5MB，微信不限流）');
    }
  } else {
    const head = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { method: 'HEAD' });
        return { ok: r.ok, status: r.status, type: r.headers.get('content-type') };
      } catch (e) { return { ok: false, err: String(e) }; }
    }, imgUrl);
    ok(head.ok, '线上分享图可访问（HTTP ' + head.status + '）');
    ok(/image\//.test(head.type || ''), '线上分享图 Content-Type 是图片（' + head.type + '）');
  }

  /* -------------------------------- 3. 「跳到主要内容」真的把焦点带过去 */
  /* 必须重新加载：浏览器的"顺序聚焦起点"会记住上次点击的位置，
     前面若点过页面中部的元素，Tab 就从那里往下走，轮不到页首。 */
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(1900);

  ok(await page.locator('.skip-link').count() === 1, '页首有「跳到主要内容」链接');
  const skipVisible = await page.locator('.skip-link').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height) };
  });
  ok(skipVisible.top < 0, '未聚焦时 skip-link 藏在视口上方（不占版面）');

  await page.keyboard.press('Tab');
  const f1 = await page.evaluate(() => ({
    cls: typeof document.activeElement.className === 'string' ? document.activeElement.className : '',
    tag: document.activeElement.tagName
  }));
  ok(/skip-link/.test(f1.cls), '第一次 Tab 落在 skip-link（' + f1.tag + '.' + f1.cls + '）');

  /* 滑入是 transform 过渡（--t-fast = 220ms），等它走完再量 ——
     否则量到的是动画中途的位置，会误判成"没滑出来"。 */
  await page.waitForTimeout(320);
  const afterFocus = await page.locator('.skip-link').evaluate(el => {
    return Math.round(el.getBoundingClientRect().top);
  });
  ok(afterFocus >= 0, '聚焦后 skip-link 滑入视口（可见）');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const f2 = await page.evaluate(() => ({
    id: document.activeElement.id,
    tag: document.activeElement.tagName
  }));
  ok(f2.id === 'main', '按 Enter 后焦点落在 <main> 上（实际 ' + f2.tag + '#' + (f2.id || '-') + '）');

  /* main 可聚焦的前提是有 tabindex，这条守住"别把 tabindex 删了" */
  const mainTab = await page.locator('#main').getAttribute('tabindex');
  ok(mainTab === '-1', '<main> 带 tabindex="-1"（否则焦点落不下来）');

  /* 键盘焦点框：Tab 到交互元素时必须有可见 outline */
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const c = getComputedStyle(el);
    return { w: c.outlineWidth, style: c.outlineStyle, color: c.outlineColor };
  });
  ok(outline && outline.style !== 'none' && parseFloat(outline.w) >= 1,
    '键盘焦点有可见轮廓（' + (outline ? outline.w + ' ' + outline.style : '-') + '）');

  /* -------------------------------------- 4. 平滑滚动与减少动效的取舍 */
  ok(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior) === 'smooth',
    '默认开启平滑滚动');

  await ctx.close();

  /* 减少动效环境：应当关掉平滑滚动 */
  const ctx2 = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce'
  });
  const p2 = await ctx2.newPage();
  await p2.route('**/v1.hitokoto.cn/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"hitokoto":"x","from":"x"}'
  }));
  await p2.goto(SITE, { waitUntil: 'load' });
  await p2.waitForTimeout(1200);
  ok(await p2.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior) === 'auto',
    '系统要求减少动效时关掉平滑滚动');
  await ctx2.close();

  ok(errs.length === 0, '没有 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  await browser.close();

  notes.forEach(n => console.log(n));
  if (fails.length) { console.log('\n失败明细:'); fails.forEach(f => console.log('· ' + f)); }
  console.log('\n检查项: ' + (notes.length + fails.length) + '，失败: ' + fails.length);
  console.log(fails.length ? '\n有问题' : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})();
