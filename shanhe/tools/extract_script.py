#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《山河摆渡人》· 站点数据生成 · 解析层
================================================================
把「定稿」docx 解析为结构化 JSON（script_struct.json）。

沿用本仓库《西山不是山》工具链的分层约定：
  解析层（本文件）→ 映射层（gen_site_data.py）→ 加密层（encrypt_spoiler.py）
本文件只做「文档 → 结构」；幕次资料卡、人物卡、伏笔等人工内容留给映射层。

文档层级（依据定稿《体例说明》第四条「【】标曲名、场次与分节」）：
  · 【《曲名》—— 演唱者（体裁）】 = 曲名 → 一个曲目块
  · 【前奏】【说白】【咏叹调・第N部分】… = 曲内分节 → 归入当前曲目
  · 其余【…】                       = 幕内场次 / 分节 → 幕正文里的场次标题
  · （……）                          = 舞台提示
  · 角色：／角色：（提示）            = 台词与演唱

用法：
  python3 extract_script.py <定稿.docx> <script_struct.json> [--audit]
"""
import json
import pathlib
import re
import sys

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

# ── 句式 ──────────────────────────────────────────────────
SONG_RE = re.compile(r'^【《(?P<name>.+?)》\s*——\s*(?P<perf>.+?)】$')
MARK_RE = re.compile(r'^【(?P<x>.+?)】$')
META_RE = re.compile(r'^【(?P<key>时间|地点|表演形式|出场人物|舞台氛围|剧情正文)】\s*(?P<val>.*)$')
SPK_RE = re.compile(r'^(?P<who>[^：（【\[\n，。！？；…\s]{1,12})[：:]\s*(?P<rest>.*)$')
PAREN_RE = re.compile(r'^（(?P<inner>.+)）$')
ACT_RE = re.compile(r'^(?P<title>(?:序|第[一二三四五六]|尾)幕[：:].+)$')

MARK_MAX_LEN = 28

# 曲内小节标签（归入当前曲目，不结束它）
SONG_SEC_EXACT = {
    '说白', '前奏', '间奏', '尾奏', '尾声',
    '主歌 A', '主歌 B', '副歌 A', '副歌 B', '桥段', '大合唱', '副歌 B・重复',
    '音乐骤停・死寂', '音乐骤停・全剧终・念白',
}
SONG_SEC_KEYS = (
    '咏叹', '宣叙', '唱词', '最后的冲刺', '反击・唱段转折', '插话・',
    '绝唱・', '登场', '念白介入', '微弱念白', '动作・', '幕后音・',
)

# 说话人白名单（逐段核对定稿得出；不在表内的「甲：乙」一律按叙述处理，
# 以免把「舞台呈立体结构：……」这类旁白误判成台词）
SPEAKERS = {
    '阿木', '阿果', '阿细姐', '燕南云', '王团长', '红军王团长', '小马哥',
    '李老爹', '船工李老爹', '刘矬子', '苟二', '黄副官', '阿铁叔', '猎人',
    '彝寨老人', '红军战士', '红军侦察兵', '红军合唱', '众人合', '合',
    '众红军', '众船工、红军', '全员', '画外音',
}


def is_song_section(x):
    """是否曲内小节标题。"""
    if x in SONG_SEC_EXACT:
        return True
    return any(k in x for k in SONG_SEC_KEYS)


def is_structural_mark(x):
    """短、且不以句末标点结尾 → 结构性标记；长方括号段落按舞台提示处理。"""
    if len(x) > MARK_MAX_LEN:
        return False
    if x and x[-1] in '。！？；…':
        return False
    return True


def split_speaker(rest):
    """「（提示）文本」→ (cue, text)"""
    m = re.match(r'^（(?P<cue>[^（）]*)）\s*(?P<text>.*)$', rest)
    if m:
        return m.group('cue').strip(), m.group('text').strip()
    return '', rest.strip()


def read_body(path):
    doc = Document(str(path))
    out = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.split('}')[-1]
        if tag == 'p':
            par = Paragraph(child, doc)
            out.append(('p', par.style.name if par.style else '', par.text))
        elif tag == 'tbl':
            tbl = Table(child, doc)
            out.append(('t', [[c.text.strip() for c in r.cells] for r in tbl.rows]))
    return out


class Parser:
    def __init__(self):
        self.acts = []
        self.songs = {}
        self.song_table = []
        self.char_table = []
        self.style_notes = []
        self.meta = {}
        self.log = []
        self.act = None
        self.song = None
        self.speaker = None      # (who, cue) —— 普通段落归属
        self.pending_spk = None  # 角色独占行（尚未配上台词）
        self.header = True       # 幕首资料区
        self.mood = False        # 正在收舞台氛围

    def new_act(self, title):
        self.act = {'index': len(self.acts), 'title': title,
                    'meta': {'time': '', 'place': '', 'cast': '', 'mood': []},
                    'blocks': [], 'public_blocks': []}
        self.acts.append(self.act)
        self.song = None
        self.speaker = None
        self.pending_spk = None
        self.header = True
        self.mood = False

    def blk(self, kind, v, extra=None):
        b = {'k': kind, 'v': v}
        if extra:
            b.update(extra)
        self.act['blocks'].append(b)

    def flush_spk(self):
        """角色独占行若没等到台词，单独成块（名字不该丢）。"""
        if self.pending_spk:
            who, cue = self.pending_spk
            self.blk('spk', who, {'cue': cue} if cue else None)
            self.pending_spk = None

    def add_dlg(self, who, cue, text):
        """台词：同一角色连续段落并成一条。"""
        blocks = self.act['blocks']
        if blocks and blocks[-1]['k'] == 'dlg' and blocks[-1].get('who') == who:
            blocks[-1]['v'] = blocks[-1]['v'] + ' ' + text
            return
        extra = {'who': who}
        if cue:
            extra['cue'] = cue
        self.blk('dlg', text, extra)

    def end_song(self):
        self.song = None
        self.speaker = None
        self.pending_spk = None

    # ── 主循环 ──
    def parse(self, path):
        pidx = -1
        paras = []          # (pidx, text) —— 非空段落，供前瞻
        for item in read_body(path):
            if item[0] == 't':
                rows = item[1]
                head = rows[0] if rows else []
                if head and head[0] == '幕次':
                    self.song_table = rows
                elif head and head[0] == '人物':
                    self.char_table = rows
                continue
            pidx += 1
            text = item[2].strip()
            if text:
                paras.append((pidx, text))

        n = len(paras)
        for i, (pidx, text) in enumerate(paras):
            # 前瞻：接下来 3 段里有没有【地点】/【表演形式】→ 说明这是「场次」
            is_scene = False
            for j in range(i + 1, min(i + 4, n)):
                if paras[j][1].startswith(('【地点】', '【表演形式】')):
                    is_scene = True
                    break

            # ── 幕前抬头与体例说明 ──
            if self.act is None:
                if ACT_RE.match(text) and not SONG_RE.match(text):
                    pass
                elif text.startswith('【全剧曲目表】') or text.startswith('【全剧人物表】'):
                    self.log.append((pidx, 'CAPTION', text))
                    continue
                elif text == '【体例说明】':
                    self.log.append((pidx, 'STYLE-H', text))
                    continue
                elif re.match(r'^[^：（【]{2,8}：', text):
                    k, v = text.split('：', 1)
                    self.meta[k.strip()] = v.strip()
                    self.log.append((pidx, 'HEADER', text))
                    continue
                else:
                    self.style_notes.append(text)
                    self.log.append((pidx, 'STYLE', text))
                    continue

            # 幕标题
            m = ACT_RE.match(text)
            if m and not SONG_RE.match(text):
                self.new_act(m.group('title'))
                self.log.append((pidx, 'ACT', text))
                continue

            # 曲段标记
            m = SONG_RE.match(text)
            if m:
                name = m.group('name').strip()
                perf = m.group('perf').strip()
                self.flush_spk()
                self.end_song()
                song = {'no': len(self.songs) + 1, 'name': name, 'performer_raw': perf,
                        'items': [], 'act': self.act['index'],
                        'actTitle': self.act['title']}
                self.songs[song['no']] = song
                self.song = song
                self.blk('song', {'no': song['no'], 'name': name,
                                  'performer_raw': perf,
                                  'act': song['act'], 'actTitle': song['actTitle']})
                self.act['public_blocks'].append({'k': 'song', 'v': {
                    'no': song['no'], 'name': name,
                    'act': song['act'], 'actTitle': song['actTitle']}})
                self.header = False
                self.log.append((pidx, 'SONG', text))
                continue

            # 幕内资料标签
            m = META_RE.match(text)
            if m:
                key, val = m.group('key'), m.group('val').strip()
                self.mood = False
                if key == '剧情正文':
                    self.header = False
                    self.blk('note', text)
                    self.log.append((pidx, 'NOTE', text))
                    continue
                if key == '舞台氛围':
                    if self.header:
                        self.mood = True
                        self.log.append((pidx, 'META-MOOD', text))
                        continue
                    self.blk('note', text)
                    self.log.append((pidx, 'NOTE', text))
                    continue
                if self.header:
                    if key == '时间':
                        self.act['meta']['time'] = val
                    elif key == '地点':
                        self.act['meta']['place'] = val
                    elif key == '出场人物':
                        self.act['meta']['cast'] = val
                    elif key == '表演形式':
                        self.blk('note', text)
                    self.log.append((pidx, 'META', text))
                    continue
                self.blk('note', text)
                self.log.append((pidx, 'NOTE', text))
                continue

            # 方括号标记
            m = MARK_RE.match(text)
            if m and is_structural_mark(m.group('x')):
                x = m.group('x')
                self.mood = False
                if self.song is not None and is_song_section(x):
                    self.song['items'].append({'k': 'sec', 'v': text})
                    self.log.append((pidx, 'SEC', text))
                    continue
                # 幕内场次 / 分节 → 结束当前曲目
                self.flush_spk()
                self.end_song()
                self.blk('scene', x)
                self.act['public_blocks'].append({'k': 'scene', 'v': x})
                if is_scene:
                    self.header = False
                self.log.append((pidx, 'SCENE', text))
                continue

            # 整段括号 → 舞台提示
            m = PAREN_RE.match(text)
            if m:
                inner = m.group('inner').strip()
                if self.song is not None:
                    self.song['items'].append({'k': 'cue', 'v': inner})
                elif self.mood:
                    self.act['meta']['mood'].append(text)
                else:
                    self.blk('sd', inner)
                self.log.append((pidx, 'SD', text))
                continue

            # 角色行
            m = SPK_RE.match(text)
            if m and m.group('who').strip() in SPEAKERS:
                self.mood = False
                who = m.group('who').strip()
                cue, body = split_speaker(m.group('rest').strip())
                self.speaker = (who, cue)
                if self.song is not None:
                    if body:
                        self.song['items'].append({'k': 'ly', 'speaker': who,
                                                  'cue': cue, 'text': body})
                    else:
                        self.pending_spk = None
                else:
                    self.flush_spk()
                    if body:
                        self.add_dlg(who, cue, body)
                    else:
                        self.pending_spk = (who, cue)
                self.log.append((pidx, 'SPK', text))
                continue

            # 普通段落
            if self.mood:
                self.act['meta']['mood'].append(text)
                self.log.append((pidx, 'MOOD', text))
                continue

            if self.song is not None:
                if self.speaker:
                    who, cue = self.speaker
                    self.speaker = (who, '')   # 演唱提示只带在第一行
                else:
                    who, cue = '', ''
                self.song['items'].append({'k': 'ly', 'speaker': who,
                                          'cue': cue, 'text': text})
                self.log.append((pidx, 'LY', text))
                continue

            if self.speaker:
                who, cue = self.speaker
                self.pending_spk = None
                self.add_dlg(who, cue, text)
                self.log.append((pidx, 'DLG', text))
                continue

            self.blk('act', text)
            self.log.append((pidx, 'ACTLINE', text))

        return self

    def result(self):
        return {
            'meta': self.meta,
            'style_notes': self.style_notes,
            'song_table': self.song_table,
            'char_table': self.char_table,
            'acts': self.acts,
            'songs': [self.songs[k] for k in sorted(self.songs)],
            'log': self.log,
        }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    audit = '--audit' in sys.argv
    if len(args) < 2:
        print('用法: extract_script.py <定稿.docx> <script_struct.json> [--audit]')
        sys.exit(1)
    p = Parser().parse(args[0]).result()
    out = pathlib.Path(args[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding='utf-8')
    print('acts=%d songs=%d 段落覆盖=%d -> %s' % (
        len(p['acts']), len(p['songs']), len(p['log']), out))
    if audit:
        for idx, kind, text in p['log']:
            print('%4d %-10s %s' % (idx, kind, text))


if __name__ == '__main__':
    main()
