#!/usr/bin/env node
/* ============================================================
   剧本站 · 映射层 + 加密层
   ------------------------------------------------------------
   把 script_struct.json（解析层产物）+ site_meta.json（人工撰写的
   剧目信息）映射成站点 data.js：

     window.SCRIPT        公开层：剧目概况、曲目目录、人物、伏笔、时间线
     window.SCRIPT_SECRET 受限层：AES-256-GCM 密文（幕正文 + 全部歌词）

   密码来自环境变量 READ_PASS，不写死在仓库里：
     READ_PASS='你的密码' node build-data.mjs script_struct.json site_meta.json data.js

   不设 READ_PASS（或 --no-encrypt）时，全部内容直接进公开层，不设权限门。

   用法：
     node build-data.mjs <script_struct.json> <site_meta.json> <data.js> [--no-encrypt]
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ITERATIONS = 150000;
const KEY_LEN = 32;
const IV_LEN = 12;

/* ── 小工具 ────────────────────────────────────────────── */
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function splitPerformer(raw) {
  const s = String(raw || '').trim();
  const m = /^(.+?)[（(]([^()]*)[)）]$/.exec(s);
  if (m) return [m[1].trim(), m[2].trim()];
  return [s, ''];
}

/* 幕次标签：序幕 / 第一幕 / 尾幕 */
function deriveActLabel(title, i) {
  const t = String(title || '');
  if (/序/.test(t.slice(0, 4))) return '序幕';
  if (/尾|终/.test(t.slice(0, 4))) return '尾幕';
  const m = /^(第[一二三四五六七八九十百]+幕)/.exec(t);
  if (m) return m[1];
  const m2 = /^(第[一二三四五六七八九十]+[部分场章])/.exec(t);
  if (m2) return m2[1];
  return `第${i + 1}幕`;
}

function actShortTitle(title) {
  const t = String(title || '').trim();
  const m = /^([^：:]{1,12})[：:]/.exec(t);
  return m ? m[1] : t;
}

