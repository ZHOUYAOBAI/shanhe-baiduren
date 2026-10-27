/**
 * NOCTURNE · 铜版画排线着色器
 * ---------------------------------------------------------------
 * 核心手法：把「手绘钢笔排线」真正贴到 3D 曲面上。
 *
 * 原理（与视频样片一致）：
 *   1. 用屏幕空间坐标生成平行刻线（不是贴在物体上的贴图），
 *      所以线条始终清晰、不随曲面拉伸变形 —— 这是手绘感的关键。
 *   2. 刻线的疏密由「光照强度」驱动：暗处线密，亮处线疏，
 *      于是 3D 形体自动浮现出体积感，同时保持版画笔触。
 *   3. 背光侧叠加第二组交叉角度刻线，形成真正的交叉排线。
 *   4. 边缘（fresnel）加深，做出钢笔轮廓线。
 *
 * 输出的是「墨色 + 纸色」的双色混合，与站点色板一致。
 */

export const HATCH_UNIFORMS = {
  uPaper:   { value: null },   // 纸色 vec3
  uInk:     { value: null },   // 墨色 vec3
  uLineGap: { value: 3.2 },    // 线距（像素）
  uLineW:   { value: 0.85 },   // 线宽（像素）
  uAngleA:  { value: Math.PI / 4 },  // 主排线角度
  uAngleB:  { value: -Math.PI / 7 }, // 交叉排线角度
  uCrossMix:{ value: 0.55 },   // 交叉排线混合强度
  uLightDir:{ value: null },   // 光照方向 vec3（世界空间）
  uRimPower:{ value: 2.4 },    // 边缘线锐度
  uRimDark: { value: 0.72 },   // 边缘线浓度
  uTone:    { value: 0.5 },    // 整体色调（0 纯白 1 纯墨）
  uHatchMin:{ value: 0.06 },   // 最亮处的线条密度下限
  uHatchMax:{ value: 0.96 },   // 最暗处的线条密度上限
};

/**
 * 排线核心函数：返回墨色覆盖率 0..1
 * screenPos : 屏幕空间坐标（像素）
 * lum       : 光照强度 0..1
 */
const HATCH_CHUNK = /* glsl */ `
  // 抗锯齿平行线：返回该点是否落在刻线上
  // 手绘感：线条宽度随空间位置轻微波动，模拟运笔压力变化
  float inkNoise(vec2 sp) {
    return sin(sp.x * 0.031 + sp.y * 0.017) * 0.5
         + sin(sp.x * 0.011 - sp.y * 0.043) * 0.3
         + sin(sp.x * 0.071 + sp.y * 0.059) * 0.2;
  }

  float hatchLine(vec2 sp, float angle, float gap, float width) {
    float s = sin(angle), c = cos(angle);
    // 加入轻微的位置扰动，刻线不再完全笔直 —— 手绘的关键
    vec2 sp2 = sp + vec2(inkNoise(sp)) * gap * 0.22;
    float d = abs(dot(sp2, vec2(-s, c)));   // 到刻线族的距离
    float f = fract(d / gap);
    float dist = min(f, 1.0 - f) * gap;    // 距最近刻线的像素距离
    // 线宽随位置波动 + 像素比缩放
    float w = width * uPixelRatio * (0.82 + 0.34 * (inkNoise(sp * 0.7) * 0.5 + 0.5));
    return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.2, dist);
  }

  float hatchCoverage(vec2 sp, float lum, vec2 resolution) {
    // 排线密度由暗部驱动：
    //   亮部 → 几乎无线（保留底色）
    //   暗部 → 排线密集
    // 这是铜版画的核心逻辑：线条是"画在暗部"的，不是铺满全表面
    float shade = 1.0 - smoothstep(uHatchMin, uHatchMax, clamp(lum, 0.0, 1.0));

    // 主排线
    float a = hatchLine(sp, uAngleA, uLineGap, uLineW);

    // 交叉排线：只在更暗的区域出现
    float shadow = smoothstep(0.45, 0.02, lum);
    float b = hatchLine(sp, uAngleB, uLineGap * 1.4, uLineW * 0.85) * shadow * uCrossMix;

    float ink = max(a, b);

    // 极暗处实心填充
    float solid = smoothstep(0.10, 0.0, lum);

    // 用 shade 调制线条强度：亮部的线淡、暗部的线浓
    float strength = mix(0.22, 1.0, shade);

    return clamp(max(ink * strength, solid), 0.0, 1.0);
  }
`;

/**
 * 生成排线材质
 * @param {THREE.ShaderMaterial} opts
 */
