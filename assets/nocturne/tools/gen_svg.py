#!/usr/bin/env python3
"""
NOCTURNE 铜版画线稿资产生成器
所有图形按"蚀刻"逻辑程序化生成：轮廓 + 排线阴影，线距/角度可控。
输出 assets/svg/*.svg，供 HTML 原型引用；Ardot 画布内联使用。
"""
import math, os, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "svg"
OUT.mkdir(parents=True, exist_ok=True)

CREAM = "#E0D9D6"
RED   = "#B00000"
INK   = "#08080A"


def save(name, body, w, h):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
           f'viewBox="0 0 {w} {h}" fill="none">{body}</svg>')
    (OUT / name).write_text(svg, encoding="utf-8")
    return len(svg)


# ---------------------------------------------------------------- 放射光束
def gen_burst(w=520, h=520, color=CREAM):
    """舞台聚光放射：同心环 + 放射刻线，构成经典戏单 sunburst 徽记"""
    cx, cy = w / 2, h / 2
    p = []
    # 外圈双环
    p.append(f'<circle cx="{cx}" cy="{cy}" r="{w/2-2}" stroke="{color}" stroke-width="1.1" opacity=".9"/>')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="{w/2-14}" stroke="{color}" stroke-width=".5" opacity=".45"/>')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="{w/2-24}" stroke="{color}" stroke-width="1.1" opacity=".8"/>')
    # 放射刻线：24 道，长度随角度微变模拟手工抖动
    for i in range(24):
        a = math.radians(i * 15 + 7.5)
        r0 = w / 2 - 34
        r1 = w / 2 - 24
        jitter = 3.5 * math.sin(i * 1.7)
        x0, y0 = cx + r0 * math.cos(a), cy + r0 * math.sin(a)
        x1, y1 = cx + (r1 + jitter) * math.cos(a), cy + (r1 + jitter) * math.sin(a)
        op = .30 + .38 * (0.5 + 0.5 * math.sin(i * 2.3))
        p.append(f'<path d="M{x0:.1f} {y0:.1f}L{x1:.1f} {y1:.1f}" stroke="{color}" '
                 f'stroke-width=".7" opacity="{op:.2f}"/>')
    # 内部盘面排线（45°），越靠边越密
    for i in range(16):
        off = -w / 2 + 40 + i * 15
        p.append(f'<path d="M{cx+off:.1f} {cy-w/2+34:.1f}L{cx+off-w/2:.1f} {cy+w/2-34:.1f}" '
                 f'stroke="{color}" stroke-width=".5" opacity=".16"/>')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="34" fill="{color}" opacity=".95"/>')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="46" stroke="{color}" stroke-width=".7" opacity=".6"/>')
    return "".join(p)


# ---------------------------------------------------------------- 卷轴 3D
def gen_scroll(w=380, h=132, color=CREAM):
    """立式卷轴（剧本手稿）：圆柱体 + 椭圆端面 + 竖向排线做圆柱明暗"""
    p = []
    body_top, body_bot = 30, 102
    x0, x1 = 34, w - 34
    # 圆柱主体
    p.append(f'<rect x="{x0}" y="{body_top}" width="{x1-x0}" height="{body_bot-body_top}" '
             f'fill="{color}" opacity=".92"/>')
    # 圆柱明暗：竖线疏密由中间向两端递增
    n = 34
    for i in range(n):
        t = i / (n - 1)
        x = x0 + 3 + t * (x1 - x0 - 6)
        edge = abs(t - .5) * 2          # 0 中间 → 1 两端
        op = .04 + .62 * (edge ** 1.7)  # 越靠边越暗
        p.append(f'<path d="M{x:.1f} {body_top+2}L{x:.1f} {body_bot-2}" stroke="{RED}" '
                 f'stroke-width="1.1" opacity="{op:.2f}"/>')
    # 端面椭圆
    p.append(f'<ellipse cx="{x0}" cy="{(body_top+body_bot)/2}" rx="14" ry="36" '
             f'fill="{color}" opacity=".95"/>')
    p.append(f'<ellipse cx="{x0}" cy="{(body_top+body_bot)/2}" rx="9" ry="27" '
             f'stroke="{RED}" stroke-width=".7" opacity=".45"/>')
    p.append(f'<ellipse cx="{x1}" cy="{(body_top+body_bot)/2}" rx="14" ry="36" '
             f'fill="{color}" opacity=".88"/>')
    p.append(f'<ellipse cx="{x1}" cy="{(body_top+body_bot)/2}" rx="9" ry="27" '
             f'stroke="{RED}" stroke-width=".7" opacity=".38"/>')
    # 上下缘描边
    p.append(f'<path d="M{x0} {body_top}H{x1}" stroke="{RED}" stroke-width=".9" opacity=".5"/>')
    p.append(f'<path d="M{x0} {body_bot}H{x1}" stroke="{RED}" stroke-width=".9" opacity=".5"/>')
    # 丝带（剧本标记）
    p.append(f'<path d="M{w/2-13} {body_bot-2}c-5 16-9 24-16 30 8-6 15-9 22-9-4 4-8 10-13 18-6-9-16-14-24-16z" '
             f'fill="{color}" opacity=".95"/>')
    return "".join(p)


