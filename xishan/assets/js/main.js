/* ============================================================
   《西山不是山》· 站点主逻辑
   ---------------------------------------------------------------
   渲染管线：data.js → 各区块 HTML → 挂载 → 交互绑定
   ============================================================ */
import { createScene } from './scene.js';

const D = window.SCRIPT || {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ── 3D 场景 ─────────────────────────────────────────── */
const canvas = $('#stage');
if (canvas) {
  try {
    createScene(canvas);
  } catch (e) {
    console.warn('3D 场景不可用，退回静态背景', e);
    document.body.classList.add('no-3d');
  }
}

/* ══════════════════════════════════════════════════════
   唱段渲染
   ══════════════════════════════════════════════════════ */
const songByNo = {};
(D.songs || []).forEach(s => { songByNo[s.no] = s; });

function renderSongItems(items) {
  if (!items || !items.length) return '';
  let lastWho = null;
  return items.map(it => {
    if (it.k === 'ly') {
      const who = (it.speaker && it.speaker !== lastWho)
        ? `<span class="who">${esc(it.speaker)}</span>` : '';
      if (it.speaker) lastWho = it.speaker;
      const cue = it.cue ? `<span class="cue">${esc(it.cue)}</span>` : '';
      return `<span class="ly">${who}${cue}${esc(it.text)}</span>`;
    }
    if (it.k === 'sec') {
      const t = String(it.v || '').trim();
      const inner = /^【(.+)】$/.exec(t);
      return `<p class="song-sec">${esc(inner ? inner[1] : t)}</p>`;
    }
    if (it.k === 'pt') {
      return `<p class="song-part">${esc(it.v)}</p>`;
    }
    if (it.k === 'cue') {
      return `<p class="song-stage">${esc(it.who ? it.who + '：' : '')}（${esc(it.v)}）</p>`;
    }
    return `<p class="song-stage">${esc(it.v)}</p>`;
  }).join('');
}

function renderSongCard(s) {
  const full = songByNo[s.no];
  const items = (full && full.items) || s.items || [];
  return `
    <div class="song" data-song="${s.no}">
      <div class="song-head" role="button" tabindex="0" aria-expanded="false">
        <span class="song-no">${String(s.no).padStart(2, '0')}</span>
        <span class="song-name">《${esc(s.name)}》</span>
        <span class="song-perf">${esc(s.performer || '')}</span>
        <span class="song-toggle" aria-hidden="true">▾</span>
      </div>
      <div class="song-body">
        <div class="song-inner">
          <div class="lyric">${renderSongItems(items)}</div>
        </div>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════
   幕渲染
   ══════════════════════════════════════════════════════ */
function renderAct(a, ai) {
  const m = a.meta || {};
  const facts = [];
  if (m.time)  facts.push(`<span><b>时 间</b>　${esc(m.time)}</span>`);
  if (m.place) facts.push(`<span><b>地 点</b>　${esc(m.place)}</span>`);
  if (m.cast)  facts.push(`<span><b>人 物</b>　${esc(m.cast)}</span>`);

  const metaCells = [];
  if (m.time)  metaCells.push(`<div><dt>时 间</dt><dd>${esc(m.time)}</dd></div>`);
  if (m.place) metaCells.push(`<div><dt>地 点</dt><dd>${esc(m.place)}</dd></div>`);
  if (m.cast)  metaCells.push(`<div><dt>出 场 人 物</dt><dd>${esc(m.cast)}</dd></div>`);
  if (m.mood && m.mood.length)
    metaCells.push(`<div><dt>舞 台 氛 围</dt><dd>${m.mood.map(esc).join('<br>')}</dd></div>`);

  let body = '';
  for (const b of (a.blocks || [])) {
    switch (b.k) {
      case 'scene':
        body += `<div class="scene" id="scene-${b.no}"><div class="scene-head">${esc(b.v)}</div></div>`;
        break;
      case 'song':
        body += renderSongCard(b.v);
        break;
      case 'sd':
        body += `<p class="sd">${esc(b.v)}</p>`;
        break;
      case 'dlg':
        body += `<p class="dlg">${b.who ? `<span class="who">${esc(b.who)}</span>` : ''}` +
                `${b.cue ? `<span class="cue">${esc(b.cue)}</span>` : ''}${esc(b.v)}</p>`;
        break;
      case 'spk':
        body += `<p class="spk">${esc(b.v)}</p>`;
        break;
      case 'cue':
        body += `<p class="cue-line"><span class="cue">${esc(b.who ? b.who + '：' : '')}</span>${esc(b.v)}</p>`;
        break;
      case 'act':
        body += `<p class="act-line">${esc(b.v)}</p>`;
        break;
      case 'mood':
        body += `<p class="act-line mood-line">${esc(b.v)}</p>`;
        break;
      case 'note':
        body += `<p class="act-line note-line">${esc(b.v)}</p>`;
        break;
      case 'lyric':
        body += `<p class="act-line mood-line">${esc(b.v)}</p>`;
        break;
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
        <div class="act-body">${body}</div>
      </div>
    </section>`;
}

/* ══════════════════════════════════════════════════════
   区块渲染
   ══════════════════════════════════════════════════════ */
function renderActs() {
  $('#acts').innerHTML = (D.acts || []).map(renderAct).join('');
}

function renderSongWall() {
  const wall = $('#songwall');
  if (!wall) return;
  wall.innerHTML = (D.songs || []).map(s => `
    <a class="songcard" href="#song-${s.no}" data-jump-song="${s.no}">
      <span class="no">${String(s.no).padStart(2, '0')}</span>
      <span class="nm">《${esc(s.name)}》</span>
      <span class="pf">${esc(s.performer || '')}</span>
      <span class="ac">${esc(s.actTitle || '')}</span>
    </a>`).join('');
}

function renderSpine() {
  const box = $('#spineItems');
  if (!box) return;
  box.innerHTML = (D.cover.mainline || []).map(t =>
    `<div class="spine-item">
       <span class="spine-dot" aria-hidden="true"></span>
       <div class="spine-label">${esc(t)}</div>
     </div>`).join('');
}

function renderCast() {
  const grid = $('#castGrid');
  if (!grid) return;
  grid.innerHTML = (D.cast || []).map(p => `
    <article class="person">
      <div class="person-role">${esc(p.name)}　${esc(p.age)}　${esc(p.role)}</div>
      <p class="person-desc">${esc(p.desc)}</p>
      <div class="person-tag">${esc(p.tag)}</div>
    </article>`).join('');
}

function renderThreads() {
  const box = $('#threadList');
  if (!box) return;
  box.innerHTML = (D.threads || []).map(t => `
    <div class="thread">
      <div>
        <div class="thread-name">${esc(t.item)}</div>
        <span class="thread-chip">埋 ${esc(t.where)}　收 ${esc(t.pay)}</span>
      </div>
      <dl class="thread-col">
        <dt>埋 下</dt><dd>${esc(t.desc)}</dd>
      </dl>
      <dl class="thread-col">
        <dt>收 回</dt><dd>${esc(t.pay)}　—　全剧闭环。</dd>
      </dl>
    </div>`).join('');
}

function renderMechanism() {
  const box = $('#mechBox');
  if (!box) return;
  const m = D.mechanism || {};
  box.innerHTML = `
    <div class="mech-diagram">
      <div class="mech-row">
        <div class="mech-k">现 实 层（实 景）</div>
        <div class="mech-v">塔院堂屋。条案、旧册、煤油灯、凿子。<br>
          守塔人坐在案后，擦了四代册子。<br>
          学生甲背着机器来，被拒，坐在对面。</div>
      </div>
      <div class="mech-row">
        <div class="mech-k">传 说 层（自光中走出）</div>
        <div class="mech-v">姑娘、石匠、碧鸡、聂耳。<br>
          守塔人一开口，他们走进堂屋。<br>
          他一停，他们退回光里。</div>
      </div>
      <div class="mech-note">${esc(m.note || '')}</div>
    </div>
    <figure class="mech-figure">
      <img src="assets/svg/emblem-mountain.svg" alt="山形即卧人 · 徽记" loading="lazy">
      <figcaption>山形即卧人 —— 一座一千二百米的岩层，被一眼看成了一个人</figcaption>
    </figure>`;
}

function renderMotifs() {
  const box = $('#motifList');
  if (!box) return;
  box.innerHTML = (D.motifs || []).map(m => `
    <div class="motif">
      <div class="motif-k">${esc(m.key)}</div>
      <div class="motif-n">${esc(m.name)}</div>
      <div class="motif-d">${esc(m.desc)}</div>
    </div>`).join('');
}

function renderHero() {
  const c = D.cover || {};
  if ($('#heroSub')) $('#heroSub').textContent = c.subtitle || '';
  const meta = $('#heroMeta');
  if (meta) {
    meta.innerHTML = [c.kind, c.duration, c.span]
      .filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
  }
  const cred = $('#heroCredits');
  if (cred) cred.textContent = c.theme || '';
  const footNote = $('#footNote');
  if (footNote) footNote.textContent = c.note || '';
  const footAuthor = $('#footAuthor');
  if (footAuthor) footAuthor.textContent = c.name ? `《${c.name}》` : '';
}

function renderNav() {
  const acts = D.acts || [];
  const nav = $('#topnav');
  if (nav) {
    nav.innerHTML = acts.map((a, i) =>
      `<a href="#act-${i}" data-nav="${i}">${esc(a.title)}</a>`).join('');
  }
  const rail = $('#rail');
  if (rail) {
    rail.innerHTML = acts.map((a, i) => {
      // 只取幕名本身（《看》《门》这类），不取地点，避免竖排换行
      const m = /《(.+?)》/.exec(a.title || '');
      const sub = m ? m[1] : (a.title || '').slice(0, 4);
      return `<a class="rail-item" href="#act-${i}" data-rail="${i}">
                <span class="rail-no">${String(i).padStart(2, '0')}</span>
                <span class="rail-sub">${esc(sub)}</span>
              </a>`;
    }).join('');
  }
}

/* ── 首次渲染 ───────────────────────────────────────── */
renderHero();
renderNav();
renderSpine();
renderMechanism();
renderMotifs();
renderActs();
renderSongWall();
renderCast();
renderThreads();

/* ══════════════════════════════════════════════════════
   交互
   ══════════════════════════════════════════════════════ */

/* 唱段展开 */
document.addEventListener('click', (e) => {
  const head = e.target.closest('.song-head');
  if (head) {
    const card = head.closest('.song');
    const open = card.classList.toggle('open');
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    return;
  }

  /* 曲目墙跳转 → 展开对应唱段 */
  const jump = e.target.closest('[data-jump-song]');
  if (jump) {
    e.preventDefault();
    const no = Number(jump.dataset.jumpSong);
    const target = $(`.song[data-song="${no}"]`);
    if (target) {
      target.classList.add('open');
      const h = $('.song-head', target);
      if (h) h.setAttribute('aria-expanded', 'true');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => target.classList.remove('open'), 2600);
    }
    return;
  }

  /* 顶部 CTA */
  const cta = e.target.closest('.hero-cta');
  if (cta) {
    const t = $(cta.dataset.goto);
    if (t) t.scrollIntoView({ behavior: 'smooth' });
  }
});

