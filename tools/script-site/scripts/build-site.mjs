#!/usr/bin/env node
/* ============================================================
   剧本站 · 一键构建
   ------------------------------------------------------------
   流程（分层，勿合并）：
     剧本.docx / .md / .txt
       → parse-script.mjs   解析层 → script_struct.json
       → build-data.mjs     映射层 + 加密层 → assets/js/data.js
       → 模板注入           → index.html / palette.css / favicon
       → audit.mjs          校验：剧本每一段文字都在站点上

   用法：
     node build-site.mjs --script <剧本> --meta <site_meta.json> --out <站点目录>
                         [--no-encrypt] [--skip-audit]
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(HERE, '../assets/template');

const DEFAULT_PALETTE = {
  bg: '#EFE5D8', bg2: '#FBF6EE', bg3: '#E2D3C2',
  paper: '#241811', paper2: '#574235', paper3: '#755E4E',
  accent: '#B22D1D', accent2: '#806010', accent3: '#33486B',
  accentDeep: '#8A1E13',
};

const copyDir = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function parseArgs(argv) {
  const o = { encrypt: true, audit: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--script') o.script = argv[++i];
    else if (a === '--meta') o.meta = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--no-encrypt') o.encrypt = false;
    else if (a === '--skip-audit') o.audit = false;
  }
  return o;
}

function hexRgb(hex) {
  const h = String(hex || '').trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relLum(hex) {
  const c = hexRgb(hex);
  if (!c) return 0;
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrast(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function mixHex(a, b, t) {
  const x = hexRgb(a), y = hexRgb(b);
  if (!x || !y) return a;
  const m = (p, q) => Math.round(p + (q - p) * t).toString(16).padStart(2, '0');
  return '#' + m(x.r, y.r) + m(x.g, y.g) + m(x.b, y.b);
}

function rgbaOf(hex, a) {
  const c = hexRgb(hex);
  if (!c) return `rgba(0,0,0,${a})`;
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

/* ══ 对比度下限契约 ══════════════════════════════════════
   设计系统承诺的每一组「前景 / 背景」都必须 ≥ 4.5:1（WCAG AA）。
   构建时逐项验算 —— 不合格的自动压深/提亮到合格为止，并打印实测比值。
   背景里有两组是 CSS 里 color-mix 出来的，验算必须按混色后的实际值算，
   否则表头那一层会漏检（暗金配表头底色比配 bg 更低）。

   背景未达标不算 bug —— 但正文和表头这些 12–13px 的小字必须够，
   这才是「不庄重」的真正来源。                                    */
const CONTRAST_MIN = 4.5;

const inkFor = (theme) => (theme === 'light' ? '#241D14' : '#F4EDDF');

/* 把前景朝目标色推，直到对 bg 的比值达标；取「改动最小」的那一路。 */
function pushToContrast(fg, bg, min, theme) {
  if (contrast(fg, bg) >= min) return fg;
  const targets = theme === 'light' ? [inkFor(theme), '#000000'] : [inkFor(theme), '#FFFFFF'];
  let best = null;
  for (const target of targets) {
    let lo = 0, hi = 1, cand = null;
    for (let i = 0; i < 20; i++) {
      const t = (lo + hi) / 2;
      const c = mixHex(fg, target, t);
      if (contrast(c, bg) >= min) { cand = c; hi = t; } else { lo = t; }
    }
    if (cand && (!best || contrast(cand, bg) < contrast(best, bg))) best = cand;
  }
  return best || fg;
}

/* 把前景往「远离 other」的方向推 —— 与 pushToContrast 相反。
   用途：accent 是中间调时，奶油白和墨黑都配不上它，
   只能把 accent 往一头推，让 on-accent 有得挑。 */
