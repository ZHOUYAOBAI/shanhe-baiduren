#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《西山不是山》· 站点数据生成器 —— 解析层
================================================================
把 Stage1 分场剧本 Markdown 解析为结构化 JSON。

关键约定（沿用 NOCTURNE 教训）：**不要另写解析器**。
本文件只负责解析；剧目信息、人物卡、伏笔等映射在 gen_site_data.py。

用法：
  python3 extract_script.py <script.md> <out.json>
"""
import json
import re
import sys
import pathlib

SCENE_RE = re.compile(r'^###\s+(\d+)\.\s+(.+?)\s*$')
H2_RE = re.compile(r'^##\s+(.+?)\s*$')

# 正文幕标题（带中文序号）→ 站点幕名
ACT_HEADS = [
    ('序幕', '序幕《看》'),
    ('一段', '一段《看它怎么被说出来》'),
    ('二段', '二段《门》'),
    ('三段', '三段《改》'),
    ('尾声', '尾声《开》'),
]

# 正文结束标记：到「唱段歌词集」章为止（那里是歌词汇总表，会与正文重复）
STOP_RE = re.compile(r'唱段歌词集')


def parse_song_heading(line):
    m = re.search(r'唱段\s*(\d+)\s*《([^》]+)》', line)
    if m:
        return int(m.group(1)), m.group(2)
    m = re.search(r'曲目\s*(\d+)\s*《([^》]+)》', line)
    if m:
        return int(m.group(1)), m.group(2)
    return None, None


def parse_md(md_path):
    text = pathlib.Path(md_path).read_text(encoding='utf-8')
    lines = text.split('\n')

    acts = []
    cur_act = None
    pending_song = None
    songs = {}
    scenes_flat = []
    act_idx = -1
    stopped = False

    def flush():
        nonlocal pending_song
        pending_song = None

    def ensure_act(title):
        nonlocal cur_act, act_idx
        act_idx += 1
        cur_act = {'index': act_idx, 'title': title,
                   'meta': {'time': '', 'place': '', 'cast': '', 'mood': []},
                   'blocks': []}
        acts.append(cur_act)
        return cur_act

    i = 0
    while i < len(lines):
        raw = lines[i]
        s = raw.strip()

        if stopped:
            i += 1
            continue

        # ── 二级标题：幕 / 停止标记 ──
        m = H2_RE.match(s)
        if m:
            head = m.group(1)
            if STOP_RE.search(head):
                stopped = True
                i += 1
                continue
            matched = None
            for key, title in ACT_HEADS:
                # 「四、序幕《看》」「五、一段《…」」
                if re.search(r'[、，]?\s*' + key + r'(《|$|的)', head):
                    matched = title
                    break
            if matched:
                flush()
                ensure_act(matched)
                i += 1
                continue
            i += 1
            continue

        # ── 场次标题 ──
        m = SCENE_RE.match(s)
        if m:
            flush()
            no = int(m.group(1))
            title = m.group(2)
            parts = re.split(r'[　\s]+', title.strip())
            kind = parts[0] if parts else ''
            place = parts[1] if len(parts) > 1 else ''
            when = ' '.join(parts[2:]) if len(parts) > 2 else ''
            scenes_flat.append({'no': no, 'kind': kind, 'place': place,
                                'time': when, 'title': title,
                                'act': cur_act['index'] if cur_act else 0})
            if cur_act is not None:
                cur_act['blocks'].append({'k': 'scene', 'v': title, 'no': no})
                cur_act['blocks'].append({'k': 'sceneMeta', 'v': {
                    'kind': kind, 'place': place, 'time': when}})
            i += 1
            continue

        # ── 唱段标记 ──
        if '〔唱段' in s or s.startswith('**〔唱段'):
            no, name = parse_song_heading(s)
            if no is not None:
                flush()
                pending_song = (no, name)
                songs.setdefault(no, {'no': no, 'name': name, 'items': []})
                if cur_act is not None:
                    cur_act['blocks'].append(
                        {'k': 'song', 'v': {'no': no, 'name': name}})
                i += 1
                continue

        # ── 歌词行 ──
        if s.startswith('>'):
            txt = s.lstrip('>').strip()
            if pending_song is not None:
                no, name = pending_song
                songs[no]['items'].append({'k': 'ly', 'text': txt, 'speaker': ''})
            i += 1
            continue

        # ── 舞台提示 ──
        if s.startswith('〔') and s.endswith('〕'):
            if pending_song is not None:
                no, name = pending_song
                songs[no]['items'].append({'k': 'cue', 'v': s[1:-1]})
            elif cur_act is not None:
                cur_act['blocks'].append({'k': 'sd', 'v': s[1:-1]})
            i += 1
            continue

        # ── 角色名（独占一行）──
        m = re.match(r'^\*\*(.+?)\*\*\s*$', s)
        if m:
            who = m.group(1).strip()
            j = i + 1
            cue = None
            if j < len(lines):
                ls = lines[j].strip()
                mm = re.match(r'^（(.+?)）$', ls)
                if mm:
                    cue = mm.group(1)
                    j += 1
            # 台词可能是一行，或多行（唱段内的裸文本歌词每行一句）
            buf = []
            while j < len(lines):
                ls = lines[j].strip()
                if not ls:
                    break
                if (ls.startswith('>') or ls.startswith('〔')
                        or re.match(r'^\*\*', ls) or SCENE_RE.match(ls)
                        or ls.startswith('#')):
                    break
                buf.append(ls)
                j += 1
            t = ' '.join(buf)
            if t:
                if pending_song is not None:
                    no, name = pending_song
                    items = songs[no]['items']
                    if items and items[-1]['k'] == 'ly' and not items[-1]['text'] \
                            and items[-1]['speaker'] == who:
                        items[-1]['text'] = t
                    else:
                        items.append({'k': 'ly', 'text': t, 'speaker': who})
                elif cur_act is not None:
                    cur_act['blocks'].append(
                        {'k': 'dlg', 'who': who, 'cue': cue, 'v': t})
            i = j
            continue

        # ── 角色名 + 演唱提示 + 后续歌词行（唱段内的裸文本歌词）──
        # 形如：**守塔人**（低吟）  下一行起逐句歌词
        m = re.match(r'^\*\*(.+?)\*\*（(.+?)）\s*$', s)
        if m and pending_song is not None:
            who = m.group(1).strip()
            no, name = pending_song
            j = i + 1
            got = 0
            while j < len(lines):
                ls = lines[j].strip()
                if not ls:
                    break
                if (ls.startswith('>') or ls.startswith('〔')
                        or re.match(r'^\*\*', ls) or SCENE_RE.match(ls)
                        or ls.startswith('#')):
                    break
                songs[no]['items'].append({'k': 'ly', 'text': ls, 'speaker': who})
                got += 1
                j += 1
            if got:
                i = j
                continue

        # ── 角色名 + 提示 + 台词（同一行）──
        m = re.match(r'^\*\*(.+?)\*\*（(.+?)）\s*(.*)$', s)
        if m:
            who, cue, t = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
            if t:
                if pending_song is not None:
                    no, name = pending_song
                    songs[no]['items'].append(
                        {'k': 'ly', 'text': t, 'speaker': who})
                elif cur_act is not None:
                    cur_act['blocks'].append(
                        {'k': 'dlg', 'who': who, 'cue': cue, 'v': t})
            i += 1
            continue

        # ── 唱段内的裸文本歌词行（跟在角色名之后）──
        if pending_song is not None and s and not s.startswith('**') \
                and not s.startswith('〔') and not s.startswith('>'):
            no, name = pending_song
            songs[no]['items'].append({'k': 'ly', 'text': s, 'speaker': ''})
            i += 1
            continue

        i += 1

    flush()

    for no in songs:
        songs[no]['items'] = [x for x in songs[no]['items']
                              if x.get('text') or x['k'] == 'cue']

    return {'acts': acts, 'scenes': scenes_flat,
            'songs': [songs[k] for k in sorted(songs)]}


def main():
    if len(sys.argv) < 3:
        print('用法: extract_script.py <script.md> <out.json>')
        sys.exit(1)
    data = parse_md(sys.argv[1])
    out = pathlib.Path(sys.argv[2])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    print('acts=%d scenes=%d songs=%d -> %s' % (
        len(data['acts']), len(data['scenes']), len(data['songs']), out))


if __name__ == '__main__':
    main()
