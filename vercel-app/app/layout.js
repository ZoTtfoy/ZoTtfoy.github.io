export const metadata = {
  title: "Zotrod · 个人主页",
  description: "Zotrod 的个人主页 —— Vercel SSR 迁移起点",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#0d1117", color: "#e6edf3",
                      fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
