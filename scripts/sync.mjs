#!/usr/bin/env node
/* ==========================================================================
 *  sync.mjs —— 定时抓取「站外数据」，写进 data/*.json
 * --------------------------------------------------------------------------
 *  由 .github/workflows/sync.yml 调用（也支持本地手动跑，方便调试）。
 *
 *  为什么需要它：
 *    网易云没有公开的「最近播放」接口，私有接口要求
 *      · 带 MUSIC_U 登录 cookie
 *      · 请求体做 AES + RSA 加密（weapi / eapi）
 *    浏览器端两件事都做不到（跨域 + 无法加密），所以只能在这里抓。
 *
 *  运行方式：
 *    1) 在仓库 Settings → Secrets and variables → Actions 里加
 *         Secret  NETEASE_COOKIE = 你浏览器里 music.163.com 的完整 Cookie
 *         Variable NETEASE_UID  = 你的数字 UID（也可以直接改 config.js）
 *    2) Actions 页面点「Sync data」→ Run workflow，或等每天定时跑
 *
 *  抓不到怎么办：
 *    脚本永远以退出码 0 结束，只把"抓到了什么"写进 JSON。
 *    前端 sync.js 会检查内容是否为空，空就继续用 config.js 里的兜底数据。
 *    **页面永远不会因为这里失败而变空白。**
 * ========================================================================== */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const DATA_DIR = path.join(ROOT, "data");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ------------------------------------------------------------------ 工具 */
function log(...a) { console.log("[sync]", ...a); }

/* 大数字加千分位：77025 → 77,025。
   六位数直接印出来很难一眼读出量级，加个逗号立刻可读。 */
function fmtCount(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function readJSON(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); }
  catch { return fallback; }
}

async function writeJSON(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
  log("写入", path.relative(ROOT, p));
}

/* 从 config.js 里抠出某个字段 —— 不想为了读一个值就 eval 整个配置文件 */
async function pickFromConfig(key) {
  try {
    const src = await fs.readFile(path.join(ROOT, "assets/js/config.js"), "utf8");
    const m = src.match(new RegExp(key + '\\s*:\\s*"([^"]*)"'));
    return m ? m[1] : "";
  } catch { return ""; }
}

