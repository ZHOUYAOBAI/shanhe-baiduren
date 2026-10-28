#!/usr/bin/env python3
"""
NOCTURNE · 铜版画线稿资产生成器（按参考视频逐帧复刻重写）

与初版的根本差异：
  初版 = 抽象几何体 + 疏朗斜向排线
  本版 = 参考视频里的具体手绘插画 + 极细密排线 + 平涂色块

排线密度来自视频实测：1px 级细密排线，而非疏朗速写。
"""
import math, os, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "svg"
OUT.mkdir(parents=True, exist_ok=True)

RED    = "#FF0000"
PAPER  = "#F8F2E8"
INK    = "#0E0D12"
BLUE   = "#4FB6F9"
GREEN  = "#91EA82"
YELLOW = "#FDDE1F"


def save(name, body, w, h):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
           f'viewBox="0 0 {w} {h}" fill="none">{body}</svg>')
    (OUT / name).write_text(svg, encoding="utf-8")
    return len(svg)


# ============================================================
# 排线引擎
# ============================================================
def hatch(x0, y0, x1, y1, angle=math.pi/2, gap=3.0, width=0.6,
          color=INK, opacity=0.5, jitter=0.0, seed=0, wave=0.0):
    """在一矩形区域内生成细密排线。
    angle: 线条角度（弧度）；gap: 线距（px）；jitter: 手绘抖动幅度
    wave:  波形弯曲幅度（模拟 3D 曲面上的线 —— 视频中背景竖线即为此效果）
    """
    p = []
    diag = math.hypot(x1 - x0, y1 - y0)
    s, c = math.sin(angle), math.cos(angle)
    nx, ny = -s, c          # 法线方向
    n = int(diag / gap) + 2
    for i in range(-n, n):
        d = i * gap
        # 疏密起伏：确定性的正弦，保证整体均匀、无随机聚簇
        phase = i * 0.55 + seed
        d += jitter * math.sin(phase)
        px = x0 + (x1 - x0) / 2 + nx * d
        py = y0 + (y1 - y0) / 2 + ny * d
        op = opacity
        # 线条深浅也按同一相位起伏（明暗成带，非聚簇）
        op *= 0.80 + 0.20 * (0.5 + 0.5 * math.sin(phase * 0.9))
        dx, dy = c * diag, s * diag
        if wave:
            # 二次贝塞尔近似正弦扰动：让线呈波形（曲面透视效果）
            mx, my = px, py
            ex, ey = px + dx, py + dy
            amp = wave * math.sin(i * 0.9 + seed)
            cxp = (mx + ex) / 2 + nx * amp
            cyp = (my + ey) / 2 + ny * amp
            p.append(f'<path d="M{mx:.1f} {my:.1f}Q{cxp:.1f} {cyp:.1f} {ex:.1f} {ey:.1f}" '
                     f'stroke="{color}" stroke-width="{width}" opacity="{op:.3f}"/>')
        else:
            p.append(f'<path d="M{px-dx/2:.1f} {py-dy/2:.1f}L{px+dx/2:.1f} {py+dy/2:.1f}" '
                     f'stroke="{color}" stroke-width="{width}" opacity="{op:.3f}"/>')
    return "".join(p)



def hatch_displaced(x0, y0, x1, y1, angle=math.pi/2, gap=2.0, width=0.45,
                    color=INK, opacity=0.35, seed=0, amp=14.0, freq=0.045,
                    phase=0.0):
    """位移排线：竖线沿水平方向被正弦扭曲。
    这是视频里人物/幕布的核心效果 —— 排线被"位移贴图"拉出波浪，
    仿佛透过水波或哈哈镜看到的幕布。"""
    p = []
    diag = math.hypot(x1 - x0, y1 - y0)
    s_, c_ = math.sin(angle), math.cos(angle)
    nx, ny = -s_, c_
    n = int(diag / gap) + 2
    for i in range(-n, n):
        d = i * gap
        px = x0 + (x1 - x0) / 2 + nx * d
        py = y0 + (y1 - y0) / 2 + ny * d
        op = opacity * (0.82 + 0.18 * (0.5 + 0.5 * math.sin(i * 0.55 + seed)))
        # 沿线的方向采样多个点，每个点按波形横向偏移
        steps = 14
        pts = []
        for k in range(steps + 1):
            t = k / steps
            bx = px + c_ * diag * (t - 0.5)
            by = py + s_ * diag * (t - 0.5)
            off = amp * math.sin(by * freq + i * 0.19 + phase)
            pts.append((bx + nx * off, by + ny * off))
        dstr = "M" + " L".join(f"{a:.1f} {b:.1f}" for a, b in pts)
        p.append(f'<path d="{dstr}" stroke="{color}" stroke-width="{width}" opacity="{op:.3f}"/>')
    return "".join(p)


