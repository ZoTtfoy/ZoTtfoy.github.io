# Zotrod · 个人主页

一个零依赖、零构建的静态个人主页。纯 HTML / CSS / JavaScript，直接托管在 GitHub Pages 上，手机、平板、电脑都能访问。

**设计目标：极简、克制、动效顺滑，且以后改起来不费劲。**

---

## 一、先看一眼效果

三种方式，任选其一：

| 方式 | 操作 |
| --- | --- |
| 最快 | 双击 `index.html`，浏览器直接打开 |
| 推荐（最贴近线上） | 在本目录运行 `python -m http.server 8000`，然后打开 `http://localhost:8000` |
| 部署后 | 手机 / 平板 / 任何电脑打开 `https://<你的GitHub用户名>.github.io/` |

不需要 `npm install`，不需要打包，不需要联网加载字体或图标。

---

## 二、目录结构：改哪个文件

```
zotrod-homepage/
├── index.html                    # 页面骨架（结构 / 语义标签 / 区块容器）
├── .nojekyll                     # 让 GitHub Pages 不跳过下划线目录
├── .github/workflows/deploy.yml  # 推送后自动部署，一般不用动
├── assets/
│   ├── css/
│   │   ├── tokens.css            # ★ 配色、字体、圆角、间距等设计变量
│   │   ├── layout.css            # 布局、栅格、响应式断点
│   │   ├── components.css        # 按钮、卡片、标签等组件外观
│   │   └── motion.css            # 入场动画、悬停反馈、背景动效
│   └── js/
│       ├── config.js             # ★★ 所有文案、链接、模块开关（日常只改这个）
│       ├── icons.js              # 内联 SVG 图标库，可自行增删
│       ├── render.js             # 把 config 的数据填进页面
│       ├── motion.js             # 滚动、主题、菜单、复制等交互
│       └── main.js               # 启动入口
├── tools/
│   └── verify.js                 # 自检脚本：node tools/verify.js
└── README.md
```

> **日常改内容 → 只动 `assets/js/config.js`。**
> **想换整体气质（配色 / 圆角 / 字体）→ 动 `assets/css/tokens.css`。**
> 其余文件除非要改结构或交互，一般不需要碰。

---

## 三、改内容（config.js 字段速查）

| 位置 | 字段 | 作用 |
| --- | --- | --- |
| `site` | `name` / `initials` / `role` | 名字、方块头像字母、身份一行字 |
| | `tagline` | 首页大标题，`\n` 表示换行 |
| | `description` | 首页简介，同时也是搜索结果摘要 |
| | `location` / `email` | 坐标（显示在移动端菜单底部）、联系邮箱 |
| | `available` / `availableText` | 「开放合作」小绿点，不想显示就设 `false` |
| | `copyright` / `footerNote` | 页脚文字 |
| `sections` | `enabled` | `false` = 整块隐藏，导航栏也会自动去掉 |
| | `order` | 显示顺序，数字小的在前 |
| | `label` | 导航栏文字 |
| `hero` | `primary` / `secondary` | 首页两个按钮的文字和跳转目标 |
| `about` | `paragraphs` / `facts` / `tags` | 正文段落、右侧信息表、关键词标签 |
| `services` | `items[]` | 业务卡片：`icon` / `title` / `desc` / `tags` |
| `interests` | `items[]` | 喜好卡片：`icon` / `title` / `desc` / `meta` |
| `social` | `items[]` | 平台链接：`icon` / `label` / `handle` / `url` |
| | `contactHint` | 底部联系区那句提示语 |
| `ui` | `themeDefault` | `auto` 跟随系统 / `light` / `dark` |
| | `showProgress` / `showBackToTop` | 滚动进度条、回到顶部按钮 |
| | `ambientMotion` | 背景光晕是否缓慢流动 |
| | `showThemeToggle` | 右上角深浅主题切换按钮 |

### 常用操作

