#!/usr/bin/env node
/* ============================================================
   剧本站 · 解析层
   ------------------------------------------------------------
   把剧本文件（.docx / .md / .txt）解析为结构化 JSON。

   分层约定（沿用《山河摆渡人》《西山不是山》工具链）：
     解析层（本文件） → 映射层（build-data.mjs） → 加密层（同文件内）

   本文件只做「文档 → 结构」；剧目信息、人物卡、伏笔等人工内容留给映射层。

   用法：
     node parse-script.mjs <剧本.docx|md|txt> <script_struct.json> [--speakers "阿木,阿果"]
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { readDocx } from './lib/docx.mjs';
import {
  APPENDIX_HEADING_RE, SCENE_HEADING_RE, SONG_NO_TITLE_RE, isSceneTableHead,
  isTableLine, splitTableRow, isSeparatorRow,
} from './lib/common.mjs';

/* ── 句式 ──────────────────────────────────────────────── */
const ACT_RE = /^(?:序\s*幕|序|第[一二三四五六七八九十百零两]+幕|尾\s*幕|终\s*幕|尾\s*声|附\s*录|第[一二三四五六七八九十]+部分)\s*[：:、.．\s]\s*(.*)$/;
const SONG_TITLE_RE = /^(?:唱\s*段|歌\s*段|曲\s*目|歌\s*曲|唱\s*词)\s*([0-9０-９一二三四五六七八九十]+)\s*[、.．]?\s*[《「](.+?)[》」]/;
const SONG_BRACKET_RE = /^【\s*[《「](.+?)[》」]\s*(?:——|—|--|－)?\s*(.*?)\s*[】】]$/;
const MARK_RE = /^【\s*(.+?)\s*】$/;
const META_INLINE_RE = /^【\s*(时间|地点|表演形式|出场人物|舞台氛围|剧情正文|人物|道具|备注|注)\s*】\s*(.*)$/;
const PAREN_RE = /^[(（](.+)[)）]$/;
const SPK_RE = /^([^：（(【\[「\n，。！？；…\s]{1,12})\s*[：:]\s*(.*)$/;
const META_KEYS = ['时间', '地点', '表演形式', '出场人物', '舞台氛围', '剧情正文', '人物', '道具', '备注', '注'];
const STRUCT_PREFIX = new Set([
  '时间', '地点', '表演形式', '出场人物', '舞台氛围', '剧情正文', '人物', '道具',
  '备注', '注', '说明', '提示', '提示一', '提示二', '体例说明', '剧情', '人物表',
  '道具表', '场景', '场次', '幕', '序', '尾声', '注一', '注二', '注三',
]);
const SONG_SEC_EXACT = new Set([
  '说白', '前奏', '间奏', '尾奏', '尾声', '终曲', '主歌', '副歌', '桥段', '大合唱',
  '音乐骤停', '念白', '静场', '收束', '全剧终', '过门', '转调', '重复', '合唱',
  '第一段', '第二段', '第三段', '第四段', '一段', '二段', '三段', '四段',
]);
const SONG_SEC_KEYS = ['咏叹', '宣叙', '唱词', '插话', '绝唱', '登场', '念白', '幕后音', '动作', '对唱', '二重唱'];

const MAX_MARK_LEN = 30;

/* ── 小工具 ────────────────────────────────────────────── */
const strip = (s) => String(s ?? '').replace(/\s+$/g, '').trim();

/* 剥掉整行外层的方括号：【第一幕：…】【第一场·晨雾】〔…〕（…）
   剧本里幕/场标题常被这样包起来，不剥就会漏判标题、整段被当成舞台提示丢掉。 */
const unbracket = (s) => String(s ?? '').replace(/^[【\[〔（(]\s*([\s\S]*?)\s*[】\]〕）)]$/, '$1');

function isSongSection(x) {
  if (SONG_SEC_EXACT.has(x)) return true;
  return SONG_SEC_KEYS.some((k) => x.includes(k));
}

function isStructuralMark(x) {
  if (x.length > MAX_MARK_LEN) return false;
  if (/[。！？；…]$/.test(x)) return false;
  return true;
}

/* 看起来像「场次标题」而非「曲内小节」 */
function looksLikeSceneTitle(x) {
  return /^(第[一二三四五六七八九十\d]+\s*[场幕节章折]|场景|场次|地点|时间|画面)/.test(x.trim());
}

/* 标题里出现「幕 / 序 / 尾声 / 部分」才当幕 */
function looksLikeActTitle(x) {
  const t = String(x || '').trim();
  if (!t) return false;
  return ACT_RE.test(t)
    || /幕|序幕|尾声|终幕|终场/.test(t)
    || /^第[一二三四五六七八九十\d]+\s*[部分章卷]/.test(t)
    || /^(一段|二段|三段|四段|五段|六段)/.test(t);
}

/* 合唱 / 群唱这类声部标签，不是人物 */
const GROUP_LABELS = new Set([
  '合', '合唱', '群唱', '齐唱', '众人齐唱', '众人合唱', '齐颂', '众人', '大家',
  '全体', '合唱队', '伴唱', '轮唱', '领唱', '独唱', '旁白', '画外音',
]);

function splitCue(rest) {
  const m = /^\(([^()]*)\)\s*(.*)$/.exec(rest) || /^（([^（）]*)）\s*(.*)$/.exec(rest);
  if (m) return [m[1].trim(), m[2].trim()];
  return ['', rest.trim()];
}

function splitPerformer(raw) {
  const s = String(raw || '').trim();
  const m = /^(.+?)[（(]([^()]*)[)）]$/.exec(s);
  if (m) return [m[1].trim(), m[2].trim()];
  return [s, ''];
}

/* ── 读源文件 ──────────────────────────────────────────── */
async function readSource(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx') {
    const { blocks, paragraphs } = await readDocx(file);
    return { format: 'docx', blocks, paragraphs };
  }
  const text = fs.readFileSync(file, 'utf8');
  if (ext === '.md' || ext === '.markdown') {
    const lines = text.split(/\r?\n/).map((l) => ({ kind: 'p', style: '', text: l }));
    return { format: 'md', blocks: lines, paragraphs: lines };
  }
  const lines = text.split(/\r?\n/).map((l) => ({ kind: 'p', style: '', text: l }));
  /* 纯文本里的 Markdown 表格：连续的 | 行归成一块 */
  return { format: 'txt', blocks: groupTables(lines), paragraphs: lines };
}

/* 纯文本的表格识别：连续的 | 行 → 表格块（与 Markdown 同规则） */
function groupTables(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isTableLine(lines[i].text)) { out.push(lines[i]); continue; }
    const rows = [];
    let j = i;
    while (j < lines.length && isTableLine(lines[j].text)) {
      const cells = splitTableRow(lines[j].text);
      if (!isSeparatorRow(cells)) rows.push(cells);
      j++;
    }
    if (rows.length) out.push({ kind: 't', rows });
    i = j - 1;
  }
  return out;
}

