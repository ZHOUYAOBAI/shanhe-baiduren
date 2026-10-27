#!/usr/bin/env bash
# 《山河摆渡人》剧本站 · 一键部署
# 用法：./deploy.sh
#
# 前置：本机已配置 GitHub SSH 密钥（git@github.com 可用）。
# 站点是纯静态产物，无构建步骤 —— 本脚本只做提交与推送。
set -e
cd "$(dirname "$0")"

echo "① 校验站点完整性…"
for f in index.html assets/css/main.css assets/js/main.js assets/js/data.js assets/js/scene.js assets/js/three.module.js; do
  [ -f "$f" ] || { echo "缺少文件：$f"; exit 1; }
done
echo "   ✓ 6 个核心文件齐全"

echo "② 提交并推送…"
git add -A
git commit -m "update: $(date '+%Y-%m-%d %H:%M')" || true
git push origin main

echo "③ 完成。GitHub Pages 约 1-2 分钟后自动更新。"
echo "   线上地址：https://zhouyaobai.github.io/shanhe-baiduren/"
