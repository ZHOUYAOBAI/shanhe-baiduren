#!/usr/bin/env node
/* ============================================================
   剧本站 · 同步校验
   ------------------------------------------------------------
   核对剧本源文件的每一个非空段落，是否都出现在生成的数据里（公开层 + 受限层）。

   判定方式：段落文字与数据里的文字都「归一化」（去空白、去最外层【】（））后比对。

   用法：
     node audit.mjs <剧本.docx|md|txt> <data.js>
   密码受限层需要 READ_PASS 才能校验；未设置时只校验公开层并给出提示。
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readDocx } from './lib/docx.mjs';
import { APPENDIX_HEADING_RE, splitTableRow, isSeparatorRow } from './lib/common.mjs';

function norm(s) {
  let v = String(s ?? '').trim();
  v = v.replace(/^【([\s\S]*)】$/, '$1');
  v = v.replace(/^（([\s\S]*)）$/, '$1');
  v = v.replace(/\s+/g, '');
  return v;
}

/* 站点真正上站的表格（曲目表 / 人物表）表头。
   其余表格是创作手记（总纲、幕表、Cue 表、修订记录……），不上站，也不参与核对。 */
function renderedTableHeaders(pub) {
  const hs = [];
  for (const t of [pub.songTable, pub.charTable]) {
    if (Array.isArray(t) && t.length && Array.isArray(t[0])) hs.push(t[0].map((c) => String(c).trim()).join('|'));
  }
  return hs;
}

async function sourceParagraphs(file, actTitles = [], tableHeaders = [], stat = { skippedTables: 0 }) {
  const ext = path.extname(file).toLowerCase();
  const out = [];
  const isRendered = (head) => {
    const key = (head || []).map((c) => String(c).trim()).join('|');
    return tableHeaders.includes(key);
  };
  if (ext === '.docx') {
    const { blocks } = await readDocx(file);
    for (const b of blocks) {
      if (b.kind === 'p') {
        if (b.text.trim()) out.push(b.text.trim());
      } else if (b.kind === 't') {
        if (!isRendered(b.rows && b.rows[0])) { stat.skippedTables++; continue; }
        for (const row of b.rows || []) {
          for (const cell of row) if (String(cell).trim()) out.push(String(cell).trim());
        }
      }
    }
    return out;
  }
  const text = fs.readFileSync(file, 'utf8');
  const isMd = ext === '.md' || ext === '.markdown';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\|/.test(line)) {
      /* 表格行：逐格核对，跳过分隔行（.txt 里的 Markdown 表格同样适用） */
      const cells = splitTableRow(line);
      if (isSeparatorRow(cells)) continue;
      if (!isRendered(cells)) { stat.skippedTables++; continue; }
      for (const c of cells) if (c) out.push(c);
      continue;
    }
    /* 附录标题是结构标签，不要求上站（与解析层判断一致） */
    if (APPENDIX_HEADING_RE.test(line)) continue;
    if (isMd) {
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) {
        const title = h[1].trim();
        /* 二级标题若不是幕名（而是「曲目表」「人物表」这类附录），属结构标签，不要求上站 */
        if (/^#{1,2}\s/.test(line) && !actTitles.includes(title)) continue;
        out.push(title);
        continue;
      }
      const li = /^[-*+]\s+(.*)$/.exec(line);
      if (li) { out.push(li[1].trim()); continue; }
    }
    out.push(line);
  }
  return out;
}

function parseDataJs(file) {
  const js = fs.readFileSync(file, 'utf8');
  const pubM = /window\.SCRIPT\s*=\s*([\s\S]*?);\s*(?:\n|window\.SCRIPT_SECRET)/.exec(js);
  const secM = /window\.SCRIPT_SECRET\s*=\s*(\{[\s\S]*?\});?\s*$/.exec(js.trim());
  if (!pubM) throw new Error('data.js 解析失败：找不到 window.SCRIPT');
  return {
    pub: JSON.parse(pubM[1]),
    enc: secM ? JSON.parse(secM[1]) : null,
  };
}

