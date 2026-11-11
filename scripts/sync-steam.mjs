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

async function pickSteamId() {
  const arg = (process.argv[2] || "").trim();
  if (/^[0-9]{17}$/.test(arg)) return arg;
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

  const chromium = await loadChromium();
  if (!chromium) {
    console.error("[steam] 需要 playwright-core（npm install playwright-core --no-save）");
    process.exit(0);   // 不阻断 CI
  }

  const steamId = await pickSteamId();
  if (!steamId) {
    log("找不到 steamId（config.js 的 gaming.items[].steam.steamId）");
    process.exit(0);
  }

  log("目标 SteamID", steamId);

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

  const descriptions = [];
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

  const found = extractApps(descriptions);
  if (!found.length) {
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
  const portraitApps = [];
  for (let i = 0; i < games.length; i += 6) {
    const batch = games.slice(i, i + 6);
    const res = await Promise.all(batch.map((g) => hasPortrait(g.appid)));
    res.forEach((ok, k) => { if (ok) portraitApps.push(batch[k].appid); });
  }
  portraitApps.sort((a, b) => a - b);
  log(`竖版封面 ${portraitApps.length}/${games.length} 张可用` +
      (games.length - portraitApps.length
        ? `（剔除 ${games.length - portraitApps.length} 个 404）` : ""));

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(
    OUT,
    JSON.stringify(
      {
        updated: new Date().toISOString(),
        steamId,
        source: "inventory",
        inventoryTotal: total,
        /* apps 只放真游戏 —— 活动 appid 的封面大多 404，铺上去会是空白格 */
        apps: games.map((g) => g.appid),
        /* portraitApps 是逐张探测过、一定能加载的竖版封面，
           前端的封面墙只用这一份。apps 保留完整清单供别处引用。 */
        portraitBase: PORTRAIT("{id}"),
        portraitApps,
        portraitChecked: games.length,
        games: games.slice(0, 24).map((g) => ({ appid: g.appid, name: g.name })),
        events: events.map((e) => e.appid)
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