- **删掉一个平台 / 一张卡片**：在对应 `items` 数组里删掉那一整个 `{ ... }` 就行，栅格会自动重排。
- **加一张卡片**：复制一份 `{ ... }` 改内容。
- **换图标**：把 `icon` 改成 `icons.js` 顶部注释里列出的任意名字；找不到会自动回退成 ✦ 图标。
- **隐藏整个模块**：`sections.xxx.enabled = false`。
- **换主题色**：改 `tokens.css` 里的 `--accent`（浅色 / 深色各一处）。
- **自定义域名**：在根目录新建 `CNAME` 文件，内容写一行你的域名，DNS 加一条 CNAME 指向 `<用户名>.github.io`，再去仓库 Settings → Pages 填 Custom domain。

> `config.js` 里目前带「示例」性质的文案（业务、爱好、邮箱、社交链接）都是占位内容，记得换成你自己的。

### 改完自检一下

```bash
node tools/verify.js
```

不需要安装任何依赖。它会在模拟浏览器环境里真实执行一遍页面脚本，检查：图标名有没有拼错、卡片 / 导航数量是否与配置一致、模块开关与排序是否生效、引用的 CSS / JS 是否齐全、旧浏览器降级是否正常。全部通过会输出 `全部通过`。

---

## 四、部署到 GitHub Pages

### 1. 创建仓库并推送

推荐用**用户名站点**，地址最短：`https://<用户名>.github.io/`

```bash
cd zotrod-homepage

git init
git add .
git commit -m "init: personal homepage"

# 把 <用户名> 换成你自己的 GitHub 用户名，仓库名必须是 <用户名>.github.io
gh repo create <用户名>.github.io --public --source=. --remote=origin --push
```

也可以用**项目站点**（仓库名任意，例如 `homepage`），访问地址会是 `https://<用户名>.github.io/homepage/`：

```bash
gh repo create homepage --public --source=. --remote=origin --push
```

> 站点内所有资源都用相对路径，锚点也是页内跳转，所以两种形式都不用改代码。

### 2. 打开 Pages（只需一次）

进入仓库 → **Settings** → **Pages** → *Build and deployment* → **Source** 选 **GitHub Actions**。

`deploy.yml` 会在每次 `git push` 后自动打包部署，通常 1–2 分钟生效。第一次可以在 **Actions** 标签页看进度。

### 3. 以后怎么更新

```bash
# 改完 config.js 之后
git add .
git commit -m "update: 修改业务介绍"
git push
```

推完等一会儿刷新即可，不用手动重新部署。

---

## 五、适配与细节

| 断点 | 布局 |
| --- | --- |
| ≥ 1025px 电脑 | 关于两栏、业务 2 列、喜好 / 社交 3 列，桌面导航 |
| 901–1024px 小笔记本 / 平板横屏 | 喜好 / 社交降为 2 列 |
| ≤ 900px 平板竖屏 | 桌面导航收成汉堡菜单，关于改单栏 |
| ≤ 680px 手机 | 全部单列，字号流式缩放，按钮撑满，隐藏滚动提示 |
| ≤ 380px 小屏手机 | 进一步压缩标题字号 |

其他已内置：

- 浅色 / 深色主题，默认跟随系统，手动选择会记住；切换有平滑过渡且刷新不闪白屏。
- 尊重系统的「减少动态效果」设置：开启后所有动画自动关闭，内容直接显示。
- 触控设备不启用悬停位移，改为按压反馈；hover 效果只在鼠标设备上生效。
- 语义化标签、键盘焦点态、跳转主内容链接、ARIA 标签；`prefers-reduced-motion` 完整支持。
- 图标全部内联 SVG，无外部字体 / CDN / 追踪脚本，离线也能正常显示。
- 打印样式会自动去掉导航、光晕等装饰。

---

## 六、常见问题

**改了 config.js 但页面没变？**
先强制刷新（Ctrl/Cmd + Shift + R）。线上请确认 `git push` 成功、Actions 显示绿色对勾，再等 1–2 分钟。

**Actions 失败 / 页面 404？**
检查 Settings → Pages 的 Source 是否为 **GitHub Actions**（不是 "Deploy from a branch"），以及仓库是否为 Public（或账号具备 Pages 权限）。

**本地双击打开和线上不一样？**
`file://` 下浏览器对部分 API 有限制（例如剪贴板）。用 `python -m http.server 8000` 起本地服务即可完全一致。

**想恢复「跟随系统主题」？**
在浏览器控制台执行 `localStorage.removeItem('zotrod-theme')` 后刷新。
