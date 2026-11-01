# 部署到 GitHub Pages

站点是**纯静态产物**，没有构建步骤——部署只做提交与推送。

## 前置

```bash
gh auth login          # 只需一次
node --version         # ≥ 18
git --version
```

未登录时脚本会直接报错退出并提示 `gh auth login`。
也可设 `GH_TOKEN` / `GITHUB_TOKEN` 环境变量代替交互登录。

**没登录就不要替用户推送。** `gh` 未登录时，把本地站点路径与部署命令交给用户，
让他自己 `gh auth login` 之后再跑——不要尝试用别的方式绕过认证。

## 两种模式

### 新仓库（站点在根目录）

```bash
node ~/.codex/skills/script-site/scripts/deploy-pages.mjs ./my-site --repo 用户名/我的剧
```

自动 `gh repo create --public --push`，随后配置 Pages
（Deploy from a branch → main → `/`）。
线上地址：`https://用户名.github.io/我的剧/`

### 已有仓库（站点进子目录）

多部剧本同仓时用这个——脚本会克隆仓库、只更新指定子目录，
**仓库里其他内容原样保留**。

```bash
node ~/.codex/skills/script-site/scripts/deploy-pages.mjs \
  ./my-site --repo 用户名/我的剧集 --subdir mysite
```

线上地址：`https://用户名.github.io/我的剧集/mysite/`

Pages 的 Source 必须选 **Deploy from a branch** → 分支 `main` → 目录 `mysite`
（根目录则选 `/`）。脚本会尝试用 `gh api` 自动配置；失败时手动在
仓库 Settings → Pages 里改。

## 会被剔除的内容

部署时自动排除：

- `working/`（解析中间产物）
- `node_modules/`、`.DS_Store`
- `.git/`

站点目录里的 `scripts/`、`site_meta.json` 等工具链文件**不会**被剔除——
若不想公开，把它们移出站点目录，或自行在部署前删。

### `working/` 是全剧明文 —— 硬规则

`build-site.mjs` 会把 `script_struct.json`（**未加密的完整剧本**）写进
`<站点>/working/`。它只是构建中间产物，**绝不能进公网仓库**：
一旦发布，任何人直接下载这个 JSON 就拿到全剧，密码门形同虚设。

手动部署（不走 `deploy-pages.mjs`）时，拷站点务必排除它：

```bash
rsync -a --exclude 'working' --exclude '.DS_Store' ./my-site/ <仓库>/mysite/
```

仓库的 `.gitignore` 里加一条兜底（只管未跟踪文件，不影响已跟踪的历史文件）：

```
*/working/
working/
```

并用 `find <repo> -name script_struct.json` 复查一遍再推。

## 排查

| 症状 | 处理 |
|---|---|
| 404 | Pages 还没生效（1–2 分钟）；或 Source 没设成 branch/main/对应目录 |
| 页面全白 | 浏览器控制台看 `window.SCRIPT` 是否存在；检查 `assets/js/data.js` 有没有被推上去 |
| 改了内容线上没变 | Pages 缓存，`Ctrl+Shift+R` 强制刷新 |
| 密码解不开 | 必须 HTTPS/localhost；GitHub Pages 天然是 HTTPS |
| 图片/音频 404 | 路径含中文或空格 → 做 URL 编码；确认文件真的进了仓库 |

## 多部剧本同仓（陈屿剧作集那一套）

用户已有仓库时，惯例是**一个剧本一个子目录**，Pages 从仓库根发布：

```
仓库根/
  index.html          剧作集首页（陈列各剧目卡片）
  assets/             首页的资源
  shanhe/             《山河摆渡人》
  xishan/             《西山不是山》
  px1928/             《百年星语·破晓1928》
  deploy.sh           一键部署
```

线上地址就是 `https://用户名.github.io/仓库名/<子目录>/`。
Pages 的 Source 选 **branch / main / `/`（根目录）**，不是子目录——
子目录只是仓库里的普通文件夹。

新增一部剧要动的地方（都要动，缺一个就「部署了但找不到」）：

1. 新建 `<子目录>/`，拷站点产物（**排除 `working/`**）
2. 仓库根 `index.html` 的剧目卡片加一条 `<a class="work" href="<子目录>/">`
3. 卡片数变了，栅格列数也要跟着改（`repeat(5,1fr)` 放 6 个会变成 5+1 孤儿卡，
   6 个改成 `repeat(3,1fr)` 排 2 行更稳）
4. 给新剧配一枚纹章 SVG，放进 `assets/nocturne/svg/`，
   画法沿用同目录的 `emblem-*-ink.svg`：**纯墨色 `#0E0D12`、单线描边、
   不用填充色**，尺寸 180×180
5. `deploy.sh` 加一段文件校验（少文件就 `exit 1`），并把新子目录加进
   Cloudflare 镜像的 `cp -R` 列表
6. `deploy.sh` 末尾回显两个地址：GitHub Pages 与 Cloudflare Pages

### `gh` 没登录，但 SSH 能用

`gh auth login` 没做不代表推不了。SSH 密钥能通的话：

```bash
ssh -T git@github.com          # 出现 "Hi 用户名!" 就是通了
git clone git@github.com:用户名/仓库名.git
# 改完直接 git push origin main
```

但**建仓必须走 API**，只有 `gh` / token 能建。已有仓库加子目录不需要建仓，
所以「同仓多剧本」这条路 SSH 就够。

若 `gh` 确实没登录又需要建新仓，把本地站点路径和部署命令交给用户，
让他自己 `gh auth login` 后再跑——不要绕过认证。

## 备选：Cloudflare Pages

国内线路更快。构建产物直接传即可：

```bash
npx wrangler pages deploy ./my-site --project-name 我的剧集
```

`wrangler` 需要登录（`npx wrangler login`）。这不是必须的，
GitHub Pages 已经够用。
