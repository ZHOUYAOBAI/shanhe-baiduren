/* ============================================================
   《山河摆渡人》剧本站 · 交互
   ============================================================ */
import { createStage } from './scene.js';
import { decryptSecret } from './crypto.js';
import { AudioEngine } from './audio-engine.js';

/* D：公开层数据（剧目概况 / 歌单目录 / 人物 / 伏笔）
   解锁后由 mergeSecret() 补入六幕正文与全部歌词 */
let D = window.SCRIPT;
const SECRET = window.SCRIPT_SECRET || null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── 3D 场景 ───────────────────────────────────────────── */
const canvas = $('#stage');
let stage = null;
try {
  stage = createStage(canvas);
} catch (e) {
  // WebGL 不可用：退回纯色底
  canvas.style.display = 'none';
  console.warn('WebGL 场景不可用：', e);
}

/* ── HERO ──────────────────────────────────────────────── */
{
  $('#heroSub').textContent = D.cover.theme || '历史的回眸 · 巧渡金沙江';
  $('#heroMeta').innerHTML = [
    D.cover.span,
    `六幕 · ${D.songs.length} 首曲目`,
    '1932 — 1935',
  ].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('');

  /* 署名：编剧 / 音乐 */
  const credits = [];
  if (D.cover.author) credits.push(`编剧：${D.cover.author}`);
  if (D.cover.music) credits.push(`音乐：${D.cover.music}`);
  if (credits.length) {
    const el = $('#heroCredits');
    if (el) el.innerHTML = credits.map(t => `<span>${esc(t)}</span>`).join('');
  }

  $('#spineDesc').textContent = D.cover.mainline.join(' → ');
  $('#footNote').textContent = D.cover.note;

  const fa = $('#footAuthor');
  if (fa) {
    fa.innerHTML = credits.map(t => `<span>${esc(t)}</span>`).join('');
  }
}

/* ── 时间轴 ────────────────────────────────────────────── */
{
  const el = $('#spineItems');
  el.innerHTML = D.timeline.map(t => `
    <div class="spine-item" data-act="${t.act}">
      <div class="spine-dot" aria-hidden="true"></div>
      <div class="spine-date">${esc(t.date)}</div>
      <div class="spine-label">${esc(t.label)}</div>
    </div>`).join('');

  el.addEventListener('click', (e) => {
    const it = e.target.closest('.spine-item');
    if (it) gotoAct(+it.dataset.act);
  });
}

/* ── 幕次渲染 ──────────────────────────────────────────── */
const ACT_LABELS = ['序幕', '第一幕', '第二幕', '第三幕', '第四幕', '尾幕'];
const songByNo = {};
/* 解锁后密文数据并入 D，需重建曲目索引 */
function reindexSongs() {
  for (const k of Object.keys(songByNo)) delete songByNo[k];
  D.songs.forEach(s => { songByNo[s.no] = s; });
}
reindexSongs();

function renderSong(s, full) {
  // full = D.songs 中对应的完整曲目（含歌词）
  // items = 按原文顺序排列的有序流（歌词 / 舞台提示 / 小节标题 / 声部）
  const items = (full && full.items) || s.items || [];
  let last = null;
  const lines = items.map(it => {
    if (it.k === 'ly') {
      const who = (it.speaker && it.speaker !== last)
        ? `<span class="who">${esc(it.speaker)}</span>` : '';
      if (it.speaker) last = it.speaker;
      const cue = it.cue ? `<span class="cue">${esc(it.cue)}</span>` : '';
      return `${who}${cue}<span class="ly">${esc(it.text)}</span>`;
    }
    if (it.k === 'sec') {
      // 曲内小节标题：【前奏】【阿木・宣叙调・决绝】
      const t = String(it.v || '').trim();
      const inner = /^【(.+)】$/.exec(t);
      return `<p class="song-sec">${esc(inner ? inner[1] : t)}</p>`;
    }
    if (it.k === 'pt') {
      // 声部标注：红军小队（背景哼鸣）
      // 若该角色随后马上有台词，则此处不重复标注角色名
      const nx = items[items.indexOf(it) + 1];
      if (nx && nx.k === 'ly' && nx.speaker &&
          nx.speaker === String(it.v).split('（')[0].trim()) {
        last = nx.speaker;
        return `<p class="song-part">${esc(it.v)}</p>`;
      }
      return `<p class="song-part">${esc(it.v)}</p>`;
    }
    if (it.k === 'cue') {
      return `<p class="song-stage">${esc(it.who ? it.who + '：' : '')}（${esc(it.v)}）</p>`;
    }
    // 舞台提示
    return `<p class="song-stage">${esc(it.v)}</p>`;
  }).join('');

  return `
    <div class="song" data-song="${s.no}">
      <div class="song-head" role="button" tabindex="0" aria-expanded="false">
        <span class="song-no">${String(s.no).padStart(2, '0')}</span>
        <span class="song-name">《${esc(s.name)}》</span>
        <span class="song-perf">${esc(s.performer || '—')}</span>
        <span class="song-toggle">▾</span>
      </div>
      <div class="song-body">
        <div class="song-inner">
          <div class="lyric">${lines}</div>
        </div>
      </div>
    </div>`;
}

