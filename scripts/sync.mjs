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
/* 要三样数据，来自三个接口，权限要求各不相同 —— 这个区别是实测出来的：
 *
 *   A. 累计听歌数 + 等级     GET /api/v1/user/detail/{uid}
 *      ✅ 不需要登录。返回 { listenSongs: 77025, level: 10, profile: {...} }
 *      ⚠️ 旧文档里的 /api/user/detail?uid= 已经 404，只有这个路径还在。
 *
 *   B. 听歌排行              GET /api/v1/play/record?uid={uid}&type=1
 *      ⚠️ 也不需要 cookie，但**需要账号把「听歌排行」设为公开**。
 *      type=1 → weekData（最近一周）   type=0 → allData（所有时间）
 *      设为私密时返回 { code: -2, msg: "无权限访问" }。
 *
 *      ⚠️⚠️ 2026-11-10 实测纠正了一个长期误解：
 *      -2 不是"缺 cookie"，而是"这个账号的听歌排行是私密的"。
 *      证据：同一时刻、同一请求头，uid=2116/83659385 等账号返回 code=200
 *      且有完整 weekData；而 uid=1（网易云官方）和自己的账号返回 -2。
 *      如果是"接口要登录"，应该是所有 uid 都 -2。
 *      也就是说：**把听歌排行设为公开，就不需要 cookie 了**。
 *
 *      代价：匿名读到的次数被服务端脱敏了 —— playCount 恒为 0，
 *      真实信息在 score 字段，是百分制相对热度（top1=100，其次 75/50…）。
 *      weapi 加密、移动端 UA、各种 os= 标识都试过，拿不到真实次数：
 *      那是账号私密数据，脱敏是服务端设计，不是协议问题。
 *
 *   C. 我喜欢的音乐（兜底）   GET /api/user/playlist?uid=  +  /api/v1/playlist/detail?id=
 *      ✅ 不需要登录，也**不需要任何设置**（喜欢歌单默认公开）。
 *      代价：详情接口只给前 6 首（同样是脱敏），但这一屏本来就只显示 6 首。
 *
 * 于是有三层降级：公开排行 → 我喜欢的音乐 → 上一次的数据。
 * 目标是**页面上永远有真实内容**，而不是一片"示例曲目一"。
 */
const USER_DETAIL = (uid) =>
  `https://music.163.com/api/v1/user/detail/${encodeURIComponent(uid)}`;
const PLAY_RECORD = (uid, type) =>
  `https://music.163.com/api/v1/play/record?uid=${encodeURIComponent(uid)}&type=${type}`;
const USER_PLAYLIST = (uid) =>
  `https://music.163.com/api/user/playlist?uid=${encodeURIComponent(uid)}&limit=50&offset=0`;
const PLAYLIST_DETAIL = (id) =>
  `https://music.163.com/api/v1/playlist/detail?id=${encodeURIComponent(id)}`;

/* 把接口返回的一条记录拍平成页面要的形状。
   字段名在不同接口/不同年代之间飘过好几次（song / ar / artists / al / album），
   所以这里宁可多写几个兜底，也不要让某一首因为少一个字段就整条丢掉。

   ⚠️ playCount 和 score 必须分开存。
   早先写的是 `Number(it.playCount ?? it.score)` —— 而匿名接口的 playCount
   是 0 而不是 null，`0 ?? x` 等于 0，于是 score 永远取不到，次数恒显示 0。
   现在两个字段各自保留，由前端决定显示"次数"还是"热度条"。 */
function normTrack(it) {
  const s = (it && it.song) || it || {};
  const ar = Array.isArray(s.ar) ? s.ar : Array.isArray(s.artists) ? s.artists : [];
  const al = s.al || s.album || {};
  return {
    title: s.name || s.title || "",
    artist: ar.map((a) => (a && a.name) || "").filter(Boolean).join(" / "),
    album: (al && al.name) || "",
    playCount: Number(it && it.playCount) || 0,  // 真实次数：只有带 cookie 才非 0
    score: Number(it && it.score) || 0,          // 相对热度：匿名读排行时唯一有值的
    url: s.id ? `https://music.163.com/song?id=${s.id}` : ""
  };
}

