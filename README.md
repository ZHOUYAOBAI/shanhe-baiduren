# NOCTURNE ｜ 剧作集视觉体系

> 铜版画蚀刻 × 幕布正红 —— 一套为音乐剧／歌剧剧本展演而生的视觉系统

本仓库收录四套同源的剧目站点，共用「手绘钢笔排线 + 真 3D 几何体」的技术路线。

## 线上地址

| 站点 | 地址 |
|---|---|
| **NOCTURNE 剧作集**（首页） | https://zhouyaobai.github.io/shanhe-baiduren/ |
| 《山河摆渡人》 | https://zhouyaobai.github.io/shanhe-baiduren/shanhe/ |
| 《西山不是山》 | https://zhouyaobai.github.io/shanhe-baiduren/xishan/ |
| **《百年星语·破晓1928》** | https://zhouyaobai.github.io/shanhe-baiduren/px1928/ |

---

## 零、换电脑继续做

仓库是**自包含**的：站点产物、建站工具链、每个剧本的内容源都跟着 GitHub 走。
换一台电脑，三步。

### ① 把仓库拿过来

```bash
git clone git@github.com:ZHOUYAOBAI/shanhe-baiduren.git
cd shanhe-baiduren
```

没有 SSH 密钥就先建一把：

```bash
ssh-keygen -t ed25519 -C "你的邮箱"
cat ~/.ssh/id_ed25519.pub      # 贴到 github.com/settings/keys
ssh -T git@github.com          # 测通再往下走
```

### ② 跑引导脚本

```bash
bash scripts/bootstrap.sh
```

它依次做四件事，每一步缺什么都会把该敲的命令**直接打印出来**：

1. 检查 Node（≥18）与 git；
2. 把仓库里的建站工具链 `tools/script-site/` 装到 `~/.codex/skills/script-site/`；
3. 检查 GitHub 凭据（SSH 能不能推上去）；
4. 检查部署凭据（`gh` / `wrangler`）。

### ③ 剧本源文件 —— 唯一要手动搬的东西

**剧本 docx 不在仓库里。** 里面有全剧正文和全部歌词，是明文，绝不能进公开仓库。
换机前把它放进 **iCloud Drive**，新机登录同一账号后自动同步：

```
~/Library/Mobile Documents/com~apple~CloudDocs/剧本/《百年星语·破晓1928》云南本土红色歌剧.docx
```

然后重建：

```bash
bash scripts/rebuild-px1928.sh                       # 不带参数会自动在 iCloud / Downloads / 剧本 目录里找
bash scripts/rebuild-px1928.sh "/路径/剧本.docx"      # 或者直接给路径
```

脚本会：解析 docx → 映射成 `data.js`（正文与歌词 AES-256-GCM 加密）→
注入模板 → **校验「剧本每一段文字都在站点上」**（缺失必须为 0）→
同步进 `px1928/`。跑完记得看一眼那行「缺失 0」。

### ④ 上线

```bash
bash scripts/deploy-site.sh
```

= 校验文件 → 检查暂存区无明文 → 提交推送（GitHub Pages，1–2 分钟生效）
→ 同步 Cloudflare 镜像（国内线路更快，配乐靠它才流畅）。

### 什么在哪 · 换机对照表

| 东西 | 在哪 | 换机会丢吗 |
|---|---|---|
| 四个站点的全部产物 | 仓库 `index.html` `shanhe/` `xishan/` `px1928/` | 不会，跟着 GitHub 走 |
| 建站工具链（skill） | 仓库 `tools/script-site/` | 不会（`bootstrap.sh` 会自动装） |
| 剧本内容源（人物/歌单/伏笔/时间轴） | 仓库 `projects/px1928/site_meta.json` | 不会 |
| 设计与审查记录 | 仓库 `projects/px1928/REVIEW.md` | 不会 |
| 一键脚本 | 仓库 `scripts/` | 不会 |
| **剧本体（正文 + 歌词）** | **iCloud Drive**（仓库外） | 要手动同步 |
| 阅读密码 | `~/.config/script-site/readpass`（仓库外） | 要重新记一次 |
| 字体子集 / 音频素材 | 仓库 `assets/fonts/` `shanhe/assets/audio/` | 不会 |

