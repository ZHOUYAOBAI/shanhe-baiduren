/* ============================================================
   剧本站 · 渲染与交互
   ------------------------------------------------------------
   数据来源：
     window.SCRIPT        公开层（剧目概况 / 曲目目录 / 人物 / 伏笔）
     window.SCRIPT_SECRET 受限层（幕正文 + 全部歌词，AES-256-GCM 密文）
   解锁后由 mergeSecret() 把受限层并入，再重绘受影响的区块。
   ============================================================ */
import { createStage, readPalette } from './scene.js?v=a1b2c3d4';
import { decryptSecret, isCryptoAvailable } from './crypto.js?v=a1b2c3d4';

let D = window.SCRIPT || {};
const SECRET = window.SCRIPT_SECRET || null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const has = (v) => Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());

/* ── 状态 ─────────────────────────────────────────────── */
let unlocked = false;
const songByNo = {};
D.songs = D.songs || [];
D.songs.forEach((s) => { songByNo[s.no] = s; });

function reindexSongs() {
  for (const k of Object.keys(songByNo)) delete songByNo[k];
  (D.songs || []).forEach((s) => { songByNo[s.no] = s; });
}

/* ══ 3D / 程序化场景 ═══════════════════════════════════ */
let stage = null;
try {
  stage = createStage($('#stage'), {
    scene: (D.cover && D.cover.scene) || 'mountain',
    seed: (D.cover && D.cover.name) || 'stage',
  });
} catch (e) {
  const c = $('#stage');
  if (c) c.style.display = 'none';
  console.warn('场景不可用，降级为纯色底：', e);
}

/* 幕次单位：全部以「第X场」命名的剧本（场次制）用「场」，否则用「幕」；
   site_meta 的 cover.unit 可显式覆盖 */
function actUnit() {
  const c = D.cover || {};
  if (c.unit) return c.unit;
  const acts = D.acts || [];
  return acts.length && acts.every((a) =>
    /^第[一二三四五六七八九十\d]+\s*场/.test(String(a.title || ''))) ? '场' : '幕';
}

/* ══ HERO ═══════════════════════════════════════════════ */
function renderHero() {
  const c = D.cover || {};
  if (has(c.kicker)) $('#heroKicker').textContent = c.kicker;
  const title = has(c.name) ? c.name : (D.acts && D.acts.length ? D.acts[0].title : '');
  const titleEl = $('#heroTitle');
  /* 标题按「·」断成两行（「百年星语·」/「破晓1928」）。
     间隔号落到下一行行首是排版大忌，而中文可以在任意字间断行，
     光靠 CSS 拦不住 —— 只能在这里显式分行。
     每行各自带 data-text，立体挤出层逐行复制字形，深度才对得上。 */
  const raw = String(title);
  const cut = raw.indexOf('·');
  const lines = cut > 0 ? [raw.slice(0, cut), raw.slice(cut + 1)] : [raw];
  titleEl.innerHTML = lines.map((t, i) => {
    /* 间隔号单独提出来，用宋体的「·」—— 毛笔字的间隔号落在字脚，
       像一粒墨点；换成朱砂的宋体点，才是个有意为之的标点。 */
    const dot = (i === 0 && cut > 0) ? '<span class="tdot">·</span>' : '';
    return `<span class="hero-title-line" data-text="${esc(t)}">${esc(t)}${dot}</span>`;
  }).join('');
  /* 挤出层是伪元素，会被读屏重复念三遍；标题只保留一份可读名称 */
  const titleWrap = $('#heroTitleWrap');
  if (titleWrap) titleWrap.setAttribute('aria-label', title);
  const seal = has(c.seal) ? c.seal : String(title).trim().charAt(0);
  $('#heroSeal').textContent = seal;
  $('#brandSeal').textContent = seal;
  if (has(c.theme)) $('#heroSub').textContent = c.theme;

  const meta = [];
  if (has(c.span)) meta.push(c.span);
  if (has(D.acts) && D.acts.length) meta.push(`${D.acts.length} ${actUnit()}`);
  if (has(D.songs) && D.songs.length) meta.push(`${D.songs.length} 首曲目`);
  $('#heroMeta').innerHTML = meta.map((t) => `<span>${esc(t)}</span>`).join('');

  const credits = [];
  if (has(c.author)) credits.push(`编剧：${c.author}`);
  if (has(c.music)) credits.push(`音乐：${c.music}`);
  if (has(c.director)) credits.push(`导演：${c.director}`);
  if (credits.length) {
    $('#heroCredits').innerHTML = credits.map((t) => `<span>${esc(t)}</span>`).join('');
  }
  $('#heroCta').textContent = c.cta || '开演';
}

/* ══ 主线时间轴 ═════════════════════════════════════════ */
function renderSpine() {
  const tl = D.timeline || [];
  if (!tl.length) return;
  const s = (D.sections && D.sections.spine) || {};
  $('#mainline').hidden = false;
  $('#spineNum').textContent = s.num || '主 线';
  $('#spineTitle').textContent = s.title || (D.cover && D.cover.mainlineTitle) || '';
  $('#spineDesc').textContent = s.desc
    || ((D.cover && D.cover.mainline || []).join(' → '));

  const el = $('#spineItems');
  el.innerHTML = tl.map((t) => `
    <div class="spine-item" data-act="${t.act}" role="button" tabindex="0">
      <div class="spine-dot" aria-hidden="true"></div>
      <div class="spine-date">${esc(t.date)}</div>
      <div class="spine-label">${esc(t.label)}</div>
    </div>`).join('');

  const go = (e) => {
    const it = e.target.closest('.spine-item');
    if (it) gotoAct(+it.dataset.act);
  };
  el.addEventListener('click', go);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); }
  });
}

