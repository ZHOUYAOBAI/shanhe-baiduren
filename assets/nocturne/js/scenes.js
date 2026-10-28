/**
 * NOCTURNE · 3D 场景
 * ---------------------------------------------------------------
 * 按参考视频逐帧复刻的 WebGL 场景。
 *
 * 核心手法：
 *   真 3D 几何体  ×  屏幕空间铜版画刻线  ×  平涂色块
 *   三者叠在同一个透视空间里 —— 这是视频样片的灵魂。
 *
 * 色值全部为第二轮逐帧像素采样实测值（非目测）：
 *   幕布正红 #FF0000 / 幕布暗部 #BF0002 / 宣纸白 #F8F2E8 / 墨黑 #0E0D12
 *   三色瓶 蓝 #4FB6F9 / 绿 #91EA82 / 黄 #FDDE1F
 *
 * 两个场景：
 *   A 红幕剧场 —— 正红幕布起伏 + 米白排线墙 + 三只彩瓶 + 白色圆 HOLD 钮
 *   B 黑色频谱 —— 墨黑底 + 米白频谱柱
 */

import * as THREE from '../vendor/three.module.js';
import { createEngravedMaterial, createFlatMaterial, addOutlines } from './hatch.js';

/* ============================================================
   实测色板
   ============================================================ */
const PAPER      = 0xf8f2e8;   // 宣纸白
const PAPER_PURE = 0xffffff;   // 纯白（瓶盖）
const INK        = 0x0e0d12;   // 墨黑
const RED        = 0xff0000;   // 幕布正红
const RED_DEEP   = 0xbf0002;   // 幕布暗部
const BLUE       = 0x4fb6f9;
const GREEN      = 0x91ea82;
const YELLOW     = 0xfdde1f;

/* ============================================================
   刻线是屏幕空间的：像素比放大后线宽线距要同步放大，
   否则在 retina 上会糊成一团灰。
   ============================================================ */
function scaleHatch(mat, pr) {
  mat.uniforms.uLineGap.value = mat.userData.baseGap * pr;
  mat.uniforms.uLineW.value   = mat.userData.baseW * pr;
}

/* ============================================================
   场景 A：红幕剧场
   ============================================================ */
