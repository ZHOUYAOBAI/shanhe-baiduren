/* ============================================================
   《山河摆渡人》· 3D 火塘
   Three.js / WebGL —— 手写排线着色器，无外部贴图
   ============================================================ */
import * as THREE from './three.module.js';

/* ── 排线着色器 ──────────────────────────────────────────
   经典 engraving 手法：按屏幕空间坐标画平行斜线，
   线密度随明度变化，模拟钢笔排线。
   ──────────────────────────────────────────────────────── */
const HATCH_VERT = /* glsl */`
varying vec3 vNormalW;
varying vec3 vPosW;
varying float vDepth;

void main() {
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
uniform vec3  uInk;        // 墨线色
uniform vec3  uPaper;      // 留白色
uniform vec3  uGlow;       // 火光色
uniform vec3  uFog;        // 景深雾色（远山淡出）
uniform float uGlowPower;  // 火光影响半径
uniform float uLineScale;  // 排线密度
uniform float uAngle;      // 排线角度
uniform float uOpacity;

varying vec3 vNormalW;
varying vec3 vPosW;
varying float vDepth;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// 抗锯齿斜线
float hatchLine(vec2 p, float angle, float scale) {
  float s = sin(angle), c = cos(angle);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c) * scale;
  float v = fract(q.y);
  float d = min(v, 1.0 - v);
  return 1.0 - smoothstep(0.0, fwidth(q.y) * 1.6 + 0.001, d);
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightDir);

  // 漫反射
  float diff = max(dot(N, L), 0.0);
  // 半兰伯特，避免背光全黑
  float wrapped = diff * 0.72 + 0.28 * max(dot(N, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0);

  // 火光：距离火塘中心越近越亮
  float distToFire = length(vPosW.xz - vec2(0.0, 0.0));
  float fire = exp(-distToFire / uGlowPower);
  // 火焰在正下方，向上照亮
  float upFacing = max(N.y, 0.0);
  float fireLight = fire * (0.35 + 0.65 * upFacing);

  // 明度：综合环境光与火光
  float lum = clamp(wrapped * 0.55 + fireLight * 0.95, 0.0, 1.4);

  // 屏幕空间排线（两条交叉线，密度随暗度增加）
  vec2 sp = gl_FragCoord.xy;
  float a1 = uAngle;
  float a2 = uAngle + 1.05;
  float density = mix(0.55, 1.0, 1.0 - clamp(lum, 0.0, 1.0));

  float l1 = hatchLine(sp, a1, uLineScale) * density;
  float l2 = hatchLine(sp, a2, uLineScale * 1.35) * density * 0.6;
  float lines = clamp(l1 + l2, 0.0, 1.0);

  // 保留明暗块面：亮处少线、暗处满线
  float inkAmt = clamp(1.0 - lum * 0.78, 0.0, 1.0);

  // 基色：暗处偏墨，亮处偏纸；火光处染红
  vec3 base = mix(uInk, uPaper, clamp(lum * 0.85, 0.0, 1.0));
  base = mix(base, uGlow, clamp(fireLight * 0.62, 0.0, 0.82));

  // 叠加墨线
  vec3 col = mix(base, uInk, lines * inkAmt * 0.86);

  // 火光边缘的高温亮线
  col += uGlow * pow(fireLight, 2.2) * 0.28;

  // 轻微颗粒（纸纹）
  float grain = hash(sp * 0.7) - 0.5;
  col += grain * 0.035;

  // 景深雾：远处淡出（雾色随底色改为朱砂，避免远山发黑）
  float fog = smoothstep(16.0, 46.0, vDepth);
  col = mix(col, uFog, fog * 0.88);

  gl_FragColor = vec4(col, uOpacity);
}
`;