function renderAct(a, ai) {
  const m = a.meta;
  const facts = [];
  if (m.time) facts.push(`<span><b>时间</b>　${esc(m.time)}</span>`);
  if (m.place) facts.push(`<span><b>地点</b>　${esc(m.place)}</span>`);
  if (m.cast) facts.push(`<span><b>人物</b>　${esc(m.cast)}</span>`);

  const metaCells = [];
  if (m.time)  metaCells.push(`<div><dt>时 间</dt><dd>${esc(m.time)}</dd></div>`);
  if (m.place) metaCells.push(`<div><dt>地 点</dt><dd>${esc(m.place)}</dd></div>`);
  if (m.mood && m.mood.length) metaCells.push(`<div><dt>舞 台 氛 围</dt><dd>${m.mood.map(esc).join('<br>')}</dd></div>`);
  if (m.cast)  metaCells.push(`<div><dt>出 场 人 物</dt><dd>${esc(m.cast)}</dd></div>`);
  if (m.places && m.places.length) {
    metaCells.push(`<div><dt>场 景</dt><dd>${m.places.map(esc).join('<br>')}</dd></div>`);
  }

  let body = '';
  let openSong = false;

  for (const b of a.blocks) {
    // 唱段内的块（歌词/角色名/提示）已并入 song.lyrics，正文不再重复渲染
    if (b.inSong) continue;
    switch (b.k) {
      case 'scene':
        body += `<div class="scene" id="scene-${ai}-${body.length}"><div class="scene-head">${esc(b.v)}</div></div>`;
        openSong = false;
        break;
      case 'song':
        // 歌词在 D.songs 里（已归并），正文只渲染卡片
        body += renderSong(b.v, songByNo[b.v.no]);
        openSong = true;
        break;
      case 'cue':
        body += `<p class="cue-line"><span class="cue">${esc(b.who ? b.who + '：' : '')}</span>${esc(b.v)}</p>`;
        break;
      case 'mood':
        body += `<p class="act-line mood-line">${esc(b.v)}</p>`;
        break;
      case 'lyric':
        body += `<p class="dlg lyric-raw">${esc(b.v)}</p>`;
        break;
      case 'sd':
        body += `<p class="sd">${esc(b.v)}</p>`;
        if (!openSong) break;
        break;
      case 'act': {
        const t = String(b.v || '');
        if (/三十七|镌刻|刻着.*名字|一笔一画/.test(t)) {
          body += `<aside class="roll-card">${esc(t)}</aside>`;
          break;
        }
        body += `<p class="act-line">${esc(t)}</p>`;
        break;
      }
      case 'note': {
        // 【地点】等幕内资料标签已进资料卡；其余转场/动作标记保留
        const t = String(b.v || '');
        if (/^【(时间|地点|出场人物|舞台氛围)】/.test(t)) break;
        if (t.startsWith('［氛围］')) {
          body += `<p class="act-line mood-line">${esc(t.replace('［氛围］', ''))}</p>`;
          break;
        }
        // 史实锚点：字幕浮现 / 纪念碑 / 具体史实日期 → 苍青，与虚构的暖红区分
        if (/字幕浮现|纪念碑|史实/.test(t)) {
          body += `<aside class="fact-card">${esc(t)}</aside>`;
          break;
        }
        // 名录：三十七个名字、碑上镌刻 → 彝金
        if (/三十七|镌刻|刻着.*名字|一笔一画/.test(t)) {
          body += `<aside class="roll-card">${esc(t)}</aside>`;
          break;
        }
        body += `<p class="act-line note-line">${esc(t)}</p>`;
        break;
      }
      case 'spk': {
        const sc = b.cue ? `<span class="cue">${esc(b.cue)}</span>` : '';
        body += `<p class="spk">${esc(b.v)}${sc}</p>`;
        break;
      }
      case 'dlg': {
        const cue = b.cue ? `<span class="cue">${esc(b.cue)}</span>` : '';
        const who = b.who ? `<span class="who">${esc(b.who)}</span>` : '';
        body += `<p class="dlg">${who}${cue}${esc(b.v)}</p>`;
        break;
      }
    }
  }

  return `
    <section class="band dark act" id="act-${ai}" data-act="${ai}">
      <div class="wrap">
        <div class="act-head">
          <div class="act-no">${String(ai).padStart(2, '0')}</div>
          <h2 class="act-title">${esc(a.title)}</h2>
          <div class="act-facts">${facts.join('')}</div>
        </div>
        ${metaCells.length ? `<dl class="act-meta">${metaCells.join('')}</dl>` : ''}
        ${body}
      </div>
    </section>`;
}

/* ── 剧目区（解锁后会重渲染）──────────────────────────── */
function renderActs() {
  $('#acts').innerHTML = D.acts.map(renderAct).join('');
}
renderActs();

/* ── 曲目总览（解锁后会重渲染）────────────────────────── */
function renderSongWall() {
  const wall = $('#songwall');
  /* 尾幕 40–46 首为同名主题歌的各段落，从 label 里取出段落标记以便区分 */
  const partOf = (s) => {
    const m = String(s.label || '').match(/《[^》]+》\s*（(.+?)）/);
    return m ? m[1] : '';
  };
  wall.innerHTML = D.songs.map(s => {
    /* 同名曲目（如尾幕主题歌各段、《等你回来》两版）才补段落标记。
       若 performer 里已含该标记，则不再重复提取。 */
    const sameName = D.songs.filter(x => x.name === s.name).length > 1;
    let part = '';
    if (sameName) {
      const m = String(s.label || '').match(/《[^》]+》\s*（(.+?)）/);
      part = m ? m[1] : '';
      /* performer 已含同样内容时不再重复 */
      if (part && String(s.performer || '').includes(part)) part = '';
    }
    return `
    <div class="songcard" data-goto-song="${s.no}" tabindex="0" role="button">
      <div class="no">曲目 ${String(s.no).padStart(2, '0')}</div>
      <div class="nm">《${esc(s.name)}》${part ? `<em class="nm-part">${esc(part)}</em>` : ''}</div>
      <div class="pf">${esc(s.performer || '')}</div>
      <div class="ac">${esc(ACT_LABELS[s.act] || '')}</div>
    </div>`;
  }).join('');
}
renderSongWall();

