#!/usr/bin/env node
/* ==========================================================================
 *  sync-steam.mjs —— 从「公开库存」反推游戏库，写进 data/steam.json
 * --------------------------------------------------------------------------
 *  为什么单独一个脚本、而不是塞进 sync.mjs：
 *    这条抓取必须用**真实浏览器**跑。
 *    steamcommunity.com 对裸 TLS 请求（curl / node fetch）在这个网络环境下一律超时，
 *    但真实浏览器能拿到 200 —— 差异在 TLS 指纹，不在 IP。
 *    sync.mjs 只跑 fetch、没有浏览器能力，所以拆出来。
 *
 *  原理（小黑盒用的是同一条路）：
 *    Steam 的「库存」接口 753/6 返回集换式卡牌、表情、背景等物品，
 *    每条 description 带 market_hash_name，格式是 "<appid>-<物品名>"：
 *
 *      "220-Gordon Freeman"            → Half-Life 2
 *      "550-Hunter"                    → Left 4 Dead 2
 *      "413150-Alex"                   → Stardew Valley
 *
 *    前缀就是 appid。一个 280 件的库存能反推出 74 个游戏。
 *    不需要 API key，不需要登录 —— 只要「库存」设为公开。
 *
 *  跑法：
 *    node scripts/sync-steam.mjs                    # 用 config 里的 steamId
 *    node scripts/sync-steam.mjs 76561199120970154  # 指定 ID
 *
 *  ⚠️ 这条路的前提是「库存公开」。若返回 {"success":false}，
 *     去 Steam → 隐私设置 → 把「库存」改成公开。
 * ========================================================================== */

import fs from "node:fs/promises";
import path from "node:path";
/* 「最近入库」的差集记账逻辑独立成一个纯函数模块（scripts/lib/steam-added.mjs）：
   那块逻辑没有网络、没有文件、没有时钟，所以可以被 tools/verify-steam-added.js
   用假数据直接断言。这个脚本只负责"取数据 + 写文件"。 */
import { diffRecentlyAdded } from "./lib/steam-added.mjs";

const ROOT = path.resolve(process.cwd());
const OUT = path.join(ROOT, "data", "steam.json");

/* 753 = Steam 平台本体的 appid，不是游戏，要排除 */
const STEAM_PLATFORM = 753;

/* 这些 type 说明物品来自「特卖活动」而不是某个游戏，名字不是游戏名 */
const EVENT_TYPE = /(特卖|游戏节|大奖|节日|促销|活动|Sale|Fest|Awards)/i;

async function loadChromium() {
  try {
    const mod = await import("playwright-core");
    return mod.chromium;
  } catch {
    return null;
  }
}

/* SteamID 的三种给法，优先级从高到低：
 *   ① 命令行里任意位置的 17 位数字（`--api-only` 这种开关不会误伤）
 *   ② 环境变量 STEAM_ID（CI 里用 repository variable 传）
 *   ③ config.js 里那张 Steam 卡的 steam.steamId（本地默认，永远兜得住）
 * 这样 CI 不必再存一份 ID，本地也不用每次敲。 */
async function pickSteamId() {
  const argvHit = (process.argv.slice(2).find((a) => /^[0-9]{17}$/.test(a)) || "").trim();
  if (argvHit) return argvHit;

  const envHit = (process.env.STEAM_ID || "").trim();
  if (/^[0-9]{17}$/.test(envHit)) return envHit;

  try {
    const cfg = await fs.readFile(path.join(ROOT, "assets/js/config.js"), "utf8");
    const at = cfg.indexOf('steamId: "');
    if (at >= 0) {
      const hit = cfg.slice(at + 10, at + 40).match(/[0-9]{17}/);
      if (hit) return hit[0];
    }
  } catch { /* 忽略 */ }
  return "";
}