function decryptSecret(enc, password) {
  const salt = Buffer.from(enc.salt, 'base64');
  const key = crypto.pbkdf2Sync(password, salt, enc.iterations || 150000, 32, 'sha256');
  const raw = Buffer.from(enc.cipher, 'base64');
  const ct = raw.subarray(0, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
}

function collectPublic(pub) {
  const pieces = [];
  const push = (v) => { if (v != null) pieces.push(String(v)); };
  const cover = pub.cover || {};
  for (const k of ['title', 'name', 'kicker', 'seal', 'theme', 'span', 'author', 'music', 'director', 'note', 'footerTitle']) {
    push(cover[k]);
  }
  (cover.mainline || []).forEach(push);
  for (const s of pub.songs || []) {
    push(s.name); push(s.performer); push(s.label);
    /* 公开模式（不加密）时，歌词直接内联在 songs[].items */
    for (const it of s.items || []) {
      if (it.k === 'head') push(it.v);
      else if (it.k === 'ly') {
        push(it.speaker); push(it.text); push(it.cue);
        if (it.speaker && it.text) push(it.speaker + '：' + it.text);
        if (it.speaker && it.cue && it.text) push(it.speaker + '：' + it.cue + it.text);
      } else if (it.k === 'sec' || it.k === 'pt' || it.k === 'cue') push(it.v);
    }
  }
  for (const a of pub.acts || []) {
    push(a.title);
    const m = a.meta || {};
    push(m.time); push(m.place); push(m.cast);
    (m.mood || []).forEach(push);
    /* 按剧本里的原样（含【时间】等标签）还原，便于逐行比对 */
    if (m.time) push('【时间】' + m.time);
    if (m.place) push('【地点】' + m.place);
    if (m.cast) push('【出场人物】' + m.cast);
    if ((m.mood || []).length) push('【舞台氛围】');
    for (const b of a.blocks || []) {
      if (b.k === 'scene') {
        push(b.v);
        if (b.meta) { push(b.meta.time); push(b.meta.place); }
      }
      else if (b.k === 'song') { push(b.v.name); push(b.v.performer); push(b.v.label); }
      else if (b.k === 'dlg') {
        push(b.v.who); push(b.v.text); push(b.v.cue);
        /* 还原成剧本里的原行形态，便于逐行比对 */
        if (b.v.who && b.v.text) push(b.v.who + '：' + b.v.text);
        if (b.v.who && b.v.cue && b.v.text) {
          push(b.v.who + '：（' + b.v.cue + '）' + b.v.text);
          push(b.v.who + '：' + b.v.cue + b.v.text);
        }
      }
      else if (b.k === 'sd' || b.k === 'act' || b.k === 'note') push(b.v);
    }
  }
  const pubFront = pub.front;
  if (pubFront) {
    (pubFront.lead || []).forEach(push);
    for (const c of pubFront.cards || []) {
      push(c.title);
      (c.tags || []).forEach(push);
      (c.paras || []).forEach(push);
      for (const t of c.tables || []) {
        (t.head || []).forEach(push);
        for (const r of t.rows || []) (r || []).forEach(push);
      }
    }
  }
  for (const row of pub.charTable || []) row.forEach(push);
  for (const row of pub.songTable || []) row.forEach(push);
  for (const t of pub.threads || []) for (const k of ['name', 'plant', 'pay', 'note']) push(t[k]);
  for (const t of pub.timeline || []) { push(t.date); push(t.label); }
  return pieces;
}

function collectSecret(secret) {
  const pieces = [];
  const push = (v) => { if (v != null) pieces.push(String(v)); };
  for (const a of secret.acts || []) {
    for (const b of a.blocks || []) {
      if (b.k === 'dlg') {
        push(b.v.who); push(b.v.text); push(b.v.cue);
        if (b.v.who && b.v.text) push(b.v.who + '：' + b.v.text);
        if (b.v.who && b.v.cue && b.v.text) {
          push(b.v.who + '：（' + b.v.cue + '）' + b.v.text);
          push(b.v.who + '：' + b.v.cue + b.v.text);
        }
      }
      else if (b.k === 'beat') { push(b.v.text); push(b.v.who); push(b.v.cue); }
      else if (b.k === 'song') { push(b.v.name); push(b.v.performer); push(b.v.label); }
      else if (b.v != null && typeof b.v !== 'object') push(b.v);
    }
  }
  for (const s of secret.songs || []) {
    for (const it of s.items || []) {
      if (it.k === 'head') { push(it.v); }
      else if (it.k === 'ly') {
        push(it.speaker); push(it.text); push(it.cue);
        if (it.speaker && it.text) push(it.speaker + '：' + it.text);
        if (it.speaker && it.cue && it.text) push(it.speaker + '：' + it.cue + it.text);
      }
      else if (it.k === 'sec' || it.k === 'pt' || it.k === 'cue') push(it.v);
    }
  }
  /* 创作总纲：题记 / 卡片标题 / 副题 / 正文 / 表格 */
  const front = secret.front;
  if (front) {
    (front.lead || []).forEach(push);
    for (const c of front.cards || []) {
      push(c.title);
      (c.tags || []).forEach(push);
      (c.paras || []).forEach(push);
      for (const t of c.tables || []) {
        (t.head || []).forEach(push);
        for (const r of t.rows || []) (r || []).forEach(push);
      }
    }
  }
  return pieces;
}

async function main() {
  const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (pos.length < 2) {
    console.error('用法: node audit.mjs <剧本.docx|md|txt> <data.js>');
    process.exit(1);
  }
  const [src, dataPath] = pos;
  const { pub, enc } = parseDataJs(dataPath);
  const pubActs = (pub.acts || []).map((a) => String(a.title || '').trim());

  /* 先解密：总纲里的表也已上站，核对时不再算「制作手记」 */
  const password = process.env.READ_PASS || '';
  let secret = null;
  if (enc && password) {
    try { secret = decryptSecret(enc, password); }
    catch (e) { secret = null; }
  }

  const tableHeaders = renderedTableHeaders(pub);
  if (secret && secret.front) {
    for (const c of secret.front.cards || []) {
      for (const t of c.tables || []) {
        if (t.head && t.head.length) {
          tableHeaders.push(t.head.map((x) => String(x).trim()).join('|'));
        }
      }
    }
  }

  const stat = { skippedTables: 0 };
  const paras = await sourceParagraphs(src, pubActs, tableHeaders, stat);
  if (stat.skippedTables) {
    console.log('  · 跳过 %d 张制作手记表格（不上站）', stat.skippedTables);
  }

  let pieces = collectPublic(pub);
  let scope = '公开层';
  if (enc) {
    if (password) {
      if (secret) {
        pieces = pieces.concat(collectSecret(secret));
        scope = '公开层 + 受限层';
      } else {
        console.log('  ! READ_PASS 不对，只校验公开层');
      }
    } else {
      console.log('  ! 未设置 READ_PASS，只校验公开层（受限层未核）');
    }
  }

  const hay = new Set(pieces.map(norm).filter(Boolean));

  /* 台词标签行：「阿依：」——剧本把角色名单独占一行，台词在下一段。
     它不是缺漏，只要数据里存在同名角色就视为命中。 */
  const speakerNames = new Set();
  for (const s of pieces) {
    const m = /^([^：:（(]{1,12})[：:]/.exec(String(s).trim());
    if (m) speakerNames.add(m[1].trim());
  }
  const isLabelLine = (raw) => {
    const t = String(raw).trim();
    const m = /^([^：:（()]{1,12})[：:]\s*$/.exec(t);
    return !!m && speakerNames.has(m[1].trim());
  };

  const missing = [];
  const seen = new Set();
  for (const p of paras) {
    const n = norm(p);
    if (!n) continue;
    if (hay.has(n)) { seen.add(n); continue; }
    if (isLabelLine(p)) continue;
    /* 宽松匹配：源段落可能已被拆分到多个字段 */
    let hit = false;
    for (const h of hay) {
      if (h.length >= 8 && (h.includes(n) || n.includes(h))) { hit = true; break; }
    }
    if (!hit) missing.push(p);
  }

  console.log('✓ 校验：源段落 %d ／ 命中 %d ／ 缺失 %d（%s）',
    paras.length, paras.length - missing.length, missing.length, scope);
  if (missing.length) {
    console.log('  ✗ 以下源文本未进入站点：');
    for (const m of missing.slice(0, 40)) console.log('     · ' + m.slice(0, 90));
    if (missing.length > 40) console.log(`     … 另有 ${missing.length - 40} 条`);
    process.exit(1);
  }
  console.log('  ✓ 剧本每一段文字都在站点上。');
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
