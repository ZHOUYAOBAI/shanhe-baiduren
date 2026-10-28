#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NOCTURNE · 部署同步脚本
============================================================
把「主项目源」同步成「GitHub Pages 部署树」。

为什么需要它
------------------------------------------------------------
主项目与部署树的目录结构不同：

    主项目/                     部署树/
    index.html                 index.html
    tokens/tokens.css     →    assets/nocturne/css/tokens.css
    tokens/tokens.json    →    assets/nocturne/css/tokens.json
    assets/svg/*.svg       →    assets/nocturne/svg/*.svg
    assets/js/*.js         →    assets/nocturne/js/*.js
    assets/vendor/*.js     →    assets/nocturne/vendor/*.js
    docs/视觉规范.md       →    assets/nocturne/docs/视觉规范.md
    tools/gen_svg.py       →    assets/nocturne/tools/gen_svg.py

结构不同就会产生路径漂移 —— 之前 A/B 场景切换写死
`assets/svg/scene-stage.svg`，部署后实际路径是
`assets/nocturne/svg/scene-stage.svg`，点一下就 404。
手改两处必然再次漂移，所以改成脚本单向生成。

用法
------------------------------------------------------------
    python3 tools/sync_deploy.py /tmp/shanhe-work
    python3 tools/sync_deploy.py /tmp/shanhe-work --check
"""

import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- 部署树内的固定位置 ----
DEPLOY_PREFIX = "assets/nocturne"


def rewrite_paths(text: str) -> str:
    """把主项目里的资源路径改写成部署树路径。

    只改 HTML/CSS/JS 里的引用字符串，不碰内容本身。
    顺序有讲究：先改长的，避免前缀互相覆盖。
    """
    rules = [
        # CSS / JS 引用
        (r'(["\'])\./assets/js/', r'\1./assets/nocturne/js/'),
        (r'(["\'])\./assets/vendor/', r'\1./assets/nocturne/vendor/'),
        (r'(["\'])\./assets/svg/', r'\1./assets/nocturne/svg/'),
        # 相对写法（无 ./ 前缀）
        (r'(["\'])assets/js/', r'\1assets/nocturne/js/'),
        (r'(["\'])assets/vendor/', r'\1assets/nocturne/vendor/'),
        (r'(["\'])assets/svg/', r'\1assets/nocturne/svg/'),
        # token
        (r'(["\'])tokens/tokens\.css', r'\1assets/nocturne/css/tokens.css'),
        (r'(["\'])tokens/tokens\.json', r'\1assets/nocturne/css/tokens.json'),
        # 绝对根路径写法
        (r'(["\'])/assets/js/', r'\1assets/nocturne/js/'),
        (r'(["\'])/assets/vendor/', r'\1assets/nocturne/vendor/'),
        (r'(["\'])/assets/svg/', r'\1assets/nocturne/svg/'),
    ]
    for pat, rep in rules:
        text = re.sub(pat, rep, text)
    return text


def copy_rewritten(src: str, dst: str, exts=(".html", ".css", ".js", ".json", ".md")):
    """复制单个文件，文本类文件做路径改写。"""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.splitext(src)[1].lower() in exts:
        with open(src, "r", encoding="utf-8") as f:
            content = f.read()
        with open(dst, "w", encoding="utf-8") as f:
            f.write(rewrite_paths(content))
    else:
        shutil.copy2(src, dst)


def sync_tree(src_dir: str, dst_dir: str, rewrite: bool = True, skip=()):
    """整目录同步。skip 里的文件名会被跳过（用于 favicon 这类要放到别处的文件）。"""
    for base, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", "node_modules", ".workbuddy")]
        rel = os.path.relpath(base, src_dir)
        target_dir = dst_dir if rel == "." else os.path.join(dst_dir, rel)
        os.makedirs(target_dir, exist_ok=True)
        for name in files:
            if name in skip:
                continue
            src = os.path.join(base, name)
            dst = os.path.join(target_dir, name)
            if rewrite and os.path.splitext(name)[1].lower() in (
                ".html", ".css", ".js", ".json", ".md"
            ):
                with open(src, "r", encoding="utf-8") as f:
                    content = f.read()
                with open(dst, "w", encoding="utf-8") as f:
                    f.write(rewrite_paths(content))
            else:
                shutil.copy2(src, dst)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    deploy = os.path.abspath(sys.argv[1])
    check_only = "--check" in sys.argv

    noct = os.path.join(deploy, DEPLOY_PREFIX)

    # ---- 主项目 → 部署树 ----
    jobs = []

    # index.html：路径改写后覆盖部署树根
    jobs.append((
        os.path.join(ROOT, "index.html"),
        os.path.join(deploy, "index.html"),
    ))

    # token
    jobs.append((
        os.path.join(ROOT, "tokens", "tokens.css"),
        os.path.join(noct, "css", "tokens.css"),
    ))
    jobs.append((
        os.path.join(ROOT, "tokens", "tokens.json"),
        os.path.join(noct, "css", "tokens.json"),
    ))

    # favicon（部署树根目录，index.html 直接引用）
    jobs.append((
        os.path.join(ROOT, "assets", "favicon.svg"),
        os.path.join(deploy, "favicon.svg"),
    ))

    # 目录级同步
    # 注意：assets/svg 里的 favicon.svg 要落到部署树根，不是 nocturne/svg
    dirs = [
        (os.path.join(ROOT, "assets", "svg"),  os.path.join(noct, "svg")),
        (os.path.join(ROOT, "assets", "js"),    os.path.join(noct, "js")),
        (os.path.join(ROOT, "assets", "vendor"), os.path.join(noct, "vendor")),
        (os.path.join(ROOT, "docs"),            os.path.join(noct, "docs")),
        (os.path.join(ROOT, "tools"),           os.path.join(noct, "tools")),
    ]

    if check_only:
        missing = []
        for src, dst in jobs:
            if not os.path.exists(dst):
                missing.append(dst)
        for s, d in dirs:
            if not os.path.isdir(d):
                missing.append(d)
        if missing:
            print("✗ 部署树缺失：")
            for m in missing:
                print("   ", m)
            sys.exit(1)
        print("✓ 部署树结构完整")
        return

    for src, dst in jobs:
        if os.path.exists(src):
            copy_rewritten(src, dst)

    for s, d in dirs:
        if os.path.isdir(s):
            skip = ("favicon.svg",) if s.endswith(os.path.join("assets", "svg")) else ()
            sync_tree(s, d, skip=skip)

    print(f"✓ 已同步到 {deploy}")

    # ---- 校验：部署树内不得残留旧路径 ----
    bad = []
    for base, dirs, files in os.walk(deploy):
        dirs[:] = [x for x in dirs if x not in (".git", "node_modules")]
        for name in files:
            if not name.endswith((".html", ".css", ".js")):
                continue
            p = os.path.join(base, name)
            # 只查 NOCTURNE 自己的文件，不查 shanhe/ 旧站
            if os.sep + "shanhe" + os.sep in p:
                continue
            try:
                with open(p, "r", encoding="utf-8") as f:
                    txt = f.read()
            except Exception:
                continue
            for pat in ('"assets/svg/', "'assets/svg/",
                        '"assets/js/', "'assets/js/",
                        '"assets/vendor/', "'assets/vendor/",
                        '"tokens/tokens.css', "'tokens/tokens.css"):
                if pat in txt:
                    bad.append((os.path.relpath(p, deploy), pat))

    if bad:
        print("✗ 部署树残留未改写的旧路径：")
        for f, pat in bad:
            print(f"    {f}  ←  {pat}")
        sys.exit(1)

    print("✓ 路径校验通过（无残留旧引用）")

    # ---- 校验：ESM 模块语法 ----
    # 注意：`node --check foo.js` 按 CommonJS 解析，检不出 import/export 的 ESM 语法错。
    # 必须复制成 .mjs 再检查，否则这类错误会漏到运行时才炸。
    import shutil as _sh
    import subprocess as _sp
    node = _find_node()
    if node:
        syn_bad = []
        for base, dirs, files in os.walk(noct):
            dirs[:] = [x for x in dirs if x not in (".git", "node_modules", "vendor")]
            for name in files:
                if not name.endswith(".js"):
                    continue
                p = os.path.join(base, name)
                tmp = "/tmp/_esmcheck.mjs"
                _sh.copyfile(p, tmp)
                r = _sp.run([node, "--check", tmp], capture_output=True, text=True)
                if r.returncode != 0:
                    syn_bad.append((os.path.relpath(p, deploy), r.stderr.strip().splitlines()[-3:]))
        if syn_bad:
            print("✗ ESM 语法错误：")
            for f, msg in syn_bad:
                print(f"    {f}")
                for line in msg:
                    print(f"       {line}")
            sys.exit(1)
        print("✓ ESM 语法校验通过")
    else:
        print("! 未找到 node，跳过 ESM 语法校验")


def _find_node():
    """找一个可用的 node。"""
    cands = [
        "/Users/yb/.workbuddy/binaries/node/versions/22.22.2-6/bin/node",
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
    ]
    for c in cands:
        if os.path.exists(c):
            return c
    return _sp_which("node")


def _sp_which(name):
    import subprocess
    try:
        r = subprocess.run(["which", name], capture_output=True, text=True)
        return r.stdout.strip() or None
    except Exception:
        return None


if __name__ == "__main__":
    main()