function pushAwayFrom(fg, other, min) {
  const targets = relLum(other) > 0.2
    ? ['#000000', '#241D14']   /* other 亮 → 把 fg 压暗 */
    : ['#FFFFFF', '#F4EDDF'];  /* other 暗 → 把 fg 提亮 */
  let best = null;
  for (const target of targets) {
    let lo = 0, hi = 1, cand = null;
    for (let i = 0; i < 20; i++) {
      const t = (lo + hi) / 2;
      const c = mixHex(fg, target, t);
      if (contrast(c, other) >= min) { cand = c; hi = t; } else { lo = t; }
    }
    if (cand && (!best || contrast(cand, other) < contrast(best, other))) best = cand;
  }
  return best;
}

/* 反白色：两种候选里挑对比度高的那个 */
function pickOnAccent(accent) {
  const cands = ['#241C14', '#FFF6EA'];
  let best = cands[0], bestC = contrast(cands[0], accent);
  for (const c of cands.slice(1)) {
    const v = contrast(c, accent);
    if (v > bestC) { best = c; bestC = v; }
  }
  return best;
}

/* 设计系统承诺的（前景, 背景）对照表 */
function contrastContract(p) {
  const theadBg = mixHex(p.bg3, p.bg2, 0.52);   /* 曲目表表头底 */
  const frontThBg = mixHex(p.bg3, p.bg2, 0.84); /* 总纲表表头底 */
  return [
    ['正文', 'paper', p.paper, p.bg],
    ['次级文字', 'paper-2', p.paper2, p.bg],
    ['弱化文字', 'paper-3', p.paper3, p.bg],
    ['强调红', 'accent', p.accent, p.bg],
    ['暗金', 'accent-2', p.accent2, p.bg],
    ['靛青', 'accent-3', p.accent3, p.bg],
    ['深朱砂', 'accent-deep', p.accentDeep, p.bg],
    ['反白按钮', 'on-accent', pickOnAccent(p.accent), p.accent],
    ['深朱砂反白', 'on-accent', pickOnAccent(p.accentDeep), p.accentDeep],
  ];
}

