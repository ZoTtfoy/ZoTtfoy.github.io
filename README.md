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
├── admin.html                    # ★ 内容编辑器（带口令保护，不对外链接）
├── .nojekyll                     # 让 GitHub Pages 不跳过下划线目录
├── .github/workflows/deploy.yml  # 推送后自动部署，一般不用动
├── assets/
│   ├── css/
│   │   ├── tokens.css            # ★ 配色、字体、圆角、间距等设计变量
│   │   ├── layout.css            # 布局、栅格、响应式断点
│   │   ├── components.css        # 按钮、卡片、标签等组件外观
│   │   ├── motion.css            # 入场动画、悬停反馈、背景动效
│   │   └── admin.css             # 编辑器专用样式
│   └── js/
│       ├── config.js             # ★★ 所有文案、链接、模块开关（内容都在这里）
│       ├── icons.js              # 内联 SVG 图标库，可自行增删
│       ├── render.js             # 把 config 的数据填进页面
│       ├── motion.js             # 滚动、主题、菜单、复制等交互
│       ├── main.js               # 启动入口
│       └── admin.js              # ★ 编辑器逻辑 + 访问凭据（哈希）
├── tools/
│   ├── verify.js                 # 站点自检：node tools/verify.js
│   └── verify-admin.js           # 编辑器自检：node tools/verify-admin.js
└── README.md
```

> **改内容两条路，任选：**
> 1. **图形化**：打开 `/admin.html`，登录后点选修改 → 发布（推荐，手机也能用）。
> 2. **改文件**：直接编辑 `assets/js/config.js`。
>
> **想换整体气质（配色 / 圆角 / 字体）→ 动 `assets/css/tokens.css`。**
> 其余文件除非要改结构或交互，一般不需要碰。

---

## 三、内容编辑器（admin.html）

访问 `https://你的域名/admin.html`（或本地打开 `admin.html`）。

- **账户与口令**：首次交付时随项目一起给你，记在仓库外的 `管理凭据.txt`（本地文件，不会上传到 GitHub）。源码里只有盐和哈希，没有明文。
- 登录后可改：站点信息、合作状态、首页按钮、四个模块的标题与开关顺序、关于我（段落 / 信息表 / 标签）、业务卡片、喜好卡片、社交链接、主题色与动效开关。
- 卡片类内容支持**添加 / 删除 / 上下移动**。
- 改动先存在本机浏览器（草稿），点「发布」时生成新的 `config.js`，三种上线方式：网页里粘贴到 GitHub、下载后本地提交、或填一个 GitHub 令牌一键推送。

### 凭据是怎么存的

源码里**没有口令明文**，只存 `salt + SHA-256` 的摘要（`assets/js/admin.js` 顶部）。校验在本机完成。

需要说清楚的是它的边界：这是**入口锁**，挡的是顺手点开乱改，不是密码学意义上的安全防护——有能力读源码的人可以绕过它。真正决定谁能改线上内容的，是你的 **GitHub 账号**：没有仓库写权限，改什么都传不上去。所以这层锁的定位是「防误碰 + 防好奇」，不是「防攻击」。

### 改账户或口令

1. 进编辑器 → 发布抽屉 → 底部「更改管理账户 / 口令」→ 填新账户与口令 → 生成。
2. 把生成的三行替换到 `assets/js/admin.js` 顶部的 `ADMIN` 区块。
3. commit 一次，所有设备同步生效（只在编辑器里填、不提交则仅本机有效，因为本地覆盖存在浏览器里）。

> 新建 GitHub 令牌时，建议用 *Fine-grained token*，只授权这一个仓库的 **Contents: Read and write**，用完可随时撤销。令牌只存在本机浏览器，不会随代码上传。
>
> 万一凭据文件丢了：直接生成一套新的替换掉即可，旧口令立即失效，不需要「找回」。

---

## 三之二、编辑器自检

```bash
node tools/verify-admin.js
```

它会核对：SHA-256 实现与 Node 原生结果**逐位一致**（含中文、长文本边界）、摘要格式、错误口令被拒、`ADMIN` 区块不含明文、序列化后与源数据**深比较无损**、序列化幂等、`admin.html` 引用的资源齐全。若仓库外存在 `管理凭据.txt`，还会顺手校验那份口令确实能通过。