# ---------------------------------------------------------------- 卡片徽记
def gen_emblem(kind, w=180, h=180, color=CREAM):
    """作品卡片的蚀刻徽记，四种主题各有几何母题"""
    p = []
    c = w / 2
    if kind == "harp":                       # 弦：竖弦长度成弓形
        p.append(f'<path d="M{c-58} {h-34}q58-14 116 0" stroke="{color}" stroke-width="1.2" opacity=".85"/>')
        p.append(f'<path d="M{c-58} {h-34}v-96" stroke="{color}" stroke-width="1.2" opacity=".85"/>')
        p.append(f'<path d="M{c+58} {h-34}v-96" stroke="{color}" stroke-width="1.2" opacity=".85"/>')
        for i in range(11):
            t = i / 10
            x = c - 58 + t * 116
            top = 44 + 26 * math.sin(math.pi * t)
            p.append(f'<path d="M{x:.1f} {top:.1f}V{h-34}" stroke="{color}" '
                     f'stroke-width=".55" opacity="{.32+.38*t:.2f}"/>')
        p.append(f'<path d="M{c-58} {h-34}q58 10 116 0" stroke="{color}" stroke-width=".7" opacity=".5"/>')
    elif kind == "rings":                    # 环：歌剧院层叠看台
        for i, r in enumerate([64, 52, 40, 28]):
            op = .85 - i * .16
            p.append(f'<circle cx="{c}" cy="{c}" r="{r}" stroke="{color}" stroke-width="1.1" opacity="{op:.2f}"/>')
        p.append(f'<circle cx="{c}" cy="{c}" r="12" fill="{color}" opacity=".9"/>')
        for i in range(18):
            a = math.radians(i * 20)
            p.append(f'<path d="M{c+12*math.cos(a):.1f} {c+12*math.sin(a):.1f}'
                     f'L{c+64*math.cos(a):.1f} {c+64*math.sin(a):.1f}" '
                     f'stroke="{color}" stroke-width=".45" opacity=".28"/>')
    elif kind == "spot":                     # 弧：聚光锥
        p.append(f'<path d="M{c-16} 40L{c-72} {h-26}M{c-16} 40L{c+72} {h-26}" '
                 f'stroke="{color}" stroke-width="1.2" opacity=".85"/>')
        p.append(f'<path d="M{c-16} 40L{c-40} {h-26}M{c-16} 40L{c+40} {h-26}" '
                 f'stroke="{color}" stroke-width=".55" opacity=".45"/>')
        p.append(f'<ellipse cx="{c}" cy="{h-26}" rx="72" ry="9" stroke="{color}" stroke-width="1" opacity=".7"/>')
        for i in range(9):
            t = i / 8
            x = c - 72 + t * 144
            p.append(f'<path d="M{x:.1f} {h-30}L{x:.1f} {h-18}" stroke="{color}" stroke-width=".5" opacity=".3"/>')
        p.append(f'<circle cx="{c}" cy="40" r="13" fill="{color}" opacity=".92"/>')
    else:                                    # 波：声浪
        for i in range(7):
            y = 46 + i * 15
            amp = 7 + (i % 3) * 5
            d = f"M{c-64} {y}"
            for k in range(8):
                x = c - 64 + k * 16
                d += f" q8 {amp if k%2==0 else -amp} 16 0"
            p.append(f'<path d="{d}" stroke="{color}" stroke-width=".8" '
                     f'opacity="{.30+.09*i:.2f}"/>')
    return "".join(p)


