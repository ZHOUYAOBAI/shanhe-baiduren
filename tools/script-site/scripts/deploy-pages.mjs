#!/usr/bin/env node
/* ============================================================
   剧本站 · GitHub Pages 部署
   ------------------------------------------------------------
   站点是纯静态产物，无构建步骤 —— 本脚本只做提交与推送。

   两种情形：
     · 新仓库    → gh repo create，站点在仓库根 → https://<user>.github.io/<repo>/
     · 已有仓库  → 克隆后把站点放进子目录 → https://<user>.github.io/<repo>/<subdir>/

   用法：
     node deploy-pages.mjs <站点目录> --repo owner/name [--subdir shanhe]
                           [--message "..."] [--no-pages] [--dry-run]
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';

const sh = (cmd, args, opts = {}) => {
  if (opts.capture) {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
  return execFileSync(cmd, args, { stdio: 'inherit' });
};

function parseArgs(argv) {
  const o = { pages: true };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') o.repo = argv[++i];
    else if (a === '--subdir') o.subdir = argv[++i];
    else if (a === '--message') o.message = argv[++i];
    else if (a === '--visibility') o.visibility = argv[++i];
    else if (a === '--no-pages') o.pages = false;
    else if (a === '--dry-run') o.dryRun = true;
    else pos.push(a);
  }
  o.site = path.resolve(pos[0] || '.');
  return o;
}

function have(cmd) {
  try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function ghAuthOk() {
  try { sh('gh', ['auth', 'status'], { capture: true }); return true; }
  catch { return false; }
}

function copyDir(src, dst, skip = []) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  const opt = parseArgs(process.argv.slice(2));

  if (!opt.repo || !/^[\w.-]+\/[\w.-]+$/.test(opt.repo)) {
    console.error('✗ 需要 --repo owner/name');
    process.exit(1);
  }
  if (!fs.existsSync(opt.site)) { console.error('✗ 站点目录不存在：' + opt.site); process.exit(1); }
  if (!have('git')) { console.error('✗ 需要 git'); process.exit(1); }
  if (!have('gh')) { console.error('✗ 需要 GitHub CLI：brew install gh'); process.exit(1); }
  if (!ghAuthOk()) {
    console.error('✗ gh 未登录。先运行： gh auth login');
    console.error('  （或设置环境变量 GH_TOKEN / GITHUB_TOKEN 后重试）');
    process.exit(1);
  }

  const subdir = opt.subdir ? opt.subdir.replace(/^\/+|\/+$/g, '') : '';
  const remoteUrl = `https://github.com/${opt.repo}.git`;

  /* ── 准备工作区 ── */
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'script-site-deploy-'));
  const repoDir = path.join(work, 'repo');
  console.log('① 准备部署工作区…');

  let repoExists = true;
  try {
    sh('gh', ['repo', 'view', opt.repo, '--json', 'name'], { capture: true });
  } catch {
    repoExists = false;
  }

  if (repoExists) {
    sh('git', ['clone', '--depth', '1', remoteUrl, repoDir]);
    sh('git', ['-C', repoDir, 'fetch', '--depth', '1', 'origin'], { capture: true });
  } else {
    fs.mkdirSync(repoDir, { recursive: true });
    sh('git', ['-C', repoDir, 'init', '-b', 'main']);
    console.log('   新仓库 ' + opt.repo);
  }

  /* ── 复制站点 ── */
  const dest = subdir ? path.join(repoDir, subdir) : repoDir;
  console.log(`② 复制站点 → ${subdir ? '子目录 ' + subdir : '仓库根'}`);
  fs.mkdirSync(dest, { recursive: true });
  copyDir(opt.site, dest, ['working', '.git', 'node_modules', '.DS_Store']);
  /* 内部工具链与中间产物不发布 */
  for (const junk of ['working', 'node_modules', '.DS_Store']) {
    fs.rmSync(path.join(dest, junk), { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(dest, '.nojekyll'), '');

  if (opt.dryRun) {
    console.log('   （--dry-run：到此为止，未提交）');
    console.log('   工作区：' + repoDir);
    return;
  }

  /* ── 提交推送 ── */
  console.log('③ 提交并推送…');
  sh('git', ['-C', repoDir, 'add', '-A']);
  const msg = opt.message || `update: ${new Date().toLocaleString('zh-CN')}`;
  try {
    sh('git', ['-C', repoDir, 'commit', '-m', msg], { capture: true });
  } catch (e) {
    console.log('   （无变更可提交，跳过 commit）');
  }
  if (!repoExists) {
    sh('gh', ['repo', 'create', opt.repo, '--public',
      '--source', repoDir, '--remote', 'origin', '--push']);
  } else {
    sh('git', ['-C', repoDir, 'remote', 'set-url', 'origin', remoteUrl]);
    sh('git', ['-C', repoDir, 'push', 'origin', 'HEAD:main']);
  }

  /* ── 开启 Pages ── */
  if (opt.pages) {
    console.log('④ 开启 GitHub Pages…');
    const apiPath = `repos/${opt.repo}/pages`;
    const srcPath = subdir ? `/${subdir}` : '/';
    try {
      sh('gh', ['api', '-X', 'POST', apiPath,
        '-f', 'source[branch]=main', '-f', `source[path]=${srcPath}`], { capture: true });
      console.log('   ✓ Pages 已配置：branch=main, path=' + srcPath);
    } catch (e) {
      const msgOut = (e.stderr || '').toString();
      if (/already exists/i.test(msgOut)) {
        console.log('   · Pages 已存在，尝试更新配置…');
        try {
          sh('gh', ['api', '-X', 'PUT', apiPath,
            '-f', 'source[branch]=main', '-f', `source[path]=${srcPath}`], { capture: true });
          console.log('   ✓ Pages 配置已更新');
        } catch (e2) {
          console.log('   ! Pages 更新失败，请手动在仓库 Settings → Pages 里设置');
          console.log('     ' + (e2.stderr || e2.message).toString().split('\n')[0]);
        }
      } else {
        console.log('   ! Pages 配置失败，请手动在仓库 Settings → Pages 里设置');
        console.log('     ' + msgOut.split('\n').slice(0, 2).join('\n'));
      }
    }
  }

  const owner = opt.repo.split('/')[0];
  const base = `https://${owner}.github.io/${opt.repo.split('/')[1]}`;
  const url = subdir ? `${base}/${subdir}/` : `${base}/`;
  console.log('\n✓ 部署完成');
  console.log('  %s', url);
  console.log('  GitHub Pages 约 1–2 分钟生效；若 404，先确认仓库 Settings → Pages 的 Source 已设为');
  console.log('  Deploy from a branch → main / %s', subdir ? subdir : '/');
  fs.rmSync(work, { recursive: true, force: true });
}

main();
