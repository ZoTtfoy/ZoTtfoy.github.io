/* 找出「在 DOM 里一个都匹配不到」的 CSS 选择器。
   用法：node tools/find-dead-css.js [站点URL]
   说明：
     · 遍历所有样式表规则（含 @media / @supports 内部），拿 selectorText；
     · 剥离 :hover / ::before 这类伪类伪元素后，用 querySelector 测；
     · 会先把每一屏都切一遍，触发 JS 渲染，避免把动态生成的元素误判成死代码。
   输出的是**候选**：状态类（.is-*）和主题态可能暂时无命中，需要人工判断。
*/
const { chromium } = require('playwright-core');

const SITE = process.argv[2] || 'http://127.0.0.1:8791/';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(SITE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);

  // 每屏切一遍，让 JS 把动态内容都渲染出来
  const n = await page.evaluate(() => window.SITE_PAGED.pages().length);
  for (let i = 0; i < n; i++) {
    await page.evaluate((i) => window.SITE_PAGED.goTo(i), i);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    const out = [];
    const seen = new Set();

    function clean(sel) {
      return sel
        .replace(/::?(before|after|placeholder|selection|first-line|first-letter|marker|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)\b(\([^)]*\))?/g, '')
        .replace(/:(hover|focus|focus-visible|focus-within|active|visited|link|target|checked|disabled|enabled|first-child|last-child|only-child|nth-child\([^)]*\)|nth-of-type\([^)]*\)|not\([^)]*\)|has\([^)]*\)|is\([^)]*\)|where\([^)]*\))\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function walk(rules, sheet) {
      for (const r of rules) {
        if (r.type === CSSRule.STYLE_RULE) {
          const sel = r.selectorText;
          if (!sel) continue;
          sel.split(',').forEach((one) => {
            const s = one.trim();
            if (!s || seen.has(s)) return;
            seen.add(s);
            const probe = clean(s);
            if (!probe) return;
            let hit = 0;
            try { hit = document.querySelectorAll(probe).length; } catch (e) { return; }
            if (hit === 0) {
              out.push({
                sel: s,
                probe,
                file: (sheet.href || '').split('/').pop() || 'inline',
                line: (sheet.href ? '' : '')
              });
            }
          });
        } else if (r.cssRules) {
          walk(r.cssRules, sheet);
        }
      }
    }

    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      if (rules) walk(rules, sheet);
    }
    return out;
  });

  const byFile = {};
  result.forEach(x => { (byFile[x.file] = byFile[x.file] || []).push(x.sel); });
  Object.keys(byFile).sort().forEach(f => {
    console.log('\n### ' + f + '  (' + byFile[f].length + ')');
    byFile[f].forEach(s => console.log('  ' + s));
  });
  console.log('\n合计候选: ' + result.length + ' 条');
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
