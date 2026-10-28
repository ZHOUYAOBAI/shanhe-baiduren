/* ============================================================
   《山河摆渡人》剧本站 · 交互
   ============================================================ */
import { createStage } from './scene.js';
import { decryptSecret } from './crypto.js';

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

/* ── 配乐试听（纯器乐 demo）───────────────────────────── */
{
  /* 剧目配乐样带：纯器乐，无唱词，不与曲目歌词挂钩 */
  const SCORING = [
    { file: '遇敌.mp3',     name: '遇敌',     dur: '1:48' },
    { file: '渡江1.mp3',    name: '渡江 Ⅰ',   dur: '2:42' },
    { file: '渡江2.mp3',    name: '渡江 Ⅱ',   dur: '2:05' },
    { file: '等你回来（乐思）.mp3', name: '等你回来（乐思）', dur: '2:48' },
    { file: '山河之光.mp3', name: '山河之光', dur: '7:37' },
  ];

  const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const list = $('#scoringList');
  if (list) {
    list.innerHTML = SCORING.map(s => `
      <div class="scoring-item">
        <button class="scoring-play" type="button"
                aria-label="播放《${esc(s.name)}》">▶</button>
        <div class="scoring-name">${esc(s.name)}</div>
        <div class="scoring-bar" role="slider" tabindex="0"
             aria-label="《${esc(s.name)}》播放进度"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="scoring-track"><div class="scoring-fill"></div></div>
          <div class="scoring-knob"></div>
        </div>
        <div class="scoring-time"><span class="scoring-cur">0:00</span> / ${esc(s.dur)}</div>
        <audio preload="none" src="assets/audio/${encodeURIComponent(s.file)}"></audio>
      </div>`).join('');

    /* ── 单曲播放：任意时刻只允许一条在放（新的自动打断旧的）── */
    const rows = [...list.querySelectorAll('.scoring-item')];
    let current = null;      // 当前正在播放的 audio
    let rafId = 0;

    const resetRow = (row) => {
      const btn = row.querySelector('.scoring-play');
      row.querySelector('.scoring-fill').style.width = '0%';
      row.querySelector('.scoring-knob').style.left = '0%';
      row.querySelector('.scoring-cur').textContent = '0:00';
      row.querySelector('.scoring-bar').setAttribute('aria-valuenow', '0');
      btn.classList.remove('playing');
      btn.textContent = '▶';
      row.classList.remove('playing');
    };

    const stopAll = (except) => {
      rows.forEach(row => {
        const a = row.querySelector('audio');
        if (a && a !== except) {
          a.pause();
          a.currentTime = 0;
        }
        if (row !== except) resetRow(row);
      });
    };

    const paint = (row, audio) => {
      const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const pct = dur ? (audio.currentTime / dur) * 100 : 0;
      row.querySelector('.scoring-fill').style.width = pct + '%';
      row.querySelector('.scoring-knob').style.left = pct + '%';
      row.querySelector('.scoring-cur').textContent = fmt(audio.currentTime);
      row.querySelector('.scoring-bar').setAttribute('aria-valuenow', Math.round(pct));
    };

    const tick = () => {
      if (!current) return;
      const row = current.closest('.scoring-item');
      paint(row, current);
      if (!current.paused && !current.ended) rafId = requestAnimationFrame(tick);
    };

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
        }
        return;
      }

      /* 播放键：切换 */
      const btn = e.target.closest('.scoring-play');
      if (!btn) return;
      const row = btn.closest('.scoring-item');
      const audio = row.querySelector('audio');

      if (current === audio) {
        /* 再次点击当前这条 → 暂停 */
        audio.pause();
        cancelAnimationFrame(rafId);
        btn.classList.remove('playing');
        btn.textContent = '▶';
        row.classList.remove('playing');
        current = null;
        return;
      }

      /* 打断其它正在播放的 —— 自动互斥 */
      stopAll(audio);

      audio.play()
        .then(() => {
          current = audio;
          btn.classList.add('playing');
          btn.textContent = '❚❚';
          row.classList.add('playing');
          cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(tick);
        })
        .catch(() => {
          btn.classList.remove('playing');
          btn.textContent = '▶';
        });
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
      if (current === a) { current = null; cancelAnimationFrame(rafId); }
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
