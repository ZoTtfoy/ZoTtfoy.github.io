# Vercel SSR 迁移起点（隔离目录）

这是把现有静态站迁到 Vercel 动态托管的 **Next.js App Router 版本**，放在独立子目录，
仓库根的 `index.html` / GitHub Pages 站点 **一行都没动**。两个版本可以并行存在、随时回退。

## 现在能做什么

| 能力 | 路径 | 说明 |
|---|---|---|
| SSR 首页 | `/` | 服务端读 `data/*.json` 后直接渲染进 HTML，`curl` 就能看到数据 |
| 运行时自检 | `/api/health` | 返回 Node 版本、region、环境 |
| 动态数据 API | `/api/data/{netease\|steam\|previews}` | 白名单只读，60s 边缘缓存 |
| Cron 端点 | `/api/sync` | 受 `CRON_SECRET` 保护；当前只核对数据是否就绪 |

`app/page.js` 里 `export const dynamic = "force-dynamic"`，每次请求都重新读数据。
页面底部会打印本次渲染时间 —— 刷新会变，用来确认确实是服务端渲染而非静态导出。

## 本地运行

```bash
cd vercel-app
npm install
npm run dev          # http://localhost:3000
npm run build && npm run start   # 生产构建验证
```

## 部署到 Vercel 需要准备什么

### 1. 账号与项目
- Vercel 账号（用 GitHub 登录，授权访问 `ZoTtfoy/ZoTtfoy.github.io`）。
- 新建 Project 时 **Root Directory 填 `vercel-app`** —— 这一步最关键，因为 Next.js 项目不在仓库根。
- Framework Preset 会自动识别为 Next.js，不用手写 build command。

### 2. 环境变量（Project Settings → Environment Variables）
- `CRON_SECRET`：一串长随机字符串。Vercel 调用 Cron 时会自动带
  `Authorization: Bearer <CRON_SECRET>`，函数里据此拒绝外部调用。
- 目前**不需要** `NETEASE_COOKIE` / `STEAM_API_KEY` / `STEAM_ID`：真实抓取仍由
  GitHub Actions 负责（原因见下）。只有将来把抓取搬进函数时才需要它们。

### 3. 域名
- 先用免费的 `*.vercel.app` 验证；确认无误后把现用域名 DNS 切到 Vercel。
- 切换前建议保留 GitHub Pages 不动，出问题把 DNS 改回去即可。
- Vercel 会自动签发 HTTPS 证书。

### 4. 计划选择
- **Hobby（免费）**：仅限**非商业个人用途**。这个个人主页符合。
  含 100GB 流量 / 100 万次函数调用 / 4 CPU-hrs，绰绰有余。
- Hobby 的 Cron **每天最多跑一次**，且只在指定小时内的随机时刻触发 ——
  正好和现有 `.github/workflows/sync.yml` 的每天 UTC 02:10 对齐。
- 若将来接广告、带货、或以盈利为目的，必须升 Pro（$20/月起）。

## 已知障碍（重要，决定架构取舍）

### ① 不要直接把同步脚本搬进 Serverless Function
`scripts/sync-steam.mjs` 开头写得很清楚：Steam 库存接口对裸 `fetch` 做
**TLS 指纹拦截**，必须用真实浏览器才能拿到 200。在 Serverless 里跑 Chromium
需要 `@sparticuz/chromium` + ≥1600MB 内存 + 大体积函数包，Hobby 上不划算，
且冷启动慢、易超时。

**推荐架构（本项目采用）**：保留 GitHub Actions 抓数据 → 提交 `data/*.json`
→ Vercel 检测到 push 自动重新部署。Vercel 只负责「动态渲染 + 动态 API」，
抓取仍交给擅长跑浏览器的 CI。两边各做各擅长的事。

### ② 数据副本需要同步
Vercel 的构建上下文只有 `vercel-app/`，读不到仓库根的 `data/`。
所以这里放了一份 `vercel-app/data/*.json`。CI 同步完根目录数据后，需要把
三份文件复制进来再提交，否则 Vercel 上的数据会停在旧版本。
可选做法：在 `sync.yml` 末尾加一步 `cp data/*.json vercel-app/data/`，
或者改由 `/api/data/*` 直接回源到 GitHub Raw（会引入额外网络依赖）。

### ③ 这不是「整站重写完成」
现有静态站有 6 屏翻页、25 个原生 JS 模块、21 个 CSS、37 套自检脚本、
主题/皮肤系统、视差与陀螺仪、后台管理等。这个目录只实现了
**SSR 骨架 + 动态数据 + API**，用于验证 Vercel 可行性并作为迁移起点。
完整迁移需要逐屏把交互搬成 React 组件，并把 `assets/` 迁进 `public/`，
工作量远大于一次改动，建议分批进行并逐批保留现有测试。

## 回退
删掉这个目录即可；仓库根和 GitHub Pages 完全不受影响。
