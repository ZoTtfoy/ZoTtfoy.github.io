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
| `10-shell` | 骨架、背景、翻页 | layout, paged, backdrop（含综合纹章层） |
| `20-components` | 通用组件、动效、皮肤面板 | components, skin, effects, motion |
| `30-sections` | 各屏专属 | profile, link-cards, listen, repair, mailbox, section-media, xianyu, gaming, live, gallery |
| `40-responsive` | **只看视口**的全局分级 | fit（按可用高度分档）, density（按视口密度） |
| `90-overrides` | 卡片语言统一层 + 液态玻璃效果层 | unify |

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

2026-11-13 起文件末尾多一节「液态玻璃效果层」：它叠在白卡语言之上，
变量由 `--bg-elev` / `--line-strong` 用 `color-mix` 实时派生，
所以换主题自动换色。模糊只在 `data-perf="high"` 时启用，
`data-perf="low"` 退化为半透明实底；手机顶栏永不模糊。

## 三、JS：加载顺序即依赖

`config.js` 与 `themes.js` 是**非 defer** 的，在 `<head>` 里同步执行 ——
它们是纯数据，先落地，后面所有模块读它们。其余 18 个 `defer`，
按依赖顺序排列，各自是一个 IIFE，只暴露一个 `window.SITE_XXX`：