/* ── 解析器 ────────────────────────────────────────────── */
class Parser {
  constructor(opts = {}) {
    this.acts = [];
    this.songs = new Map();
    this.songTable = [];
    this.charTable = [];
    this.extraTables = [];
    this.styleNotes = [];
    this.frontBlocks = [];   /* 正文开始前的内容（题记 + 总纲段落 + 总纲表格），按原顺序 */
    this.log = [];
    this.act = null;
    this.song = null;
    this.speaker = null;
    this.pendingSpk = null;
    this.header = true;
    this.mood = false;
    this.docTitle = '';
    this.inAppendix = false;
    this.pendingMeta = null;
    this.forcedSpeakers = new Set(opts.speakers || []);
    this.candidates = new Map();   // 说话人候选：名称 → 出现次数
    this.explicitSpeakers = new Set(opts.speakers || []);
    this.frontMatter = true;   /* 正文开始前的内容 → 前置说明，不成幕 */
    this.singerPending = false; /* 曲内：刚出现过角色行，下一段是唱词 */
    this.songPrevEndPunct = false; /* 曲内：上一段歌词以句号类标点收尾 */
    this.songSeenParen = false; /* 曲内：是否已出现过第一个括号行 */
    this.songSingers = new Set(); /* 曲内：出场过的演唱者 */
    this.sceneTable = [];       /* 幕表：场号 → 时间 / 地点 */
  }

