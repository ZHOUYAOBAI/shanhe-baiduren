---
name: script-site
description: Build a publishable, script-reading website from a screenplay (docx/md/txt) — parse the script, author the site metadata, generate a light paper-themed single-page site (old-book texture, brushed-calligraphy title, layered 3D) with act navigation, song catalogue, cast and foreshadowing sections, an optional password gate for the full text, run it locally, and deploy to GitHub Pages. Mobile-first. Use when the user finishes a script and wants a site for it, asks to turn a screenplay into a website, wants to preview or update an existing script site, or mentions 剧本站 / 剧本网站 / 建站 / 上 GitHub Pages for a script. Not for building a generic marketing site or a blog.
---

# 剧本站（Script Site）

把写完的剧本变成一个**可以直接发链接的阅读站**：纯静态、零构建、零运行时依赖，
本地 `node serve.mjs` 即看，GitHub Pages 一条命令上线。

工具链分三层，**不要合并**——这是整套流程能反复复用、不越改越烂的前提：

```
剧本 .docx / .md / .txt
  → parse-script.mjs   解析层：文档 → 结构（script_struct.json）
  → build-data.mjs     映射层 + 加密层：结构 + site_meta.json → data.js
  → audit.mjs          校验：剧本每一段文字都在站点上
```

## 开始之前

需要一个剧本文件（`.docx` / `.md` / `.txt`）。其余依赖：**Node ≥ 18**（必需）；
GitHub CLI `gh`（只在部署时需要）；`git`。**不需要 pip、python-docx 或任何 npm 包**——
docx 解析、加密、静态服务器全部由 Node 标准库完成。

## 流程

### 1. 读剧本，写 `site_meta.json`

先完整读一遍剧本。`site_meta.json` 是**人工撰写的剧目信息**，机器没法从正文里推出来，
必须由你读完剧本后写。这是整条流程里唯一需要「创作判断」的环节。

最简骨架：

```json
{
  "slug": "dukou",
  "name": "渡口没有钟",
  "title": "原创剧本《渡口没有钟》· 全文在线读",
  "kicker": "湘西民谣题材 · 原创实验话剧",
  "seal": "渡",
  "theme": "一条渡口，一口哑了三十年的钟",
  "span": "1964 — 1982 — 多年后",
  "author": "编剧署名",
  "music": "作曲署名",
  "scene": "river",
  "palette": { "bg": "#EFE5D8", "accent": "#B22D1D", "accentDeep": "#8A1E13", "accent2": "#806010", "accent3": "#33486B" },
  "motif": "lantern",
  "mainline": ["雾里的等渡人", "修好的钟", "该走的人"],
  "timeline": [{ "act": 0, "date": "1964 · 秋", "label": "雾里的等渡人" }],
  "threads": [{ "name": "那口钟", "color": "#886818", "plant": "第一幕埋下…", "pay": "尾幕收回…" }],
  "cast": [{ "name": "老周", "role": "守渡人", "desc": "在渡口守了三十年。" }],
  "front": [{ "title": "戏核", "paras": ["全剧要说的那句话。"], "tags": ["主题"] }],
  "frontCount": 0,
  "sections": {
    "songs": { "title": "全剧两首" },
    "cast": { "title": "三个人，一条江" },
    "front": { "title": "创作总纲 · 戏核", "lockedDesc": "本剧附有创作总纲 12 项。" }
  }
}
```

**`front` 是可选的**：剧本开头有一段「创作总纲 / 戏核 / 修订手记」时，
把它写进 `front` 数组，站点会做成可展开的卡片墙（带表格的整行铺开）。
没有就省略，`frontCount` 只用于锁定态的提示文案。
`sections.front` 控制该区块的眉标、标题与锁定描述。

字段全集见 `references/data-schema.md`；配色与版面见 `references/site-design.md`。
**写完先检查三件事**：剧名/副题、每幕的时间地点人物、伏笔的「埋」与「收」是否对得上原文。

### 2. 构建

```bash
SKILL=~/.codex/skills/script-site

# 不设密码：全文公开，不要权限门
node $SKILL/scripts/build-site.mjs \
  --script 我的剧本.md --meta site_meta.json --out ./my-site

# 设密码：正文与歌词加密，只有输入密码才看得到
READ_PASS='你的密码' node $SKILL/scripts/build-site.mjs \
  --script 我的剧本.md --meta site_meta.json --out ./my-site
```

