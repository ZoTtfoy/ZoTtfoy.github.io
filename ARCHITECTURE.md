# 架构说明

> 这份文件回答「东西都在哪、为什么这么放、改了要跑什么」。
> 讲设计与取舍的细节看 `README.md`（2000 行，按屏讲），这份只讲结构。

## 一句话

六屏翻页式静态站：没有构建步骤，浏览器直接吃源码。
Node 只用于「同步数据」和「跑校验」两件事，不参与出包。

## 三条不变量

改动任何时候都要维持，破坏其中一条就是 bug，不是风格问题：

1. **首屏不依赖 JS**。内容在 `index.html` 里有静态骨架，`config.js` 再填。
   JS 全挂时页面仍可读（`<html class="js">` 由脚本摘掉，样式随之降级）。
2. **CSS 的加载顺序是契约**。目录代表分类，`<link>` 顺序代表层叠依赖，两者不一致的地方
   都有注释写明原因。改顺序前必须跑视觉基线。
3. **一屏装得下**。翻页引擎按「可用高度」定档，任何改高度/字号的改动都要在
   390×844 与 360×780 上复核，`verify-paged` 与 `verify-devices` 是这条的闸门。

---

## 一、目录分层

```
index.html  admin.html  themes.html      # 三个入口，各自一份 <link> 清单
assets/css/                              # 六层，见第二节
assets/js/                               # 18 个 IIFE 模块 + 2 个必须先加载的配置
data/*.json                              # 同步产物（GitHub Actions 每天写）
scripts/                                 # 同步脚本（Node 原生，无依赖）
tools/                                   # 校验与开发工具（不进产物）
```

`assets/js/` 按「加载批次」而不是按功能分目录 —— 因为顺序真的是语义，
放进子目录会诱导人按目录名重排 `<link>`／`<script>`。这条是有代价的选择：
18 个平铺文件肉眼不好扫，但换来「顺序错了立刻炸」比「顺序错了半年后才发现」好。

## 二、CSS 六层与层叠契约

| 目录 | 职责 | 文件 |
| --- | --- | --- |
| `00-base` | 变量、字体、字重阶梯 | tokens, typography |
| `10-shell` | 骨架、背景、翻页 | layout, paged, backdrop |
| `20-components` | 通用组件、动效、皮肤面板 | components, skin, effects, motion |
| `30-sections` | 各屏专属 | profile, link-cards, listen, repair, mailbox, section-media, xianyu, gaming, live, gallery |
| `40-responsive` | **只看视口**的全局分级 | fit（按可用高度分档）, density（按视口密度） |
| `90-overrides` | 卡片语言统一层 | unify |

**实际的加载顺序**（与目录名顺序不同，见 `index.html` 顶部注释）：

```
fonts → tokens → backdrop → layout → components → [30-sections 七连] → skin
      → paged → gaming → fit → live → effects → motion → density
      → typography → unify
```

三处「故意错位」，都有原因，动之前先读 `index.html` 的注释：

- `paged.css` 归 shell 但排在 sections 之后 —— `.section` 高度要压得住各屏自己的规则。
- `typography.css` 归 base 但排在 unify 之前 —— 它的职责是统一前面散落的字重字面量。
- `section-media.css` 属于**屏内断点**，留在 `30-sections`；`40-responsive` 只装
  「只看视口」的分级。两层媒体查询分开，才不会互相压。

`90-overrides/unify.css` 是**设计系统层**，不是补丁堆：它只定义「白卡」这一个概念
（`--bg-elev` 底 + 1px `--line` 边 + 一次写全的过渡），并给出全站可读性兜底钩子。
不要往里加屏专属规则。

## 三、JS：加载顺序即依赖

`config.js` 与 `themes.js` 是**非 defer** 的，在 `<head>` 里同步执行 ——
它们是纯数据，先落地，后面所有模块读它们。其余 18 个 `defer`，
按依赖顺序排列，各自是一个 IIFE，只暴露一个 `window.SITE_XXX`：

```
config, themes          （数据）
icons → core/render-kit → sections/render-listen → sections/render-gaming → render
→ sync → scale → density → repair → skin → backdrop → live → steamwall
→ albumwall → preload → player → paged → readability → effects
→ motion → main
```

### 渲染层：core / sections / render.js

原生 `<script>` 之间没有共享闭包，把 `render.js` 按屏拆开之后，
原来 IIFE 内部的 `esc` / `$` / `icon` 这些局部函数就互相看不见了。
解法是给**唯一一个**命名空间 `window.SITE_RENDER_KIT`：

| 角色 | 文件 | 职责 |
| --- | --- | --- |
| 底座 | `core/render-kit.js` | 7 个小工具 + `parts` 登记表 + `register()` |
| 屏模块 | `sections/render-*.js` | 该屏的全部渲染函数；末尾 `K.register(name, {…})` 只登记对外接口 |
| 收口 | `render.js` | 块表（`BLOCKS` / `layer`）、逐块 try/catch、`data-render` 标记、`?render=` 调试开关 |

**顺序是契约**：kit → 所有屏模块 → `render.js`。反了就找不到 `parts`，
`render.js` 里的 `var G = K.parts.gaming` 直接是 undefined。

三条规矩：

- 屏模块**不碰** `window.SITE_RENDER`，也不自己往块表里塞条目 ——
  layer 顺序必须在一处可见。
- kit 里**不放业务逻辑**。只有一屏用的函数留在那一屏文件里。
- 需要给外部用的函数才登记；`render.js` 通过 `G.xxx` 转发，对外接口名字不变
  （`sync.js` 仍调 `SITE_RENDER.renderGameStats`，测试仍查 `fn: renderGaming`）。