def hatch_horizontal(x0, y0, x1, y1, gap=2.1, width=0.42, color=INK,
                     opacity=0.20, seed=0, curve=0.0):
    """横向排线：逐根画线段，天然限制在给定矩形内。
    curve: 每根线的弓形高度（模拟圆柱面上的弧线）
    """
    p = []
    n = int((y1 - y0) / gap)
    for i in range(n + 1):
        y = y0 + i * gap
        op = opacity * (0.82 + 0.18 * (0.5 + 0.5 * math.sin(i * 0.55 + seed)))
        # 圆柱面弧线：两端略高，中间略低
        mid = (x0 + x1) / 2
        if curve:
            half = (x1 - x0) / 2
            d = (f'M{x0:.1f} {y:.1f} '
                 f'Q{mid:.1f} {y + curve * (1 - ((mid-x0)/half)**2):.1f} {x1:.1f} {y:.1f}')
        else:
            d = f'M{x0:.1f} {y:.1f}H{x1:.1f}'
        p.append(f'<path d="{d}" stroke="{color}" stroke-width="{width}" opacity="{op:.3f}"/>')
    return "".join(p)


def hatch_shape(path_d, angle, gap, width, color, opacity, seed=0, bbox=None):
    """在给定路径内生成排线（用 clipPath 裁剪）"""
    x0, y0, x1, y1 = bbox
    lines = hatch(x0, y0, x1, y1, angle, gap, width, color, opacity,
                  jitter=gap * 0.18, seed=seed)
    cid = f"hc{seed}"
    return (f'<defs><clipPath id="{cid}"><path d="{path_d}"/></clipPath></defs>'
            f'<g clip-path="url(#{cid})">{lines}</g>')


