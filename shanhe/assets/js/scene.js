/* ============================================================
   《山河摆渡人》· 首页「山河长卷」
   Three.js / WebGL —— 多层视差 · 破晓 · 金沙江

   ────────────────────────────────────────────────────────────
   构图（相机 pos(0,6,26)，俯角 2°，垂直半视场 23°）
     0% – 20%    天空 · 金色太阳自山口升起
     20% – 53%   四层山峦（由远及近、由浅入深）
     53% – 73%   金沙江 · 粼光倒影 · 竹筏与小船
     73% – 100%  近岸 · 彝寨火塘 · 待渡的战士

   视觉语言（参考 fable 5.5 版画风）
     每层山峦用**平涂色阶**区分远近，不做雾化混合；
     钢笔排线做肌理；山脊迎光处镶金边；纸纹颗粒。

   交互
     横向拖动  →  各层按视差系数错开，拉出纵深
     向上/向右 →  太阳自山后升起，天色转朱砂金，山脊镶金边，
                  江面铺开粼光（破晓 0 → 1）
   ============================================================ */
import * as THREE from './three.module.js';

/* ============================================================
   工具
   ============================================================ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

const GLSL_NOISE = /* glsl */`
float hash21(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

/* ============================================================
   天空
   ============================================================ */
const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const SKY_FRAG = /* glsl */`
precision highp float;
uniform vec3  uNightTop, uNightMid, uNightBot;
uniform vec3  uDawnTop,  uDawnMid,  uDawnBot;
uniform vec2  uSunUv;
uniform float uAspect;
uniform float uDawn;
uniform float uFade;
varying vec2 vUv;
${GLSL_NOISE}

void main(){
  vec3 top = mix(uNightTop, uDawnTop, uDawn);
  vec3 mid = mix(uNightMid, uDawnMid, uDawn);
  vec3 bot = mix(uNightBot, uDawnBot, uDawn);

  float y = vUv.y;
  vec3 col = y > 0.5 ? mix(mid, top, (y - 0.5) * 2.0)
                      : mix(bot, mid, y * 2.0);

  /* ── 太阳：画在天空层（无穷远），山峦自然遮挡它 ── */
  vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
  float r = length(d);

  // 外晕（大范围暖光，破晓时铺满天色）
  float glow = exp(-r * 4.2) * (0.16 + 0.84 * uDawn);
  col += vec3(1.0, 0.66, 0.26) * glow * 0.55;
  // 中晕
  col += vec3(1.0, 0.78, 0.38) * exp(-r * 11.0) * (0.30 + 0.70 * uDawn) * 0.85;

  // 日轮（升起过程中逐渐完整、由暗红转金）
  float R = 0.072;
  float disc = smoothstep(R, R * 0.965, r);
  float rings = 0.5 + 0.5 * sin(r / R * 24.0);
  float rays  = 0.5 + 0.5 * sin(atan(d.y, d.x) * 30.0);
  vec3 sunCol = mix(vec3(1.0, 0.96, 0.80), vec3(1.0, 0.60, 0.15),
                    smoothstep(0.06, 1.0, r / R));
  sunCol *= 0.92 + 0.08 * rings * 0.6 + 0.05 * rays * 0.5;
  // 盘缘高光环
  float halo = smoothstep(0.80, 0.985, r / R) * (1.0 - smoothstep(0.985, 1.0, r / R));
  sunCol += vec3(1.0, 0.92, 0.62) * halo * 1.0;
  // 未出山时日轮黯淡、偏赭
  sunCol = mix(vec3(0.58, 0.24, 0.15), sunCol, 0.30 + 0.70 * uDawn);
  col = mix(col, sunCol, disc * (0.30 + 0.70 * uDawn));

  // 地平线暖光
  float hz = exp(-abs(y - 0.44) * 9.0);
  col += vec3(0.96, 0.50, 0.20) * hz * (0.10 + 0.70 * uDawn);

  // 钢笔细排线
  col *= 1.0 + sin((vUv.x * 1.7 + vUv.y * 1.1) * 520.0) * 0.016;

  // 纸纹颗粒
  col += (fbm(vUv * vec2(520.0, 320.0)) - 0.5) * 0.032;

  gl_FragColor = vec4(col, uFade);
}
`;

/* ============================================================
   太阳 · 圆盘 + 外晕
   ============================================================ */
const SUN_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform float uDawn;
uniform float uFade;
varying vec2 vUv;

void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  float edge = smoothstep(1.0, 0.960, r);
  float rings = 0.5 + 0.5 * sin(r * 40.0 - uTime * 0.26);
  float rays  = 0.5 + 0.5 * sin(atan(p.y, p.x) * 30.0 + uTime * 0.15);

  vec3 col = mix(vec3(1.0, 0.94, 0.74), vec3(0.99, 0.60, 0.17), smoothstep(0.06, 1.0, r));
  col *= 0.90 + 0.10 * rings * 0.6 + 0.06 * rays * 0.5;

  // 盘缘高光环
  float halo = smoothstep(0.74, 0.982, r) * (1.0 - smoothstep(0.982, 1.0, r));
  col += vec3(1.0, 0.88, 0.55) * halo * 0.9;

  col = mix(vec3(0.52, 0.26, 0.20), col, 0.34 + 0.66 * uDawn);

  gl_FragColor = vec4(col, edge * uFade);
}
`;

