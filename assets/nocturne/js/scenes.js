/**
 * NOCTURNE · 3D 场景
 * ---------------------------------------------------------------
 * 复刻视频样片中的 WebGL 场景，核心手法：
 *   真 3D 几何体  +  手绘排线线稿  在同一个透视空间里叠加
 *
 * 场景一：圆形画框内的红球与剪影（对应样片第一幕）
 * 场景二：三只彩色圆柱瓶（对应样片中景，瓶身排线 + 金属瓶盖）
 */

import * as THREE from '../vendor/three.module.js';
import { createHatchMaterial, createMetalMaterial, createOutlinedMesh } from './hatch.js';

const PAPER = 0xe0d9d6;
const INK   = 0x08080a;
const RED   = 0xb00000;

/* ============================================================
   场景一：三只彩色瓶
   瓶身 = 排线 shader（手绘钢笔质感）
   瓶盖 = 真 3D 金属（PBR 高光）
   ============================================================ */
export function createBottlesScene(canvas, opts = {}) {
  const {
    bottles = [
      { color: 0x4a9fd4, height: 2.2, radius: 0.52, x: -1.15 },
      { color: 0x7fc24a, height: 1.85, radius: 0.46, x: 0.0 },
      { color: 0xe8c832, height: 2.4, radius: 0.5, x: 1.15 },
    ],
    ink = INK,
    paper = PAPER,
  } = opts;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 1.7, 9.6);
  camera.lookAt(0, 1.15, 0);

  /* ---- 环境贴图：金属瓶盖需要反射，否则 metalness=1 会渲染成黑色 ----
     用等距柱状投影的渐变贴图（顶部亮、中间灰、底部暗），模拟影棚柔光。 */
  function makeStudioEnv() {
    const W = 128, H = 64;
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);              // 0=顶 1=底
      for (let x = 0; x < W; x++) {
        const u = x / (W - 1);
        // 竖向：上亮 → 中灰 → 下暗
        let r, g, b;
        if (v < 0.42) {
          const t = v / 0.42;
          r = 255; g = 252; b = 246;              // 顶部柔光箱
        } else if (v < 0.58) {
          const t = (v - 0.42) / 0.16;
          r = 255 - t * 60; g = 252 - t * 62; b = 246 - t * 62;
        } else {
          const t = (v - 0.58) / 0.42;
          r = 195 - t * 150; g = 190 - t * 148; b = 184 - t * 144;
        }
        // 横向：正前方加一道亮带，制造金属上的高光条
        const band = Math.exp(-Math.pow((u - 0.32) * 7.5, 2)) * 70;
        const i = (y * W + x) * 4;
        data[i]     = Math.min(255, r + band);
        data[i + 1] = Math.min(255, g + band);
        data[i + 2] = Math.min(255, b + band);
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  scene.environment = makeStudioEnv();

  /* ---- 灯光：只为金属瓶盖提供反射，排线部分用自己的光照计算 ---- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(3.2, 5.5, 4.5);
  scene.add(key);
  const rimLight = new THREE.DirectionalLight(0xffffff, 1.1);
  rimLight.position.set(-4, 2, -3);
  scene.add(rimLight);

  const group = new THREE.Group();
  scene.add(group);

  /* ---- 背景：手绘排线墙面（横向细密排线） ---- */
  const backMat = createHatchMaterial({
    THREE, ink, paper,
    lineGap: 13.0, lineWidth: 1.3,
    angleA: Math.PI / 2, angleB: Math.PI / 2.7,
    crossMix: 0.30, tone: 0.75,
  });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), backMat);
  back.position.set(0, 2.6, -4.2);
  group.add(back);

  /* ---- 台面 ---- */
  const floorMat = createHatchMaterial({
    THREE, ink, paper,
    lineGap: 8.0, lineWidth: 1.2,
    angleA: 0.0, angleB: Math.PI / 5,
    crossMix: 0.28, tone: 0.2,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  group.add(floor);

  /* ---- 三只瓶 ---- */
  const bottleMats = [];
  bottles.forEach((b, i) => {
    const g = new THREE.Group();
    g.position.set(b.x, 0, 0);
    g.userData.baseX = b.x;
    g.userData.phase = i * 2.1;

    // 瓶身：排线 shader，颜色通过底色混合体现
    const bodyMat = createHatchMaterial({
      THREE, ink, paper,
      lineGap: 8.0, lineWidth: 1.5,      // 疏朗的手绘速写刻线
      angleA: Math.PI / 4.6,              // 斜向排线（不顺着圆柱经线，否则成条纹）
      angleB: -Math.PI / 3.2,             // 交叉排线
      crossMix: 0.55, tone: 0.22,
      rimDark: 0.95,                      // 强黑色轮廓
    });
    // 瓶身底色 = 该瓶的彩色；刻线色 = 该色的深色调
    const base = new THREE.Color(b.color);
    bodyMat.uniforms.uPaper.value = base.clone().lerp(new THREE.Color(paper), 0.22);
    bodyMat.uniforms.uInk.value = base.clone().multiplyScalar(0.28);
    bodyMat.uniforms.uHatchMin.value = 0.30;   // 亮部仍保留可见排线
    bodyMat.uniforms.uHatchMax.value = 0.95;
    bottleMats.push(bodyMat);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(b.radius, b.radius, b.height, 64, 1, true),
      bodyMat
    );
    body.position.y = b.height / 2;
    g.add(body);

    // 方肩：香水瓶的直角肩，用倒角圆柱近似
    const shoulder = new THREE.Mesh(
      new THREE.CylinderGeometry(b.radius * 0.38, b.radius, 0.22, 64, 1, true),
      bodyMat
    );
    shoulder.position.y = b.height + 0.11;
    g.add(shoulder);

    // 瓶底略收
    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(b.radius * 0.94, b.radius * 0.88, 0.14, 64, 1, true),
      bodyMat
    );
    foot.position.y = 0.07;
    g.add(foot);

    // 瓶口环（金属）
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(b.radius * 0.4, b.radius * 0.4, 0.3, 32),
      createMetalMaterial(THREE, { color: 0xcfc9c4, roughness: 0.34, metalness: 0.8 })
    );
    neck.position.y = b.height + 0.36;
    g.add(neck);

    // 瓶盖（金属，帽形：圆柱 + 圆顶）
    const capGroup = new THREE.Group();
    const capBody = new THREE.Mesh(
      new THREE.CylinderGeometry(b.radius * 0.46, b.radius * 0.46, 0.34, 48),
      createMetalMaterial(THREE, { color: 0xcfc9c3, roughness: 0.3, metalness: 0.72 })
    );
    capBody.position.y = 0.17;
    capGroup.add(capBody);

    const capTop = new THREE.Mesh(
      new THREE.SphereGeometry(b.radius * 0.46, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      createMetalMaterial(THREE, { color: 0xe6e0d9, roughness: 0.18, metalness: 0.8 })
    );
    capTop.position.y = 0.34;
    capGroup.add(capTop);

    capGroup.position.y = b.height + 0.5;
    g.add(capGroup);

    // 瓶身标签（红底，样片中有黑色标签带）
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(b.radius * 1.005, b.radius * 1.005, 0.34, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide })
    );
    label.position.y = b.height * 0.52;
    g.add(label);

    group.add(g);
  });

  /* ---- 手绘描边：沿法线外扩的粗钢笔轮廓线 ----
     用自定义 shader 做「沿法线挤出的壳」，粗细在世界空间恒定，
     比 scale 放大更接近真实钢笔线的粗细一致感。 */
  function makeOutlineMaterial(thickness) {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uInk: { value: new THREE.Color(ink) }, uThickness: { value: thickness } },
      vertexShader: `
        uniform float uThickness;
        void main() {
          vec3 n = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // 沿法线在视图空间外扩，保证屏幕粗细一致
          mv.xyz += n * uThickness;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uInk;
        void main() { gl_FragColor = vec4(uInk, 1.0); }`,
    });
  }

  // 先收集需要描边的 mesh，再统一加 —— 避免 traverse 时把新加的描边再套一层
  const needOutline = [];
  group.children.forEach((child) => {
    if (child.type !== 'Group') return;
    child.traverse((o) => {
      if (o.isMesh && o.material && o.material.uniforms && o.userData.noOutline !== true) {
        needOutline.push(o);
      }
    });
  });
  needOutline.forEach((o) => {
    const outline = new THREE.Mesh(o.geometry, makeOutlineMaterial(0.035));
    outline.userData.noOutline = true;      // 标记，防止再次被描边
    o.add(outline);
  });

  /* ---- 尺寸 ---- */
  function resize() {
    const parent = canvas.parentElement;
    const w = Math.max(
      (parent && parent.clientWidth) || 0,
      canvas.clientWidth || 0,
      800
    );
    const h = Math.max(
      (parent && parent.clientHeight) || 0,
      canvas.clientHeight || 0,
      500
    );
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const res = new THREE.Vector2();
    renderer.getDrawingBufferSize(res);
    bottleMats.forEach((m) => m.uniforms.uResolution.value.copy(res));
    backMat.uniforms.uResolution.value.copy(res);
    floorMat.uniforms.uResolution.value.copy(res);
  }
  resize();
  window.addEventListener('resize', resize);
  if (window.ResizeObserver && canvas.parentElement) {
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement);
  }

  /* ---- 动画 ---- */
  const clock = new THREE.Clock();
  let raf = 0;

  function animate() {
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // 相机缓慢漂移
    camera.position.x = Math.sin(t * 0.22) * 0.5;
    camera.position.y = 1.7 + Math.sin(t * 0.31) * 0.1;
    camera.lookAt(0, 1.15, 0);

    // 瓶子轻微浮动 + 视差
    group.children.forEach((child, i) => {
      if (child.type !== 'Group') return;
      const ph = child.userData.phase || 0;
      child.position.y = Math.sin(t * 0.85 + ph) * 0.045;
      child.rotation.y = Math.sin(t * 0.4 + ph) * 0.16;
    });

    renderer.render(scene, camera);
  }
  animate();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
    scene, camera, renderer,
  };
}