  newAct(title, kind = 'act') {
    this.act = {
      index: this.acts.length,
      title: strip(title),
      kind,                 // 'act' = 剧本里的「幕」；'scene' = 场次制剧本的一章
      meta: { time: '', place: '', cast: '', mood: [] },
      blocks: [],
      publicBlocks: [],
    };
    this.act.sceneMeta = [];
    this.act.speakers = [];
    this.acts.push(this.act);
    return this.act;
  }

  blk(k, v, meta) {
    if (!this.act) {
      /* 正文开始前的段落 → 前置说明（题记 / 总纲），不单独成幕 */
      if (this.frontMatter) {
        this.pushFront(typeof v === 'string' ? v : String(v.title || ''));
        return;
      }
      this.newAct(this.docTitle || '序幕');
      this.header = true;
    }
    this.act.blocks.push(meta ? { k, v, meta } : { k, v });
  }

  addDlg(who, cue, text) {
    if (!this.act) return;
    if (!text) {
      this.pendingSpk = { who, cue };
      return;
    }
    this.act.blocks.push({ k: 'dlg', v: { who, cue, text } });
    this.pendingSpk = null;
  }

  /* 角色只有括号动作、没有台词：「王德三：（宣叙调，挑眉）」
     这是一拍动作节拍，不能丢——原剧本里有，站点上也必须有。 */
  addBeat(who, cue) {
    const text = who + '：' + (cue ? '（' + cue + '）' : '');
    if (this.act) this.act.blocks.push({ k: 'beat', v: { who, cue, text } });
    else this.pushFront(text);
  }

  /* 正文开始前的内容（题记 / 总纲段落）→ 前置总纲队列。
     保留原顺序与原样，站点据此渲染「创作总纲」，不再把标签平铺进序幕正文。 */
  pushFront(text) {
    const t = strip(typeof text === 'string' ? text : String((text && text.title) || ''));
    if (!t) return;
    this.frontBlocks.push({ k: 'p', v: t });
  }

  endSong() {
    if (!this.song) return;
    this.song = null;
    this.singerPending = false;
    this.songPrevEndPunct = false;
  }

  addSong(no, name, performerRaw, actIdx, actTitle) {
    const key = no ?? (this.songs.size + 1);
    if (this.songs.has(key)) return this.songs.get(key);
    const s = {
      no: key, name: strip(name), performer_raw: strip(performerRaw),
      act: actIdx, actTitle, items: [],
    };
    this.songs.set(key, s);
    return s;
  }

  /* 幕内：切到某幕 */
  switchAct(title, kind = 'act') {
    this.endSong();
    this.speaker = null;
    this.pendingSpk = null;
    this.header = true;
    this.mood = false;
    return this.newAct(title, kind);
  }