const CORONA_FRAG = /* glsl */`
precision highp float;
uniform float uDawn;
uniform float uTime;
uniform float uFade;
varying vec2 vUv;

void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  float fall = pow(1.0 - r, 3.0);
  float rays = 0.5 + 0.5 * sin(atan(p.y, p.x) * 11.0 + uTime * 0.09);
  float a = fall * (0.40 + 0.60 * rays) * (0.06 + 0.94 * uDawn);

  vec3 col = mix(vec3(0.86, 0.32, 0.17), vec3(1.0, 0.76, 0.36), uDawn);
  gl_FragColor = vec4(col * a * 1.6, a * uFade);
}
`;

/* ============================================================
   山峦（平涂色阶 + 迎光金边 + 排线）
   —— 顶点带 aCrest，片元按「距山脊的距离」画镶边
   ============================================================ */
const RIDGE_VERT = /* glsl */`
attribute float aCrest;
varying float vDist;
varying vec3 vPosW;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vDist = aCrest - wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RIDGE_FRAG = /* glsl */`
precision highp float;
uniform vec3  uBody;       // 平涂色阶
uniform vec3  uBodyDawn;   // 破晓时的色阶
uniform vec3  uRimNight;
uniform vec3  uRimDawn;
uniform float uSunX;       // 太阳的屏幕横坐标 0..1
uniform vec2  uRes;
uniform float uRimW;
uniform float uHatchScale;
uniform float uHatchAngle;
uniform float uDawn;
uniform float uFade;
varying float vDist;
varying vec3 vPosW;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }

float hatch(float angle, float scale){
  float s = sin(angle), c = cos(angle);
  vec2 q = vec2(gl_FragCoord.x * c - gl_FragCoord.y * s,
                gl_FragCoord.x * s + gl_FragCoord.y * c) * scale;
  float v = fract(q.y);
  float d = min(v, 1.0 - v);
  return 1.0 - smoothstep(0.0, fwidth(q.y) * 1.7 + 0.001, d);
}

void main(){
  vec3 body = mix(uBody, uBodyDawn, uDawn);

  // 屏幕横坐标：越靠近太阳，受光越强（跨层对齐）
  float sx = gl_FragCoord.x / uRes.x;
  float sunSide = exp(-abs(sx - uSunX) * 3.0);

  // 朝太阳一侧的坡面提亮，形成体积感（破晓时加强）
  body = mix(body, body * 2.10 + vec3(0.20, 0.09, 0.03) * uDawn,
             sunSide * (0.10 + 0.72 * uDawn));

  // 钢笔排线
  body *= 1.0 - hatch(uHatchAngle, uHatchScale) * 0.20;

  // 山脊镶边（迎光）—— 破晓时逆光勾边，是版画感的关键
  float rim = smoothstep(uRimW, 0.0, vDist);
  vec3 rimCol = mix(uRimNight, uRimDawn, uDawn);
  float rimAmt = rim * (0.18 + 0.82 * sunSide) * (0.20 + 0.80 * uDawn);
  body = mix(body, rimCol, rimAmt * 0.95);
  // 紧贴山脊的一道锐利高光线
  float crest = smoothstep(uRimW * 0.22, 0.0, vDist);
  body = mix(body, rimCol * 1.25, crest * (0.10 + 0.55 * uDawn) * (0.25 + 0.75 * sunSide));

  body += (hash21(gl_FragCoord.xy * 0.55) - 0.5) * 0.030;

  gl_FragColor = vec4(body, uFade);
}
`;

/* ============================================================
   江面
   ============================================================ */
const WATER_VERT = /* glsl */`
varying vec3 vPosW;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform float uDawn;
uniform float uFade;
uniform float uSunX;
uniform vec2  uRes;
uniform vec3  uDeep;
uniform vec3  uSurface;
uniform vec3  uGold;
uniform vec3  uHaze;
varying vec3 vPosW;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }

void main(){
  vec2 p = vPosW.xz;

  // 三组不同频率的相位 → 自然流动的排线
  float ph1 = p.y * 0.42 + sin(p.x * 0.22 + uTime * 0.50) * 0.90 + uTime * 0.85;
  float ph2 = p.y * 0.20 + sin(p.x * 0.09 - uTime * 0.28) * 1.40 + uTime * 0.40;
  float ph3 = p.y * 1.05 + sin(p.x * 0.58 + uTime * 1.00) * 0.40 + uTime * 1.45;

  float l1 = smoothstep(0.20, 0.0, abs(fract(ph1) - 0.5));
  float l2 = smoothstep(0.13, 0.0, abs(fract(ph2) - 0.5));
  float l3 = smoothstep(0.26, 0.0, abs(fract(ph3) - 0.5));
  float lines = clamp(l1 * 0.90 + l2 * 0.55 + l3 * 0.40, 0.0, 1.0);

  vec3 col = mix(uDeep, uSurface, smoothstep(0.0, 0.80, lines));

  // 远端融入雾色（远岸）
  float far = smoothstep(-66.0, -26.0, p.y);
  col = mix(col, uHaze, far * 0.92);

  // 金色倒影带：与太阳同一条屏幕垂线，越近越宽、越碎
  float sx = gl_FragCoord.x / uRes.x;
  float dx = abs(sx - uSunX) * uRes.x / uRes.y;   // 归一化到短边
  float band = exp(-dx * dx * 26.0);
  float near = smoothstep(-60.0, 10.0, p.y);
  float shimmer = 0.28 + 0.72 * lines;
  col += uGold * band * shimmer * (0.05 + 0.95 * uDawn) * (0.50 + 0.80 * near);

  // 碎金高光
  float sp = step(0.9960, hash21(floor(p * vec2(3.0, 6.0) + floor(uTime * 6.0))));
  col += uGold * sp * band * uDawn * 0.95;

  col += (hash21(gl_FragCoord.xy * 0.5) - 0.5) * 0.028;

  gl_FragColor = vec4(col, uFade);
}
`;

/* ============================================================
   火焰粒子
   ============================================================ */
const FLAME_VERT = /* glsl */`
attribute float aSize;
attribute float aSeed;
attribute float aSpeed;
uniform float uTime;
uniform float uPixelRatio;
varying float vLife;
varying float vSeed;

