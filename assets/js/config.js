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
      description: "这里是 Zotrod 的个人主页。写一点关于我的事、我做的事情，以及一些不务正业的爱好。",
      location: "中国 · 河南",
      email: "Zotrod@163.com",
      copyright: "© 2026 Zotrod. All rights reserved.",
      footerNote: "ZwZ HUB  by Zotrod · 托管于 GitHub Pages"
    },
  sections: {
      listen: {
          enabled: true,
          order: 1,
          label: "在听"
        },
      gaming: {
          enabled: true,
          order: 2,
          label: "游戏"
        },
      repair: {
          enabled: true,
          order: 3,
          label: "维修"
        },
      links: {
          enabled: true,
          order: 4,
          label: "其他"
        },
      contact: {
          enabled: true,
          order: 5,
          label: "邮箱"
        }
    },
  profile: {
      greet: "你好，我是",
      tagline: "把复杂的东西，做得简单一点。",
      intro: "白天写代码，晚上拆机器。喜欢把模糊的想法变成能真正跑起来、也经得起细看的东西。这里放着我常待的地方、在听的歌，和一份还算透明的维修报价。",
      contacts: [
          {
              icon: "qq",
              label: "QQ",
              value: "3605921064",
              hint: "点击复制"
            },
          {
              icon: "wechat",
              label: "微信",
              value: "Zotrod",
              hint: "点击复制"
            }
        ],
      previews: [
          {
              id: "netease",
              icon: "netease",
              platform: "网易云音乐",
              url: "https://music.163.com/#/user/home?id=1695307327",
              title: "我的音乐主页",
              meta: "歌单 · 红心 · 最近在听",
              cover: "",
              stats: [],
              accent: "#c20c0c"
            },
          {
              id: "xiaoheihe",
              icon: "box",
              platform: "小黑盒",
              url: "https://www.xiaoheihe.cn/app/user/profile/000000",
              title: "我的小黑盒",
              meta: "游戏库 · 时长 · 战绩",
              cover: "",
              stats: [],
              accent: "#ff6b35"
            }
        ]
    },
  listen: {
      eyebrow: "02 / LISTENING",
      title: "听歌排行",
      lead: "最近一周循环最多的歌，播放次数与累计听歌由定时任务从网易云抓取。",
      neteaseUid: "1695307327",
      dataFile: "data/netease.json",
      limit: 6,
      fallback: [
          {
              title: "示例曲目一",
              artist: "示例歌手",
              album: "示例专辑"
            },
          {
              title: "示例曲目二",
              artist: "示例歌手",
              album: "示例专辑"
            },
          {
              title: "示例曲目三",
              artist: "示例歌手",
              album: "示例专辑"
            }
        ]
    },
  gaming: {
      eyebrow: "03 / GAMES",
      title: "MY GAME‘S ",
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
                  {
                      label: "六星干员",
                      value: "88"
                    },
                  {
                      label: "主线进度",
                      value: "全通"
                    },
                  {
                      label: "合约危机",
                      value: "19"
                    }
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
                  {
                      label: "主玩",
                      value: "贤者"
                    },
                  {
                      label: "最高段位",
                      value: "超凡 I"
                    },
                  {
                      label: "常用枪",
                      value: "暴徒"
                    }
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
                  {
                      label: "主玩传奇",
                      value: "恶灵"
                    },
                  {
                      label: "最高伤害",
                      value: "4.2k"
                    },
                  {
                      label: "生涯击杀",
                      value: "8,600"
                    }
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
                  {
                      label: "主要难度",
                      value: "MX"
                    },
                  {
                      label: "偏好键位",
                      value: "6B"
                    },
                  {
                      label: "最爱曲",
                      value: "OBLIVION"
                    }
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
                  {
                      label: "最高难度",
                      value: "AT 15"
                    },
                  {
                      label: "全连曲数",
                      value: "126"
                    },
                  {
                      label: "本命谱",
                      value: "Spasmodic"
                    }
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
                  {
                      label: "段位",
                      value: "白金"
                    },
                  {
                      label: "擅长难度",
                      value: "EXPERT"
                    },
                  {
                      label: "出勤频率",
                      value: "周更"
                    }
                ],
              note: "机厅常驻，欢迎约架。"
            }
        ]
    },
  repair: {
      eyebrow: "04 / REPAIR",
      title: "维修与报价",
      lead: "价格写在明处。下面可以直接估个价，也可以看完整报价单。",
      xianyu: {
          id: "xianyu",
          icon: "shop",
          platform: "闲鱼",
          url: "https://www.goofish.com/",
          title: "我的闲鱼小铺",
          meta: "维修单 · 实拍 · 芝麻信用",
          cover: "",
          stats: [],
          accent: "#ffe60f"
        },
      quote: {
          title: "报价单",
          note: "价格为参考区间，实际以拆机检测结果为准。进水机、主板级故障需另议。",
          rows: [
              {
                  group: "手机",
                  item: "换外屏（只换玻璃）",
                  price: "120 – 260",
                  note: "视机型与曲面难度"
                },
              {
                  group: "手机",
                  item: "换总成（内外屏一体）",
                  price: "280 – 680",
                  note: "含原装/品牌两档"
                },
              {
                  group: "手机",
                  item: "换电池",
                  price: "90 – 200",
                  note: "含电芯与工时"
                },
              {
                  group: "手机",
                  item: "换尾插 / 充电口",
                  price: "80 – 180",
                  note: ""
                },
              {
                  group: "手机",
                  item: "换后置摄像头",
                  price: "120 – 320",
                  note: "单摄/多摄不同"
                },
              {
                  group: "手机",
                  item: "进水清理",
                  price: "80 – 150",
                  note: "不含后续元件更换"
                },
              {
                  group: "电脑 / 平板",
                  item: "清灰换硅脂",
                  price: "80 – 150",
                  note: "笔记本"
                },
              {
                  group: "电脑 / 平板",
                  item: "换硬盘 / 加内存",
                  price: "50 – 120",
                  note: "配件另计"
                },
              {
                  group: "电脑 / 平板",
                  item: "重装系统 + 驱动",
                  price: "60 – 100",
                  note: "含常用软件"
                },
              {
                  group: "电脑 / 平板",
                  item: "换屏",
                  price: "300 – 900",
                  note: "视尺寸与分辨率"
                }
            ]
        },
      calculator: {
          title: "估个价",
          hint: "四步选完就有结果，不需要填任何信息。",
          currency: "¥",
          range: [
              0.85,
              1.15
            ],
          devices: [
              {
                  id: "phone",
                  name: "手机",
                  factor: 1,
                  note: "最常见的单"
                },
              {
                  id: "tablet",
                  name: "平板",
                  factor: 1.4,
                  note: "屏幕更大更贵"
                },
              {
                  id: "laptop",
                  name: "笔记本",
                  factor: 2.2,
                  note: "拆装更费工"
                },
              {
                  id: "console",
                  name: "游戏机",
                  factor: 1.6,
                  note: "掌机 / 主机"
                }
            ],
          services: [
              {
                  id: "screen",
                  name: "换屏",
                  price: 320,
                  devices: ["phone", "tablet", "laptop"]
                },
              {
                  id: "battery",
                  name: "换电池",
                  price: 120,
                  devices: ["phone", "tablet", "laptop", "console"]
                },
              {
                  id: "port",
                  name: "换尾插",
                  price: 110,
                  devices: ["phone", "tablet"]
                },
              {
                  id: "camera",
                  name: "换摄像头",
                  price: 180,
                  devices: ["phone", "tablet"]
                },
              {
                  id: "clean",
                  name: "清灰保养",
                  price: 100,
                  devices: ["laptop", "console"]
                },
              {
                  id: "system",
                  name: "重装系统",
                  price: 80,
                  devices: ["laptop"]
                }
            ],
          materials: [
              {
                  id: "oem",
                  name: "原装",
                  factor: 1,
                  note: "官方件，最稳"
                },
              {
                  id: "brand",
                  name: "品牌",
                  factor: 0.75,
                  note: "一线副厂"
                },
              {
                  id: "value",
                  name: "国产",
                  factor: 0.55,
                  note: "够用，性价比高"
                }
            ],
          extras: [
              {
                  id: "none",
                  name: "不需要",
                  add: 0,
                  note: ""
                },
              {
                  id: "rush",
                  name: "加急",
                  add: 60,
                  note: "插单优先，当天可取"
                },
              {
                  id: "onsite",
                  name: "上门",
                  add: 80,
                  note: "同城范围内"
                },
              {
                  id: "backup",
                  name: "备份",
                  add: 40,
                  note: "换屏 / 换板前建议做"
                }
            ]
        }
    },
  links: {
      eyebrow: "05 / ELSEWHERE",
      title: "其他账号",
      lead: "挑一个你顺手的方式。",
      items: [
          {
              icon: "github",
              label: "GitHub",
              handle: "@ZoTtfoy",
              url: "https://github.com/ZoTtfoy"
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
              icon: "qqmusic",
              label: "QQ 音乐",
              handle: "常听歌单",
              url: "https://y.qq.com/"
            },
          {
              icon: "juejin",
              label: "掘金",
              handle: "技术笔记",
              url: "https://juejin.cn/"
            },
          {
              icon: "mail",
              label: "邮箱",
              handle: "写信给我",
              url: "",
              copy: "Zotrod@163.com"
            }
        ]
    },
  contact: {
      eyebrow: "06 / MAIL",
      title: "写信给我",
      lead: "邮件是我最稳定的联系方式。",
      hint: "有项目、有问题，或者只是想聊两句？"
    },
  backdrop: {
      motion: {
          aurora: true,
          grain: true,
          grid: true,
          stars: true
        },
      gridSize: 64,
      starsOpacity: 0.5,
      image: "assets/backdrop/mesh.svg",
      imageOpacity: 1,
      imageBlur: 24,
      scrim: 0.2,
      kenBurns: true,
      parallax: true
    },
  live: {
      loading: true,
      clock: true,
      progress: true,
      quote: true,
      quoteRemote: false
    },
  quotes: [
      "把复杂的东西，做得简单一点。",
      {
          text: "少一点装饰，多一点准确。",
          from: "自己"
        },
      "先让它跑起来，再让它好看。",
      {
          text: "简单不是少，而是刚好。",
          from: "自己"
        },
      "慢慢来，比较快。",
      {
          text: "与其解释，不如做出来给人看。",
          from: "自己"
        },
      "细节自由，但边界要清楚。"
    ],
  music: {
      enabled: true,
      title: "我的歌单",
      artist: "网易云音乐",
      src: "",
      link: "https://music.163.com/",
      loop: true,
      volume: 0.6
    },
  ui: {
      skin: "ink",
      themeDefault: "auto",
      accent: "",
      accentDark: "",
      paged: true,
      swipePaging: true,
      showPager: true,
      showHint: true,
      lightEffects: true,
      showSkinPicker: true,
      showProgress: true,
      showBackToTop: true,
      ambientMotion: true,
      showThemeToggle: true
    },
  hero: {
      primary: {
          label: "看看我做什么",
          target: "#repair"
        },
      secondary: {
          label: "找到我",
          target: "#links"
        }
    }
};