function normalizePalette(pal) {
  const p = Object.assign({}, pal);
  const theme = relLum(p.bg) > 0.35 ? 'light' : 'dark';
  const fixed = [];

  /* 正文墨色三级是一套：paper 不合格就整套按比例推深 */
  if (contrast(p.bg, p.paper) < CONTRAST_MIN) {
    const ink = inkFor(theme);
    p.paper = mixHex(p.bg, ink, 0.93);
    p.paper2 = mixHex(p.bg, ink, 0.72);
    p.paper3 = mixHex(p.bg, ink, 0.55);
    fixed.push('paper 三级');
  }

  /* 迭代校正：一条约束的修正可能踩到另一条（深色主题尤其明显 ——
     accent 要变亮才过得了表头底，变亮后 on-accent 就得从奶油换成墨）。
     所以循环几轮，每轮修一条，修完再看还剩哪条不合格。 */
  const theadBg = mixHex(p.bg3, p.bg2, 0.52);   /* 曲目表表头底 */
  const frontThBg = mixHex(p.bg3, p.bg2, 0.84); /* 总纲表表头底 */

  for (let pass = 0; pass < 5; pass++) {
    let changed = false;

    if (contrast(p.bg, p.paper2) < CONTRAST_MIN) {
      p.paper2 = pushToContrast(p.paper2, p.bg, CONTRAST_MIN, theme);
      fixed.push('paper-2'); changed = true;
    }
    /* paper-3 是最浅的一级，最容易压线 */
    if (contrast(p.bg, p.paper3) < CONTRAST_MIN) {
      p.paper3 = pushToContrast(p.paper3, p.bg, CONTRAST_MIN, theme);
      fixed.push('paper-3'); changed = true;
    }
    if (contrast(p.bg, p.accent2) < CONTRAST_MIN) {
      p.accent2 = pushToContrast(p.accent2, p.bg, CONTRAST_MIN, theme);
      fixed.push('accent-2'); changed = true;
    }
    /* 暗金用在曲目表表头（13px）上，底色比 bg 更浅，要单独验 */
    if (contrast(theadBg, p.accent2) < CONTRAST_MIN) {
      p.accent2 = pushToContrast(p.accent2, theadBg, CONTRAST_MIN, theme);
      fixed.push('accent-2（表头底）'); changed = true;
    }
    if (contrast(p.bg, p.accent3) < CONTRAST_MIN) {
      p.accent3 = pushToContrast(p.accent3, p.bg, CONTRAST_MIN, theme);
      fixed.push('accent-3'); changed = true;
    }
    /* 深朱砂是大面积实底（幕次轨 / 表头 / 界栏），
       本身必须压得住底色，同时还要能反白。 */
    if (contrast(p.bg, p.accentDeep) < CONTRAST_MIN) {
      p.accentDeep = pushToContrast(p.accentDeep, p.bg, CONTRAST_MIN, theme);
      fixed.push('accent-deep'); changed = true;
    }
    {
      const oaD = pickOnAccent(p.accentDeep);
      if (contrast(oaD, p.accentDeep) < CONTRAST_MIN) {
        const cand = pushAwayFrom(p.accentDeep, oaD, CONTRAST_MIN);
        if (cand && contrast(cand, p.bg) >= CONTRAST_MIN
          && contrast(cand, oaD) >= CONTRAST_MIN) {
          p.accentDeep = cand;
          fixed.push('accent-deep（反白）');
          changed = true;
        }
      }
    }
    if (contrast(p.bg, p.accent) < CONTRAST_MIN) {
      p.accent = pushToContrast(p.accent, p.bg, CONTRAST_MIN, theme);
      fixed.push('accent'); changed = true;
    }
    /* accent 还要过总纲表头底（比 bg 更浅的一档） */
    if (contrast(frontThBg, p.accent) < CONTRAST_MIN) {
      p.accent = pushToContrast(p.accent, frontThBg, CONTRAST_MIN, theme);
      fixed.push('accent（总纲表头底）'); changed = true;
    }
    /* 反白：accent 变亮后会自动从奶油切到墨；
       两个候选都不够格时，把 accent 往 on-accent 的反方向推，
       但推完必须仍满足前几条，否则宁可留着不合格也不把别处弄坏。 */
    const oa = pickOnAccent(p.accent);
    if (contrast(oa, p.accent) < CONTRAST_MIN) {
      const cand = pushAwayFrom(p.accent, oa, CONTRAST_MIN);
      if (cand && contrast(cand, p.bg) >= CONTRAST_MIN
        && contrast(cand, frontThBg) >= CONTRAST_MIN
        && contrast(cand, oa) >= CONTRAST_MIN) {
        p.accent = cand;
        fixed.push('accent（反白）');
        changed = true;
      }
    }

    if (!changed) break;
  }

  return { palette: p, theme, fixed: [...new Set(fixed)] };
}

