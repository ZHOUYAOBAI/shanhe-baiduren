#!/usr/bin/env bash
# rebuild-hub.sh — 根据 projects/*/site_meta.json 重新生成门户「剧目陈列」网格
# 用法: bash scripts/rebuild-hub.sh
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/script-site/scripts/build-hub.mjs --root . --projects projects --out index.html