  handleText(text, style, idx, nextText) {
    const t = strip(text);
    if (!t) return;

    const bare = unbracket(t);

    /* ① 幕标题 */
    const am = ACT_RE.exec(t) || ACT_RE.exec(bare);
    if (am) {
      const title = ACT_RE.test(t) ? t : bare;
      this.frontMatter = false;
      this.switchAct(title);
      this.log.push([idx, 'ACT', t]);
      return;
    }

    /* ①b 场次标题（第一场：邮局后院）
       剧本用「场」分场时，场次即章节：
       · 全文没有显式「幕」的剧本 → 按场次切幕，每场自带时间/地点/人物
       · 已有「幕」的剧本 → 降为本幕内的小场次标题 */
    if (SCENE_HEADING_RE.test(t) || SCENE_HEADING_RE.test(bare)) {
      this.mood = false;
      this.endSong();
      this.speaker = null;
      this.pendingSpk = null;
      this.frontMatter = false;
      const sceneTitle = SCENE_HEADING_RE.test(t) ? t : bare;
      const sm = this.sceneMeta(sceneTitle);
      if (this.act && this.act.kind === 'act') {
        this.header = false;
        this.blk('scene', sceneTitle, sm || undefined);
        if (sm) this.act.sceneMeta.push(sm);
        this.log.push([idx, 'SCENE', t]);
      } else {
        this.switchAct(sceneTitle, 'scene');
        if (sm) this.act.sceneMeta.push(sm);
        this.log.push([idx, 'ACT', t]);
      }
      return;
    }

    /* ①c 附录标题（人物表 / 角色表 / 曲目表 …）→ 其后按附录处理 */
    if (APPENDIX_HEADING_RE.test(t) && this.acts.length) {
      /* 附录标记只在正文开始后生效；总纲里的「曲目表」只是表题 */
      this.inAppendix = true;
      this.endSong();
      this.speaker = null;
      this.pendingSpk = null;
      this.log.push([idx, 'APPENDIX', t]);
      return;
    }

    /* ② 曲目标题（多种写法） */
    let songNo = null, songName = null, songPerf = '';
    const sb = SONG_BRACKET_RE.exec(t);
    if (sb) {
      songName = sb[1]; songPerf = sb[2] || '';
    } else {
      const sn = SONG_NO_TITLE_RE.exec(t);
      const st = SONG_TITLE_RE.exec(t);
      if (sn) {
        songNo = parseInt(String(sn[1]).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)), 10);
        if (Number.isNaN(songNo)) songNo = null;
        songName = sn[2];
        songPerf = sn[3] || '';
      } else if (st) {
        songNo = parseInt(String(st[1]).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)), 10);
        if (Number.isNaN(songNo)) songNo = null;
        songName = st[2];
      }
    }
    if (songName && !(this.header && this.act && !this.act.meta.time && !this.act.meta.place)) {
      this.mood = false;
      this.endSong();
      const s = this.addSong(songNo, songName, songPerf,
        this.act ? this.act.index : 0, this.act ? this.act.title : '');
      s.items.push({ k: 'head', v: t });
      this.song = s;
      this.singerPending = false;
      this.songPrevEndPunct = false;
      this.songSeenParen = false;
      this.songSingers = new Set();
      /* 曲段挂进所在幕，站点才知道这一幕有哪些曲目 */
      this.blk('song', { no: s.no, name: s.name, performer_raw: s.performer_raw });
      this.log.push([idx, 'SONG', t]);
      return;
    }

    /* ③ 幕首资料区：【时间】… / 【地点】… （值可同行，也可下一段） */
    const mi = META_INLINE_RE.exec(t);
    if (mi) {
      const key = mi[1];
      const val = mi[2].trim();
      this.mood = false;
      if (key === '舞台氛围') {
        this.mood = true;
        if (val && this.act) this.act.meta.mood.push(val);
        this.log.push([idx, 'MOOD', t]);
        return;
      }
      if (this.act) {
        this.applyMeta(key, val);
        this.log.push([idx, 'META', t]);
        return;
      }
      this.blk('note', t);
      this.log.push([idx, 'META', t]);
      return;
    }

    /* ③b 裸资料标记（值在下一段） */
    const mm = MARK_RE.exec(t);
    if (!mi && mm && META_KEYS.includes(mm[1].trim())) {
      const key = mm[1].trim();
      if (key === '舞台氛围') {
        this.mood = true;
        this.log.push([idx, 'MOOD', t]);
        return;
      }
      if (this.act) {
        this.pendingMeta = key;
        this.log.push([idx, 'META', t]);
        return;
      }
    }

    /* ④ 方括号结构标记：曲内小节 / 场次标题 */
    if (mm && isStructuralMark(mm[1].trim())) {
      const x = mm[1].trim();
      if (this.frontMatter) {
        /* 正文前的方括号标记（【总纲】等）是前置章节，不是场次 */
        if (!this.docTitle) this.docTitle = t;
        this.pushFront(t);
        this.log.push([idx, 'FMARK', t]);
        return;
      }
      this.mood = false;
      if (this.song && (isSongSection(x) || !looksLikeSceneTitle(x))) {
        this.song.items.push({ k: 'sec', v: t });
        this.log.push([idx, 'SEC', t]);
        return;
      }
      this.endSong();
      this.speaker = null;
      this.blk('scene', x);
      this.log.push([idx, 'SCENE', t]);
      if (this.header) this.header = false;
      return;
    }

    /* ⑤ 整段括号 = 舞台提示 */
    const pm = PAREN_RE.exec(t);
    if (pm) {
      const inner = pm[1].trim();
      if (this.song) {
        /* 曲内括号有两种：
             · 紧跟角色行的 → 唱段提示（这个角色在唱）
             · 后面开口的是唱段之外的人 → 歌唱完了，戏回到台前 */
        const firstParen = !this.songSeenParen;
        const next = String(nextText || '').trim();
        const nextSpk = next ? SPK_RE.exec(next) : null;
        const nextName = nextSpk ? nextSpk[1].trim() : '';
        const singerLeaves = !!nextName && !this.songSingers.has(nextName);
        const talksBack = !!next && !nextName && /[。！？]$/.test(next);
        if (!firstParen && !this.singerPending && (singerLeaves || talksBack)) {
          this.endSong();
          this.blk('sd', inner);
          this.log.push([idx, 'SD', t]);
          return;
        }
        this.songSeenParen = true;
        this.song.items.push({ k: 'cue', v: inner });
        this.log.push([idx, 'CUE', t]);
        return;
      } else {
        /* 括号行一律作舞台提示；舞台氛围段到此为止 */
        if (this.mood) this.mood = false;
        this.blk('sd', inner);
      }
      this.log.push([idx, 'SD', t]);
      return;
    }

    /* ⑥ 角色行 */
    const sp = SPK_RE.exec(t);
    if (sp) {
      /* 正文开始前不会有角色台词：「编剧：白耀洲… 音乐：…」这类题记不能当角色 */
      if (!this.act) {
        this.pushFront(t);
        this.log.push([idx, 'FMNOTE', t]);
        return;
      }
      const who = sp[1].trim();
      const rest = sp[2].trim();
      /* 合唱行：「老周、周砚：……」——逐个名字校验 */
      const names = who.split(/[、,，/]/).map((x) => x.trim()).filter(Boolean);
      const allNames = names.length > 0 && names.every((n) =>
        n && !STRUCT_PREFIX.has(n)
        && !/^(第[一二三四五六七八九十]+[场幕节章]|[0-9]+[.、])$/.test(n)
        && n.length <= 8);
      if (who && allNames && names.length <= 4) {
        for (const n of names) {
          this.candidates.set(n, (this.candidates.get(n) || 0) + 1);
          if (this.song) {
            this.singerPending = true;
            names.forEach((n) => this.songSingers.add(n));
          }
        }
        if (this.explicitSpeakers.has(who)
          || names.every((n) => this.explicitSpeakers.has(n) || this.isLikelySpeaker(n, rest))) {
          /* 确认是角色后，才计入本幕人物表 */
          if (this.act) for (const n of names) this.act.speakers.push(n);
          this.mood = false;
          this.header = false;
          const [cue, body] = splitCue(rest);
          this.speaker = { who, cue };
          if (this.song) {
            if (body) this.song.items.push({ k: 'ly', speaker: who, cue, text: body });
            else this.pendingSpk = null;
          } else {
            this.pendingSpk = null;
            if (body) this.addDlg(who, cue, body);
            else if (cue) this.addBeat(who, cue);   /* 有动作 → 落一拍 */
            else this.pendingSpk = { who, cue };     /* 只有名字 → 台词在下一段 */
          }
          this.log.push([idx, 'SPK', t]);
          return;
        }
      }
    }

    /* ⑦ 普通段落 */
    if (this.mood && this.act) {
      this.act.meta.mood.push(t);
      this.log.push([idx, 'MOOD', t]);
      return;
    }
    if (this.pendingMeta && this.act) {
      const key = this.pendingMeta;
      this.pendingMeta = null;
      this.applyMeta(key, t);
      this.log.push([idx, 'META', t]);
      return;
    }
    if (!this.act) {
      /* 幕之前的正文（题记、体例说明等）→ style_notes，不单独成幕 */
      if (!this.docTitle) this.docTitle = t;
      this.pushFront(t);
      this.log.push([idx, 'NOTE', t]);
      return;
    }
    if (this.header && this.act.index === 0
      && !this.act.blocks.length && !this.act.meta.mood.length) {
      this.styleNotes.push(t);
      this.log.push([idx, 'NOTE', t]);
      return;
    }
    this.header = false;
    if (this.song) {
      const endsSentence = /[。！？]$/.test(t);
      if (!this.singerPending && endsSentence) {
        /* 唱段已收束，这一行是台前对白 */
        this.endSong();
      } else {
        let who = '', cue = '';
        if (this.speaker) { who = this.speaker.who; this.speaker = { who, cue: '' }; }
        this.song.items.push({ k: 'ly', speaker: who, cue, text: t });
        this.songPrevEndPunct = endsSentence;
        this.singerPending = false;
        this.log.push([idx, 'LY', t]);
        return;
      }
    }
    if (this.speaker) {
      const { who, cue } = this.speaker;
      this.pendingSpk = null;
      this.addDlg(who, cue, t);
      this.log.push([idx, 'DLG', t]);
      return;
    }
    this.blk('act', t);
    this.log.push([idx, 'ACTLINE', t]);
  }

  /* 幕首资料赋值 */
  applyMeta(key, val) {
    if (!this.act) return;
    const m = this.act.meta;
    if (key === '时间') { if (!m.time) m.time = val; }
    else if (key === '地点') { if (!m.place) m.place = val; }
    else if (key === '出场人物' || key === '人物') { if (!m.cast) m.cast = val; }
    else this.blk('note', '【' + key + '】' + val);
  }

  /* 说话人判定：显式名单 > 频次 > 形态 */
  isLikelySpeaker(who, rest) {
    if (this.explicitSpeakers.has(who)) return true;
    if (this.forcedSpeakers.has(who)) return true;
    const n = this.candidates.get(who) || 1;
    if (n >= 2) return true;
    /* 一次出现时：名字像人名，且不是「他说」「我问」这类叙述 */
    if (who.length < 2 || who.length > 6) return false;
    if (/[的了吗呢呀吧说道问答唱叫想听见们]/.test(who)) return false;
    if (rest.length >= 2) {
      /* 若「台词」本身以叙述连接词开头，多半是旁白 */
      if (/^(舞台|画面|此时|随后|这时|镜头|光|音|音乐|背景|音效)/.test(rest)) return false;
      return true;
    }
    /* 「名字：」后面接一行括号提示或空白 —— 台词在下一段，放行 */
    return true;
  }

  /* 幕表 → 场号 → {时间, 地点} */
  sceneMeta(title) {
    if (!this.sceneTable.length) return null;
    const m = /场\s*([0-9０-９]+)/.exec(String(title || ''));
    if (!m) return null;
    const key = '场' + m[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    const head = this.sceneTable[0].map((h) => String(h).trim());
    const iScene = head.findIndex((h) => h.includes('场') && !h.includes('幕'));
    const iTime = head.findIndex((h) => h.includes('时间'));
    const iPlace = head.findIndex((h) => h.includes('地点'));
    if (iScene < 0) return null;
    for (const row of this.sceneTable.slice(1)) {
      if (String(row[iScene] || '').replace(/\s+/g, '') === key) {
        return {
          time: iTime >= 0 ? String(row[iTime] || '').trim() : '',
          place: iPlace >= 0 ? String(row[iPlace] || '').trim() : '',
        };
      }
    }
    return null;
  }

  handleTable(rows, idx) {
    if (!rows || !rows.length) return;
    const head = (rows[0] || []).map((c) => String(c).trim());
    const joined = head.join('|');
    /* 正文开始前的表格 → 前置总纲：按原顺序留档（幕表 / 曲目表 / 人物声部表也在其中） */
    if (!this.acts.length) {
      this.frontBlocks.push({
        k: 't',
        rows: rows.map((r) => r.map((c) => String(c ?? '').trim())),
      });
    }
    if (isSceneTableHead(head) && !this.sceneTable.length) {
      this.sceneTable = rows.map((r) => r.map((c) => String(c).trim()));
      this.log.push([idx, 'SCENETABLE', joined]);
      return;
    }
    if (/曲目|曲名|唱段/.test(joined) && /序号|编号/.test(joined)) {
      this.songTable = rows.map((r) => r.map((c) => String(c).trim()));
      this.log.push([idx, 'SONGTABLE', joined]);
      return;
    }
    if (/人物|角色|演员/.test(joined) && !/曲目/.test(joined)) {
      this.charTable = rows.map((r) => r.map((c) => String(c).trim()));
      this.log.push([idx, 'CHARTABLE', joined]);
      return;
    }
    this.extraTables.push(rows.map((r) => r.map((c) => String(c).trim())));
    this.log.push([idx, 'TABLE', joined]);
  }

  result() {
    /* 每幕的资料：时间跨度 / 地点 / 出场人物 */
    for (const a of this.acts) {
      const times = [...new Set((a.sceneMeta || []).map((s) => s.time).filter(Boolean))];
      if (!a.meta.time && times.length) {
        a.meta.time = times.length === 1 ? times[0] : times[0] + ' — ' + times[times.length - 1];
      }
      const places = [...new Set((a.sceneMeta || []).map((s) => s.place).filter(Boolean))];
      if (!a.meta.place && places.length) a.meta.place = places.join(' / ');
      const sp = [...new Set(a.speakers || [])].filter((n) => !GROUP_LABELS.has(n));
      if (!a.meta.cast && sp.length) a.meta.cast = sp.slice(0, 12).join('、');
    }
    const songs = [...this.songs.values()].sort((a, b) => a.no - b.no);
    const ambiguous = [...this.candidates.entries()]
      .filter(([k, v]) => v === 1 && !this.explicitSpeakers.has(k))
      .map(([k]) => k);
    return {
      doc_title: this.docTitle,
      acts: this.acts,
      songs,
      song_table: this.songTable,
      char_table: this.charTable,
      extra_tables: this.extraTables,
      scene_table: this.sceneTable,
      style_notes: this.styleNotes,
      front_blocks: this.frontBlocks,
      speaker_candidates: [...this.candidates.entries()].sort((a, b) => b[1] - a[1]),
      ambiguous_speakers: ambiguous,
      log: this.log,
    };
  }
}