/* ── 火焰粒子着色器 ──────────────────────────────────── */
const FLAME_VERT = /* glsl */`
attribute float aSize;
attribute float aSeed;
attribute float aSpeed;

uniform float uTime;
uniform float uPixelRatio;

varying float vLife;
varying float vSeed;

void main() {
  vSeed = aSeed;

  // 上升 + 侧向摆动
  float t = mod(uTime * aSpeed + aSeed * 7.31, 1.0);
  float y = t * 4.4;
  float sway = sin(uTime * (1.1 + aSeed * 2.2) + aSeed * 19.7) * (0.30 + t * 0.78);
  float drift = cos(uTime * (0.7 + aSeed) + aSeed * 11.3) * (0.16 + t * 0.44);

  // 越往上越向中轴收拢 —— 火苗的锥形
  float cone = 1.0 - t * 0.48;
  vec3 pos = vec3((sway + drift) * cone, y - 0.35, (sway * 0.42 - drift * 0.3) * cone);

  // 生命周期：起→旺→熄
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

varying float vLife;
varying float vSeed;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  // 软圆点
  float a = smoothstep(0.5, 0.02, d);
  a *= vLife;

  // 中心更热
  float core = smoothstep(0.30, 0.0, d);
  vec3 col = mix(uCool, uHot, core * (0.42 + vSeed * 0.45));
  col = mix(col, vec3(1.0, 0.93, 0.76), core * core * vLife * 0.7);

  gl_FragColor = vec4(col, a * 0.50);
}
`;

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
  renderer.setClearColor(0x2b0a0f, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2b0a0f, 0.028);

  const camera = new THREE.PerspectiveCamera(
    50, window.innerWidth / window.innerHeight, 0.1, 160);
  camera.position.set(0, 0.95, 15.2);
  camera.lookAt(0, 6.9, -6);

  /* ── 排线材质工厂 ── */
  const hatchMat = (opts = {}) => new THREE.ShaderMaterial({
    vertexShader: HATCH_VERT,
    fragmentShader: HATCH_FRAG,
    uniforms: {
      uLightDir:   { value: new THREE.Vector3(-0.55, 0.72, 0.42).normalize() },
      uInk:        { value: new THREE.Color(opts.ink ?? 0x3a1216) },
      uPaper:      { value: new THREE.Color(opts.paper ?? 0xefd9c4) },
      uGlow:       { value: new THREE.Color(opts.glow ?? 0xd62038) },
      uFog:        { value: new THREE.Color(opts.fog ?? 0x3d1116) },
      uGlowPower:  { value: opts.glowPower ?? 9.5 },
      uLineScale:  { value: opts.lineScale ?? 0.13 },
      uAngle:      { value: opts.angle ?? 0.62 },
      uOpacity:    { value: opts.opacity ?? 1.0 },
    },
    side: opts.side ?? THREE.FrontSide,
    transparent: (opts.opacity ?? 1.0) < 1,
  });

  /* ── 远山：层叠剪影，每层用不同排线密度 ── */
  const RIDGES = [
    { z: -34, h: 13.0, w: 78, seg: 96, seed: 3.1,  line: 0.085, angle: 0.55, glow: 0.055, op: 0.95 },
    { z: -25, h: 10.5, w: 64, seg: 88,  seed: 11.7, line: 0.105, angle: 0.72, glow: 0.075, op: 0.96 },
    { z: -17, h: 8.2,  w: 52, seg: 78,  seed: 27.3, line: 0.128, angle: 0.48, glow: 0.10,  op: 0.97 },
    { z: -10, h: 6.0,  w: 42, seg: 68,  seed: 41.9, line: 0.155, angle: 0.86, glow: 0.14,  op: 0.98 },
  ];

  const ridges = [];
  RIDGES.forEach((r, i) => {
    // 用噪声生成起伏的山脊线
    const pts = [];
    const n = r.seg;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const x = (u - 0.5) * r.w;
      const s = r.seed;
      const y =
        Math.sin(u * 7.3 + s) * 0.42 +
        Math.sin(u * 17.1 + s * 2.1) * 0.19 +
        Math.sin(u * 31.7 + s * 3.7) * 0.085 +
        Math.sin(u * 3.1 + s * 0.6) * 0.55;
      pts.push(new THREE.Vector2(x, (y * 0.5 + 0.5) * r.h));
    }
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, -8);
    pts.forEach(p => shape.lineTo(p.x, p.y));
    shape.lineTo(pts[pts.length - 1].x, -8);
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);
    const mat = hatchMat({
      lineScale: r.line, angle: r.angle,
      glow: 0xd62038, glowPower: 11 + i * 4,
      ink: 0x5e1a20, paper: 0x8e2b30,
      fog: 0x3d1116,
      opacity: r.op,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = r.z;
    mesh.renderOrder = -10 + i;
    scene.add(mesh);
    ridges.push(mesh);
  });

  /* ── 地面：火塘周边地面 ── */
  {
    const g = new THREE.PlaneGeometry(90, 70, 40, 40);
    const m = hatchMat({
      lineScale: 0.19, angle: 1.02,
      glow: 0xd62038, glowPower: 3.4,
      ink: 0x4a1419, paper: 0x66212a,
      fog: 0x2b0a0f,
    });
    const floor = new THREE.Mesh(g, m);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);
  }

  /* ── 火塘石圈 ── */
  const stones = new THREE.Group();
  const stoneMat = hatchMat({
    lineScale: 0.30, angle: 0.34,
    glow: 0xd62038, glowPower: 3.4,
    ink: 0x51191e, paper: 0x8c4034,
  });
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2;
    const rad = 1.72 + Math.sin(i * 2.7) * 0.14;
    const s = 0.36 + Math.abs(Math.sin(i * 1.9)) * 0.26;
    const geo = new THREE.DodecahedronGeometry(s, 0);
    const st = new THREE.Mesh(geo, stoneMat);
    st.position.set(Math.cos(a) * rad, s * 0.42 + 0.55, Math.sin(a) * rad);
    st.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    st.scale.set(1, 0.78, 1);
    stones.add(st);
  }
  scene.add(stones);

  /* ── 火焰粒子 ── */
  const FLAME_N = 420;
  const pos = new Float32Array(FLAME_N * 3);
  const size = new Float32Array(FLAME_N);
  const seed = new Float32Array(FLAME_N);
  const speed = new Float32Array(FLAME_N);
  for (let i = 0; i < FLAME_N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.55) * 1.30;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = Math.sin(a) * r;
    size[i] = 10 + Math.random() * 15;
    seed[i] = Math.random();
    speed[i] = 0.16 + Math.random() * 0.30;
  }
  const flameGeo = new THREE.BufferGeometry();
  flameGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  flameGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  flameGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  flameGeo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));

  const flameMat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uHot: { value: new THREE.Color(0xfff6d8) },
      uCool: { value: new THREE.Color(0xff8a3c) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flames = new THREE.Points(flameGeo, flameMat);
  flames.position.y = 0.55;
  scene.add(flames);

  /* ── 火塘正上方的"月/日"圆盘：远景焦点 ── */
  const moonMat = hatchMat({
    lineScale: 0.30, angle: 0.9,
    glow: 0xd62038, glowPower: 2.4,
    ink: 0x4a1218, paper: 0xd99a68,
  });
  const moon = new THREE.Mesh(new THREE.CircleGeometry(1.9, 64), moonMat);
  moon.position.set(0, 12.8, -34);
  scene.add(moon);

  /* ── 交互 ── */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let scrollY = 0, targetScroll = 0;

  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  window.addEventListener('scroll', () => {
    targetScroll = window.scrollY;
  }, { passive: true });

  /* ── 循环 ── */
  const clock = new THREE.Clock();
  let raf = 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    flameMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
  }
  window.addEventListener('resize', resize);

  function tick() {
    raf = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();

    // 阻尼跟随
    pointer.x += (pointer.tx - pointer.x) * 0.055;
    pointer.y += (pointer.ty - pointer.y) * 0.055;
    scrollY += (targetScroll - scrollY) * 0.08;

    // 相机视差
    camera.position.x = pointer.x * 1.9;
    camera.position.y = 0.95 - pointer.y * 1.15 + scrollY * 0.055;
    camera.position.z = 15.2 + scrollY * 0.021;
    camera.lookAt(pointer.x * 0.55, 6.9 + scrollY * 0.012, -6);

    // 火焰
    flameMat.uniforms.uTime.value = reduce ? 0 : t;
    flames.rotation.y = Math.sin(t * 0.12) * 0.06;

    // 火焰脉冲：石圈与地面着色器的 glow 强度随节奏变化
    const pulse = 0.82 + Math.sin(t * 2.35) * 0.10 + Math.sin(t * 5.7) * 0.055;
    ridges.forEach((m, i) => {
      m.material.uniforms.uGlowPower.value = (11 + i * 4) * pulse;
    });

    renderer.render(scene, camera);
  }

  function start() {
    if (!raf) tick();
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function setVisible(v) {
    canvas.style.opacity = v ? '1' : '0';
    canvas.style.transition = 'opacity .5s';
  }

  // 页面不可见时暂停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  start();
  return { start, stop, setVisible, renderer };
}