因为校验脚本里有几条是对渲染层**源码文本**做静态断言的，
`tools/lib/render-src.js` 把 kit + 所有 sections + render.js 拼成一份逻辑源码；
以后再拆一屏，工具不用跟着改。

`main.js` 的 `boot()` 是唯一的启动点，里面有四条硬约束（写在那里，别复制走）：

1. `scale` 第一个 —— 它改根字号，后面所有测量都以它为基准。
2. `density` 第二个 —— 它写 `<html data-vp>`，决定哪些装饰退场，直接影响屏高。
3. `repair.foldQuote()` 第三 —— 问 density 要不要折叠报价表，Q4 高度的大头。
4. `paged.init()` 最后测量 —— 任何一步提前，量到的都是「还没让位」的旧高度。

模块间通信只有两种方式：

- **`site:*` 自定义事件**：目前只有 `site:pagechange`（翻页引擎广播）和
  `site:density`（分级变化）。屏外的动画墙靠它停/起。
- **互相调 `refresh()`**：其余情况都是直接调函数。这是**已知的耦合点**，
  也是下一步要收的地方（见第六节）。

## 四、数据流

```
config.js（文案/开关，随仓库）
   ↓  render.init()
index.html 的骨架被填满
   ↓  sync.init() 拉 data/*.json（网易云 / Steam / 摘要卡）
成功 → 覆盖；失败 → 保留 config 的兜底值，静默降级
```

`data/*.json` 由 `.github/workflows/sync.yml` 每天写一次，本地 `tools/` 里的校验
一律读真实文件，所以**离线跑测试也能看到真实数据**。

## 五、校验闸门

```bash
npm test              # 25 个脚本 / 约 1990 项断言，7 分钟
npm run test:list     # 看看会跑哪些
npm run test:all      # 连已知超时/已知红项一起跑
npm run serve         # 本地 8791
npm run baseline:check  # 12 张视觉基线（需先 baseline:make）
```

`tools/run-all.js` 会自己起一个 Node 静态服务器（`tools/serve.js`，零依赖、
并发够拉上百张封面），跑完自动关掉。想复用已在跑的服务加 `--no-server`。

**哪些改动必须跑视觉基线**：

- 动 CSS 的加载顺序、拆/并 CSS 文件
- 动 `unify.css`、`fit.css`、`density.css` 这类「最后一层」
- 动 `render.js` 产出的 DOM 结构
- 结论要求：12 张全部 ≤ 0.30%，且大多数应为 0.000%

基线本身的可信度也要维护：`visual-baseline.js` 冻结了无限循环动画的相位、
时钟、进度条、一言。同版本连拍两次的噪声底约 0.07%（首页深色桌面档），
**超过 0.1% 就该怀疑是真差异**。

### 已知的两项例外

| 脚本 | 状态 | 原因 |
| --- | --- | --- |
| `verify-density` | 超时（220s 无输出） | 既有问题，在更早的快照上同样跑不完；默认跳过 |
| `verify-perf` | 6 项超预算 | 预算是**演进目标**不是当前状态：退回 `ab927bc` 后封面墙又变成 120 张 `<img>`。修法见 `archive/2026-11-12-perf` 分支，等架构收完再搬 |

## 六、欠账与下一步

按「投入产出」排序，不是按工作量：

1. **（进行中）`render.js` 按屏拆**：Q3 游戏屏、Q2 在听屏已分别搬进
   `sections/render-gaming.js` / `render-listen.js`，`render.js` 从
   1159 → 580 行。接缝（kit + register + 块表收口）已跑通并复用了两次，
   下一刀搬 Q1 身份区 → Q4 维修 → Q5/Q6 → 外壳（meta/brand/sections/controls）。
   ⚠️ 剩下几屏有跨屏调用（`paintPreviews` 被 Q4 用、`pad2` 被 `renderSections` 用），
   搬的时候要么一起搬、要么显式走 `K.parts.<屏>.<函数>` —— 别偷偷改成全局变量。
   每搬一屏跑一次 `npm test` + 视觉基线。
2. **`paged.js`（1027 行）拆出测量与手势**：测量（`pickFit` / `foldQuote` / 定档）
   和手势（滚轮/触摸/键盘）是两件事，耦合在一个文件里导致谁都改不动。
3. **引入 `core/scheduler.js`**：现在模块之间靠互相调 `refresh()` 通知，
   一次 resize 能放大成 11 次 `PAGED.refresh()`。改成订阅制，谁关心谁登记。
4. **`main.js` → `core/boot.js` + 显式依赖表**：把「顺序即依赖」从注释变成数据结构。
5. **死选择器清理**：`.card` / `.interest` / `.game`（`gaming.css` 头部已注明
   `.game` 那套样式被删除，但 `paged.css` / `motion.css` / `tokens.css` 里还留着
   选择器列表项）。需要先做一次「HTML + JS 生成的 class 全集」比对，别凭感觉删。
6. **性能搬回**：`archive/2026-11-12-perf` 里有实测有效的六项
   （屏外动画停车、墙面预渲染 WebP、`rootMargin 0px`、顶栏状态收敛等），
   逐项 cherry-pick，每搬一项跑一次 `verify-perf` 与视觉基线。

## 七、改东西的三条路

1. **图形化**：`/admin.html`，登录后点选修改 → 发布（手机也能用）。
2. **改文件**：`assets/js/config.js`（文案/链接/开关都在这里）。
3. **换风格**：右上角调色板，或 `themes.html` 并排对比后应用；
   配色/圆角/字体在 `assets/js/themes.js`。