/* ══ 创作总纲（受限层）══════════════════════════════════ */
function frontTableHtml(t) {
  const head = (t.head || []).map((h) => `<th scope="col">${esc(h)}</th>`).join('');
  const body = (t.rows || []).map((r) =>
    `<tr>${(r || []).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  if (!head && !body) return '';
  return `<div class="front-table-wrap"><table class="front-table">`
    + `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
    + `<p class="table-hint">← 左右滑动可看全部栏位 →</p>`;
}

function frontCardHtml(c, i) {
  const tags = (c.tags || []).map((t) => `<span class="front-tag">${esc(t)}</span>`).join('');
  const paras = (c.paras || []).map((p) => `<p class="front-para">${esc(p)}</p>`).join('');
  const tables = (c.tables || []).map(frontTableHtml).join('');
  return `<details class="front-card${tables ? ' wide' : ''}" data-front="${i}"${i === 0 ? ' open' : ''}>
    <summary class="front-sum">
      <span class="front-idx" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
      <span class="front-ttl">${esc(c.title || '未命名')}</span>
      ${tags}
      <span class="front-caret" aria-hidden="true"></span>
    </summary>
    <div class="front-body">${paras}${tables}</div>
  </details>`;
}

function gotoFrontCard(i) {
  const el = document.querySelector(`.front-card[data-front="${i}"]`);
  if (!el) return;
  el.open = true;
  const y = el.getBoundingClientRect().top + window.scrollY - 24;
  window.scrollTo({ top: y, behavior: 'smooth' });
}

function renderFront() {
  const host = $('#front');
  if (!host) return;
  const f = D.front;
  const locked = !!(SECRET && !unlocked);
  const count = (f && f.cards && f.cards.length) || D.frontCount || 0;
  if (!f && !count) { host.hidden = true; return; }
  host.hidden = false;

  const s = (D.sections && D.sections.front) || {};
  $('#frontNum').textContent = s.num || '总 纲';
  $('#frontTitle').textContent = s.title || '创作总纲 · 戏核';
  $('#frontDesc').textContent = locked
    ? (s.lockedDesc || `本剧附有创作总纲 ${count} 项，含戏核、事件线、价值转折、意象回响、幕表与乐队编制。解锁后展开。`)
    : (s.desc || `创作手记 ${count} 项：戏核、事件线、价值转折、意象回响、幕表与乐队编制。点标题展开。`);

  const lead = $('#frontLead');
  const bar = $('#frontBar');
  const grid = $('#frontGrid');

  if (locked) {
    lead.hidden = true;
    bar.hidden = true;
    grid.innerHTML = `<div class="front-locked">
      <div class="front-locked-mark" aria-hidden="true">封</div>
      <p class="front-locked-text">总纲随全本剧本一同限阅。</p>
      <button type="button" class="front-locked-btn" data-goto-gate>输入密码展开 →</button>
    </div>`;
    return;
  }

  const hasLead = !!(f && f.lead && f.lead.length);
  lead.hidden = !hasLead;
  if (hasLead) lead.innerHTML = f.lead.map((x) => `<p>${esc(x)}</p>`).join('');

  bar.hidden = false;
  $('#frontCount').textContent = `${count} 项 · 点标题展开`;
  grid.innerHTML = ((f && f.cards) || []).map(frontCardHtml).join('');

  const toggle = $('#frontToggle');
  if (toggle) {
    toggle.onclick = () => {
      const cards = $$('.front-card', grid);
      const opened = cards.filter((c) => c.open).length;
      const next = opened < cards.length / 2;
      cards.forEach((c) => { c.open = next; });
      toggle.textContent = next ? '全部收起' : '全部展开';
    };
  }
}

/* ══ 幕次 ═══════════════════════════════════════════════ */
const ACT_LABELS = (D.actLabels && D.actLabels.length)
  ? D.actLabels
  : (D.acts || []).map((a, i) => `第${i + 1}幕`);

function actLabel(i) {
  return ACT_LABELS[i] || `第${i + 1}幕`;
}

function renderSongItems(items) {
  if (!items || !items.length) return '';
  let last = null;
  return items.map((it) => {
    if (it.k === 'ly') {
      const who = (it.speaker && it.speaker !== last)
        ? `<span class="who">${esc(it.speaker)}</span>` : '';
      if (it.speaker) last = it.speaker;
      const cue = it.cue ? `<span class="cue">${esc(it.cue)}</span>` : '';
      return `<p>${who}${cue}<span class="ly">${esc(it.text)}</span></p>`;
    }
    if (it.k === 'sec') {
      const t = String(it.v || '').trim();
      const inner = /^【(.+)】$/.exec(t);
      return `<p class="song-sec">${esc(inner ? inner[1] : t)}</p>`;
    }
    if (it.k === 'pt') return `<p class="song-part">${esc(it.v)}</p>`;
    if (it.k === 'cue') {
      return `<p class="song-stage">${esc(it.who ? it.who + '：' : '')}（${esc(it.v)}）</p>`;
    }
    return `<p class="song-stage">${esc(it.v)}</p>`;
  }).join('');
}

function renderSongCard(s, compact) {
  const items = s.items || null;
  const locked = SECRET && !unlocked && !items;
  const body = items ? renderSongItems(items)
    : `<p class="song-stage">${unlocked ? '暂无内容' : '正文与歌词需解锁后阅读。'}</p>`;
  return `
    <div class="song${compact ? '' : ''}" data-song="${s.no}">
      <button class="song-head" type="button" aria-expanded="false">
        <span class="song-no">${String(s.no).padStart(2, '0')}</span>
        <span class="song-name">${esc(s.name)}</span>
        <span class="song-perf">${esc(s.performer || '')}</span>
        <span class="song-caret" aria-hidden="true"></span>
      </button>
      <div class="song-body${locked ? ' locked' : ''}">${perfRow(s.performer)}${body}</div>
    </div>`;
}

function renderActs() {
  const host = $('#acts');
  if (!has(D.acts)) { host.innerHTML = ''; return; }

  const parts = [];
  D.acts.forEach((a, ai) => {
    const m = a.meta || {};
    const metaCells = [];
    if (has(m.time)) metaCells.push(`<div><dt>时 间</dt><dd>${esc(m.time)}</dd></div>`);
    if (has(m.place)) metaCells.push(`<div><dt>地 点</dt><dd>${esc(m.place)}</dd></div>`);
    if (has(m.cast)) metaCells.push(`<div><dt>人 物</dt><dd>${esc(m.cast)}</dd></div>`);
    if (has(m.duration)) metaCells.push(`<div><dt>时 长</dt><dd>${esc(m.duration)}</dd></div>`);

    const mood = has(m.mood)
      ? `<ul class="act-mood">${m.mood.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

    /* 正文块：解锁后用 fullBlocks，否则用公开 blocks */
    const blocks = a.fullBlocks || a.blocks || [];
    const songs = [];
    const body = [];

    blocks.forEach((b, bi_) => {
      if (b.k === 'scene') {
        const sm = b.meta || {};
        const extra = [sm.time, sm.place].filter(Boolean).map((x) => esc(x)).join(' · ');
        body.push(`<h3 class="scene">${esc(b.v)}${extra
          ? ` <span class="scene-meta">${extra}</span>` : ''}</h3>`);
      } else if (b.k === 'song') {
        const s = songByNo[b.v.no];
        if (s) songs.push(renderSongCard(s));
        else body.push(`<p class="stage-dir">曲目 ${b.v.no}《${esc(b.v.name)}》</p>`);
      } else if (b.k === 'dlg') {
        /* 台词前的括号动作（cue）要显示，否则剧本原文会缺一块 */
        const cue = b.v.cue ? `<span class="dlg-cue">（${esc(b.v.cue)}）</span>` : '';
        body.push(`<div class="dialogue" data-anchor="a${ai}b${bi_}" data-who="${esc(b.v.who)}"><div class="dlg-who">${esc(b.v.who)}</div>`
          + `<p class="dlg-text">${cue}${esc(b.v.text)}</p></div>`);
      } else if (b.k === 'beat') {
        body.push(`<p class="beat" data-who="${esc(b.v.who)}"><span class="beat-who">${esc(b.v.who)}</span>`
          + `${b.v.cue ? `（${esc(b.v.cue)}）` : ''}</p>`);
      } else if (b.k === 'sd') {
        body.push(`<p class="stage-dir" data-anchor="a${ai}b${bi_}">（${esc(b.v)}）</p>`);
      } else if (b.k === 'act' || b.k === 'note') {
        body.push(`<p class="stage-dir">${esc(b.v)}</p>`);
      }
    });

    const gateNote = (SECRET && !unlocked && !(a.fullBlocks || []).length)
      ? `<p class="body-note">本幕正文与唱段歌词仅供内部传阅。
         <button type="button" data-goto-gate>输入密码阅读全文 →</button></p>` : '';

    const html = `
      <section class="act" id="act-${ai}" data-act="${ai}">
        <div class="wrap wide">
          <div class="act-head">
            <div class="act-no">${esc(actLabel(ai))}</div>
            <h2 class="act-title">${esc(a.title)}</h2>
            ${metaCells.length ? `<dl class="act-meta">${metaCells.join('')}</dl>` : ''}
            ${mood}
          </div>
          ${gateNote}
          ${body.join('')}
          ${songs.length ? `<div class="songs-list">${songs.join('')}</div>` : ''}
        </div>
      </section>`;
    parts.push(html);
    parts.push(interludeHtml(a, ai));
  });
  host.innerHTML = parts.join('');

  bindSongHeads(host);
  initInterludes();
  initProgressTicks();
}

/* ══ 歌单墙 ═════════════════════════════════════════════ */
function renderSongWall() {
  if (!has(D.songs)) { $('#songs').hidden = true; return; }
  const s = (D.sections && D.sections.songs) || {};
  $('#songs').hidden = false;
  $('#songsNum').textContent = s.num || '歌 单';
  $('#songsTitle').textContent = s.title || `全剧${D.songs.length}首`;
  $('#songsDesc').textContent = s.desc || '点开任意一首，看它的完整歌词。';

  $('#songwall').innerHTML = D.songs.map((x) => `
    <button class="song-card tilt3d" type="button" data-goto-song="${x.no}" data-act="${x.act ?? 0}">
      <span class="sc-no">${String(x.no).padStart(2, '0')}</span>
      <span class="sc-name">${esc(x.name)}</span>
      <span class="sc-act">${esc(x.actTitle || actLabel(x.act || 0))}</span>
      <span class="sc-perf">${esc(x.performer || '')}</span>
      <span class="sc-jump" aria-hidden="true">↗</span>
    </button>`).join('');
}

/* ══ 曲目表 ═════════════════════════════════════════════ */
function renderSongTable() {
  const tbl = D.songTable || [];
  if (!has(tbl)) { $('#songtable').hidden = true; return; }
  const s = (D.sections && D.sections.table) || {};
  $('#songtable').hidden = false;
  $('#tableNum').textContent = s.num || '目 录';
  $('#tableTitle').textContent = s.title || '全剧曲目表';
  $('#tableDesc').textContent = s.desc || '幕次、体裁与演唱，一表全览。点序号可跳到该曲。';

  const head = (tbl[0] || []).map((h) => String(h).trim());
  $('#songTableHead').innerHTML = `<tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;

  /* 按表头认列：不同剧本的曲目表列序不同，不能写死下标 */
  const iNo = head.findIndex((h) => /编号|序号/.test(h));
  const iAct = head.findIndex((h) => /幕次|场次|^幕$/.test(h));
  const iName = head.findIndex((h) => /曲名|曲目名称|^名称$|^剧目$/.test(h));
  const noCol = iNo >= 0 ? iNo : 0;

  $('#songTableBody').innerHTML = tbl.slice(1).map((row) => {
    const no = parseInt(String(row[noCol] ?? '').replace(/[^0-9]/g, ''), 10);
    const s = songByNo[no];
    const act = s && typeof s.act === 'number' ? s.act : -1;
    const cells = row.map((c, i) => {
      if (i === noCol) return `<td class="st-no" data-goto-song="${no}">${esc(c)}</td>`;
      if (i === iAct && iAct >= 0) return `<td class="st-act">${esc(c)}</td>`;
      if (i === iName && iName >= 0) return `<td class="st-name">${esc(c)}</td>`;
      return `<td>${esc(c)}</td>`;
    });
    return `<tr data-act="${act}" data-no="${no}">${cells.join('')}</tr>`;
  }).join('');
}

/* ══ 配乐试听 ═══════════════════════════════════════════ */
function renderAudio() {
  const list = D.audio || [];
  if (!list.length) { $('#audio').hidden = true; return; }
  const s = (D.sections && D.sections.audio) || {};
  $('#audio').hidden = false;
  $('#audioNum').textContent = s.num || '配 乐';
  $('#audioTitle').textContent = s.title || `${list.length} 段`;
  $('#audioDesc').textContent = s.desc || '剧目配乐与唱段样带。';

  $('#audioList').innerHTML = list.map((a, i) => `
    <div class="audio-item" data-audio="${i}">
      <button class="audio-play" type="button" aria-label="播放 ${esc(a.title || '')}"></button>
      <div class="audio-meta">
        <div class="audio-name">${esc(a.title || '')}</div>
        ${(a.performer || a.note) ? `<div class="audio-sub">${esc(a.performer || a.note)}</div>` : ''}
      </div>
      <div class="audio-track"><i class="audio-fill"></i></div>
      <div class="audio-time">--:--</div>
    </div>`).join('');

  bindAudio();
}

function bindAudio() {
  const player = $('#player');
  if (!player) return;
  let current = null;

  const fmt = (sec) => {
    if (!isFinite(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  $$('.audio-item').forEach((item) => {
    const idx = +item.dataset.audio;
    const info = (D.audio || [])[idx];
    if (!info) return;
    item.querySelector('.audio-play').addEventListener('click', async () => {
      if (current === item) {
        if (player.paused) { await player.play(); } else { player.pause(); }
        return;
      }
      $$('.audio-item').forEach((x) => x.classList.remove('playing'));
      item.classList.add('playing');
      current = item;
      player.src = info.src;
      item.querySelector('.audio-time').textContent = '00:00';
      item.querySelector('.audio-time').classList.remove('audio-err');
      try {
        await player.play();
      } catch (e) {
        item.querySelector('.audio-time').textContent = '无法播放';
        item.querySelector('.audio-time').classList.add('audio-err');
      }
    });
  });

  player.addEventListener('timeupdate', () => {
    if (!current) return;
    const pct = player.duration ? (player.currentTime / player.duration) * 100 : 0;
    current.querySelector('.audio-fill').style.width = pct + '%';
    current.querySelector('.audio-time').textContent =
      fmt(player.currentTime) + ' / ' + fmt(player.duration);
  });
  player.addEventListener('ended', () => {
    if (!current) return;
    current.classList.remove('playing');
    current.querySelector('.audio-fill').style.width = '0';
    current.querySelector('.audio-time').textContent = '00:00';
    current = null;
  });
  player.addEventListener('error', () => {
    if (!current) return;
    current.querySelector('.audio-time').textContent = '无法播放';
    current.querySelector('.audio-time').classList.add('audio-err');
  });
}

/* ══ 人物 ═══════════════════════════════════════════════ */
function renderCast() {
  const rows = (D.charTable || []).filter((r) => r && r.length);
  if (!rows.length) { $('#cast').hidden = true; return; }
  const s = (D.sections && D.sections.cast) || {};
  $('#cast').hidden = false;
  $('#castNum').textContent = s.num || '人 物';
  $('#castTitle').textContent = s.title || '一张面孔';
  $('#castDesc').textContent = s.desc || '';

  const body = rows.length && isCastHeader(rows[0]) ? rows.slice(1) : rows;
  $('#castGrid').innerHTML = body.map((r) => {
    const name = String(r[0] || '');
    const role = r[2] ? String(r[2]) : '';
    const desc = r[1] ? String(r[1]) : '';
    /* 卡片名可能带生卒年，取名字本体用于筛选匹配 */
    const key = name.replace(/[（(][^）)]*[）)]s*$/, '').trim();
    return `
      <article class="cast-card tilt3d" data-role="${esc(key)}" tabindex="0" role="button"
               aria-label="只看 ${esc(key)} 的台词">
        <div class="cast-emblem" aria-hidden="true">${esc(name.trim().charAt(0))}</div>
        <h3 class="cast-name">${esc(name)}</h3>
        ${role ? `<div class="cast-role">${esc(role)}</div>` : ''}
        ${desc ? `<p class="cast-desc">${esc(desc)}</p>` : ''}
        ${castStatLine(key)}
        <div class="cast-hint">只看这一位 →</div>
      </article>`;
  }).join('');
}

/* ══ 伏笔 ═══════════════════════════════════════════════ */
function renderThreads() {
  const th = D.threads || [];
  if (!th.length) { $('#threads').hidden = true; return; }
  const s = (D.sections && D.sections.threads) || {};
  $('#threads').hidden = false;
  $('#threadNum').textContent = s.num || '伏 笔';
  $('#threadTitle').textContent = s.title || `${th.length}条线`;
  $('#threadDesc').textContent = s.desc || '';

  $('#threadList').innerHTML = th.map((t) => `
    <article class="thread tilt3d" style="--tc:${esc(t.color || '')}">
      <h3 class="thread-name"><i aria-hidden="true"></i>${esc(t.name)}</h3>
      <dl>
        ${has(t.plant) ? `<div><dt>埋</dt><dd>${esc(t.plant)}</dd></div>` : ''}
        ${has(t.pay) ? `<div><dt>收</dt><dd>${esc(t.pay)}</dd></div>` : ''}
      </dl>
      ${has(t.note) ? `<p class="thread-note">${esc(t.note)}</p>` : ''}
      ${threadJumpRow(t)}
    </article>`).join('');

  $$('.thread-jump').forEach((btn) => {
    btn.addEventListener('click', () => jumpToScene(+btn.getAttribute('data-scene')));
  });
}

/* ══ 页脚 ═══════════════════════════════════════════════ */
function renderFoot() {
  const c = D.cover || {};
  $('#footTitle').textContent = c.footerTitle || c.theme || c.name || '';
  $('#footNote').textContent = c.note || '';
  const meta = [];
  if (has(c.author)) meta.push(c.author);
  if (has(c.span)) meta.push(c.span);
  if (has(D.acts) && D.acts.length) meta.push(`${D.acts.length} ${actUnit()}`);
  if (has(D.songs) && D.songs.length) meta.push(`${D.songs.length} 首曲目`);
  $('#footMeta').innerHTML = meta.map((t) => `<span>${esc(t)}</span>`).join('');
}

/* ══ 导航 ═══════════════════════════════════════════════ */
const NAV_ITEMS = [
  ['mainline', '主线'], ['front', '总纲'], ['songs', '歌单'], ['songtable', '目录'],
  ['motifs', '同曲'], ['audio', '配乐'], ['cast', '人物'], ['threads', '伏笔'],
];

function renderNav() {
  const nav = $('#topnav');
  nav.innerHTML = NAV_ITEMS
    .filter(([id]) => { const el = document.getElementById(id); return el && !el.hidden; })
    .map(([id, label]) => `<a href="#${id}" data-nav="${id}">${esc(label)}</a>`)
    .join('');

  const rail = $('#rail');
  const acts = D.acts || [];
  rail.innerHTML = acts.map((a, i) =>
    `<button class="rail-item" type="button" data-rail="${i}">${esc(actLabel(i))}`
    + `<span class="rail-tip">${esc(a.title)}</span></button>`
  ).join('');
}

function gotoAct(i) {
  const el = document.getElementById('act-' + i);
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - 20;
  window.scrollTo({ top: y, behavior: 'smooth' });
}

function jumpToSong(no) {
  const el = document.querySelector(`.song[data-song="${no}"]`);
  if (!el) { openModal(no); return; }
  const y = el.getBoundingClientRect().top + window.scrollY - 100;
  window.scrollTo({ top: y, behavior: 'smooth' });
  const head = el.querySelector('.song-head');
  if (head && !el.classList.contains('open')) head.click();
}

function bindSongHeads(root) {
  $$('.song-head', root).forEach((head) => {
    head.addEventListener('click', () => {
      const song = head.parentElement;
      const open = song.classList.toggle('open');
      head.setAttribute('aria-expanded', String(open));
    });
  });
}

/* ══ 歌词弹层 ═══════════════════════════════════════════ */
function openModal(no) {
  const s = songByNo[no];
  if (!s) return;
  $('#modalTitle').textContent = s.name || '';
  $('#modalSub').textContent = [s.actTitle || actLabel(s.act || 0), s.performer]
    .filter(Boolean).join(' · ');
  const items = s.items;
  $('#modalBody').innerHTML = items
    ? renderSongItems(items)
    : `<p class="modal-lock">${unlocked ? '该曲暂无内容。' : '歌词需解锁后阅读，请在下方输入密码。'}</p>`;
  $('#modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  $('#modalClose').focus();
}

function closeModal() {
  $('#modal').classList.remove('open');
  document.body.style.overflow = '';
}

/* ══ 权限门 ═════════════════════════════════════════════ */
function setupGate() {
  const gate = $('#gate');
  if (!SECRET) { gate.hidden = true; return; }
  gate.hidden = false;          /* 有密文时，权限门作为独立区块常驻页面 */

  const s = (D.sections && D.sections.gate) || {};
  if (s.title) $('#gateTitle').textContent = s.title;
  if (s.desc) $('#gateDesc').textContent = String(s.desc).replace(/<br\s*\/?>/gi, '\n');
  if (s.tip) $('#gateTip').textContent = s.tip;

  const form = $('#gateForm');
  const input = $('#gateInput');
  const msg = $('#gateMsg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = input.value.trim();
    if (!pass) return;
    msg.textContent = '正在解密…';
    msg.classList.remove('err');
    try {
      const secret = await decryptSecret(pass, SECRET);
      mergeSecret(secret);
      unlocked = true;
      gate.hidden = true;
      sessionStorage.setItem('script-site-unlocked', '1');
      msg.textContent = '';
      renderActs();
      renderFront();
      renderSongWall();
      renderMotifs();
      renderNav();
      initScrollSpy();
      initAnchors();
      cmdkIndex = null;
      if (roleFilter) applyRoleFilter(roleFilter);
      window.scrollTo({ top: Math.max(0, window.scrollY), behavior: 'auto' });
    } catch (err) {
      msg.textContent = (err && err.message === 'NO_WEBCRYPTO')
        ? '当前环境不支持 WebCrypto，请用 HTTPS 或 localhost 访问。'
        : '密码不正确，请重试。';
      msg.classList.add('err');
      input.select();
    }
  });
}

/* 把受限层并入公开层 */
function mergeSecret(secret) {
  (secret.acts || []).forEach((sa) => {
    const pub = (D.acts || [])[sa.act];
    if (pub) pub.fullBlocks = sa.blocks || [];
  });
  (secret.songs || []).forEach((ss) => {
    const pub = songByNo[ss.no];
    if (pub) { pub.items = ss.items || []; pub.lyrics = ss.lyrics || ''; }
  });
  if (secret.front) D.front = secret.front;
  reindexSongs();
}

/* ══ 滚动监听 ═══════════════════════════════════════════ */
let observer = null;
function initScrollSpy() {
  if (observer) observer.disconnect();

  /* 顶栏 */
  const links = $$('#topnav [data-nav]');
  const sections = links
    .map((a) => document.getElementById(a.dataset.nav))
    .filter(Boolean);
  const navObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('active', a.dataset.nav === e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => navObs.observe(s));

  /* 幕次轨 */
  const railItems = $$('#rail [data-rail]');
  const acts = $$('.act');
  const actObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const i = +e.target.dataset.act;
      railItems.forEach((b) => b.classList.toggle('active', +b.dataset.rail === i));
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  acts.forEach((a) => actObs.observe(a));

  observer = { disconnect() { navObs.disconnect(); actObs.disconnect(); } };
}

/* ══ 顶栏显隐 ═══════════════════════════════════════════ */
function initTopbar() {
  const bar = $('#topbar');
  const rail = $('#rail');
  const onScroll = () => {
    const y = window.scrollY;
    bar.classList.toggle('shown', y > 60);
    rail.classList.toggle('shown', y > 200);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}


/* ══════════════════════════════════════════════════════════
   交互层 · 幕启 / 进度 / 角色筛选 / 按幕筛选 / 回到顶部
   ══════════════════════════════════════════════════════════ */
const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── 幕启：红幕合拢 → 打开 → 进入序幕 ─────────────────── */
function initCurtain() {
  const hero = $('#hero');
  const cta = $('#heroCta');
  const seal = $('#curtainSeal');
  if (!hero || !cta) return;
  const c = D.cover || {};
  if (seal) seal.textContent = c.seal || String(c.name || '剧').trim().charAt(0);

  let busy = false;
  cta.addEventListener('click', (e) => {
    if (busy) return;
    e.preventDefault();
    e.stopPropagation();
    if (reduceMotion()) { gotoAct(0); return; }
    busy = true;
    hero.classList.add('closing');
    /* 幕布合拢 0.82s → 金印落下 → 开幕 */
    setTimeout(() => {
      hero.classList.add('sealed');
      setTimeout(() => {
        hero.classList.remove('sealed', 'closing');
        hero.classList.add('opening');
        gotoAct(0);
        setTimeout(() => { hero.classList.remove('opening'); busy = false; }, 1100);
      }, 560);
    }, 820);
  }, true);
}

/* ── 阅读进度条 ──────────────────────────────────────── */
function initProgress() {
  const bar = $('#progress i');
  if (!bar) return;
  let ticking = false;
  const upd = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const p = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
    bar.style.width = (p * 100).toFixed(2) + '%';
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(upd); }
  }, { passive: true });
  window.addEventListener('resize', upd, { passive: true });
  upd();
}

/* ── 舞台光随滚动渐隐：进入正文后别抢戏 ───────────────── */
function initStageFade() {
  const cv = $('#stage');
  if (!cv) return;
  const upd = () => {
    const p = Math.min(1, window.scrollY / (window.innerHeight * 0.85));
    cv.style.opacity = String(1 - p * 0.78);
  };
  window.addEventListener('scroll', upd, { passive: true });
  upd();
}

/* ── 回到顶部 ────────────────────────────────────────── */
function initToTop() {
  const btn = $('#toTop');
  if (!btn) return;
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', () => {
    btn.classList.toggle('shown', window.scrollY > window.innerHeight * 0.9);
  }, { passive: true });
}

/* ── 角色筛选：只亮出这一位的台词 ────────────────────── */
let roleFilter = '';

function applyRoleFilter(name) {
  roleFilter = name || '';
  const bar = $('#roleBar');
  const body = document.body;
  if (!roleFilter) {
    body.classList.remove('role-filter');
    body.removeAttribute('data-role');
    $$('.dialogue, .beat').forEach((el) => el.removeAttribute('data-hit'));
    $$('.cast-card').forEach((el) => el.classList.remove('active'));
    if (bar) bar.classList.remove('shown');
    return;
  }
  body.classList.add('role-filter');
  body.setAttribute('data-role', roleFilter);
  let n = 0;
  $$('.dialogue, .beat').forEach((el) => {
    const who = el.getAttribute('data-who') || '';
    const hit = who === roleFilter || who.startsWith(roleFilter);
    if (hit) { el.setAttribute('data-hit', ''); n++; }
    else el.removeAttribute('data-hit');
  });
  $$('.cast-card').forEach((el) => {
    el.classList.toggle('active', (el.getAttribute('data-role') || '') === roleFilter);
  });
  const nm = $('#roleName');
  const ct = $('#roleCount');
  if (nm) nm.textContent = roleFilter;
  if (ct) ct.textContent = n ? n + ' 处台词' : '本幕无台词';
  if (bar) bar.classList.add('shown');
}

function initRoleFilter() {
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.cast-card[data-role]');
    if (card) {
      const name = card.getAttribute('data-role') || '';
      applyRoleFilter(roleFilter === name ? '' : name);
      return;
    }
    const perf = e.target.closest('.perf-chip[data-role]');
    if (perf) {
      const pname = perf.getAttribute('data-role') || '';
      applyRoleFilter(roleFilter === pname ? '' : pname);
      const pbar = $('#roleBar');
      if (pbar) pbar.scrollIntoView({ block: 'nearest' });
      return;
    }
    const who = e.target.closest('.dlg-who, .beat-who');
    if (who) {
      const host = who.closest('[data-who]');
      const name = host ? (host.getAttribute('data-who') || '') : '';
      if (name) {
        applyRoleFilter(roleFilter === name ? '' : name);
        const bar = $('#roleBar');
        if (bar) bar.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    const clear = e.target.closest('#roleClear');
    if (clear) { applyRoleFilter(''); return; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && roleFilter) applyRoleFilter('');
  });
}

/* ── 按幕筛选：曲目表 / 歌单墙 ───────────────────────── */
let actFilter = -1;

function actFilterOptions() {
  const opts = new Map();
  (D.songs || []).forEach((s) => {
    const a = typeof s.act === 'number' ? s.act : 0;
    opts.set(a, (opts.get(a) || 0) + 1);
  });
  return [...opts.entries()].sort((x, y) => x[0] - y[0]);
}

function renderChips() {
  const opts = actFilterOptions();
  if (!opts.length) return;
  const html =
    `<button class="chip${actFilter < 0 ? ' active' : ''}" type="button" data-act-filter="-1">`
    + `全部<span class="chip-n">${(D.songs || []).length}</span></button>`
    + opts.map(([a, n]) =>
      `<button class="chip${actFilter === a ? ' active' : ''}" type="button" data-act-filter="${a}">`
      + `${esc(actLabel(a))}<span class="chip-n">${n}</span></button>`).join('');
  const t = $('#tableChips');
  const s = $('#songChips');
  if (t) t.innerHTML = html;
  if (s) s.innerHTML = html;
}

function applyActFilter() {
  $$('#songTableBody tr').forEach((tr) => {
    const a = parseInt(tr.getAttribute('data-act') ?? '-1', 10);
    tr.classList.toggle('dim', actFilter >= 0 && a !== actFilter);
  });
  $$('#songwall .song-card').forEach((c) => {
    const a = parseInt(c.getAttribute('data-act') ?? '-1', 10);
    c.classList.toggle('dim', actFilter >= 0 && a !== actFilter);
  });
}

function initActFilter() {
  renderChips();
  applyActFilter();
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-act-filter]');
    if (!chip) return;
    actFilter = parseInt(chip.getAttribute('data-act-filter'), 10);
    renderChips();
    applyActFilter();
  });
}