# ============================================================
# 场景一：红幕剧场（参考视频 s_040 帧）
#   纯红幕布 + 米白地面 + 圆柱台座 + 三只瓶 + 长袍人物剪影
# ============================================================
def gen_stage_scene(w=1000, h=680):
    """红幕剧场 · 三瓶为主体
    构图参考视频 s_040 / s_050：三只瓶居中偏右占画面主体，
    背景为米白排线墙，底部米白台面，顶部露正红幕布。"""
    p = []

    # ---------- 背景：米白排线墙（极细密竖线，线距约 2px） ----------
    p.append(f'<rect x="0" y="0" width="{w}" height="{h}" fill="{PAPER}"/>')
    wall = hatch(-10, -10, w + 10, h, math.pi / 2, 2.4, 0.5, INK, 0.34,
                 jitter=0.35, seed=2, wave=0.0)
    p.append(wall)

    # ---------- 顶部红幕（露出的一条） ----------
    curtain_h = int(h * 0.13)
    p.append(f'<rect x="0" y="0" width="{w}" height="{curtain_h}" fill="{RED}"/>')
    for i in range(int(w / 2.4)):
        x = i * 2.4 + 1
        op = 0.12 + 0.20 * abs(math.sin(i * 0.11))
        amp = 4.0 * math.sin(i * 0.19 + 0.7)
        p.append(f'<path d="M{x:.1f} 0 Q{x+amp:.1f} {curtain_h*0.5:.1f} {x:.1f} {curtain_h}" '
                 f'stroke="{INK}" stroke-width="0.55" opacity="{op:.3f}"/>')
    # 幕布下缘
    p.append(f'<path d="M0 {curtain_h-1} '
             + " ".join(f'Q{w*(i+1)/8:.0f} {curtain_h + (7 if i%2==0 else -5):.0f} {w*(i+1)/4:.0f} {curtain_h}'
                        for i in range(4))
             + f'" stroke="{INK}" stroke-width="1.4" opacity=".5" fill="none"/>')

    # ---------- 底部台面（米白横排线） ----------
    table_y = int(h * 0.80)
    p.append(f'<rect x="0" y="{table_y}" width="{w}" height="{h-table_y}" fill="{PAPER}"/>')
    p.append(hatch(0, table_y, w, h, 0.0, 2.2, 0.5, INK, 0.26, jitter=0.3, seed=5, wave=0.0))
    p.append(f'<path d="M0 {table_y} H{w}" stroke="{INK}" stroke-width="1.6" opacity=".55"/>')

    # ---------- 瓶子（主体） ----------
    def bottle(bx, by, bh, bw, color):
        """白球盖(横向螺纹线) + 白颈 + 纯色瓶身(极细密横排线) + 黑标签带"""
        g = []
        bw2 = bw / 2
        cap_r = bw2 * 0.66
        neck_w = bw2 * 0.44
        neck_h = bw * 0.42

        # 瓶身（纯色块，肩部圆角）
        g.append(f'<path d="M{bx-bw2} {by} v-{bh-bw2*0.3} '
                 f'q0 -{bw2*0.30} {bw2*0.30} -{bw2*0.30} '
                 f'h{bw2*1.40} q{bw2*0.30} 0 {bw2*0.30} {bw2*0.30} '
                 f'V{by} Z" fill="{color}"/>')
        # 瓶身横向极细密排线（直接画线段，天然不溢出）
        body_top = by - bh + bw2 * 0.30
        g.append(hatch_horizontal(bx - bw2, body_top, bx + bw2, by,
                                  gap=2.1, width=0.46, opacity=0.34, seed=bx, curve=1.6))
        # 右侧暗面（圆柱受光）
        g.append(f'<path d="M{bx+bw2*0.30} {by} v-{bh-bw2*0.3} '
                 f'q0 -{bw2*0.30} {bw2*0.30} -{bw2*0.30} h{bw2*0.40} '
                 f'v{bh-bw2*0.3} Z" fill="{INK}" opacity=".22"/>')
        # 肩部收口
        g.append(f'<path d="M{bx-bw2*0.74} {by-bh+bw2*0.30} '
                 f'q0 -{bw2*0.32} {bw2*0.28} -{bw2*0.36} '
                 f'h{bw2*0.92} q{bw2*0.28} 0.04 {bw2*0.28} {bw2*0.36} Z" fill="{color}"/>')
        g.append(hatch_horizontal(bx - bw2 * 0.70, by - bh + bw2 * 0.30,
                                  bx + bw2 * 0.70, by - bh + bw2 * 0.32,
                                  gap=2.0, width=0.46, opacity=0.26, seed=bx + 5))
        # 瓶颈（白，带金属环）
        g.append(f'<rect x="{bx-neck_w/2}" y="{by-bh-neck_h}" width="{neck_w}" height="{neck_h}" fill="{PAPER}"/>')
        g.append(f'<path d="M{bx+neck_w*0.16} {by-bh-neck_h} v{neck_h}" stroke="{INK}" '
                 f'stroke-width="1.2" opacity=".55"/>')
        # 颈环（金属细带）
        g.append(f'<rect x="{bx-neck_w/2-1.5}" y="{by-bh-neck_h*0.62}" '
                 f'width="{neck_w+3}" height="3" fill="{INK}" opacity=".65"/>')
        # 瓶盖：白色球形 + 横向螺纹排线
        cap_cx, cap_cy = bx, by - bh - neck_h - cap_r * 0.66
        g.append(f'<circle cx="{cap_cx}" cy="{cap_cy}" r="{cap_r}" fill="{PAPER}"/>')
        cap_cid = f"cc{int(bx)}"
        cap_lines = hatch_horizontal(cap_cx - cap_r, cap_cy - cap_r,
                                     cap_cx + cap_r, cap_cy + cap_r,
                                     gap=1.7, width=0.48, opacity=0.46, seed=bx + 3)
        g.append(f'<defs><clipPath id="{cap_cid}"><circle cx="{cap_cx}" cy="{cap_cy}" r="{cap_r}"/></clipPath></defs>'
                 f'<g clip-path="url(#{cap_cid})">{cap_lines}</g>')
        g.append(f'<path d="M{cap_cx-cap_r*0.74} {cap_cy-cap_r*0.40} '
                 f'q{cap_r*0.44} -{cap_r*0.50} {cap_r*0.88} -{cap_r*0.05}" '
                 f'stroke="{PAPER}" stroke-width="1.8" fill="none" opacity=".95"/>')
        g.append(f'<circle cx="{cap_cx}" cy="{cap_cy}" r="{cap_r}" fill="none" '
                 f'stroke="{INK}" stroke-width="1" opacity=".7"/>')
        # 黑色标签带
        lbl_y = by - bh * 0.42
        g.append(f'<rect x="{bx-bw2}" y="{lbl_y}" width="{bw2*2}" height="{bh*0.16}" fill="{INK}"/>')
        g.append(f'<path d="M{bx-bw2*0.42} {lbl_y+bh*0.05} '
                 f'q{bw2*0.14} -{bh*0.045} {bw2*0.26} 0 q{bw2*0.14} {bh*0.045} {bw2*0.26} 0" '
                 f'stroke="{PAPER}" stroke-width="1.1" fill="none" opacity=".92"/>')
        return "".join(g)

    base = table_y
    p.append(bottle(int(w * 0.42), base, int(h * 0.40), 62, BLUE))
    p.append(bottle(int(w * 0.545), base, int(h * 0.33), 55, GREEN))
    p.append(bottle(int(w * 0.665), base, int(h * 0.44), 60, YELLOW))

    # ---------- 圆形 HOLD 按钮（视频中确有此元素） ----------
    btn_cx, btn_cy, btn_r = int(w * 0.775), int(h * 0.52), 30
    p.append(f'<circle cx="{btn_cx}" cy="{btn_cy}" r="{btn_r}" fill="{PAPER}" '
             f'stroke="{INK}" stroke-width="1.4"/>')
    for i, ch in enumerate("HOLD"):
        p.append(f'<rect x="{btn_cx-18+i*9}" y="{btn_cy-5}" width="5.6" height="10" fill="{INK}" opacity=".88"/>')

    return "".join(p)