/* 键盘可达 */
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('song-head')) {
    e.preventDefault();
    e.target.click();
  }
});

/* 导航高亮 */
const sections = $$('.act');
const navLinks = $$('[data-nav]');
const railItems = $$('[data-rail]');

function onScrollSpy() {
  const y = window.scrollY + window.innerHeight * 0.32;
  let cur = -1;
  sections.forEach((s, i) => { if (s.offsetTop <= y) cur = i; });
  navLinks.forEach(a => a.classList.toggle('on', Number(a.dataset.nav) === cur));
  railItems.forEach(a => a.classList.toggle('on', Number(a.dataset.rail) === cur));
}
window.addEventListener('scroll', onScrollSpy, { passive: true });
onScrollSpy();

/* ══════════════════════════════════════════════════════
   权限门
   ------------------------------------------------------------
   本剧为公开剧目：全本剧本与全部唱段歌词对外公开，
   不设密码。仅保留"剧目概况 / 剧本正文"的分层展示。
   ══════════════════════════════════════════════════════ */
const gate = $('#gate');
if (gate) {
  const card = $('.gate-card', gate);
  const title = $('.gate-title', gate);
  const desc = $('.gate-desc', gate);
  const form = $('.gate-form', gate);
  const tip = $('.gate-tip', gate);
  if (title) title.textContent = '全本剧本 · 对外公开';
  if (desc) desc.innerHTML =
    '全部 14 场分场剧本正文、全部唱段完整歌词，对外公开。<br>' +
    '本剧为独立原创剧目，与大型版《西山不是山》非删减改编关系。';
  if (form) form.remove();
  if (tip) tip.textContent = '创作团队内部另有一份含制作标注的工作稿 · 不在此展示';
}