/* ══════════════════════════════════════════════════════════
   增强层 · 幕间海报 / 人物同台图 / 全剧检索 / 字号 / 幕次刻度
   ------------------------------------------------------------
   全部为「增强」，不依赖即失效：每个模块都先检查宿主节点，
   缺失就静默返回，绝不阻塞剧本正文的渲染。
   ══════════════════════════════════════════════════════════ */

/* ── 幕间海报：幕与幕之间的戏单页 ─────────────────────── */
function interludeHtml(a, ai) {
  const next = (D.acts || [])[ai + 1];
  if (!next) return '';
  const label = actLabel(ai + 1);
  const title = String(next.title || '').replace(/^.*?[：:]\s*/, '') || String(next.title || '');
  const time = (next.meta && next.meta.time) || '';
  return `
    <section class="interlude" aria-hidden="true" data-interlude="${ai + 1}">
      <div class="interlude-inner">
        <div class="interlude-no">${esc(label)}</div>
        <h2 class="interlude-title">${esc(title)}</h2>
        ${time ? `<div class="interlude-meta">${esc(time)}</div>` : ''}
      </div>
      <div class="interlude-rule" aria-hidden="true"><i></i><span></span><i></i></div>
    </section>`;
}

/* 幕间海报随滚动浮现 */
function initInterludes() {
  const list = $$('.interlude');
  if (!list.length) return;
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('revealed');
      io.unobserve(e.target);
    });
  }, { rootMargin: '-12% 0px -12% 0px' });
  list.forEach((el) => io.observe(el));
}