# ============================================================
# 场景二：手绘手臂倒酒（参考视频 s_060 帧）
#   正红底 + 米白手部线稿 + 蓝色酒液
# ============================================================
def gen_pour_scene(w=760, h=560):
    p = []
    p.append(f'<rect x="0" y="0" width="{w}" height="{h}" fill="{RED}"/>')
    # 幕布排线
    for i in range(int(w / 6)):
        x = i * 6 + 2
        op = 0.04 + 0.06 * abs(math.sin(i * 0.19))
        p.append(f'<path d="M{x} 0V{h}" stroke="{INK}" stroke-width="0.5" opacity="{op:.3f}"/>')

    # 酒瓶（斜握，蓝色）
    p.append(f'<g transform="rotate(-14 {w*0.34} {h*0.42})">')
    bx, by = int(w * 0.18), int(h * 0.30)
    bw, bh = 190, 82
    p.append(f'<path d="M{bx} {by} h{bw} v{bh} h-{bw} Z" fill="{BLUE}"/>')
    p.append(hatch(bx, by, bx + bw, by + bh, 0.0, 3.6, 0.45, INK, 0.17, jitter=0.6, seed=21))
    # 瓶颈
    p.append(f'<path d="M{bx+bw-6} {by} v-34 h56 v34 Z" fill="{BLUE}"/>')
    p.append(hatch(bx + bw - 6, by - 34, bx + bw + 50, by, 0.0, 3.2, 0.45, INK, 0.15, seed=23))
    # 瓶口
    p.append(f'<path d="M{bx+bw+2} {by-34} h48 v12 h-48 Z" fill="{PAPER}"/>')
    p.append(hatch(bx + bw + 2, by - 34, bx + bw + 50, by - 22, math.pi / 2, 2.6, 0.45, INK, 0.24, seed=25))
    # 黑标签带
    p.append(f'<rect x="{bx+bw-52}" y="{by+14}" width="44" height="26" fill="{INK}"/>')
    p.append(f'</g>')

    # 手（米白线稿，从左上伸入）
    p.append(f'<path d="M{w*0.06} {h*0.30} '
             f'C{w*0.14} {h*0.30} {w*0.20} {h*0.34} {w*0.26} {h*0.40} '
             f'C{w*0.30} {h*0.44} {w*0.30} {h*0.50} {w*0.26} {h*0.54} '
             f'C{w*0.22} {h*0.57} {w*0.18} {h*0.55} {w*0.18} {h*0.51} '
             f'C{w*0.18} {h*0.46} {w*0.16} {h*0.44} {w*0.12} {h*0.43} '
             f'C{w*0.07} {h*0.41} {w*0.04} {h*0.36} {w*0.06} {h*0.30} Z" fill="{PAPER}"/>')
    # 手的排线阴影
    p.append(hatch(int(w * 0.06), int(h * 0.28), int(w * 0.30), int(h * 0.58),
                   math.pi / 2, 3.6, 0.45, INK, 0.18, jitter=0.6, seed=31))

    # 倾泻的酒液（蓝色带状）
    p.append(f'<path d="M{w*0.60} {h*0.44} '
             f'C{w*0.63} {h*0.55} {w*0.66} {h*0.62} {w*0.68} {h*0.68} '
             f'L{w*0.72} {h*0.68} '
             f'C{w*0.71} {h*0.60} {w*0.70} {h*0.52} {w*0.70} {h*0.44} Z" fill="{BLUE}"/>')

    # 鸡尾酒杯（白线稿）
    cx, cy = int(w * 0.70), int(h * 0.72)
    p.append(f'<path d="M{cx-46} {cy} L{cx+46} {cy} L{cx+6} {cy+52} L{cx-6} {cy+52} Z" fill="{PAPER}"/>')
    p.append(f'<rect x="{cx-4}" y="{cy+52}" width="8" height="72" fill="{PAPER}"/>')
    p.append(f'<ellipse cx="{cx}" cy="{cy+124}" rx="26" ry="6" fill="{PAPER}"/>')
    # 杯中酒液
    p.append(f'<path d="M{cx-40} {cy+4} L{cx+40} {cy+4} L{cx+5} {cy+48} L{cx-5} {cy+48} Z" fill="{BLUE}"/>')
    # 杯身排线
    p.append(hatch(cx - 46, cy, cx + 46, cy + 52, math.pi / 2, 3.4, 0.45, INK, 0.20, jitter=0.5, seed=41))

    # 飞溅的小点
    p.append(f'<circle cx="{w*0.80}" cy="{h*0.52}" r="9" fill="{PAPER}"/>')
    p.append(f'<circle cx="{w*0.86}" cy="{h*0.44}" r="4" fill="{PAPER}"/>')

    return "".join(p)


