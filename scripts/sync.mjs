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
/* 接口：GET /api/v1/play/record?uid={uid}&type=1
 *   type=1 → 最近一周（本脚本用这个）
 *   type=0 → 所有时间
 * 返回：{ code, weekData: [{ playCount, song: { name, ar[], al{}, id } }] }
 * 没有 cookie 时通常返回 weekData: []，属于正常情况。 */
async function syncNetease() {
  const uid = (process.env.NETEASE_UID || await pickFromConfig("neteaseUid") || "").trim();
  const cookie = (process.env.NETEASE_COOKIE || "").trim();
  const outPath = path.join(DATA_DIR, "netease.json");
  const prev = await readJSON(outPath, { tracks: [] });

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

  const url = `https://music.163.com/api/v1/play/record?uid=${encodeURIComponent(uid)}&type=1`;
  const body = await fetchText(url, { headers });

  let json = null;
  try { json = JSON.parse(body); } catch { /* 不是 JSON 就当失败 */ }

  const raw = json && (json.weekData || json.allData);
  if (!Array.isArray(raw) || !raw.length) {
    log("网易云：没拿到播放记录。检查 ① cookie 是否过期 ② 听歌排行是否公开");
    // 保留上一次成功的数据，不要把已有的歌单擦成空
    if (Array.isArray(prev.tracks) && prev.tracks.length) {
      log("网易云：沿用上一次的数据（" + prev.tracks.length + " 首）");
    }
    return 0;
  }

  const tracks = raw.slice(0, 12).map((it) => {
    const s = it.song || {};
    const artists = Array.isArray(s.ar) ? s.ar.map((a) => a.name).filter(Boolean).join(" / ") : "";
    return {
      title: s.name || "",
      artist: artists,
      album: (s.al && s.al.name) || "",
      url: s.id ? `https://music.163.com/song?id=${s.id}` : ""
    };
  }).filter((t) => t.title);

  if (!tracks.length) { log("网易云：解析后没有有效曲目，跳过"); return 0; }

  await writeJSON(outPath, {
    updated: new Date().toISOString(),
    uid,
    tracks
  });
  log(`网易云：已同步 ${tracks.length} 首`);
  return tracks.length;
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

  if (!trackCount) {
    log("摘要：这次没有播放记录，不动摘要卡");
    return;
  }

  // 只补 stats，**不碰** title / meta / cover ——
  // 那三样是你手写的，自动数据没有资格覆盖。
  items.netease = {
    ...(items.netease || {}),
    stats: [
      { label: "本周在听", value: trackCount + " 首" },
      { label: "同步于", value: new Date().toISOString().slice(5, 10).replace("-", "/") }
    ]
  };

  await writeJSON(outPath, { updated: new Date().toISOString(), items });
  log("摘要：已为网易云卡片补上真实统计（" + trackCount + " 首）");
}

/* --------------------------------------------------------------- 入口 */
async function main() {
  log("开始同步", new Date().toISOString());

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