/* 角色表首行是表头（「人物」「角色」…），不是角色本人 */
function isCastHeader(row) {
  const first = String((row && row[0]) || '').trim();
  return ['人物', '角色', '角色名', '演员', '主要人物'].includes(first);
}

/* ── 人物同台图 ──────────────────────────────────────── */
function baseName(name) {
  return String(name || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s*·.*$/, '')
    .trim();
}

/* 收集「谁在哪一幕出现过」与「谁和谁同台过」 */
function buildCastGraph() {
  const acts = D.acts || [];
  const names = new Set();

  (acts || []).forEach((a) => {
    const c = (a.meta && a.meta.cast) || '';
    String(c).split(/[、,，/／\s]+/).forEach((x) => {
      const n = x.trim();
      if (n && n.length <= 8) names.add(n);
    });
  });

  const castRows = (D.charTable || []).filter((r) => r && r.length);
  const body = castRows.length && isCastHeader(castRows[0])
    ? castRows.slice(1) : castRows;
  body.forEach((r) => { const n = baseName(r[0]); if (n) names.add(n); });

  const all = [...names].filter((n) => n.length <= 8);

  /* 同幕 → 边 */
  const edges = new Map();
  const edgeKey = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);
  const addEdge = (a, b, w, kind) => {
    if (!a || !b || a === b) return;
    const k = edgeKey(a, b);
    const cur = edges.get(k) || { a: a < b ? a : b, b: a < b ? b : a, w: 0, kinds: new Set() };
    cur.w += w;
    cur.kinds.add(kind);
    edges.set(k, cur);
  };

  const actOf = new Map();          /* 角色 → 出现过的幕号 */
  acts.forEach((a, ai) => {
    const c = (a.meta && a.meta.cast) || '';
    const list = String(c).split(/[、,，/／\s]+/).map((x) => x.trim()).filter(Boolean);
    list.forEach((n) => {
      if (!actOf.has(n)) actOf.set(n, new Set());
      actOf.get(n).add(ai);
    });
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) addEdge(list[i], list[j], 1, 'act');
    }
  });

  /* 同曲 → 边（二重唱 / 三重唱 / 合唱把几个人拴在一起） */
  (D.songs || []).forEach((s) => {
    const perf = String(s.performer || '');
    const found = all.filter((n) => perf.includes(n));
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) addEdge(found[i], found[j], 1.6, 'song');
    }
  });

  /* 节点：只保留有边的，加上独角 */
  const deg = new Map();
  edges.forEach((e) => {
    deg.set(e.a, (deg.get(e.a) || 0) + e.w);
    deg.set(e.b, (deg.get(e.b) || 0) + e.w);
  });
  const nodes = all.map((n) => ({
    name: n,
    w: deg.get(n) || 0,
    acts: actOf.get(n) ? [...actOf.get(n)].sort((x, y) => x - y) : [],
    songs: (D.songs || []).filter((s) => String(s.performer || '').includes(n)).map((s) => s.no),
  })).filter((n) => n.w > 0 || n.acts.length);

  nodes.sort((a, b) => b.w - a.w || a.name.localeCompare(b.name, 'zh'));
  return { nodes, edges: [...edges.values()] };
}