void main(){
  vSeed = aSeed;
  float t = mod(uTime * aSpeed + aSeed * 7.31, 1.0);
  float y = t * 4.4;
  float sway = sin(uTime * (1.1 + aSeed * 2.2) + aSeed * 19.7) * (0.30 + t * 0.78);
  float drift = cos(uTime * (0.7 + aSeed) + aSeed * 11.3) * (0.16 + t * 0.44);
  float cone = 1.0 - t * 0.48;
  vec3 pos = vec3((sway + drift) * cone, y - 0.35, (sway * 0.42 - drift * 0.3) * cone);
  vLife = smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.48, 1.0, t));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = aSize * (1.0 - t * 0.6) * uPixelRatio;
  gl_PointSize = clamp(sz * (16.0 / max(-mv.z, 0.1)), 1.5, 46.0);
}
`;

const FLAME_FRAG = /* glsl */`
precision highp float;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uBreathe;
uniform float uFade;
varying float vLife;
varying float vSeed;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.02, d) * vLife;
  float core = smoothstep(0.30, 0.0, d);
  vec3 col = mix(uCool, uHot, core * (0.42 + vSeed * 0.45));
  col = mix(col, vec3(1.0, 0.93, 0.76), core * core * vLife * 0.7);
  col *= uBreathe;
  gl_FragColor = vec4(col, a * 0.50 * uFade);
}
`;

/* ============================================================
   地面 / 石块（排线材质）
   ============================================================ */
const HATCH_VERT = /* glsl */`
varying vec3 vNormalW;
varying vec3 vPosW;
varying float vDepth;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const HATCH_FRAG = /* glsl */`
precision highp float;
uniform vec3  uLightDir;
uniform vec3  uInk;
uniform vec3  uPaper;
uniform vec3  uGlow;
uniform vec3  uFirePos;
uniform float uGlowPower;
uniform float uLineScale;
uniform float uAngle;
uniform float uOpacity;
uniform float uDawn;
uniform float uFade;
varying vec3 vNormalW;
varying vec3 vPosW;
varying float vDepth;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float hatchLine(vec2 p, float angle, float scale){
  float s = sin(angle), c = cos(angle);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c) * scale;
  float v = fract(q.y);
  float d = min(v, 1.0 - v);
  return 1.0 - smoothstep(0.0, fwidth(q.y) * 1.6 + 0.001, d);
}

void main(){
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightDir);

  float diff = max(dot(N, L), 0.0);
  float wrapped = diff * 0.72 + 0.28 * max(dot(N, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0);

  float distToFire = length(vPosW.xz - uFirePos.xz);
  float fire = exp(-distToFire / uGlowPower);
  float upFacing = max(N.y, 0.0);
  float fireLight = fire * (0.35 + 0.65 * upFacing);

  float lum = clamp(wrapped * 0.55 + fireLight * 0.95, 0.0, 1.4);

  vec2 sp = gl_FragCoord.xy;
  float density = mix(0.55, 1.0, 1.0 - clamp(lum, 0.0, 1.0));
  float l1 = hatchLine(sp, uAngle, uLineScale) * density;
  float l2 = hatchLine(sp, uAngle + 1.05, uLineScale * 1.35) * density * 0.6;
  float lines = clamp(l1 + l2, 0.0, 1.0);
  float inkAmt = clamp(1.0 - lum * 0.78, 0.0, 1.0);

  vec3 base = mix(uInk, uPaper, clamp(lum * 0.85, 0.0, 1.0));
  base = mix(base, uGlow, clamp(fireLight * 0.62, 0.0, 0.82));
  vec3 col = mix(base, uInk, lines * inkAmt * 0.86);
  col += uGlow * pow(fireLight, 2.2) * 0.28;

  col = mix(col, col * vec3(1.30, 1.05, 0.80) + vec3(0.05, 0.02, 0.0), uDawn * 0.42);

  col += (hash(sp * 0.7) - 0.5) * 0.035;

  gl_FragColor = vec4(col, uOpacity * uFade);
}
`;

/* ============================================================
   剪影绘制
   ============================================================ */