/* ── 加密 ──────────────────────────────────────────────── */
function encrypt(secret, password, saltB64) {
  const salt = Buffer.from(saltB64, 'base64');
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, 'sha256');
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([
    cipher.update(JSON.stringify(secret), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    salt: saltB64,
    iterations: ITERATIONS,
    iv: iv.toString('base64'),
    cipher: Buffer.concat([ct, tag]).toString('base64'),
  };
}

/* ── 前置总纲 → 卡片 ───────────────────────────────────────
   剧本开头的「总纲」区通常由「标签 + 正文」「标签 + 表格」交替组成。
   这里把标签与紧随其后的正文／表格配对成卡片：标签不再平铺进序幕正文，
   站点据此渲染一个可展开的「创作总纲」。                          */
const FRONT_LABEL_MAX = 24;

function isFrontLabel(text) {
  const t = String(text || '').trim();
  if (!t || t.length > FRONT_LABEL_MAX) return false;
  if (/[。！？；，、：,.;:!?]$/.test(t)) return false;   /* 以标点收尾 → 是正文 */
  if (/[，、：,;:]/.test(t)) return false;               /* 句中出现标点 → 是正文 */
  if (/^[(（]/.test(t)) return false;                    /* 括号行 → 是舞台提示 */
  return true;
}

function cleanFrontLabel(t) {
  return String(t || '').trim().replace(/^【(.+)】$/, '$1').trim();
}

function buildFront(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const lead = [];
  const cards = [];
  let labels = [];
  let cur = null;
  let inLead = true;

  const open = (ls) => {
    cur = {
      title: cleanFrontLabel((ls && ls[0]) || ''),
      tags: (ls || []).slice(1).map(cleanFrontLabel).filter(Boolean),
      paras: [],
      tables: [],
    };
    cards.push(cur);
    labels = [];
  };

  for (const b of list) {
    const isTable = b.k === 't';
    const t = isTable ? '' : String(b.v || '').trim();
    if (!isTable && !t) continue;

    /* 题记区：第一个【…】标记或第一张表之前的内容 */
    if (inLead) {
      if (isTable) inLead = false;
      else if (/^【.+】$/.test(t)) { inLead = false; labels.push(t); continue; }
      else { lead.push(t); continue; }
    }

    if (isTable) {
      if (!cur) open(labels);
      const rows = (b.rows || []).map((r) => r.map((c) => String(c ?? '').trim()));
      cur.tables.push({ head: rows[0] || [], rows: rows.slice(1) });
      continue;
    }

    if (/^【.+】$/.test(t) || isFrontLabel(t)) {
      /* 连续的标签 → 后一个并入上一张卡的副题（情感引擎 · 私人谎言） */
      if (!labels.length && cur && !cur.paras.length && !cur.tables.length) {
        cur.tags.push(cleanFrontLabel(t));
      } else {
        labels = [t];
        open(labels);
      }
      continue;
    }

    if (!cur) open(labels);
    cur.paras.push(t);
  }

  return { lead, cards, count: cards.length };
}

/* ── 映射 ──────────────────────────────────────────────── */
function build(struct, meta, { encrypt: doEncrypt, password }) {
  const acts = struct.acts || [];
  const songs = struct.songs || [];
  const front = buildFront(struct.front_blocks);
  const frontOut = front.cards.length ? front : null;

  /* 幕次标签 */
  const actLabels = acts.map((a, i) => deriveActLabel(a.title, i));

  /* 曲目表：优先用剧本里的原表，否则自动生成 */
  let songTable = struct.song_table || [];

  /* 原表里的「曲名 / 演唱」比正文里的标记更权威（编号对得上时优先） */
  const songRowByNo = new Map();
  if (songTable.length > 1) {
    const head = songTable[0].map((h) => String(h).trim());
    const iNo = head.findIndex((h) => /编号|序号/.test(h));
    const iName = head.findIndex((h) => /曲名|曲目名称|名称/.test(h));
    const iPerf = head.findIndex((h) => /演唱/.test(h));
    for (const row of songTable.slice(1)) {
      if (iNo < 0) break;
      const no = parseInt(String(row[iNo] || '').replace(/[^0-9]/g, ''), 10);
      if (!Number.isNaN(no) && no > 0) {
        songRowByNo.set(no, {
          name: iName >= 0 ? String(row[iName] || '').trim() : '',
          performer: iPerf >= 0 ? String(row[iPerf] || '').trim() : '',
        });
      }
    }
  }

  /* 曲目的正式名称 / 演唱 */
  const songInfo = (no, fallbackName, fallbackPerf) => {
    const row = songRowByNo.get(no);
    const name = (row && row.name) || fallbackName || '';
    const raw = (row && row.performer) || fallbackPerf || '';
    const [who, kind] = splitPerformer(raw);
    let perf = who;
    if (kind && perf && !perf.includes(kind)) perf = perf + ' ' + kind;
    else if (kind && !perf) perf = kind;
    if (!perf) perf = raw;
    return { name, perf };
  };
  if (!songTable.length && songs.length) {
    songTable = [['幕次', '序号', '曲目名称', '类型', '演唱']];
    for (const s of songs) {
      const [who, kind] = splitPerformer(s.performer_raw);
      songTable.push([
        actLabels[s.act] || `第${s.act + 1}幕`,
        String(s.no),
        s.name,
        kind || '',
        who || s.performer_raw || '',
      ]);
    }
  }

  /* 人物表：优先用剧本里的原表，否则用 site_meta.cast */
  let charTable = struct.char_table || [];
  if (!charTable.length && (meta.cast || []).length) {
    charTable = [['人物', '人物简介']];
    for (const c of meta.cast) {
      charTable.push(c.role
        ? [c.name, c.desc || '', c.role]
        : [c.name, c.desc || '']);
    }
  } else if (charTable.length) {
    /* 剧本自带人物表时，把 site_meta.cast 里写的「身份」补进第三列
       （原表已有第三列的不覆盖） */
    const byName = new Map((meta.cast || []).map((c) => [String(c.name || '').trim(), c]));
    for (const row of charTable) {
      const c = byName.get(String(row[0] || '').trim());
      if (c && c.role && !row[2]) row[2] = c.role;
    }
  }

  /* 时间线：site_meta 优先，否则按幕生成 */
  let timeline = meta.timeline || [];
  if (!timeline.length) {
    timeline = acts.map((a, i) => ({
      act: i,
      date: (a.meta && a.meta.time) || '',
      label: actShortTitle(a.title),
    }));
  }

  /* 主线：site_meta.mainline 优先，否则取时间线标签 */
  const mainline = (meta.mainline && meta.mainline.length)
    ? meta.mainline
    : timeline.map((t) => t.label).filter(Boolean);

  /* 公开层 & 受限层 */
  const actsPub = [];
  const actsSec = [];
  const songsPub = [];
  const songsSec = [];

  for (const act of acts) {
    const idx = act.index;
    const am = act.meta || {};
    const metaObj = {
      time: am.time || '',
      place: am.place || '',
      cast: am.cast || '',
      mood: am.mood || [],
    };

    /* 补齐曲段的 performer / label */
    const fullBlocks = (act.blocks || []).map((b) => {
      if (b.k !== 'song') return b;
      const v = { ...b.v };
      const info = songInfo(v.no, v.name, v.performer_raw);
      v.name = info.name;
      v.performer = info.perf;
      v.label = `【曲目${String(v.no).padStart(2, '0')} 《${v.name}》（${v.performer}）】`;
      v.actTitle = act.title;
      return { k: 'song', v };
    });

    /* 公开层只留场次标题与曲段卡 */
    const pubBlocks = fullBlocks
      .filter((b) => b.k === 'scene' || b.k === 'song')
      .map((b) => (b.k === 'song'
        ? { k: 'song', v: { no: b.v.no, name: b.v.name, performer: b.v.performer, label: b.v.label, act: idx, actTitle: act.title } }
        : b));

    actsPub.push({ title: act.title, meta: metaObj, blocks: pubBlocks });

    /* 受限层：全文 */
    const secBlocks = fullBlocks.map((b) => {
      if (b.k === 'song') return b;
      return b;
    });
    /* 没有结构化总纲时，题记／体例说明仍按原顺序排在序幕正文之前；
       有总纲的剧本改由「创作总纲」区承载，序幕正文不再平铺标签。 */
    const leadNotes = frontOut ? [] : [...front.lead, ...(struct.style_notes || [])];
    if (idx === 0 && leadNotes.length) {
      secBlocks.unshift(
        { k: 'note', v: '【体例说明】' },
        ...leadNotes.map((n) => ({ k: 'note', v: n })),
      );
    }
    actsSec.push({ act: idx, blocks: secBlocks });
  }

  for (const s of songs) {
    const info = songInfo(s.no, s.name, s.performer_raw);
    const perf = info.perf;

    songsPub.push({
      no: s.no,
      name: info.name,
      performer: perf,
      label: `【曲目${String(s.no).padStart(2, '0')} 《${info.name}》（${perf}）】`,
      act: s.act,
      actTitle: s.actTitle,
    });
    songsSec.push({
      no: s.no,
      lyrics: s.items.filter((i) => i.k === 'ly').map((i) => i.text).join('\n'),
      items: s.items,
    });
  }

  /* 配乐：src 指向构建时拷进 assets/audio/ 的文件 */
  const audio = (meta.audio || []).map((a) => ({
    title: a.title || '',
    performer: a.performer || '',
    note: a.note || '',
    src: 'assets/audio/' + path.basename(a.file || a.src || ''),
  })).filter((a) => a.src && a.src !== 'assets/audio/');

  const cover = {
    title: meta.title || meta.name || '',
    name: meta.name || '',
    kicker: meta.kicker || '',
    seal: meta.seal || (meta.name ? String(meta.name).charAt(0) : ''),
    theme: meta.theme || '',
    span: meta.span || '',
    author: meta.author || '',
    music: meta.music || '',
    director: meta.director || '',
    cta: meta.cta || '开演',
    scene: meta.scene || 'mountain',
    unit: meta.unit || '',
    mainline,
    note: meta.note || '',
    footerTitle: meta.footerTitle || meta.theme || meta.name || '',
  };

  const sections = meta.sections || {};
  const gateCfg = meta.gate || {};
  /* 没有密码就一定不加密 —— 否则会用空密码「加密」，页面永远解不开 */
  const gateEnabled = !!doEncrypt
    && (gateCfg.enabled !== undefined ? !!gateCfg.enabled : true);

  const data = {
    cover,
    front: null,          /* 创作总纲默认进受限层（总纲含剧透） */
    frontCount: frontOut ? frontOut.cards.length : 0,
    acts: actsPub,
    songs: songsPub,
    songTable,
    charTable,
    threads: meta.threads || [],
    timeline,
    actLabels,
    audio,
    sections: {
      spine: sections.spine || {},
      songs: sections.songs || {},
      table: sections.table || {},
      motifs: sections.motifs || {},
      cast: sections.cast || {},
      threads: sections.threads || {},
      audio: sections.audio || {},
      gate: {
        title: gateCfg.title || '全本剧本 · 限内部传阅',
        desc: gateCfg.desc || '',
        tip: gateCfg.tip || '密码由主创团队分发 · 公开页面仅展示剧目概况',
      },
    },
  };

  if (!gateEnabled) {
    /* 全部公开：正文与歌词直接内联 */
    data.acts = actsPub.map((a, i) => ({ ...a, blocks: actsSec[i].blocks }));
    data.songs = songsPub.map((s, i) => ({ ...s, items: songsSec[i].items }));
    data.front = frontOut;
    return { data, secret: null };
  }

  const saltB64 = Buffer.from(`${meta.slug || 'script'}/read-salt`, 'utf8').toString('base64');
  const enc = encrypt({ acts: actsSec, songs: songsSec, front: frontOut }, password, saltB64);
  return { data, secret: enc };
}

/* ── 主流程 ────────────────────────────────────────────── */
function main() {
  const argv = process.argv.slice(2);
  const noEncrypt = argv.includes('--no-encrypt');
  const pos = argv.filter((a) => !a.startsWith('--'));
  if (pos.length < 3) {
    console.error('用法: node build-data.mjs <script_struct.json> <site_meta.json> <data.js> [--no-encrypt]');
    process.exit(1);
  }
  const [structPath, metaPath, outPath] = pos;

  const struct = readJson(structPath);
  const meta = readJson(metaPath);

  const password = process.env.READ_PASS || '';
  const wantEncrypt = !noEncrypt && !!password;

  const { data, secret } = build(struct, meta, { encrypt: wantEncrypt, password });

  let js = 'window.SCRIPT = ' + JSON.stringify(data, null, 1) + ';\n';
  if (secret) js += 'window.SCRIPT_SECRET = ' + JSON.stringify(secret) + ';\n';

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, js, 'utf8');

  console.log('✓ data.js 写入 %s（%d 字节）｜幕 %d｜曲目 %d｜%s',
    outPath, js.length, data.acts.length, data.songs.length,
    secret ? `密文 ${secret.cipher.length} 字节（PBKDF2×${secret.iterations} + AES-256-GCM）`
      : '公开模式（无权限门）');
  if (secret) console.log('  密码来自环境变量 READ_PASS，未写入仓库。');
  else if (meta.gate && meta.gate.enabled) {
    console.log('  ! site_meta.json 里 gate.enabled=true，但没设 READ_PASS —— 本次按公开模式构建。');
  }
}

main();
