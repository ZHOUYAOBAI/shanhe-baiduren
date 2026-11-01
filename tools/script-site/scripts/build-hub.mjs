#!/usr/bin/env node
// build-hub.mjs — 扫描 projects/*/site_meta.json，自动生成门户「剧目陈列」网格
// 用法: node build-hub.mjs [--root .] [--projects projects] [--out index.html]
// 约定：存在 <root>/<slug>/index.html 的剧目视为「已发布」(可点击跳转)，否则为「计划中」。
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const get = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const root = path.resolve(get('--root', '.'));
const projectsDir = path.join(root, get('--projects', 'projects'));
const outFile = path.join(root, get('--out', 'index.html'));

const START = '<!-- WORKS:START -->';
const END = '<!-- WORKS:END -->';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 1. 收集所有剧目
const plays = [];
if (fs.existsSync(projectsDir)) {
  for (const slug of fs.readdirSync(projectsDir)) {
    const metaPath = path.join(projectsDir, slug, 'site_meta.json');
    if (!fs.existsSync(metaPath)) continue;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {
      console.warn('✗ 跳过无法解析的元数据: ' + metaPath);
      continue;
    }
    if (!meta.slug) meta.slug = slug;
    const built = fs.existsSync(path.join(root, meta.slug, 'index.html'));
    plays.push({ slug: meta.slug, meta, hub: meta.hub || {}, built });
  }
}

// 2. 排序：以 hub.order 为主（缺省 999 排末尾），同名按名称
plays.sort((a, b) => {
  const oa = typeof a.hub.order === 'number' ? a.hub.order : 999;
  const ob = typeof b.hub.order === 'number' ? b.hub.order : 999;
  if (oa !== ob) return oa - ob;
  return String(a.meta.name).localeCompare(String(b.meta.name), 'zh');
});

// 3. 渲染
function emblemHTML(p) {
  const e = p.hub.emblem;
  if (e) {
    if (typeof e === 'string' && e.endsWith('.svg')) {
      return `<div class="work-emblem"><img src="${esc(e)}" alt=""></div>`;
    }
    return `<div class="work-emblem"><span class="seal-glyph">${esc(e)}</span></div>`;
  }
  const ch = p.meta.seal || (p.meta.name || '·').toString()[0] || '·';
  return `<div class="work-emblem"><span class="seal-glyph">${esc(ch)}</span></div>`;
}

function cardHTML(p) {
  const m = p.meta;
  const name = esc(m.name || m.slug);
  const metaLine = esc(p.hub.meta || m.kicker || '');
  const desc = esc(p.hub.summary || m.description || m.theme || '');
  const inner =
    emblemHTML(p) +
    `\n        <h3>${name}</h3>` +
    `\n        <p class="work-meta">${metaLine}</p>` +
    `\n        <p class="work-desc">${desc}</p>`;
  if (p.built) {
    return `      <a class="work reveal" href="${esc(p.slug)}/" style="text-decoration:none">\n        ${inner}\n      </a>`;
  }
  return `      <article class="work reveal">\n        ${inner}\n      </article>`;
}

const grid = plays.map(cardHTML).join('\n');
const block = `      ${START}\n${grid}\n      ${END}`;

// 4. 注入 index.html
let html = fs.readFileSync(outFile, 'utf8');
if (!html.includes(START) || !html.includes(END)) {
  console.error('✗ 未在 index.html 的 .works-grid 内找到 ' + START + ' / ' + END + ' 标记');
  process.exit(1);
}
const re = new RegExp(START + '[\\s\\S]*?' + END);
html = html.replace(re, block);
fs.writeFileSync(outFile, html, 'utf8');

const published = plays.filter((p) => p.built).length;
console.log(`✓ 门户已更新：${plays.length} 部剧目（已发布 ${published} / 计划中 ${plays.length - published}）`);