function drawSoldier(g, fx, fy, H, opt = {}) {
  const u = H / 100;
  const P = (x, y) => [fx + x * u, fy - y * u];
  g.fillStyle = '#000';

  // 双腿
  g.beginPath();
  g.moveTo(...P(-9, 47)); g.lineTo(...P(9, 47));
  g.lineTo(...P(12, 25)); g.lineTo(...P(14, 2));
  g.lineTo(...P(6.5, 2)); g.lineTo(...P(4, 25));
  g.lineTo(...P(3, 2)); g.lineTo(...P(-4.5, 2));
  g.lineTo(...P(-6, 25));
  g.closePath(); g.fill();

  // 躯干
  g.beginPath();
  g.moveTo(...P(-11, 46)); g.lineTo(...P(11, 46));
  g.lineTo(...P(13.5, 78)); g.lineTo(...P(-12.5, 79));
  g.closePath(); g.fill();

  // 背包
  if (opt.pack !== false) {
    g.beginPath();
    g.moveTo(...P(-12, 75)); g.lineTo(...P(-21, 72));
    g.lineTo(...P(-22, 48)); g.lineTo(...P(-12, 48));
    g.closePath(); g.fill();
  }

  // 前臂
  g.beginPath();
  g.moveTo(...P(9, 76)); g.lineTo(...P(21, 57));
  g.lineTo(...P(25.5, 61)); g.lineTo(...P(14, 81));
  g.closePath(); g.fill();

  // 头
  g.beginPath();
  g.arc(fx + 1 * u, fy - 87 * u, 7.4 * u, 0, Math.PI * 2);
  g.fill();

  // 军帽
  g.beginPath();
  g.ellipse(fx + 1 * u, fy - 92 * u, 9.2 * u, 3.8 * u, 0, Math.PI, 0);
  g.fill();
  g.beginPath();
  g.moveTo(...P(-8.5, 91)); g.lineTo(...P(11, 88.6));
  g.lineTo(...P(11, 92)); g.lineTo(...P(-8.5, 94));
  g.closePath(); g.fill();

  // 步枪
  if (opt.rifle !== false) {
    g.save();
    g.translate(fx + 6 * u, fy - 60 * u);
    g.rotate(-0.52);
    g.fillRect(-1.7 * u, -33 * u, 3.4 * u, 66 * u);
    g.fillRect(-4.0 * u, -8 * u, 8.0 * u, 3.0 * u);
    g.restore();
  }
}

function drawBoatman(g, fx, fy, H) {
  const u = H / 100;
  const P = (x, y) => [fx + x * u, fy - y * u];
  g.fillStyle = '#000';

  g.beginPath();
  g.moveTo(...P(-8, 46)); g.lineTo(...P(8, 46));
  g.lineTo(...P(11, 24)); g.lineTo(...P(13, 2));
  g.lineTo(...P(6, 2)); g.lineTo(...P(4, 24));
  g.lineTo(...P(2, 2)); g.lineTo(...P(-5, 2));
  g.lineTo(...P(-7, 24));
  g.closePath(); g.fill();

  g.beginPath();
  g.moveTo(...P(-10, 45)); g.lineTo(...P(9, 45));
  g.lineTo(...P(20, 70)); g.lineTo(...P(11, 76));
  g.closePath(); g.fill();

  g.beginPath();
  g.arc(fx + 17 * u, fy - 77 * u, 6.8 * u, 0, Math.PI * 2);
  g.fill();

  g.beginPath();
  g.moveTo(...P(13, 68)); g.lineTo(...P(30, 58));
  g.lineTo(...P(33, 62)); g.lineTo(...P(16, 73));
  g.closePath(); g.fill();

  g.save();
  g.translate(fx + 20 * u, fy - 52 * u);
  g.rotate(0.62);
  g.fillRect(-1.5 * u, -46 * u, 3.0 * u, 92 * u);
  g.restore();
}

function drawRaft(g, fx, fy, W, H) {
  const u = H / 100;
  g.fillStyle = '#000';
  const rw = W * 0.5;
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const y = fy - (2 + t * 7) * u;
    const w = rw * (1 - Math.abs(t - 0.5) * 0.34);
    g.beginPath();
    g.ellipse(fx, y, w, 1.9 * u, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillRect(fx - rw * 0.72, fy - 9 * u, rw * 0.10, 9 * u);
  g.fillRect(fx + rw * 0.62, fy - 9 * u, rw * 0.10, 9 * u);
  drawBoatman(g, fx - rw * 0.42, fy - 6 * u, H * 0.92);
}

function drawBoat(g, fx, fy, W, H) {
  const u = H / 100;
  g.fillStyle = '#000';

  g.beginPath();
  g.moveTo(fx - W * 0.5, fy);
  g.quadraticCurveTo(fx - W * 0.34, fy + 9 * u, fx, fy + 11 * u);
  g.quadraticCurveTo(fx + W * 0.36, fy + 9 * u, fx + W * 0.5, fy - 1 * u);
  g.lineTo(fx + W * 0.44, fy - 4 * u);
  g.quadraticCurveTo(fx, fy - 7 * u, fx - W * 0.44, fy - 4 * u);
  g.closePath(); g.fill();

  g.beginPath();
  g.moveTo(fx - W * 0.16, fy - 4 * u);
  g.quadraticCurveTo(fx, fy - 30 * u, fx + W * 0.16, fy - 4 * u);
  g.closePath(); g.fill();

  drawSoldier(g, fx - W * 0.33, fy - 4 * u, H * 0.78, { pack: false });
  drawBoatman(g, fx + W * 0.30, fy - 4 * u, H * 0.76);
}

function drawReeds(g, x, y, W, H, seed = 1) {
  let r = seed * 9301;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  g.strokeStyle = '#000';
  g.fillStyle = '#000';
  g.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const bx = x + (rnd() - 0.5) * W;
    const h = H * (0.45 + rnd() * 0.75);
    const bend = (rnd() - 0.5) * H * 0.42;
    g.lineWidth = H * (0.020 + rnd() * 0.016);
    g.beginPath();
    g.moveTo(bx, y);
    g.quadraticCurveTo(bx + bend * 0.4, y - h * 0.6, bx + bend, y - h);
    g.stroke();
    g.beginPath();
    g.ellipse(bx + bend, y - h - H * 0.035, H * 0.016, H * 0.062, 0, 0, Math.PI * 2);
    g.fill();
  }
}