# ---------------------------------------------------------------- 排线纹理块
def gen_hatch(w=400, h=300, color=CREAM, angle=45, gap=5, angle2=None, gap2=7):
    """纯排线纹理块：两组交叉刻线构成阴影面"""
    p = []
    def lines(step, ang, op):
        a = math.radians(ang)
        L = math.hypot(w, h)
        for i in range(-int(L / step), int(L / step)):
            x = c0 = i * step
            dx, dy = math.cos(a) * L, math.sin(a) * L
            ox, oy = -math.sin(a) * L, math.cos(a) * L
            p.append(f'<path d="M{x+ox:.1f} {oy:.1f}L{x+ox+dx:.1f} {oy+dy:.1f}" '
                     f'stroke="{color}" stroke-width=".55" opacity="{op:.2f}"/>')
    lines(gap, angle, .30)
    if angle2:
        lines(gap2, angle2, .20)
    return "".join(p)


# ---------------------------------------------------------------- 圆形画框人物
def _bez(p0, p1, p2, p3, t):
    u = 1 - t
    return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3


def gen_portrait(size=420, color=CREAM):
    """圆形画框内的指挥者背影：头/颈/肩/躯干连续剪影 + 抬起双臂 + 排线体积
    排线按剪影解析式贴合轮廓，不依赖 clipPath（保证各渲染器一致）"""
    c = size / 2
    p = []
    p.append(f'<circle cx="{c}" cy="{c}" r="{size/2-3}" stroke="{color}" stroke-width="1.4" opacity=".9"/>')
    p.append(f'<circle cx="{c}" cy="{c}" r="{size/2-16}" stroke="{color}" stroke-width=".5" opacity=".4"/>')

    hy = c - 92          # 头心
    neck_y = hy + 26     # 颈底
    sh_y = c + 12        # 肩线
    bot_y = size - 26    # 下摆
    # 躯干左缘的三次贝塞尔（x 随 y 变化）
    bx = (34, 58, 66, 70)      # 相对中心的半宽控制点
    by = (sh_y - 2, sh_y + 12, sh_y + 42, bot_y)

    body = (
        f'M{c-13} {neck_y}'
        f'C{c-16} {neck_y+16} {c-22} {sh_y-18} {c-32} {sh_y-4}'
        f'C{c-46} {sh_y+8} {c-60} {sh_y+30} {c-64} {sh_y+52}'
        f'C{c-67} {sh_y+72} {c-70} {sh_y+92} {c-70} {bot_y}'
        f'L{c+70} {bot_y}'
        f'C{c+70} {sh_y+92} {c+67} {sh_y+72} {c+64} {sh_y+52}'
        f'C{c+60} {sh_y+30} {c+46} {sh_y+8} {c+32} {sh_y-4}'
        f'C{c+22} {sh_y-18} {c+16} {neck_y+16} {c+13} {neck_y} Z'
    )
    p.append(f'<ellipse cx="{c}" cy="{hy}" rx="24" ry="27" fill="{color}" opacity=".95"/>')
    p.append(f'<path d="{body}" fill="{color}" opacity=".92"/>')

    # 采样躯干外缘，得到 (半宽, y) 对照表
    samples = []
    for i in range(1, 121):
        t = i / 120
        x = _bez(32, 46, 60, 70, t)
        y = _bez(sh_y - 4, sh_y + 8, sh_y + 52, bot_y, t)
        samples.append((x, y))

    def top_y_for(dx):
        """给定水平偏移 dx，返回剪影内该竖线的起始 y（肩线以下）"""
        for x, y in samples:
            if x >= dx:
                return y
        return bot_y

    # ---- 竖向排线：贴合轮廓，密度向两侧递增 ----
    n = 26
    for i in range(n):
        dx = 3 + (68 - 3) * i / (n - 1)
        edge = abs(dx - 35) / 35
        op = .05 + .38 * (edge ** 1.4)
        y0 = max(top_y_for(dx), neck_y + 16)
        x = c - dx
        p.append(f'<path d="M{x:.1f} {y0:.1f}L{x:.1f} {bot_y}" stroke="{RED}" '
                 f'stroke-width=".7" opacity="{op:.2f}"/>')
        x2 = c + dx
        p.append(f'<path d="M{x2:.1f} {y0:.1f}L{x2:.1f} {bot_y}" stroke="{RED}" '
                 f'stroke-width=".7" opacity="{op:.2f}"/>')

    # ---- 交叉排线：仅在背光侧（左侧），形成真正的阴影面 ----
    for i in range(9):
        off = -58 + i * 7
        y0 = max(top_y_for(abs(off)), neck_y + 20)
        p.append(f'<path d="M{c+off:.1f} {y0+16:.1f}L{c+off-13:.1f} {bot_y}" stroke="{RED}" '
                 f'stroke-width=".55" opacity="{.05+.035*i:.2f}"/>')

    # ---- 肩胛弧线 ----
    for k in range(3):
        y = sh_y + 24 + k * 28
        p.append(f'<path d="M{c-54+k*4:.1f} {y:.1f}C{c-26} {y-15} {c+26} {y-15} {c+54-k*4:.1f} {y:.1f}" '
                 f'stroke="{RED}" stroke-width=".6" opacity="{.26-k*.06:.2f}"/>')

    # ---- 抬起的手臂（肩 → 肘 → 手）+ 指挥棒 ----
    for sgn in (-1, 1):
        sx = c + sgn * 40
        ex = c + sgn * 92
        hx = c + sgn * 116
        p.append(f'<path d="M{sx:.1f} {sh_y+4:.1f}Q{ex:.1f} {sh_y-26:.1f} {hx:.1f} {hy+52:.1f}" '
                 f'stroke="{color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>')
        p.append(f'<circle cx="{hx:.1f}" cy="{hy+52:.1f}" r="8" fill="{color}" opacity=".95"/>')
        p.append(f'<path d="M{hx:.1f} {hy+46:.1f}L{hx+sgn*22:.1f} {hy-14:.1f}" stroke="{color}" '
                 f'stroke-width="2.4" stroke-linecap="round" opacity=".95"/>')
    return "".join(p)