### 新机凭据清单

| 凭据 | 换机后要做 | 不做会怎样 |
|---|---|---|
| GitHub SSH 密钥 | 生成 → 贴到 GitHub → `ssh -T` 测通 | 推不上去 |
| Cloudflare `wrangler` | `npx wrangler login` | 镜像失效（GitHub Pages 不受影响，只是慢） |
| `gh` CLI | `gh auth login`（只在**新建**仓库时需要） | 没法建新仓；给已有仓库加子目录不需要 |
| 阅读密码 | 跑 `rebuild-px1928.sh` 时输入一次，之后记在 `~/.config/script-site/readpass` | 重建会退化成**不加密**站点 —— 脚本会拦下 |

> 密码绝不入库。仓库里能公开的只有「公开层」：剧目概况、人物小传、歌单目录、
> 伏笔结构、时间轴 —— 和站点上没设密码时看到的一模一样。

### 绝对不能进仓库的东西

`deploy.sh` 在提交前会扫暂存区，发现 `working/` 明文就中止提交并回滚。
以下由 `.gitignore` 兜底：

```gitignore
*/working/      # 构建中间产物，含剧本明文
outputs/        # 本机构建输出
.readpass       # 阅读密码
```

---

## 一、NOCTURNE 剧作集（首页）

音乐剧与歌剧剧本的线上展演站。视觉基底取自一支抖音样片，逐帧取样后提炼出「手绘钢笔排线 + 正红满版 + Didone 巨标题」的视觉语言，并延展为可执行的 token 体系。

### 快速开始

纯静态，无构建步骤，无外部依赖：

```bash
python3 -m http.server 8777
# 打开 http://127.0.0.1:8777
```

### 四套载体

| 载体 | 路径 | 说明 |
|---|---|---|
| **Token 真源** | `assets/nocturne/css/tokens.css`<br>`assets/nocturne/css/tokens.json` | 色彩 / 字体 / 间距 / 纹理 / 动效的唯一真源 |
| **可运行原型** | `index.html` | 8 屏，滚动驱动 + WebGL 3D |
| **规范文档** | `assets/nocturne/docs/视觉规范.md` | 完整规则、参数速查与踩坑记录 |
| **画布设计稿** | Ardot（不在本仓库） | 首页七屏 + 视觉规范板，层级可重组 |

**改动规则**：任何色值、字号、间距的调整，先改 `tokens.css`，再同步到原型与画布。三者不得各自为政。

### 页面结构

```
01 主视觉（红面）      →  巨标题 + 圆形画框剪影 + 手写体 logo
02 3D 展演屏（墨面）   →  真 WebGL 场景，A/B 可切换
03 剧目陈列（米白）    →  四部剧目，蚀刻徽记卡片
04 剧本选段（墨面）    →  台词 / 舞台提示 / 人物 / 曲目
05 演出数据（红面）    →  大字数字排版
06 媒体评价（浅米白）  →  三栏引文
07 创作理念（米白）    →  自述 + 手写签名
08 联络（墨面）        →  合作洽谈 + FINIS 落款
```

### 视觉语言

| 项 | 值 |
|---|---|
| 主色 | `#B00000` 幕布红 |
| 反白 | `#E0D9D6` 米白 |
| 正文 | `#08080A` 墨黑 |
| 巨标题 | Noto Serif SC 900 |
| 拉丁副题 | Bodoni Moda 400 |
| 手写签名 | Pinyon Script 400 |
| 眉标导航 | Noto Sans SC 11px / 0.28em 字距 |
| 圆角 | 全站 0（仅描边块 2px） |
| 间距阶 | 4 的倍数：4 → 160 |

**三色封顶**：全站只用红／米白／墨黑，不出现第四色相。唯一例外是 3D 实物用彩色（面积极小）。

> **中文「〇」（U+3007）在 Noto Serif SC 缺字形**，年份请用汉字数字（`二五年` 而非 `二〇二五`），否则渲染为豆腐块。

### 核心：排线着色器

3D 场景里让曲面呈现手绘钢笔质感的 GLSL 材质（`assets/nocturne/js/hatch.js`）。四步：