# ============================================================
# 场景三：黑色频谱（参考视频 s_005 / s_050 帧）
#   黑白竖条构成的波形轮廓
# ============================================================
def gen_spectrum_scene(w=1000, h=680, seed=7):
    """黑色频谱波形（参考视频 s_005 / s_050 帧）
    特征：黑底 + 白色细竖条，竖条高度构成波形轮廓，条与条之间留黑隙"""
    p = []
    p.append(f'<rect x="0" y="0" width="{w}" height="{h}" fill="{INK}"/>')
    step = 3.2
    bar_w = 1.7
    for i in range(0, int(w / step)):
        x = i * step
        t = i / (w / step)
        # 复合包络：低频大波 + 中频 + 高频细碎
        env = (0.34
               + 0.40 * abs(math.sin(t * 5.3 + seed))
               + 0.18 * abs(math.sin(t * 13.7 + seed * 1.6))
               + 0.10 * abs(math.sin(t * 31.1 + seed * 2.2)))
        fine = 0.07 * math.sin(i * 1.9 + seed)
        amp = max(0.04, min(1.0, env + fine))
        top = h * (0.05 + (1 - amp) * 0.16)
        bot = h * (0.95 - amp * 0.62)
        op = 0.55 + 0.42 * abs(math.sin(i * 0.31 + seed))
        p.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{bar_w}" '
                 f'height="{max(1.0, bot-top):.1f}" fill="{PAPER}" opacity="{op:.2f}"/>')
    return "".join(p)


# ============================================================
# 场景四：幕布褶皱（纯红底 + 竖向深色褶皱线）
# ============================================================
def gen_curtain_scene(w=900, h=560):
    p = []
    p.append(f'<rect x="0" y="0" width="{w}" height="{h}" fill="{RED}"/>')
    for i in range(int(w / 3.2)):
        x = i * 3.2 + 1.5
        op = 0.07 + 0.16 * abs(math.sin(i * 0.19)) + 0.06 * abs(math.sin(i * 0.53))
        p.append(f'<path d="M{x} 0V{h}" stroke="{INK}" stroke-width="0.6" opacity="{op:.3f}"/>')
        p.append(f'<path d="M{x+1.6} 0V{h}" stroke="{PAPER}" stroke-width="0.5" opacity="{0.06*abs(math.sin(i*0.19)):.3f}"/>')
    return "".join(p)


