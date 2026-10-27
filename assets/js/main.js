/* ============================================================
   《山河摆渡人》剧本站 · 交互
   ============================================================ */
import { createStage } from './scene.js';

const D = window.SCRIPT;
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

  $('#spineDesc').textContent = D.cover.mainline.join(' → ');
  $('#footNote').textContent = D.cover.note;
  $('#footAuthor').textContent = D.cover.author;
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
D.songs.forEach(s => { songByNo[s.no] = s; });

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
      case 'act':
        body += `<p class="act-line">${esc(b.v)}</p>`;
        break;
      case 'note': {
        // 【地点】等幕内资料标签已进资料卡；其余转场/动作标记保留
        const t = String(b.v || '');
        if (/^【(时间|地点|出场人物|舞台氛围)】/.test(t)) break;
        if (t.startsWith('［氛围］')) {
          body += `<p class="act-line mood-line">${esc(t.replace('［氛围］', ''))}</p>`;
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

$('#acts').innerHTML = D.acts.map(renderAct).join('');

/* ── 曲目总览 ──────────────────────────────────────────── */
{
  const wall = $('#songwall');
  wall.innerHTML = D.songs.map(s => `
    <div class="songcard" data-goto-song="${s.no}" tabindex="0" role="button">
      <div class="no">曲目 ${String(s.no).padStart(2, '0')}</div>
      <div class="nm">《${esc(s.name)}》</div>
      <div class="pf">${esc(s.performer || '')}</div>
      <div class="ac">${esc(ACT_LABELS[s.act] || '')}</div>
    </div>`).join('');

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

  const nav = $('#topnav');
  nav.innerHTML = [
    ['#mainline', '主线'],
    ['#songs', '歌单'],
    ['#cast', '人物'],
    ['#threads', '伏笔'],
  ].map(([h, t]) => `<a href="${h}" data-nav="${h}">${t}</a>`).join('');

  rail.addEventListener('click', (e) => {
    const b = e.target.closest('.rail-item');
    if (b) gotoAct(+b.dataset.act);
  });

  // 滚动高亮：当前幕次 + 当前 section
  const sections = $$('[data-nav]');
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        sections.forEach(a => a.classList.toggle('on', a.dataset.nav === en.target.id));
      }
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach(s => obs.observe(s));

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

/* ── 打印时展开全部唱段 ────────────────────────────────── */
window.addEventListener('beforeprint', () => {
  $$('.song').forEach(s => s.classList.add('open'));
});
