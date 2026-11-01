#!/usr/bin/env node
/* ============================================================
   剧本站 · 字体子集化
   ------------------------------------------------------------
   从 Google Fonts 取「只含本站实际用字」的 woff2 子集，落到
   <site>/assets/fonts/，并生成 assets/css/fonts.css。

   为什么不用系统宋体：Windows 的 SimSun、macOS 的 Songti SC、Linux 的
   Noto Serif SC 是三套字形，同一个剧目在三台机器上会长得不一样。
   自托管子集后，任何设备打开都是同一副字——这是「庄重」的地基。

   字体（均为 SIL OFL，可自托管、可商用）：
     brush  Ma Shan Zheng  毛笔楷书 → 剧名、幕名、章题
     xiao   ZCOOL XiaoWei  标题体   → 眉标、副题

   离线优先：命中 ~/.codex/skills/script-site/.cache/fonts/ 就不再联网。
   字体拿不到时静默跳过——站点照常构建，回退系统衬线，绝不因此失败。

   用法：
     node fetch-fonts.mjs --out <站点目录> --meta <site_meta.json>
                          [--struct <script_struct.json>] [--force]
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.resolve(HERE, '../.cache/fonts');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const FONT_SPECS = {
  brush: { family: 'Ma Shan Zheng', slug: 'brush', label: '毛笔楷书' },
  xiao: { family: 'ZCOOL XiaoWei', slug: 'xiao', label: '标题体' },
};

/* 站点 UI 里固定出现的中文（眉标、章题、按钮），一并纳入子集 */
const UI_CHARS = '主线歌单目录人物伏笔同曲戏核总纲幕场首曲目表动作前中后'
  + '序幕第一二三四五终幕尾声观众演职员编剧作曲出品开演阅读继续回到顶部'
  + '展开收起全部只看这一位台词登场演唱首多少余行展开全部下载打印复制链接'
  + '检索全剧字返回关闭上下选择跳转到第段落锚点幕启沉浸台本模式字号放大缩小'
  + '锁定解锁密码输入正确错误重试来源官方剧本站全文在线读';

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') o.out = argv[++i];
    else if (argv[i] === '--meta') o.meta = argv[++i];
    else if (argv[i] === '--struct') o.struct = argv[++i];
    else if (argv[i] === '--force') o.force = true;
  }
  return o;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* 取实际用字：全角标点、汉字、拉丁字母、数字 */
function collectChars(...parts) {
  const set = new Set();
  for (const s of parts) {
    for (const ch of String(s ?? '')) {
      const c = ch.codePointAt(0);
      if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') continue;
      if (c > 0x2e80 || (c >= 0x21 && c <= 0x7e)) set.add(ch);
    }
  }
  return [...set].sort().join('');
}

async function get(url, binary) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
}

