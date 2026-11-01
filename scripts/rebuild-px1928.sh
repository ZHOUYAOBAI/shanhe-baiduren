#!/usr/bin/env bash
# ============================================================
# 重建《百年星语·破晓1928》站点
# ------------------------------------------------------------
# 用法：
#   bash scripts/rebuild-px1928.sh "/路径/到/剧本.docx"
#   SCRIPT_DOCX="/路径/剧本.docx" bash scripts/rebuild-px1928.sh
#
# 不给路径时会自动在 iCloud Drive / Downloads / 剧本目录里找。
#
# 密码：优先读环境变量 READ_PASS，其次读 ~/.config/script-site/readpass，
#       都没有就交互式询问（不回显）。密码不会写进仓库。
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL="$REPO_ROOT/tools/script-site"
META="$REPO_ROOT/projects/px1928/site_meta.json"
OUT="${OUT:-$REPO_ROOT/outputs/px1928}"
PASSFILE="$HOME/.config/script-site/readpass"

say()  { printf '%s\n' "$*"; }
ok()   { printf '   ✓ %s\n' "$*"; }
warn() { printf '   ⚠ %s\n' "$*"; }
bad()  { printf '   ✗ %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------- 找剧本 ----------
step "① 定位剧本源文件"

DOCX="${1:-${SCRIPT_DOCX:-}}"
if [ -z "$DOCX" ]; then
  CANDIDATES=(
    "$HOME/Library/Mobile Documents/com~apple~CloudDocs/剧本/《百年星语·破晓1928》云南本土红色歌剧.docx"
    "$HOME/Downloads/《百年星语·破晓1928》云南本土红色歌剧.docx"
    "$HOME/Documents/剧本/《百年星语·破晓1928》云南本土红色歌剧.docx"
  )
  for c in "${CANDIDATES[@]}"; do
    [ -f "$c" ] && { DOCX="$c"; break; }
  done
fi

if [ -z "$DOCX" ] || [ ! -f "$DOCX" ]; then
  bad "没找到剧本 docx。"
  say ""
  say "  把源剧本放到下面任一位置（或运行时直接给路径）："
  say "    ~/Library/Mobile Documents/com~apple~CloudDocs/剧本/"
  say "    ~/Downloads/"
  say "    ~/Documents/剧本/"
  say ""
  say "  用法：bash scripts/rebuild-px1928.sh \"/完整路径/剧本.docx\""
  say ""
  say "  ⚠ 剧本体是明文，仓库里不放 —— 只放构建出来的站点。"
  exit 1
fi
ok "$(basename "$DOCX")"
say "     $DOCX"

if [ ! -f "$META" ]; then
  bad "内容源缺失：$META"
  exit 1
fi
ok "内容源 projects/px1928/site_meta.json"

# ---------- 读密码 ----------
step "② 取阅读密码"

if [ -n "${READ_PASS:-}" ]; then
  ok "用环境变量 READ_PASS"
elif [ -f "$PASSFILE" ]; then
  READ_PASS="$(cat "$PASSFILE")"
  ok "用 $PASSFILE"
else
  printf '   请输入阅读密码（不回显）：'
  read -rs READ_PASS; printf '\n'
  mkdir -p "$(dirname "$PASSFILE")"
  printf '%s' "$READ_PASS" > "$PASSFILE"
  chmod 600 "$PASSFILE"
  ok "已记到 ${PASSFILE}（不入库）"
fi

if [ -z "${READ_PASS:-}" ]; then
  warn "密码为空 —— 构建出来的是**不加密**站点，全文公开。别上线。"
  say "     设 READ_PASS 环境变量，或重新跑。"
  exit 1
fi

# ---------- 构建 ----------
step "③ 构建"

command -v node >/dev/null 2>&1 || { bad "没装 Node.js（需要 ≥18）"; exit 1; }
rm -rf "$OUT"
READ_PASS="$READ_PASS" node "$SKILL/scripts/build-site.mjs" \
  --script "$DOCX" \
  --meta   "$META" \
  --out    "$OUT"

# ---------- 同步进仓库 ----------
step "④ 同步进仓库 px1928/"

rsync -a --delete \
  --exclude 'working/' \
  --exclude '.DS_Store' \
  "$OUT/" "$REPO_ROOT/px1928/"

if [ -d "$REPO_ROOT/px1928/working" ]; then
  bad "px1928/working/ 是剧本明文，不能进仓库！"
  exit 1
fi
ok "px1928/ 已更新"

step "⑤ 下一步"
say "  本地预览： node $SKILL/scripts/serve.mjs \"$OUT\""
say "  上线：     bash scripts/deploy-site.sh"
say ""
ok "重建完成。"