function drawBirds(g, x, y, W, H, seed = 3) {
  let r = seed * 6971;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  g.strokeStyle = '#000';
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const bx = x + (rnd() - 0.5) * W;
    const by = y + (rnd() - 0.5) * H * 0.6;
    const s = H * (0.10 + rnd() * 0.10);
    g.lineWidth = Math.max(1, H * 0.016);
    g.beginPath();
    g.moveTo(bx - s, by);
    g.quadraticCurveTo(bx - s * 0.4, by - s * 0.55, bx, by - s * 0.12);
    g.quadraticCurveTo(bx + s * 0.4, by - s * 0.55, bx + s, by);
    g.stroke();
  }
}

function silhouetteMaterial(w, h, draw, color = 0x0a0506) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return new THREE.MeshBasicMaterial({
    map: tex,
    color,
    transparent: true,
    depthWrite: false,
    alphaTest: 0.02,
  });
}

/* ============================================================
   山峦几何（三角带 + 山脊高度属性）
   ============================================================ */
function buildRidge({ w, base, samples = 140, crestFn }) {
  const pos = [], crest = [], idx = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const x = (u - 0.5) * w;
    const y = crestFn(u);
    pos.push(x, y, 0);
    crest.push(y);
    pos.push(x, base, 0);
    crest.push(y);
  }
  for (let i = 0; i < samples; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aCrest', new THREE.Float32BufferAttribute(crest, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* 山形曲线：峰 + 起伏 + 山口（太阳升起的豁口） */
function rangeShape(peaks, saddle, seed) {
  return (u) => {
    let y = 0;
    for (const p of peaks) {
      const d = (u - p.c) / p.w;
      y += p.a * Math.exp(-d * d * 2.2);
    }
    // 山口：在指定位置压低，供太阳透出
    if (saddle) {
      const d = (u - saddle.u) / saddle.w;
      y *= 1 - saddle.depth * Math.exp(-d * d * 1.6);
    }
    y *= 0.66 + 0.34 * (0.5 + 0.5 * Math.sin(u * 13.7 + seed) * Math.sin(u * 5.3 - seed * 1.7));
    return Math.max(0, y);
  };
}

/* ============================================================
   场景搭建
   ============================================================ */
export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x14090b, 1);
  renderer.autoClear = false;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 相机：站在近岸，眼高于水面 6 单位，俯角 2° ── */
  const CAM_Y = 6, CAM_Z = 26, PITCH = 2 * Math.PI / 180;
  const camera = new THREE.PerspectiveCamera(
    46, window.innerWidth / window.innerHeight, 0.5, 500);
  camera.position.set(0, CAM_Y, CAM_Z);
  camera.lookAt(0, CAM_Y - 106 * Math.tan(PITCH), -80);

  /* 窄屏（竖屏）时视野更窄 → 相机后撤并抬高，
     让左右两侧的江岸、人物仍能落在画面内 */
  function applyCameraFraming() {
    const a = camera.aspect;
    if (a < 0.85) {
      camera.position.z = CAM_Z + 30;
      camera.position.y = CAM_Y + 5;
      camera.fov = 52;
    } else if (a < 1.3) {
      camera.position.z = CAM_Z + 12;
      camera.position.y = CAM_Y + 2;
      camera.fov = 49;
    } else {
      camera.position.z = CAM_Z;
      camera.position.y = CAM_Y;
      camera.fov = 46;
    }
    camera.userData.baseY = camera.position.y;
    camera.userData.baseZ = camera.position.z;
    camera.updateProjectionMatrix();
  }

  /* ── 共享 uniform ── */
  const shared = {
    uDawn: { value: 0 },
    uFade: { value: 1 },
    uTime: { value: 0 },
    uSunX: { value: 0.66 },
    uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  };

  /* ── 背景（天空） ── */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uNightTop: { value: new THREE.Color(0x0e0507) },
      uNightMid: { value: new THREE.Color(0x280f13) },
      uNightBot: { value: new THREE.Color(0x541c18) },
      uDawnTop:  { value: new THREE.Color(0x5e1f16) },
      uDawnMid:  { value: new THREE.Color(0xb2421f) },
      uDawnBot:  { value: new THREE.Color(0xf0a03e) },
      uSunUv:    { value: new THREE.Vector2(0.68, 0.55) },
      uAspect:   { value: window.innerWidth / window.innerHeight },
      uDawn:     shared.uDawn,
      uFade:     shared.uFade,
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat));

  /* ── 主场景 ── */
  const scene = new THREE.Scene();

  /* ── 太阳位置：画在天空层（无穷远），由破晓进度驱动升起 ──
     屏幕横坐标 0.715（偏右，避开正中的标题）。
     纵坐标：0.22（藏在远山后）→ 0.70（完全升起于山脊之上） */
  const SUN_SCREEN_X = 0.715;
  const SUN_Y_LOW = 0.22, SUN_Y_HIGH = 0.70;

  /* ── 四层山峦 ──
     屏幕落点 20% / 28% / 36% / 44%；
     颜色由远及近加深（平涂色阶，非雾化） */
  const RIDGES = [
    { z: -150, w: 270, base: -14, y: 42.8, hatch: 0.070, ang: 0.55, rim: 3.0, px: 0.05,
      body: 0x58291f, bodyDawn: 0x9c4a2a,
      peaks: [{ c: 0.16, w: 0.15, a: 1.0 }, { c: 0.40, w: 0.12, a: 0.66 }, { c: 0.86, w: 0.16, a: 0.94 }],
      saddle: { u: 0.645, w: 0.085, depth: 0.55 } },
    { z: -122, w: 230, base: -12, y: 27.1, hatch: 0.090, ang: 0.72, rim: 2.4, px: 0.13,
      body: 0x401c19, bodyDawn: 0x7d3624,
      peaks: [{ c: 0.24, w: 0.17, a: 0.92 }, { c: 0.60, w: 0.14, a: 0.78 }, { c: 0.92, w: 0.12, a: 0.62 }],
      saddle: { u: 0.672, w: 0.080, depth: 0.62 } },
    { z: -100, w: 190, base: -10, y: 15.8, hatch: 0.115, ang: 0.48, rim: 2.0, px: 0.26,
      body: 0x2c1315, bodyDawn: 0x5e2620,
      peaks: [{ c: 0.20, w: 0.16, a: 0.88 }, { c: 0.48, w: 0.20, a: 1.0 }, { c: 0.80, w: 0.15, a: 0.70 }],
      saddle: { u: 0.711, w: 0.070, depth: 0.66 } },
    { z: -82,  w: 165, base: -8,  y: 7.43, hatch: 0.145, ang: 0.86, rim: 1.5, px: 0.48,
      body: 0x190a0d, bodyDawn: 0x381618,
      peaks: [{ c: 0.18, w: 0.18, a: 0.85 }, { c: 0.52, w: 0.22, a: 1.0 }, { c: 0.88, w: 0.13, a: 0.60 }],
      saddle: { u: 0.737, w: 0.060, depth: 0.70 } },
  ];

  const ridges = [];
  RIDGES.forEach((r, i) => {
    const shape = rangeShape(r.peaks, r.saddle, 3.1 + i * 4.7);
    let max = 0;
    for (let k = 0; k <= 240; k++) max = Math.max(max, shape(k / 240));
    const scale = (r.y - r.base) / Math.max(max, 1e-6);
    const geo = buildRidge({
      w: r.w, base: r.base, samples: 160,
      crestFn: (u) => r.base + shape(u) * scale,
    });
    const mat = new THREE.ShaderMaterial({
      vertexShader: RIDGE_VERT,
      fragmentShader: RIDGE_FRAG,
      uniforms: {
        uBody:       { value: new THREE.Color(r.body) },
        uBodyDawn:   { value: new THREE.Color(r.bodyDawn) },
        uRimNight:   { value: new THREE.Color(0x5c2a26) },
        uRimDawn:    { value: new THREE.Color(0xffc266) },
        uSunX:       shared.uSunX,
        uRes:        shared.uRes,
        uRimW:       { value: r.rim },
        uHatchScale: { value: r.hatch },
        uHatchAngle: { value: r.ang },
        uDawn:       shared.uDawn,
        uFade:       shared.uFade,
      },
      transparent: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = r.z;
    mesh.renderOrder = -50 + i;
    mesh.userData.px = r.px;
    mesh.userData.baseX = 0;
    scene.add(mesh);
    ridges.push(mesh);
  });

  /* ── 江面（z −74 → −1，远处融入雾色） ── */
  const waterMat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime:    shared.uTime,
      uDawn:    shared.uDawn,
      uFade:    shared.uFade,
      uSunX:    shared.uSunX,
      uRes:     shared.uRes,
      uDeep:    { value: new THREE.Color(0x180b0d) },
      uSurface: { value: new THREE.Color(0x6b3128) },
      uGold:    { value: new THREE.Color(0xffb648) },
      uHaze:    { value: new THREE.Color(0x53231c) },
    },
    transparent: true,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(260, 74, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, -37);      // z 范围 −74 → 0
  water.renderOrder = -20;
  water.userData.baseX = 0;
  scene.add(water);

  /* ── 近岸地面（z 0 → 42，排线材质） ──
     火塘置于近岸左侧，屏幕落在画面左下角 */
  const firePos = new THREE.Vector3(-9.4, 0, 8);
  const hatchMat = (opts = {}) => new THREE.ShaderMaterial({
    vertexShader: HATCH_VERT,
    fragmentShader: HATCH_FRAG,
    uniforms: {
      uLightDir:   { value: new THREE.Vector3(-0.55, 0.72, 0.42).normalize() },
      uInk:        { value: new THREE.Color(opts.ink ?? 0x3d1518) },
      uPaper:      { value: new THREE.Color(opts.paper ?? 0x6d2a24) },
      uGlow:       { value: new THREE.Color(opts.glow ?? 0xc8323f) },
      uFirePos:    { value: firePos },
      uGlowPower:  { value: opts.glowPower ?? 4.2 },
      uLineScale:  { value: opts.lineScale ?? 0.13 },
      uAngle:      { value: opts.angle ?? 0.62 },
      uOpacity:    { value: opts.opacity ?? 1.0 },
      uDawn:       shared.uDawn,
      uFade:       shared.uFade,
    },
    side: opts.side ?? THREE.FrontSide,
    transparent: true,
  });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 42, 1, 1),
    hatchMat({ lineScale: 0.17, angle: 1.02, ink: 0x2e1013, paper: 0x5a2320, glowPower: 5.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 21);      // z 范围 0 → 42
  ground.renderOrder = -10;
  ground.userData.baseX = 0;
  scene.add(ground);

  /* ── 火塘 ── */
  const fireGroup = new THREE.Group();
  fireGroup.position.set(firePos.x, firePos.y, firePos.z);
  fireGroup.scale.setScalar(0.52);
  scene.add(fireGroup);

  {
    const m = hatchMat({
      lineScale: 0.19, angle: 1.02,
      glow: 0xc8323f, glowPower: 3.0,
      ink: 0x351214, paper: 0x66271f,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7.0, 40), m);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.renderOrder = -8;
    fireGroup.add(floor);
  }

  {
    const stones = new THREE.Group();
    const stoneMat = hatchMat({
      lineScale: 0.30, angle: 0.34,
      glow: 0xc8323f, glowPower: 3.0,
      ink: 0x45191d, paper: 0x83412f,
    });
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2;
      const rad = 1.72 + Math.sin(i * 2.7) * 0.14;
      const s = 0.36 + Math.abs(Math.sin(i * 1.9)) * 0.26;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stoneMat);
      st.position.set(Math.cos(a) * rad, s * 0.42 + 0.55, Math.sin(a) * rad);
      st.rotation.set(i * 0.7, i * 1.3, i * 0.4);
      st.scale.set(1, 0.78, 1);
      st.renderOrder = -8;
      stones.add(st);
    }
    fireGroup.add(stones);
  }

  const FLAME_N = 300;
  const pos = new Float32Array(FLAME_N * 3);
  const size = new Float32Array(FLAME_N);
  const seedA = new Float32Array(FLAME_N);
  const speed = new Float32Array(FLAME_N);
  for (let i = 0; i < FLAME_N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.55) * 1.30;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = Math.sin(a) * r;
    size[i] = 10 + Math.random() * 15;
    seedA[i] = Math.random();
    speed[i] = 0.16 + Math.random() * 0.30;
  }
  const flameGeo = new THREE.BufferGeometry();
  flameGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  flameGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  flameGeo.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 1));
  flameGeo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));

  const flameMat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uHot: { value: new THREE.Color(0xfff4d8) },
      uCool: { value: new THREE.Color(0xf08a42) },
      uBreathe: { value: 1 },
      uFade: shared.uFade,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flames = new THREE.Points(flameGeo, flameMat);
  flames.position.y = 0.55;
  flames.renderOrder = -6;
  fireGroup.add(flames);

  /* ── 人物剪影 ── */
  const sprites = [];

  function placeSprite(mesh, cw, ch, ax, ay, tx, ty, tz) {
    const W = mesh.geometry.parameters.width;
    const H = mesh.geometry.parameters.height;
    mesh.position.x = tx + W / 2 - (ax / cw) * W;
    mesh.position.y = ty + H / 2 - (1 - ay / ch) * H;
    if (tz !== undefined) mesh.position.z = tz;
    mesh.userData.baseX = mesh.position.x;
    return mesh;
  }

  /* 战士：脚在 (x, 0)，面向右 */
  function addSoldier(x, z, height, opt = {}) {
    const cw = 320, ch = 512, feet = 500, bodyPx = 470;
    const mat = silhouetteMaterial(cw, ch, (g) => drawSoldier(g, cw / 2, feet, bodyPx, opt));
    const H = height * ch / bodyPx;
    const W = H * cw / ch;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    placeSprite(mesh, cw, ch, cw / 2, feet, x, opt.groundY ?? 0, z);
    mesh.renderOrder = opt.order ?? 0;
    mesh.userData.px = opt.px ?? 1.0;
    scene.add(mesh);
    sprites.push(mesh);
    return mesh;
  }

  /* 待渡的战士：沿江岸列队，走向江中（画面右下） */
  addSoldier(8.1, 5, 2.30, { px: 1.10, pack: true, order: -4 });
  addSoldier(8.3, 7, 2.35, { px: 1.10, pack: false, order: -4 });
  addSoldier(7.9, 10, 2.25, { px: 1.10, pack: true, order: -4 });
  /* 火塘边守夜的一人 */
  addSoldier(-6.2, 11, 2.30, { px: 1.10, pack: false, order: -4 });

  /* 芦苇丛 */
  {
    const cw = 512, ch = 512;
    const mat = silhouetteMaterial(cw, ch, (g) => drawReeds(g, 256, 512, 460, 420, 11));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), mat);
    placeSprite(mesh, cw, ch, 256, 512, -10.3, 0, 9);
    mesh.renderOrder = -4;
    mesh.userData.px = 1.16;
    scene.add(mesh);
    sprites.push(mesh);
  }

  /* 江上的竹筏（画面左中，撑篙渡江） */
  {
    const cw = 512, ch = 384, wl = 380;
    const mat = silhouetteMaterial(cw, ch, (g) => drawRaft(g, 256, wl, 400, 300));
    const W = 13.5, H = W * ch / cw;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    placeSprite(mesh, cw, ch, 256, wl, -13.1, 0.05, -34);
    mesh.renderOrder = -30;
    mesh.userData.px = 0.42;
    scene.add(mesh);
    sprites.push(mesh);
  }

  /* 远处的小船 */
  {
    const cw = 512, ch = 384, wl = 330;
    const mat = silhouetteMaterial(cw, ch, (g) => drawBoat(g, 256, wl, 380, 300));
    const W = 17, H = W * ch / cw;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    placeSprite(mesh, cw, ch, 256, wl, 12.7, 0.05, -52);
    mesh.renderOrder = -32;
    mesh.userData.px = 0.24;
    scene.add(mesh);
    sprites.push(mesh);
  }

  /* 飞鸟 */
  {
    const cw = 512, ch = 256;
    const mat = silhouetteMaterial(cw, ch, (g) => drawBirds(g, 256, 128, 460, 150, 7));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), mat);
    mesh.position.set(18.5, 34, -110);
    mesh.renderOrder = -40;
    mesh.userData.baseX = 18.5;
    mesh.userData.px = 0.12;
    scene.add(mesh);
    sprites.push(mesh);
  }

  /* ── 交互 ── */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let scrollY = 0, targetScroll = 0;

  const drag = {
    active: false, axis: null,
    lastX: 0, lastY: 0,
    sep: 0, sepTarget: 0,
    dawn: 0, dawnTarget: 0,
  };

  function onDown(e) {
    const hero = document.getElementById('hero');
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom) return;
    if (e.target.closest('button, a, input, textarea, select, [role="button"]')) return;
    drag.active = true;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.axis = (e.pointerType === 'touch') ? null : 'free';
    // 拖动场景时不要选中文字
    document.body.classList.add('dragging-scene');
  }

  function onMove(e) {
    pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    if (!drag.active) return;

    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;

    if (e.pointerType === 'touch' && !drag.axis) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'page';
        if (drag.axis === 'page') { endDrag(); return; }
      } else return;
    }
    if (drag.axis === 'page') return;

    // 横向 → 图层分离（左右拉开）
    drag.sepTarget = clamp(drag.sepTarget + dx / 640, -1, 1);
    // 向上 → 太阳升起（破晓）；横向也带一点点
    drag.dawnTarget = clamp(drag.dawnTarget + (-dy + dx * 0.18) / 540, 0, 1);
  }

  function endDrag() {
    if (!drag.active) return;
    drag.active = false;
    drag.axis = null;
    document.body.classList.remove('dragging-scene');
  }

  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);

  window.addEventListener('touchmove', (e) => {
    if (drag.active && drag.axis === 'x') e.preventDefault();
  }, { passive: false });

  window.addEventListener('scroll', () => { targetScroll = window.scrollY; }, { passive: true });

  /* ── 循环 ── */
  const clock = new THREE.Clock();
  let raf = 0;
  let fade = 1, fadeTarget = 1;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    applyCameraFraming();
    renderer.setSize(w, h);
    flameMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
    shared.uRes.value.set(
      w * renderer.getPixelRatio(),
      h * renderer.getPixelRatio()
    );
    skyMat.uniforms.uAspect.value = w / h;
  }
  window.addEventListener('resize', resize);
  applyCameraFraming();

  function tick() {
    raf = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();

    pointer.x += (pointer.tx - pointer.x) * 0.055;
    pointer.y += (pointer.ty - pointer.y) * 0.055;
    scrollY += (targetScroll - scrollY) * 0.08;

    drag.sep += (drag.sepTarget - drag.sep) * 0.08;
    drag.dawn += (drag.dawnTarget - drag.dawn) * 0.045;

    const dawn = drag.dawn;
    shared.uDawn.value = dawn;
    shared.uTime.value = reduce ? 0 : t;

    fade += (fadeTarget - fade) * 0.09;
    shared.uFade.value = fade;

    /* 太阳自山口升起：屏幕纵坐标由低到高 */
    const sunEase = dawn * dawn * 0.28 + dawn * 0.72;
    const sunScreenY = lerp(SUN_Y_LOW, SUN_Y_HIGH, sunEase);
    // 窄屏时太阳略偏中，避免贴边
    const sunScreenX = camera.aspect < 1.0 ? 0.68 : SUN_SCREEN_X;
    skyMat.uniforms.uSunUv.value.set(sunScreenX, sunScreenY);
    skyMat.uniforms.uAspect.value = camera.aspect;
    shared.uSunX.value = sunScreenX;

/* 图层分离：只让山峦与江面错开，拉开纵深。
       近岸与前景元素（塘、人物、芦苇）保持原位，避免压住标题区 */
    const sepPx = drag.sep * 300;
    ridges.forEach((m) => {
      m.position.x = m.userData.baseX + sepPx * m.userData.px * 0.42;
    });
    water.position.x = water.userData.baseX + sepPx * 0.18;
    ground.position.x = ground.userData.baseX;
    sprites.forEach((m) => {
      m.position.x = m.userData.baseX;
    });
    fireGroup.position.x = firePos.x;

    /* 相机：只有鼠标悬停带来的轻微视差；分离完全由图层自身承担 */
    const camBaseY = camera.userData.baseY ?? CAM_Y;
    const camBaseZ = camera.userData.baseZ ?? CAM_Z;
    camera.position.x = pointer.x * 2.0;
    camera.position.y = camBaseY - pointer.y * 1.2 + scrollY * 0.016;
    camera.position.z = camBaseZ + scrollY * 0.012;
    camera.lookAt(
      pointer.x * 0.6,
      camBaseY - 106 * Math.tan(PITCH) + scrollY * 0.005,
      -80
    );

    /* 天空里的太阳位置 */

    /* 火焰 */
    flameMat.uniforms.uTime.value = reduce ? 0 : t;
    flames.rotation.y = Math.sin(t * 0.12) * 0.06;
    const pulse = 0.82 + Math.sin(t * 2.35) * 0.10 + Math.sin(t * 5.7) * 0.055;
    flameMat.uniforms.uBreathe.value = 1 + 0.13 * Math.sin(t * 0.966);
    fireGroup.scale.setScalar(0.52 * (0.99 + 0.01 * pulse));

    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  function start() { if (!raf) tick(); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function setVisible(v) { fadeTarget = v ? 1 : 0; }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  /* 破晓进度通知 */
  let lastDawn = -1;
  const notify = setInterval(() => {
    if (Math.abs(drag.dawn - lastDawn) > 0.02) {
      lastDawn = drag.dawn;
      window.dispatchEvent(new CustomEvent('shanhe:dawn', { detail: { dawn: drag.dawn } }));
    }
  }, 120);
  window.addEventListener('pagehide', () => clearInterval(notify));

  start();
  return { start, stop, setVisible, renderer, getDawn: () => drag.dawn };
}