/* ==========================================================================
 *  游戏战绩：时长 / 成就 / 总数
 * --------------------------------------------------------------------------
 *  两条数据来源，**优先用 API，没有 key 就退回公开资料页**：
 *
 *   ① 有 key（推荐）
 *      IPlayerService/GetOwnedGames 能一次拿到**整个库**：
 *      game_count（游戏数量）、每款 playtime_forever（分钟）、
 *      playtime_2weeks（最近两周）。配合 ISteamUserStats/GetPlayerAchievements
 *      还能拿到每款的成就。这条路和「小黑盒」看到的是同一份数据。
 *      key 是免费的：https://steamcommunity.com/dev/apikey
 *      放法（任选其一，都不进仓库）：
 *        · 环境变量 STEAM_API_KEY=xxx node scripts/sync-steam.mjs
 *        · 在仓库根目录建一个 steam-key.txt，里面只写 key
 *
 *   ② 没 key（当前默认）
 *      只能读公开资料页的「最新动态」：
 *        /profiles/<id>/                      → 最近玩过的几款 + 总时数
 *        /profiles/<id>/stats/<appid>/achievements → 「已解锁 X 项，共 Y 项」
 *      公开页只给最近 3~5 款，所以页面上的"游戏时长"会标成「近 N 款」，
 *      而不是假装那是全库总时长。
 *
 *  ⚠️ 为什么必须用真实浏览器：裸 fetch 在这台机器上会被 TLS 指纹挡住
 *     （见文件顶注）。API 那条走普通 fetch 就行 —— api.steampowered.com 不挑。
 * ========================================================================== */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* 横版头图（460×215）。列表里的缩略图用它，别用 2:3 的竖版封面 ——
   竖版塞进 16:9 的框里会被裁掉一半。 */
const CDN = "https://cdn.akamai.steamstatic.com/steam/apps";
function headerUrl(appid) {
  return `${CDN}/${appid}/header.jpg`;
}

/* ⚠️ 有的 appid 在静态 CDN 上一张图都没有（新作 / 分区限定）。
   实测「深空当铺」4348910 的 header / capsule / library 全是 404，
   页面上就是一个空黑框 —— 用户专门圈出来过。
   所以在这里按"横图优先"挨个探一遍，全挂了就返回空串，
   让前端走兜底图标（那是有意为之的空态，比碎图好看）。 */
const COVER_CANDIDATES = [
  "header.jpg",          // 460×215，列表用的就是它
  "capsule_616x353.jpg",
  "library_600x900.jpg", // 竖版，兜底时会被 object-fit 裁一下
  "capsule_231x87.jpg"
];

async function pickCover(appid) {
  for (const f of COVER_CANDIDATES) {
    const url = `${CDN}/${appid}/${f}`;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url, { method: "HEAD", signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) return url;
    } catch { /* 试下一个 */ }
  }
  return "";
}

async function readApiKey() {
  if ((process.env.STEAM_API_KEY || "").trim()) return process.env.STEAM_API_KEY.trim();
  try {
    const txt = await fs.readFile(path.join(ROOT, "steam-key.txt"), "utf8");
    const key = txt.trim().split(/\s+/)[0];
    if (/^[0-9A-F]{32}$/i.test(key)) return key;
  } catch { /* 没有就算了 */ }
  return "";
}