/* 确定性力导向布局：同一份数据永远得到同一张图 */
function forceLayout(nodes, edges, W, H) {
  const n = nodes.length;
  if (!n) return;
  const cx = W / 2, cy = H / 2;

  nodes.forEach((d, i) => {
    const a = i * 2.399963229728653;
    const r = 70 + 30 * Math.sqrt(i + 1);
    d.x = cx + Math.cos(a) * r * 1.55;
    d.y = cy + Math.sin(a) * r * 0.70;
    d.vx = 0; d.vy = 0;
  });

  const area = W * H;
  const rep = area / (n * 3.4);
  const rest = Math.min(210, Math.sqrt(area / (n + 1)) * 1.35);
  const ITER = 620;

  for (let it = 0; it < ITER; it++) {
    const temp = 30 * (1 - it / ITER) + 0.6;

    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (i - j) * 0.7 + 0.3; dy = 0.6; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2);
        const f = rep / d2;
        const ux = dx / d, uy = dy / d;
        a.vx += ux * f; a.vy += uy * f;
        b.vx -= ux * f; b.vy -= uy * f;
      }
    }

    edges.forEach((e) => {
      const a = nodes.find((x) => x.name === e.a);
      const b = nodes.find((x) => x.name === e.b);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = (d - rest) * 0.016 * Math.min(2.2, e.w);
      const ux = dx / d, uy = dy / d;
      a.vx += ux * f; a.vy += uy * f;
      b.vx -= ux * f; b.vy -= uy * f;
    });

    nodes.forEach((d) => {
      d.vx += (cx - d.x) * 0.006;
      d.vy += (cy - d.y) * 0.009;
      const sp = Math.hypot(d.vx, d.vy);
      const cap = Math.min(sp, temp);
      d.x += (d.vx / (sp || 1)) * cap;
      d.y += (d.vy / (sp || 1)) * cap;
      d.vx *= 0.82; d.vy *= 0.82;
    });
  }

  /* 归一化到画框：图再密也铺满整幅，横向可拉伸成宽椭圆 */
  const padX = 92, padY = 54;
  const xs = nodes.map((d) => d.x), ys = nodes.map((d) => d.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const availW = W - padX * 2, availH = H - padY * 2;
  let sx = availW / Math.max(1, maxX - minX);
  let sy = availH / Math.max(1, maxY - minY);
  const ratio = sx / sy;
  if (ratio > 1.8) sx = sy * 1.8;
  else if (ratio < 1 / 1.8) sy = sx * 1.8;
  const gw = (maxX - minX) * sx, gh = (maxY - minY) * sy;
  const ox = padX + (availW - gw) / 2;
  const oy = padY + (availH - gh) / 2;
  nodes.forEach((d) => {
    d.x = Math.max(padX * 0.62, Math.min(W - padX * 0.62, ox + (d.x - minX) * sx));
    d.y = Math.max(padY * 0.62, Math.min(H - padY * 0.62, oy + (d.y - minY) * sy));
  });
}

function renderCastMap() {
  const host = $('#castMap');
  const svg = $('#castMapSvg');
  if (!host || !svg) return;

  const g = buildCastGraph();
  if (!g.nodes.length || g.nodes.length < 4) { host.hidden = true; return; }
  host.hidden = false;

  const W = 1000, H = 560;
  const nodes = g.nodes.slice(0, 26);
  const keep = new Set(nodes.map((n) => n.name));
  const edges = g.edges.filter((e) => keep.has(e.a) && keep.has(e.b));

  forceLayout(nodes, edges, W, H);

  const byName = new Map(nodes.map((n) => [n.name, n]));
  const maxW = Math.max(1, ...nodes.map((n) => n.w));
  const extra = g.nodes.length - nodes.length;

  const edgeHtml = edges.map((e) => {
    const a = byName.get(e.a), b = byName.get(e.b);
    if (!a || !b) return '';
    const cls = (e.kinds && e.kinds.has('song')) ? 'map-edge song' : 'map-edge';
    return `<line class="${cls}" data-a="${esc(e.a)}" data-b="${esc(e.b)}"
      x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}"
      x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" />`;
  }).join('');

  const cx = W / 2, cy = H / 2;
  const nodeHtml = nodes.map((n) => {
    const r = 5.5 + (n.w / maxW) * 6;
    /* 标签沿离心方向外排，减少压字 */
    let ax = n.x - cx, ay = n.y - cy;
    const al = Math.hypot(ax, ay) || 1;
    ax /= al; ay /= al;
    const lx = n.x + ax * (r + 9);
    const ly = n.y + ay * (r + 9);
    const anchor = Math.abs(ax) > 0.55 ? (ax > 0 ? 'start' : 'end')
      : (ay > 0 ? 'start' : 'end');
    const dy = ay > 0.55 ? 9 : (ay < -0.55 ? -4 : 4);
    const major = n.w >= maxW * 0.55;
    return `<g class="map-node${major ? ' major' : ''}" data-name="${esc(n.name)}"
        transform="translate(${n.x.toFixed(1)},${n.y.toFixed(1)})">
      <circle r="${r.toFixed(1)}" />
      <text x="${(lx - n.x).toFixed(1)}" y="${(ly - n.y + dy).toFixed(1)}"
            text-anchor="${anchor}">${esc(n.name)}</text>
    </g>`;
  }).join('');

  svg.innerHTML = `<g class="map-edges">${edgeHtml}</g><g class="map-nodes">${nodeHtml}</g>`;

  /* 窄屏替代视图：同台图缩到 0.31 倍后字号只剩 4px，改用可点的角色徽章。
     徽章复用 SVG 节点的同一条选中逻辑（不冒泡地触发节点点击），两边状态同步。 */
  const nodeEls = new Map();
  $$('.map-node', svg).forEach((n) => nodeEls.set(n.getAttribute('data-name'), n));

  const chipHost = $('#mapChips');
  const syncChips = () => {
    if (!chipHost) return;
    $$('.map-chip', chipHost).forEach((c) => {
      const n = nodeEls.get(c.getAttribute('data-name'));
      c.classList.toggle('on', !!(n && n.classList.contains('on')));
      c.classList.toggle('dim', !!(n && n.classList.contains('dim')));
    });
  };

  if (chipHost) {
    chipHost.innerHTML = nodes.map((n) =>
      `<button class="map-chip" type="button" data-name="${esc(n.name)}"`
      + ` title="与 ${Math.round(n.w)} 位角色同台">${esc(n.name)}<b>${Math.round(n.w)}</b></button>`
    ).join('');
    $$('.map-chip', chipHost).forEach((c) => {
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        const node = nodeEls.get(c.getAttribute('data-name'));
        if (!node) { applyRoleFilter(''); return; }
        node.dispatchEvent(new MouseEvent('click', { bubbles: false }));
        syncChips();
      });
    });
  }

  const foot = $('#mapFoot');
  const solo = nodes.filter((n) => n.songs.length).length;
  if (foot) {
    foot.innerHTML = `连线为<b>同幕同台</b>与<b>同曲合唱</b>；共 ${g.nodes.length} 位角色`
      + (solo ? `，其中 <b>${solo}</b> 位有独唱或合唱段落` : '')
      + (extra > 0 ? `；另有 ${extra} 位只在单场出现，未入图` : '')
      + '。点角色可只看这一位的台词。';
  }

  /* 交互：点节点 → 高亮 + 联动角色筛选 */
  const tip = $('#mapTip');
  const stage = host.querySelector('.map-stage');

  $$('.map-node', svg).forEach((g) => {
    const name = g.getAttribute('data-name');
    const node = byName.get(name);

    const showTip = (evt) => {
      if (!tip || !node) return;
      const st = stage.getBoundingClientRect();
      const bb = g.getBoundingClientRect();
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(node.name)}</b> · 同台 ${Math.round(node.w)}`
        + (node.songs.length ? ` · 唱段 ${node.songs.length} 首` : '')
        + (node.acts.length ? ` · 出场 ${node.acts.length} 幕` : '');
      tip.style.left = (bb.left + bb.width / 2 - st.left) + 'px';
      tip.style.top = (bb.top - st.top) + 'px';
    };
    const hideTip = () => { if (tip) tip.hidden = true; };

    g.addEventListener('pointerenter', showTip);
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = g.classList.contains('on');
      $$('.map-node', svg).forEach((x) => x.classList.remove('on', 'dim'));
      $$('.map-edge', svg).forEach((x) => x.classList.remove('hot', 'cold'));
      if (on) { applyRoleFilter(''); syncChips(); return; }
      g.classList.add('on');
      const near = new Set([name]);
      $$('.map-edge', svg).forEach((e) => {
        const a = e.getAttribute('data-a'), b = e.getAttribute('data-b');
        if (a === name || b === name) {
          e.classList.add('hot');
          near.add(a === name ? b : a);
        } else {
          e.classList.add('cold');
        }
      });
      $$('.map-node', svg).forEach((x) => {
        const n = x.getAttribute('data-name');
        if (!near.has(n)) x.classList.add('dim');
      });
      if (foot) {
        const co = [...near].filter((x) => x !== name);
        foot.innerHTML = `<b>${esc(name)}</b> 与 ${co.length} 位角色同台：`
          + co.map((x) => esc(x)).join('、')
          + (node.songs.length ? `　·　独唱/合唱 ${node.songs.map((no) => esc((songByNo[no] || {}).name || no)).join('、')}` : '');
      }
      applyRoleFilter(name);
      syncChips();
    });
  });

  svg.addEventListener('click', () => {
    $$('.map-node', svg).forEach((x) => x.classList.remove('on', 'dim'));
    $$('.map-edge', svg).forEach((x) => x.classList.remove('hot', 'cold'));
    syncChips();
    applyRoleFilter('');
    if (foot) foot.innerHTML = `连线为<b>同幕同台</b>与<b>同曲合唱</b>；共 ${g.nodes.length} 位角色`
      + (extra > 0 ? `；另有 ${extra} 位只在单场出现，未入图` : '')
      + '。点角色可只看这一位的台词。';
  });
}

/* ── 全剧检索（⌘K / Ctrl+K）───────────────────────────── */
let cmdkIndex = null;
let cmdkSel = 0;
let cmdkHits = [];

function buildSearchIndex() {
  const idx = [];
  (D.acts || []).forEach((a, ai) => {
    idx.push({ kind: '幕', kindN: '幕', text: a.title || '', sub: actLabel(ai),
      anchor: `#act-${ai}`, goto: () => gotoAct(ai) });
  });
  (D.songs || []).forEach((s) => {
    idx.push({ kind: '曲', kindN: '曲', text: `《${String(s.name || '').replace(/^《|》$/g, '')}》`,
      sub: s.actTitle || '', anchor: `.song[data-song="${s.no}"]`, goto: () => jumpToSong(s.no) });
  });
  (D.charTable || []).forEach((r) => {
    if (!r || !r.length) return;
    const n = baseName(r[0]);
    if (!n) return;
    idx.push({ kind: '人', kindN: '人', text: r[0], sub: r[1] || '', anchor: null,
      goto: () => focusCharacter(n) });
  });
  (D.threads || []).forEach((t) => {
    idx.push({ kind: '伏', kindN: '伏笔', text: t.name || '', sub: t.note || '',
      anchor: null, goto: () => focusThread(t.name) });
  });

  /* 创作总纲：解锁后才可检索 */
  const front = D.front;
  if (front && front.cards) {
    front.cards.forEach((c, i) => {
      idx.push({ kind: '纲', kindN: '总纲', text: c.title || '',
        sub: (c.tags || []).join(' · '), anchor: null, goto: () => gotoFrontCard(i) });
      (c.paras || []).forEach((p) => {
        idx.push({ kind: '纲', kindN: '总纲', text: String(p).slice(0, 60),
          sub: c.title || '', anchor: null, goto: () => gotoFrontCard(i) });
      });
    });
  }

  /* 正文与歌词：解锁后才可检索 */
  if (unlocked) {
    (D.acts || []).forEach((a, ai) => {
      (a.fullBlocks || []).forEach((b) => {
        if (b.k === 'dlg' && b.v && b.v.text) {
          idx.push({ kind: '词', kindN: '台词', text: b.v.text,
            sub: `${b.v.who || ''} · ${a.title || ''}`, anchor: `[data-anchor="a${ai}b${bi(a, b)}"]`,
            goto: null });
        } else if (b.k === 'sd' && b.v) {
          idx.push({ kind: '台', kindN: '舞台', text: String(b.v).slice(0, 120),
            sub: a.title || '', anchor: null, goto: null });
        }
      });
    });
  }
  return idx;
}

