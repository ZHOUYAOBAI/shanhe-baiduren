#!/usr/bin/env bash
# 剧作站点 · 一键部署
# 用法：./deploy.sh
#
# 前置：本机已配置 GitHub SSH 密钥（git@github.com 可用）。
# 站点是纯静态产物，无构建步骤 —— 本脚本只做提交与推送。
set -e
cd "$(dirname "$0")"

echo "① 校验 NOCTURNE 剧作集（首页）…"
for f in index.html 404.html \
         assets/nocturne/css/tokens.css \
         assets/nocturne/js/hatch.js \
         assets/nocturne/js/scenes.js \
         assets/nocturne/vendor/three.module.js \
         assets/nocturne/svg/portrait.svg \
         assets/nocturne/docs/视觉规范.md; do
  [ -f "$f" ] || { echo "缺少文件：$f"; exit 1; }
done
echo "   ✓ 8 个核心文件齐全"

echo "② 校验《山河摆渡人》（shanhe/ 子目录）…"
for f in shanhe/index.html shanhe/404.html \
         shanhe/assets/css/main.css \
         shanhe/assets/js/main.js \
         shanhe/assets/js/data.js \
         shanhe/assets/js/scene.js \
         shanhe/assets/js/crypto.js \
         shanhe/assets/js/three.module.js; do
  [ -f "$f" ] || { echo "缺少文件：$f"; exit 1; }
done
echo "   ✓ 8 个核心文件齐全"

echo "③ 校验《西山不是山》（xishan/ 子目录）…"
for f in xishan/index.html xishan/404.html \
         xishan/assets/css/main.css \
         xishan/assets/css/tokens.css \
         xishan/assets/js/main.js \
         xishan/assets/js/data.js \
         xishan/assets/js/scene.js \
         xishan/assets/js/hatch.js \
         xishan/assets/js/three.module.js \
         xishan/assets/js/three.core.js \
         xishan/assets/svg/emblem-mountain.svg \
         xishan/assets/svg/object-door.svg; do
  [ -f "$f" ] || { echo "缺少文件：$f"; exit 1; }
done
echo "   ✓ 12 个核心文件齐全"

echo "④ 校验《百年星语·破晓1928》（px1928/ 子目录）…"
for f in px1928/index.html px1928/404.html px1928/favicon.svg \
         px1928/assets/css/main.css \
         px1928/assets/css/tokens.css \
         px1928/assets/css/palette.css \
         px1928/assets/css/fonts.css \
         px1928/assets/js/main.js \
         px1928/assets/js/data.js \
         px1928/assets/js/scene.js \
         px1928/assets/js/crypto.js \
         px1928/assets/fonts/brush-0.woff2; do
  [ -f "$f" ] || { echo "缺少文件：$f"; exit 1; }
done
echo "   ✓ 11 个核心文件齐全"

# working/script_struct.json 是全剧明文，绝不能进公网 —— 权限门会被绕过
if [ -d "px1928/working" ]; then
  echo "px1928/working/ 是剧本明文，不能入库"; exit 1
fi

echo "⑤ 检查暂存区没有剧本明文…"
git add -A
if git diff --cached --name-only | grep -qE '(^|/)working/'; then
  echo "   ✗ 暂存区出现 working/ 明文，已中止提交："
  git diff --cached --name-only | grep -E '(^|/)working/' | sed 's/^/       /'
  git reset -q
  echo "   清理后请重新检查（.gitignore 里 outputs/ 与 */working/ 应已覆盖）。"
  exit 1
fi
echo "   ✓ 暂存区无明文"

echo "⑥ 提交并推送…"
git add -A
git commit -m "update: $(date '+%Y-%m-%d %H:%M')" || true
git push origin main

echo "⑦ 同步到 Cloudflare Pages 镜像（国内线路更快，配乐靠它才流畅）…"
STAGE=$(mktemp -d /tmp/shanhe-pages-XXXX)
cp -R index.html 404.html favicon.svg assets shanhe xishan px1928 _headers .nojekyll "$STAGE"/
# shanhe/tools/ 是内部工具链（docx 解析与加密），不必发布到公网
rm -rf "$STAGE/shanhe/tools"
npx wrangler pages deploy "$STAGE" --project-name shanhe-baiduren --branch main \
  || echo "   ⚠️ 镜像部署失败（不影响 GitHub Pages，只是会慢一些）"

echo "⑧ 完成。"
echo "   GitHub Pages（约 1-2 分钟）："
echo "     NOCTURNE 剧作集：https://zhouyaobai.github.io/shanhe-baiduren/"
echo "     《山河摆渡人》　：https://zhouyaobai.github.io/shanhe-baiduren/shanhe/"
echo "     《西山不是山》　：https://zhouyaobai.github.io/shanhe-baiduren/xishan/"
echo "     《百年星语·破晓1928》：https://zhouyaobai.github.io/shanhe-baiduren/px1928/"
echo "   Cloudflare Pages 镜像（更快，配乐首选）："
echo "     《山河摆渡人》　：https://shanhe-baiduren.pages.dev/shanhe/"
echo "     《百年星语·破晓1928》：https://shanhe-baiduren.pages.dev/px1928/"