输出目录就是一个完整站点：`index.html` / `404.html` / `favicon.svg` /
`assets/{css,js}` / `working/script_struct.json`（中间产物，**部署时会被剔除**）。

密码只从环境变量 `READ_PASS` 读，**绝不写进仓库或 data.js**。
改密码 → 改环境变量重新构建，密文会跟着变。

### 3. 校验（不可跳过）

构建最后一步会自动跑 `audit.mjs`，核对剧本里**每一个非空段落**是否都上了站。
必须看到「缺失 0」才算完。

有缺失时：先看缺失的是不是**结构标签**（「曲目表」「人物表」这类附录标题不算正文）。
若确实漏了正文，多半是剧本格式没被识别——查 `working/script_struct.json` 的
`speaker_candidates` / `ambiguous_speakers`，把确认过的角色名写进 `site_meta.json` 的
`speakers` 数组再构建。

### 4. 本地预览（手机同看）

预览时**必须看一眼手机**。多数观众在手机上读：

```bash
node $SKILL/scripts/serve.mjs ./my-site
```

打印 localhost 与局域网地址，手机同 Wi-Fi 直接打开。桌面浏览器把窗口缩窄只能看个大概，
触控尺寸、横向滚动、首列吸附这类问题得在真机上验。

改完刷新即见（禁用缓存）。权限门依赖 WebCrypto，**必须走 localhost 或 HTTPS**，
用 `file://` 打开会解不开。

#### 交付前的自检（390 + 1440 各跑一遍）

```bash
PWCLI="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
for vp in "390 844" "1440 900"; do
  set -- $vp
  "$PWCLI" -s=acc resize $1 $2
  "$PWCLI" -s=acc goto "http://localhost:8000/?cb=$RANDOM"
  sleep 2
  "$PWCLI" -s=acc eval "() => {
    const qa = s => [...document.querySelectorAll(s)];
    const hidden = el => { let n = el;
      while (n && n !== document.body) { const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
        if (parseFloat(cs.opacity) === 0) return true;
        if (cs.pointerEvents === 'none' && n !== el) return true; n = n.parentElement; }
      return false; };
    const tb = document.querySelector('#topbar').getBoundingClientRect();
    return {
      vw: innerWidth,
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      topbarH: Math.round(tb.height),
      topbarVar: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim(),
      small: qa('a,button,[role=button],input').filter(el => {
        if (hidden(el)) return false; const r = el.getBoundingClientRect();
        return r.width && r.height && (r.height < 43.5 || r.width < 43.5);
      }).map(el => el.tagName.toLowerCase() + '.' + String(el.className||'').split(' ')[0]
        + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height)),
    }; }"
done
```

判定标准：`hScroll` 为 false、`small` 为空、`topbarH` 与 `topbarVar` 一致。
不一致就回到 `references/site-design.md` 第七节对着改。

再验一次 3D 门控（窄屏用鼠标划过卡片，**不该**有 3D 变换）：

```bash
"$PWCLI" -s=acc resize 390 844
"$PWCLI" -s=acc goto "http://localhost:8000/?cb=$RANDOM"
sleep 2
"$PWCLI" -s=acc eval "() => {
  const el = [...document.querySelectorAll('.tilt3d')]
    .find(e => { const r = e.getBoundingClientRect();
      return r.width > 40 && r.height > 40 && r.top > 60 && r.bottom < innerHeight - 40; });
  if (!el) return { note: '视口内没有 .tilt3d，换个滚动位置再试' };
  const r = el.getBoundingClientRect();
  return { cx: Math.round(r.left + r.width/2), cy: Math.round(r.top + r.height/2) }; }"
# 用上一步返回的 cx/cy 调 mousemove，再查 transform
"$PWCLI" -s=acc mousemove <cx> <cy>
"$PWCLI" -s=acc eval "() => {
  const el = document.querySelector('.tilt3d');
  return { rx: el.style.getPropertyValue('--rx') || '(unset)',
           transform: getComputedStyle(el).transform }; }"
```

`transform` 必须是 `none`、`rx` 必须是 `(unset)`。
桌面（1440px）则应当有 `matrix3d(...)` —— 两边都对了才算门控成立。

### 5. 部署到 GitHub Pages

```bash
node $SKILL/scripts/deploy-pages.mjs ./my-site --repo 用户名/仓库名 [--subdir 子目录]
```