/* 台词锚点：用块在 fullBlocks 中的序号定位 */
function bi(act, block) {
  const arr = act.fullBlocks || [];
  const i = arr.indexOf(block);
  return i >= 0 ? i : 0;
}

function focusCharacter(name) {
  const card = $$('.cast-card').find((c) => c.getAttribute('data-role') === name);
  if (card) {
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.add('active');
    applyRoleFilter(name);
  } else {
    applyRoleFilter(name);
  }
}

function focusThread(name) {
  const el = $$('.thread').find((t) => {
    const h = t.querySelector('.thread-name');
    return h && h.textContent.trim() === name;
  });
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function cmdkHighlight(text, q) {
  const t = String(text || '');
  if (!q) return esc(t);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + '<em>' + esc(t.slice(i, i + q.length)) + '</em>' + esc(t.slice(i + q.length));
}

function cmdkRender(q) {
  const box = $('#cmdkResults');
  if (!box) return;
  const query = String(q || '').trim();

  if (!query) {
    cmdkHits = [];
    box.innerHTML = `<div class="cmdk-empty">输入剧名、角色、曲名或台词。<br>`
      + (unlocked ? '全本正文与歌词均可检索。' : '正文与歌词需解锁后检索。') + `</div>`;
    return;
  }

  const tokens = query.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const it of (cmdkIndex || [])) {
    const hay = (it.text + ' ' + (it.sub || '')).toLowerCase();
    let ok = true, hitAll = true;
    for (const tk of tokens) {
      if (!hay.includes(tk.toLowerCase())) { ok = false; break; }
      if (!it.text.toLowerCase().includes(tk.toLowerCase())) hitAll = false;
    }
    if (!ok) continue;
    const score = (hitAll ? 100 : 0) + (it.kindN === '曲' || it.kindN === '人' ? 12 : 0)
      + (it.text.indexOf(query) >= 0 ? 30 : 0) - it.text.length * 0.05;
    scored.push({ it, score });
  }
  scored.sort((a, b) => b.score - a.score);
  cmdkHits = scored.slice(0, 40).map((s) => s.it);
  cmdkSel = 0;

  if (!cmdkHits.length) {
    box.innerHTML = `<div class="cmdk-empty">没有找到「${esc(query)}」。</div>`;
    return;
  }

  let html = '';
  let lastKind = '';
  cmdkHits.forEach((it, i) => {
    if (it.kindN !== lastKind) {
      html += `<div class="cmdk-group">${esc(it.kindN)}</div>`;
      lastKind = it.kindN;
    }
    html += `<div class="cmdk-item${i === 0 ? ' sel' : ''}" data-cmdk="${i}" role="option">
      <span class="cmdk-kind">${esc(it.kind)}</span>
      <span class="cmdk-text">${cmdkHighlight(it.text, query)}</span>
      <span class="cmdk-sub">${esc(String(it.sub || '').slice(0, 22))}</span>
    </div>`;
  });
  box.innerHTML = html;
}

function cmdkOpen() {
  const m = $('#cmdk');
  if (!m) return;
  cmdkIndex = buildSearchIndex();
  m.classList.add('open');
  const input = $('#cmdkInput');
  if (input) { input.value = ''; cmdkRender(''); setTimeout(() => input.focus(), 30); }
}

function cmdkClose() {
  const m = $('#cmdk');
  if (!m) return;
  m.classList.remove('open');
}

function cmdkGo(i) {
  const it = cmdkHits[i];
  if (!it) return;
  cmdkClose();
  if (it.goto) { setTimeout(it.goto, 60); return; }
  if (it.anchor) {
    const el = document.querySelector(it.anchor);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 140;
      window.scrollTo({ top: y, behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
    }
  }
}

function initSearch() {
  const m = $('#cmdk');
  const input = $('#cmdkInput');
  if (!m || !input) return;

  const btn = $('#searchBtn');
  if (btn) btn.addEventListener('click', cmdkOpen);
  const close = $('#cmdkClose');
  if (close) close.addEventListener('click', cmdkClose);
  m.addEventListener('click', (e) => { if (e.target === m) cmdkClose(); });

  input.addEventListener('input', () => cmdkRender(input.value));

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      m.classList.contains('open') ? cmdkClose() : cmdkOpen();
      return;
    }
    if (!m.classList.contains('open')) return;
    if (e.key === 'Escape') { cmdkClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!cmdkHits.length) return;
      cmdkSel = (cmdkSel + (e.key === 'ArrowDown' ? 1 : -1) + cmdkHits.length) % cmdkHits.length;
      $$('.cmdk-item', m).forEach((el, i) => el.classList.toggle('sel', i === cmdkSel));
      const sel = $$('.cmdk-item', m)[cmdkSel];
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); cmdkGo(cmdkSel); }
  });
}

/* ── 字号调节 ────────────────────────────────────────── */
const FS_KEY = 'script-site-fs';
function initFontSize() {
  const root = document.documentElement;
  const up = $('#fontUp'), down = $('#fontDown');
  const saved = Number(localStorage.getItem(FS_KEY) || 1);
  let scale = Number.isFinite(saved) && saved >= 0.85 && saved <= 1.35 ? saved : 1;
  const paint = () => {
    root.style.setProperty('--fs-scale', String(scale));
    if (up) up.disabled = scale >= 1.35;
    if (down) down.disabled = scale <= 0.85;
  };
  if (up) up.addEventListener('click', () => {
    scale = Math.min(1.35, +(scale + 0.05).toFixed(2));
    localStorage.setItem(FS_KEY, String(scale)); paint();
  });
  if (down) down.addEventListener('click', () => {
    scale = Math.max(0.85, +(scale - 0.05).toFixed(2));
    localStorage.setItem(FS_KEY, String(scale)); paint();
  });
  paint();
}

/* ── 进度条幕次刻度 ──────────────────────────────────── */
let progressTicksReady = false;

/* 幕次在全文中的位置 → 进度条刻度 */
function drawTicks(host) {
  const acts = $$('.act');
  if (!acts.length) { host.innerHTML = ''; return; }
  const h = document.documentElement.scrollHeight - window.innerHeight;
  if (h <= 0) { host.innerHTML = ''; return; }
  host.innerHTML = acts.map((a, i) => {
    const top = a.getBoundingClientRect().top + window.scrollY;
    const pct = Math.min(99.4, Math.max(0.6, (top / h) * 100));
    const label = (D.acts[i] && D.acts[i].title) || actLabel(i);
    return `<span class="progress-tick" data-tick="${i}" style="left:${pct.toFixed(2)}%"
      data-label="${esc(label)}"></span>`;
  }).join('');
}

function initProgressTicks() {
  const host = $('#progressTicks');
  const bar = $('#progress');
  if (!host || !bar) return;
  if (progressTicksReady) { drawTicks(host); return; }
  progressTicksReady = true;
  const draw = () => drawTicks(host);

  let ticking = false;
  const upd = () => { draw(); ticking = false; };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(upd); }
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(upd); }
  }, { passive: true });
  setTimeout(draw, 60);
  setTimeout(draw, 900);

  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tick]');
    if (t) gotoAct(+t.getAttribute('data-tick'));
  });
}

/* ── 戏单竖牌 ────────────────────────────────────────── */
function renderPlacard() {
  const c = D.cover || {};
  const t = $('#placardTitle');
  const s = $('#placardSeal');
  if (t) t.textContent = c.name || (D.acts && D.acts[0] && D.acts[0].title) || '';
  if (s) s.textContent = c.seal || String(c.name || '剧').trim().charAt(0);
}

