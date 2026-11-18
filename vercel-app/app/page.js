import { readData, pickHome } from "../lib/data.js";

/* 这是 SSR 的核心：数据在**服务端**读、直接渲染进 HTML。
   现有静态站是浏览器打开后再 fetch data/*.json；这里首屏 HTML 就带数据，
   无 JS 也能看到内容（可 curl 验证），也是「动态化」最实质的收益。
   每次请求重新读 —— 不缓存静态结果。 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const [netease, steam, previews] = await Promise.all([
    readData("netease"), readData("steam"), readData("previews"),
  ]);
  const d = pickHome(netease, steam, previews);
  const generated = new Date().toISOString();

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px 80px" }}>
      <header style={{ marginBottom: 40 }}>
        <p style={{ color: "#7d8590", fontSize: 13, letterSpacing: 2 }}>VERCEL SSR · 迁移起点</p>
        <h1 style={{ fontSize: 40, margin: "8px 0" }}>Zotrod 的个人主页</h1>
        <p style={{ color: "#9198a1", lineHeight: 1.7 }}>
          这一页由 Next.js 服务端渲染。下方数据来自 <code>data/*.json</code>，
          在服务器读好后直接写进 HTML，而不是浏览器加载完再请求。
        </p>
      </header>

      <section style={card}>
        <h2 style={h2}>在听 · 服务端注入</h2>
        <p style={dim}>总曲目 {d.music.totalSongs ?? "—"} · 等级 {d.music.level ?? "—"}</p>
        <ol style={{ lineHeight: 2, paddingLeft: 22 }}>
          {d.music.top.length ? d.music.top.map((t, i) => (
            <li key={i}>{t.title || "（无标题）"} <span style={dim}>— {t.artist}</span></li>
          )) : <li style={dim}>暂无数据（已降级，不影响页面）</li>}
        </ol>
      </section>

      <section style={card}>
        <h2 style={h2}>游戏 · 服务端注入</h2>
        <p style={dim}>
          库存物品 {d.games.inventoryTotal ?? "—"} · 识别到游戏 {d.games.appCount ?? "—"} 款 ·
          预览项 {d.previewCount}
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>动态接口</h2>
        <ul style={{ lineHeight: 2 }}>
          <li><a style={link} href="/api/health">/api/health</a> — 运行时自检</li>
          <li><a style={link} href="/api/data/netease">/api/data/netease</a> — 服务端数据</li>
          <li><a style={link} href="/api/data/steam">/api/data/steam</a> — 服务端数据</li>
          <li><code>/api/sync</code> — 预留给 Cron（需 CRON_SECRET）</li>
        </ul>
      </section>

      <footer style={{ marginTop: 32, color: "#6e7681", fontSize: 13, lineHeight: 1.8 }}>
        <div>本页渲染时间（每次请求变化，证明是真 SSR）：<code>{generated}</code></div>
        <div>数据同步时间：{d.updated || "—"}</div>
        <div style={{ marginTop: 8 }}>
          数据来源标记：<code>{d.source}</code>。现有 GitHub Pages 静态站未受影响。
        </div>
      </footer>
    </main>
  );
}

const card = { background: "#161b22", border: "1px solid #30363d",
                borderRadius: 12, padding: "20px 24px", marginBottom: 16 };
const h2 = { fontSize: 18, margin: "0 0 10px", color: "#e6edf3" };
const dim = { color: "#9198a1", fontSize: 14 };
const link = { color: "#58a6ff" };