{
  const wall = $('#songwall');
  wall.addEventListener('click', (e) => {
    const c = e.target.closest('[data-goto-song]');
    if (c) jumpToSong(+c.dataset.gotoSong);
  });
  wall.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const c = e.target.closest('[data-goto-song]');
      if (c) { e.preventDefault(); jumpToSong(+c.dataset.gotoSong); }
    }
  });
}

/* ── 全剧曲目表（定稿「全剧曲目表」原表：幕次 / 序号 / 曲目名称 / 类型 / 演唱）── */
function renderSongTable() {
  const head = $('#songTableHead');
  const body = $('#songTableBody');
  const rows = (D.songTable || []);
  if (!head || !body || rows.length < 2) return;

  head.innerHTML = '<tr>' + rows[0].map(c => `<th scope="col">${esc(c)}</th>`).join('') + '</tr>';

  /* 定稿原表的「幕次」列只在每幕首行填写，这里按幕分组，用 rowspan 还原 */
  const groups = [];
  rows.slice(1).forEach(r => {
    const g = groups[groups.length - 1];
    if (!g || (r[0] && g.act !== r[0])) groups.push({ act: r[0] || '', rows: [r] });
    else g.rows.push(r);
  });

  body.innerHTML = groups.map(g => {
    const cells = g.rows.map((r, i) => {
      const [, no, name, kind, singer] = r;
      const actCell = i === 0 && g.act
        ? `<td class="ta-act" rowspan="${g.rows.length}">${esc(g.act)}</td>` : '';
      return `<tr>${actCell}
        <td class="ta-no"><a href="#" data-goto-song="${esc(no)}" title="跳到曲目 ${esc(no)}">${esc(no)}</a></td>
        <td class="ta-name">《${esc(name)}》</td>
        <td class="ta-kind">${esc(kind)}</td>
        <td class="ta-singer">${esc(singer)}</td>
      </tr>`;
    }).join('');
    return cells;
  }).join('');
}
renderSongTable();

{
  const body = $('#songTableBody');
  if (body) {
    body.addEventListener('click', (e) => {
      const a = e.target.closest('[data-goto-song]');
      if (a) { e.preventDefault(); jumpToSong(+a.dataset.gotoSong); }
    });
  }
}