/* ── 伏笔：场次跳转 ──────────────────────────────────── */
function threadJumps(text) {
  const out = [];
  const re = /场\s*(\d+)/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 40 && !out.includes(n)) out.push(n);
  }
  return out;
}

function jumpToScene(n) {
  /* 场号 → 场标题块 */
  const el = $$('.scene').find((s) => new RegExp('^\\s*场\\s*' + n + '\\b').test(s.textContent || ''));
  if (el) {
    const y = el.getBoundingClientRect().top + window.scrollY - 140;
    window.scrollTo({ top: y, behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }
}

/* ── 唱段卡：演唱者 chips（联动角色筛选）─────────────── */
function perfRow(performer) {
  const perf = String(performer || '').trim();
  if (!perf) return '';
  const known = (D.charTable || [])
    .map((r) => baseName(r && r[0]))
    .filter(Boolean);
  const hits = known.filter((n) => perf.includes(n));
  if (!hits.length) {
    return `<div class="song-perf-row"><span class="spr-label">演唱</span><span class="spr-text">${esc(perf)}</span></div>`;
  }
  const seen = new Set();
  const chips = hits.filter((n) => !seen.has(n) && seen.add(n)).map((n) =>
    `<button class="perf-chip" type="button" data-role="${esc(n)}">${esc(n)}</button>`).join('');
  return `<div class="song-perf-row"><span class="spr-label">演唱</span>${chips}</div>`;
}

/* ── 伏笔：场次跳转按钮 ──────────────────────────────── */
function threadJumpRow(t) {
  const ns = [...new Set([...threadJumps(t.plant), ...threadJumps(t.pay)])]
    .sort((a, b) => a - b);
  if (!ns.length) return '';
  return '<div class="thread-jumps">'
    + ns.map((n) => `<button class="thread-jump" type="button" data-scene="${n}">场 ${n}</button>`).join('')
    + '</div>';
}

/* ══════════════════════════════════════════════════════════
   增强层 · 二（读本 · 对照 · 定位）
   ══════════════════════════════════════════════════════════ */

/* ── 轻提示 ────────────────────────────────────────────── */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('shown'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('shown');
    setTimeout(() => { el.hidden = true; }, 280);
  }, 2200);
}

/* ── 同曲异形：同一支曲子在全剧里的几种形态 ─────────── */
const MOTIF_KEY = (name) => String(name || '')
  .replace(/[《》〈〉「」""]/g, '')
  .split(/[·・:：]/)[0]
  .trim();

function motifGroups() {
  const map = new Map();
  for (const s of (D.songs || [])) {
    if (!s || !s.name) continue;
    const key = MOTIF_KEY(s.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.values()].filter((g) => g.length >= 2)
    .sort((a, b) => a[0].no - b[0].no);
}

/* 曲目表里的「功能」列（暴露 / 转折 / 推进 / 结算） */
const songFunctionMap = (() => {
  const m = new Map();
  const tbl = D.songTable || [];
  if (tbl.length < 2) return m;
  const head = (tbl[0] || []).map((h) => String(h));
  const iNo = head.findIndex((h) => /编号|序号/.test(h));
  const iFn = head.findIndex((h) => /功能|作用|类型/.test(h));
  if (iNo < 0 || iFn < 0) return m;
  for (const row of tbl.slice(1)) {
    const no = parseInt(String(row[iNo] || '').replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(no) && no > 0) m.set(no, String(row[iFn] || '').trim());
  }
  return m;
})();

/* 唱段只取前若干行，完整歌词走弹层 */
function motifLyric(song) {
  const items = song.items || null;
  if (!items) {
    return `<p class="mf-lock">${unlocked ? '本曲暂无歌词。' : '歌词需解锁后阅读'}</p>`;
  }
  const lines = items.filter((it) => it.k === 'ly');
  const secs = items.filter((it) => it.k === 'sec' || it.k === 'pt')
    .map((it) => `<p class="mf-sec">${esc(String(it.v || '').replace(/^【|】$/g, ''))}</p>`).join('');
  const shown = lines.slice(0, 6).map((it) => {
    const who = it.speaker ? `<span class="mf-who">${esc(it.speaker)}</span>` : '';
    return `<p class="mf-line">${who}${esc(it.text)}</p>`;
  }).join('');
  const more = lines.length > 6
    ? `<button class="mf-more" type="button" data-open-song="${song.no}">看全部 ${lines.length} 行 →</button>`
    : '';
  return secs + shown + more;
}

function renderMotifs() {
  const host = $('#motifs');
  if (!host) return;
  const groups = motifGroups();
  if (!groups.length) { host.hidden = true; return; }
  const s = (D.sections && D.sections.motifs) || {};
  host.hidden = false;
  const total = groups.reduce((n, g) => n + g.length, 0);
  $('#motifNum').textContent = s.num || '同 曲';
  $('#motifTitle').textContent = s.title
    || (groups.length === 1 ? `一支曲子，${groups[0].length} 种模样` : `${groups.length} 支曲子，${total} 种模样`);
  $('#motifDesc').textContent = s.desc
    || '同一支曲子在不同幕次里反复出现，每一次形态都不同。点曲名跳到它在剧中的位置。';

  $('#motifList').innerHTML = groups.map((g) => {
    const base = MOTIF_KEY(g[0].name);
    const acts = [...new Set(g.map((x) => x.actTitle || actLabel(x.act || 0)))];
    const cols = g.map((x) => {
      const raw = String(x.name || '').replace(/[《》]/g, '');
      const form = raw.includes('·')
        ? raw.split('·').slice(1).join('·')
        : (songFunctionMap.get(x.no) || actLabel(x.act || 0));
      return `<div class="motif-col tilt3d">
        <div class="mf-top">
          <span class="mf-no">${String(x.no).padStart(2, '0')}</span>
          <span class="mf-form">${esc(form)}</span>
        </div>
        <h4 class="mf-name"><button type="button" data-goto-song="${x.no}">《${esc(raw)}》</button></h4>
        <div class="mf-meta">${esc(x.actTitle || actLabel(x.act || 0))}${x.performer ? ' · ' + esc(x.performer) : ''}</div>
        <div class="mf-ly">${motifLyric(x)}</div>
      </div>`;
    }).join('');
    return `<article class="motif">
      <div class="motif-head">
        <span class="motif-kicker">同 曲 异 形</span>
        <h3 class="motif-title">《${esc(base)}》</h3>
        <p class="motif-desc">全剧出现 ${g.length} 次，分列于 ${acts.length} 个幕次：${esc(acts.join(' · '))}。</p>
      </div>
      <div class="motif-cols">${cols}</div>
    </article>`;
  }).join('');
}

/* ── 台本模式：隐去舞台提示，只留台词与唱段 ───────────── */
const MODE_KEY = 'script-site-mode';
function initStageMode() {
  const btn = $('#modeStage');
  if (!btn) return;
  const paint = (on) => {
    document.body.classList.toggle('mode-stage', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '剧本' : '台本';
    btn.title = on ? '回到完整剧本（含舞台提示）' : '台本模式：只看台词与唱段';
  };
  let on = localStorage.getItem(MODE_KEY) === 'stage';
  btn.addEventListener('click', () => {
    on = !on;
    localStorage.setItem(MODE_KEY, on ? 'stage' : 'script');
    paint(on);
  });
  paint(on);
}

/* ── 沉浸模式：收掉所有界面装饰 ───────────────────────── */
const FOCUS_KEY = 'script-site-focus';
function initFocusMode() {
  const btn = $('#modeFocus');
  if (!btn) return;
  const paint = (on) => {
    document.body.classList.toggle('focus-mode', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '退出' : '沉浸';
    btn.title = on ? '退出沉浸阅读' : '沉浸阅读：隐藏界面装饰';
  };
  let on = localStorage.getItem(FOCUS_KEY) === '1';
  btn.addEventListener('click', () => {
    on = !on;
    localStorage.setItem(FOCUS_KEY, on ? '1' : '0');
    paint(on);
  });
  paint(on);
}

/* ── 段落锚点：可复制「这一段」的链接 ─────────────────── */
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error('no clipboard'));
}

function initAnchors() {
  const host = $('#acts');
  if (!host) return;
  $$('[data-anchor]', host).forEach((el) => {
    const a = el.getAttribute('data-anchor');
    if (a && !el.id) el.id = 'p-' + a;
    if (el.dataset.pinReady) return;
    el.dataset.pinReady = '1';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'anchor-pin';
    btn.textContent = '¶';
    btn.title = '复制本段链接';
    btn.setAttribute('aria-label', '复制本段链接');
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const url = location.origin + location.pathname + '#' + el.id;
      try { history.replaceState(null, '', '#' + el.id); } catch (err) { /* 忽略 */ }
      copyText(url).then(
        () => toast('已复制本段链接：' + el.id),
        () => toast('复制失败，请手动复制地址栏'));
    });
    el.appendChild(btn);
  });
}