/* 解析 Google Fonts 的 @font-face：取 src 与 unicode-range */
function parseFaces(css) {
  const faces = [];
  const re = /@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const body = m[1];
    const u = /src:\s*url\(([^)]+)\)/.exec(body);
    if (!u) continue;
    const ur = /unicode-range:\s*([^;]+);?/.exec(body);
    faces.push({ url: u[1].replace(/^['"]|['"]$/g, ''), range: ur ? ur[1].trim() : '' });
  }
  return faces;
}

/* 取某个字体的子集（带缓存）。返回 [{file, range}] */
async function fetchSubset(spec, text, force) {
  const key = crypto.createHash('sha1').update(spec.family + '|' + text).digest('hex').slice(0, 16);
  const dir = path.join(CACHE, key);
  const metaPath = path.join(dir, 'meta.json');

  if (!force && fs.existsSync(metaPath)) {
    const cached = readJson(metaPath);
    if (cached.files.every((f) => fs.existsSync(path.join(dir, f)))) {
      return { dir, files: cached.files, ranges: cached.ranges, cached: true };
    }
  }

  const cssUrl = 'https://fonts.googleapis.com/css2?family='
    + encodeURIComponent(spec.family).replace(/%20/g, '+')
    + '&text=' + encodeURIComponent(text) + '&display=swap';
  const css = await get(cssUrl, false);
  const faces = parseFaces(css);
  if (!faces.length) throw new Error('没有解析到 @font-face：' + spec.family);

  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  const ranges = [];
  for (let i = 0; i < faces.length; i++) {
    const name = `${spec.slug}-${i}.woff2`;
    const dest = path.join(dir, name);
    if (force || !fs.existsSync(dest)) {
      fs.writeFileSync(dest, await get(faces[i].url, true));
    }
    files.push(name);
    ranges.push(faces[i].range);
  }
  fs.writeFileSync(metaPath, JSON.stringify({ family: spec.family, files, ranges }, null, 2));
  return { dir, files, ranges, cached: false };
}

function fontsCss(entries) {
  const out = [
    '@charset "UTF-8";',
    '/* ============================================================',
    '   剧本站 · 自托管字体子集（构建时生成，勿手改）',
    '   字体均为 SIL Open Font License，可自托管可商用。',
    '   ============================================================ */',
    '',
  ];
  for (const e of entries) {
    out.push('/* ' + e.label + ' · ' + e.family + ' */');
    e.faces.forEach((f, i) => {
      out.push('@font-face {');
      out.push(`  font-family: "${e.family}";`);
      out.push('  font-style: normal;');
      out.push('  font-weight: 400;');
      out.push('  font-display: swap;');
      out.push(`  src: url("../fonts/${f.file}") format("woff2");`);
      if (f.range) out.push(`  unicode-range: ${f.range};`);
      out.push('}');
    });
    out.push('');
  }
  return out.join('\n');
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.out) {
    console.error('用法: node fetch-fonts.mjs --out <站点目录> --meta <site_meta.json> [--struct ...]');
    process.exit(1);
  }
  const out = path.resolve(opt.out);
  const meta = opt.meta ? readJson(opt.meta) : {};
  const struct = opt.struct && fs.existsSync(opt.struct) ? readJson(opt.struct) : {};

  const actTitles = (struct.acts || []).map((a) => a.title || '');
  const songNames = (struct.songs || []).map((s) => s.name || '');
  const castNames = (meta.cast || []).map((c) => c.name || '');
  const threadNames = (meta.threads || []).map((t) => t.name || '');
  const sectionTitles = Object.values(meta.sections || {})
    .map((s) => (s && s.title) || '');

  const displayBits = [
    meta.name, meta.title, meta.seal, meta.kicker, meta.theme, meta.span,
    meta.author, meta.music, meta.director, meta.description,
    ...actTitles, ...songNames, ...castNames, ...threadNames, ...sectionTitles,
  ];

  const brushText = collectChars(meta.name, meta.seal, meta.kicker, meta.theme,
    meta.span, meta.author, meta.music, ...actTitles);
  const xiaoText = collectChars(UI_CHARS, ...displayBits);

  const fontDir = path.join(out, 'assets', 'fonts');
  const cssDir = path.join(out, 'assets', 'css');
  fs.mkdirSync(fontDir, { recursive: true });
  fs.mkdirSync(cssDir, { recursive: true });

  const entries = [];
  for (const key of ['brush', 'xiao']) {
    const spec = FONT_SPECS[key];
    const text = key === 'brush' ? brushText : xiaoText;
    if (!text) continue;
    try {
      const sub = await fetchSubset(spec, text, opt.force);
      const faces = sub.files.map((file, i) => ({ file, range: sub.ranges[i] || '' }));
      for (const f of faces) fs.copyFileSync(path.join(sub.dir, f.file), path.join(fontDir, f.file));
      entries.push({ label: spec.label, family: spec.family, faces });
      const bytes = faces.reduce((n, f) => n + fs.statSync(path.join(fontDir, f.file)).size, 0);
      console.log('  · %s %s：%d 个子集，%d KB%s',
        key, spec.family, faces.length, Math.round(bytes / 1024),
        sub.cached ? '（缓存）' : '');
    } catch (err) {
      console.log('  ! %s 字体获取失败（%s）——回退系统衬线', key, err.message);
    }
  }

  fs.writeFileSync(path.join(cssDir, 'fonts.css'), fontsCss(entries), 'utf8');
  if (!entries.length) {
    console.log('  · 未取到任何字体，站点使用系统衬线（不影响构建）');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('  ! 字体子集化异常：' + e.message); process.exit(0); });
}
