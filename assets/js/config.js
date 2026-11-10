/* ==========================================================================
 *  Zotrod · 个人主页  ——  唯一需要修改的文件
 * --------------------------------------------------------------------------
 *  页面一共 6 屏，从上往下翻：
 *
 *    Q1  我          hero + profile    名字 / 头像 / QQ / 微信 / 网易云 + 小黑盒 摘要卡
 *    Q2  在听        listen            网易云最近播放（由仓库的定时任务自动同步）
 *    Q3  游戏        gaming            游戏卡片，只有 图标 + 名称 + ID
 *    Q4  维修        repair            闲鱼摘要卡 + 报价表 + 价格计算器
 *    Q5  其他        links             其余社交平台
 *    Q6  邮箱        contact           邮箱
 *
 *  ▸ 改完保存、刷新即可，不需要打包，不需要装任何东西。
 *  ▸ true / false 是开关；order 数字小的排前面。
 *  ▸ 标了 ★ 的字段是占位示例，上线前请换成你自己的。
 *  ▸ 图标名可选列表见 assets/js/icons.js 顶部注释。
 * ========================================================================== */

window.SITE_CONFIG = {

  /* ================================================================ 基础 */
  site: {
    name: "Zotrod",                          // ★ 你的名字（首屏大标题、页头、标签页）
    initials: "Z",                           // 没有头像图片时，方块里显示的字母
    avatar: "",                              // ★ 头像：填图片地址（或用编辑器上传，自动压缩）
    role: "独立开发者 / 维修师",               // ★ 名字下面那行身份
    description: "Zotrod 的个人主页 —— 联系方式、最近在听、在玩的游戏，以及维修报价。",
    location: "中国 · 上海",                  // ★ 坐标
    email: "hello@example.com",              // ★ 邮箱（Q6 整屏都是它，页脚也可一键复制）
    copyright: "© 2026 Zotrod",
    footerNote: "手写 HTML / CSS / JS · 托管于 GitHub Pages"
  },

  /* ====================================================== 模块开关与顺序 */
  // enabled: false 整块隐藏；order 小的排前面；label 是导航文字。
  // 注意：Q1（首屏）不在这里，它是 hero，永远第一屏。
  sections: {
    listen:  { enabled: true, order: 1, label: "在听" },
    gaming:  { enabled: true, order: 2, label: "游戏" },
    repair:  { enabled: true, order: 3, label: "维修" },
    links:   { enabled: true, order: 4, label: "其他" },
    contact: { enabled: true, order: 5, label: "邮箱" }
  },

  /* ============================================================ Q1 · 我 */
  // 首屏只做一件事：让访客在 3 秒内知道「你是谁、怎么找到你、你的主页长什么样」。
  profile: {
    greet: "你好，我是",                      // 名字上方的小字
    tagline: "把复杂的东西，做得简单一点。",    // 名字下面的一行副标题
    // 简介：2~3 句就够。太长会把 QQ / 微信挤到屏幕外。
    intro: "白天写代码，晚上拆机器。喜欢把模糊的想法变成能真正跑起来、也经得起细看的东西。这里放着我常待的地方、在听的歌，和一份还算透明的维修报价。",

    // ---- 直接联系方式：点一下就复制 ----
    contacts: [
      { icon: "qq",     label: "QQ",   value: "100000000", hint: "点击复制" },   // ★
      { icon: "wechat", label: "微信", value: "zotrod",    hint: "点击复制" }    // ★
    ],

    // ---- 两个主页的摘要卡 ----
    // 卡片上的文字会**自动**被 data/previews.json 覆盖（由 GitHub Actions 抓取）。
    // 抓不到时就用下面填的兜底文案，所以这里先写清楚也能直接用。
    //   cover 填了图片 → 显示成带封面的缩略图卡；留空 → 显示成纯文字信息卡。
    previews: [
      {
        id: "netease",                        // 与 data/previews.json 的键对应，别改
        icon: "netease",
        platform: "网易云音乐",
        url: "https://music.163.com/#/user/home?id=000000000",   // ★ 你的网易云主页
        title: "我的音乐主页",
        meta: "歌单 · 红心 · 最近在听",
        cover: "",                            // 可选：封面图地址
        stats: [],
        accent: "#c20c0c"
      },
      {
        id: "xiaoheihe",
        icon: "box",
        platform: "小黑盒",
        url: "https://www.xiaoheihe.cn/app/user/profile/000000",  // ★ 你的小黑盒主页
        title: "我的小黑盒",
        meta: "游戏库 · 时长 · 战绩",
        cover: "",
        stats: [],
        accent: "#ff6b35"
      }
    ]
  },

  /* ========================================================== Q2 · 在听 */
  listen: {
    eyebrow: "02 / LISTENING",
    title: "最近在听",
    lead: "网易云最近播放，由仓库的定时任务自动同步。",
    // ★ 你的网易云数字 UID：打开 music.163.com → 点头像进主页 → 地址栏 id= 后面那串数字
    //   这个 UID 同时也是同步脚本要用的，两边填一致。
    neteaseUid: "000000000",
    // 同步脚本的输出文件。抓不到就自动退回下面的 fallback，页面不会空着。
    dataFile: "data/netease.json",
    limit: 6,                                 // 最多显示几首
    // 兜底曲目：只在同步数据缺失时出现，随手填几首你常听的即可。
    fallback: [
      { title: "示例曲目一", artist: "示例歌手", album: "示例专辑" },
      { title: "示例曲目二", artist: "示例歌手", album: "示例专辑" },
      { title: "示例曲目三", artist: "示例歌手", album: "示例专辑" }
    ]
  },

  /* ========================================================== Q3 · 游戏 */
  // 只列卡片，不写介绍。想加游戏直接往 items 里加一项。
  gaming: {
    eyebrow: "03 / GAMES",
    title: "在玩什么",
    lead: "ID 都在下面，点一下就能复制。",
    items: [
      {
        icon: "tower",                        // 内置图标名
        iconImage: "",                        // ★ 想用自己的图：填图片地址，优先级高于 icon
        name: "明日方舟",
        uidLabel: "博士 ID",
        uid: "Zotrod#0001",
        color: "#4a90d9",                     // 图标颜色（用图片图标时忽略）
        link: ""                              // 可选：主页链接
      },
      {
        icon: "crosshair", iconImage: "",
        name: "无畏契约", uidLabel: "Riot ID", uid: "Zotrod#0806",
        color: "#ff4655", link: ""
      },
      {
        icon: "target", iconImage: "",
        name: "Apex Legends", uidLabel: "EA ID", uid: "Zotrod_APEX",
        color: "#da292a", link: ""
      },
      {
        icon: "note", iconImage: "",
        name: "DJMAX RESPECT V", uidLabel: "Steam", uid: "Zotrod",
        color: "#7b61ff", link: ""
      },
      {
        icon: "disc", iconImage: "",
        name: "Phigros", uidLabel: "游戏 ID", uid: "Zotrod",
        color: "#00c8b4", link: ""
      },
      {
        icon: "music", iconImage: "",
        name: "中二节奏", uidLabel: "CHUNITHM ID", uid: "Zotrod",
        color: "#f0a500", link: ""
      }
    ]
  },

  /* ========================================================== Q4 · 维修 */
  repair: {
    eyebrow: "04 / REPAIR",
    title: "维修与报价",
    lead: "价格写在明处。下面可以直接估个价，也可以看完整报价单。",

    // ---- 闲鱼主页摘要卡（和 Q1 的两个卡是同一个组件） ----
    xianyu: {
      id: "xianyu",
      icon: "shop",
      platform: "闲鱼",
      url: "https://www.goofish.com/",                     // ★ 你的闲鱼主页
      title: "我的闲鱼小铺",
      meta: "维修单 · 实拍 · 芝麻信用",
      cover: "",
      stats: [],
      accent: "#ffe60f"
    },

    /* ---- 报价表 ----
       扁平列表：每行自带 group 字段，页面会自动按 group 分栏。
       之所以不做成嵌套的 groups[].rows[]，是因为编辑器里只能编辑一层数组，
       扁平结构既好维护，也能随时插一个新分组进去（改 group 名即可）。 */
    quote: {
      title: "报价单",
      note: "价格为参考区间，实际以拆机检测结果为准。进水机、主板级故障需另议。",
      rows: [
        { group: "手机", item: "换外屏（只换玻璃）", price: "120 – 260", note: "视机型与曲面难度" },
        { group: "手机", item: "换总成（内外屏一体）", price: "280 – 680", note: "含原装/品牌两档" },
        { group: "手机", item: "换电池", price: "90 – 200", note: "含电芯与工时" },
        { group: "手机", item: "换尾插 / 充电口", price: "80 – 180", note: "" },
        { group: "手机", item: "换后置摄像头", price: "120 – 320", note: "单摄/多摄不同" },
        { group: "手机", item: "进水清理", price: "80 – 150", note: "不含后续元件更换" },
        { group: "电脑 / 平板", item: "清灰换硅脂", price: "80 – 150", note: "笔记本" },
        { group: "电脑 / 平板", item: "换硬盘 / 加内存", price: "50 – 120", note: "配件另计" },
        { group: "电脑 / 平板", item: "重装系统 + 驱动", price: "60 – 100", note: "含常用软件" },
        { group: "电脑 / 平板", item: "换屏", price: "300 – 900", note: "视尺寸与分辨率" }
      ]
    },

    /* ---- 价格计算器（四步向导）----
       算法：设备系数 × 项目基准价 × 材料系数 + 加项固定价
       最后按 range 展开成一个区间，因为实际维修总有浮动。 */
    calculator: {
      title: "估个价",
      hint: "四步选完就有结果，不需要填任何信息。",
      currency: "¥",
      range: [0.85, 1.15],                    // 输出区间：在估算值上下浮动 ±15%

      devices: [
        { id: "phone",   name: "手机",   factor: 1.0,  note: "最常见的单" },
        { id: "tablet",  name: "平板",   factor: 1.4,  note: "屏幕更大更贵" },
        { id: "laptop",  name: "笔记本", factor: 2.2,  note: "拆装更费工" },
        { id: "console", name: "游戏机", factor: 1.6,  note: "掌机 / 主机" }
      ],

      // devices 留空表示所有设备都支持
      services: [
        { id: "screen", name: "换屏",     price: 320, devices: ["phone", "tablet", "laptop"] },
        { id: "battery", name: "换电池",  price: 120, devices: ["phone", "tablet", "laptop", "console"] },
        { id: "port",   name: "换尾插",   price: 110, devices: ["phone", "tablet"] },
        { id: "camera", name: "换摄像头", price: 180, devices: ["phone", "tablet"] },
        { id: "clean",  name: "清灰保养", price: 100, devices: ["laptop", "console"] },
        { id: "system", name: "重装系统", price: 80,  devices: ["laptop"] }
      ],

      materials: [
        { id: "oem",   name: "原装", factor: 1.0,  note: "官方件，最稳" },
        { id: "brand", name: "品牌", factor: 0.75, note: "一线副厂" },
        { id: "value", name: "国产", factor: 0.55, note: "够用，性价比高" }
      ],

      /* 名称尽量控制在 2~3 个字。
         手机上加项组只有半行宽（约 155px），「加急当天」「数据备份」这种
         4 字标签会让整组折成两行，白白多占 34px —— 而 Q4 是唯一
         「一屏差几十像素装不下」的屏，这 34px 很关键。 */
      extras: [
        { id: "none",   name: "不需要", add: 0,  note: "" },
        { id: "rush",   name: "加急",   add: 60, note: "插单优先，当天可取" },
        { id: "onsite", name: "上门",   add: 80, note: "同城范围内" },
        { id: "backup", name: "备份",   add: 40, note: "换屏 / 换板前建议做" }
      ]
    }
  },

  /* ========================================================== Q5 · 其他 */
  // Q1 已经放了 QQ / 微信 / 网易云 / 小黑盒，这里只放剩下的，别重复。
  links: {
    eyebrow: "05 / ELSEWHERE",
    title: "其他账号",
    lead: "挑一个你顺手的方式。",
    items: [
      { icon: "github",   label: "GitHub",     handle: "@ZoTtfoy",              url: "https://github.com/ZoTtfoy" },
      { icon: "x",        label: "X",          handle: "@Zotrod",               url: "https://x.com/Zotrod" },
      { icon: "bilibili", label: "哔哩哔哩",   handle: "偶尔更新",               url: "https://space.bilibili.com/" },
      { icon: "qqmusic",  label: "QQ 音乐",    handle: "常听歌单",               url: "https://y.qq.com/" },
      { icon: "juejin",   label: "掘金",       handle: "技术笔记",               url: "https://juejin.cn/" },
      { icon: "mail",     label: "邮箱",       handle: "写信给我",               url: "mailto:hello@example.com" }
    ]
  },

  /* ========================================================== Q6 · 邮箱 */
  contact: {
    eyebrow: "06 / MAIL",
    title: "写信给我",
    lead: "邮件是我最稳定的联系方式，通常 1–2 天内回。",
    hint: "有项目、有问题，或者只是想聊两句？"
  },

  /* ============================================================== 背景 */
  backdrop: {
    motion: {
      aurora: true,     // 两团缓慢漂移的光晕（跟着主题色走）
      grain: true,      // 极细噪点，让大面积纯色不"死板"
      grid: false,      // 极淡的网格线，偏工程感
      stars: false      // 缓慢上浮的微粒，偏夜色感
    },
    gridSize: 64,
    starsOpacity: 0.5,
    image: "",
    imageOpacity: 0.35,
    imageBlur: 0,
    scrim: 0.65,
    kenBurns: false,
    parallax: true
  },

  /* ========================================================== 首屏细节 */
  live: {
    loading: true,      // 载入动画（每次会话一次，最多 0.9 秒，可点击跳过）
    clock: false,       // 实时时钟 —— Q1 要塞 QQ/微信/摘要卡，关掉省地方
    progress: false,    // 时光进度条
    quote: false,       // 一言 —— 同上，首屏已经够满了
    quoteRemote: false
  },

  /* 一言：如果哪天把 live.quote 打开，句子从这里取 */
  quotes: [
    "把复杂的东西，做得简单一点。",
    { text: "少一点装饰，多一点准确。", from: "自己" },
    "先让它跑起来，再让它好看。",
    { text: "简单不是少，而是刚好。", from: "自己" },
    "慢慢来，比较快。"
  ],

  /* 音乐浮窗：默认关闭，避免在正式场合意外出声 */
  music: {
    enabled: false,
    title: "我的歌单",
    artist: "网易云音乐",
    src: "",
    link: "https://music.163.com/",
    loop: true,
    volume: 0.6
  },

  /* ================================================================ 偏好 */
  ui: {
    skin: "ink",            // ink / paper / noir / aurora / terminal / clay / mint
    themeDefault: "auto",   // "auto" 跟随系统 | "light" | "dark"
    accent: "",
    accentDark: "",

    paged: true,            // 翻页式：一屏一章
    /* 触摸翻页：上/下滑**不管距离**都算一次翻页（像刷短视频）。
       位移只用来判断方向，不参与阈值；连翻有 300ms 下限，不会一滑好几页。
       想回到「自由滚动 + 停手自动对齐」的老行为，把它设成 false。 */
    swipePaging: true,
    showPager: true,
    showHint: true,
    lightEffects: true,

    showSkinPicker: true,
    showProgress: true,
    showBackToTop: true,
    ambientMotion: true,
    showThemeToggle: true
  }
};