export function createStageScene(canvas, opts = {}) {
  const { reducedMotion = false } = opts;

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 1.35, 7.6);
  camera.lookAt(0, 1.15, 0);

  const group = new THREE.Group();
  scene.add(group);

  /* ---- 排线材质登记簿：统一随像素比缩放 ---- */
  const hatchMats = [];
  function engrave(o) {
    const m = createEngravedMaterial(o);
    m.userData.baseGap = o.lineGap ?? 2.4;
    m.userData.baseW   = o.lineW   ?? 0.5;
    hatchMats.push(m);
    return m;
  }

  /* ============================================================
     背景墙：米白底 + 垂直极细密排线
     视频实测：墙面线距约 2.4px，线宽 0.5px
     ============================================================ */
  const wallMat = engrave({
    THREE, base: PAPER, ink: INK,
    lineGap: 2.4, lineW: 0.5, angle: Math.PI / 2,
    lineAlpha: 0.30, shade: 0.16, rimDark: 0,
    light: new THREE.Vector3(-0.2, 0.9, 0.45).normalize(),
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(26, 14), wallMat);
  wall.position.set(0, 3.2, -5.2);
  group.add(wall);

  /* ============================================================
     正红幕布：顶部垂帘，竖向褶皱 + 锯齿状帘边
     幕布是纯平涂红（视频实测 #FF0000），暗部 #BF0002 出现在褶皱处
     褶皱周期约 1.5 世界单位（对应视频里约 70px 一个褶）
     ============================================================ */
  const curtainMat = engrave({
    THREE, base: RED, ink: RED_DEEP,
    lineGap: 2.6, lineW: 0.55, angle: Math.PI / 2,
    lineAlpha: 0.55, shade: 0.85, rimDark: 0,
    light: new THREE.Vector3(-0.55, 0.35, 0.75).normalize(),
    side: 'double',
  });
  const CURTAIN_H = 3.4;
  const CURTAIN_HALF = CURTAIN_H / 2;
  const FOLD_K = 7.0;                      // 褶皱频率（视频里褶皱很密）
  const curtainGeo = new THREE.PlaneGeometry(26, CURTAIN_H, 320, 10);
  {
    const pos = curtainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const t0 = (y + CURTAIN_HALF) / CURTAIN_H;     // 0 底 → 1 顶
      const ph = x * FOLD_K;
      /* 褶皱：底部深、顶部浅（布料在上方收拢） */
      const fold = (Math.sin(ph) * 0.075 + Math.sin(ph * 2.3 + 1.1) * 0.024)
                 * (0.32 + 0.68 * t0);
      pos.setZ(i, fold);
      /* 帘边：每个褶皱谷轻微下垂，形成柔和的波浪下缘
         注意：底数必须 clamp —— 浮点误差会让 1-t0 变成极小负数，
         负数的非整数次幂 = NaN，整个几何的包围球直接失效 */
      const hem = Math.max(0, 1 - t0);
      const sag = (0.5 - 0.5 * Math.cos(ph)) * Math.pow(hem, 2.0) * 0.30;
      pos.setY(i, y - sag);
    }
    curtainGeo.computeVertexNormals();
  }
  const curtain = new THREE.Mesh(curtainGeo, curtainMat);
  curtain.position.set(0, 6.6, -4.9);
  group.add(curtain);

  /* ============================================================
     台面：米白底 + 水平排线
     ============================================================ */
  const floorMat = engrave({
    THREE, base: PAPER, ink: INK,
    lineGap: 2.2, lineW: 0.5, angle: 0,
    lineAlpha: 0.26, shade: 0.22, rimDark: 0,
    light: new THREE.Vector3(-0.35, 0.85, 0.4).normalize(),
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 14), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  group.add(floor);

  /* ============================================================
     三只瓶：纯色瓶身 + 极细密横向排线 + 白色球盖 + 黑标签带
     视频实测：瓶身排线为横向，线距 2.1px
     ============================================================ */
  const BOTTLE_SPEC = [
    { color: BLUE,   h: 2.30, r: 0.46, x: -1.28 },
    { color: GREEN,  h: 1.92, r: 0.41, x:  0.02 },
    { color: YELLOW, h: 2.52, r: 0.44, x:  1.26 },
  ];

  const bottles = [];
  const lightDir = new THREE.Vector3(-0.62, 0.55, 0.56).normalize();

  BOTTLE_SPEC.forEach((spec, i) => {
    const g = new THREE.Group();
    g.position.set(spec.x, 0, 0);
    g.userData.phase = i * 2.1;

    /* 瓶身：圆柱，横向极细密排线 */
    const bodyMat = engrave({
      THREE, base: spec.color, ink: INK,
      lineGap: 2.1, lineW: 0.46, angle: 0,
      lineAlpha: 0.32, shade: 0.55, rimDark: 0.80,
      light: lightDir,
      side: 'double',
    });
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.r, spec.r, spec.h, 72, 1, true),
      bodyMat
    );
    body.position.y = spec.h / 2;
    g.add(body);

    /* 肩部收口：倒角圆柱 */
    const shoulder = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.r * 0.40, spec.r, 0.20, 72, 1, true),
      bodyMat
    );
    shoulder.position.y = spec.h + 0.10;
    g.add(shoulder);

    /* 瓶颈：宣纸白 */
    const neckMat = engrave({
      THREE, base: PAPER, ink: INK,
      lineGap: 2.4, lineW: 0.46, angle: Math.PI / 2,
      lineAlpha: 0.30, shade: 0.50, rimDark: 0.70,
      light: lightDir,
    });
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.r * 0.30, spec.r * 0.30, 0.34, 48),
      neckMat
    );
    neck.position.y = spec.h + 0.37;
    g.add(neck);

    /* 颈环：墨色细带 */
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.r * 0.32, spec.r * 0.32, 0.035, 48),
      createFlatMaterial(THREE, INK)
    );
    ring.position.y = spec.h + 0.24;
    g.add(ring);

    /* 瓶盖：白色球 + 横向螺纹（视频实测为纯白球盖，非金属高光）
       螺纹只作浅刻线，不能压成灰色 —— lineAlpha 与 shade 都要压低 */
    const capMat = engrave({
      THREE, base: PAPER_PURE, ink: INK,
      lineGap: 1.7, lineW: 0.44, angle: 0,
      lineAlpha: 0.20, shade: 0.20, rimDark: 0.85,
      light: lightDir,
    });
    const capR = spec.r * 0.60;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 48, 32), capMat);
    cap.position.y = spec.h + 0.54 + capR * 0.34;
    g.add(cap);

    /* 黑色标签带 */
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.r * 1.012, spec.r * 1.012, spec.h * 0.16, 64, 1, true),
      createFlatMaterial(THREE, INK)
    );
    label.position.y = spec.h * 0.52;
    g.add(label);
    /* 标签上的白色小波浪（视频细节） */
    const waveMat = new THREE.MeshBasicMaterial({ color: PAPER });
    for (let k = 0; k < 2; k++) {
      const wave = new THREE.Mesh(
        new THREE.TorusGeometry(spec.r * 0.20, 0.011, 8, 40, Math.PI * 1.35),
        waveMat
      );
      wave.position.set(0, spec.h * 0.52 + spec.h * 0.008, spec.r * 1.02);
      wave.rotation.set(0, 0, k === 0 ? 0.15 : Math.PI + 0.15);
      g.add(wave);
    }

    group.add(g);
    bottles.push(g);
  });

  /* ---- 描边：瓶体与球盖加墨线轮廓壳 ---- */
  addOutlines(group, THREE, { thickness: 0.016, ink: INK });

  /* ============================================================
     白色圆形 HOLD 钮（视频中确有此元素，圆面写 HOLD 字）
     ============================================================ */
  const holdGroup = new THREE.Group();
  const holdFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 64),
    engrave({
      THREE, base: PAPER, ink: INK,
      lineGap: 2.6, lineW: 0.48, angle: 0,
      lineAlpha: 0.16, shade: 0.10, rimDark: 0,
    })
  );
  holdFace.userData.noOutline = true;
  holdGroup.add(holdFace);
  const holdRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.345, 0.022, 12, 72),
    createFlatMaterial(THREE, INK)
  );
  holdRing.userData.noOutline = true;
  holdGroup.add(holdRing);
  /* HOLD 字样：墨色小矩形拼字（与视频里的窄体大写字一致）
     每个矩形为 [x, y, 宽, 高]，x/y 为左下角坐标 */
  const holdText = new THREE.Group();
  const HOLD_BARS = [
    /* H */
    [-0.176, -0.052, 0.014, 0.104],
    [-0.148,  0.000, 0.014, 0.104],
    [-0.176, -0.052, 0.042, 0.014],
    /* O */
    [-0.076, -0.052, 0.014, 0.104],
    [-0.034, -0.052, 0.014, 0.104],
    [-0.076, -0.052, 0.042, 0.014],
    [-0.076,  0.038, 0.042, 0.014],
    /* L */
    [ 0.014, -0.052, 0.014, 0.104],
    [ 0.014, -0.052, 0.040, 0.014],
    /* D */
    [ 0.080, -0.052, 0.014, 0.104],
    [ 0.094, -0.038, 0.012, 0.076],
    [ 0.080,  0.038, 0.014, 0.014],
  ];
  HOLD_BARS.forEach(([dx, dy, w, h]) => {
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      createFlatMaterial(THREE, INK)
    );
    bar.position.set(dx + w / 2, dy + h / 2, 0.006);
    bar.userData.noOutline = true;
    holdText.add(bar);
  });
  holdGroup.add(holdText);
  holdGroup.position.set(2.55, 1.30, 0.35);
  group.add(holdGroup);

  /* ============================================================
     尺寸 / 缩放
     ============================================================ */
  function resize() {
    const parent = canvas.parentElement;
    const w = Math.max((parent && parent.clientWidth) || 0, canvas.clientWidth || 0, 800);
    const h = Math.max((parent && parent.clientHeight) || 0, canvas.clientHeight || 0, 500);
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const pr = renderer.getPixelRatio();
    const res = new THREE.Vector2();
    renderer.getDrawingBufferSize(res);
    hatchMats.forEach((m) => {
      m.uniforms.uResolution.value.copy(res);
      scaleHatch(m, pr);
    });
  }
  resize();
  window.addEventListener('resize', resize);
  let ro = null;
  if (window.ResizeObserver && canvas.parentElement) {
    ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement);
  }

  /* ============================================================
     交互：鼠标视差 + 幕布起伏 + 瓶子浮动
     ============================================================ */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  }
  window.addEventListener('pointermove', onMove, { passive: true });

  /* 自计时器：THREE.Clock 在新版 Three.js 已废弃，避免依赖 API 变动 */
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  let raf = 0;

  function animate() {
    raf = requestAnimationFrame(animate);
    const t = elapsed();

    pointer.x += (pointer.tx - pointer.x) * 0.045;
    pointer.y += (pointer.ty - pointer.y) * 0.045;

    const px = reducedMotion ? 0 : pointer.x;
    const py = reducedMotion ? 0 : pointer.y;
    camera.position.x = px * 0.62;
    camera.position.y = 1.35 - py * 0.34;
    camera.lookAt(px * 0.16, 1.18, 0);

    /* 幕布起伏：顶点级波动（与视频里幕布随鼠标起伏一致） */
    if (!reducedMotion) {
      const pos = curtainGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const t0 = (y + CURTAIN_HALF) / CURTAIN_H;
        const sag = Math.pow(Math.max(0, 1 - t0), 2.4);
        const ph = x * FOLD_K;
        const base = (Math.sin(ph) * 0.105 + Math.sin(ph * 2.3 + 1.1) * 0.034)
                   * (0.32 + 0.68 * t0);
        const wave = Math.sin(x * 0.85 + t * 1.1 + px * 1.6) * 0.05 * sag;
        pos.setZ(i, base + wave);
      }
      pos.needsUpdate = true;
      curtainGeo.computeVertexNormals();
    }

    bottles.forEach((g, i) => {
      const ph = g.userData.phase || 0;
      if (!reducedMotion) {
        g.position.y = Math.sin(t * 0.8 + ph) * 0.035;
        g.rotation.y = Math.sin(t * 0.38 + ph) * 0.13;
      }
    });

    if (!reducedMotion) {
      const s = 1 + Math.sin(t * 1.4) * 0.022;
      holdGroup.scale.setScalar(s);
    }

    renderer.render(scene, camera);
  }
  animate();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      if (ro) ro.disconnect();
      renderer.dispose();
    },
    scene, camera, renderer,
  };
}