/* 深链：地址栏 #p-a1b12 直接定位到那一段 */
function initDeepLink() {
  const raw = decodeURIComponent(location.hash || '').replace(/^#/, '');
  if (!raw) return;
  const el = document.getElementById(raw) || document.getElementById('p-' + raw);
  if (!el) return;
  setTimeout(() => {
    const y = el.getBoundingClientRect().top + window.scrollY - 130;
    window.scrollTo({ top: y, behavior: 'auto' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  }, 300);
}

/* ── 继续上次阅读 ─────────────────────────────────────── */
const POS_KEY = 'script-site-pos';
function currentSpot() {
  const scenes = $$('.scene');
  let best = null;
  for (const s of scenes) {
    const y = s.getBoundingClientRect().top + window.scrollY;
    if (y - 170 <= window.scrollY) best = s; else break;
  }
  return best;
}

function initResume() {
  const btn = $('#heroResume');
  const where = $('#resumeWhere');
  if (!btn || !where) return;
  let saveTimer = null;
  const save = () => {
    const s = currentSpot();
    const y = Math.round(window.scrollY);
    if (!s || y < 400) { localStorage.removeItem(POS_KEY); return; }
    const t = s.textContent.trim();
    const m = /^(场\s*\d+)/.exec(t);
    localStorage.setItem(POS_KEY, JSON.stringify({ y, label: m ? m[1] : t.slice(0, 12) }));
  };
  window.addEventListener('scroll', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }, { passive: true });
  window.addEventListener('beforeunload', save);

  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (!p || !p.y || p.y < 400) return;
    where.textContent = p.label || '上次读到的地方';
    btn.hidden = false;
    btn.addEventListener('click', () => {
      window.scrollTo({ top: p.y, behavior: 'smooth' });
    });
  } catch (err) { /* 忽略损坏的记录 */ }
}

/* ── 人物出场统计 ─────────────────────────────────────── */
const castStatIndex = (() => {
  const acts = new Map(), songs = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const split = (s) => String(s || '')
    .split(/[、，,/／\s＋+]+/).map(baseName).filter(Boolean);
  for (const a of (D.acts || [])) {
    const seen = new Set();
    for (const r of split(a.meta && a.meta.cast)) {
      if (!seen.has(r)) { seen.add(r); bump(acts, r); }
    }
  }
  for (const s of (D.songs || [])) {
    const seen = new Set();
    for (const r of split(s.performer)) {
      if (!seen.has(r)) { seen.add(r); bump(songs, r); }
    }
  }
  return { acts, songs };
})();

function castStatLine(key) {
  const a = castStatIndex.acts.get(key) || 0;
  const n = castStatIndex.songs.get(key) || 0;
  if (!a && !n) return '';
  const bits = [];
  if (a) bits.push(`出场 ${a} 幕`);
  if (n) bits.push(`演唱 ${n} 首`);
  return `<div class="cast-stat">${esc(bits.join(' · '))}</div>`;
}

/* ══ 启动 ═══════════════════════════════════════════════ */
/* ══ 三维卡片：随指针微转 ═══════════════════════════════
   三道门控，必须与 CSS 里的 @media 逐条对齐：
     ① (hover: hover) and (pointer: fine) —— 只有真鼠标才挂监听
     ② prefers-reduced-motion: reduce      —— 动效敏感者全静止
     ③ 视口 > 720px                        —— 窄屏退回平面

   以前这里只判 (hover: none)，比 CSS 宽：触摸屏笔记本同时满足
   hover:hover 与 pointer:none，手指一划就把卡片转起来而不是滚动页面。
   门控放宽 = 手机上「页面自己会动」，庄重感全无。

   条件在运行时会变（窗口缩小、系统切到减少动效），所以监听要能摘能挂，
   失效时把已经转起来的元素立刻放平 —— 不能等下次刷新。            */
const motionOk = () =>
  window.matchMedia('(hover: hover) and (pointer: fine)').matches
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  && window.innerWidth > 720;

/* 三道门控任一变化就重跑 apply() */
function onMotionGateChange(apply) {
  ['(hover: hover) and (pointer: fine)',
   '(prefers-reduced-motion: reduce)',
   '(max-width: 720px)'].forEach((q) => {
    const mq = window.matchMedia(q);
    if (mq.addEventListener) mq.addEventListener('change', apply);
  });
  window.addEventListener('resize', apply, { passive: true });
}

function initTilt() {
  const MAX = 7;
  let cur = null;
  let bound = false;

  const reset = (el) => {
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--mx', '50%');
    el.style.setProperty('--my', '50%');
    if (cur === el) cur = null;
  };

  const onMove = (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.tilt3d') : null;
    if (!el) return;
    if (cur && cur !== el) reset(cur);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = (e.clientX - r.left) / r.width - .5;
    const py = (e.clientY - r.top) / r.height - .5;
    el.style.setProperty('--rx', (-py * MAX).toFixed(2) + 'deg');
    el.style.setProperty('--ry', (px * MAX).toFixed(2) + 'deg');
    el.style.setProperty('--mx', ((px + .5) * 100).toFixed(1) + '%');
    el.style.setProperty('--my', ((py + .5) * 100).toFixed(1) + '%');
    cur = el;
  };

  const onOut = (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.tilt3d') : null;
    if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) reset(el);
  };

  const attach = () => {
    if (bound) return;
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    bound = true;
  };
  const detach = () => {
    if (!bound) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerout', onOut);
    bound = false;
    reset(cur);
  };

  const apply = () => { if (motionOk()) attach(); else detach(); };
  apply();
  onMotionGateChange(apply);
}

/* ══ 主标题立体视差：随指针轻微转面 ═════════════════════
   与 initTilt 共用同一套门控。标题的 transform 是写在行内样式上的，
   权重压过任何 CSS 规则 —— 所以「窄屏退回平面」只能靠这里断开监听，
   CSS 拦不住。                                                    */
function initHero3D() {
  const hero = $('#hero');
  const title = $('#heroTitle');
  if (!hero || !title) return;
  let raf = 0;
  let bound = false;

  const onMove = (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = hero.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - .5;
      const py = (e.clientY - r.top) / r.height - .5;
      title.style.transform =
        'rotateY(' + (px * 9).toFixed(2) + 'deg) rotateX(' + (-py * 7).toFixed(2) + 'deg) translateZ(20px)';
    });
  };
  const onLeave = () => { title.style.transform = ''; };

  const attach = () => {
    if (bound) return;
    hero.addEventListener('pointermove', onMove, { passive: true });
    hero.addEventListener('pointerleave', onLeave, { passive: true });
    bound = true;
  };
  const detach = () => {
    if (!bound) return;
    hero.removeEventListener('pointermove', onMove);
    hero.removeEventListener('pointerleave', onLeave);
    bound = false;
    title.style.transform = '';
  };

  const apply = () => { if (motionOk()) attach(); else detach(); };
  apply();
  onMotionGateChange(apply);
}

/* ══ 马灯：全剧的火种，随指针转面 ═══════════════════════
   灯身是八面纸屏绕轴拼成的柱体，所以只能绕竖轴转。
   幅度压在 ±13°：再大就转成风车，庄重感全丢。            */
function initLantern3D() {
  const slot = $('#heroLanternSlot');
  const body = $('#lanternBody');
  if (!slot || !body) return;
  if (slot.dataset.motif && slot.dataset.motif !== 'lantern') { slot.remove(); return; }

  const MAX = 13;
  let raf = 0, bound = false;

  const onMove = (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = slot.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = (e.clientX - r.left) / r.width - .5;
      const py = (e.clientY - r.top) / r.height - .5;
      body.style.setProperty('--ly', (px * MAX * 2).toFixed(2) + 'deg');
      body.style.setProperty('--lx', (-py * MAX * .6).toFixed(2) + 'deg');
    });
  };
  const onLeave = () => {
    body.style.setProperty('--ly', '0deg');
    body.style.setProperty('--lx', '0deg');
  };
  const attach = () => {
    if (bound) return;
    window.addEventListener('pointermove', onMove, { passive: true });
    bound = true;
  };
  const detach = () => {
    /* 注意：这里必须是 if (!bound) return;
       写成 if (bound) return 的话，「已绑定」时反而直接返回 ——
       监听器摘不掉，缩窗到 ≤720px 后马灯仍跟着指针转面。
       initTilt / initHero3D 的 detach 都是 !bound，三处要一致。 */
    if (!bound) return;
    window.removeEventListener('pointermove', onMove);
    bound = false;
    onLeave();
  };
  const apply = () => { if (motionOk()) attach(); else detach(); };
  apply();
  onMotionGateChange(apply);
}

/* ══ 火种时间轴：滚进视野就点亮，火光沿连线走过去 ══════ */
function initSpineFlame() {
  const spine = $('.spine');
  if (!spine) return;
  if (!('IntersectionObserver' in window)) { spine.classList.add('lit'); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('lit');
      io.unobserve(e.target);
    }
  }, { threshold: 0.3 });
  io.observe(spine);
}

function boot() {
  renderHero();
  renderSpine();
  initLantern3D();
  initSpineFlame();
  renderFront();
  renderActs();
  renderSongWall();
  renderSongTable();
  renderMotifs();
  renderAudio();
  renderCast();
  renderThreads();
  renderFoot();
  renderNav();
  setupGate();
  initScrollSpy();
  initTopbar();
  initCurtain();
  initStageFade();
  initProgress();
  initToTop();
  initRoleFilter();
  initActFilter();
  initSearch();
  initFontSize();
  initStageMode();
  initFocusMode();
  initAnchors();
  initResume();
  initDeepLink();
  initProgressTicks();
  renderPlacard();
  renderCastMap();
  initTilt();
  initHero3D();
  bindSongHeads(document);

  /* 委托：跳转 / 弹层 / 权限门 */
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) {
      const t = document.querySelector(g.dataset.goto);
      if (t) {
        const y = t.getBoundingClientRect().top + window.scrollY - 20;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
      return;
    }
    const gs = e.target.closest('[data-goto-song]');
    if (gs) { jumpToSong(gs.dataset.gotoSong); return; }
    const os = e.target.closest('[data-open-song]');
    if (os) { openModal(+os.dataset.openSong); return; }
    const gg = e.target.closest('[data-goto-gate]');
    if (gg) {
      const t = document.querySelector('#gate');
      if (t) {
        t.hidden = false;
        const y = t.getBoundingClientRect().top + window.scrollY - 20;
        window.scrollTo({ top: y, behavior: 'smooth' });
        setTimeout(() => $('#gateInput').focus(), 400);
      }
      return;
    }
    const rail = e.target.closest('[data-rail]');
    if (rail) { gotoAct(+rail.dataset.rail); }
  });

  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  /* 顶部 CTA 指向第一幕 */
  const first = D.acts && D.acts.length ? '#act-0' : '#mainline';
  $('#heroCta').dataset.goto = first;

  /* 次按钮：读目录 */
  const ghost = $('#heroGhost');
  if (ghost) {
    ghost.addEventListener('click', () => {
      const t = document.querySelector('#songtable:not([hidden])') || document.querySelector('#songs');
      if (t) {
        const y = t.getBoundingClientRect().top + window.scrollY - 20;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  }
}

/* 启动兜底：出错也要把原因挂到 DOM 上，别让页面半死不活 */
function safeBoot() {
  try {
    boot();
  } catch (err) {
    document.documentElement.setAttribute('data-jserr',
      String((err && err.message) || err) + ' @main.js');
    console.error(err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeBoot);
} else {
  safeBoot();
}