/* ── 配乐试听（纯器乐 demo）───────────────────────────── */
{
  /* 剧目配乐样带：纯器乐，无唱词，不与曲目歌词挂钩 */
  const SCORING = [
    /* 文件名带 .web 后缀 = 网页压缩版（44.1kHz / 80kbps，体积比母版小 57%）。
       换文件名是为了绕开 CDN 与浏览器的旧缓存；母版仍在 git 历史里。
       v = 音频内容的 md5 前 10 位，改了音频必须同步改这里（见 AGENTS.md 缓存铁律）。 */
    { file: '扎西会议.web.mp3', name: '扎西誓师序曲', dur: '3:14', v: '33488830c0' },
    { file: '遇敌.web.mp3',     name: '遇敌',     dur: '3:08', v: 'f562f0d8ab' },
    { file: '渡江1.web.mp3',    name: '渡江 Ⅰ',   dur: '2:47', v: '2a0ea5df5e' },
    { file: '渡江2.web.mp3',    name: '渡江 Ⅱ',   dur: '2:52', v: '147f19ead3' },
    { file: '等你回来（乐思）.web.mp3', name: '等你回来（乐思）', dur: '3:28', v: '8e368e4798' },
    { file: '山河之光.web.mp3', name: '山河之光', dur: '3:19', v: 'f2d56c1c50' },
    { file: '红军是什么队伍.web.mp3', name: '红军是什么队伍', dur: '0:53', v: '807f16b982' },
    { file: '火塘恋.web.mp3', name: '火塘恋', dur: '3:22', v: '6610310549' },
  ];

  const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    // 四舍五入而非向下取整：floor 会让显示始终慢半秒，看着像"播放很慢"
    const s = Math.round(sec % 60);
    return s === 60
      ? `${m + 1}:00`
      : `${m}:${String(s).padStart(2, '0')}`;
  };

  const list = $('#scoringList');
  if (list) {
    /* ⚠️ preload="none"：页面打开时**一张音频都不下载**。
       上一版是 preload="metadata"，7 首曲子会同时各拉一段元数据，
       等于页面一打开就有 7 条连接在抢带宽 → 真正要点播时反而慢。
       ⚠️ crossorigin="anonymous"：跨站取音频时必须带上，
       否则浏览器按「不透明响应」处理，拖进度条会失败（实测拖了就断）。 */
    list.innerHTML = SCORING.map(s => `
      <div class="scoring-item" data-file="${esc(s.file)}">
        <button class="scoring-play" type="button"
                aria-label="播放《${esc(s.name)}》">▶</button>
        <div class="scoring-name">${esc(s.name)}</div>
        <div class="scoring-bar" role="slider" tabindex="0"
             aria-label="《${esc(s.name)}》播放进度"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="scoring-track"><div class="scoring-fill"></div></div>
          <div class="scoring-knob"></div>
        </div>
        <div class="scoring-time"><span class="scoring-cur">0:00</span> / <span class="scoring-total">${esc(s.dur)}</span></div>
        <div class="scoring-load" aria-hidden="true"><i></i><span></span></div>
        <audio preload="none" crossorigin="anonymous"
               src="assets/audio/${encodeURIComponent(s.file)}?v=${esc(s.v)}"></audio>
      </div>`).join('');

    /* ── 单曲播放：任意时刻只允许一条在放（新的自动打断旧的）── */
    const rows = [...list.querySelectorAll('.scoring-item')];
    let current = null;      // 当前正在播放的 audio

    /* 文件名 → 行的映射（避免用 CSS.escape 处理中文文件名） */
    const rowOf = new Map();
    rows.forEach(row => rowOf.set(row.dataset.file, row));

    /* ── 线路 ──────────────────────────────────────────────
       分两组，因为两类线路的脾气不一样：

       ① 直接播（<audio> 直接指向它）
          必须支持 Range（服务器回 206），否则**拖进度条会直接断流**。
          jsDelivr / GitHub Pages / raw.githubusercontent 都实测支持。
       ② 整首下载（后台并行分块下整首，存成内存 Blob）
          哪条快用哪条；Cloudflare Pages 虽然不支持 Range，
          但它国内线路稳，可以进这一组做兜底。 */
    const STREAM_LINES = [
      /* ① 同源：就在本站旁边，不用猜它在不在、不会 404，最稳 */
      (f, v) => `assets/audio/${encodeURIComponent(f)}?v=${v}`,
      /* ② jsDelivr 自带中国 CDN，国内拉得最快 */
      (f, v) => `https://cdn.jsdelivr.net/gh/zhouyaobai/shanhe-baiduren@main/shanhe/assets/audio/${encodeURIComponent(f)}?v=${v}`,
      /* ③ GitHub Pages 显式地址（站点就托管在这儿） */
      (f, v) => `https://zhouyaobai.github.io/shanhe-baiduren/shanhe/assets/audio/${encodeURIComponent(f)}?v=${v}`,
      /* ④ raw.githubusercontent：最后一道保险 */
      (f, v) => `https://raw.githubusercontent.com/zhouyaobai/shanhe-baiduren/main/shanhe/assets/audio/${encodeURIComponent(f)}?v=${v}`,
    ];
    const DOWNLOAD_LINES = [
      ...STREAM_LINES,
      /* Cloudflare Pages：国内线路比 GitHub Pages 稳，但不支持 Range */
      (f, v) => `https://shanhe-baiduren.pages.dev/shanhe/assets/audio/${encodeURIComponent(f)}?v=${v}`,
    ];

    const engine = new AudioEngine({
      sources: (file) => {
        const item = SCORING.find(x => x.file === file);
        const v = item ? item.v : '';
        return DOWNLOAD_LINES.map(m => m(file, v));
      },
      onProgress: (file, info) => {
        const row = rowOf.get(file);
        if (!row) return;
        const bar = row.querySelector('.scoring-load');
        bar.querySelector('i').style.width = (info.ratio * 100).toFixed(1) + '%';
        bar.querySelector('span').textContent = info.total
          ? `整首缓存 ${Math.round(info.ratio * 100)}%`
          : '整首缓存中…';
      },
      onStage: (file, stage) => {
        const row = rowOf.get(file);
        if (!row) return;
        const bar = row.querySelector('.scoring-load');
        if (stage === 'ready' || stage === 'cached') {
          bar.querySelector('i').style.width = '100%';
          bar.querySelector('span').textContent = '';
          row.classList.remove('downloading');
        } else if (stage === 'downloading') {
          row.classList.add('downloading');
          bar.querySelector('i').style.width = '0%';
          bar.querySelector('span').textContent = '整首缓存中…';
        }
      },
    });

    /* 某首曲子的候选线路（绝对地址） */
    const streamLines = (file) => {
      const item = SCORING.find(x => x.file === file);
      const v = item ? item.v : '';
      const out = STREAM_LINES.map(m => {
        const u = m(file, v);
        try { return new URL(u, location.href).href; } catch (_) { return u; }
      });
      return [...new Set(out)];
    };

    /* ── 换源并续播：记住位置，等 metadata 到位后跳回去 ──── */
    const setSource = (audio, src) => {
      if (!src) return;
      const at = audio.currentTime || 0;
      if (audio.getAttribute('src') !== src) {
        audio.setAttribute('src', src);
        if (at > 0) audio.dataset.resumeAt = String(at);
      }
      audio.play().catch(() => {});
    };

    /* 换成内存版（整首已在本地）：彻底不碰网络，拖进度条也稳 */
    const useBlob = (audio, url) => {
      audio.__blobUrl = url;
      audio.__triedBlob = true;
      setSource(audio, url);
    };

    /* ── 卡顿看门狗 ────────────────────────────────────────
       判断「卡住」不能只看播放位置：缓冲还在涨说明只是慢、不是断流，
       这时换线路等于前功尽弃。所以规则是——
         · 已经出声：播放位置**和**缓冲都不动，超过 4 秒才换；
         · 还没出声：缓冲在涨就继续等，超过 7 秒还没第一声才换。
       这就是「关键时刻换播放方案」：不用用户重按，自动接上。 */
    const STALL_MS = 4000;
    const FIRST_SOUND_MS = 7000;
    let watchdog = null;
    const stopWatchdog = () => { if (watchdog) { clearInterval(watchdog); watchdog = null; } };

    const armWatchdog = (audio) => {
      stopWatchdog();
      /* 状态挂在 audio 上，换线路时才能一起重置 */
      const st = {
        lastT: audio.currentTime || 0,
        lastBuf: audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0,
        lastAdvance: Date.now(),
        startAt: Date.now(),
      };
      audio.__wd = st;
      watchdog = setInterval(() => {
        if (audio !== current || !audio.__live) { stopWatchdog(); return; }
        const t = audio.currentTime || 0;
        const buf = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
        /* 用户自己按了暂停，不算卡 */
        if (audio.__userPaused) { st.lastT = t; st.lastAdvance = Date.now(); st.lastBuf = buf; return; }
        /* 已经出声：播放位置在推进就算正常 */
        if (audio.__started && t > st.lastT + 0.05) {
          st.lastT = t; st.lastAdvance = Date.now(); st.lastBuf = buf; return;
        }
        /* 缓冲还在涨 → 只是在下载，只是慢，别换。
           ⚠️ lastBuf 必须每轮都更新：否则"曲子已下完、播放位置却卡住"
              会被误判成"还在下载"，看门狗就永远不换线了。 */
        const grew = buf > st.lastBuf + 1;
        st.lastBuf = Math.max(st.lastBuf, buf);
        if (grew) { st.lastAdvance = Date.now(); return; }
        if (!audio.__started) {
          /* 还没出声：7 秒还等不到第一声就换线路（缓冲一直没涨才算数） */
          if (Date.now() - st.startAt >= FIRST_SOUND_MS) {
            st.startAt = Date.now();
            switchLine(audio);
          }
          return;
        }
        if (Date.now() - st.lastAdvance >= STALL_MS) {
          st.lastAdvance = Date.now();
          st.lastT = t;
          switchLine(audio);
        }
      }, 1000);
    };

    /* 换到下一条线路，位置不丢，接着播 */
    const switchLine = (audio) => {
      if (!audio.__live) return;
      const lines = audio.__lines || [];
      if (!lines.length) return;
      let next;
      if (!audio.__triedBlob && audio.__blobUrl) {
        next = audio.__blobUrl;          // 本地内存版最稳，优先用
        audio.__triedBlob = true;
      } else {
        audio.__line = (audio.__line + 1) % lines.length;
        next = lines[audio.__line];
      }
      /* 换线后重新计时：新线路也要有自己的宽限期，
         不然会连着把后面的好线路也跳过去。 */
      if (audio.__wd) {
        audio.__wd.startAt = Date.now();
        audio.__wd.lastAdvance = Date.now();
        audio.__wd.lastBuf = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
        audio.__wd.lastT = audio.currentTime || 0;
      }
      setSource(audio, next);
      const row = audio.closest('.scoring-item');
      if (row) row.classList.add('loading');
    };

    /* ── 线路彻底断了 → 立刻换下一条 ─────────────────────
       error 事件不会冒泡，所以用捕获阶段监听。
       每失败一次只换一次，不会连着把好线路也跳过去。 */
    list.addEventListener('error', (e) => {
      const a = e.target;
      if (a.tagName !== 'AUDIO') return;
      if (!a.__live) return;
      switchLine(a);
    }, true);

    const resetRow = (row) => {
      const btn = row.querySelector('.scoring-play');
      row.querySelector('.scoring-fill').style.width = '0%';
      row.querySelector('.scoring-knob').style.left = '0%';
      row.querySelector('.scoring-cur').textContent = '0:00';
      row.querySelector('.scoring-bar').setAttribute('aria-valuenow', '0');
      const load = row.querySelector('.scoring-load');
      if (load) {
        load.querySelector('i').style.width = '0%';
        load.querySelector('span').textContent = '';
      }
      btn.classList.remove('playing');
      btn.textContent = '▶';
      row.classList.remove('playing');
      row.classList.remove('loading');
      row.classList.remove('downloading');
    };

    /* 只停掉真正在播（或已加载）的条目。
       ⚠️ 对 readyState=0 的音频写 currentTime 会强制触发下载，
                快速切歌时会把所有曲目都拉下来（26MB），这是之前卡顿的主因。
       ⚠️ 关键顺序：**先作废令牌，再 pause()**。
          play() 尚未兑现时被 pause() 会以 AbortError reject，
          但令牌已作废 → 该 rejection 被忽略，不会污染当前状态；
          而音频确实被停住了，不会出现多轨齐鸣。 */
    const stopAll = (except) => {
      stopWatchdog();
      rows.forEach(row => {
        if (row === except) return;
        const a = row.querySelector('audio');
        if (a) {
          a.__token = (a.__token || 0) + 1;   // 先作废，令旧回调失效
          a.__pending = false;
          a.__live = false;
          a.__userPaused = false;
          a.pause();
          if (a.readyState > 0) a.currentTime = 0;   // 仅已加载的才归零
        }
        resetRow(row);
      });
    };

    const paint = (row, audio) => {
      const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const pct = dur ? (audio.currentTime / dur) * 100 : 0;
      row.querySelector('.scoring-fill').style.width = pct + '%';
      row.querySelector('.scoring-knob').style.left = pct + '%';
      // 始终显示时间：缓冲状态由样式（光环/扫光）表达，
      // 不用文字替换，否则恢复事件没触发时文字会永久卡住。
      row.querySelector('.scoring-cur').textContent = fmt(audio.currentTime);
      row.querySelector('.scoring-bar').setAttribute('aria-valuenow', Math.round(pct));
    };

    /* ── 缓冲指示：waiting（缓冲耗尽）/ playing（恢复） ──
       ⚠️ 这里绝不能主动 pause() 音频。
       之前加的"缓冲守护"要求缓冲满 8 秒才恢复播放，
       但线上下载速度约 1.3 秒音频 / 0.7 秒真实时间，
       永远追不上 8 秒门槛 → 播放被永久暂停在"缓冲中"。
       正确做法：只提示状态，播放节奏交给浏览器自己管。 */
    list.addEventListener('waiting', (e) => {
      const a = e.target;
      if (a.tagName !== 'AUDIO') return;
      const row = a.closest('.scoring-item');
      if (row && a === current) {
        /* 只加样式状态，不改文字。
           文字若改成"缓冲中"，一旦恢复事件没触发就会永久卡住。
           样式（呼吸光环 + 扫光）已经足够表达"在缓冲"。 */
        row.classList.add('loading');
      }
    }, true);

    list.addEventListener('playing', (e) => {
      const a = e.target;
      if (a.tagName !== 'AUDIO') return;
      const row = a.closest('.scoring-item');
      if (!row) return;
      row.classList.remove('loading');
      /* 真的出声了 —— 界面状态跟着事件走，不跟着"发起播放"走。
         （换线路、换源、缓冲恢复都会重新触发 playing） */
      a.__started = true;
      if (a.__live) {
        const btn = row.querySelector('.scoring-play');
        btn.classList.add('playing');
        btn.textContent = '❚❚';
        row.classList.add('playing');
      }
      paint(row, a);
    }, true);

    /* canplay 只在首次就绪时触发，断流恢复时不会再触发，
       所以恢复显示主要靠 timeupdate（下面）。这里仅作首次兜底。 */
    list.addEventListener('canplay', (e) => {
      const a = e.target;
      if (a.tagName !== 'AUDIO') return;
      const row = a.closest('.scoring-item');
      if (row && a === current) {
        row.classList.remove('loading');
        paint(row, a);
      }
    }, true);

    /* 总时长以**音频文件里的真实 duration** 为准。
       之前是写死在 SCORING 表里的常量，其中好几条和实际文件对不上
       （例如《山河之光》写 7:37，文件实际 3:19）——
       进度条按真实 duration 走、右边文字按写死值显示，两边对不上，
       用户看着就像"进度条卡住了/跳得不对"。 */
    list.addEventListener('loadedmetadata', (e) => {
      const a = e.target;
      if (a.tagName !== 'AUDIO') return;
      const row = a.closest('.scoring-item');
      if (!row) return;
      const total = row.querySelector('.scoring-total');
      if (total && isFinite(a.duration) && a.duration > 0) {
        total.textContent = fmt(a.duration);
      }
      /* 换源（直连 → 内存 Blob）后播放位置会复位，这里跳回去 */
      const resume = parseFloat(a.dataset.resumeAt);
      if (isFinite(resume) && resume > 0 && isFinite(a.duration) && a.duration > 0) {
        a.currentTime = Math.min(resume, Math.max(0, a.duration - 0.1));
        delete a.dataset.resumeAt;
      }
      /* 用户在元数据到位之前点了进度条 → 跳到对应位置 */
      const target = parseFloat(a.dataset.seekTo);
      if (isFinite(target) && isFinite(a.duration) && a.duration > 0) {
        a.currentTime = target * a.duration;
        delete a.dataset.seekTo;
      }
    }, true);

    /* ── 进度刷新：用 timeupdate（浏览器原生节流），
          不用 requestAnimationFrame —— 后者在滚动/后台会被降频，
          表现为进度条卡住不动 ──
          顺带在这里恢复"缓冲中"的显示：
          只要播放位置在推进，就说明缓冲已恢复、可以正常播了。 */
    list.addEventListener('timeupdate', (e) => {
      const a = e.target;
      if (a.tagName !== 'AUDIO') return;
      const row = a.closest('.scoring-item');
      if (!row) return;
      if (row.classList.contains('loading')) {
        row.classList.remove('loading');
      }
      paint(row, a);
    }, true);

    list.addEventListener('click', (e) => {
      /* 进度条：点击跳转 */
      const bar = e.target.closest('.scoring-bar');
      if (bar) {
        const row = bar.closest('.scoring-item');
        const audio = row.querySelector('audio');
        const rect = bar.getBoundingClientRect();
        const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);

        if (isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = ratio * audio.duration;
          paint(row, audio);
        } else {
          /* 还没加载 → 先记录目标位置，加载完自动跳过去。
             ⚠️ 直接写 currentTime 会触发整首重新下载，用户体验就是"卡住"。 */
          audio.dataset.seekTo = String(ratio);
          row.classList.add('loading');
        }
        return;
      }

      /* 播放键：切换 */
      const btn = e.target.closest('.scoring-play');
      if (!btn) return;
      const row = btn.closest('.scoring-item');
      const audio = row.querySelector('audio');

      if (current === audio && !audio.paused) {
        /* 再次点击当前这条 → 暂停 */
        audio.__userPaused = true;
        audio.pause();
        btn.classList.remove('playing');
        btn.textContent = '▶';
        row.classList.remove('playing');
        row.classList.remove('loading');
        return;
      }

      /* 打断其它正在播放的 —— 自动互斥 */
      stopAll(audio);

      const file = row.dataset.file;

      /* 播放令牌：快速连点时，上一条的 play() 可能还没兑现就被中断，
         它的回调必须不能影响当前这条的状态。 */
      const token = (audio.__token = (audio.__token || 0) + 1);
      audio.__pending = true;                       // 标记"播放请求在飞"
      audio.__live = true;
      audio.__userPaused = false;
      audio.__started = false;
      audio.__triedBlob = false;
      audio.__blobUrl = null;
      audio.__lines = streamLines(file);
      audio.__line = 0;

      /* 用户要看这一首 → 别的曲子的后台下载立刻让路，别抢带宽 */
      engine.cancelExcept(file);

      /* 这一首现在归我管：看门狗从**发起播放**就开始盯，
         不等真正出声 —— 上一版等出声后才盯，线路卡死时没人救场。 */
      current = audio;
      armWatchdog(audio);

      /* ① 缓存里有 → 直接播内存里的整首：零网络、绝对不卡、拖条也稳 */
      engine.cacheHit(file).then((hit) => {
        if (!hit || audio.__token !== token) return;
        audio.__blobUrl = hit.url;
        audio.__triedBlob = true;
        if (!audio.__started) useBlob(audio, hit.url);
      }).catch(() => {});

      /* ② 没有缓存 → 先流式播第一条线路：第一秒就有声。
         ⚠️ play() 必须在用户手势的**同一个任务**里调用，
            放到 await 之后会被浏览器当成"没有用户操作"而拦下自动播放。 */
      setSource(audio, audio.__lines[0]);

      /* ③ 后台并行分块把整首下下来（8 块同时下 = 8 倍速度）。
         下完存进缓存 → 这一首从此零网络；中途卡住也有内存版兜底。 */
      engine.blobOf(file).then((blob) => {
        if (!blob || audio.__token !== token) return;
        const url = URL.createObjectURL(blob);
        audio.__blobUrl = url;
        audio.__triedBlob = true;
        /* 切到内存版：位置保留，此后再不碰网络 —— 不卡、拖条也稳。
           切换只有几十毫秒，听不出来。 */
        useBlob(audio, url);
      }).catch(() => {});
    });

    /* 键盘：进度条左右键快进 / 快退 */
    list.addEventListener('keydown', (e) => {
      const bar = e.target.closest('.scoring-bar');
      if (!bar) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const row = bar.closest('.scoring-item');
      const audio = row.querySelector('audio');
      if (!isFinite(audio.duration)) return;
      audio.currentTime = Math.min(Math.max(
        audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5), 0), audio.duration);
      paint(row, audio);
    });

    /* 播完复位 */
    list.addEventListener('ended', (e) => {
      const a = e.target;
      if (a.tagName !== 'AUDIO') return;
      const row = a.closest('.scoring-item');
      a.currentTime = 0;
      resetRow(row);
      if (current === a) current = null;
    }, true);
  }
}

