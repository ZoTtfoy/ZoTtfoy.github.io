import { readData } from "../../../lib/data.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* --------------------------------------------------------------------------
 *  Cron 端点占位（Vercel Cron Jobs 用 GET 调用，带 Authorization: Bearer $CRON_SECRET）
 *
 *  ⚠️ 这里刻意**不**做真实抓取，原因见 README「已知障碍」：
 *     现有 scripts/sync-steam.mjs 必须用真实 Chromium 绕过 Steam 的 TLS 指纹
 *     拦截，而 Serverless Function 里跑浏览器需要 @sparticuz/chromium +
 *     1600MB 内存 + 大包体，Hobby 上不划算。
 *
 *  推荐架构：保留 GitHub Actions 抓数据 → 提交 data/*.json → 触发 Vercel
 *  重新部署（本函数只负责健康检查与数据来源核对）。
 * -------------------------------------------------------------------------- */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== "Bearer " + secret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const [netease, steam] = await Promise.all([readData("netease"), readData("steam")]);
  return Response.json({
    ok: true,
    mode: "read-only",
    note: "真实抓取仍由 GitHub Actions 负责；本端点核对数据是否就绪",
    netease: netease ? { updated: netease.updated, totalSongs: netease.totalSongs } : null,
    steam: steam ? { updated: steam.updated, apps: steam.apps?.length } : null,
    ts: new Date().toISOString(),
  });
}
