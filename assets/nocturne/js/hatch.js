/**
 * NOCTURNE · 铜版画蚀刻材质
 * ---------------------------------------------------------------
 * 与参考视频一致的「平涂插画 + 极细密排线」模型。
 *
 * 与首轮（光照驱动排线）的根本区别：
 *   首轮：线条密度由光照暗部驱动 → 亮部完全无线 → 退化成平涂色块
 *   本轮：线条密度**恒定**铺满表面（1px 级极细密），
 *         体积感另由「法线 vs 光向」的形体明暗承担，
 *         轮廓另由 BackSide 外扩壳承担。
 *   这正是视频样片的观感：像铜版画，而不是渲染。
 *
 * 屏幕空间刻线（非贴图）：线不随曲面拉伸变形，这是手绘感的关键。
 * 叠加三层正弦扰动 → 运笔压力变化，线不再是机械等距。
 */

/* ============================================================
   通用着色器片段
   ============================================================ */
const ENGRAVE_CHUNK = /* glsl */ `
  // 三层正弦叠加：位置扰动 + 线宽波动（模拟运笔压力）
  float inkNoise(vec2 sp) {
    return sin(sp.x * 0.031 + sp.y * 0.017) * 0.5
         + sin(sp.x * 0.011 - sp.y * 0.043) * 0.3
         + sin(sp.x * 0.071 + sp.y * 0.059) * 0.2;
  }

  // 屏幕空间平行刻线，返回 0..1 覆盖度
  float engraveLine(vec2 sp, float angle, float gap, float width) {
    float s = sin(angle), c = cos(angle);
    vec2 p = sp + vec2(inkNoise(sp)) * gap * 0.18;
    float d = abs(dot(p, vec2(-s, c)));
    float f = fract(d / gap);
    float dist = min(f, 1.0 - f) * gap;
    float w = width * (0.82 + 0.36 * (inkNoise(sp * 0.7) * 0.5 + 0.5));
    return 1.0 - smoothstep(w * 0.5, w * 0.5 + 0.9, dist);
  }
`;

/**
 * 蚀刻材质：平涂底色 + 极细密刻线 + 形体明暗 + 边缘墨线
 *
 * @param {object} opts
 * @param {THREE}  opts.THREE
 * @param {number} opts.base     底色（平涂色）
 * @param {number} opts.ink      墨色（刻线与暗部）
 * @param {number} opts.lineGap  线距（CSS px，随像素比缩放）
 * @param {number} opts.lineW    线宽（CSS px）
 * @param {number} opts.angle    刻线角度（0 = 水平，PI/2 = 垂直）
 * @param {number} opts.lineAlpha 刻线浓度 0..1
 * @param {number} opts.shade    形体明暗强度 0..1
 * @param {number} opts.rimDark  边缘墨线浓度 0..1
 * @param {THREE.Vector3} opts.light 光向（世界空间）
 */
export function createEngravedMaterial(opts = {}) {
  const {
    THREE,
    base = 0xf8f2e8,
    ink = 0x0e0d12,
    lineGap = 2.4,
    lineW = 0.5,
    angle = Math.PI / 2,
    lineAlpha = 0.34,
    shade = 0.30,
    rimDark = 0.55,
    light = new THREE.Vector3(-0.45, 0.72, 0.62).normalize(),
    side = 'front',
    transparent = false,
  } = opts;

  return new THREE.ShaderMaterial({
    transparent,
    uniforms: {
      uBase:      { value: new THREE.Color(base) },
      uInk:       { value: new THREE.Color(ink) },
      uLineGap:   { value: lineGap },
      uLineW:     { value: lineW },
      uAngle:     { value: angle },
      uLineAlpha: { value: lineAlpha },
      uShade:     { value: shade },
      uRimDark:   { value: rimDark },
      uLightDir:  { value: light.clone() },
      uResolution:{ value: new THREE.Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec4 vClipPos;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vClipPos = projectionMatrix * viewMatrix * worldPos;
        gl_Position = vClipPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3  uBase;
      uniform vec3  uInk;
      uniform float uLineGap;
      uniform float uLineW;
      uniform float uAngle;
      uniform float uLineAlpha;
      uniform float uShade;
      uniform float uRimDark;
      uniform vec3  uLightDir;
      uniform vec2  uResolution;

      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec4 vClipPos;

      ${ENGRAVE_CHUNK}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uLightDir);
        vec3 V = normalize(cameraPosition - vWorldPos);

        // ---- 形体明暗：法线偏离光向越多越暗 ----
        // 分两段：柔和的整体调子 + 一段边界较硬的暗面（对应平涂插画的块面）
        float ndl  = dot(N, L) * 0.5 + 0.5;
        float soft = smoothstep(1.0, 0.08, ndl);
        float hard = smoothstep(0.46, 0.24, ndl);
        float form = clamp(soft * 0.55 + hard * 0.75, 0.0, 1.0);

        vec3 col = mix(uBase, uInk, form * uShade);

        // ---- 刻线：屏幕空间，密度恒定 ----
        vec2 sp = vClipPos.xy / vClipPos.w * uResolution * 0.5;
        float line = engraveLine(sp, uAngle, uLineGap, uLineW);
        col = mix(col, uInk, line * uLineAlpha);

        // ---- 边缘墨线：fresnel ----
        float fres = 1.0 - abs(dot(N, V));
        float rim = smoothstep(0.55, 0.94, fres) * uRimDark;
        col = mix(col, uInk, rim);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: side === 'back' ? THREE.BackSide
        : side === 'double' ? THREE.DoubleSide
        : THREE.FrontSide,
  });
}

/**
 * 墨线轮廓壳：沿法线在视图空间外扩
 * 粗细在屏幕上恒定，比 scale 放大更接近真实钢笔线。
 */
export function createOutlineMaterial(THREE, opts = {}) {
  const { ink = 0x0e0d12, thickness = 0.02 } = opts;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uInk:       { value: new THREE.Color(ink) },
      uThickness: { value: thickness },
    },
    vertexShader: /* glsl */ `
      uniform float uThickness;
      void main() {
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz += n * uThickness;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      void main() { gl_FragColor = vec4(uInk, 1.0); }
    `,
  });
}

/**
 * 纯墨平面（标签带等无纹理块面）
 */
export function createFlatMaterial(THREE, color = 0x0e0d12) {
  return new THREE.MeshBasicMaterial({ color });
}

/**
 * 收集需要描边的 mesh 并统一加轮廓壳
 * 必须「先收集再统一添加」，否则 traverse 会把新加的描边再套一层 → 无限套娃爆栈。
 */
export function addOutlines(root, THREE, opts = {}) {
  const { thickness = 0.02, ink = 0x0e0d12 } = opts;
  const targets = [];
  root.traverse((o) => {
    if (o.isMesh && o.userData.noOutline !== true && o.userData.outlined !== true) {
      targets.push(o);
    }
  });
  targets.forEach((o) => {
    const shell = new THREE.Mesh(o.geometry, createOutlineMaterial(THREE, { ink, thickness }));
    shell.userData.noOutline = true;
    shell.renderOrder = -1;
    o.add(shell);
    o.userData.outlined = true;
  });
  return targets.length;
}