/* ── 人物 ──────────────────────────────────────────────── */
{
  const rows = D.charTable.slice(1);
  $('#castGrid').innerHTML = rows.map((r, i) => `
    <article class="person">
      <div class="person-tag">${esc(r[0].slice(0, 1))}</div>
      <h3 class="person-role">${esc(r[0])}</h3>
      <p class="person-desc">${esc(r[1])}</p>
    </article>`).join('');
}

/* ── 伏笔 ──────────────────────────────────────────────── */
{
  $('#threadList').innerHTML = D.threads.map(t => `
    <article class="thread">
      <div class="thread-name">
        <span class="thread-chip" style="background:${esc(t.color)}"></span>
        ${esc(t.name)}
      </div>
      <dl class="thread-col"><dt>埋 下</dt><dd>${esc(t.plant)}</dd></dl>
      <dl class="thread-col"><dt>兑 现</dt><dd>${esc(t.pay)}</dd></dl>
      <p class="thread-note">${esc(t.note)}</p>
    </article>`).join('');
}

/* ── 唱段展开 ──────────────────────────────────────────── */
document.addEventListener('click', (e) => {
  const head = e.target.closest('.song-head');
  if (!head) return;
  const song = head.parentElement;
  const open = song.classList.toggle('open');
  head.setAttribute('aria-expanded', String(open));
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const head = e.target.closest('.song-head');
  if (!head) return;
  e.preventDefault();
  const song = head.parentElement;
  const open = song.classList.toggle('open');
  head.setAttribute('aria-expanded', String(open));
});

