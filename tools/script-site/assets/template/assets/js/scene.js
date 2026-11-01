/* ============================================================
   剧本站 · 程序化背景场景
   ------------------------------------------------------------
   纯 Canvas 2D，零依赖、零构建、几 KB。
   六种景别：mountain / river / fire / sea / stage / forest。
   配色从 CSS 变量读取，因此换肤时场景自动跟随。

   用法：
     const stage = createStage(canvas, { scene: 'river' });
     stage.setPalette({ accent: '#C8102E' });
   ============================================================ */

/* ── 确定性随机（同一 seed 出同一张山）─────────────────── */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* 1D 值噪声：多倍频叠加，天然适合画山脊 */
function makeNoise(rand) {
  const table = Array.from({ length: 256 }, () => rand());
  return function (x) {
    let v = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < 4; o++) {
      const p = x * freq;
      const i = Math.floor(p);
      const f = p - i;
      const s = f * f * (3 - 2 * f);
      const a = table[((i % 256) + 256) % 256];
      const b = table[(((i + 1) % 256) + 256) % 256];
      v += (a + (b - a) * s) * amp;
      norm += amp;
      amp *= 0.5; freq *= 2.1;
    }
    return v / norm;
  };
}

function hexToRgb(hex) {
  const h = String(hex || '').trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return { r: 20, g: 17, b: 15 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const c = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${c(a.r, b.r)},${c(a.g, b.g)},${c(a.b, b.b)})`;
}

/* 相对亮度（判断底色明暗）*/
function relLum(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/* ── 从 CSS 变量读配色 ────────────────────────────────── */
export function readPalette(root = document.documentElement) {
  const cs = getComputedStyle(root);
  const get = (name, fb) => (cs.getPropertyValue(name) || fb).trim() || fb;
  const bg = get('--bg', '#F4EFE4');
  const paper = get('--paper', '#2B241C');
  const accent2 = get('--accent-2', '#8A6413');
  /* 亮色底 → 天空提亮、阴影转暖；暗色底 → 天空压暗、阴影入墨 */
  const light = relLum(bg) > 0.35;
  return {
    bg,
    bg2: get('--bg-2', '#FBF8F1'),
    bg3: get('--bg-3', '#E9E0CD'),
    paper,
    paper2: get('--paper-2', '#5C5245'),
    paper3: get('--paper-3', '#756A5B'),
    accent: get('--accent', '#A62B1E'),
    accent2,
    accent3: get('--accent-3', '#3B4C68'),
    line: get('--line', 'rgba(43,36,28,.13)'),
    light,
    sky:  light ? '#FFFFFF' : '#000000',
    deep: light ? '#4A4133' : '#000000',
    lum:  light ? accent2 : paper,
    haze: light ? '#FFFFFF' : paper,
  };
}

/* ══════════════════════════════════════════════════════
   景别实现：每个返回 { draw(ctx, w, h, t, p) }
   p = { parallax:{x,y}, palette }
   ══════════════════════════════════════════════════════ */

function sceneMountain(rand, opts) {
  const noise = makeNoise(rand);
  const layers = Array.from({ length: 5 }, (_, i) => ({
    depth: (i + 1) / 5,
    amp: 0.16 - i * 0.022,
    freq: 0.9 + i * 0.55,
    off: rand() * 100,
  }));
  const moonX = opts.moonX ?? 0.72;
  const moonY = opts.moonY ?? 0.24;

  return {
    draw(ctx, w, h, t, p) {
      const { palette: pal, parallax: px } = p;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, mix(pal.bg, pal.sky, 0.25));
      sky.addColorStop(0.55, pal.bg);
      sky.addColorStop(1, mix(pal.bg, pal.accent, 0.06));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      /* 月/光源 */
      const mx = w * moonX + px.x * 26;
      const my = h * moonY + px.y * 16;
      const glow = ctx.createRadialGradient(mx, my, 0, mx, my, h * 0.42);
      glow.addColorStop(0, rgba(pal.accent2, 0.24));
      glow.addColorStop(0.4, rgba(pal.accent2, 0.07));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.beginPath();
      ctx.arc(mx, my, Math.min(w, h) * 0.032, 0, Math.PI * 2);
      ctx.fillStyle = rgba(pal.lum, 0.62);
      ctx.fill();

      /* 山脊：越远越淡、越高 */
      for (const L of layers) {
        const base = h * (0.52 + L.depth * 0.42);
        const shift = px.x * (12 + L.depth * 46);
        ctx.beginPath();
        ctx.moveTo(-40, h);
        for (let sx = -40; sx <= w + 40; sx += 7) {
          const n = noise(sx * 0.0042 * L.freq + L.off);
          const y = base - (n - 0.45) * h * L.amp * 2.1 + shift * 0.04;
          ctx.lineTo(sx, y);
        }
        ctx.lineTo(w + 40, h);
        ctx.closePath();
        const tint = mix(pal.bg3, pal.bg, L.depth);
        ctx.fillStyle = tint;
        ctx.globalAlpha = 0.92 - L.depth * 0.12;
        ctx.fill();
        ctx.globalAlpha = 1;

        /* 山脊线 */
        ctx.beginPath();
        for (let sx = -40; sx <= w + 40; sx += 7) {
          const n = noise(sx * 0.0042 * L.freq + L.off);
          const y = base - (n - 0.45) * h * L.amp * 2.1 + shift * 0.04;
          sx === -40 ? ctx.moveTo(sx, y) : ctx.lineTo(sx, y);
        }
        ctx.strokeStyle = rgba(pal.accent2, 0.13 - L.depth * 0.015);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      /* 谷底雾 */
      const mist = ctx.createLinearGradient(0, h * 0.62, 0, h);
      mist.addColorStop(0, 'rgba(0,0,0,0)');
      mist.addColorStop(1, rgba(pal.haze, 0.07));
      ctx.fillStyle = mist;
      ctx.fillRect(0, h * 0.62, w, h * 0.38);
    },
  };
}

function sceneRiver(rand) {
  const noise = makeNoise(rand);
  const hills = Array.from({ length: 3 }, (_, i) => ({
    depth: i / 3, amp: 0.1 - i * 0.02, freq: 1 + i * 0.6, off: rand() * 90,
  }));
  const horizon = 0.52;
  const glints = Array.from({ length: 90 }, () => ({
    x: rand(), y: rand(), w: 0.01 + rand() * 0.09, sp: 0.2 + rand() * 1.4,
  }));

  return {
    draw(ctx, w, h, t, p) {
      const { palette: pal, parallax: px } = p;
      const sky = ctx.createLinearGradient(0, 0, 0, h * horizon);
      sky.addColorStop(0, mix(pal.bg, pal.sky, 0.30));
      sky.addColorStop(1, mix(pal.bg, pal.accent2, 0.05));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      /* 对岸山 */
      for (const L of hills) {
        const base = h * (horizon - 0.02 + L.depth * 0.05);
        ctx.beginPath();
        ctx.moveTo(-40, h * horizon);
        for (let sx = -40; sx <= w + 40; sx += 8) {
          const n = noise(sx * 0.0035 * L.freq + L.off);
          ctx.lineTo(sx, base - (n - 0.5) * h * L.amp * 2 + px.x * (8 + L.depth * 24));
        }
        ctx.lineTo(w + 40, h * horizon);
        ctx.closePath();
        ctx.fillStyle = mix(pal.bg3, pal.bg, L.depth + 0.2);
        ctx.fill();
      }

      /* 水面 */
      const water = ctx.createLinearGradient(0, h * horizon, 0, h);
      water.addColorStop(0, mix(pal.bg, pal.accent2, 0.10));
      water.addColorStop(1, mix(pal.bg, pal.deep, 0.45));
      ctx.fillStyle = water;
      ctx.fillRect(0, h * horizon, w, h * (1 - horizon));

      /* 月路：随时间流动的光带 */
      const moonX = w * 0.66 + px.x * 30;
      const laneW = w * 0.2;
      for (const g of glints) {
        const y = h * horizon + Math.pow((g.y + t * 0.02 * g.sp) % 1, 1.4) * h * (1 - horizon);
        const spread = 0.25 + (y - h * horizon) / (h * (1 - horizon)) * 1.4;
        const x = moonX + (g.x - 0.5) * laneW * spread;
        const len = g.w * w * spread;
        ctx.strokeStyle = rgba(pal.accent2, 0.16 * (1 - (y - h * horizon) / (h * (1 - horizon))));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - len / 2, y);
        ctx.lineTo(x + len / 2, y);
        ctx.stroke();
      }

      /* 波纹 */
      ctx.strokeStyle = rgba(pal.paper, 0.05);
      ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const y = h * horizon + ((i + 0.5) / 26) ** 1.8 * h * (1 - horizon);
        ctx.beginPath();
        for (let sx = 0; sx <= w; sx += 14) {
          const yy = y + Math.sin(sx * 0.012 + t * 0.7 + i) * (1.2 + i * 0.06);
          sx === 0 ? ctx.moveTo(sx, yy) : ctx.lineTo(sx, yy);
        }
        ctx.stroke();
      }
    },
  };
}

/* 景别：火 · 一盏马灯。
   底色保持宣纸本色（不压暗），光是马灯洒出来的一圈暖红与金焰。 */
function sceneFire(rand) {
  const embers = Array.from({ length: 80 }, () => ({
    x: rand(), y: rand(), r: 0.6 + rand() * 2.2, sp: 0.08 + rand() * 0.4,
    ph: rand() * Math.PI * 2, sw: 0.01 + rand() * 0.03,
  }));
  const cx = 0.5, cy = 1.02;

  return {
    draw(ctx, w, h, t, p) {
      const { palette: pal, parallax: px } = p;

      /* 底：宣纸本色 */
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, w, h);

      const fx = w * cx + px.x * 30;
      const fy = h * cy + px.y * 18;

      /* 马灯洒下的一圈暖光 */
      const radius = Math.max(w, h) * 0.62;
      const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, radius);
      glow.addColorStop(0, rgba(pal.accent2, 0.13));
      glow.addColorStop(0.20, rgba(pal.accent, 0.07));
      glow.addColorStop(0.50, rgba(pal.accent, 0.028));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      /* 灯焰：根部朱红，梢上转金；只留几缕，不要成排的光条 */
      for (let i = 0; i < 7; i++) {
        const ang = -Math.PI / 2 + (i - 3) * 0.19;
        const len = h * (0.022 + 0.016 * Math.abs(Math.sin(t * 1.5 + i * 1.7)));
        const bx = fx + (i - 3) * w * 0.013;
        const tx = bx + Math.cos(ang) * len;
        const ty = fy + Math.sin(ang) * len;
        const g = ctx.createLinearGradient(bx, fy, tx, ty);
        g.addColorStop(0, rgba(pal.accent, 0.15));
        g.addColorStop(0.4, rgba(pal.accent2, 0.13));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx, fy);
        ctx.quadraticCurveTo(bx + Math.cos(ang) * len * 0.45, fy + Math.sin(ang) * len * 0.6, tx, ty);
        ctx.stroke();
      }

      /* 灯芯：一小团跳动的高光，藏在画面下缘 */
      const flick = 1 + Math.sin(t * 3.1) * 0.07 + Math.sin(t * 7.3) * 0.03;
      const coreR = h * 0.055 * flick;
      const core = ctx.createRadialGradient(fx, fy, 0, fx, fy, coreR);
      core.addColorStop(0, rgba('#FFFFFF', pal.light ? 0.26 : 0.34));
      core.addColorStop(0.3, rgba(pal.accent2, 0.16));
      core.addColorStop(0.72, rgba(pal.accent, 0.07));
      core.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(fx, fy, coreR, 0, Math.PI * 2);
      ctx.fill();

      /* 台口地光：把画面下缘托起来，避免中间空 */
      const floor = ctx.createLinearGradient(0, h * 0.72, 0, h);
      floor.addColorStop(0, 'rgba(0,0,0,0)');
      floor.addColorStop(1, rgba(pal.accent, pal.light ? 0.035 : 0.12));
      ctx.fillStyle = floor;
      ctx.fillRect(0, h * 0.72, w, h * 0.28);

      /* 台口的冷影：靛青压底，暖光才浮得起来 */
      const cool = ctx.createLinearGradient(0, h * 0.55, 0, h);
      cool.addColorStop(0, 'rgba(0,0,0,0)');
      cool.addColorStop(1, rgba(pal.accent3, pal.light ? 0.05 : 0.12));
      ctx.fillStyle = cool;
      ctx.fillRect(0, h * 0.55, w, h * 0.45);

      /* 火星 */
      for (const e of embers) {
        const life = (e.y + t * e.sp * 0.16) % 1;
        const y = h * (1 - life);
        const x = w * e.x + Math.sin(t * 0.9 + e.ph) * w * e.sw + px.x * 24;
        ctx.beginPath();
        ctx.arc(x, y, e.r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(life > 0.6 ? pal.accent : pal.accent2, 0.6 * (1 - life));
        ctx.fill();
      }
    },
  };
}

function sceneSea(rand) {
  const waves = Array.from({ length: 40 }, () => ({
    y: rand(), amp: 0.004 + rand() * 0.016, ph: rand() * 6.28, sp: 0.4 + rand() * 0.9,
  }));

  return {
    draw(ctx, w, h, t, p) {
      const { palette: pal, parallax: px } = p;
      const horizon = 0.48;
      const sky = ctx.createLinearGradient(0, 0, 0, h * horizon);
      sky.addColorStop(0, mix(pal.bg, pal.sky, 0.35));
      sky.addColorStop(1, mix(pal.bg, pal.accent2, 0.08));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      const mx = w * 0.34 + px.x * 22;
      const my = h * 0.2 + px.y * 14;
      const halo = ctx.createRadialGradient(mx, my, 0, mx, my, h * 0.3);
      halo.addColorStop(0, rgba(pal.lum, 0.16));
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);
      ctx.beginPath();
      ctx.arc(mx, my, Math.min(w, h) * 0.036, 0, Math.PI * 2);
      ctx.fillStyle = rgba(pal.paper, 0.72);
      ctx.fill();

      const sea = ctx.createLinearGradient(0, h * horizon, 0, h);
      sea.addColorStop(0, mix(pal.bg, pal.accent2, 0.12));
      sea.addColorStop(1, mix(pal.bg, pal.deep, 0.50));
      ctx.fillStyle = sea;
      ctx.fillRect(0, h * horizon, w, h * (1 - horizon));

      for (const wv of waves) {
        const y = h * horizon + wv.y * h * (1 - horizon);
        ctx.beginPath();
        for (let sx = 0; sx <= w; sx += 12) {
          const yy = y + Math.sin(sx * 0.008 + t * wv.sp + wv.ph) * h * wv.amp;
          sx === 0 ? ctx.moveTo(sx, yy) : ctx.lineTo(sx, yy);
        }
        ctx.strokeStyle = rgba(pal.paper, 0.05 + wv.y * 0.06);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
  };
}

function sceneStage(rand) {
  const folds = 26;
  const seats = Array.from({ length: 60 }, () => ({
    x: rand(), y: rand(), ph: rand() * 6.28,
  }));

  return {
    draw(ctx, w, h, t, p) {
      const { palette: pal, parallax: px } = p;
      ctx.fillStyle = mix(pal.bg, pal.deep, 0.50);
      ctx.fillRect(0, 0, w, h);

      /* 追光 */
      const sx = w * 0.5 + px.x * 34;
      const cone = ctx.createLinearGradient(sx, 0, sx, h);
      cone.addColorStop(0, rgba(pal.accent2, 0.16));
      cone.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(sx - w * 0.05, 0);
      ctx.lineTo(sx + w * 0.05, 0);
      ctx.lineTo(sx + w * 0.30, h);
      ctx.lineTo(sx - w * 0.30, h);
      ctx.closePath();
      ctx.fill();

      /* 幕布褶 */
      for (let i = 0; i < folds; i++) {
        const x = (i / folds) * w;
        const fw = w / folds;
        const shade = 0.5 + 0.5 * Math.sin(i * 1.7);
        ctx.fillStyle = rgba(pal.accent, 0.05 + shade * 0.07);
        ctx.fillRect(x, 0, fw, h * 0.72);
      }
      /* 台口 */
      ctx.fillStyle = mix(pal.bg, pal.deep, 0.30);
      ctx.fillRect(0, h * 0.72, w, h * 0.28);

      /* 尘埃 */
      for (const s of seats) {
        const y = (s.y + t * 0.012) % 1;
        ctx.beginPath();
        ctx.arc(w * s.x + Math.sin(t * 0.5 + s.ph) * 22, h * y, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = rgba(pal.lum, 0.22 * (1 - y));
        ctx.fill();
      }
    },
  };
}

function sceneForest(rand) {
  const noise = makeNoise(rand);
  const trees = Array.from({ length: 26 }, (_, i) => ({
    x: rand(), d: i / 26, w: 0.008 + rand() * 0.022, ph: rand() * 6.28,
  }));
  const flies = Array.from({ length: 26 }, () => ({ x: rand(), y: rand(), ph: rand() * 6.28 }));

  return {
    draw(ctx, w, h, t, p) {
      const { palette: pal, parallax: px } = p;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, mix(pal.bg, pal.sky, 0.20));
      sky.addColorStop(1, mix(pal.bg, pal.accent, 0.07));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      for (const tr of trees) {
        const x = w * tr.x + px.x * (10 + tr.d * 60);
        const th = h * (0.3 + tr.d * 0.72);
        const tw = w * tr.w;
        ctx.beginPath();
        ctx.moveTo(x - tw / 2, h);
        for (let sy = h; sy > h - th; sy -= 10) {
          const n = noise(sy * 0.01 + tr.ph);
          ctx.lineTo(x - tw / 2 + (n - 0.5) * tw * 0.5, sy);
        }
        ctx.lineTo(x + tw / 2, h - th);
        for (let sy = h - th; sy < h; sy += 10) {
          const n = noise(sy * 0.01 + tr.ph);
          ctx.lineTo(x + tw / 2 + (n - 0.5) * tw * 0.5, sy);
        }
        ctx.closePath();
        ctx.fillStyle = mix(pal.bg3, pal.bg, tr.d * 0.9);
        ctx.fill();
      }

      for (const f of flies) {
        const x = w * f.x + Math.sin(t * 0.6 + f.ph) * 40;
        const y = h * f.y + Math.cos(t * 0.45 + f.ph) * 26;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 16);
        glow.addColorStop(0, rgba(pal.accent2, 0.5));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - 16, y - 16, 32, 32);
      }
    },
  };
}

const SCENES = {
  mountain: sceneMountain,
  river: sceneRiver,
  fire: sceneFire,
  sea: sceneSea,
  stage: sceneStage,
  forest: sceneForest,
};

export const SCENE_NAMES = Object.keys(SCENES);

/* ══════════════════════════════════════════════════════
   主入口
   ══════════════════════════════════════════════════════ */
export function createStage(canvas, opts = {}) {
  if (!canvas) throw new Error('stage: canvas required');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('stage: 2d context unavailable');

  const reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let sceneName = SCENES[opts.scene] ? opts.scene : 'mountain';
  let palette = opts.palette || readPalette();
  let seed = hashStr(opts.seed || sceneName || 'stage');
  let scene = SCENES[sceneName](mulberry32(seed), opts);
  let raf = null, t0 = performance.now(), alive = true;
  let parallax = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function frame(now) {
    if (!alive) return;
    const { w, h } = size;
    const t = reduceMotion ? 0 : (now - t0) / 1000;
    parallax.x += (target.x - parallax.x) * 0.055;
    parallax.y += (target.y - parallax.y) * 0.055;
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, w, h);
    scene.draw(ctx, w, h, t, { palette, parallax });
    raf = requestAnimationFrame(frame);
  }

  let size = resize();

  const onResize = () => { size = resize(); };
  window.addEventListener('resize', onResize, { passive: true });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);
  }

  /* 指针视差 */
  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    target.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
  }
  window.addEventListener('pointermove', onMove, { passive: true });

  /* 拖动视差（HERO 上更强） */
  let dragging = false, dragStart = null;
  function onDown(e) {
    if (!e.target.closest || !e.target.closest('.hero')) return;
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, ox: target.x, oy: target.y };
    document.body.classList.add('dragging-scene');
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-scene');
    target.x = 0; target.y = 0;
  }
  function onDrag(e) {
    if (!dragging || !dragStart) return;
    target.x = dragStart.ox + (e.clientX - dragStart.x) / (window.innerWidth || 1) * 2.4;
    target.y = dragStart.oy + (e.clientY - dragStart.y) / (window.innerHeight || 1) * 1.6;
  }
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onDrag, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  /* 页面不可见时停帧 */
  const onVis = () => {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else if (!raf && alive) { t0 = performance.now(); raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVis);

  raf = requestAnimationFrame(frame);

  return {
    setScene(name, newSeed) {
      if (!SCENES[name]) return false;
      sceneName = name;
      seed = hashStr(newSeed || name);
      scene = SCENES[name](mulberry32(seed), opts);
      return true;
    },
    setPalette(p) {
      palette = Object.assign({}, palette, p || {});
    },
    destroy() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onDrag);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