/* ============================================================
   场景 B：黑色频谱
   墨黑底 + 米白频谱柱，柱高随时间起伏（对应视频里频谱律动）
   ============================================================ */
export function createSpectrumScene(canvas, opts = {}) {
  const { reducedMotion = false } = opts;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(INK);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0.9, 6.2);
  camera.lookAt(0, 0.9, 0);

  const group = new THREE.Group();
  scene.add(group);

  const hatchMats = [];
  function engrave(o) {
    const m = createEngravedMaterial(o);
    m.userData.baseGap = o.lineGap ?? 2.4;
    m.userData.baseW   = o.lineW   ?? 0.5;
    hatchMats.push(m);
    return m;
  }

  /* 背景：墨黑底 + 极淡竖排线 */
  const bgMat = engrave({
    THREE, base: INK, ink: PAPER,
    lineGap: 3.0, lineW: 0.4, angle: Math.PI / 2,
    lineAlpha: 0.055, shade: 0, rimDark: 0,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(26, 14), bgMat);
  bg.position.set(0, 3.0, -4.6);
  group.add(bg);

  /* 频谱柱：米白，每根柱不同初相 */
  const barMat = engrave({
    THREE, base: PAPER, ink: INK,
    lineGap: 2.0, lineW: 0.42, angle: Math.PI / 2,
    lineAlpha: 0.22, shade: 0.40, rimDark: 0.60,
    light: new THREE.Vector3(-0.4, 0.8, 0.45).normalize(),
  });
  const COUNT = 46;
  const bars = [];
  for (let i = 0; i < COUNT; i++) {
    const h = 0.5 + (0.5 + 0.5 * Math.sin(i * 1.7)) * 2.1;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.062, h, 0.14), barMat);
    const x = (i - (COUNT - 1) / 2) * 0.125;
    bar.position.set(x, h / 2, 0);
    bar.userData.phase = i * 0.43;
    bar.userData.baseH = h;
    group.add(bar);
    bars.push(bar);
  }
  addOutlines(group, THREE, { thickness: 0.008, ink: INK });

  function resize() {
    const parent = canvas.parentElement;
    const w = Math.max((parent && parent.clientWidth) || 0, canvas.clientWidth || 0, 800);
    const h = Math.max((parent && parent.clientHeight) || 0, canvas.clientHeight || 0, 500);
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    const res = new THREE.Vector2();
    renderer.getDrawingBufferSize(res);
    hatchMats.forEach((m) => {
      m.uniforms.uResolution.value.copy(res);
      scaleHatch(m, pr);
    });
  }
  resize();
  window.addEventListener('resize', resize);
  let ro = null;
  if (window.ResizeObserver && canvas.parentElement) {
    ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement);
  }

  const pointer = { x: 0, tx: 0 };
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
  }
  window.addEventListener('pointermove', onMove, { passive: true });

  /* 自计时器：THREE.Clock 在新版 Three.js 已废弃，避免依赖 API 变动 */
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  let raf = 0;
  function animate() {
    raf = requestAnimationFrame(animate);
    const t = elapsed();
    pointer.x += (pointer.tx - pointer.x) * 0.05;

    camera.position.x = (reducedMotion ? 0 : pointer.x) * 0.5;
    camera.lookAt(0, 0.9, 0);

    if (!reducedMotion) {
      bars.forEach((b) => {
        const ph = b.userData.phase;
        const k = 1 + Math.sin(t * 1.9 + ph) * 0.28 + Math.sin(t * 0.7 + ph * 1.7) * 0.14;
        b.scale.y = k;
        b.position.y = (b.userData.baseH * k) / 2;
      });
    }

    renderer.render(scene, camera);
  }
  animate();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      if (ro) ro.disconnect();
      renderer.dispose();
    },
    scene, camera, renderer,
  };
}