# ============================================================
# 场景五：举杯人物（参考视频 s_070 帧）
#   红色幕布 + 米白幕布 + 由色块构成的平面人物
# ============================================================
def gen_toast_scene(w=760, h=560):
    p = []
    # 左侧米白幕布
    p.append(f'<rect x="0" y="0" width="{int(w*0.34)}" height="{h}" fill="{PAPER}"/>')
    # 右侧红幕
    p.append(f'<rect x="{int(w*0.34)}" y="0" width="{w-int(w*0.34)}" height="{h}" fill="{RED}"/>')
    # 米白幕布排线
    p.append(hatch(0, 0, int(w * 0.34), h, math.pi / 2, 5.0, 0.45, INK, 0.10, jitter=0.8, seed=51))
    # 红幕排线
    p.append(hatch(int(w * 0.34), 0, w, h, math.pi / 2, 5.4, 0.45, INK, 0.09, jitter=0.8, seed=53))

    # 人物：由色块构成的平面图形（不是写实）
    cx, cy = int(w * 0.52), int(h * 0.42)
    # 躯干（金黄）
    p.append(f'<path d="M{cx-52} {cy+30} L{cx-40} {cy-52} L{cx+40} {cy-52} '
             f'L{cx+56} {cy+30} L{cx+44} {h-40} L{cx-40} {h-40} Z" fill="#C8A03C"/>')
    # 蓝袍
    p.append(f'<path d="M{cx-18} {cy-40} L{cx+30} {cy-40} L{cx+40} {cy+60} L{cx-16} {cy+64} Z" fill="{BLUE}"/>')
    # 蓝袍排线
    p.append(hatch(cx - 18, cy - 40, cx + 40, cy + 64, math.pi / 2, 3.8, 0.45, INK, 0.17, jitter=0.6, seed=61))
    # 举起的杯子（米白线稿）
    p.append(f'<path d="M{cx+34} {cy-56} h14 v-30 h-4 v30 h-10 Z" fill="{PAPER}"/>')
    p.append(hatch(cx + 30, cy - 88, cx + 52, cy - 52, math.pi / 2, 2.8, 0.45, INK, 0.24, seed=63))
    # 手臂（米白线稿）
    p.append(f'<path d="M{cx+34} {cy-34} C{cx+48} {cy-48} {cx+46} {cy-72} {cx+38} {cy-80} '
             f'L{cx+28} {cy-74} C{cx+34} {cy-66} {cx+34} {cy-54} {cx+24} {cy-44} Z" fill="{PAPER}"/>')
    p.append(hatch(cx + 20, cy - 84, cx + 54, cy - 30, math.pi / 2, 3.4, 0.45, INK, 0.20, jitter=0.5, seed=65))
    # 头（米白）
    p.append(f'<ellipse cx="{cx+2}" cy="{cy-72}" rx="16" ry="18" fill="{PAPER}"/>')
    p.append(hatch(cx - 14, cy - 90, cx + 18, cy - 54, math.pi / 2, 3.2, 0.45, INK, 0.16, seed=67))
    # 头发（黑）
    p.append(f'<path d="M{cx-16} {cy-76} C{cx-16} {cy-96} {cx+18} {cy-96} {cx+18} {cy-74} '
             f'C{cx+12} {cy-84} {cx-8} {cy-84} {cx-16} {cy-76} Z" fill="{INK}"/>')
    return "".join(p)


# ============================================================
# UI 元素：顶栏 logo / 标签条 / HOLD 按钮
# ============================================================
def gen_logo(w=200, h=70, color=PAPER):
    """连笔手写体签名 logo：单笔连续曲线（像真实签名的连绵笔迹）"""
    p = []
    # 一条连续的主笔画，模拟连笔签名
    p.append(f'<path d="M10 50 '
             f'C16 28 24 14 30 13 C35 12 33 22 27 32 C21 42 15 52 12 54 '
             f'C19 50 25 40 30 32 C34 26 36 30 34 38 C32 46 30 52 33 54 '
             f'C38 50 42 34 47 22 C51 12 56 12 55 22 C54 32 48 46 45 52 '
             f'C50 48 55 34 59 22 C62 13 66 13 66 21 C66 30 61 44 60 52 '
             f'C64 54 70 48 76 40 C80 34 84 32 86 36 C88 40 85 47 88 50 '
             f'C92 53 98 50 104 45 C108 42 112 41 116 42" '
             f'stroke="{color}" stroke-width="2.6" stroke-linecap="round" '
             f'stroke-linejoin="round" fill="none"/>')
    # 收笔的细拖尾
    p.append(f'<path d="M116 42 C126 46 138 44 148 38" stroke="{color}" '
             f'stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".85"/>')
    return "".join(p)