/* ── Markdown 预处理：标题转结构标记，表格转表格块 ─────── */
function mdNormalize(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    /* 表格：连续的 | 开头的行 */
    if (/^\s*\|/.test(l.text)) {
      const rows = [];
      let j = i;
      while (j < lines.length && /^\s*\|/.test(lines[j].text)) {
        const raw = lines[j].text.trim().replace(/^\|/, '').replace(/\|$/, '');
        const cells = raw.split('|').map((c) => c.trim());
        /* 跳过 |---|---| 分隔行 */
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) rows.push(cells);
        j++;
      }
      if (rows.length) out.push({ kind: 't', rows });
      i = j - 1;
      continue;
    }

    const m = /^(\#{1,6})\s+(.*)$/.exec(l.text);
    if (!m) { out.push(l); continue; }
    const level = m[1].length;
    const text = m[2].trim();
    if (level === 1) out.push({ kind: 'p', style: 'H1', text });
    else if (level === 2) out.push({ kind: 'p', style: 'H2', text });
    else if (level >= 3) out.push({ kind: 'p', style: 'H3', text });
    else out.push(l);
  }
  return out;
}

/* ── 主流程 ────────────────────────────────────────────── */
async function main() {
  const argv = process.argv.slice(2);
  const opts = { speakers: [] };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--speakers') { opts.speakers = String(argv[++i] || '').split(/[,，\s]+/).filter(Boolean); continue; }
    if (argv[i] === '--act-headings') { opts.actHeadings = String(argv[++i] || '').split(/[,，|]/).map((x) => x.trim()).filter(Boolean); continue; }
    if (argv[i] === '--audit') { opts.audit = true; continue; }
    pos.push(argv[i]);
  }
  if (pos.length < 2) {
    console.error('用法: node parse-script.mjs <剧本.docx|md|txt> <script_struct.json> [--speakers "阿木,阿果"] [--act-headings "序幕,第一幕"] [--audit]');
    process.exit(1);
  }
  const [src, out] = pos;
  if (!fs.existsSync(src)) { console.error('找不到源文件：' + src); process.exit(1); }

  const raw = await readSource(src);
  const blocks = raw.format === 'md' ? mdNormalize(raw.blocks) : raw.blocks;

  const p = new Parser(opts);

  /* 预扫描二级标题，判定哪些算「幕」 */
  const h2s = blocks.filter((b) => b.style === 'H2').map((b) => String(b.text || '').trim());
  let actHeadings = new Set(h2s.filter(looksLikeActTitle));
  if (opts.actHeadings && opts.actHeadings.length) {
    /* 人工指定哪些标题算「幕」 */
    actHeadings = new Set(h2s.filter((t) =>
      opts.actHeadings.some((a) => t.includes(a) || a.includes(t))));
  }
  if (!actHeadings.size && h2s.length >= 2) actHeadings = new Set(h2s);

  /* 前瞻：下一个「非括号」段落，用来判断唱段是否收束 */
  const nextMeaningful = (from) => {
    for (let j = from + 1; j < blocks.length; j++) {
      if (blocks[j].kind !== 'p') continue;
      const t = String(blocks[j].text || '').trim();
      if (!t) continue;
      if (PAREN_RE.test(t)) continue;
      return t;
    }
    return '';
  };

  let idx = 0;
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.kind === 't') { p.handleTable(b.rows, idx++); continue; }
    const style = b.style || '';
    const text = b.text || '';

    /* docx 标题样式 → 幕（Heading1/Heading2/标题 1/标题 2） */
    if (/^(Heading[12]|标题 ?[12])$/.test(style)) {
      p.inAppendix = false;
      p.switchAct(text);
      p.log.push([idx++, 'ACT', text]);
      continue;
    }

    /* Markdown 标题 → 结构 */
    if (style === 'H1') {
      p.docTitle = text;
      p.log.push([idx++, 'DOCTITLE', text]);
      continue;
    }
    if (style === 'H2') {
      if (actHeadings.has(text)) {
        p.inAppendix = false;
        p.switchAct(text);
        p.log.push([idx++, 'ACT', text]);
      } else {
        p.inAppendix = true;
        p.endSong();
        p.log.push([idx++, 'APPENDIX', text]);
      }
      continue;
    }
    if (p.inAppendix) {
      if (b.kind === 't') p.handleTable(b.rows, idx++);
      else p.log.push([idx++, 'SKIP', text]);
      continue;
    }
    if (style === 'H3') {
      const st = SONG_TITLE_RE.exec(text);
      const sb = SONG_BRACKET_RE.exec(text);
      if (st || sb) { p.handleText(text, style, idx++); continue; }
      p.endSong();
      p.header = false;
      p.speaker = null;
      p.blk('scene', text);
      p.log.push([idx++, 'SCENE', text]);
      continue;
    }
    p.handleText(text, style, idx++, nextMeaningful(bi));
  }

  /* 没有显式幕时，第一段非空内容兜底成序幕 */
  if (!p.acts.length) p.newAct('序幕');

  const struct = p.result();
  struct.source = path.resolve(src);
  struct.format = raw.format;
  struct.generated_at = new Date().toISOString();

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(struct, null, 1), 'utf8');

  const lyricLines = struct.songs.reduce(
    (n, s) => n + s.items.filter((i) => i.k === 'ly').length, 0);
  console.log('✓ 解析完成：幕 %d ／ 曲 %d ／ 歌词行 %d ／ 表格 %d → %s',
    struct.acts.length, struct.songs.length, lyricLines,
    struct.song_table.length + struct.char_table.length + struct.extra_tables.length, out);

  if (struct.ambiguous_speakers.length) {
    console.log('  ! 一次出现、疑似角色名（已按叙述处理，确认后加入 --speakers）：%s',
      struct.ambiguous_speakers.slice(0, 20).join('、'));
  }
  if (opts.audit) {
    for (const [i, kind, text] of struct.log) {
      console.log(String(i).padStart(4), kind.padEnd(9), text);
    }
  }
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