/* ============================================================
   场景二：圆形画框内的红球与剪影
   对应样片第一幕：红色球体 + 黑色剪影人物 + 圆形画框
   ============================================================ */
export function createPortalScene(canvas, opts = {}) {
  const { ink = INK, paper = PAPER, red = RED } = opts;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 10.5);

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(2.6, 4.2, 5);
  scene.add(key);

  const group = new THREE.Group();
  scene.add(group);

  /* ---- 红球：真 3D 球体 + 排线 ---- */
  const ballMat = createHatchMaterial({
    THREE, ink, paper,
    lineGap: 8.5, lineWidth: 1.5,
    angleA: Math.PI / 2.2, angleB: Math.PI / 6,
    crossMix: 0.5, tone: 0.5,
    rimDark: 0.95,
  });
  ballMat.uniforms.uHatchMin.value = 0.34;
  ballMat.uniforms.uHatchMax.value = 0.95;
  // 球体用红色纸基调：把纸色改成红的淡色，墨色改成深红
  ballMat.uniforms.uPaper.value = new THREE.Color(red).lerp(new THREE.Color(paper), 0.15);
  ballMat.uniforms.uInk.value = new THREE.Color(0x4a0000);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.85, 96, 64), ballMat);
  ball.position.set(0, 0, 0);
  group.add(ball);

  // 球体描边
  const ballOutline = new THREE.Mesh(
    new THREE.SphereGeometry(1.85, 64, 48),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uInk: { value: new THREE.Color(ink) }, uThickness: { value: 0.026 } },
      vertexShader: `
        uniform float uThickness;
        void main() {
          vec3 n = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          mv.xyz += n * uThickness;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uInk;
        void main() { gl_FragColor = vec4(uInk, 1.0); }`,
    })
  );
  group.add(ballOutline);

  /* ---- 剪影人物：站在球前，纯黑 ---- */
  const silh = new THREE.Group();
  const silhMat = new THREE.MeshBasicMaterial({ color: ink });
  silh.scale.setScalar(0.95);
  silh.position.set(0, -1.25, 0);

  // 头（略侧，带长发轮廓）
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 24), silhMat);
  head.position.set(0.1, 1.5, 3.3);
  head.scale.set(0.92, 1.08, 0.95);
  silh.add(head);

  // 长发：垂落到肩背的曲线体
  const hair = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.62, 6, 20), silhMat);
  hair.position.set(-0.08, 1.14, 3.22);
  hair.rotation.z = 0.16;
  hair.scale.set(1.0, 1.0, 0.62);
  silh.add(hair);

  // 肩与身体（收腰长袍）
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-0.62, -1.9);
  bodyShape.lineTo(-0.46, 0.55);
  bodyShape.quadraticCurveTo(-0.42, 1.16, -0.2, 1.2);
  bodyShape.lineTo(0.3, 1.2);
  bodyShape.quadraticCurveTo(0.5, 1.14, 0.56, 0.55);
  bodyShape.lineTo(0.7, -1.9);
  bodyShape.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: 0.22, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2,
  });
  bodyGeo.translate(0, 0, 3.19);
  const body = new THREE.Mesh(bodyGeo, silhMat);
  silh.add(body);

  // 抬起的手臂：上臂 + 前臂两段，肘部有转折
  const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.52, 6, 16), silhMat);
  upperArm.position.set(0.42, 0.86, 3.3);
  upperArm.rotation.z = -0.62;
  silh.add(upperArm);

  const foreArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.48, 6, 16), silhMat);
  foreArm.position.set(0.78, 1.24, 3.31);
  foreArm.rotation.z = -0.42;
  silh.add(foreArm);

  // 手
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), silhMat);
  hand.position.set(0.99, 1.5, 3.32);
  hand.scale.set(1, 1.15, 0.7);
  silh.add(hand);

  // 另一侧手臂自然下垂
  const lowerArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.66, 6, 16), silhMat);
  lowerArm.position.set(-0.44, 0.62, 3.28);
  lowerArm.rotation.z = 0.22;
  silh.add(lowerArm);

  group.add(silh);

  /* ---- 圆形画框：白环 + 手绘排线边框 ---- */
  const ringMat = new THREE.MeshBasicMaterial({ color: paper });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.72, 0.15, 24, 128), ringMat);
  ring.position.z = 2.62;
  group.add(ring);

  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.98, 0.05, 16, 128), ringMat);
  ring2.position.z = 2.6;
  group.add(ring2);

  /* ---- 场景外的线稿墙面 ---- */
  const wallMat = createHatchMaterial({
    THREE, ink, paper,
    lineGap: 6.5, lineWidth: 1.1,
    angleA: Math.PI / 2, angleB: Math.PI / 3.4,
    crossMix: 0.28, tone: 0.8,
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), wallMat);
  wall.position.z = -3.2;
  group.add(wall);

  function resize() {
    const parent = canvas.parentElement;
    const w = Math.max(
      (parent && parent.clientWidth) || 0,
      canvas.clientWidth || 0,
      700
    );
    const h = Math.max(
      (parent && parent.clientHeight) || 0,
      canvas.clientHeight || 0,
      700
    );
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const res = new THREE.Vector2();
    renderer.getDrawingBufferSize(res);
    ballMat.uniforms.uResolution.value.copy(res);
    wallMat.uniforms.uResolution.value.copy(res);
  }
  resize();
  window.addEventListener('resize', resize);
  if (window.ResizeObserver && canvas.parentElement) {
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement);
  }

  const clock = new THREE.Clock();
  let raf = 0;
  function animate() {
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    camera.position.z = 10.5 + Math.sin(t * 0.25) * 0.32;
    camera.position.x = Math.sin(t * 0.18) * 0.24;
    camera.lookAt(0, 0, 0);

    ball.rotation.y = t * 0.08;
    ball.rotation.x = Math.sin(t * 0.2) * 0.08;
    silh.position.y = Math.sin(t * 0.6) * 0.04;

    renderer.render(scene, camera);
  }
  animate();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