# ---------------------------------------------------------------- 分隔花饰
def gen_fleuron(w=120, h=28, color=CREAM):
    """古典戏单花饰分隔线"""
    p = []
    c = w / 2
    p.append(f'<path d="M{c-52} {h/2}H{c-16}" stroke="{color}" stroke-width=".7" opacity=".55"/>')
    p.append(f'<path d="M{c+16} {h/2}H{c+52}" stroke="{color}" stroke-width=".7" opacity=".55"/>')
    p.append(f'<path d="M{c} {h/2-9}q9 9 0 9q-9 0 0-9z" fill="{color}" opacity=".85"/>')
    p.append(f'<path d="M{c-13} {h/2}q6-6 11 0q-5 6-11 0z" fill="{color}" opacity=".7"/>')
    p.append(f'<path d="M{c+13} {h/2}q-6-6-11 0q5 6 11 0z" fill="{color}" opacity=".7"/>')
    p.append(f'<circle cx="{c-16}" cy="{h/2}" r="1.6" fill="{color}" opacity=".8"/>')
    p.append(f'<circle cx="{c+16}" cy="{h/2}" r="1.6" fill="{color}" opacity=".8"/>')
    return "".join(p)


if __name__ == "__main__":
    out = {}
    out["burst.svg"]     = save("burst.svg", gen_burst(), 520, 520)
    out["scroll.svg"]    = save("scroll.svg", gen_scroll(), 380, 132)
    out["portrait.svg"]  = save("portrait.svg", gen_portrait(), 420, 420)
    out["fleuron.svg"]   = save("fleuron.svg", gen_fleuron(), 120, 28)
    out["hatch.svg"]     = save("hatch.svg", gen_hatch(), 400, 300)

    # 徽记需要两套：纸面用墨黑描边，红面用米白描边
    for kind, name in [("harp", "harp"), ("rings", "rings"), ("spot", "spot"), ("wave", "wave")]:
        out[f"emblem-{name}-ink.svg"] = save(f"emblem-{name}-ink.svg", gen_emblem(kind, color=INK), 180, 180)
        out[f"emblem-{name}-paper.svg"] = save(f"emblem-{name}-paper.svg", gen_emblem(kind, color=CREAM), 180, 180)

    for k, v in out.items():
        print(f"{k:26s} {v:6d} bytes")