async function fetchText(url, opts = {}, timeout = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) { log("HTTP", r.status, url); return ""; }
    return await r.text();
  } catch (e) {
    log("请求失败", url, e.name || e.message);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/* 从 HTML 里扒 og 标签。
   —— 目前没有用到（见 syncPreviewStats 里的说明：这三个站抓不到有效 og），
      保留这个函数是为了以后接别的站点时能直接复用。 */
function ogTags(html) {
  const out = {};
  if (!html) return out;
  for (const m of html.matchAll(/<meta[^>]+property=["']og:([a-z:]+)["'][^>]*content=["']([^"']*)["']/gi)) {
    out[m[1]] = m[2];
  }
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:([a-z:]+)["']/gi)) {
    if (!out[m[2]]) out[m[2]] = m[1];
  }
  if (!out.title) {
    const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (t) out.title = t[1].trim();
  }
  return out;
}

void ogTags;

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
void decodeEntities;

/* ============================================================ 1. 网易云 */
/* 要两样东西，来源是两个不同的接口 —— 这一点很关键：
 *
 *   A. 累计听歌数 + 等级
 *      GET /api/v1/user/detail/{uid}      ← 不需要登录
 *      返回 { listenSongs: 77025, level: 10, profile: {...} }
 *      ⚠️ 旧文档里的 /api/user/detail?uid= 已经 404，只有这个路径还在。
 *
 *   B. 听歌排行（带每首歌的播放次数）
 *      GET /api/v1/play/record?uid={uid}&type=1     ← 需要 MUSIC_U cookie
 *          type=1 → weekData（最近一周）   type=0 → allData（所有时间）
 *      返回 { weekData: [ { playCount, song: { name, ar[], al{}, id } } ] }
 *      没 cookie 时返回 { code: -2, msg: "无权限访问" }。
 *
 * 为什么把 A 和 B 拆开抓：
 *   以前只抓 B。一旦 cookie 过期或没配，整个 JSON 就写不出来，
 *   页面上一片示例数据 —— 而 A 根本不需要登录，白丢了。
 *   现在 A 拿到就写 A，B 拿到就写 B，互不牵连。
 */
const USER_DETAIL = (uid) =>
  `https://music.163.com/api/v1/user/detail/${encodeURIComponent(uid)}`;
const PLAY_RECORD = (uid, type) =>
  `https://music.163.com/api/v1/play/record?uid=${encodeURIComponent(uid)}&type=${type}`;

/* 把接口返回的一条记录拍平成页面要的形状。
   字段名在不同接口/不同年代之间飘过好几次（song / ar / artists / al / album），
   所以这里宁可多写几个兜底，也不要让某一首因为少一个字段就整条丢掉。 */
function normTrack(it) {
  const s = (it && it.song) || it || {};
  const ar = Array.isArray(s.ar) ? s.ar : Array.isArray(s.artists) ? s.artists : [];
  const al = s.al || s.album || {};
  return {
    title: s.name || s.title || "",
    artist: ar.map((a) => (a && a.name) || "").filter(Boolean).join(" / "),
    album: (al && al.name) || "",
    playCount: Number(it && (it.playCount ?? it.score)) || 0,
    url: s.id ? `https://music.163.com/song?id=${s.id}` : ""
  };
}

function parseJSON(body) {
  try { return JSON.parse(body); } catch { return null; }
}

async function syncNetease() {
  const uid = (process.env.NETEASE_UID || await pickFromConfig("neteaseUid") || "").trim();
  const cookie = (process.env.NETEASE_COOKIE || "").trim();
  const outPath = path.join(DATA_DIR, "netease.json");
  const prev = await readJSON(outPath, {});

  if (!uid || uid === "000000000") {
    log("网易云：还没有填 UID，跳过");
    return 0;
  }

  const headers = {
    "user-agent": UA,
    referer: "https://music.163.com/",
    accept: "application/json, text/plain, */*"
  };
  if (cookie) headers.cookie = cookie;

  /* ---------------------------------------- A. 累计听歌（不需要登录） */
  const detail = parseJSON(await fetchText(USER_DETAIL(uid), { headers })) || {};
  const totalSongs = Number(detail.listenSongs) || 0;
  const level = Number(detail.level) || 0;
  const nickname = (detail.profile && detail.profile.nickname) || "";
  if (totalSongs) {
    log(`网易云：累计听歌 ${totalSongs} 首${level ? "，Lv." + level : ""}${nickname ? "（" + nickname + "）" : ""}`);
  } else {
    log("网易云：没拿到累计听歌数（接口结构可能又变了）");
  }

  /* ------------------------------------ B. 本周 / 全部 听歌排行 */
  const week = parseJSON(await fetchText(PLAY_RECORD(uid, 1), { headers })) || {};
  const all = parseJSON(await fetchText(PLAY_RECORD(uid, 0), { headers })) || {};

  const pick = (resp) => {
    const raw = resp && (resp.weekData || resp.allData);
    if (!Array.isArray(raw)) return null;          // null = 没抓到，区别于"抓到了但为空"
    return raw.map(normTrack).filter((t) => t.title);
  };

  const weekTracks = pick(week);
  const allTracks = pick(all);

  if (weekTracks === null && allTracks === null) {
    log("网易云：没拿到听歌排行。检查 ① NETEASE_COOKIE 是否配了 / 过期 ② 听歌排行是否公开");
    if (week && week.code === -2) log("网易云：接口回的是「无权限访问」—— 这就是缺 cookie 的症状");
  }

  /* 排行抓不到就沿用上一次的，别把已经有内容的列表擦成空。
     累计听歌是这次新拿到的，照样要写进去。 */
  const finalWeek = weekTracks && weekTracks.length ? weekTracks : (prev.week || prev.tracks || []);
  const finalAll = allTracks && allTracks.length ? allTracks : (prev.allTime || []);
  const finalTotal = totalSongs || Number(prev.totalSongs) || 0;
  const finalLevel = level || Number(prev.level) || 0;

  if (!finalWeek.length && !finalTotal) {
    log("网易云：什么都没有拿到，保持原样");
    return 0;
  }

  const payload = {
    updated: new Date().toISOString(),
    uid,
    totalSongs: finalTotal,
    level: finalLevel,
    week: finalWeek,
    allTime: finalAll,
    /* tracks = week，留给还没有升级的前端 / 旧缓存 */
    tracks: finalWeek
  };
  await writeJSON(outPath, payload);

  if (finalWeek.length) log(`网易云：听歌排行已同步 ${finalWeek.length} 首（带播放次数）`);
  if (!totalSongs && finalTotal) log("网易云：累计听歌沿用上次的值");
  /* 返回"这次真的抓到几首"。以前这里写 `|| 1`，本意是"写成功就算有进展"，
     结果 empty 的排行会被下游当成"本周在听 1 首"写进摘要卡 —— 一个假数字。 */
  return finalWeek.length;
}

/* ==================================================== 2. 摘要卡的真实数据 */
/* ⚠️ 这里踩过一个坑，记下来免得以后重犯：
 *
 *    一开始想「抓外链的 og 标签来汇总关键信息」，对网易云 / 闲鱼 / 小黑盒
 *    三个主页都发了请求。结果拿到的是：
 *        网易云音乐
 *        小黑盒 - 玩家高能聚集地
 *        闲鱼 - 闲不住？上闲鱼！
 *    全是**平台首页的品牌标题**，不是用户主页的数据。
 *
 *    原因：这三个站都是单页应用（SPA），服务端只返回一个空壳 HTML，
 *    里面没有 og:title / og:image；真实的昵称、战绩、信用分全靠
 *    JavaScript 在客户端渲染，而它们又都要登录态。
 *    抓这种数据回去覆盖 config.js 里精心写好的文案，只会**更差**。
 *
 *    所以这里改成：不抓外链，只用**确实拿得到**的真实数据 ——
 *    也就是网易云播放记录本身能算出来的东西（本周听了几首）。
 *    其余两个卡片的文字由你在 config.js 里填，想放缩略图就截图上传。
 */
async function syncPreviewStats(trackCount) {
  const outPath = path.join(DATA_DIR, "previews.json");
  const prev = await readJSON(outPath, { items: {} });
  const items = { ...(prev.items || {}) };
  const listen = await readJSON(path.join(DATA_DIR, "netease.json"), {});
  const totalSongs = Number(listen.totalSongs) || 0;

  if (!trackCount && !totalSongs) {
    log("摘要：这次没有可用的网易云数据，不动摘要卡");
    return;
  }

  // 只补 stats，**不碰** title / meta / cover ——
  // 那三样是你手写的，自动数据没有资格覆盖。
  const stats = [];
  // 累计听歌是这张卡最有分量的一格：一个六位数的数字，比"本周 N 首"更像"我听了多少年"
  if (totalSongs) stats.push({ label: "累计听歌", value: fmtCount(totalSongs) + " 首" });
  if (trackCount) stats.push({ label: "本周在听", value: trackCount + " 首" });
  if (!stats.length) return;

  items.netease = {
    ...(items.netease || {}),
    stats: stats.concat([
      { label: "同步于", value: new Date().toISOString().slice(5, 10).replace("-", "/") }
    ])
  };

  await writeJSON(outPath, { updated: new Date().toISOString(), items });
  log("摘要：已为网易云卡片补上真实统计（" + stats.map((s) => s.label + "=" + s.value).join("，") + "）");
}

/* --------------------------------------------------------------- 入口 */
async function main() {
  log("开始同步", new Date().toISOString());

  /* Actions 里给"配漏了"一个显眼提示。
     这一步只在 GitHub 上生效（本地跑没有 GITHUB_ACTIONS），
     作用是让人在 Actions 页面直接看到黄色的 annotation，
     而不是滚半天日志才发现"原来一直没配 cookie"。 */
  const annotate = (msg) => {
    if (process.env.GITHUB_ACTIONS) console.log("::warning::" + msg);
  };
  if (!process.env.NETEASE_COOKIE) {
    annotate("没有配置 NETEASE_COOKIE，听歌排行抓不到（累计听歌不受影响）。见 README 第五节。");
  }

  let count = 0;
  try { count = await syncNetease(); }
  catch (e) { log("网易云同步异常（已忽略）", e.message); }

  try { await syncPreviewStats(count); }
  catch (e) { log("摘要统计异常（已忽略）", e.message); }

  log("完成");
}

main().catch((e) => {
  // 永远不要因为抓取失败就中断 CI —— 页面用的是仓库里已有的数据
  console.error("[sync] 未捕获异常：", e);
  process.exit(0);
});
