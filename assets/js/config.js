/* ==========================================================================
 *  Zotrod · 个人主页  ——  内容配置（由内容编辑器生成）
 *  修改方式二选一：直接改本文件，或用 /admin.html 图形化编辑后发布。
 * ========================================================================== */

window.SITE_CONFIG = {
  site: {
      name: "Zotrod",
      initials: "Z",
      avatar: "",
      role: "独立开发者 / 设计爱好者",
      tagline: "把复杂的东西，\n做得简单一点。",
      description: "这里是 Zotrod 的个人主页。写一点关于我的事、我做的事情，以及一些不务正业的爱好。",
      location: "中国 · 上海",
      email: "hello@example.com",
      available: true,
      availableText: "目前开放合作，欢迎聊聊",
      copyright: "© 2026 Zotrod. All rights reserved.",
      footerNote: "手写 HTML / CSS / JS · 托管于 GitHub Pages"
    },
  sections: {
      about: {
          enabled: true,
          order: 1,
          label: "关于"
        },
      services: {
          enabled: true,
          order: 2,
          label: "业务"
        },
      interests: {
          enabled: true,
          order: 3,
          label: "喜好"
        },
      social: {
          enabled: true,
          order: 4,
          label: "联系"
        }
    },
  hero: {
      primary: {
          label: "看看我做什么",
          target: "#services"
        },
      secondary: {
          label: "找到我",
          target: "#social"
        }
    },
  about: {
      eyebrow: "01 / ABOUT",
      title: "关于我",
      lead: "一点点自我介绍，和一点点做事的方式。",
      paragraphs: ["你好，我是 Zotrod。喜欢把模糊的想法变成能真正跑起来、也经得起细看的东西。日常在代码、界面和文字之间来回切换，习惯先想清楚「为什么」，再动手解决「怎么做」。", "我相信克制是一种能力：少一点装饰，多一点准确；少一点承诺，多一点交付。这里放着我目前在做的事、愿意聊的合作，以及一些和工作无关、但同样重要的爱好。"],
      facts: [
          {
              label: "坐标",
              value: "中国 · 上海"
            },
          {
              label: "状态",
              value: "开放合作中"
            },
          {
              label: "时区",
              value: "UTC+8"
            },
          {
              label: "回复",
              value: "通常 1–2 天"
            }
        ],
      tags: ["极简主义", "长期主义", "细节控", "一点点强迫症", "持续学习"]
    },
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
  interests: {
      eyebrow: "03 / OFF WORK",
      title: "个人喜好",
      lead: "工作之外，时间都花在这些地方。",
      items: [
          {
              icon: "music",
              title: "音乐",
              desc: "耳机里常驻的歌单，从后摇到City Pop",
              meta: "每日必听"
            },
          {
              icon: "camera",
              title: "摄影",
              desc: "拍街角的光、空椅子和没人的站台",
              meta: "随手记录"
            },
          {
              icon: "book",
              title: "阅读",
              desc: "科幻、设计、以及没用的冷知识",
              meta: "纸质优先"
            },
          {
              icon: "coffee",
              title: "咖啡",
              desc: "手冲，浅烘，接受一切不完美的萃取",
              meta: "一天两杯"
            },
          {
              icon: "plane",
              title: "旅行",
              desc: "不赶行程，喜欢在一座城市里乱走",
              meta: "慢速移动"
            },
          {
              icon: "gamepad",
              title: "游戏",
              desc: "偏爱有故事、有留白、能慢慢玩的作品",
              meta: "周末限定"
            }
        ]
    },
  social: {
      eyebrow: "04 / FIND ME",
      title: "在其他地方找到我",
      lead: "挑一个你顺手的方式，随时欢迎打招呼。",
      items: [
          {
              icon: "github",
              label: "GitHub",
              handle: "@Zotrod",
              url: "https://github.com/Zotrod"
            },
          {
              icon: "x",
              label: "X",
              handle: "@Zotrod",
              url: "https://x.com/Zotrod"
            },
          {
              icon: "bilibili",
              label: "哔哩哔哩",
              handle: "偶尔更新",
              url: "https://space.bilibili.com/"
            },
          {
              icon: "netease",
              label: "网易云音乐",
              handle: "歌单与红心",
              url: "https://music.163.com/"
            },
          {
              icon: "mail",
              label: "邮箱",
              handle: "hello@example.com",
              url: "mailto:hello@example.com"
            },
          {
              icon: "qq",
              label: "QQ",
              handle: "点一下复制号码",
              copy: "100000000"
            },
          {
              icon: "wechat",
              label: "微信",
              handle: "点一下复制微信号",
              copy: "zotrod"
            }
        ],
      contactHint: "有想法、有项目，或者只是想聊两句？"
    },
  ui: {
      skin: "ink",
      themeDefault: "auto",
      accent: "",
      accentDark: "",
      paged: true,
      showPager: true,
      lightEffects: true,
      showSkinPicker: true,
      showProgress: true,
      showBackToTop: true,
      ambientMotion: true,
      showThemeToggle: true
    }
};