1. **屏幕空间刻线**（非贴图）—— 线条不随曲面拉伸变形
2. **手绘扰动** —— `inkNoise()` 让线条弯曲、粗细随位置波动
3. **强度由曲面转折驱动** —— `turn = 1 - abs(dot(N, V))`
   圆柱正对处排线淡、轮廓转折处排线浓，这正是铜版画处理圆柱体的手法
4. **交叉排线仅出现在暗部**

> 若改用光照驱动排线，正对处受光会完全无排线，物体退化为平涂色块 —— 这是实现中最容易踩的坑。

完整原理与参数见 `assets/nocturne/docs/视觉规范.md` 第 5 章。

### 3D 场景

| 场景 | 构成 |
|---|---|
| **A · 瓶阵** | 瓶身走排线着色器（斜向交叉线网）、瓶盖走 PBR 金属、黑色标签带 |
| **B · 圆形画框** | 红球排线 + 侧身长发剪影 + 双层画框 |

两个场景共享同一套排线材质与描边材质。金属瓶盖需自建等距柱状投影环境贴图，否则 `metalness=1` 会渲染成纯黑。

### 目录

```
assets/nocturne/
├── css/tokens.css          # CSS 变量（可执行真源）
├── css/tokens.json         # 机读版（含纹理/动效参数）
├── js/hatch.js             # GLSL 排线着色器 + 金属材质 + 描边材质
├── js/scenes.js            # 两个 3D 场景
├── svg/                    # 程序化生成的铜版画线稿（ink / paper 双版本）
├── vendor/three.module.js  # Three.js（本地化，零外链）
├── docs/视觉规范.md
└── tools/gen_svg.py        # 线稿资产生成器
```

### 工具

```bash
# 重新生成线稿资产（改 gen_svg.py 后）
python3 assets/nocturne/tools/gen_svg.py
```

---

## 二、《山河摆渡人》剧本站

云南本土原创红色歌剧《山河摆渡人》官方网站。

### 这是一个什么站

六幕完整剧本 + 40 首曲目完整歌词 + 11 位人物 + 6 条伏笔闭环。

- **首页 3D 火塘场景**：Three.js + 手绘钢笔排线着色器（hatching shader），朱砂红主调
- **六幕正文**：序幕 / 第一幕 / 第二幕 / 第三幕 / 第四幕 / 尾幕，专业剧本排版（角色名居中、台词缩进、歌词独立行距）
- **曲内有序流**：每首曲目的宣叙调、小节标记、歌词严格按原文顺序呈现
- **曲目总览**：40 首目录；同名主题歌的各段落带标记区分（主歌 A / 副歌 B / 桥段 / 大合唱 / 再现）
- **全剧曲目表**：定稿原表（幕次 / 序号 / 曲目名称 / 类型 / 演唱），按幕分组，序号可点跳
- **人物卡**：11 位（10 位角色 + 其他角色群像）
- **伏笔闭环**：阿爹的彝刀、日月纹帕子、真假油布包、刘矬子的鞭子、夜不渡皎平、三十七位船工的名字

### 视觉系统

| 角色 | 色值 | 用途 |
|---|---|---|
| `--ink` | `#2B0A0F` | 深朱砂，主底色 |
| `--ink-2/3` | `#3D1116` / `#541A20` | 次层 / 三层 |
| `--paper` | `#F7EDE2` | 暖米白，正文 |
| `--red` | `#D62038` | 正红，主强调 |
| `--red-lit` | `#FF6B57` | 火光橙红 |
| `--gold` | `#E0B040` | 彝金 |

红色为本剧血色，故以朱砂为底、宣纸为字、金作点睛；3D 火塘用金橙火焰，在红底上靠明度分层。

### 剧本阅读权限

**公开可见**：剧目概况（幕名 / 时间 / 地点 / 舞台氛围 / 出场人物）、核心主线、歌单目录、全剧曲目表、人物小传、伏笔结构。

**需密码**：六幕剧本正文（台词 / 舞台提示）与全部唱段歌词。

剧透正文在 `data.js` 中以 **AES-256-GCM 密文**存储：

