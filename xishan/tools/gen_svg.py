#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《西山不是山》· 铜版画线稿资产生成器
================================================================
沿用 NOCTURNE 的排线引擎（手绘钢笔质感），但画的是这部剧的东西。

六件信物 = 六条伏笔的实体：
  册（旧册）· 灯（煤油灯）· 凿（旧凿子）
  机（摄影机）· 杯（豆浆杯）· 门（龙门）

另有一枚徽记（山形卧人）与页眉标记。
"""
import math
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "svg"
OUT.mkdir(parents=True, exist_ok=True)

INK    = "#0E1015"   # 墨
PAPER  = "#F2EEE6"   # 宣纸
RED    = "#C2372F"   # 朱砂
GOLD   = "#C9A24B"   # 灯焰金


def save(name, body, w, h):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
           f'viewBox="0 0 {w} {h}" fill="none">{body}</svg>')
    (OUT / name).write_text(svg, encoding="utf-8")
    return len(svg)


# ============================================================
# 排线引擎（与 NOCTURNE 同源：确定性正弦起伏，非随机聚簇）
# ============================================================
def hatch(x0, y0, x1, y1, angle=math.pi / 2, gap=3.0, width=0.6,
          color=INK, opacity=0.5, jitter=0.0, seed=0, wave=0.0):
    p = []
    diag = math.hypot(x1 - x0, y1 - y0)
    s, c = math.sin(angle), math.cos(angle)
    nx, ny = -s, c
    n = int(diag / gap) + 2
    for i in range(-n, n):
        d = i * gap
        phase = i * 0.55 + seed
        d += jitter * math.sin(phase)
        px = x0 + (x1 - x0) / 2 + nx * d
        py = y0 + (y1 - y0) / 2 + ny * d
        op = opacity * (0.80 + 0.20 * (0.5 + 0.5 * math.sin(phase * 0.9)))
        dx, dy = c * diag, s * diag
        if wave:
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


def hatch_shape(path_d, angle, gap, width, color, opacity, seed=0, bbox=None):
    x0, y0, x1, y1 = bbox
    lines = hatch(x0, y0, x1, y1, angle, gap, width, color, opacity,
                  jitter=gap * 0.18, seed=seed)
    cid = f"hc{seed}"
    return (f'<defs><clipPath id="{cid}"><path d="{path_d}"/></clipPath></defs>'
            f'<g clip-path="url(#{cid})">{lines}</g>')


def hatch_horizontal(x0, y0, x1, y1, gap=2.1, width=0.42, color=INK,
                     opacity=0.20, seed=0, curve=0.0):
    p = []
    n = int((y1 - y0) / gap)
    for i in range(n + 1):
        y = y0 + i * gap
        op = opacity * (0.82 + 0.18 * (0.5 + 0.5 * math.sin(i * 0.55 + seed)))
        mid = (x0 + x1) / 2
        if curve:
            half = (x1 - x0) / 2
            d = (f'M{x0:.1f} {y:.1f} '
                 f'Q{mid:.1f} {y + curve * (1 - ((mid-x0)/half)**2):.1f} {x1:.1f} {y:.1f}')
        else:
            d = f'M{x0:.1f} {y:.1f}H{x1:.1f}'
        p.append(f'<path d="{d}" stroke="{color}" stroke-width="{width}" opacity="{op:.3f}"/>')
    return "".join(p)


# ============================================================
# 一 · 旧册 —— 四代人擦过的线装册子
# ============================================================
def gen_book(w=420, h=300):
    b = []
    # 册页侧视：略张开的书，页口有层次
    cover = "M52 66 L186 40 L368 62 L236 92 Z"
    pages = "M52 66 L236 92 L236 244 L52 214 Z"
    spine = "M236 92 L368 62 L368 214 L236 244 Z"

    b.append(hatch_shape(cover, 0.42, 2.4, 0.5, INK, 0.30, seed=3, bbox=(40, 30, 380, 100)))
    b.append(hatch_shape(pages, 1.5708, 2.2, 0.44, INK, 0.17, seed=7, bbox=(40, 80, 250, 250)))
    b.append(hatch_shape(spine, 0.06, 1.9, 0.46, INK, 0.36, seed=11, bbox=(225, 55, 380, 250)))

    # 描边
    for d in (cover, pages, spine):
        b.append(f'<path d="{d}" stroke="{INK}" stroke-width="1.4"/>')

    # 页口细线（三层）
    for i in range(3):
        o = 6 + i * 5
        b.append(f'<path d="M{52+o} {66+o*0.55} L{236-o*0.2} {92+o*0.55}" '
                 f'stroke="{INK}" stroke-width="0.5" opacity="0.5"/>')

    # 册面：反复写的三个字（用横线抽象表示字迹）
    b.append('<g stroke="%s" stroke-width="1.1" opacity="0.62">' % INK)
    for row in range(4):
        for col in range(3):
            cx = 96 + col * 46
            cy = 128 + row * 22
            b.append(f'<path d="M{cx} {cy} h16 M{cx+3} {cy+4} h10 M{cx+2} {cy+8} h13"/>')
    b.append('</g>')

    # 煤油灯光晕
    b.append(f'<circle cx="300" cy="52" r="58" fill="{GOLD}" opacity="0.05"/>')
    b.append(f'<circle cx="300" cy="52" r="30" fill="{GOLD}" opacity="0.07"/>')

    # 题名印章
    b.append(f'<rect x="330" y="238" width="46" height="46" fill="none" '
             f'stroke="{RED}" stroke-width="1.6"/>')
    b.append(f'<path d="M342 252 h22 M342 260 h16 M342 268 h20" stroke="{RED}" '
             f'stroke-width="1.8" opacity="0.85"/>')
    return "".join(b)


# ============================================================
# 二 · 煤油灯 —— 全剧唯一暖光源
# ============================================================
def gen_lamp(w=360, h=420):
    b = []
    glass = ("M132 96 L228 96 L214 210 L146 210 Z")
    base = ("M120 210 L240 210 L256 286 L104 286 Z")
    stem = "M172 286 L188 286 L182 340 L178 340 Z"
    foot = "M158 340 L202 340 L212 372 L148 372 Z"

    b.append(hatch_shape(glass, 1.5708, 2.4, 0.44, INK, 0.12, seed=5, bbox=(120, 90, 240, 215)))
    b.append(hatch_shape(base, 0.30, 2.0, 0.48, INK, 0.34, seed=9, bbox=(100, 205, 260, 290)))
    b.append(hatch_shape(foot, 0.06, 2.2, 0.46, INK, 0.30, seed=13, bbox=(145, 335, 215, 375)))

    for d in (glass, base, stem, foot):
        b.append(f'<path d="{d}" stroke="{INK}" stroke-width="1.4"/>')

    # 灯罩顶
    b.append(f'<path d="M120 96 L180 58 L240 96" stroke="{INK}" stroke-width="1.4"/>')
    b.append(f'<path d="M164 58 h32" stroke="{INK}" stroke-width="1.2"/>')

    # 焰 —— 全剧唯一的暖色
    b.append(f'<path d="M180 186 C166 172 168 152 180 138 C192 152 194 172 180 186 Z" '
             f'fill="{GOLD}" opacity="0.9"/>')
    b.append(f'<path d="M180 182 C174 172 175 160 180 152 C185 160 186 172 180 182 Z" '
             f'fill="{PAPER}" opacity="0.75"/>')

    # 光晕（多层同心）
    for r, o in ((150, 0.030), (96, 0.045), (52, 0.07), (26, 0.10)):
        b.append(f'<circle cx="180" cy="164" r="{r}" fill="{GOLD}" opacity="{o}"/>')

    # 光线
    for i, ang in enumerate((-1.30, -1.05, -0.78, 0.78, 1.05, 1.30)):
        x2 = 180 + math.cos(ang) * 168
        y2 = 164 + math.sin(ang) * 168
        b.append(f'<path d="M180 164 L{x2:.1f} {y2:.1f}" stroke="{GOLD}" '
                 f'stroke-width="0.8" opacity="0.14"/>')
    return "".join(b)


# ============================================================
# 三 · 旧凿子 —— 挂在墙上不说话
# ============================================================
def gen_chisel(w=340, h=340):
    b = []
    shaft = "M158 46 L182 46 L176 214 L164 214 Z"
    tip = "M164 214 L176 214 L170 288 L158 288 Z"
    handle = "M150 40 L190 40 L186 62 L154 62 Z"

    b.append(hatch_shape(shaft, 1.5708, 2.1, 0.46, INK, 0.26, seed=17, bbox=(150, 40, 190, 220)))
    b.append(hatch_shape(tip, 0.5, 1.6, 0.44, INK, 0.52, seed=19, bbox=(152, 210, 180, 292)))
    b.append(hatch_shape(handle, 0.2, 1.9, 0.5, INK, 0.38, seed=23, bbox=(145, 35, 195, 65)))

    for d in (shaft, tip, handle):
        b.append(f'<path d="{d}" stroke="{INK}" stroke-width="1.5"/>')

    # 断口 —— 笔尖断在这里
    b.append(f'<path d="M158 288 L152 302 L168 306 L170 288" stroke="{RED}" stroke-width="2"/>')
    b.append(f'<path d="M154 294 L166 298 M160 288 L166 300" stroke="{RED}" '
             f'stroke-width="1" opacity="0.75"/>')

    # 锈：斑驳短线
    b.append(f'<g stroke="{INK}" stroke-width="0.8" opacity="0.4">')
    for i in range(26):
        x = 156 + (i * 37) % 24
        y = 52 + (i * 53) % 210
        b.append(f'<path d="M{x} {y} h6 M{x+1} {y+3} h4"/>')
    b.append('</g>')
    return "".join(b)


# ============================================================
# 四 · 摄影机 —— 她一直开着在录
# ============================================================
def gen_camera(w=420, h=300):
    b = []
    body_d = "M96 108 L288 108 L300 190 L84 190 Z"
    lens = "M300 132 L372 122 L372 176 L300 166 Z"
    reel = "M124 72 a30 30 0 1 0 0.1 0 M196 72 a30 30 0 1 0 0.1 0"

    b.append(hatch_shape(body_d, 0.36, 2.2, 0.48, INK, 0.30, seed=29, bbox=(80, 100, 305, 195)))
    b.append(hatch_shape("M300 132 L372 122 L372 176 L300 166 Z", 1.5708, 1.8, 0.44, INK, 0.44,
                         seed=31, bbox=(295, 118, 376, 180)))

    b.append(f'<path d="{body_d}" stroke="{INK}" stroke-width="1.5"/>')
    b.append(f'<path d="M300 132 L372 122 L372 176 L300 166 Z" stroke="{INK}" stroke-width="1.4"/>')
    b.append(f'<circle cx="124" cy="72" r="30" stroke="{INK}" stroke-width="1.4"/>')
    b.append(f'<circle cx="124" cy="72" r="13" stroke="{INK}" stroke-width="0.9" opacity="0.7"/>')
    b.append(f'<circle cx="196" cy="72" r="30" stroke="{INK}" stroke-width="1.4"/>')
    b.append(f'<circle cx="196" cy="72" r="13" stroke="{INK}" stroke-width="0.9" opacity="0.7"/>')

    # 红色录制指示灯 —— 她自己不知道它在录
    b.append(f'<circle cx="96" cy="124" r="7" fill="{RED}" opacity="0.92"/>')
    b.append(f'<circle cx="96" cy="124" r="14" fill="{RED}" opacity="0.16"/>')

    # 取景框
    b.append(f'<path d="M84 208 L216 208 L216 244 L84 244 Z" stroke="{INK}" '
             f'stroke-width="1.2" opacity="0.55"/>')
    b.append(f'<path d="M96 220 h108 M96 230 h84" stroke="{INK}" stroke-width="0.7" opacity="0.4"/>')
    return "".join(b)


# ============================================================
# 五 · 豆浆杯 —— 走的时候是空的
# ============================================================
def gen_cup(w=280, h=300):
    b = []
    cup = "M88 76 L192 76 L180 236 L100 236 Z"
    b.append(hatch_shape(cup, 1.5708, 2.3, 0.46, INK, 0.24, seed=37, bbox=(85, 70, 195, 240)))
    b.append(f'<path d="{cup}" stroke="{INK}" stroke-width="1.5"/>')
    b.append(f'<path d="M84 76 L196 76" stroke="{INK}" stroke-width="1.6"/>')
    b.append(f'<path d="M96 100 L184 100" stroke="{INK}" stroke-width="0.8" opacity="0.45"/>')

    # 吸管
    b.append(f'<path d="M138 76 L158 22" stroke="{INK}" stroke-width="3"/>')

    # 杯身标签（一条空线 = 空杯）
    b.append(f'<path d="M104 150 L176 150" stroke="{RED}" stroke-width="1.2" opacity="0.6"/>')
    b.append(f'<path d="M104 162 L160 162" stroke="{RED}" stroke-width="1.2" opacity="0.45"/>')
    return "".join(b)


# ============================================================
# 六 · 门 —— 一千年凿不开的门
# ============================================================
def gen_door(w=420, h=520):
    b = []
    frame = ("M62 60 L358 60 L358 468 L62 468 Z")
    inner = ("M104 104 L316 104 L316 428 L104 428 Z")
    lintel = "M62 60 L358 60 L316 104 L104 104 Z"

    b.append(hatch_shape(frame, 0.42, 2.6, 0.5, INK, 0.34, seed=41, bbox=(55, 55, 365, 475)))
    b.append(hatch_shape(lintel, 0.06, 2.0, 0.46, INK, 0.42, seed=43, bbox=(60, 55, 360, 110)))
    b.append(hatch_shape(inner, 1.5708, 2.4, 0.44, INK, 0.11, seed=47, bbox=(100, 100, 320, 432)))

    for d in (frame, inner, lintel):
        b.append(f'<path d="{d}" stroke="{INK}" stroke-width="1.6"/>')

    # 门缝里的一线光
    b.append(f'<path d="M206 104 L214 104 L214 428 L206 428 Z" fill="{GOLD}" opacity="0.30"/>')
    b.append(f'<path d="M210 104 L210 428" stroke="{GOLD}" stroke-width="1.2" opacity="0.5"/>')

    # 凿痕 —— 一千年的錾子印
    b.append(f'<g stroke="{INK}" stroke-width="1.1" opacity="0.34">')
    for i in range(34):
        x = 72 + (i * 41) % 274
        y = 116 + (i * 67) % 300
        b.append(f'<path d="M{x} {y} l11 -5 M{x+3} {y+3} l9 -4"/>')
    b.append('</g>')

    # 门环
    b.append(f'<circle cx="286" cy="266" r="15" stroke="{INK}" stroke-width="1.4" fill="none"/>')
    b.append(f'<circle cx="286" cy="266" r="6" stroke="{INK}" stroke-width="0.9" opacity="0.7" fill="none"/>')
    return "".join(b)


# ============================================================
# 七 · 徽记：山形即卧人 —— 全剧的题眼
# ============================================================
def gen_emblem(w=460, h=300):
    b = []
    # 卧人轮廓（与 3D 场景同一套地貌分区）
    d = ("M18 176 C22 132 40 112 62 106 C88 99 108 100 132 103 "
         "C162 107 196 108 232 104 C268 100 300 96 330 104 "
         "C362 113 386 136 400 172 C410 198 424 220 438 246 "
         "L438 272 L18 272 Z")
    b.append(hatch_shape(d, 1.16, 2.5, 0.46, INK, 0.26, seed=53, bbox=(10, 95, 445, 280)))
    # 轮廓双描边：外墨线 + 内淡线，强化"山形即卧人"的辨识
    b.append(f'<path d="{d}" stroke="{INK}" stroke-width="2.4" opacity="0.92"/>')
    b.append(f'<path d="{d}" stroke="{INK}" stroke-width="1.0" opacity="0.45" '
             f'transform="translate(0,3)"/>')

    # 地平线与倒影（隔着水看）
    b.append(f'<path d="M6 272 L454 272" stroke="{INK}" stroke-width="1.4" opacity="0.8"/>')
    b.append(f'<g opacity="0.34">')
    b.append(hatch_horizontal(14, 278, 446, 322, gap=2.6, width=0.42, color=INK,
                              opacity=0.18, seed=57, curve=6.0))
    b.append('</g>')

    # 山上的门 —— 门开在她心口上
    b.append(f'<path d="M196 100 L232 100 L232 138 L196 138 Z" stroke="{RED}" '
             f'stroke-width="2" fill="none"/>')
    b.append(f'<path d="M196 100 L214 80 L232 100" stroke="{RED}" stroke-width="2" fill="none"/>')
    b.append(f'<path d="M214 80 L214 138" stroke="{RED}" stroke-width="1.2" opacity="0.7"/>')
    # 门缝的光
    b.append(f'<path d="M212 100 L216 100 L216 138 L212 138 Z" fill="{GOLD}" opacity="0.5"/>')

    # 印章
    b.append(f'<rect x="404" y="24" width="42" height="42" fill="none" stroke="{RED}" stroke-width="1.5"/>')
    b.append(f'<path d="M416 38 h18 M416 46 h13 M416 54 h16" stroke="{RED}" '
             f'stroke-width="1.7" opacity="0.85"/>')
    return "".join(b)


# ============================================================
# 八 · 页眉标记
# ============================================================
def gen_mark(w=260, h=60):
    b = []
    b.append(f'<path d="M8 30 h244" stroke="{INK}" stroke-width="1" opacity="0.55"/>')
    b.append(f'<circle cx="16" cy="30" r="4" fill="{RED}" opacity="0.9"/>')
    b.append(f'<path d="M40 22 h18 M40 30 h26 M40 38 h14" stroke="{INK}" '
             f'stroke-width="1.4" opacity="0.8"/>')
    b.append(f'<path d="M190 20 L212 30 L190 40 Z" stroke="{INK}" stroke-width="1.2" '
             f'fill="none" opacity="0.7"/>')
    return "".join(b)


if __name__ == "__main__":
    jobs = [
        ("emblem-mountain.svg", gen_emblem, 460, 300),
        ("object-book.svg",    gen_book,    420, 300),
        ("object-lamp.svg",    gen_lamp,    360, 420),
        ("object-chisel.svg",  gen_chisel,  340, 340),
        ("object-camera.svg",  gen_camera,  420, 300),
        ("object-cup.svg",     gen_cup,     280, 300),
        ("object-door.svg",    gen_door,    420, 520),
        ("ui-mark.svg",        gen_mark,    260, 60),
    ]
    for name, fn, w, h in jobs:
        n = save(name, fn(w, h), w, h)
        print("  %-24s %6d B" % (name, n))
    print("线稿资产生成完毕 →", OUT)