/* 单款成就（API）。没有成就的游戏会返回 success:false，按"没有"处理。 */
async function achViaApi(key, steamId, appid) {
  const url =
    `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/` +
    `?key=${key}&steamid=${steamId}&appid=${appid}&l=schinese&format=json`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    const ps = j && j.playerstats;
    if (!ps || ps.success === false || !Array.isArray(ps.achievements)) return null;
    const total = ps.achievements.length;
    if (!total) return null;
    const have = ps.achievements.filter((a) => a.achieved === 1).length;
    return { have, total };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- 路线① API */
async function collectViaApi(steamId, key) {
  const url =
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/` +
    `?key=${key}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1` +
    `&format=json&l=schinese`;
  const res = await fetch(url);
  const json = await res.json();
  const body = (json && json.response) || {};
  const games = Array.isArray(body.games) ? body.games : [];
  if (!games.length) return null;

  /* 取多少行：页面上一屏只放得下 4~6 行，其余靠滚动。
     上限 30 行 —— 和前端 render.js 的 ROW_LIMIT 对齐：
       页面只渲染前 30 条，再多就是白抓。
     为什么不取全库 143 行：成就要一款一次请求，143 次会把同步拖到几分钟，
     而 JSON 也会从 40KB 涨到 200KB+。30 行足够撑出"库"的分量。 */
  const ROWS = 30;
  const sorted = games.slice().sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));
  const minutes = games.reduce((s, g) => s + (g.playtime_forever || 0), 0);

  const rows = [];
  for (const g of sorted.slice(0, ROWS)) {
    rows.push({
      appid: g.appid,
      name: g.name || String(g.appid),
      hours: +(((g.playtime_forever || 0) / 60).toFixed(1)),
      hours2w: +(((g.playtime_2weeks || 0) / 60).toFixed(1)),
      last: "",
      cover: await pickCover(g.appid),
      coverFallback: "",
      ach: await achViaApi(key, steamId, g.appid)
    });
  }

  return {
    source: "api",
    totalGames: body.game_count || games.length,
    totalHours: Math.round(minutes / 60),
    perfect: rows.filter((r) => r.ach && r.ach.have >= r.ach.total).length,
    /* API 拿到的是全库，所以"游戏时长"就是真的总时长 */
    partial: false,
    rows,
    /* 「最近入库」要靠**两次同步的差集**算 —— Steam 的接口里没有
       "购买时间"这个字段（GetOwnedGames 只有 rtime_last_played = 最后游玩）。
       所以这里把全库 appid 快照存下来，下次同步拿它做基线。 */
    owned: games.map((g) => ({ appid: g.appid, name: g.name || String(g.appid) }))
  };
}

/* --------------------------------------------------- 补充：徽章页的游戏时长
 *  公开资料页只给"最近玩过"的几款（实测 3 款）。徽章页 /badges/ 上，
 *  每个**游戏徽章**行都带一句「总时数 X 小时」，一页能多捞几款 ——
 *  而且同样是公开可读，不需要 key。
 *  能捞到多少取决于这人有多少套卡牌（有卡牌才有游戏徽章），
 *  但总比只有 3 款强；有 API key 时这条路跳过（API 给的是全库）。
 * ------------------------------------------------------------------------- */
async function collectViaBadges(page, base) {
  const r = await page.goto(base + "badges/", { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!r || r.status() !== 200) return [];
  await page.waitForTimeout(1200);

  return await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".badge_row").forEach((el) => {
      const txt = el.innerText.replace(/\s+/g, " ");
      const hm = /总时数\s*([\d,.]+)\s*小时/.exec(txt);
      if (!hm) return;                                  // 年限 / 活动徽章没有时长
      /* 游戏徽章的浮层链接是 /gamecards/<appid>/，appid 就在里面 */
      const ov = el.querySelector("a.badge_row_overlay");
      const am = /\/(?:gamecards|badges)\/(\d+)/.exec((ov && ov.getAttribute("href")) || "");
      if (!am) return;
      const nameEl = el.querySelector(".badge_title");
      const name = nameEl ? nameEl.textContent.replace(/查看详情/g, "").trim() : "";
      if (!name) return;
      out.push({
        appid: Number(am[1]),
        name,
        hours: Number(hm[1].replace(/,/g, "")),
        hours2w: 0,
        last: "",
        cover: "https://cdn.akamai.steamstatic.com/steam/apps/" + am[1] + "/header.jpg",
        coverFallback: "",
        ach: null
      });
    });
    return out;
  });
}

/* ------------------------------------------------------- 路线② 公开资料页 */
async function collectViaPage(chromium, steamId, fallbackCount) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ locale: "zh-CN", userAgent: UA });
    const page = await ctx.newPage();

    const base = `https://steamcommunity.com/profiles/${steamId}/`;
    const resp = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!resp || resp.status() !== 200) {
      log("资料页打不开（HTTP " + (resp ? resp.status() : "?") + "），跳过战绩");
      return null;
    }
    await page.waitForTimeout(1500);

    const raw = await page.evaluate(() =>
      [...document.querySelectorAll(".recent_game")].map((el) => {
        const a = el.querySelector(".game_name a");
        const img = el.querySelector("img.game_capsule");
        const det = el.querySelector(".game_info_details");
        const href = (a && a.getAttribute("href")) || "";
        const m = /\/app\/(\d+)/.exec(href);
        return {
          appid: m ? Number(m[1]) : 0,
          name: a ? a.textContent.trim() : "",
          cover: img ? img.src : "",
          detail: det ? det.textContent.replace(/\s+/g, " ").trim() : ""
        };
      })
    );

    const rows = [];
    for (const g of raw) {
      if (!g.name) continue;
      /* 「44.4 小时（过去 2 周） 总时数 2,491 小时 最后运行日期：11 月 7 日」
         英文界面是 "44.4 hrs past 2 weeks / 2,491 hrs on record / Last played on…" —— 两套都认 */
      const hm = /总时数\s*([\d,.]+)\s*小时/.exec(g.detail) ||
                 /([\d,.]+)\s*hrs on record/i.exec(g.detail);
      const wm = /([\d,.]+)\s*小时（过去 2 周）/.exec(g.detail) ||
                 /([\d,.]+)\s*hrs past 2 weeks/i.exec(g.detail);
      const lm = /最后运行日期[：:]\s*(.+)$/.exec(g.detail) ||
                 /Last played on\s*(.+)$/i.exec(g.detail);

      /* 缩略图换成横版头图：公开页给的 capsule_184x69 是 2.67:1，
         在 16:9 的框里会裁掉两边；header.jpg 比例刚好。
         探不到横图时退回页面给的那张（至少不是空）。 */
      const cover = (g.appid && (await pickCover(g.appid))) || g.cover;

      let ach = null;
      if (g.appid) {
        try {
          const r2 = await page.goto(base + `stats/${g.appid}/achievements`,
            { waitUntil: "domcontentloaded", timeout: 30000 });
          if (r2 && r2.status() === 200) {
            const txt = await page.evaluate(() => document.body.innerText);
            const am = /已解锁\s*(\d+)\s*项，共\s*(\d+)\s*项/.exec(txt) ||
                       /(\d+)\s+of\s+(\d+)\s+\([\d.]+%\)\s+achievements earned/i.exec(txt);
            if (am) ach = { have: Number(am[1]), total: Number(am[2]) };
          }
          await page.waitForTimeout(700);   // 给限流留余地
        } catch { /* 单款失败不影响其它 */ }
      }

      rows.push({
        appid: g.appid,
        name: g.name,
        hours: hm ? Number(hm[1].replace(/,/g, "")) : 0,
        hours2w: wm ? Number(wm[1].replace(/,/g, "")) : 0,
        last: lm ? lm[1].trim() : "",
        cover,
        ach
      });
    }

    /* 再用徽章页补几款（复用同一个 page，省一次启动浏览器）。
       最近玩过的那几款优先，徽章页只补它没有的。 */
    const fromBadges = await collectViaBadges(page, base);
    const seen = {};
    const merged = [];
    rows.forEach((r) => { if (r.appid && !seen[r.appid]) { seen[r.appid] = 1; merged.push(r); } });
    fromBadges.forEach((r) => {
      if (!r.appid || seen[r.appid]) return;
      seen[r.appid] = 1;
      merged.push(r);
    });
    merged.sort((a, b) => (b.hours || 0) - (a.hours || 0));

    const totalHours = merged.reduce((s, r) => s + (r.hours || 0), 0);
    return {
      source: "page",
      rows: merged,
      totalGames: fallbackCount || 0,
      totalHours: Math.round(totalHours),
      perfect: rows.filter((r) => r.ach && r.ach.have >= r.ach.total).length,
      /* ⚠️ 公开页只给最近几款 + 有卡牌的几款，这个"总时长"只是这几款之和 ——
         前端据此把标签写成「近 N 款」，不能写成「游戏时长」。 */
      partial: merged.length < (fallbackCount || 0)
    };
  } finally {
    await browser.close();
  }
}