- 密钥由 `PBKDF2-HMAC-SHA256(password, salt, 150000)` 派生
- 浏览器端用 WebCrypto `SubtleCrypto` 解密（需 HTTPS，GitHub Pages 满足）
- 直接查看网页源码只能得到 base64 密文，取不到剧透正文
- 解锁状态存 `sessionStorage`（会话级，关闭标签页即失效）

> 密码通过环境变量 `READ_PASS` 传入生成脚本，不写死在仓库里。

### 数据来源与更新

**关键约定：不要另写解析器。** 解析层与数据映射层必须分离。

```
docx（定稿）
  └─ tools/extract_script.py ──→ script_struct.json          （解析层）
       └─ tools/gen_site_data.py ──→ data.js（公开层 + AES-GCM 密文）
            └─ tools/audit_sync.py ──→ 同步校验（缺失必须为 0 条）
```

三个脚本都在 `shanhe/tools/` 下。解析层只做「文档 → 结构」，
剧目资料卡、人物卡、伏笔等人工内容在映射层；密码走环境变量 `READ_PASS`。

### 更新流程

```bash
cd shanhe/tools
# 1. 重新解析定稿 docx
python3 extract_script.py "/路径/云南本土原创红色歌剧《山河摆渡人》·定稿.docx" script_struct.json
# 2. 生成 data.js（密码走环境变量，不入库）
READ_PASS=你的密码 python3 gen_site_data.py script_struct.json ../assets/js/data.js
# 3. 核对有没有漏字（应为「缺失 0 条」）
READ_PASS=你的密码 python3 audit_sync.py "/路径/…·定稿.docx" ../assets/js/data.js
# 4. 同步并推送（注意：站点产物在 shanhe/ 子目录）
./deploy.sh
```

### 史实与虚构声明

阿木、阿果为艺术虚构人物，原型是千千万万无名彝、汉、傣各族群众。 剧中真实地名、渡口、里程、船工姓名均依史实。

编剧：孙子岚 白耀洲 彭侠颖　｜　音乐：彭侠颖 白耀洲 孙子岚

---

## 三、《百年星语·破晓1928》剧本站

云南本土原创红色歌剧，五幕十一场，二十六首曲目，从 1928 年蒙自芷村的茅屋
到 2024 年查尼皮纪念馆的一盏马灯。

### 这一套是 Node 工具链（与《山河摆渡人》的 Python 工具链并存，互不干扰）

```
剧本.docx
  └─ tools/script-site/scripts/parse-script.mjs ──→ working/script_struct.json   （解析层）
       └─ tools/script-site/scripts/build-data.mjs ──→ data.js（公开层 + AES-GCM 密文）
            └─ tools/script-site/scripts/build-site.mjs ──→ 注入模板 + 对比度校验 + 漏字校验
                 └─ tools/script-site/scripts/audit.mjs ──→ 「剧本每一段文字都在站点上」
```

**分层不许合并。** 解析层只管「文档 → 结构」，剧目资料卡、人物小传、伏笔、
配色等人工内容全部放在 `projects/px1928/site_meta.json`（映射层读它）。

### 一键重建

```bash
bash scripts/rebuild-px1928.sh "/路径/剧本.docx"
```

或用 skill 直接调（等价）：

```bash
SK=~/.codex/skills/script-site
READ_PASS='你的密码' node $SK/scripts/build-site.mjs \
  --script "/路径/剧本.docx" \
  --meta projects/px1928/site_meta.json \
  --out outputs/px1928
```

### 配色与 3D 的硬约束

- **浅色宣纸底**（`bg #EFE5D8`），不搞暗色系；
- **红色歌剧**：朱砂（`accent #B22D1D` / `accentDeep #8A1E13`）做结构，米金做阅读面；
- 对比度 **≥4.5** 由构建时 `normalizePalette()` 强制，改色改坏了会直接构建失败；
- 3D 分**三道门控**（CSS 媒体查询 + JS 特性检测 + 窄屏退平面），三道必须同时成立；
- 窄屏（≤ 900px）3D 全退平面，移动端优先。

审查与历轮改动记录见 `projects/px1928/REVIEW.md`。

> 重建后 `data.js` 一定会有 diff —— 加密的 IV 每次随机生成，这是对的。
> 其余文件（`index.html` / `main.css` / `palette.css` …）在同源同密码下逐字节一致，
> 所以两台机器构建出来的站点可以直接对拍。

