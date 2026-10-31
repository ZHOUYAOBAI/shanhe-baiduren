#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《山河摆渡人》· 站点数据生成 · 映射层 + 加密层
================================================================
把 script_struct.json（解析层产物）映射成站点 data.js：

  window.SCRIPT        公开层：剧目概况、曲目目录、人物、伏笔、时间线
  window.SCRIPT_SECRET 受限层：AES-256-GCM 密文（幕正文 + 全部歌词）

密码来自环境变量 READ_PASS，不写死在仓库里：
  READ_PASS='你的密码' python3 gen_site_data.py script_struct.json ../assets/js/data.js

用法：
  python3 gen_site_data.py <script_struct.json> <data.js>
"""
import base64
import hashlib
import json
import os
import pathlib
import re
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ── 加密参数（与 assets/js/crypto.js 严格一致，不得随意改动）──
SALT_B64 = 'c2hhbmhlLWJhaWR1cmVuLzIwMjYtcmVhZA=='   # b"shanhe-baiduren/2026-read"
ITERATIONS = 150000
KEY_LEN = 32
IV_LEN = 12

# ── 幕次地点：定稿未逐幕标注地点时，用这里的舞台定位兜底 ──
ACT_PLACE_FALLBACK = {
    0: '滇北金沙江畔・彝寨火塘边',
    1: '云南扎西・红军宿营地篝火旁',
    2: '滇中战地・昆明城外的山巅与指挥部',
    3: '金沙江畔彝寨・寨门与木屋',
    4: '皎平渡・渡口棚屋与江滩',
}

# ── 时间线（历史主线）──
TIMELINE = [
    {'act': 0, 'date': '1932 · 冬', 'label': '彝寨火塘・少年立誓'},
    {'act': 1, 'date': '1935 · 1月下旬', 'label': '扎西誓师・回师黔北之策'},
    {'act': 2, 'date': '1935 · 4月', 'label': '佯攻昆明・缴获渡图'},
    {'act': 3, 'date': '1935 · 4月底', 'label': '彝寨危局・彝汉同心传信'},
    {'act': 4, 'date': '1935 · 5月3—9日', 'label': '巧渡金沙江・七天七夜'},
    {'act': 5, 'date': '多年后 · 秋', 'label': '火塘不熄・山河归光'},
]

# ── 伏笔结构（沿用原站人工梳理，配合 main.js 的 name/color/plant/pay/note 字段）──
THREADS = [
    # 每条伏笔都能在定稿里逐句对上：骨哨、银镯是旧稿道具，新稿已删；
    # 木船数按新稿「六只」订正（尾幕字幕与第四幕舞台提示均为六只）。
    {'name': '阿爹的彝刀', 'color': '#c8323f',
     'plant': '序幕，阿爹倒在血泊里，把腰间的彝刀交到他手边；刀锋在火光下泛着寒光。',
     'pay': '第三幕，他把磨了三年的彝刀塞进阿果手里——你替我拿着，就像我在你身边。',
     'note': '一把刀，串起父子与山河两重情感。'},
    {'name': '日月纹帕子', 'color': '#c8323f',
     'plant': '第三幕，阿果把母亲留下的日月纹绣帕撕成两半，一半塞给阿木：见帕如见人。',
     'pay': '染血成证，经王团长与李老爹之手辗转；尾幕两半合成一整条带血手帕。',
     'note': '两半帕子，是恋人之间最重的托付。'},
    {'name': '真假油布包', 'color': '#b98b3a',
     'plant': '第三幕月下，阿木掏出两个一模一样的油布包，一真一假分给两人。',
     'pay': '情报分毫不差，四幕渡口接应成功。',
     'note': '一真一假两份图，是第三幕的机与情。'},
    {'name': '刘矬子的鞭子', 'color': '#6b6f76',
     'plant': '杀父之仇，三年执念。',
     'pay': '崖上对峙，被击毙沉江。',
     'note': '从序幕的火塘一直牵到第四幕的江边。'},
    {'name': '夜不渡皎平', 'color': '#6b6f76',
     'plant': '祖辈旧俗，三十七位船工无人敢开夜船。',
     'pay': '李老爹押上身家带头破俗，六只木船昼夜轮转。',
     'note': '一条旧规矩，被人心生生改写。'},
    {'name': '三十七位船工的名字', 'color': '#589C95',
     'plant': '第四幕，三十七位各族船工上了船，在江面上一轮接一轮地划。',
     'pay': '护送三万红军闯过天险；尾幕石碑上刻下他们的名字。',
     'note': '有人有大名，有人只有俗名和绰号，都是山河不破的底气。'},
]


ACT_LABELS = ['序幕', '第一幕', '第二幕', '第三幕', '第四幕', '尾幕']

COVER_NOTE = ('（阿木、阿果为艺术虚构人物，原型是千千万万无名彝、汉、傣各族群众；'
              '文中真实地名、渡口、里程、船工姓名均依史实。）')


def split_performer(raw):
    """曲段标记里的「演唱者（体裁）」→ 演唱者 / 体裁"""
    raw = raw.strip()
    m = re.match(r'^(?P<who>.+?)（(?P<kind>[^（）]*)）$', raw)
    if m:
        return m.group('who').strip(), m.group('kind').strip()
    return raw, ''


def song_table_map(table):
    """曲目表 → {序号: (类型, 演唱)}"""
    out = {}
    if not table:
        return out
    for row in table[1:]:
        if len(row) >= 5:
            try:
                no = int(row[1])
            except ValueError:
                continue
            out[no] = (row[3].strip(), row[4].strip())
    return out


def build_cover(meta):
    mainline = meta.get('核心历史主线', '')
    mainline = [x.strip() for x in mainline.split('→') if x.strip()]
    return {
        'title': '云南本土原创红色歌剧《山河摆渡人》',
        'name': '山河摆渡人',
        'author': meta.get('编剧', ''),
        'music': meta.get('音乐', ''),
        'theme': meta.get('核心主题', ''),
        'span': meta.get('时间跨度', ''),
        'mainline': mainline,
        'note': COVER_NOTE,
    }


def build(struct):
    cover = build_cover(struct['meta'])
    # 定稿抬头第一行即剧名，其余为《体例说明》各条
    style_notes = [n for n in struct['style_notes'] if n.strip() != cover['title']]
    tbl = song_table_map(struct['song_table'])

    acts_pub = []
    acts_sec = []
    songs_pub = []
    songs_sec = []

    for act in struct['acts']:
        idx = act['index']
        meta = dict(act['meta'])
        if not meta.get('place'):
            meta['place'] = ACT_PLACE_FALLBACK.get(idx, '')
        meta.setdefault('mood', [])
        meta.setdefault('places', [])
        meta.setdefault('moods', [])

        # 幕正文里的曲段块要补齐 performer/label
        sec_blocks = []
        for b in act['blocks']:
            b = dict(b)
            if b['k'] == 'song':
                v = dict(b['v'])
                no = v['no']
                kind, singers = tbl.get(no, ('', ''))
                who, k2 = split_performer(v.get('performer_raw', ''))
                perf = singers or who
                if kind and perf and kind not in perf:
                    perf = '%s %s' % (perf, kind)
                elif kind and not perf:
                    perf = kind
                v['performer'] = perf
                v['label'] = '【曲目%02d 《%s》（%s）】' % (no, v['name'], perf)
                b['v'] = v
            sec_blocks.append(b)

        # 公开层只保留曲段卡与场次标题（正文歌词在密文里）
        pub_blocks = []
        for b in sec_blocks:
            if b['k'] == 'scene':
                pub_blocks.append({'k': 'scene', 'v': b['v']})
            elif b['k'] == 'song':
                pub_blocks.append({'k': 'song', 'v': b['v']})
        acts_pub.append({
            'title': act['title'],
            'meta': meta,
            'blocks': pub_blocks,
        })
        if idx == 0:
            # 《体例说明》：定稿的前言，放在序幕正文最前面
            head = [{'k': 'note', 'v': '【体例说明】'}]
            for n in style_notes:
                head.append({'k': 'note', 'v': n})
            sec_blocks = head + sec_blocks
        acts_sec.append({'act': idx, 'blocks': sec_blocks})

    for song in struct['songs']:
        no = song['no']
        kind, singers = tbl.get(no, ('', ''))
        who, k2 = split_performer(song.get('performer_raw', ''))
        perf = singers or who
        if kind and perf and kind not in perf:
            perf = '%s %s' % (perf, kind)
        elif kind and not perf:
            perf = kind
        songs_pub.append({
            'no': no,
            'name': song['name'],
            'performer': perf,
            'label': '【曲目%02d 《%s》（%s）】' % (no, song['name'], perf),
            'act': song['act'],
            'actTitle': song['actTitle'],
        })
        items = song['items']
        lyrics = []
        for it in items:
            if it['k'] == 'ly':
                lyrics.append(it.get('text', ''))
            elif it['k'] == 'sec':
                lyrics.append(it.get('v', ''))
            elif it['k'] == 'cue':
                lyrics.append('（%s）' % it.get('v', ''))
        songs_sec.append({
            'no': no,
            'lyrics': '\n'.join(lyrics),
            'items': items,
        })

    data = {
        'cover': cover,
        'acts': acts_pub,
        'songs': songs_pub,
        'songTable': struct['song_table'],
        'charTable': struct['char_table'],
        'threads': THREADS,
        'timeline': TIMELINE,
        'actLabels': ACT_LABELS,
    }
    secret = {'acts': acts_sec, 'songs': songs_sec}
    return data, secret


def encrypt(secret, password):
    salt = base64.b64decode(SALT_B64)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt,
                              ITERATIONS, dklen=KEY_LEN)
    iv = os.urandom(IV_LEN)
    ct = AESGCM(key).encrypt(iv, json.dumps(secret, ensure_ascii=False).encode('utf-8'), None)
    return {
        'salt': SALT_B64,
        'iterations': ITERATIONS,
        'iv': base64.b64encode(iv).decode('ascii'),
        'cipher': base64.b64encode(ct).decode('ascii'),
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        print('用法: gen_site_data.py <script_struct.json> <data.js>')
        print('密码来自环境变量 READ_PASS，例如：')
        print("  READ_PASS='你的密码' python3 gen_site_data.py script_struct.json ../assets/js/data.js")
        sys.exit(1)
    password = os.environ.get('READ_PASS')
    if not password:
        print('缺少环境变量 READ_PASS（阅读密码不写死在仓库里）')
        sys.exit(2)

    struct = json.loads(pathlib.Path(args[0]).read_text(encoding='utf-8'))
    data, secret = build(struct)
    enc = encrypt(secret, password)

    js = ('window.SCRIPT = ' + json.dumps(data, ensure_ascii=False, indent=1) + ';\n'
          'window.SCRIPT_SECRET = ' + json.dumps(enc, ensure_ascii=False) + ';\n')
    out = pathlib.Path(args[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(js, encoding='utf-8')
    print('data.js 写入 %s（%d 字节）｜幕 %d｜曲目 %d｜密文 %d 字节' % (
        out, len(js), len(data['acts']), len(data['songs']),
        len(enc['cipher'])))


if __name__ == '__main__':
    main()
