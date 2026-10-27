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

echo "③ 提交并推送…"
git add -A
git commit -m "update: $(date '+%Y-%m-%d %H:%M')" || true
git push origin main

echo "④ 完成。GitHub Pages 约 1-2 分钟后自动更新。"
echo "   NOCTURNE 剧作集：https://zhouyaobai.github.io/shanhe-baiduren/"
echo "   《山河摆渡人》　：https://zhouyaobai.github.io/shanhe-baiduren/shanhe/"
