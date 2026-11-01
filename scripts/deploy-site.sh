#!/usr/bin/env bash
# ============================================================
# 上线：GitHub Pages + Cloudflare 镜像
# ------------------------------------------------------------
# 薄封装，实际逻辑在仓库根的 deploy.sh（校验 → 提交推送 → 镜像）。
# 用法： bash scripts/deploy-site.sh
# ============================================================
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "▶ 交给根目录 deploy.sh 执行…"
echo ""
bash "$REPO_ROOT/deploy.sh"