/* ============================================ 1.5 封面 + 可播性补全
 *
 *  两件事，都是为了 Q2 那个列表能"就地播放 + 显示封面"：
 *
 *  ① 封面。排行接口只给歌名和歌手，不给图。图在 song/detail 里
 *     （`songs[].al.picUrl`）。一次可以批量查 100 首，所以只发一次请求。
 *     拿到后加 `?param=120y120` —— 原图动辄 100KB+，列表里只要 40px 的小方图，
 *     120y120 大约 3~5KB，六首加起来也不到一张截图的量。
 *
 *  ② 可播性。这是这一版最关键的一步，也是最容易被忽略的。
 *     网易云有个"外链播放"地址：
 *         https://music.163.com/song/media/outer/url?id=<id>.mp3
 *     免费曲目会 302 到真实 mp3（audio/mpeg），而 VIP / 付费专辑版权曲
 *     **返回的是一个 HTML 提示页**（"因版权要求无法播放"），HTTP 状态还是 200。
 *     实测本站 100 首里 44 首能播、56 首不能 —— 你听的日系曲子大多要会员。
 *
 *     所以必须**提前探测**并写进数据。不探测的后果是：每首歌都挂一个播放按钮，
 *     点下去一半没反应（<audio> 报 MEDIA_ERR_SRC_NOT_SUPPORTED），
 *     用户会以为站点坏了。探测之后，不能播的直接渲染成"去网易云"外链，
 *     并在 title 里说清原因 —— 点了没反应和"点了明确告诉你去哪"，差别很大。
 *
 *  探测方式：Range 请求只要头 2KB，看 Content-Type。
 *  不用 HEAD —— 那条 302 链上的 CDN 对 HEAD 的响应不一致，实测有误判。
 */

/* 一首歌的外链播放地址。注意 `.mp3` 是拼在 id 后面的，
   写成 `?id=x&ext=mp3` 不生效。 */
function outerUrl(songId) {
  return `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
}

/* 只读前 2KB 判断是不是真的音频。返回 true / false；
   请求本身失败时返回 false（宁可当成不能播，也不要在页面上放一个坏按钮）。 */
async function canPlay(songId) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(outerUrl(songId), {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        referer: "https://music.163.com/",
        range: "bytes=0-2047"
      }
    });
    const type = (r.headers.get("content-type") || "").toLowerCase();
    return type.includes("audio") || type.includes("mpeg") || type.includes("octet-stream");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/* 并发跑一批异步任务。并发数刻意压到 6：
   对同一个域名开太多连接会被限速，实测 12 路时一半请求变成超时误判。 */
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while (cursor < list.length) {
      const i = cursor++;
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function songIdOf(url) {
  const m = /[?&]id=(\d+)/.exec(url || "");
  return m ? m[1] : "";
}

/* 给每首曲目补 cover / playable。失败时**保留旧值**，
   绝不清空 —— 一次网络抖动不该让页面上的封面全变回占位块。 */
async function enrichTracks(tracks, headers, prevTracks) {
  if (!Array.isArray(tracks) || !tracks.length) return tracks;

  const prevById = {};
  (prevTracks || []).forEach((t) => { if (t && t.url) prevById[t.url] = t; });

  const ids = tracks.map((t) => songIdOf(t.url)).filter(Boolean);

  /* ---- 封面：一次批量查 ---- */
  const picById = {};
  if (ids.length) {
    const body = await fetchText(
      `https://music.163.com/api/song/detail?ids=[${ids.join(",")}]`,
      { headers }, 20000
    );
    const d = parseJSON(body) || {};
    (d.songs || []).forEach((s) => {
      const al = s.al || s.album || {};
      if (s.id && al.picUrl) picById[String(s.id)] = al.picUrl;
    });
    log(`网易云：封面拿到 ${Object.keys(picById).length}/${ids.length} 张`);
  }

  /* ---- 可播性：并发探测 ---- */
  const playableById = {};
  if (ids.length) {
    const results = await mapLimit(ids, 6, (id) => canPlay(id));
    ids.forEach((id, i) => { playableById[id] = results[i]; });
    const ok = results.filter(Boolean).length;
    log(`网易云：可站内播放 ${ok}/${ids.length} 首（其余为会员/付费版权曲）`);
  }

  return tracks.map((t) => {
    const id = songIdOf(t.url);
    const prev = prevById[t.url] || {};
    const pic = picById[id];

    /* 封面：新拿到就用新的；没拿到就沿用旧值；都没有就留空，
       前端会画一个音符占位块（比空白格好看，也不会请求不存在的图） */
    const cover = pic
      ? pic + "?param=120y120"
      : (t.cover || prev.cover || "");

    /* 可播性：探测有结论才写，没结论沿用旧值 */
    const playable = typeof playableById[id] === "boolean"
      ? playableById[id]
      : (typeof t.playable === "boolean" ? t.playable : prev.playable);

    const out = { ...t, cover };
    if (typeof playable === "boolean") out.playable = playable;
    return out;
  });
}

function parseJSON(body) {
  try { return JSON.parse(body); } catch { return null; }
}

/* 读听歌排行。返回 { tracks, all, denied, empty } —— 把"没权限"和"没数据"分开，
   因为这两种情况给用户的建议完全不同。 */