- 仓库不存在 → 自动 `gh repo create`（公开），站点在仓库根。
- 仓库已存在 → 克隆后把站点放进 `--subdir` 指定的子目录，**不动仓库里其他内容**。
  多部剧本同仓（`shanhe/`、`xishan/` 这种）就用这个模式。
- 脚本会自动配置 Pages（branch=main, path=/子目录）。失败时手动在
  仓库 Settings → Pages 里选 Deploy from a branch → main → 对应目录。

部署前必须 `gh auth login`（脚本会检查并给出提示）。
**没登录就不要推送**——把本地站点和部署命令交给用户，让用户自己登录后跑。
Pages 生效约 1–2 分钟。

**用户已有剧集仓库时**（一部剧本一个子目录），部署细节见
`references/deploy.md` 的「多部剧本同仓」一节：
要同时改仓库根的剧目卡片、栅格列数、纹章 SVG 和 `deploy.sh`，
漏一处就「推上去了但找不到」。SSH 密钥能通时不需要 `gh`——
只有「新建仓库」才必须走 API。

## 硬约束

- **校验必须过**：审计缺失不为 0 就是剧本没完整上站，不能交付。
- **密码不入库**：只用 `READ_PASS` 环境变量；不写进 `site_meta.json`、不写进提交。
- **不手改 `data.js`**：那是构建产物。改内容 → 改 `site_meta.json` 或剧本 → 重新构建。
- **不合并三层**：解析规则改 `parse-script.mjs`，站点语义改 `build-data.mjs`。
  见过有人在新剧本上另写一套解析器，结果每次格式微调都要重写一遍。
- **模板是共享的**：`assets/template/` 属于技能本体，多个剧本共用。
  某一剧的专属样式写进该剧的 `palette` / `sections`，不要改模板。
  确实需要模板级改动时，改完先跑一遍已有剧目的构建，确认没打破别的站。
- **要覆盖「增强层」的断点规则，一律写在 CSS 末尾**：`main.css` 上半段的「增强层」会
  重新定义 `.hero` / `.song-body` / `.paper-fibers` / `.tools` / `.tilt3d` /
  `.front-card` 等，**断点块排在它们前面会被整段吃掉**——手机上看到的一直是
  增强层的桌面值。（2026-11 审查里最隐蔽的一个系统性缺陷。）
  规则：凡是针对上面这些选择器的覆盖，追加到文件末尾的「响应式补丁」一节。
  与基础规则不冲突的断点块（如 `.hero-placard`、`.cmdk`）就地放着也无妨。
  **拿不准就放末尾**——放末尾永远不会错，放前面可能会被吃掉。
- **对比度 ≥ 4.5**：正文级文字与底色的比值不低于 4.5:1。
  **构建时会逐项验算并自动校正**（`normalizePalette()`，**九项契约**，含
  「暗金配表头底」「靛青配底」这种容易漏检的组合），输出里会打印实测比值。
  看到「对比度不足，已自动校正」就说明 `site_meta.json` 的色板写歪了，
  回头把值改合规——自动校正只是兜底。
- **配色是分层级的，不是几个色号**：底 `bg` 比卡片 `bg2` **沉一档**，
  卡片才浮得起来；强调色各司其职 ——
  `accent` 朱砂（结构色：印章、眉标、幕题、按钮）、
  `accentDeep` 深朱砂（**大面积实底**：幕次轨、表头、界栏）、
  `accent2` 灯油金（暖光，只做灯火与描边）、
  `accent3` 靛青（冷光，做投影和 3D 暗面）。
  **冷暖成对是 3D 立体的前提**：受光面走金、背光面走靛青，
  只用一层灰影的卡片是「浮在纸上」，不是「被照亮」。
  剧目自带色彩词汇时（如「红心布是全剧唯一高饱和的颜色」），
  主色应当降饱和压暗成朱砂，而不是直接用国旗红。
- **红色歌剧 = 红做结构，不是红做点缀**：深朱砂只给三处实底
  （幕次轨 / 表头 / 界栏），其余靠线、靠印、靠眉标；
  读面（卡片、正文、纸纹）保持米白。铺红铺满会闷会脏。
  **中性色避开土黄 / 卡其**——那是「旧」不是「红歌剧」，
  底色走暖红宣纸（如 `#EFE5D8`）而不是粉或米黄。
