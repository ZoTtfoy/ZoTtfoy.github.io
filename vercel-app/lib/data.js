import fs from "node:fs/promises";
import path from "node:path";

/* 服务端读取仓库里的同步数据。
   Vercel 部署时 Root Directory = vercel-app，构建上下文只含本目录，
   所以数据在 vercel-app/data/ 放一份（由根仓库的 CI 同步后复制过来）。
   找不到时返回 null，页面降级到内置兜底，不抛错 —— 与现有静态站的
   「抓不到就退回 config 兜底」行为一致。 */
const ALLOWED = new Set(["netease", "steam", "previews"]);

export async function readData(name) {
  if (!ALLOWED.has(name)) return null;
  const candidates = [
    path.join(process.cwd(), "data", name + ".json"),
    path.join(process.cwd(), "..", "data", name + ".json"), // 本地开发时读根仓库
  ];
  for (const f of candidates) {
    try {
      return JSON.parse(await fs.readFile(f, "utf8"));
    } catch (_) { /* 继续试下一个 */ }
  }
  return null;
}

/* 把三份原始数据裁成首屏真正要用的形状，避免把 100 首曲目整包注入 HTML */
export function pickHome(netease, steam, previews) {
  const week = Array.isArray(netease?.week) ? netease.week.slice(0, 5) : [];
  return {
    updated: netease?.updated || steam?.updated || null,
    music: {
      totalSongs: netease?.totalSongs ?? null,
      level: netease?.level ?? null,
      top: week.map(t => ({ title: t.title || "", artist: t.artist || "" })),
    },
    games: {
      appCount: Array.isArray(steam?.apps) ? steam.apps.length :
                Array.isArray(steam?.portraitApps) ? steam.portraitApps.length : null,
      inventoryTotal: steam?.inventoryTotal ?? null,
    },
    previewCount: previews?.items ? Object.keys(previews.items).length : 0,
    source: "server-side-rendered",
  };
}