---

## 仓库结构

```
index.html                      NOCTURNE 剧作集（首页）
404.html                        NOCTURNE 风格 404 页
deploy.sh                       一键提交推送脚本（提交前扫暂存区，防明文入库）
.nojekyll                       禁用 Jekyll
assets/
├── css/main.css                《山河摆渡人》视觉系统
├── js/{main,scene,crypto,data}.js
├── js/three.module.js
└── nocturne/                   NOCTURNE 体系全部资源
shanhe/
├── index.html                  《山河摆渡人》主页
├── 404.html
├── tools/                      旧 Python 工具链（解析 / 生成 / 校验）
└── assets/                     同上
    ├── js/audio-engine.js      音频引擎（多源竞速 / 整曲预载 / 本地缓存）
    └── audio/*.web.mp3         网页版配乐（44.1kHz / 80kbps）
xishan/                         《西山不是山》站点产物
px1928/                         《百年星语·破晓1928》站点产物
tools/script-site/              建站工具链（skill 本体，随仓库走，换机自动装）
projects/px1928/
├── site_meta.json              剧本内容源：人物 / 歌单 / 伏笔 / 时间轴 / 配色
└── REVIEW.md                   设计与审查记录（历轮改动 + 回归数据）
scripts/
├── bootstrap.sh                新机一键引导
├── rebuild-px1928.sh           重建《百年星语·破晓1928》
└── deploy-site.sh              上线（封装根目录 deploy.sh）
_headers                        Cloudflare Pages 配置（音频跨域 + 长缓存）
```

### 配乐为什么这样改（2026-11）

GitHub Pages 在国内线路带宽时快时慢（实测 25KB/s ~ 500KB/s 都出现过），
把 `<audio src=远程地址>` 直接交给浏览器，播放中途网速一掉就断流 → 卡顿。

现在的做法（`shanhe/assets/js/audio-engine.js` + `shanhe/assets/js/main.js`）：

1. **先出声** —— 点下去立刻用原生流式播第一条线路，第一秒就有声。
   （页面打开时 `preload="none"`，一张音频都不下载；上一版 7 首同时预取
   元数据，等于页面一打开就有 7 条连接抢带宽。）
2. **并行分块下整首** —— 同时把曲子切成 8 块一起下（单条线路再快也就几百 KB/s，
   8 条并行就是 8 倍速度），下完存成内存 Blob 并**无缝切过去**。
   切过去之后播放期间完全不碰网络 → 卡顿从根上消失，拖进度条也稳。
   服务器不支持 Range（Cloudflare Pages 实测永远回 200）时自动退回整首竞速。
3. **多源竞速** —— 同源 / jsDelivr / GitHub Pages / raw.githubusercontent /
   Cloudflare Pages 镜像同时参与，谁先跑完用谁，其余立刻掐断；
   每 1.2 秒重新排名，落后太多的线路直接放弃。
4. **看门狗自动换线** —— 播放位置和缓冲都不动超过 4 秒就自动换下一条线路，
   换源后从原位置接着播；还没出声时给 7 秒宽限。**这就是"关键时刻换播放方案"**，
   不用用户重按。
5. **本地缓存** —— 整首存进 Cache Storage，第二次播放秒开，断网也能播。

音频本身从 180kbps 压到 80kbps（体积 −57%），并改名 `.web.mp3` + 带
`?v=<内容md5前10位>` 查询串，彻底避开 CDN 与浏览器的旧缓存。母版仍在 git 历史里。

> ⚠️ `<audio>` 必须带 `crossorigin="anonymous"`：跨站取音频时否则浏览器按
> 「不透明响应」处理，**拖进度条会直接断流**（实测）。
> ⚠️ 直接播的线路必须支持 Range（回 206），否则拖进度条同样会断。

> 改了任何音频文件，必须同步改 `shanhe/assets/js/main.js` 里 SCORING 表的 `v` 值
> （重新算 md5 前 10 位），否则用户会拿到旧文件。

---

*NOCTURNE 视觉基底源自抖音样片（作者：Motdes AI阿峰），为其视觉语言的延展实现。*