function extractApps(descriptions) {
  const map = new Map();
  for (const d of descriptions || []) {
    const m = /^(\d+)-/.exec(d.market_hash_name || "");
    if (!m) continue;
    const appid = Number(m[1]);
    if (!appid || appid === STEAM_PLATFORM) continue;

    /* 游戏名：优先从 type 里剥掉物品类型后缀（「Half-Life 2 集换式卡牌」→「Half-Life 2」） */
    const type = String(d.type || "")
      .replace(/\s*(集换式卡牌|表情|个人资料背景|个人资料修饰器|贴纸|聊天表情|徽章|背景)$/u, "")
      .trim();

    /* 特卖活动的 appid 也会出现（万圣节特卖之类），标出来但不丢弃 ——
       它们的封面往往 404，构建时会自动筛掉。 */
    const isEvent = EVENT_TYPE.test(type);

    if (!map.has(appid)) map.set(appid, { appid, name: type, event: isEvent });
  }
  return [...map.values()];
}

async function main() {
  const log = (...a) => console.log("[steam]", ...a);

  /* --api-only：只用 Web API，不开浏览器。
     库存那条路必须用真实浏览器（TLS 指纹），CI 里跑不了；但只要有 API key，
     游戏库统计 + 最近入库这两件事不需要浏览器，所以给它留一个纯 API 模式：
       node scripts/sync-steam.mjs --api-only
     这时 apps / portraitApps（封面墙）沿用上一次本机抓的结果，不会被清空。 */
  const API_ONLY = process.argv.includes("--api-only");

  const chromium = API_ONLY ? null : await loadChromium();
  if (!API_ONLY && !chromium) {
    console.error("[steam] 需要 playwright-core（npm install playwright-core --no-save）");
    process.exit(0);   // 不阻断 CI
  }

  const steamId = await pickSteamId();
  if (!steamId) {
    log("找不到 steamId（config.js 的 gaming.items[].steam.steamId）");
    process.exit(0);
  }

  log("目标 SteamID", steamId);

  /* ---- 以下整段是"库存反推游戏库"，必须真实浏览器；--api-only 时跳过 ---- */
  let descriptions = [];
  let total = 0;
  if (!API_ONLY) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    /* 中文界面能让 market_hash_name 的 type 直接是中文游戏名，
       但 appid 前缀不受语言影响 —— 语言只影响可读性。 */
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await ctx.newPage();

  let lastAsset = null;
  let rounds = 0;
  let total = 0;

  try {
    /* 分页：接口单次最多给 2000，但实际会按 more_items 分批。
       实测 280 件的库存一轮就能取完，这里留到 6 轮以防库存很大。 */
    while (rounds < 6) {
      const url =
        `https://steamcommunity.com/inventory/${steamId}/753/6` +
        `?l=schinese&count=2000` +
        (lastAsset ? `&start_assetid=${lastAsset}` : "");

      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const body = await page.evaluate(() => document.body.innerText);

      let json = null;
      try { json = JSON.parse(body); } catch { /* 不是 JSON */ }

      if (!json || json.success === false) {
        log("接口没有返回有效数据（HTTP " + (resp ? resp.status() : "?") + "）");
        log("检查：Steam → 隐私设置 →「库存」是否公开");
        if (json && json.Error) log("服务端说明：" + json.Error);
        break;
      }

      total = json.total_inventory_count || total;
      (json.descriptions || []).forEach((d) => descriptions.push(d));
      rounds++;

      if (!json.more_items || !json.last_assetid) break;
      lastAsset = json.last_assetid;
      await page.waitForTimeout(1200);   // 给 Steam 的限流留点余地
    }
  } finally {
    await browser.close();
  }
  } /* ← if (!API_ONLY) 结束 */

  const found = extractApps(descriptions);

  /* --api-only：库存那份沿用上次结果（封面墙用），这里不重算 */
  if (API_ONLY) {
    log("--api-only：跳过库存抓取，沿用 data/steam.json 里已有的封面墙数据");
  } else if (!found.length) {
    log("没有从库存里提取到任何 appid");
    log("可能原因：① 库存是私密的 ② 库存里没有卡牌/表情（全新账号常见）");
    process.exit(0);
  }

  /* 按「是不是特卖活动」排序：真游戏排前面，活动排后面。
     前端只取前 N 个铺墙，这样墙上都是能认出来的游戏封面。 */
  found.sort((a, b) => Number(a.event) - Number(b.event) || a.appid - b.appid);
  const games = found.filter((x) => !x.event);
  const events = found.filter((x) => x.event);

  /* 逐张探测**竖版**封面是否真的存在。
     ⚠️ 这一步不能省：库存里的 appid 只是"这个游戏发过卡牌"，
        不代表它有 library_600x900.jpg。实测 45 个游戏里 8 个是 404 ——
        不剔掉，前端墙上就会出现 8 个天窗，而用户要的是"完全被封面填充"。
     只看状态码 + 体积：200 但 <5KB 的通常是占位图/错误页，一样剔除。 */
  const PORTRAIT = (id) =>
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
  async function hasPortrait(id) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(PORTRAIT(id), { signal: ctl.signal, method: "GET" });
      const len = Number(r.headers.get("content-length") || 0);
      clearTimeout(timer);
      return r.ok && (len === 0 || len > 5000);
    } catch { return false; }
  }
  /* 真正的并发上限 6：一批跑完才发下一批。
     ⚠️ 不能用 Promise.all + 递增 setTimeout 错开起点 ——
        那只是把 45 个请求错开几十毫秒，仍然全部同时在线，
        照样会被 CDN 限速、然后把超时误判成"没有封面"。 */
  /* --api-only 时 games 是空的（没跑库存），这一整块直接跳过，
     写文件时沿用旧 JSON 里的封面墙数据，别把墙清空。 */
  const portraitApps = [];
  if (!API_ONLY) {
    for (let i = 0; i < games.length; i += 6) {
      const batch = games.slice(i, i + 6);
      const res = await Promise.all(batch.map((g) => hasPortrait(g.appid)));
      res.forEach((ok, k) => { if (ok) portraitApps.push(batch[k].appid); });
    }
    portraitApps.sort((a, b) => a - b);
    log(`竖版封面 ${portraitApps.length}/${games.length} 张可用` +
        (games.length - portraitApps.length
          ? `（剔除 ${games.length - portraitApps.length} 个 404）` : ""));
  }

  /* 战绩：优先 API（全库），没有 key 就退回公开资料页（最近几款）。
     抓不到不影响库存那条主线 —— board 为 null 时前端整块不渲染。 */
  const key = await readApiKey();
  let board = null;
  if (key) {
    log("战绩：走 Web API（全库）");
    try { board = await collectViaApi(steamId, key); } catch (e) { log("API 失败：" + e.message); }
  } else {
    log("战绩：没有 STEAM_API_KEY / steam-key.txt，只能读公开资料页（最近几款）");
    log("      想要「全库时长 + 游戏数量」，去 https://steamcommunity.com/dev/apikey 领一把（免费）");
  }
  if (!board && API_ONLY) {
    log("--api-only 但没有拿到 API 数据（key 无效 / 网络失败），这次不写文件");
    process.exit(0);
  }
  if (!board) board = await collectViaPage(chromium, steamId, games.length);

  if (board && board.rows.length) {
    log(`战绩：${board.rows.length} 行 / 共 ${board.totalGames} 款 / ` +
        `${board.totalHours}h / 完美通关 ${board.perfect}` +
        (board.partial ? "（部分数据）" : ""));
    log("      " + board.rows.map((g) =>
      `${g.name} ${g.hours}h` + (g.ach ? ` ${g.ach.have}/${g.ach.total}` : "")
    ).join(" / "));
  } else {
    log("战绩：没抓到，前端会跳过这一块");
  }

  /* ---------------- 最近入库：拿上一次的全库快照做差集 ----------------
     具体规则（首次只建基线、空库不清记录、累积上限 12 条）都在
     scripts/lib/steam-added.mjs 里，那是纯函数，tools/verify-steam-added.js
     用假数据覆盖了全部分支。这里只负责把结果落盘。 */
  let prev = null;
  try {
    prev = JSON.parse(await fs.readFile(OUT, "utf8"));
  } catch { /* 第一次跑 */ }

  const today = new Date().toISOString().slice(0, 10);
  const ownedNow = (board && Array.isArray(board.owned)) ? board.owned : [];
  const diff = diffRecentlyAdded(prev, ownedNow, today);
  const added = diff.added;
  const ownedSince = diff.ownedSince;

  if (diff.baseline) {
    log("最近入库：首次同步，只建基线（从现在起记录新入库）");
  } else if (diff.fresh.length) {
    log(`最近入库：${diff.fresh.length} 款 —— ` + diff.fresh.map((g) => g.name).join(" / "));
  } else if (ownedNow.length) {
    log("最近入库：没有新游戏");
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(
    OUT,
    JSON.stringify(
      {
        updated: new Date().toISOString(),
        steamId,
        source: "inventory",
        inventoryTotal: API_ONLY && prev ? prev.inventoryTotal : total,
        /* apps 只放真游戏 —— 活动 appid 的封面大多 404，铺上去会是空白格。
           --api-only 时沿用上一次本机抓的那份（不然封面墙会被清空）。 */
        apps: API_ONLY && prev ? (prev.apps || []) : games.map((g) => g.appid),
        /* portraitApps 是逐张探测过、一定能加载的竖版封面，
           前端的封面墙只用这一份。apps 保留完整清单供别处引用。 */
        portraitBase: PORTRAIT("{id}"),
        portraitApps: API_ONLY && prev ? (prev.portraitApps || []) : portraitApps,
        portraitChecked: API_ONLY && prev ? prev.portraitChecked : games.length,
        games: API_ONLY && prev
          ? (prev.games || [])
          : games.slice(0, 24).map((g) => ({ appid: g.appid, name: g.name })),
        events: API_ONLY && prev ? (prev.events || []) : events.map((e) => e.appid),
        /* lib：顶部那条数据（游戏数量 / 总时长 / 完美通关）
           + rows：列表里的几行（duration / 2w / 成就 / 封面）
           partial=true 表示"总时长"只统计了列表里这几款，不是全库。 */
        lib: board ? {
          source: board.source,
          totalGames: board.totalGames,
          totalHours: board.totalHours,
          perfect: board.perfect,
          partial: board.partial
        } : null,
        recent: board ? board.rows : [],
        /* owned：全库 appid 快照（下次同步的基线，目前没在前端用）
           added：最近入库（新 → 旧，最多 12 条，带日期）
           ownedSince：基线建立的日期（前端在 empty 状态下用它说话） */
        owned: (board && board.owned) || (prev && prev.owned) || [],
        added,
        ownedSince
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  log(`库存 ${total} 件 → 解析出 ${found.length} 个 appid`);
  log(`其中游戏 ${games.length} 个，特卖活动 ${events.length} 个（活动不进背景）`);
  log("已写入 data/steam.json");
  log("前 8 个游戏：" + games.slice(0, 8).map((g) => `${g.appid} ${g.name}`).join(" / "));
}

main().catch((e) => {
  console.error("[steam] 未捕获异常：", e);
  process.exit(0);   // 永远不阻断
});
