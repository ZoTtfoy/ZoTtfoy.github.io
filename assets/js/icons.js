/* ==========================================================================
 *  内联 SVG 图标库（无外部请求、无字体依赖、离线可用）
 * --------------------------------------------------------------------------
 *  在 config.js 里填 icon 的名字即可，例如 icon: "music"。
 *
 *  通用线性图标：code, layers, palette, chart, terminal, sparkles, music,
 *    camera, coffee, gamepad, plane, book, film, headphones, compass, leaf,
 *    bicycle, pen, grid, shield, zap, bulb, quote, rss, globe, mail, link,
 *    external, map-pin, clock, heart, send, sun, moon, menu, close, copy,
 *    check, arrow-up, arrow-down, arrow-up-right, netease, qq, weibo,
 *    bilibili, zhihu, wechat, juejin, instagram
 *  品牌实心图标：github, x, linkedin, youtube, telegram, discord
 *
 *  想加新图标：照着下面格式加一行 'name': '<path ... />' 即可。
 * ========================================================================== */

window.SITE_ICONS = {
  /* ---- 工作 / 能力 ---- */
  code:      '<polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/><line x1="14" y1="5" x2="10" y2="19"/>',
  layers:    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/>',
  palette:   '<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h5a4 4 0 0 0 4-4 9 9 0 0 0-9-6z"/><circle cx="7.5" cy="11" r=".9"/><circle cx="10" cy="7.5" r=".9"/><circle cx="15" cy="7.5" r=".9"/>',
  chart:     '<line x1="3" y1="20" x2="21" y2="20"/><rect x="5" y="12" width="3.5" height="6" rx="1"/><rect x="10.2" y="8" width="3.5" height="10" rx="1"/><rect x="15.5" y="4" width="3.5" height="14" rx="1"/>',
  terminal:  '<rect x="3" y="4" width="18" height="16" rx="2.5"/><polyline points="7 9 10 12 7 15"/><line x1="13" y1="15" x2="17" y2="15"/>',
  sparkles:  '<path d="M11 3l1.6 4.4L17 9l-4.4 1.6L11 15l-1.6-4.4L5 9l4.4-1.6L11 3z"/><path d="M18 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"/>',
  pen:       '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><line x1="2" y1="2" x2="9.5" y2="9.5"/>',
  grid:      '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  shield:    '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3z"/><polyline points="9 12 11.5 14.5 15.5 10.5"/>',
  zap:       '<polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2"/>',
  bulb:      '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.8c.6.5.9 1.2.9 2h5.2c0-.8.3-1.5.9-2A6 6 0 0 0 12 3z"/>',
  quote:     '<path d="M9 7H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3"/><path d="M20 7h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3"/>',
  rss:       '<circle cx="6" cy="18" r="1.4" fill="currentColor" stroke="none"/><path d="M4 11a9 9 0 0 1 9 9M4 5a15 15 0 0 1 15 15"/>',

  /* ---- 生活 / 爱好 ---- */
  music:     '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  camera:    '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M8 6l1.3-2h5.4L16 6"/><circle cx="12" cy="13" r="3.5"/>',
  coffee:    '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"/><line x1="7" y1="3" x2="7" y2="5"/><line x1="11" y1="3" x2="11" y2="5"/><line x1="15" y1="3" x2="15" y2="5"/><line x1="3" y1="21" x2="18" y2="21"/>',
  gamepad:   '<line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6C2.6 9.4 2 14.5 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.4-1.4A2 2 0 0 1 9.8 16h4.4a2 2 0 0 1 1.4.6L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.5-.6-6.6-.7-7.4A4 4 0 0 0 17.3 5z"/>',
  plane:     '<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3z"/><path d="M10 13 21 3"/>',
  book:      '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z"/>',
  film:      '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7.5" y1="4" x2="7.5" y2="20"/><line x1="16.5" y1="4" x2="16.5" y2="20"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="8" x2="7.5" y2="8"/><line x1="3" y1="16" x2="7.5" y2="16"/><line x1="16.5" y1="8" x2="21" y2="8"/><line x1="16.5" y1="16" x2="21" y2="16"/>',
  headphones:'<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2.5" y="14" width="4" height="6" rx="2"/><rect x="17.5" y="14" width="4" height="6" rx="2"/>',
  compass:   '<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 10.5 10.5 8.5 15.5 13.5 13.5 15.5 8.5"/>',
  leaf:      '<path d="M20 4C10 4 4 9 4 16a4 4 0 0 0 4 4c7 0 12-6 12-16z"/><path d="M4 20c3-5 7-8 12-10"/>',
  bicycle:   '<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-8h4l4 8M10 9l-1-3H7m7 3 2-3"/>',
  heart:     '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21l8.8-8.3a5 5 0 0 0 0-7.1z"/>',

  /* ---- 通用 ---- */
  globe:     '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
  mail:      '<rect x="3" y="5" width="18" height="14" rx="2.5"/><polyline points="3.5 7 12 13 20.5 7"/>',
  link:      '<path d="M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11 6.3"/><path d="M14 11a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.6-1.6"/>',
  external:  '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  "map-pin": '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  clock:     '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  send:      '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3z"/>',
  sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  pause:     '<rect x="7" y="5" width="3.4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',

  /* ---- 游戏 ---- */
  crosshair: '<circle cx="12" cy="12" r="7.5"/><line x1="12" y1="2.5" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21.5" y2="12"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  target:    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  tower:     '<path d="M6 21V10l3-2V4h2v3h2V4h2v3l3 2v11z"/><line x1="4" y1="21" x2="20" y2="21"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
  note:      '<path d="M12 3v11"/><circle cx="9.4" cy="16.2" r="2.6"/><path d="M12 3l7 2.4v4.2L12 7.2"/>',
  disc:      '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17" opacity=".45"/>',
  moon:      '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  menu:      '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/>',
  close:     '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  copy:      '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"/>',
  check:     '<polyline points="4 12 9 17 20 6"/>',
  "arrow-up":       '<line x1="12" y1="20" x2="12" y2="4"/><polyline points="6 10 12 4 18 10"/>',
  "arrow-down":     '<line x1="12" y1="4" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/>',
  "arrow-up-right": '<path d="M7 17 17 7"/><polyline points="8 7 17 7 17 16"/>',

  /* ---- 中文平台 ---- */
  netease:   '<circle cx="12" cy="12" r="9"/><path d="M15.2 7.9v6.6"/><circle cx="12.5" cy="14.9" r="2.7"/><path d="M15.2 7.9c.9.3 1.6 1 1.9 1.9"/>',
  qq:        '<ellipse cx="12" cy="12.6" rx="6.6" ry="7.4"/><circle cx="9.6" cy="10.2" r="1" fill="currentColor" stroke="none"/><circle cx="14.4" cy="10.2" r="1" fill="currentColor" stroke="none"/><path d="M10 15.4c.7.6 3.3.6 4 0M6.6 18.9c-.6 1-.3 1.9.5 1.9.7 0 1.3-.6 1.7-1.4M17.4 18.9c.6 1 .3 1.9-.5 1.9-.7 0-1.3-.6-1.7-1.4"/>',
  weibo:     '<path d="M4.5 13.5c0 3.6 3.8 6.5 8.5 6.5s8.5-2.9 8.5-6.5-3.8-6.5-8.5-6.5-8.5 2.9-8.5 6.5z"/><path d="M9 12.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0z"/><path d="M16 5.5a5 5 0 0 1 3.5 4.5M17.5 3a8 8 0 0 1 4 6.5"/>',
  bilibili:  '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M7 6 9 3M17 6l-2-3"/><path d="M8.5 11.5v2.5M15.5 11.5v2.5"/><path d="M10 16.5c1.2.8 2.8.8 4 0"/>',
  zhihu:     '<path d="M20 11.5a8 8 0 0 1-8 8H5l-2 2v-10a8 8 0 0 1 8-8h1a8 8 0 0 1 8 8z"/><path d="M8.5 9h7M8.5 13h4"/>',
  wechat:    '<path d="M9 4C5.1 4 2 6.6 2 9.7c0 1.8 1 3.4 2.6 4.4L4 17l2.7-1.4c.7.2 1.5.3 2.3.3h.6"/><circle cx="6.5" cy="9" r=".7" fill="currentColor" stroke="none"/><circle cx="11" cy="9" r=".7" fill="currentColor" stroke="none"/><path d="M22 15.2c0-2.6-2.6-4.8-5.8-4.8s-5.8 2.2-5.8 4.8 2.6 4.8 5.8 4.8c.7 0 1.4-.1 2-.3L20 21l-.5-2.2c1.5-.9 2.5-2.1 2.5-3.4z"/><circle cx="14.5" cy="14.5" r=".6" fill="currentColor" stroke="none"/><circle cx="18" cy="14.5" r=".6" fill="currentColor" stroke="none"/>',
  juejin:    '<path d="M12 3 3 7.5 12 12l9-4.5L12 3z"/><path d="M3 12.5 12 17l9-4.5M3 17 12 21.5 21 17"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".9" fill="currentColor" stroke="none"/>',

  /* ---- 品牌实心 ---- */
  github:    '<path fill="currentColor" stroke="none" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.01c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.72 0-1.26.45-2.3 1.19-3.11-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.85 1.18 3.11 0 4.44-2.7 5.42-5.28 5.71.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/>',
  x:         '<path fill="currentColor" stroke="none" d="M18.9 2H22l-6.78 7.75L23.2 22h-6.9l-4.6-6.02L6.3 22H3.2l7.25-8.29L2.8 2h7.07l4.16 5.5L18.9 2zm-1.2 18h1.72L7.4 3.9H5.55L17.7 20z"/>',
  linkedin:  '<path fill="currentColor" stroke="none" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/>',
  youtube:   '<path fill="currentColor" stroke="none" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/>',
  telegram:  '<path fill="currentColor" stroke="none" d="M21.9 3.3 18.6 20c-.2 1-.8 1.3-1.7.8l-4.6-3.4-2.2 2.1c-.2.2-.5.5-.9.5l.3-4.6 8.4-7.6c.4-.3-.1-.5-.6-.2L7.1 13.4l-4.5-1.4c-1-.3-1-1 .2-1.5L20.4 2.6c.8-.3 1.6.2 1.5.7z"/>',
  discord:   '<path fill="currentColor" stroke="none" d="M20.3 4.4A19 19 0 0 0 15.6 3l-.3.6a14 14 0 0 1 4.1 1.3 17 17 0 0 0-14.8 0A14 14 0 0 1 8.7 3.6L8.4 3a19 19 0 0 0-4.7 1.4C.8 8.6 0 12.7.4 16.7a19 19 0 0 0 5.8 2.9l1.2-2a12 12 0 0 1-2-1l.5-.4a13.6 13.6 0 0 0 11.6 0l.5.4a12 12 0 0 1-2 1l1.2 2a19 19 0 0 0 5.8-2.9c.5-4.6-.7-8.6-2.7-12.3zM8.3 14.4c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3zm7.4 0c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3z"/>'
};

/* 返回一个可直接插入 HTML 的 <svg> 字符串 */
window.siteIcon = function (name, extraClass) {
  var body = window.SITE_ICONS[name] || window.SITE_ICONS.sparkles;
  return '<svg class="icon' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 24 24" ' +
         'fill="none" stroke="currentColor" stroke-width="1.6" ' +
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
         body + '</svg>';
};
