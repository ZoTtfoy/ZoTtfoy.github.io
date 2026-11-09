/* ==========================================================================
 *  Zotrod · 个人主页  ——  唯一需要修改的文件
 * --------------------------------------------------------------------------
 *  ▸ 所有文案、链接、模块开关都集中在这里。
 *  ▸ 改完保存，刷新页面立即生效，不需要打包、不需要装任何东西。
 *  ▸ 引号 " " 里的内容随便改；true / false 是开关；数字越小排得越靠前。
 *  ▸ 下面带「示例」字样的文字都是占位内容，请替换成你自己的信息。
 *  ▸ 图标名可选列表见 assets/js/icons.js 顶部注释。
 * ========================================================================== */

window.SITE_CONFIG = {

  /* ---------------------------------------------------------------- 1. 基础 */
  site: {
    name: "Zotrod",                          // 顶部名字 / 浏览器标签
    initials: "Z",                           // 没有头像图片时，方块里显示的字母
    avatar: "",                              // 头像图片：填图片地址（或用编辑器上传，自动转成内嵌图片）
    role: "独立开发者 / 设计爱好者",           // 名字下方的一行身份
    tagline: "把复杂的东西，\n做得简单一点。",   // 首页大标题；\n 表示换行
    description: "这里是 Zotrod 的个人主页。写一点关于我的事、我做的事情，以及一些不务正业的爱好。",
    location: "中国 · 上海",                  // 示例：坐标
    email: "hello@example.com",              // 示例：换成你的邮箱，页脚可一键复制
    available: true,                         // 是否显示「开放合作」小绿点
    availableText: "目前开放合作，欢迎聊聊",
    copyright: "© 2026 Zotrod. All rights reserved.",
    footerNote: "手写 HTML / CSS / JS · 托管于 GitHub Pages"
  },

  /* ------------------------------------------------- 2. 模块开关与显示顺序 */
  // enabled: false 即可整块隐藏；order: 数字小的排前面；label: 导航栏文字
  sections: {
    about:     { enabled: true, order: 1, label: "关于" },
    services:  { enabled: true, order: 2, label: "业务" },
    gaming:    { enabled: true, order: 3, label: "游戏" },
    interests: { enabled: true, order: 4, label: "喜好" },
    social:    { enabled: true, order: 5, label: "联系" }
  },

  /* ------------------------------------------------------------ 3. 首页按钮 */
  hero: {
    primary:   { label: "看看我做什么", target: "#services" },
    secondary: { label: "找到我",       target: "#social"   }
  },

  /* ------------------------------------------------------------ 4. 关于个人 */
  about: {
    eyebrow: "01 / ABOUT",
    title: "关于我",
    lead: "一点点自我介绍，和一点点做事的方式。",
    paragraphs: [
      "你好，我是 Zotrod。喜欢把模糊的想法变成能真正跑起来、也经得起细看的东西。日常在代码、界面和文字之间来回切换，习惯先想清楚「为什么」，再动手解决「怎么做」。",
      "我相信克制是一种能力：少一点装饰，多一点准确；少一点承诺，多一点交付。这里放着我目前在做的事、愿意聊的合作，以及一些和工作无关、但同样重要的爱好。"
    ],
    facts: [
      { label: "坐标",   value: "中国 · 上海" },
      { label: "状态",   value: "开放合作中" },
      { label: "时区",   value: "UTC+8" },
      { label: "回复",   value: "通常 1–2 天" }
    ],
    tags: ["极简主义", "长期主义", "细节控", "一点点强迫症", "持续学习"]
  },

  /* ------------------------------------------------------------ 5. 业务范畴 */
  services: {
    eyebrow: "02 / WHAT I DO",
    title: "业务范畴",
    lead: "能帮上忙的几个方向，从想法到落地。",
    items: [
      {
        icon: "code",
        title: "网站与应用开发",
        desc: "从静态页面到完整的前端应用，关注性能、可维护性与真实设备上的体验。",
        tags: ["前端", "响应式", "工程化"]
      },
      {
        icon: "palette",
        title: "界面与视觉设计",
        desc: "清晰的层级、克制的配色、顺手的交互。让界面不需要说明书也能被看懂。",
        tags: ["UI", "设计系统", "动效"]
      },
      {
        icon: "layers",
        title: "产品与体验梳理",
        desc: "把散落的需求理成结构，明确主路径，减少不必要的功能与反复沟通。",
        tags: ["信息架构", "原型", "评审"]
      },
      {
        icon: "chart",
        title: "咨询与技术支持",
        desc: "代码审查、性能优化、技术方案选型，或者只是找个靠谱的人一起把问题想明白。",
        tags: ["Code Review", "优化", "顾问"]
      }
    ]
  },

  /* ------------------------------------------------------------ 6. 游戏 */
  // 每个游戏一张卡片：ID 点一下即可复制（方便对方加好友），下面的 stats 是「可展现资产」。
  // uidLabel 可自定义（博士ID / Riot ID / Steam ID …），stats 想写几个都行。
  // color 是卡片顶部的品牌色细条，留空则用主题主色。
  gaming: {
    eyebrow: "03 / GAMES",
    title: "在游戏里",
    lead: "想一起玩的话，ID 都在这里，点一下就能复制。",
    items: [
      {
        icon: "tower",
        name: "明日方舟",
        uidLabel: "博士 ID",
        uid: "Zotrod#0001",
        server: "官服",
        rank: "Lv. 120",
        color: "#4a90d9",
        stats: [
          { label: "六星干员", value: "88" },
          { label: "主线进度", value: "全通" },
          { label: "合约危机", value: "19" }
        ],
        note: "每天上线收菜，顺便摸摸公开招募。"
      },
      {
        icon: "crosshair",
        name: "无畏契约",
        uidLabel: "Riot ID",
        uid: "Zotrod#0806",
        server: "亚服",
        rank: "钻石 II",
        color: "#ff4655",
        stats: [
          { label: "主玩", value: "贤者" },
          { label: "最高段位", value: "超凡 I" },
          { label: "常用枪", value: "暴徒" }
        ],
        note: "喜欢打信息位，不太爱冲锋。"
      },
      {
        icon: "target",
        name: "Apex Legends",
        uidLabel: "EA ID",
        uid: "Zotrod_APEX",
        server: "亚服",
        rank: "大师",
        color: "#da292a",
        stats: [
          { label: "主玩传奇", value: "恶灵" },
          { label: "最高伤害", value: "4.2k" },
          { label: "生涯击杀", value: "8,600" }
        ],
        note: "三排最爱，单排随缘。"
      },
      {
        icon: "note",
        name: "DJMAX RESPECT V",
        uidLabel: "Steam",
        uid: "Zotrod",
        server: "Steam",
        rank: "Lv. 87",
        color: "#7b61ff",
        stats: [
          { label: "主要难度", value: "MX" },
          { label: "偏好键位", value: "6B" },
          { label: "最爱曲", value: "OBLIVION" }
        ],
        note: "手速不够，靠背谱补。"
      },
      {
        icon: "disc",
        name: "Phigros",
        uidLabel: "游戏 ID",
        uid: "Zotrod",
        server: "国服",
        rank: "RKS 15.24",
        color: "#00c8b4",
        stats: [
          { label: "最高难度", value: "AT 15" },
          { label: "全连曲数", value: "126" },
          { label: "本命谱", value: "Spasmodic" }
        ],
        note: "免费音游里最爱的一个。"
      },
      {
        icon: "music",
        name: "中二节奏",
        uidLabel: "CHUNITHM ID",
        uid: "Zotrod",
        server: "国服",
        rank: "评级 S",
        color: "#f0a500",
        stats: [
          { label: "段位", value: "白金" },
          { label: "擅长难度", value: "EXPERT" },
          { label: "出勤频率", value: "周更" }
        ],
        note: "机厅常驻，欢迎约架。"
      }
    ]
  },

  /* ------------------------------------------------------------ 7. 个人喜好 */
  interests: {
    eyebrow: "04 / OFF WORK",
    title: "个人喜好",
    lead: "工作之外，时间都花在这些地方。",
    items: [
      { icon: "music",     title: "音乐",   desc: "耳机里常驻的歌单，从后摇到City Pop", meta: "每日必听" },
      { icon: "camera",    title: "摄影",   desc: "拍街角的光、空椅子和没人的站台",     meta: "随手记录" },
      { icon: "book",      title: "阅读",   desc: "科幻、设计、以及没用的冷知识",       meta: "纸质优先" },
      { icon: "coffee",    title: "咖啡",   desc: "手冲，浅烘，接受一切不完美的萃取",   meta: "一天两杯" },
      { icon: "plane",     title: "旅行",   desc: "不赶行程，喜欢在一座城市里乱走",     meta: "慢速移动" },
      { icon: "gamepad",   title: "游戏",   desc: "偏爱有故事、有留白、能慢慢玩的作品", meta: "周末限定" }
    ]
  },

  /* ---------------------------------------------------------- 8. 社交平台 */
  social: {
    eyebrow: "05 / FIND ME",
    title: "在其他地方找到我",
    lead: "挑一个你顺手的方式，随时欢迎打招呼。",
    // url 换成你自己的主页地址；不用的平台直接删掉整行即可。
    // 想写「点一下就复制」的账号（比如 QQ 号、微信号），用 copy 代替 url。
    items: [
      { icon: "github",    label: "GitHub",     handle: "@Zotrod",        url: "https://github.com/Zotrod" },
      { icon: "x",         label: "X",          handle: "@Zotrod",        url: "https://x.com/Zotrod" },
      { icon: "bilibili",  label: "哔哩哔哩",   handle: "偶尔更新",        url: "https://space.bilibili.com/" },
      { icon: "netease",   label: "网易云音乐", handle: "歌单与红心",      url: "https://music.163.com/" },
      { icon: "mail",      label: "邮箱",       handle: "hello@example.com", url: "mailto:hello@example.com" },
      { icon: "qq",        label: "QQ",         handle: "点一下复制号码",   copy: "100000000" },
      { icon: "wechat",    label: "微信",       handle: "点一下复制微信号", copy: "zotrod" }
    ],
    contactHint: "有想法、有项目，或者只是想聊两句？"
  },

  /* --------------------------------------------------------- 9. 背景 */
  // 动效元素可以任意叠加；图片可选。改这里不用动任何 CSS。
  backdrop: {
    motion: {
      aurora: true,     // 两团缓慢漂移的光晕（跟着主题色走）
      grain: true,      // 极细噪点，让大面积纯色不"死板"
      grid: false,      // 极淡的网格线，偏工程感
      stars: false      // 缓慢上浮的微粒，偏夜色感
    },
    gridSize: 64,       // 网格间距（px），只在 grid 开启时有效
    starsOpacity: 0.5,  // 微粒浓度

    image: "",          // 背景图片：填图片地址，或用编辑器上传（自动压缩）
    imageOpacity: 0.35, // 图片不透明度（越大越明显）
    imageBlur: 0,       // 图片模糊（0–40px；想弱化图片细节就调大）
    scrim: 0.65,        // ★ 图片上的遮罩强度（0.15–0.95）。越低图越清楚、字越难读
    kenBurns: false,    // 图片极缓慢地推近拉远（48 秒一个来回）
    parallax: true      // 背景随鼠标 / 滚动轻微位移，形成前后层次
  },

  /* --------------------------------------------------------- 10. 首页细节 */
  // 每项都能单独关掉：true 开启 / false 关闭
  live: {
    loading: true,      // 载入动画（每次会话只出现一次，最多 0.9 秒，可点击跳过）
    clock: true,        // 实时时钟 + 星期 + 日期
    progress: true,     // 时光进度条：今年过了百分之多少
    quote: true,        // 一言（点一下换一句）
    quoteRemote: false  // false 用下面的本地列表；true 则联网取一言（内容随机，不推荐）
  },

  /* 一言：本地精选。可以放纯文字，也可以带出处 { text, from } */
  quotes: [
    "把复杂的东西，做得简单一点。",
    { text: "少一点装饰，多一点准确。", from: "自己" },
    "先让它跑起来，再让它好看。",
    { text: "简单不是少，而是刚好。", from: "自己" },
    "慢慢来，比较快。",
    { text: "与其解释，不如做出来给人看。", from: "自己" },
    "细节自由，但边界要清楚。"
  ],

  /* 音乐浮窗：默认关闭，避免在正式场合意外出声。
     打开方式：
       1) 有音源：填 src（mp3 直链）→ 出现播放按钮，绝不自动播放
       2) 只有歌单：填 link → 变成一个「去听歌」的入口
     想让它出现，必须把 enabled 改成 true。 */
  music: {
    enabled: false,
    title: "我的歌单",
    artist: "网易云音乐",
    src: "",            // 示例："./assets/audio/loop.mp3"
    link: "https://music.163.com/",
    loop: true,
    volume: 0.6
  },

  /* -------------------------------------------------------------- 11. 偏好 */
  ui: {
    skin: "ink",            // 默认风格：ink / paper / noir / aurora / terminal / clay / mint
    themeDefault: "auto",   // "auto" 跟随系统 | "light" 默认浅色 | "dark" 默认深色
    accent: "",             // 可选：在风格之上再覆盖浅色主色，如 "#2f6b5b"；留空则用风格自带
    accentDark: "",         // 可选：覆盖深色主色

    paged: true,            // ★ 翻页式：一屏一章，上下翻动时吸附（Apple 式章节）
    showPager: true,        //   右侧页码指示器（手机上为底部分段）
    showHint: true,         //   首次进入时提示「上下滑动翻页」，动一下即消失
    lightEffects: true,     // ★ 指针追光 / 卡片光斑 / 触控涟漪

    showSkinPicker: true,   // 右上角风格切换按钮
    showProgress: true,     // 顶部滚动进度条
    showBackToTop: true,    // 右下角回到顶部
    ambientMotion: true,    // 背景动效总开关（关了则光晕/微粒静止；系统「减少动态效果」也会自动关）
    showThemeToggle: true   // 右上角深浅快切按钮
  }
};