export function createHatchMaterial(opts = {}) {
  const {
    ink = 0x08080a,
    paper = 0xe0d9d6,
    lineGap = 3.2,
    lineWidth = 0.85,
    angleA = Math.PI / 4,
    angleB = -Math.PI / 7,
    crossMix = 0.55,
    tone = 0.5,
    side = 1,            // 1=FrontSide, 2=BackSide, 3=DoubleSide
    transparent = false,
    flatShading = false,
    rimDark = 0.72,
  } = opts;

  const THREE = opts.THREE;

  return new THREE.ShaderMaterial({
    uniforms: {
      uPaper:    { value: new THREE.Color(paper) },
      uInk:      { value: new THREE.Color(ink) },
      uLineGap:  { value: lineGap },
      uLineW:    { value: lineWidth },
      uAngleA:   { value: angleA },
      uAngleB:   { value: angleB },
      uCrossMix: { value: crossMix },
      uTone:     { value: tone },
      uRimDark:  { value: rimDark },
      uHatchMin: { value: 0.06 },
      uHatchMax: { value: 0.96 },
      uPixelRatio: { value: 1 },
      uLightDir: { value: new THREE.Vector3(0.6, 0.9, 0.8).normalize() },
      uResolution: { value: new THREE.Vector2(1, 1) },
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

      uniform vec3  uPaper;
      uniform vec3  uInk;
      uniform float uLineGap;
      uniform float uLineW;
      uniform float uAngleA;
      uniform float uAngleB;
      uniform float uCrossMix;
      uniform float uTone;
      uniform float uRimDark;
      uniform float uHatchMin;
      uniform float uHatchMax;
      uniform float uPixelRatio;
      uniform vec3  uLightDir;
      uniform vec2  uResolution;

      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec4 vClipPos;

      ${HATCH_CHUNK}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uLightDir);
        vec3 V0 = normalize(cameraPosition - vWorldPos);

        // 漫反射强度
        float lum = dot(N, L) * 0.5 + 0.5;

        // 排线强度：用法线偏离视线的程度（= 曲面转折处）
        // 圆柱正对处偏离小 → 排线淡；轮廓边缘偏离大 → 排线浓
        // 这是铜版画处理圆柱体的核心手法：排线画在"转折"上
        float turn = 1.0 - abs(dot(N, V0));
        float hatchLum = clamp(lum * 0.42 + turn * 0.95, 0.0, 1.0);

        // 屏幕空间坐标（像素）：用于画刻线
        vec2 sp = vClipPos.xy / vClipPos.w * uResolution * 0.5;

        // 排线覆盖率
        float ink = hatchCoverage(sp, hatchLum, uResolution);

        // 边缘轮廓：fresnel 增强，形成钢笔描边
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fres = 1.0 - abs(dot(N, V));
        float rim = smoothstep(0.42, 0.88, fres) * uRimDark;
        ink = max(ink, rim);

        // 底色：由 uPaper 决定（可被调成瓶身彩色）
        vec3 base = uPaper;

        // 刻线颜色：用 uInk 画在底色上
        // 亮部刻线淡、暗部刻线浓 —— 这才是排线的明暗逻辑
        float lineAlpha = mix(0.30, 1.0, ink);

        // 体积明暗：以底色自身做亮暗，模拟手绘的平涂调子
        float shade = mix(1.0, 0.72, smoothstep(0.75, 0.0, lum));

        vec3 col = mix(base, uInk, ink * 0.92);
        col *= shade;

        // 整体色调偏移
        col = mix(col, uInk, uTone * 0.10 * (1.0 - lum));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: side === 1 ? THREE.FrontSide : side === 2 ? THREE.BackSide : THREE.DoubleSide,
    transparent,
    flatShading,
  });
}

/**
 * 金属质感材质（用于瓶盖）
 * 保留一点光泽，但整体压暗以融入版画体系
 */
export function createMetalMaterial(THREE, opts = {}) {
  const { color = 0xd8d2cd, roughness = 0.28, metalness = 0.85 } = opts;
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    envMapIntensity: 1.4,
  });
}

/**
 * 纯色但带轮廓的材质（用于彩色球体等）
 * 用 BackSide 放大一层做描边，是三体常用的 toon outline 技巧
 */
export function createOutlinedMesh(THREE, geometry, material, opts = {}) {
  const { thickness = 0.035, color = 0x08080a } = opts;
  const group = new THREE.Group();

  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);

  const outlineMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
  });
  const outline = new THREE.Mesh(geometry, outlineMat);
  outline.scale.multiplyScalar(1 + thickness);
  group.add(outline);

  return group;
}
