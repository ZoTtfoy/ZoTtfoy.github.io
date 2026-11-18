/** @type {import('next').NextConfig} */
const nextConfig = {
  /* 现有静态站的资源在仓库根的 assets/，SSR 项目在 vercel-app/ 子目录。
     Vercel 部署时把 Root Directory 设为 vercel-app，构建上下文只包含这里，
     所以资源通过 public/ 提供一份（见 README 的同步命令），不跨目录引用。 */
  reactStrictMode: true,
  /* 数据从服务端读 data/*.json，用 Node runtime（Edge 没有 fs） */
  experimental: {},
};

export default nextConfig;