---

## 四、改内容（config.js 字段速查）

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
| `social` | `items[]` | 平台链接：`icon` / `label` / `handle` / `url`；没有公开主页的（QQ、微信）用 `copy` 代替 `url`，点一下即复制 |
| | `contactHint` | 底部联系区那句提示语 |
| `ui` | `themeDefault` | `auto` 跟随系统 / `light` / `dark` |
| | `showProgress` / `showBackToTop` | 滚动进度条、回到顶部按钮 |
| | `ambientMotion` | 背景光晕是否缓慢流动 |
| | `showThemeToggle` | 右上角深浅主题切换按钮 |

### 常用操作

- **删掉一个平台 / 一张卡片**：在对应 `items` 数组里删掉那一整个 `{ ... }` 就行，栅格会自动重排。
- **加一张卡片**：复制一份 `{ ... }` 改内容。
- **QQ / 微信号**：写成 `{ icon: "qq", label: "QQ", handle: "点一下复制", copy: "你的号码" }`，卡片会变成可点击复制，不会出现打不开的链接。
- **换图标**：把 `icon` 改成 `icons.js` 顶部注释里列出的任意名字；找不到会自动回退成 ✦ 图标。
- **隐藏整个模块**：`sections.xxx.enabled = false`。
- **换主题色**：优先在编辑器「外观」里改（会写进 config 的 `ui.accent` / `ui.accentDark`）；想连背景灰阶一起调，改 `tokens.css`。
- **自定义域名**：在根目录新建 `CNAME` 文件，内容写一行你的域名，DNS 加一条 CNAME 指向 `<用户名>.github.io`，再去仓库 Settings → Pages 填 Custom domain。

> `config.js` 里目前带「示例」性质的文案（业务、爱好、邮箱、社交链接）都是占位内容，记得换成你自己的。

### 改完自检一下

```bash
node tools/verify.js          # 站点：渲染 / 图标 / 资源 / 降级
node tools/verify-admin.js    # 编辑器：口令哈希 / 序列化无损 / 资源引用
```

不需要安装任何依赖。`verify.js` 会在模拟浏览器环境里真实执行一遍页面脚本，检查：图标名有没有拼错、卡片 / 导航数量是否与配置一致、模块开关与排序是否生效、引用的 CSS / JS 是否齐全、旧浏览器降级是否正常。`verify-admin.js` 会核对 SHA-256 实现与 Node 原生结果逐位一致、编辑器生成的 `config.js` 与源数据深比较无损。全部通过会输出 `全部通过`。

---

## 五、模块结构约定

四个模块都是「标题三件套 + 内容」，在 `index.html` 里各有独立 `<section data-section="xxx">`：

```
标题三件套   eyebrow（01 / ABOUT 这类小标签） + title + lead
关于个人     paragraphs 段落 · facts 信息表 · tags 关键词
业务范畴     items[] 卡片：icon / title / desc / tags
个人喜好     items[] 卡片：icon / title / desc / meta
社交平台     items[] 卡片：icon / label / handle / url（或 copy） + contactHint
```

要新增一个模块：复制一个 `<section>` 骨架 → 在 `config.js` 的 `sections` 里加一项 → 在 `render.js` 加一个渲染函数。导航、开关、排序会自动跟上。

---

## 六、部署到 GitHub Pages

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

## 七、适配与细节

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

## 八、常见问题

**改了 config.js 但页面没变？**
先强制刷新（Ctrl/Cmd + Shift + R）。线上请确认 `git push` 成功、Actions 显示绿色对勾，再等 1–2 分钟。

**Actions 失败 / 页面 404？**
检查 Settings → Pages 的 Source 是否为 **GitHub Actions**（不是 "Deploy from a branch"），以及仓库是否为 Public（或账号具备 Pages 权限）。

**本地双击打开和线上不一样？**
`file://` 下浏览器对部分 API 有限制（例如剪贴板）。用 `python -m http.server 8000` 起本地服务即可完全一致。

**想恢复「跟随系统主题」？**
在浏览器控制台执行 `localStorage.removeItem('zotrod-theme')` 后刷新。
