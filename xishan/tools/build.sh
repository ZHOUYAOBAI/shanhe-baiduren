#!/usr/bin/env bash
# 《西山不是山》· 一键构建
# 用法: ./xishan/tools/build.sh [剧本.md]
#
# 流程（分层，勿合并）：
#   剧本 .md
#     → extract_script.py   解析层 → script_struct.json
#     → gen_site_data.py    映射层 → data.js
#   同时 gen_svg.py 生成铜版画线稿
set -e
cd "$(dirname "$0")/.."

SCRIPT="${1:-}"
if [ -z "$SCRIPT" ]; then
  # 默认找工作区里最新的中小型版剧本
  SCRIPT=$(ls -t /Users/yb/WorkBuddy/*/output/xishan-not-a-mountain-2026/stage4/final_draft.md 2>/dev/null | head -1)
fi
if [ ! -f "$SCRIPT" ]; then
  echo "✗ 找不到剧本文件。用法: $0 <剧本.md>" >&2
  exit 1
fi

echo "① 解析剧本 → script_struct.json"
python3 tools/extract_script.py "$SCRIPT" working/script_struct.json

echo "② 映射数据 → data.js"
python3 tools/gen_site_data.py working/script_struct.json assets/js/data.js

echo "③ 生成铜版画线稿"
python3 tools/gen_svg.py

echo "④ 校验"
python3 - <<'PY'
import json, os, re, sys
ok = True
for f in ('index.html', 'assets/css/main.css', 'assets/css/tokens.css',
          'assets/js/main.js', 'assets/js/scene.js', 'assets/js/data.js',
          'assets/js/hatch.js', 'assets/js/three.module.js'):
    if not os.path.isfile(f) or os.path.getsize(f) == 0:
        print('  ✗ 缺失或为空:', f); ok = False
# three.module.js 必须是自包含版（零外部 import）
# 拆分版需额外请求 1.4MB 的 three.core.js，GitHub Pages 上传输可达 70 秒，
# 导致模块图长时间解析不完，页面脚本静默不执行
tm = open('assets/js/three.module.js', encoding='utf-8', errors='replace').read()
if re.search(r"from\s*['\"]\./three\.core\.js['\"]", tm):
    print('  ✗ three.module.js 依赖外部 three.core.js，须改用自包含版'); ok = False
if os.path.exists('assets/js/three.core.js'):
    print('  ! assets/js/three.core.js 已无用，建议删除')
d = json.load(open('working/script_struct.json', encoding='utf-8'))
print('  幕 %d ／ 场 %d ／ 唱段 %d'
      % (len(d['acts']), len(d['scenes']), len(d['songs'])))
ly = sum(len([x for x in s['items'] if x['k'] == 'ly']) for s in d['songs'])
print('  歌词行 %d' % ly)
svgs = [f for f in os.listdir('assets/svg') if f.endswith('.svg')]
print('  线稿 %d 张' % len(svgs))
css = open('assets/css/main.css', encoding='utf-8').read() + \
      open('assets/css/tokens.css', encoding='utf-8').read()
defined = set(re.findall(r'(--[\w-]+)\s*:', css))
used = set(re.findall(r'var\((--[\w-]+)', css))
miss = used - defined
if miss:
    print('  ✗ CSS 变量未定义:', sorted(miss)); ok = False
html = open('index.html', encoding='utf-8').read()
js = open('assets/js/main.js', encoding='utf-8').read()
ids = set(re.findall(r'id="([^"]+)"', html))
need = set(re.findall(r"\$\('#([\w-]+)'\)", js))
if need - ids:
    print('  ✗ JS 引用了不存在的 id:', sorted(need - ids)); ok = False
print('  ✓ 校验通过' if ok else '  ✗ 校验未通过')
sys.exit(0 if ok else 1)
PY

echo "⑤ 观众视角回归测试"
if command -v node >/dev/null 2>&1; then
  node tools/interact.mjs "$(pwd)" | tail -8
  if [ "${PIPESTATUS[0]}" != "0" ]; then
    echo "  ! 交互测试有失败项，请检查"
  fi
else
  echo "  (跳过：未找到 node)"
fi

echo "✓ 构建完成 → xishan/"