/* ── 跳转 ──────────────────────────────────────────────── */
function gotoAct(i) {
  const el = document.getElementById('act-' + i);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function jumpToSong(no) {
  const el = document.querySelector(`.song[data-song="${no}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const head = el.querySelector('.song-head');
  if (!el.classList.contains('open')) {
    el.classList.add('open');
    head.setAttribute('aria-expanded', 'true');
  }
}

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) {
    const t = document.querySelector(g.dataset.goto);
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

/* ── 幕次轨 + 顶栏 ─────────────────────────────────────── */
{
  const rail = $('#rail');
  rail.innerHTML = D.acts.map((a, i) => {
    const sub = (a.title.split('：')[1] || '').trim();
    return `
    <button class="rail-item" data-act="${i}" title="${esc(a.title)}">
      <span class="rail-no">${esc(ACT_LABELS[i])}</span>
      ${sub ? `<span class="rail-sub">${esc(sub)}</span>` : ''}
    </button>
    ${i < D.acts.length - 1 ? '<div class="rail-sep" aria-hidden="true"></div>' : ''}`;
  }).join('');

  rail.addEventListener('click', (e) => {
    const b = e.target.closest('.rail-item');
    if (b) gotoAct(+b.dataset.act);
  });

  // 导航渲染 + 滚动高亮（可重入：解锁成功后重跑，剧本指向正文）
  function renderTopNav() {
    const nav = $('#topnav');
    const unlocked = document.body.classList.contains('unlocked');
    const scriptTarget = unlocked ? '#acts' : '#gate';
    nav.innerHTML = [
      ['#mainline', '主线'],
      [scriptTarget, '剧本'],
      ['#songs', '歌单'],
      ['#songtable', '曲目表'],
      ['#scoring', 'DEMO'],
      ['#cast', '人物'],
      ['#threads', '伏笔'],
    ].map(([h, t]) => `<a href="${h}" data-nav="${h}">${t}</a>`).join('');

    // 滚动高亮：观察的必须是**区块本身**（.band[id]），不是导航链接。
    const navLinks = $$('#topnav [data-nav]');
    const sections = navLinks
      .map(a => document.getElementById(a.dataset.nav.slice(1)))
      .filter(Boolean);
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          navLinks.forEach(a => a.classList.toggle('on', a.dataset.nav === '#' + en.target.id));
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(s => obs.observe(s));
  }
  renderTopNav();
  window.renderTopNav = renderTopNav;

  const acts = $$('.act');
  const railItems = $$('.rail-item');
  const actObs = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        const i = +en.target.dataset.act;
        railItems.forEach(b => b.classList.toggle('on', +b.dataset.act === i));
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  acts.forEach(a => actObs.observe(a));
}

/* ── 3D 场景随滚动淡出 ────────────────────────────────── */
if (stage) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.target.id === 'hero') stage.setVisible(en.isIntersecting);
    });
  }, { threshold: 0.02 });
  io.observe($('#hero'));
}

/* ── 破晓提示：一旦开始拖动就淡出 ─────────────────────── */
(() => {
  const hint = $('#dragHint');
  if (!hint) return;
  let gone = false;
  const hide = () => {
    if (gone) return;
    gone = true;
    hint.classList.add('is-gone');
  };
  window.addEventListener('shanhe:dawn', (e) => {
    const d = e.detail?.dawn ?? 0;
    if (d > 0.04) hide();
    // 破晓过半时加深标题背后的暗角
    document.body.classList.toggle('is-dawn', d > 0.42);
  });
  window.addEventListener('pointerdown', (e) => {
    if (e.clientY < window.innerHeight) hide();
  }, { once: true });
})();

/* ── 打印时展开全部唱段 ────────────────────────────────── */
window.addEventListener('beforeprint', () => {
  $$('.song').forEach(s => s.classList.add('open'));
});

/* ============================================================
   剧本阅读权限门
   公开可见：剧目概况（幕头/幕内资料）、主线、歌单目录、人物、伏笔
   需密码  ：六幕剧本正文（台词/舞台提示/歌词）

   剧透正文在 data.js 中以 AES-256-GCM 密文存储，
   只有输入正确密码才能在浏览器端解密还原；
   直接查看网页源码只能得到 base64 密文。
   ============================================================ */
(() => {
  const KEY = 'shb_read_ok';
  const body = document.body;
  const form = $('#gateForm');
  const input = $('#gateInput');
  const msg = $('#gateMsg');

  const showMsg = (text, ok) => {
    if (!msg) return;
    msg.textContent = text;
    msg.classList.toggle('ok', !!ok);
  };

  /* 把解密出的正文合并进公开层数据 */
  function mergeSecret(payload) {
    // 1. 六幕正文块：按 act 序号回填
    const byAct = {};
    (payload.acts || []).forEach(x => { byAct[x.act] = x.blocks || []; });
    D.acts.forEach((a, i) => {
      if (byAct[i]) a.blocks = byAct[i];
    });
    // 2. 歌词与唱段有序流：按曲目号回填
    const bySong = {};
    (payload.songs || []).forEach(x => { bySong[x.no] = x; });
    D.songs.forEach(s => {
      const sec = bySong[s.no];
      if (!sec) return;
      if (sec.lyrics) s.lyrics = sec.lyrics;
      if (sec.items) s.items = sec.items;
      if (sec.stage) s.stage = sec.stage;
    });
    reindexSongs();
  }

  /* 解锁：解密 → 合并 → 重渲染 */
  async function unlock(password) {
    if (!SECRET) { showMsg('本站未启用加密内容，请刷新重试'); return false; }
    try {
      const payload = await decryptSecret(password, SECRET.iv, SECRET.cipher);
      mergeSecret(payload);
      renderActs();
      renderSongWall();
      if (typeof setupReveal === 'function') setupReveal();
      body.classList.add('unlocked');
      try { sessionStorage.setItem(KEY, '1'); } catch {}
      if (typeof renderTopNav === 'function') renderTopNav();
      showMsg('已解锁 · 全本剧本正文与歌词现已展开', true);
      setTimeout(() => showMsg(''), 2800);
      const first = document.querySelector('.act');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    } catch (e) {
      console.warn('解密失败:', e);
      showMsg('密码不正确，请向主创团队索取');
      if (input) input.select();
      return false;
    }
  }

  /* 刷新页面时用 sessionStorage 里的标记重试解密（密码未存，仅存解锁态） */
  async function restore() {
    let ok = false;
    try { ok = sessionStorage.getItem(KEY) === '1'; } catch {}
    if (!ok) return;
    // 重新提示输入密码（密文需密码才能解密，标记只省一次点击）
    body.classList.remove('unlocked');
  }

  body.classList.remove('unlocked');
  restore();

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = String(input.value || '').trim();
      if (!v) { showMsg('请输入阅读密码'); return; }
      showMsg('正在解密…');
      const ok = await unlock(v);
      if (ok && input) input.value = '';
    });
  }

  /* 未解锁时，歌单目录不可点（跳转到歌词） */
  document.addEventListener('click', (e) => {
    if (body.classList.contains('unlocked')) return;
    const c = e.target.closest('[data-goto-song]');
    if (c) {
      e.preventDefault();
      e.stopPropagation();
      showMsg('完整唱段歌词需凭阅读密码查看');
    }
  }, true);
})();

/* ============================================================
   入场淡入：滚到视口才浮现（只用 transform / opacity）
   —— 解锁后剧目区会重渲染，故做成可重入
   ============================================================ */
let revealObserver = null;

function setupReveal() {
  const targets = [
    ...document.querySelectorAll('.act-head, .act-meta, .fact-card, .roll-card, .scene, .song'),
    ...document.querySelectorAll('.songcard, .person, .thread, .spine-item, .scoring-item'),
  ];

  /* 同一容器内的兄弟元素依次延迟 */
  const groups = new Map();
  targets.forEach(el => {
    const parent = el.parentElement;
    if (!parent) return;
    const idx = groups.get(parent) || 0;
    el.dataset.revealDelay = String(Math.min(idx, 6) * 60);
    groups.set(parent, idx + 1);
  });

  targets.forEach(el => el.classList.add('reveal'));

  if (revealObserver) revealObserver.disconnect();
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target;
      setTimeout(() => el.classList.add('in'), Number(el.dataset.revealDelay || 0));
      revealObserver.unobserve(el);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });

  targets.forEach(el => revealObserver.observe(el));

  /* 初始视口内的立即显示，不等滚动 */
  requestAnimationFrame(() => {
    document.querySelectorAll('.reveal').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) {
        setTimeout(() => el.classList.add('in'), Number(el.dataset.revealDelay || 0));
      }
    });
  });
}

setupReveal();




