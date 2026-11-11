/* ==========================================================================
 *  themes.js —— 主题注册表（唯一的真相来源）
 * --------------------------------------------------------------------------
 *  ▸ 风格（skin）与明暗（light / dark）是两个独立维度，可以任意组合：
 *      7 套风格 × 2 种明暗 = 14 种效果。
 *  ▸ 新增一套风格：照着 ink 的格式往 list 里加一个对象即可，
 *    页面上的主题面板、内容编辑器的「外观」页都会自动出现它，不需要改别处。
 *  ▸ 每套主题必须把 base / light / dark 的键写全（自检脚本会逐项比对），
 *    漏了就会串色——node tools/verify-theme.js 会精确报出缺哪个键。
 *
 *  变量分三层：
 *    base  → 与明暗无关的形态：字体、圆角、边框粗细
 *    light → 浅色下的配色
 *    dark  → 深色下的配色
 * ========================================================================== */

window.SITE_THEMES = {
  version: 1,
  defaultSkin: "ink",

  list: [
    /* ---------------------------------------------------------------- 1 墨 */
    {
      id: "ink",
      name: "墨",
      desc: "黑白灰配一点墨绿。克制、中性，怎么用都不会出错。",
      swatch: ["#fbfbf9", "#17191b", "#2f6b5b"],
      base: {
        "font-sans": '"MiSans", "MiSans VF", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
        "font-display": '"MiSans", "MiSans VF", "Inter", -apple-system, "PingFang SC", sans-serif',
        "font-mono": '"MiSans", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        "r-sm": "10px", "r-md": "16px", "r-lg": "22px",
        "tracking-title": "-.035em",
        "border-w": "1px"
      },
      light: {
        "bg": "#fbfbf9", "bg-elev": "#ffffff", "bg-soft": "#f2f2ee",
        "text": "#17191b", "text-2": "#565c61", "text-3": "#81868b",
        "line": "rgba(23,25,27,.10)", "line-strong": "rgba(23,25,27,.18)",
        "accent": "#2f6b5b", "accent-fg": "#ffffff", "accent-soft": "rgba(47,107,91,.09)",
        "glow-a": "rgba(47,107,91,.20)", "glow-b": "rgba(216,161,110,.18)",
        "shadow-sm": "0 1px 2px rgba(20,25,23,.04), 0 4px 16px rgba(20,25,23,.045)",
        "shadow-md": "0 2px 6px rgba(20,25,23,.05), 0 18px 48px rgba(20,25,23,.09)",
        "header-bg": "rgba(251,251,249,.72)",
        "toast-bg": "#17191b", "toast-fg": "#ffffff",
        "grain-opacity": ".16"
      },
      dark: {
        "bg": "#0e1011", "bg-elev": "#171a1c", "bg-soft": "#1c2022",
        "text": "#f1f3f1", "text-2": "#a8afb2", "text-3": "#767e82",
        "line": "rgba(255,255,255,.10)", "line-strong": "rgba(255,255,255,.20)",
        "accent": "#84cbb2", "accent-fg": "#0e1011", "accent-soft": "rgba(132,203,178,.11)",
        "glow-a": "rgba(74,150,124,.16)", "glow-b": "rgba(190,130,90,.11)",
        "shadow-sm": "0 1px 2px rgba(0,0,0,.30), 0 4px 16px rgba(0,0,0,.20)",
        "shadow-md": "0 2px 6px rgba(0,0,0,.25), 0 18px 48px rgba(0,0,0,.35)",
        "header-bg": "rgba(14,16,17,.72)",
        "toast-bg": "#f1f3f1", "toast-fg": "#17191b",
        "grain-opacity": ".07"
      }
    },

    /* -------------------------------------------------------------- 2 纸本 */
    {
      id: "paper",
      name: "纸本",
      desc: "暖米纸色、宋体标题、直角边框。像一本摊开的书。",
      swatch: ["#f6f1e6", "#241f18", "#9a6b3f"],
      base: {
        "font-sans": '"MiSans", "MiSans VF", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
        "font-display": '"MiSans", "MiSans VF", "Inter", -apple-system, "PingFang SC", sans-serif',
        "font-mono": '"MiSans", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        "r-sm": "2px", "r-md": "3px", "r-lg": "4px",
        "tracking-title": "-.015em",
        "border-w": "1px"
      },
      light: {
        "bg": "#f6f1e6", "bg-elev": "#fdfaf2", "bg-soft": "#efe8d9",
        "text": "#241f18", "text-2": "#5d5343", "text-3": "#8a7f68",
        "line": "rgba(36,31,24,.15)", "line-strong": "rgba(36,31,24,.28)",
        "accent": "#9a6b3f", "accent-fg": "#ffffff", "accent-soft": "rgba(154,107,63,.11)",
        "glow-a": "rgba(154,107,63,.16)", "glow-b": "rgba(196,164,110,.22)",
        "shadow-sm": "0 1px 0 rgba(36,31,24,.05), 0 3px 12px rgba(90,70,40,.06)",
        "shadow-md": "0 2px 0 rgba(36,31,24,.05), 0 16px 40px rgba(90,70,40,.10)",
        "header-bg": "rgba(246,241,230,.82)",
        "toast-bg": "#241f18", "toast-fg": "#fdfaf2",
        "grain-opacity": ".22"
      },
      dark: {
        "bg": "#191510", "bg-elev": "#221d16", "bg-soft": "#2a241b",
        "text": "#f2e9d8", "text-2": "#bfb09a", "text-3": "#8d7f6b",
        "line": "rgba(242,233,216,.14)", "line-strong": "rgba(242,233,216,.26)",
        "accent": "#d3a06a", "accent-fg": "#191510", "accent-soft": "rgba(211,160,106,.13)",
        "glow-a": "rgba(211,160,106,.15)", "glow-b": "rgba(140,110,70,.16)",
        "shadow-sm": "0 1px 2px rgba(0,0,0,.35), 0 4px 14px rgba(0,0,0,.25)",
        "shadow-md": "0 2px 6px rgba(0,0,0,.30), 0 18px 44px rgba(0,0,0,.40)",
        "header-bg": "rgba(25,21,16,.82)",
        "toast-bg": "#f2e9d8", "toast-fg": "#191510",
        "grain-opacity": ".09"
      }
    },

    /* -------------------------------------------------------------- 3 夜幕 */
    {
      id: "noir",
      name: "夜幕",
      desc: "高对比黑白配一抹暗红。硬朗、像时尚杂志内页。",
      swatch: ["#f5f5f6", "#0b0b0c", "#b03a2e"],
      base: {
        "font-sans": '"MiSans", "MiSans VF", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
        "font-display": '"MiSans", "MiSans VF", "Inter", -apple-system, "PingFang SC", sans-serif',
        "font-mono": '"MiSans", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        "r-sm": "3px", "r-md": "5px", "r-lg": "7px",
        "tracking-title": "-.045em",
        "border-w": "1px"
      },
      light: {
        "bg": "#f5f5f6", "bg-elev": "#ffffff", "bg-soft": "#ebebed",
        "text": "#0b0b0c", "text-2": "#52525b", "text-3": "#818189",
        "line": "rgba(11,11,12,.09)", "line-strong": "rgba(11,11,12,.18)",
        "accent": "#b03a2e", "accent-fg": "#ffffff", "accent-soft": "rgba(176,58,46,.08)",
        "glow-a": "rgba(176,58,46,.10)", "glow-b": "rgba(60,60,70,.09)",
        "shadow-sm": "0 1px 2px rgba(0,0,0,.05), 0 6px 18px rgba(0,0,0,.05)",
        "shadow-md": "0 2px 6px rgba(0,0,0,.06), 0 22px 52px rgba(0,0,0,.11)",
        "header-bg": "rgba(245,245,246,.76)",
        "toast-bg": "#0b0b0c", "toast-fg": "#ffffff",
        "grain-opacity": ".10"
      },
      dark: {
        "bg": "#080809", "bg-elev": "#121214", "bg-soft": "#1a1a1d",
        "text": "#fafafa", "text-2": "#a1a1aa", "text-3": "#71717a",
        "line": "rgba(255,255,255,.09)", "line-strong": "rgba(255,255,255,.19)",
        "accent": "#e05545", "accent-fg": "#080809", "accent-soft": "rgba(224,85,69,.14)",
        "glow-a": "rgba(224,85,69,.17)", "glow-b": "rgba(80,80,95,.14)",
        "shadow-sm": "0 1px 2px rgba(0,0,0,.5), 0 6px 20px rgba(0,0,0,.35)",
        "shadow-md": "0 2px 8px rgba(0,0,0,.45), 0 24px 60px rgba(0,0,0,.55)",
        "header-bg": "rgba(8,8,9,.76)",
        "toast-bg": "#fafafa", "toast-fg": "#080809",
        "grain-opacity": ".05"
      }
    },

    /* -------------------------------------------------------------- 4 极光 */
    {
      id: "aurora",
      name: "极光",
      desc: "青与紫的渐变光晕，大圆角、柔和发光。偏未来感。",
      swatch: ["#f3f7f9", "#101b21", "#4fd0d8"],
      base: {
        "font-sans": '"MiSans", "MiSans VF", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
        "font-display": '"MiSans", "MiSans VF", "Inter", -apple-system, "PingFang SC", sans-serif',
        "font-mono": '"MiSans", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        "r-sm": "14px", "r-md": "22px", "r-lg": "30px",
        "tracking-title": "-.03em",
        "border-w": "1px"
      },
      light: {
        "bg": "#f3f7f9", "bg-elev": "#ffffff", "bg-soft": "#e9eff3",
        "text": "#101b21", "text-2": "#4d6070", "text-3": "#758490",
        "line": "rgba(16,27,33,.10)", "line-strong": "rgba(16,27,33,.18)",
        "accent": "#1f7f92", "accent-fg": "#ffffff", "accent-soft": "rgba(31,127,146,.10)",
        "glow-a": "rgba(64,180,190,.24)", "glow-b": "rgba(150,120,220,.22)",
        "shadow-sm": "0 1px 2px rgba(20,60,70,.05), 0 8px 24px rgba(20,60,70,.06)",
        "shadow-md": "0 2px 8px rgba(20,60,70,.06), 0 24px 60px rgba(20,60,70,.12)",
        "header-bg": "rgba(243,247,249,.70)",
        "toast-bg": "#101b21", "toast-fg": "#ffffff",
        "grain-opacity": ".12"
      },
      dark: {
        "bg": "#070c10", "bg-elev": "#0f171d", "bg-soft": "#152028",
        "text": "#e8f4f6", "text-2": "#93aab6", "text-3": "#66808d",
        "line": "rgba(232,244,246,.10)", "line-strong": "rgba(232,244,246,.21)",
        "accent": "#4fd0d8", "accent-fg": "#070c10", "accent-soft": "rgba(79,208,216,.14)",
        "glow-a": "rgba(60,200,215,.22)", "glow-b": "rgba(150,110,235,.20)",
        "shadow-sm": "0 1px 2px rgba(0,0,0,.4), 0 8px 26px rgba(0,20,30,.35)",
        "shadow-md": "0 2px 8px rgba(0,0,0,.4), 0 26px 64px rgba(0,20,30,.55)",
        "header-bg": "rgba(7,12,16,.70)",
        "toast-bg": "#e8f4f6", "toast-fg": "#070c10",
        "grain-opacity": ".06"
      }
    },

    /* ------------------------------------------------------------ 5 终端 */
    {
      id: "terminal",
      name: "终端",
      desc: "磷光绿字、全站等宽、直角边框。给爱看命令行的人。",
      swatch: ["#f1f6f1", "#0c1f11", "#3ddc84"],
      base: {
        "font-sans": '"MiSans", "MiSans VF", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
        "font-display": '"MiSans", "MiSans VF", "Inter", -apple-system, "PingFang SC", sans-serif',
        "font-mono": 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        "r-sm": "0px", "r-md": "2px", "r-lg": "3px",
        "tracking-title": "-.02em",
        "border-w": "1px"
      },
      light: {
        "bg": "#f1f6f1", "bg-elev": "#fbfdfb", "bg-soft": "#e6efe6",
        "text": "#0c1f11", "text-2": "#3d5442", "text-3": "#718775",
        "line": "rgba(12,31,17,.16)", "line-strong": "rgba(12,31,17,.30)",
        "accent": "#12813c", "accent-fg": "#f1f6f1", "accent-soft": "rgba(18,129,60,.10)",
        "glow-a": "rgba(18,129,60,.14)", "glow-b": "rgba(18,129,60,.10)",
        "shadow-sm": "0 1px 0 rgba(12,31,17,.06), 0 2px 10px rgba(12,31,17,.05)",
        "shadow-md": "0 2px 0 rgba(12,31,17,.06), 0 14px 34px rgba(12,31,17,.09)",
        "header-bg": "rgba(241,246,241,.80)",
        "toast-bg": "#0c1f11", "toast-fg": "#b8f5c8",
        "grain-opacity": ".18"
      },
      dark: {
        "bg": "#06090a", "bg-elev": "#0d1412", "bg-soft": "#131c19",
        "text": "#b8f5c8", "text-2": "#7fbe92", "text-3": "#55806a",
        "line": "rgba(184,245,200,.14)", "line-strong": "rgba(184,245,200,.28)",
        "accent": "#3ddc84", "accent-fg": "#06090a", "accent-soft": "rgba(61,220,132,.13)",
        "glow-a": "rgba(61,220,132,.17)", "glow-b": "rgba(61,220,132,.10)",
        "shadow-sm": "0 1px 0 rgba(61,220,132,.06), 0 3px 12px rgba(0,0,0,.4)",
        "shadow-md": "0 2px 0 rgba(61,220,132,.06), 0 16px 40px rgba(0,0,0,.6)",
        "header-bg": "rgba(6,9,10,.80)",
        "toast-bg": "#b8f5c8", "toast-fg": "#06090a",
        "grain-opacity": ".05"
      }
    },

    /* -------------------------------------------------------------- 6 陶土 */
    {
      id: "clay",
      name: "陶土",
      desc: "暖灰底、赭红点缀、大圆角软阴影。有人情味。",
      swatch: ["#f7f3ef", "#201a16", "#b4552f"],
      base: {
        "font-sans": '"MiSans", "MiSans VF", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
        "font-display": '"MiSans", "MiSans VF", "Inter", -apple-system, "PingFang SC", sans-serif',
        "font-mono": '"MiSans", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        "r-sm": "16px", "r-md": "24px", "r-lg": "34px",
        "tracking-title": "-.03em",
        "border-w": "1px"
      },
      light: {
        "bg": "#f7f3ef", "bg-elev": "#fffdfb", "bg-soft": "#efe8e1",
        "text": "#201a16", "text-2": "#5c5148", "text-3": "#8d7f74",
        "line": "rgba(32,26,22,.10)", "line-strong": "rgba(32,26,22,.19)",
        "accent": "#b4552f", "accent-fg": "#fffdfb", "accent-soft": "rgba(180,85,47,.10)",
        "glow-a": "rgba(180,85,47,.17)", "glow-b": "rgba(214,168,120,.24)",
        "shadow-sm": "0 1px 2px rgba(90,60,40,.05), 0 8px 22px rgba(90,60,40,.07)",
        "shadow-md": "0 2px 8px rgba(90,60,40,.07), 0 22px 54px rgba(90,60,40,.12)",
        "header-bg": "rgba(247,243,239,.76)",
        "toast-bg": "#201a16", "toast-fg": "#fffdfb",
        "grain-opacity": ".18"
      },
      dark: {
        "bg": "#16110e", "bg-elev": "#1f1915", "bg-soft": "#271f1a",
        "text": "#f5eae0", "text-2": "#c0ab9a", "text-3": "#8e7a68",
        "line": "rgba(245,234,224,.11)", "line-strong": "rgba(245,234,224,.22)",
        "accent": "#e0855a", "accent-fg": "#16110e", "accent-soft": "rgba(224,133,90,.14)",
        "glow-a": "rgba(224,133,90,.16)", "glow-b": "rgba(170,120,80,.15)",
        "shadow-sm": "0 1px 2px rgba(0,0,0,.35), 0 8px 24px rgba(0,0,0,.28)",
        "shadow-md": "0 2px 8px rgba(0,0,0,.32), 0 24px 56px rgba(0,0,0,.5)",
        "header-bg": "rgba(22,17,14,.76)",
        "toast-bg": "#f5eae0", "toast-fg": "#16110e",
        "grain-opacity": ".08"
      }
    },

    /* -------------------------------------------------------------- 7 薄荷 */
    {
      id: "mint",
      name: "薄荷",
      desc: "清透冷白配薄荷绿，细线大圆角。干净、轻盈。",
      swatch: ["#f4faf7", "#0f2019", "#0f9d76"],
      base: {
        "font-sans": '"MiSans", "MiSans VF", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
        "font-display": '"MiSans", "MiSans VF", "Inter", -apple-system, "PingFang SC", sans-serif',
        "font-mono": '"MiSans", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        "r-sm": "12px", "r-md": "20px", "r-lg": "28px",
        "tracking-title": "-.032em",
        "border-w": "1px"
      },
      light: {
        "bg": "#f4faf7", "bg-elev": "#ffffff", "bg-soft": "#e8f4ee",
        "text": "#0f2019", "text-2": "#436052", "text-3": "#6e897d",
        "line": "rgba(15,32,25,.09)", "line-strong": "rgba(15,32,25,.17)",
        "accent": "#0d8463", "accent-fg": "#ffffff", "accent-soft": "rgba(13,132,99,.09)",
        "glow-a": "rgba(13,132,99,.17)", "glow-b": "rgba(120,200,220,.20)",
        "shadow-sm": "0 1px 2px rgba(15,60,45,.04), 0 6px 20px rgba(15,60,45,.05)",
        "shadow-md": "0 2px 6px rgba(15,60,45,.05), 0 20px 48px rgba(15,60,45,.10)",
        "header-bg": "rgba(244,250,247,.72)",
        "toast-bg": "#0f2019", "toast-fg": "#ffffff",
        "grain-opacity": ".12"
      },
      dark: {
        "bg": "#071310", "bg-elev": "#0d1b17", "bg-soft": "#12241e",
        "text": "#e4f5ee", "text-2": "#92b5a8", "text-3": "#6a8d80",
        "line": "rgba(228,245,238,.10)", "line-strong": "rgba(228,245,238,.20)",
        "accent": "#4ddaab", "accent-fg": "#071310", "accent-soft": "rgba(77,218,171,.13)",
        "glow-a": "rgba(77,218,171,.17)", "glow-b": "rgba(110,190,215,.15)",
        "shadow-sm": "0 1px 2px rgba(0,0,0,.35), 0 6px 22px rgba(0,0,0,.28)",
        "shadow-md": "0 2px 6px rgba(0,0,0,.3), 0 22px 52px rgba(0,0,0,.5)",
        "header-bg": "rgba(7,19,16,.72)",
        "toast-bg": "#e4f5ee", "toast-fg": "#071310",
        "grain-opacity": ".06"
      }
    }
  ],

  /* -------------------------------------------------- 供 UI / 编辑器读取的接口 */
  get: function (id) {
    for (var i = 0; i < this.list.length; i++) {
      if (this.list[i].id === id) return this.list[i];
    }
    return null;
  },

  ids: function () {
    return this.list.map(function (t) { return t.id; });
  },

  /* 组合总数：风格 × 明暗 */
  count: function () {
    return this.list.length * 2;
  },

  /* 把某套风格写成 CSS 变量表（不含明暗），用于预览色块等场景 */
  baseVars: function (skin) {
    var t = this.get(skin);
    return t ? t.base : {};
  },

  /* 合并出「某风格 + 某明暗」的完整变量表，键名不带 -- 前缀。
     skin.js 注入页面、themes.html 做缩略预览都用它，保证两处绝不分叉。 */
  resolve: function (skin, mode) {
    var t = this.get(skin) || this.get(this.defaultSkin) || this.list[0];
    if (!t) return {};
    var m = (mode === "dark") ? "dark" : "light";
    var out = {};
    var k;
    for (k in t.base) out[k] = t.base[k];
    for (k in t[m]) out[k] = t[m][k];
    return out;
  }
};