async function readRank(uid, headers) {
  const week = parseJSON(await fetchText(PLAY_RECORD(uid, 1), { headers })) || {};
  const all = parseJSON(await fetchText(PLAY_RECORD(uid, 0), { headers })) || {};
  const pick = (r) => {
    const raw = r && (r.weekData || r.allData);
    if (!Array.isArray(raw)) return null;   // null = 这个接口没给数据
    return raw.map(normTrack).filter((t) => t.title);
  };
  return {
    tracks: pick(week) || [],
    all: pick(all) || [],
    denied: week.code === -2 || all.code === -2,
    code: week.code
  };
}

/* 读「我喜欢的音乐」歌单。零设置可用，是排行私密时的兜底。 */
async function readLiked(uid, headers) {
  const pl = parseJSON(await fetchText(USER_PLAYLIST(uid), { headers })) || {};
  const list = Array.isArray(pl.playlist) ? pl.playlist : [];
  if (!list.length) return { tracks: [], name: "" };
  // specialType === 5 就是「我喜欢的音乐」；老接口可能没有这个字段，退到名字匹配
  const liked = list.find((p) => p.specialType === 5) || list.find((p) => /喜欢/.test(p.name || ""));
  if (!liked) return { tracks: [], name: "" };
  const d = parseJSON(await fetchText(PLAYLIST_DETAIL(liked.id), { headers })) || {};
  const raw = (d.playlist && d.playlist.tracks) || [];
  return {
    tracks: raw.map(normTrack).filter((t) => t.title),
    name: liked.name || ""
  };
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

  /* ------------------------------- B. 听歌排行（不需要 cookie，但要公开） */
  const rank = await readRank(uid, headers);
  const hasRank = rank.tracks.length > 0;

  if (hasRank) {
    const real = rank.tracks.some((t) => t.playCount > 0);
    log(`网易云：听歌排行 ${rank.tracks.length} 首` +
      (real ? "（含真实播放次数）" : "（匿名读取，次数为相对热度）"));
  } else if (rank.denied) {
    log("网易云：听歌排行返回 -2「无权限访问」—— 这是账号把它设成了私密，不是缺 cookie。");
    log("网易云：去 music.163.com → 设置 → 隐私 →「公开我的听歌排行」，之后无需任何配置就能抓。");
  } else {
    log("网易云：排行接口可读但没有记录（可能这一周还没听歌）");
  }

  /* --------------------------- C. 兜底：我喜欢的音乐（零设置，永远可用） */
  let source = "rank";
  let finalTracks = rank.tracks;
  let likedName = "";

  if (!finalTracks.length) {
    const liked = await readLiked(uid, headers);
    likedName = liked.name;
    if (liked.tracks.length) {
      source = "liked";
      finalTracks = liked.tracks;
      log(`网易云：改用「${liked.name}」作为数据源（${liked.tracks.length} 首，无需任何设置）`);
    }
  }

  /* 三层都空：沿用上一次的数据，别把已有内容擦成空 */
  if (!finalTracks.length) {
    finalTracks = prev.tracks || prev.week || [];
    if (finalTracks.length) {
      source = prev.source || "cache";
      log(`网易云：本次没抓到内容，沿用上一次的 ${finalTracks.length} 首`);
    }
  }

  const finalTotal = totalSongs || Number(prev.totalSongs) || 0;
  const finalLevel = level || Number(prev.level) || 0;

  if (!finalTracks.length && !finalTotal) {
    log("网易云：什么都没有拿到，保持原样");
    return { count: 0, source: "none" };
  }

  /* 补封面与可播性。放在写入之前、三层降级之后 ——
     只给"这次真的要显示的这份曲目"做探测，避免白跑几十个请求。 */
  if (finalTracks.length) {
    finalTracks = await enrichTracks(finalTracks, headers, prev.tracks || []);
  }

  const payload = {
    updated: new Date().toISOString(),
    uid,
    totalSongs: finalTotal,
    level: finalLevel,
    /* rank   = 听歌排行（公开）
       liked  = 我喜欢的音乐（排行私密时的兜底）
       cache  = 这次什么都没抓到，沿用旧数据 */
    source,
    likedName,
    week: rank.tracks,
    allTime: rank.all,
    /* tracks = 前端实际用的那份，旧字段名保持不变 */
    tracks: finalTracks
  };
  await writeJSON(outPath, payload);

  const label = source === "rank" ? "听歌排行" : source === "liked" ? "我喜欢的音乐" : "上一次的数据";
  if (finalTracks.length) log(`网易云：已写入 ${finalTracks.length} 首（来源：${label}）`);
  if (!totalSongs && finalTotal) log("网易云：累计听歌沿用上次的值");
  /* 返回"这次真的抓到几首"。以前这里写 `|| 1`，本意是"写成功就算有进展"，
     结果 empty 的排行会被下游当成"本周在听 1 首"写进摘要卡 —— 一个假数字。 */
  return { count: finalTracks.length, source };
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
async function syncPreviewStats(trackCount, source) {
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
  /* trackCount 的标签要跟着数据来源走。
     早先不管来源一律写「本周在听」—— 当数据源退到「我喜欢的音乐」时，
     那句"本周在听 6 首"就是假的：那 6 首是收藏，不是本周循环。
     宁可写「收藏歌曲」，也不让卡片替一个不存在的事实背书。 */
  if (trackCount) {
    const label = source === "liked" ? "收藏歌曲" : "本周在听";
    stats.push({ label, value: trackCount + " 首" });
  }
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

/* ============================================================ 2. Steam */
/* 抓「我的游戏库」，用来铺游戏屏的封面拼贴背景。
 *
 * ---------------------------------------------------------------------------
 *  两条路都试过了，这里记下结论，免得以后又走回头路：
 *
 *  ① API 路线（官方推荐）：
 *       GET api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=...
 *     · 不带 key → 401 "Required parameter 'key' is missing"
 *     · 假 key   → 401 Unauthorized（直接拒绝，不是返回空）
 *     key 免费但要手动申请、还得存进仓库 Secrets。
 *
 *  ② 公开库存路线（就是这次采用的，小黑盒同款思路）：
 *       GET steamcommunity.com/inventory/{steamid}/753/6?l=schinese&count=2000
 *     · 不需要 key，不需要登录，只要「库存」是公开的
 *     · 返回的 descriptions[].market_hash_name 形如 "220-Gordon Freeman"，
 *       前缀就是 appid —— 这正是游戏库的指纹
 *     · 实测这个账号：280 件库存 → 提取出 74 个游戏 appid
 *
 *  ⚠️ 为什么 curl 抓不到、脚本却要"用浏览器"：
 *     steamcommunity.com 对这个网络环境的裸 TLS 请求一律超时（直连和代理都试过），
 *     但真实浏览器能拿到 200 —— 差异在 TLS 指纹，不在 IP。
 *     所以这条抓取由 scripts/sync-steam.mjs 用 playwright 驱动真浏览器完成，
 *     不在本文件里做（本文件只跑 fetch，没有浏览器能力）。
 *
 *  ⚠️ 另一个坑：profiles/{id}/games?tab=all **未登录会被重定向到登录页**。
 *     那条路只有在「游戏详情」公开 + 已登录时才能用，脚本里没有登录态，
 *     所以不要试图去爬那个页面。
 * ---------------------------------------------------------------------------
 *
 *  拿不到就什么都不写，前端退回 config 里的 fallbackApps 快照 ——
 *  背景永远有图，不会开天窗。
 */
async function syncSteam() {
  const outPath = path.join(DATA_DIR, "steam.json");
  const prev = await readJSON(outPath, { apps: [] });

  /* steamId 优先取环境变量，其次从 config.js 里读那张 Steam 卡上的值 ——
     改 ID 只需要在编辑器里改一处。 */
  let steamId = (process.env.STEAM_ID || "").trim();
  if (!steamId) {
    try {
      const cfg = await fs.readFile(path.join(ROOT, "assets/js/config.js"), "utf8");
      const at = cfg.indexOf('steamId: "');
      if (at >= 0) {
        const hit = cfg.slice(at + 10, at + 40).match(/[0-9]{17}/);
        if (hit) steamId = hit[0];
      }
    } catch { /* 忽略 */ }
  }

  if (!steamId) {
    log("Steam：配置文件里找不到 steamId，跳过");
    return 0;
  }
  if (Array.isArray(prev.apps) && prev.apps.length) {
    log(`Steam：已有 ${prev.apps.length} 个 appid（由 sync-steam.mjs 抓取），保持不动`);
  } else {
    log("Steam：还没有数据，前端会用 config 里的 fallbackApps 快照");
    log("Steam：要抓真实库存请跑 node scripts/sync-steam.mjs（需要本机浏览器）");
  }
  return prev.apps ? prev.apps.length : 0;
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

  let result = { count: 0, source: "none" };
  try { result = await syncNetease(); }
  catch (e) { log("网易云同步异常（已忽略）", e.message); }

  try { await syncPreviewStats(result.count, result.source); }
  catch (e) { log("摘要统计异常（已忽略）", e.message); }

  try { await syncSteam(); }
  catch (e) { log("Steam 同步异常（已忽略）", e.message); }

  log("完成");
}

main().catch((e) => {
  // 永远不要因为抓取失败就中断 CI —— 页面用的是仓库里已有的数据
  console.error("[sync] 未捕获异常：", e);
  process.exit(0);
});
