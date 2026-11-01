#!/usr/bin/env bash
# ============================================================
# 剧作站点 · 新机一键引导
# ------------------------------------------------------------
# 换电脑后，只做两件事：
#   1) git clone 本仓库
#   2) 跑这个脚本
#
# 脚本做四件事：
#   ① 检查运行时（node / git / 网络）
#   ② 把仓库里的建站工具链装到 ~/.codex/skills/script-site
#   ③ 检查 GitHub 凭据（SSH key），缺了就把命令打印出来
#   ④ 检查部署凭据（gh / wrangler），缺了就说明怎么补
#
# 用法：  bash scripts/bootstrap.sh
# 幂等：可以反复跑，不会覆盖你改过的 skill（会先备份）
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_SRC="$REPO_ROOT/tools/script-site"
SKILL_DST="$HOME/.codex/skills/script-site"
GIT_REPO="git@github.com:ZHOUYAOBAI/shanhe-baiduren.git"

say()  { printf '%s\n' "$*"; }
ok()   { printf '   ✓ %s\n' "$*"; }
warn() { printf '   ⚠ %s\n' "$*"; }
bad()  { printf '   ✗ %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# macOS 自带 bash 3.2 没有 timeout 命令；且 bash 3.2 会把 $VAR 后面紧跟的
# 中文全角字符吞进变量名 —— 所以下面所有变量插值都用 ${} 形式。
run_bounded() {
  local secs="$1"; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill -9 "$pid" 2>/dev/null ) & local watcher=$!
  wait "$pid" 2>/dev/null; local rc=$?
  kill -9 "$watcher" 2>/dev/null
  return $rc
}

say "剧作站点 · 新机引导"
say "仓库：$REPO_ROOT"

# ---------- ① 运行时 ----------
step "① 运行时检查"

NODE_OK=1
if ! command -v node >/dev/null 2>&1; then
  bad "没装 Node.js —— 装 v18 或更高：https://nodejs.org"
  NODE_OK=0
else
  NV="$(node -v)"; NMaj="${NV#v}"; NMaj="${NMaj%%.*}"
  if [ "$NMaj" -lt 18 ] 2>/dev/null; then
    bad "Node $NV 太旧（需要 ≥ 18）"
    NODE_OK=0
  else
    ok "Node $NV"
  fi
fi

if command -v git >/dev/null 2>&1; then
  ok "git $(git --version | awk '{print $3}')"
else
  bad "没装 git —— macOS 可先跑：xcode-select --install"
fi

if [ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]; then
  ok "iCloud Drive 在（剧本放这里，换机自动同步）"
  ICLD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
else
  warn "没找到 iCloud Drive —— 剧本源文件请另行同步（见「剧本放哪」）"
  ICLD=""
fi

# ---------- ② 装 skill ----------
step "② 安装建站工具链 → $SKILL_DST"

if [ ! -d "$SKILL_SRC" ]; then
  bad "仓库里找不到 tools/script-site —— clone 完整了吗？"
elif [ ! -d "$SKILL_DST" ]; then
  mkdir -p "$SKILL_DST"
  rsync -a --exclude '.cache' --exclude '.DS_Store' "$SKILL_SRC/" "$SKILL_DST/"
  ok "已安装"
elif diff -rq --exclude='.cache' --exclude='.DS_Store' "$SKILL_SRC" "$SKILL_DST" >/dev/null 2>&1; then
  ok "已是最新"
else
  BAK="${SKILL_DST}.bak.$(date '+%Y%m%d-%H%M%S')"
  cp -R "$SKILL_DST" "$BAK"
  rsync -a --exclude '.cache' --exclude '.DS_Store' "$SKILL_SRC/" "$SKILL_DST/"
  ok "已更新（旧版备份在 ${BAK}）"
fi
ok "skill 位置：$SKILL_DST"

# ---------- ③ GitHub 凭据 ----------
step "③ GitHub 凭据"

SSH_KEY=""
for k in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa"; do
  [ -f "$k" ] && { SSH_KEY="$k"; break; }
done

if [ -n "$SSH_KEY" ]; then
  ok "找到 SSH 私钥：$SSH_KEY"
else
  warn "没有 SSH 私钥 —— 生成一把："
  say "      ssh-keygen -t ed25519 -C '你的邮箱'"
  say "      cat $HOME/.ssh/id_ed25519.pub   → 贴到 github.com/settings/keys"
fi

if git ls-remote --exit-code "$GIT_REPO" >/dev/null 2>&1; then
  ok "能推送到 $GIT_REPO"
else
  warn "还不能推送（多半是密钥没加到 GitHub）—— 先解决这一步，后面才推得上去"
  say "      测一下：ssh -T git@github.com"
fi

if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    ok "gh CLI 已登录"
  else
    warn "gh CLI 装了但没登录 —— 建新仓库才需要：gh auth login"
  fi
else
  warn "没装 gh CLI —— 只影响「新建仓库」，不影响给已有仓库加子目录"
fi

# ---------- ④ 部署凭据 ----------
step "④ 部署凭据"

if command -v wrangler >/dev/null 2>&1; then
  ok "wrangler 已安装"
  if run_bounded 25 wrangler whoami >/dev/null 2>&1; then
    ok "wrangler 已登录"
  else
    warn "wrangler 没登录 —— 第一次用要跑：npx wrangler login"
  fi
elif command -v npx >/dev/null 2>&1; then
  ok "npx 可用（Cloudflare 镜像用它）"
  warn "wrangler 未安装 —— 第一次部署会自动下载；登录跑：npx wrangler login"
else
  warn "没有 npx —— Cloudflare 镜像部署会跳过（GitHub Pages 不受影响）"
fi

# ---------- 收尾 ----------
step "⑤ 接下来做什么"

say "  重建《百年星语·破晓1928》："
say "      bash scripts/rebuild-px1928.sh \"/路径/到/剧本.docx\""
say ""
say "  本地预览："
say "      node $SKILL_DST/scripts/serve.mjs outputs/px1928"
say ""
say "  上线（GitHub Pages + Cloudflare 镜像）："
say "      bash scripts/deploy-site.sh"
say ""
say "  详细说明见 README.md 的「换电脑继续」一节。"

if [ "$NODE_OK" -eq 0 ]; then
  say ""
  bad "有运行时没装齐，先补齐再往下走。"
  exit 1
fi
say ""
ok "引导完成。"
