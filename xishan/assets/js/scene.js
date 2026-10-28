/* ============================================================
   《西山不是山》· 3D 滇池对岸
   ---------------------------------------------------------------
   场景即命题：我们隔着水面看西山，西山在雾里慢慢变成一个人。

   构图依据（西山景区官方地貌描述）：
     腿 = 云盘山与碧鸡山
     腹 = 华亭山与太华山
     胸 = 罗汉山与挂榜山（龙门石窟、达天阁正在此处）
     脸 = 大青山
     发 = 观音山黑荞母片区
   最佳观赏点 = 海埂大坝。故相机置于水面南岸，对岸在北。

   层次（自远及近）：
     远景山脊 × 4  层   —— 不同排线密度，靠明度分层
     中景卧人形剪影     —— 睡美人轮廓（唯一有"人"味的形体）
     水面                —— 排线构成的水 + 倒影
     近景塔院剪影       —— 左下角，一盏灯
   ============================================================ */
import * as THREE from './three.module.js';
import { createEngravedMaterial, createOutlineMaterial } from './hatch.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x10151c, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x10151c, 0.0175);

  const camera = new THREE.PerspectiveCamera(
    46, window.innerWidth / window.innerHeight, 0.1, 220);
  camera.position.set(0, 1.35, 17.6);
  camera.lookAt(0, 5.6, -22);

  /* ── 材质工厂 ───────────────────────────────────────── */
  const mat = (o) => createEngravedMaterial({
    THREE,
    light: new THREE.Vector3(-0.38, 0.66, 0.64).normalize(),
    ...o,
  });

  /* ── 远景山脊：四层，排线密度递增 ──────────────────── */
  // z 越远 → 线越细、底色越接近天色（明度分层，不靠光照）
  const RIDGES = [
    { z: -78, h: 15.0, w: 150, seg: 110, seed: 5.3,  gap: 2.05, ang: 0.52, alpha: 0.11, base: 0x2b3742, ink: 0x3a4855, op: 0.92 },
    { z: -62, h: 12.4, w: 126, seg: 100, seed: 13.9, gap: 2.20, ang: 0.71, alpha: 0.14, base: 0x25303a, ink: 0x33404c, op: 0.94 },
    { z: -48, h:  9.6, w: 104, seg: 92,  seed: 21.7, gap: 2.40, ang: 0.46, alpha: 0.17, base: 0x1f2932, ink: 0x2b3742, op: 0.96 },
    { z: -36, h:  7.4, w:  88, seg: 84,  seed: 33.4, gap: 2.65, ang: 0.88, alpha: 0.20, base: 0x1a232b, ink: 0x242e38, op: 0.98 },
  ];

  const ridges = [];
  RIDGES.forEach((r, i) => {
    const pts = [];
    const n = r.seg;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const x = (u - 0.5) * r.w;
      const s = r.seed;
      // 多频叠加：低频起伏 + 中频山脊 + 高频细碎
      const y =
        Math.sin(u * 5.1 + s) * 0.50 +
        Math.sin(u * 11.3 + s * 2.3) * 0.24 +
        Math.sin(u * 23.7 + s * 3.9) * 0.10 +
        Math.sin(u * 2.3 + s * 0.7) * 0.62;
      pts.push(new THREE.Vector2(x, (y * 0.5 + 0.5) * r.h));
    }
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, -14);
    pts.forEach(p => shape.lineTo(p.x, p.y));
    shape.lineTo(pts[pts.length - 1].x, -14);
    shape.closePath();

    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      mat({
        base: r.base, ink: r.ink,
        lineGap: r.gap, lineW: 0.45, angle: r.ang,
        lineAlpha: r.alpha, shade: 0.20, rimDark: 0.30,
        transparent: true, opacity: r.op,
      }));
    mesh.position.z = r.z;
    mesh.renderOrder = -30 + i;
    scene.add(mesh);
    ridges.push(mesh);
  });

  /* ── 中景：睡美人卧人形剪影 ─────────────────────────
     这是全场的题眼 —— 一座山慢慢像一个人。
     轮廓按官方地貌分区：左（头）隆起 → 中段（胸腹）平缓 → 右（发梢）垂落。
     ───────────────────────────────────────────────────── */
  {
    const shape = new THREE.Shape();
    const P = [
      // [x, y] —— 从左（头·罗汉山）到右（发·观音山）
      [-46.0, -12.0], [-45.2,  0.6], [-43.4,  3.2], [-40.2,  4.9],
      [-35.6,  5.6], [-30.4,  5.9], [-25.0,  5.7], [-19.4,  5.4],
      [-13.6,  5.2], [ -7.8,  5.3], [ -2.0,  5.6], [  3.6,  5.4],
      [  9.0,  4.6], [ 14.2,  3.4], [ 19.0,  2.2], [ 23.6,  1.4],
      [ 28.0,  0.9], [ 32.2,  0.2], [ 36.4, -0.4], [ 40.6, -0.8],
      [ 44.2, -1.6], [ 46.8, -3.2], [ 47.6, -12.0],
    ];
    shape.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) {
      // 用二次曲线让轮廓有机，避免折线感
      const prev = P[i - 1], cur = P[i];
      const mx = (prev[0] + cur[0]) / 2, my = (prev[1] + cur[1]) / 2;
      shape.quadraticCurveTo(prev[0], prev[1], mx, my);
    }
    shape.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
    shape.lineTo(P[0][0], P[0][1]);

    const geo = new THREE.ShapeGeometry(shape);
    const m = mat({
      base: 0x141c24, ink: 0x2f3d4a,
      lineGap: 2.35, lineW: 0.5, angle: 1.34,
      lineAlpha: 0.26, shade: 0.26, rimDark: 0.42,
      transparent: true, opacity: 0.99,
    });
    const body = new THREE.Mesh(geo, m);
    body.position.z = -26;
    body.renderOrder = -20;
    scene.add(body);

    // 卧人轮廓的描边壳 —— 蚀刻版画里形体转折处的墨线
    const outline = new THREE.Mesh(geo, createOutlineMaterial(THREE, {
      ink: 0x0b1015, thickness: 0.030,
    }));
    outline.position.z = -26;
    outline.renderOrder = -19;
    scene.add(outline);

    ridges.push(body);
  }

  /* ── 水面：排线构成的水 ─────────────────────────────── */
  {
    const g = new THREE.PlaneGeometry(220, 96, 90, 40);
    const m = mat({
      base: 0x0d1319, ink: 0x1c2831,
      lineGap: 2.9, lineW: 0.42, angle: 0.06,
      lineAlpha: 0.17, shade: 0.10, rimDark: 0.12,
    });
    const water = new THREE.Mesh(g, m);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.06, -22);
    scene.add(water);

    // 水面的横向光带（滇池晨雾里的一层）
    const mist = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 3.2),
      new THREE.MeshBasicMaterial({
        color: 0xd9e4ec, transparent: true, opacity: 0.055,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
    mist.position.set(0, 1.15, -20);
    scene.add(mist);
    ridges.push(mist);
  }

  /* ── 近景：塔院屋脊剪影（左下角）＋ 一盏灯 ─────────── */
  const lamp = new THREE.Group();
  {
    // 屋脊：两块斜面构成人字屋顶
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-6.2, 0);
    roofShape.lineTo(0, 2.9);
    roofShape.lineTo(6.2, 0);
    roofShape.closePath();
    const roof = new THREE.Mesh(
      new THREE.ShapeGeometry(roofShape),
      mat({
        base: 0x080c11, ink: 0x1a242e,
        lineGap: 1.9, lineW: 0.45, angle: 1.05,
        lineAlpha: 0.24, shade: 0.34, rimDark: 0.5,
      }));
    roof.position.set(-13.5, -0.5, 6.5);
    lamp.add(roof);

    // 墙
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(12.4, 4.6),
      mat({
        base: 0x0a0e13, ink: 0x151d25,
        lineGap: 2.15, lineW: 0.42, angle: 1.5708,
        lineAlpha: 0.20, shade: 0.30, rimDark: 0.44,
      }));
    wall.position.set(-13.5, -2.8, 6.6);
    lamp.add(wall);

    // 窗：唯一暖光 —— 塔院堂屋的煤油灯
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.5),
      new THREE.MeshBasicMaterial({ color: 0xe8a24c }));
    win.position.set(-13.5, 0.1, 6.75);
    lamp.add(win);

    const glow = new THREE.PointLight(0xe86a4c, 26, 24, 2.0);
    glow.position.set(-13.5, 0.3, 7.4);
    lamp.add(glow);

    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 48),
      new THREE.MeshBasicMaterial({
        color: 0xe8a24c, transparent: true, opacity: 0.16,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
    halo.position.set(-13.5, 0.3, 7.2);
    lamp.add(halo);

    scene.add(lamp);
    ridges.push(lamp);
  }

  /* ── 星：稀疏，滇池夜空 ─────────────────────────────── */
  {
    const N = 260;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 70;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 8 + Math.random() * 26;
      pos[i * 3 + 2] = -50 - Math.random() * 40;
      size[i] = 1.4 + Math.random() * 3.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */`
        attribute float aSize;
        uniform float uPixelRatio;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * (170.0 / -mv.z);
          vA = smoothstep(0.0, 1.0, aSize / 4.0);
        }`,
      fragmentShader: /* glsl */`
        precision mediump float;
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(vec3(0.86, 0.91, 0.96), a * vA * 0.5);
        }`,
    });
    scene.add(new THREE.Points(g, m));
  }

  /* ── 尺寸 ── */
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  /* ── 滚动驱动：山色被拉开 ─────────────────────────────
     向下滚动 = 雾散、山形渐显、水面退远。
     这是「拖动 · 拉开山色」的实体实现。
     ───────────────────────────────────────────────────── */
  let scrollT = 0;
  const onScroll = () => {
    const h = document.body.scrollHeight - window.innerHeight;
    scrollT = h > 0 ? Math.min(1, window.scrollY / h) : 0;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  let t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;

    // 雾随滚动散去
    scene.fog.density = 0.0175 - scrollT * 0.0088;

    // 相机：随滚动缓缓推进、微微抬头 —— 走近那片山
    camera.position.z = 17.6 - scrollT * 4.2;
    camera.position.y = 1.35 + scrollT * 1.15;
    camera.lookAt(0, 5.6 + scrollT * 0.9, -22);

    // 山脊视差：越近的层动得越多
    ridges.forEach((m, i) => {
      if (!m.position) return;
      const depth = (i + 1) / ridges.length;
      m.position.x = Math.sin(t * 0.045 + i * 1.7) * 0.16 * depth
                    + scrollT * depth * 1.1;
    });

    // 灯火呼吸
    lamp.children.forEach(c => {
      if (c.isPointLight) c.intensity = 26 + Math.sin(t * 1.9) * 3.4;
    });

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { renderer, scene, camera };
}