```
config, themes          （数据）
icons → core/render-kit → sections/render-profile → sections/render-listen
→ sections/render-gaming → sections/render-repair → sections/render-links
→ render → sync → scale → density → repair → skin → backdrop → live
→ core/perf-tier → steamwall
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
屏模块之间也有先后：`render-repair` 复用 Q1 的 `paintPreviews`，
所以 `render-profile` 必须排在它前面（已经写进 `index.html` 的注释）。

三条规矩：

- 屏模块**不碰** `window.SITE_RENDER`，也不自己往块表里塞条目 ——
  layer 顺序必须在一处可见。
- kit 里**不放业务逻辑**。只有一屏用的函数留在那一屏文件里。
- 需要给外部用的函数才登记；`render.js` 通过 `G.xxx` 转发，对外接口名字不变
  （`sync.js` 仍调 `SITE_RENDER.renderGameStats`，测试仍查 `fn: renderGaming`）。

因为校验脚本里有几条是对渲染层**源码文本**做静态断言的，
`tools/lib/render-src.js` 把 kit + 所有 sections + render.js 拼成一份逻辑源码；
以后再拆一屏，工具不用跟着改。

### 启动：`main.js` 里的一张表

以前是 15 行 `if (window.SITE_X) SITE_X.init()`，中间夹着大段「为什么这个必须在那个
前面」的注释 —— 顺序是语义，但只活在注释里，插错一行没人拦。

现在顺序是数据：`SITE_BOOT` 的 `STEPS` 表，每行 `{ name, mod, fn, why }`，
`why` 只写真正有约束的那几条。加模块 = 表里插一行 + `index.html` 加一个 `<script>`。

四条硬约束（现在由 `tools/verify-boot.js` 断言，不再只是注释）：

1. `render` 第一 —— 它的产物是后面每一步的前提。
2. `scale → density → repair.foldQuote → paged` 依次，一步都不能提前 ——
   任何一步提前，`paged` 量到的都是「还没让位」的旧高度。
3. `live` 早于 `paged` —— 时钟/一言/进度条会撑高首页。
4. `readable` 晚于 `paged` —— 它要读「最终生效」的字号。

`verify-boot` 还守另一类错：页面上凡是暴露了 `init` 的 `SITE_*` 模块，
要么在 `STEPS` 里，要么在 `SELF_INIT` 里写明为什么不用调（比如 `SITE_SYNC`
自己在 `DOMContentLoaded` 里拉数据）。**写了模块忘了启动**这种问题以前只能靠肉眼。

模块间通信只有两种方式：

- **`site:*` 自定义事件**：目前只有 `site:pagechange`（翻页引擎广播）和
  `site:density`（分级变化）。屏外的动画墙靠它停/起。
- **互相调 `refresh()`**：其余情况都是直接调函数。这是**已知的耦合点** ——
  但注意第六节第 3 条：这些调用多数是同步有序的，不能简单合并。

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
npm test              # 30 个脚本 / 2171 项断言，7 分钟
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

### 已知例外

| 脚本 | 状态 | 原因 |
| --- | --- | --- |
| `verify-density` | 超时（220s 无输出） | 既有问题，在更早的快照上同样跑不完；默认跳过 |
| `verify-perf` | ✅ 已转绿（2026-11-13） | 把 `archive/2026-11-12-perf` 的三项搬回来后，按类重算体积（文本/字体/图片分开）、DOM 阈值 1400、滚动 35ms（本机无头是软件渲染，20ms 这条线永远达不到） |

## 六、欠账与下一步

按「投入产出」排序，不是按工作量：

1. **（已完成）`render.js` 按屏拆**：1159 → 394 行，六屏全部搬进
   `sections/render-*.js`（profile / listen / gaming / repair / links），
   `render.js` 只剩外壳（meta / 头像 / 品牌 / 导航 / 控件）+ 块表 + 启动。
   剩下的欠账：`hexToRgba` / `applyAccent` 仍在外壳里，属于主题而非渲染，
   将来可以并进 `skin.js`。
2. **`paged.js`（1027 行）不拆 —— 这是结论，不是偷懒**。评估过「测量 vs 手势」这条缝，
   结论是拆了更糟：手势段（滚轮 170 行 + 触摸 205 行）依赖 `pageTops` / `pendingTop` /
   `programmatic` / `settleTimer` / `snapTimer` / `wheelAcc` / `resizeAnchor` 等
   **十几个共享可变状态**，它们和测量段是同一次状态机的两半。硬拆要么把这些状态
   搬进一个新的状态对象（等于重写一个行为极其微妙的状态机），要么开十几个读写口子
   （比现在更难读）。
   ⇢ 真要降低这个文件的认知负担，先做「把共享状态收进一个 `state` 对象」这一小步，
   等状态边界清楚了再谈拆文件。**不要**为了行数好看去动它。
3. **`core/scheduler.js` ⚠️ 需要重新设计**：原计划是"把一次 resize 放大出的 11 次
   `PAGED.refresh()` 合并成每帧一次"。核对后否掉了这个做法 —— 那些调用是
   **同步且有序**的多轮测量（`refresh → fitQuote → refresh`，中间要读到上一轮的
   真实高度），延后一帧就会量到旧值。真要做，得先把调用点分成两类：
   「下一次读数之前必须完成」和「本帧内可以延后」，只对后者做合并。
4. **（已完成）启动表**：`main.js` 改成 `SITE_BOOT.STEPS` 数据表，
   配 `tools/verify-boot.js`（11 条断言）守顺序和「漏启动」。
   文件没改名 —— `verify-live` / `verify-paged` / `verify.js` 都按
   `assets/js/main.js` 这个路径断言，为了一个文件名去改三处测试不值。
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


## 七、视觉层与设备档位（2026-11-13）

### 判档：只信实测帧，不猜硬件

`core/perf-tier.js` 在 `load` 后 900ms 开始两轮 rAF 采样（每轮 800ms），
记录**平均帧耗时**与**实际帧数 / 慢帧数**；两轮都超标（`avgMs > 22` 或
慢帧占比 > 30% 或帧数 < 12）才判 `low`，写 `data-wall="static"` 停掉两面墙的
滚动，但图一张不少。结论晚于墙的 `init()`，所以提供 `onChange()` 订阅，
墙在**运行中**也能停下 WAAPI 动画。

刻意不看 `hardwareConcurrency` / `deviceMemory` / `effectiveType` / UA：
4 核旗舰与 8 核低端都存在，核心数猜不准，网络慢也不等于渲染慢。

⚠️ **webdriver 环境跳过自动采样**（`navigator.webdriver`）：无头软件栅格化
实测约 24ms/帧，拿它做降级决策会污染全部行为校验，也不代表任何真机。
自检用 `?perf=auto` 显式打开采样链路；`?perf=low|high` 强制档位。

| 参数 | 用途 |
| --- | --- |
| `?perf=low` / `?perf=high` | 强制档位，跳过采样 |
| `?perf=auto` | 在自动化环境里也强制真实采样 |
| `?glass=off` / `?motif=off` | 关掉玻璃 / 综合纹章，做 A/B 与排查 |

### 液态玻璃（第 7 项）

第 8 套主题 `liquid` 只提供**冷调底子**；真正的玻璃在 `unify.css` 末尾统一叠加，
因此 8 套风格 × 2 明暗全部生效。三条硬约束：

1. `backdrop-filter` 只在 `data-perf="high"` 出现，**且只给浮层**
   （`.site-header` / `.pager` / `.skin-panel` / `.mobile-nav`）。A/B 实测：
   逐卡模糊 43.7ms / 关玻璃 25.5ms / 无模糊的玻璃 22.9ms（1440×900 软件渲染滚动）。
   卡片的玻璃感来自半透明底 + 内高光 + 斜向 sheen，不靠糊背景。
   判低时连浮层也不模糊，全部是"半透明实底 + 内高光"。
2. ≤900px 的顶栏永久不模糊 —— 整屏宽的重算是实测过的掉帧大头。
3. 游戏屏 `.game-board` 单独调到 95% 实底：它压在彩色封面墙上，
   20% 透明度会被染成彩虹（截图实测）。这是白卡家族**唯一**的有意例外，
   `verify-unify` 专门守这一条。

### 综合纹章背景（第 9 项）

`backdrop/motif.svg` 画六组线稿：齿轮（维修）/ 波形（音乐）/ 电路（电子）/
芯片（数码）/ 叶片（生活）/ 十字键（游戏），加一层电路走线串起来。
用 CSS `mask-image` 取 alpha、`background-color: var(--text)` 上色 ——
颜色随主题自动换，不用出浅/深两份图；纯静态，零 JS，低端档照常显示。

### 布局（第 8 项）

`fit.css` 的手机断点把每屏顶部缓冲 34→18px、章节标题下边距 40→26px，
每屏内容整体上移约 28px；390×844 仍放 6 首、360×780 放 5 首，无屏退化成可滚动。
玻璃层的通透边界进一步降低了视觉拥挤感。**没有再动行长/字号** ——
每改一次都要重算 paged 档位，而收益低于把一屏内容推到下一档的风险。

### 新增校验

`verify-glass.js`（21 项）、`verify-perf-tier.js`（21 项，含 rAF 打桩模拟 29fps
设备）、`verify.js` 里两条「闲鱼必须是纯文字、不许有图形元素」。