- **金色会发绿**：压深的灯油金当小字色会变橄榄绿，一眼旧。
  **11–13px 的标签一律用朱砂**（表头、`.sc-act`、`.cast-role`、
  `.thread dt`、`.mf-sec`）；金色只留给灯火与描边。
  铜箍要金属感就掺亮金，红漆木盖 + 金边更像「红灯笼」。
- **改深朱砂底上的反白要单独算**：中间调的 accent 反白未必在深底上也够。
  `--on-accent-deep` 由 `pickOnAccent(accentDeep)` 单独算，
  不要借用 `--on-accent`。
- **HERO 右半不许空着**：模板在宽屏右栏放一盏 3D 马灯（八面纸屏绕轴），
  窄屏挪到标题上方。**别用绝对定位摆它** —— HERO 高度随剧目变，
  绝对定位的灯迟早压到字上，用文档流（`order: -1` + 定高槽）。
  不要这盏灯就写 `"motif": "none"`。
- **3D 三道门控 CSS 与 JS 必须同时成立**：`(hover: hover) and (pointer: fine)`、
  `prefers-reduced-motion: reduce`、视口 > 720px。JS 只判 `(hover: none)` 不算数
  （触摸屏笔记本会中招）；条件在运行时会变，监听要能摘能挂，失效时把已转起的元素放平。
  窄屏的 3D 块必须写在 CSS **最后**且权重与 hover 规则相同。
  **不要删掉这三道门控。**
- **手机端按 390px 验收**：触控目标 ≥ 44×44，顶栏不溢出，
  `document.documentElement.scrollWidth === clientWidth`（不能有横向滚动），
  宽表要么放得下、要么首列吸附 + 给滑动提示。
- **默认亮色**：用户说「不要暗色」时，浅色宣纸底是默认；深色由底色明度自动切换。

## 站点能力（模板已实现，不需要再写）

程序化 Canvas 背景（`mountain` / `river` / `fire` / `sea` / `stage` / `forest` 六种景别，
配色跟随 CSS 变量）、旧书纸感（纸纤维 / 帘纹 / 茶渍 / 泛黄纸边）、
毛笔立体标题（`Ma Shan Zheng` 自托管子集）、**HERO 的 3D 马灯**（八面纸屏绕轴转面）、
左侧幕次轨、顶栏滚动联动、
主线时间轴、创作总纲卡片墙、逐幕资料卡、可展开曲目卡、歌单墙、曲目表、
同曲异形、人物同台关系图、人物卡、伏笔卡、歌词弹层、⌘K 全剧检索、
台本 / 沉浸双模式、字号调节、角色台词过滤、AES-256-GCM 权限门、
响应式与打印样式。

3D 资产分三层降级：悬停微转只在 `(hover: hover) and (pointer: fine)` 生效，
窄屏退回平面，`prefers-reduced-motion` 全部静止——**不要删掉这三道门控**。
CSS 的 `@media` 与 JS 的 `motionOk()` 必须逐条对齐，窄屏时已经把转起来的
元素放平（不是等刷新）。

哪个景别配哪部戏，看 `references/site-design.md`。

## 常见问题

| 症状 | 原因 / 处理 |
|---|---|
| 页面全白 | 控制台报 `window.SCRIPT` 未定义 → 构建没跑成功，重新 `build-site.mjs` |
| 输入密码没反应 | 不是 HTTPS/localhost，WebCrypto 被禁用 |
| 幕次识别不出来 | 剧本标题不含「幕/序/尾声」→ 在 `site_meta.json` 里显式给 `actHeadings`，或把标题改成常规写法 |
| 台词被当成旁白 | 角色名只出现一次 → 加进 `site_meta.json` 的 `speakers` 数组 |
| 角色名被误判成台词 | 「甲：乙」式旁白 → 同上，用 `speakers` 白名单排除 |
| 手机上导航挤成一团 | 顶栏单行放不下 → 两行布局 + 导航横向滚动条，见 `references/site-design.md` |
| 手机上表格右边被裁 | 栅格子项缺 `min-width: 0`，或表格没做首列吸附 + 滑动提示 |
| 线上还是旧内容 | Pages 有缓存，`Ctrl+Shift+R` 强制刷新；或等 1–2 分钟 |
| 音频播不出 | 文件名含中文/空格 → 用 URL 编码，或确认 `assets/audio/` 下的文件名 |
