# 《百年星语·破晓1928》· 云南本土红色歌剧 · 全文在线读

《百年星语·破晓1928》完整剧本在线读。序幕至终幕五幕十一场、二十六首曲目，从 1928 年蒙自芷村的茅屋，到 1930 年昆明北郊的地台刑场，再回到 2024 年查尼皮纪念馆的一盏马灯。

## 本地预览

```bash
python3 -m http.server 8000   # 或：node ~/.codex/skills/script-site/scripts/serve.mjs
```

打开 http://localhost:8000 。

## 目录

```
index.html            入口
404.html              Pages 404 页
favicon.svg           站点图标
assets/css/tokens.css 设计令牌（尺度与排版）
assets/css/palette.css 配色（构建时写入）
assets/css/main.css   视觉系统
assets/js/data.js     公开层数据 + 受限层密文
assets/js/main.js     渲染与交互
assets/js/scene.js    程序化背景场景
assets/js/crypto.js   解密模块
working/              解析产物（不进公网仓库）
```

## 重新构建

```bash
READ_PASS='你的密码' node scripts/build-site.mjs \
  --script <剧本> --meta site_meta.json --out .
```

## 声明

《百年星语·破晓1928》原创剧本，人物、机构与史实细节以主创团队修订稿为准。本站仅用于内部研读与展演筹备。
