# 《山河摆渡人》剧本站

红色庭院音乐剧《山河摆渡人》官方网站。

## 线上地址

https://zhouyaobai.github.io/shanhe-baiduren/

## 这是一个什么站

六幕完整剧本 + 46 首曲目完整歌词 + 10 位人物 + 6 条伏笔闭环。

- **首页 3D 火塘场景**：Three.js + 手绘钢笔排线着色器（hatching shader），朱砂红主调
- **六幕正文**：序幕 / 第一幕 / 第二幕 / 第三幕 / 第四幕 / 尾幕，专业剧本排版（角色名居中、台词缩进、歌词独立行距）
- **曲内有序流**：每首曲目的宣叙调、小节标记、歌词严格按原文顺序呈现
- **曲目总览**：46 首目录；同名主题歌的各段落带标记区分（主歌 A / 副歌 B / 桥段 / 大合唱 / 再现）
- **人物卡**：10 位主要角色
- **伏笔闭环**：骨哨、凤凰帕子、银镯、真假油布包、杀父之鞭、夜不渡皎平

## 视觉系统

| 角色 | 色值 | 用途 |
|---|---|---|
| `--ink` | `#2B0A0F` | 深朱砂，主底色 |
| `--ink-2/3` | `#3D1116` / `#541A20` | 次层 / 三层 |
| `--paper` | `#F7EDE2` | 暖米白，正文 |
| `--red` | `#D62038` | 正红，主强调 |
| `--red-lit` | `#FF6B57` | 火光橙红 |
| `--gold` | `#E0B040` | 彝金 |

红色为本剧血色，故以朱砂为底、宣纸为字、金作点睛；3D 火塘用金橙火焰，在红底上靠明度分层。

## 剧本阅读权限

**公开可见**：剧目概况（幕名 / 时间 / 地点 / 舞台氛围 / 出场人物）、核心主线、歌单目录、人物小传、伏笔结构。

**需密码**：六幕剧本正文（台词 / 舞台提示）与全部唱段歌词。

剧透正文在 `data.js` 中以 **AES-256-GCM 密文**存储：

- 密钥由 `PBKDF2-HMAC-SHA256(password, salt, 150000)` 派生
- 浏览器端用 WebCrypto `SubtleCrypto` 解密（需 HTTPS，GitHub Pages 满足）
- 直接查看网页源码只能得到 base64 密文，取不到剧透正文
- 解锁状态存 `sessionStorage`（会话级，关闭标签页即失效）

> 密码通过环境变量 `READ_PASS` 传入生成脚本，不写死在仓库里。

## 技术结构

纯静态站点，无构建步骤，无外部依赖（不引用 CDN 字体与图片）。

```
index.html                入口
404.html                  GitHub Pages 404 页
deploy.sh                 一键提交推送脚本
.nojekyll                 禁用 Jekyll
assets/css/main.css       视觉系统（朱砂/米白/彝金）+ 权限门样式
assets/js/data.js         公开层数据 + 剧透密文块
assets/js/crypto.js       浏览器端解密模块（PBKDF2 + AES-GCM）
assets/js/main.js         页面渲染、交互、权限门
assets/js/scene.js        Three.js 3D 火塘场景
assets/js/three.module.js Three.js 本地副本（1.3MB，为避免 CDN 依赖）
```

## 数据来源与更新

**关键约定：不要另写解析器。** 解析层与数据映射层必须分离。

```
docx（内容稿）
  └─ extract_script.py ──→ script_struct.json      （解析层，已验证）
       └─ gen_site_data3.py ──→ 结构 JSON           （数据映射层）
            └─ gen_site_data4.py ──→ data.js + crypto.js   （加密层）
```

自写 docx 解析器会引入歌词丢失、幕内资料丢失、唱段边界错乱等 7 处缺陷。

### 更新流程

```bash
# 1. 更新 docx
# 2. 重新解析
python3 extract_script.py "outputs/红色庭院音乐剧《山河摆渡人》(修订版).docx" \
                         output/typeset-20261028-0215/working/script_struct.json
# 3. 生成（密码走环境变量，不入库）
READ_PASS=你的密码 python3 gen_site_data4.py
# 4. 同步并推送
rsync -a --delete site/ /path/to/repo/ --exclude .git
./deploy.sh
```

## 史实与虚构声明

阿木、阿果为艺术虚构人物，原型是千千万万无名彝、汉、傣各族群众。
剧中真实地名、渡口、里程、船工姓名均依史实。

编剧：孙子岚 白耀洲 李思颖　｜　音乐：彭侠影 白耀洲 孙子岚