def gen_tagbar(w=340, h=40):
    """右上角白底标签条：EXPERIENCE / ABOUT / COLLECTION"""
    p = []
    p.append(f'<rect x="0" y="0" width="{w}" height="{h}" fill="{PAPER}"/>')
    p.append(f'<rect x="0" y="0" width="{w}" height="{h}" fill="none" stroke="{INK}" stroke-width="1"/>')
    items = [("EXPERIENCE", 12), ("ABOUT", 148), ("COLLECTION", 222)]
    for label, x in items:
        cw = len(label) * 7.2 + 4
        for i, ch in enumerate(label):
            cx = x + i * 7.2
            p.append(f'<rect x="{cx}" y="{h/2-6}" width="4.6" height="11" fill="{INK}" opacity=".88"/>')
    return "".join(p)


def gen_hold_button(size=96):
    """白色圆形 HOLD 按钮"""
    p = []
    r = size / 2
    p.append(f'<circle cx="{r}" cy="{r}" r="{r-2}" fill="{PAPER}" stroke="{INK}" stroke-width="1.6"/>')
    for i, ch in enumerate("HOLD"):
        p.append(f'<rect x="{r-20+i*11}" y="{r-5}" width="7" height="10" fill="{INK}" opacity=".88"/>')
    return "".join(p)


# ============================================================
# 作品徽记（四种母题，沿用但重绘为细密排线风格）
# ============================================================
def gen_emblem(kind, w=180, h=180, color=INK):
    p = []
    c = w / 2
    if kind == "harp":       # 弦
        p.append(f'<path d="M32 146q58-14 116 0" stroke="{color}" stroke-width="1.2"/>')
        p.append(f'<path d="M32 146V50M148 146V50" stroke="{color}" stroke-width="1.2"/>')
        for i in range(22):
            t = i / 21
            x = 34 + t * 112
            top = 44 + 26 * math.sin(math.pi * t)
            p.append(f'<path d="M{x:.1f} {top:.1f}V146" stroke="{color}" stroke-width=".55" '
                     f'opacity="{0.28+0.4*t:.2f}"/>')
    elif kind == "rings":    # 环
        for i, r in enumerate([64, 52, 40, 28]):
            p.append(f'<circle cx="{c}" cy="{c}" r="{r}" stroke="{color}" stroke-width="1.1" '
                     f'opacity="{0.85-i*0.16:.2f}"/>')
        p.append(f'<circle cx="{c}" cy="{c}" r="12" fill="{color}"/>')
    elif kind == "wave":     # 波
        for i in range(9):
            y = 40 + i * 12
            d = f"M26 {y}"
            for k in range(8):
                d += f" q8 {7 if k%2==0 else -7} 16 0"
            p.append(f'<path d="{d}" stroke="{color}" stroke-width=".8" opacity="{0.28+0.08*i:.2f}"/>')
    else:                    # arc 聚光
        p.append(f'<path d="M74 40L18 154M74 40L130 154" stroke="{color}" stroke-width="1.2"/>')
        p.append(f'<ellipse cx="74" cy="154" rx="56" ry="9" stroke="{color}" stroke-width="1"/>')
        p.append(f'<circle cx="74" cy="40" r="13" fill="{color}"/>')
    return "".join(p)