function paletteCss(p, theme) {
  const raw = [
    ['--bg', p.bg], ['--bg-2', p.bg2], ['--bg-3', p.bg3],
    ['--paper', p.paper], ['--paper-2', p.paper2], ['--paper-3', p.paper3],
    ['--accent', p.accent], ['--accent-2', p.accent2], ['--accent-3', p.accent3],
    ['--accent-deep', p.accentDeep],
  ];
  const onAccent = pickOnAccent(p.accent);
  /* 深朱砂底的反白单独算 —— 中间调的 accent 反白未必在深底上也够 */
  const onAccentDeep = pickOnAccent(p.accentDeep);
  const deepInk = mixHex(p.bg, '#000000', 0.55);

  /* 语义面一律取纸色（bg2）而不是纯白 —— 纯白卡片压在旧宣纸上
     会像贴上去的塑料片，取纸色才像同一摞纸里的一张。 */
  const light = [
    `--surface-top:      ${rgbaOf(p.bg2, .82)}`,
    `--surface-top-soft: ${rgbaOf(p.bg2, .40)}`,
    `--surface-rail:     ${rgbaOf(p.bg2, .46)}`,
    `--surface-modal:    ${rgbaOf(p.bg2, .92)}`,
    `--surface-band:     ${rgbaOf(p.bg2, .52)}`,
    `--surface-card:     ${rgbaOf(p.bg2, .70)}`,
    `--surface-card-hover: ${rgbaOf(p.bg2, .96)}`,
    `--surface-chip:     ${rgbaOf(p.paper, .06)}`,
    `--surface-chip-hover: ${rgbaOf(p.paper, .04)}`,
    '--surface-sheen:    rgba(255, 255, 255, .92)',
    `--vignette-1:       ${rgbaOf(p.paper, .10)}`,
    `--vignette-2:       ${rgbaOf(p.paper, .08)}`,
    '--title-shadow:     0 4px 30px rgba(255, 255, 255, .85)',
    '--grain-blend:      multiply',
    '--grain-opacity:    .05',
    `--shadow:           0 18px 48px -24px ${rgbaOf(p.paper, .30)}`,
  ];
  const dark = [
    `--surface-top:      ${rgbaOf(deepInk, .90)}`,
    `--surface-top-soft: ${rgbaOf(deepInk, .52)}`,
    `--surface-rail:     ${rgbaOf(deepInk, .55)}`,
    '--surface-modal:    rgba(6, 5, 4, .86)',
    '--surface-band:     rgba(0, 0, 0, .22)',
    '--surface-card:     rgba(255, 255, 255, .02)',
    '--surface-card-hover: rgba(255, 255, 255, .05)',
    '--surface-chip:     rgba(255, 255, 255, .06)',
    '--surface-chip-hover: rgba(255, 255, 255, .04)',
    '--surface-sheen:    rgba(255, 255, 255, .14)',
    '--vignette-1:       rgba(0, 0, 0, .50)',
    '--vignette-2:       rgba(0, 0, 0, .42)',
    '--title-shadow:     0 4px 40px rgba(0, 0, 0, .60)',
    '--grain-blend:      overlay',
    '--grain-opacity:    .05',
    '--shadow:           0 18px 48px -20px rgba(0, 0, 0, .85)',
  ];

  const lines = [
    '/* site palette (written by build from site_meta.palette) */',
    `/* theme: ${theme} */`,
    ':root {',
    ...raw.map(([k, v]) => `  ${k}: ${v};`),
    `  --on-accent: ${onAccent};`,
    `  --on-accent-deep: ${onAccentDeep};`,
    `  --line:      ${rgbaOf(p.paper, .13)};`,
    `  --line-2:    ${rgbaOf(p.paper, .26)};`,
    ...light.map((d) => `  ${d};`),
    '}',
    '',
    '[data-theme="dark"] {',
    ...dark.map((d) => `  ${d};`),
    '}',
    '',
  ];
  return lines.join('\n');
}

function faviconSvg(accent, seal, bg, ink) {
  const ch = (seal || '').trim().charAt(0) || '';
  const label = ch
    ? `<text x="16" y="22" font-size="15" text-anchor="middle" fill="${ink}" font-family="serif">${ch}</text>`
    : `<circle cx="16" cy="16" r="7" fill="none" stroke="${accent}" stroke-width="2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="4" fill="${bg}"/>
  ${label}
</svg>
`;
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.script || !opt.meta || !opt.out) {
    console.error('用法: node build-site.mjs --script <剧本> --meta <site_meta.json> --out <站点目录> [--no-encrypt]');
    process.exit(1);
  }
  const out = path.resolve(opt.out);
  const meta = readJson(opt.meta);

  console.log('① 解析剧本 → script_struct.json');
  const structPath = path.join(out, 'working', 'script_struct.json');
  fs.mkdirSync(path.dirname(structPath), { recursive: true });
  execFileSync(process.execPath, [
    path.join(HERE, 'parse-script.mjs'), opt.script, structPath,
    ...(meta.speakers && meta.speakers.length
      ? ['--speakers', meta.speakers.join(',')] : []),
    ...(meta.actHeadings && meta.actHeadings.length
      ? ['--act-headings', meta.actHeadings.join(',')] : []),
  ], { stdio: 'inherit' });

  console.log('② 映射数据 → data.js');
  const dataPath = path.join(out, 'assets', 'js', 'data.js');
  execFileSync(process.execPath, [
    path.join(HERE, 'build-data.mjs'), structPath, opt.meta, dataPath,
    ...(opt.encrypt ? [] : ['--no-encrypt']),
  ], { stdio: 'inherit', env: process.env });

  console.log('③ 注入模板');
  copyDir(TEMPLATE, out);
  const { palette: pal, theme, fixed } = normalizePalette(
    Object.assign({}, DEFAULT_PALETTE, meta.palette || {}));
  if (fixed.length) {
    console.log('  · 对比度不足，已自动校正：' + fixed.join(' / '));
  }
  console.log('  · 对比度实测（WCAG AA 下限 4.5）');
  for (const [label, name, fg, bg] of contrastContract(pal)) {
    const v = contrast(fg, bg);
    console.log('      ' + (v >= CONTRAST_MIN ? '✓' : '✗') + ' '
      + name.padEnd(11) + label.padEnd(12) + v.toFixed(2)
      + (v >= CONTRAST_MIN ? '' : '   ← 不合格'));
  }
  fs.writeFileSync(path.join(out, 'assets', 'css', 'palette.css'), paletteCss(pal, theme), 'utf8');
  fs.writeFileSync(path.join(out, 'favicon.svg'),
    faviconSvg(pal.accent, meta.seal || meta.name, pal.bg, pal.paper), 'utf8');

  /* 字体子集：只取本站实际用字，自托管到 assets/fonts/（离线可用、跨机一致） */
  console.log('③b 字体子集化 → fonts.css');
  try {
    execFileSync(process.execPath, [
      path.join(HERE, 'fetch-fonts.mjs'), '--out', out,
      '--meta', opt.meta, '--struct', structPath,
    ], { stdio: 'inherit' });
  } catch (e) {
    console.log('  ! 字体子集化失败，站点回退系统衬线（不影响构建）');
  }

  /* 资源指纹：给 css/js 加 ?v= 指纹，部署新版本后浏览器不会拿旧缓存 */
  const ver = (() => {
    const h = crypto.createHash('sha1');
    for (const rel of ['assets/css/main.css', 'assets/css/tokens.css', 'assets/css/fonts.css',
      'assets/js/main.js', 'assets/js/scene.js', 'assets/js/crypto.js']) {
      const p = path.join(out, rel);
      if (fs.existsSync(p)) h.update(fs.readFileSync(p));
    }
    return h.digest('hex').slice(0, 8);
  })();
  console.log('  - 资源指纹 %s', ver);

  /* ES module 的依赖也要带指纹，否则改 scene.js 浏览器仍拿旧的 */
  const mainJsPath = path.join(out, 'assets', 'js', 'main.js');
  if (fs.existsSync(mainJsPath)) {
    const src = fs.readFileSync(mainJsPath, 'utf8')
      .replace(/(from\s+['\"]\.\/[a-z-]+\.js)(['\"])/g, (m, a, b) => a + '?v=' + ver + b);
    fs.writeFileSync(mainJsPath, src, 'utf8');
  }
  console.log('  - theme: %s   bg: %s', theme, pal.bg);

  const desc = meta.description
    || [meta.kicker, meta.theme].filter(Boolean).join('。')
    || meta.name || '';
  const indexPath = path.join(out, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html
    .replace(/\{\{V\}\}/g, ver)
    .replace(/\{\{TITLE\}\}/g, escapeHtml(meta.title || meta.name || '剧本站'))
    .replace(/\{\{DESCRIPTION\}\}/g, escapeHtml(desc))
    .replace(/\{\{THEME_COLOR\}\}/g, pal.bg)
    .replace(/\{\{SITE_NAME\}\}/g, escapeHtml(meta.name || '剧'))
    .replace(/\{\{SEAL\}\}/g, escapeHtml(meta.seal || (meta.name || '').charAt(0) || '·'))
    .replace(/\{\{THEME\}\}/g, theme)
    .replace(/\{\{MOTIF\}\}/g, escapeHtml(meta.motif || 'lantern'));
  fs.writeFileSync(indexPath, html, 'utf8');

  /* 404 同步标题 */
  const nf = path.join(out, '404.html');
  if (fs.existsSync(nf)) {
    fs.writeFileSync(nf, fs.readFileSync(nf, 'utf8')
      .replace(/页面未找到/g, escapeHtml((meta.name || '剧') + ' · 页面未找到')), 'utf8');
  }

  /* 音频 */
  const audioDir = path.join(out, 'assets', 'audio');
  if (Array.isArray(meta.audio) && meta.audio.length) {
    fs.mkdirSync(audioDir, { recursive: true });
    let copied = 0, missing = 0;
    for (const a of meta.audio) {
      const src = path.resolve(a.file || a.src || '');
      if (!fs.existsSync(src)) { console.log('  ! 缺音频：' + src); missing++; continue; }
      fs.copyFileSync(src, path.join(audioDir, path.basename(src)));
      copied++;
    }
    console.log(`  · 音频 ${copied} 个${missing ? `（缺 ${missing}）` : ''}`);
  }

  /* 站点 README */
  fs.writeFileSync(path.join(out, 'README.md'), siteReadme(meta), 'utf8');

  console.log('④ 校验');
  if (opt.audit) {
    execFileSync(process.execPath, [
      path.join(HERE, 'audit.mjs'), opt.script, dataPath,
    ], { stdio: 'inherit', env: process.env });
  } else {
    console.log('  (跳过)');
  }

  const struct = readJson(structPath);
  console.log('\n✓ 构建完成 → %s', out);
  console.log('  幕 %d ／ 曲 %d ／ 人物 %d ／ 伏笔 %d',
    struct.acts.length, struct.songs.length,
    (meta.cast || []).length || (struct.char_table.length - 1 > 0 ? struct.char_table.length - 1 : 0),
    (meta.threads || []).length);
  console.log('  本地预览： node %s %s', path.join(HERE, 'serve.mjs'), out);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function siteReadme(meta) {
  // 固定写安装位置，不要用 path.relative(process.cwd(), …)：
  // 那会让不同机器 / 不同 cwd 构建出不同的 README，造成假 diff。
  const SERVE_HINT = '~/.codex/skills/script-site/scripts/serve.mjs';
  const lines = [
    `# ${meta.title || meta.name || '剧本站'}`,
    '',
    meta.description || '',
    '',
    '## 本地预览',
    '',
    '```bash',
    `python3 -m http.server 8000   # 或：node ${SERVE_HINT}`,
    '```',
    '',
    '打开 http://localhost:8000 。',
    '',
    '## 目录',
    '',
    '```',
    'index.html            入口',
    '404.html              Pages 404 页',
    'favicon.svg           站点图标',
    'assets/css/tokens.css 设计令牌（尺度与排版）',
    'assets/css/palette.css 配色（构建时写入）',
    'assets/css/main.css   视觉系统',
    'assets/js/data.js     公开层数据 + 受限层密文',
    'assets/js/main.js     渲染与交互',
    'assets/js/scene.js    程序化背景场景',
    'assets/js/crypto.js   解密模块',
    'working/              解析产物（不进公网仓库）',
    '```',
    '',
    '## 重新构建',
    '',
    '```bash',
    'READ_PASS=\'你的密码\' node scripts/build-site.mjs \\',
    '  --script <剧本> --meta site_meta.json --out .',
    '```',
    '',
  ];
  if (meta.note) lines.push('## 声明', '', meta.note, '');
  return lines.join('\n');
}

main();