def gen_figure(w=420, h=420, color=PAPER, ink=INK):
    """圆形画框内的人物（位移排线手法）
    造型参照视频 s_070 帧：人物是「排线 + 垂直位移扭曲」的产物，
    不是规整剪影。身体用被扭曲的排线勾勒，黑色块面为底。
    """
    p = []
    cx = w / 2
    base = h - 20
    H = h * 0.80

    # ---- 黑色底块：头 + 肩 + 袍身（略带弧度的实心块）----
    p.append(f'<path d="M{cx-26} {base-H*0.86} '
             f'C{cx-30} {base-H*0.80} {cx-28} {base-H*0.76} {cx-24} {base-H*0.74} '
             f'L{cx-30} {base-H*0.70} '
             f'C{cx-52} {base-H*0.62} {cx-58} {base-H*0.30} {cx-60} {base} '
             f'L{cx+60} {base} '
             f'C{cx+58} {base-H*0.30} {cx+52} {base-H*0.62} {cx+30} {base-H*0.70} '
             f'L{cx+24} {base-H*0.74} '
             f'C{cx+28} {base-H*0.76} {cx+30} {base-H*0.80} {cx+26} {base-H*0.86} Z" '
             f'fill="{ink}"/>')
    # 头部（黑）
    p.append(f'<ellipse cx="{cx}" cy="{base-H*0.895}" rx="{H*0.062:.1f}" '
             f'ry="{H*0.075:.1f}" fill="{ink}"/>')
    # 长发（黑，向下垂）
    p.append(f'<path d="M{cx-20} {base-H*0.94} '
             f'C{cx-30} {base-H*0.86} {cx-28} {base-H*0.74} {cx-24} {base-H*0.70} '
             f'L{cx-10} {base-H*0.72} '
             f'C{cx-14} {base-H*0.80} {cx-14} {base-H*0.88} {cx-8} {base-H*0.93} Z" '
             f'fill="{ink}"/>')

    # ---- 米白排线：衣袍褶皱，被垂直位移扭曲 ----
    robe = hatch_displaced(cx - 56, base - H * 0.70, cx + 56, base,
                           angle=math.pi / 2, gap=2.6, width=0.5,
                           color=color, opacity=0.55, seed=3, amp=11.0, freq=0.052)
    # 用袍形路径裁剪
    robe_d = (f'M{cx-52} {base-H*0.66} '
              f'C{cx-58} {base-H*0.34} {cx-60} {base-H*0.10} {cx-58} {base} '
              f'L{cx+58} {base} '
              f'C{cx+60} {base-H*0.10} {cx+58} {base-H*0.34} {cx+52} {base-H*0.66} Z')
    p.append(f'<defs><clipPath id="figrobe"><path d="{robe_d}"/></clipPath></defs>'
             f'<g clip-path="url(#figrobe)">{robe}</g>')

    # ---- 面部：米白排线（也带位移）----
    face = hatch_displaced(cx - 14, base - H * 0.96, cx + 14, base - H * 0.82,
                           angle=math.pi / 2, gap=2.0, width=0.45,
                           color=color, opacity=0.75, seed=9, amp=4.0, freq=0.09)
    p.append(f'<defs><clipPath id="figface">'
             f'<ellipse cx="{cx}" cy="{base-H*0.895}" rx="{H*0.055:.1f}" ry="{H*0.066:.1f}"/>'
             f'</clipPath></defs><g clip-path="url(#figface)">{face}</g>')

    # ---- 举起的手臂：米白排线 ----
    arm = hatch_displaced(cx + 34, base - H * 0.74, cx + 96, base - H * 0.44,
                          angle=math.pi / 2, gap=2.4, width=0.5,
                          color=color, opacity=0.6, seed=5, amp=8.0, freq=0.07)
    p.append(f'<defs><clipPath id="figarm">'
             f'<path d="M{cx+30} {base-H*0.70} '
             f'C{cx+56} {base-H*0.68} {cx+78} {base-H*0.58} {cx+92} {base-H*0.46} '
             f'L{cx+84} {base-H*0.42} '
             f'C{cx+70} {base-H*0.54} {cx+50} {base-H*0.62} {cx+30} {base-H*0.64} Z"/>'
             f'</clipPath></defs><g clip-path="url(#figarm)">{arm}</g>')

    return "".join(p)

if __name__ == "__main__":
    out = {}
    out["scene-stage.svg"]   = save("scene-stage.svg",   gen_stage_scene(), 900, 620)
    out["scene-pour.svg"]    = save("scene-pour.svg",    gen_pour_scene(), 760, 560)
    out["scene-spectrum.svg"] = save("scene-spectrum.svg", gen_spectrum_scene(), 900, 520)
    out["scene-curtain.svg"] = save("scene-curtain.svg", gen_curtain_scene(), 900, 560)
    out["scene-toast.svg"]   = save("scene-toast.svg",   gen_toast_scene(), 760, 560)
    out["ui-logo.svg"]       = save("ui-logo.svg",       gen_logo(), 200, 70)
    out["scene-figure.svg"]  = save("scene-figure.svg",  gen_figure(), 420, 420)
    out["ui-tagbar.svg"]     = save("ui-tagbar.svg",     gen_tagbar(), 340, 40)
    out["ui-hold.svg"]       = save("ui-hold.svg",       gen_hold_button(), 96, 96)
    for k in ["harp", "rings", "wave", "spot"]:
        out[f"emblem-{k}-ink.svg"]   = save(f"emblem-{k}-ink.svg",   gen_emblem(k, color=INK),   180, 180)
        out[f"emblem-{k}-paper.svg"] = save(f"emblem-{k}-paper.svg", gen_emblem(k, color=PAPER), 180, 180)
    for k, v in out.items():
        print(f"{k:26s} {v:7d} bytes")
