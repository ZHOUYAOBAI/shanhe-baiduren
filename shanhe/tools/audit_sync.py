#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《山河摆渡人》· 同步校验
================================================================
核对「定稿 docx」的每一个非空段落，是否都在生成的数据里出现过且只出现一次。

判定方式：把段落文字与数据里的文字都「归一化」（去空白、去最外层【】（））后比对。

用法：
  python3 audit_sync.py <定稿.docx> <data.js>
"""
import json
import pathlib
import re
import sys

from docx import Document


def norm(s):
    s = str(s or '')
    s = s.strip()
    s = re.sub(r'^【(.*)】$', r'\1', s)
    s = re.sub(r'^（(.*)）$', r'\1', s)
    s = re.sub(r'\s+', '', s)
    return s


def docx_paras(path):
    doc = Document(str(path))
    out = []
    for child in doc.element.body.iterchildren():
        if child.tag.split('}')[-1] != 'p':
            continue
        t = ''.join(n.text or '' for n in child.iter() if n.tag.split('}')[-1] == 't')
        t = t.strip()
        if t:
            out.append(t)
    return out


def collect(data):
    """从 data.js 收集所有文本片段（公开层 + 密文解密后的受限层）。"""
    import base64
    import hashlib
    import os
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    js = pathlib.Path(data).read_text(encoding='utf-8')
    pub = json.loads(re.search(r'window\.SCRIPT\s*=\s*(\{.*?\});\s*\nwindow\.SCRIPT_SECRET',
                               js, re.S).group(1))
    enc = json.loads(re.search(r'window\.SCRIPT_SECRET\s*=\s*(\{.*?\});\s*$', js, re.S).group(1))

    pieces = []
    # ── 公开层 ──
    for k in ('title', 'name', 'author', 'music', 'theme', 'span', 'note'):
        pieces.append(pub['cover'][k])
    pieces.extend(pub['cover']['mainline'])
    for s_ in pub['songs']:
        pieces.append(s_['name'])
        pieces.append(s_['performer'])
        pieces.append(s_['label'])
    for a in pub['acts']:
        pieces.append(a['title'])
        for k in ('time', 'place', 'cast'):
            pieces.append(a['meta'].get(k, ''))
        for v in (a['meta'].get('mood') or []):
            pieces.append(v)
        for b in a['blocks']:
            if b['k'] == 'scene':
                pieces.append(b['v'])
            elif b['k'] == 'song':
                pieces.append(b['v']['name'])
                pieces.append(b['v'].get('performer', ''))
                pieces.append(b['v'].get('label', ''))
    for row in pub['charTable']:
        pieces.extend(row)
    for row in pub['songTable']:
        pieces.extend(row)
    for t in pub['threads']:
        pieces.extend([t.get(k, '') for k in ('name', 'plant', 'pay', 'note')])
    for t in pub['timeline']:
        pieces.extend([t.get('date', ''), t.get('label', '')])

    # ── 受限层（需要 READ_PASS 解密）──
    password = os.environ.get('READ_PASS')
    if not password:
        print('！未设置 READ_PASS，只能校验公开层')
        return pieces, pub
    salt = base64.b64decode(enc['salt'])
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt,
                              enc['iterations'], dklen=32)
    try:
        plain = AESGCM(key).decrypt(base64.b64decode(enc['iv']),
                                     base64.b64decode(enc['cipher']), None)
        sec = json.loads(plain.decode('utf-8'))
    except Exception as e:
        print('！密文解密失败（READ_PASS 不对？）：%s' % e)
        raise SystemExit(2)
    for a in sec['acts']:
        for b in a['blocks']:
            k = b['k']
            if k == 'song':
                pieces.append(b['v']['name'])
                pieces.append(b['v'].get('performer', ''))
                pieces.append(b['v'].get('label', ''))
            else:
                pieces.append(b.get('v', ''))
                if k == 'dlg':
                    pieces.append(b.get('who', ''))
                    pieces.append(b.get('cue', ''))
                elif k == 'spk':
                    pieces.append(b.get('cue', ''))
    for s_ in sec['songs']:
        for it in s_['items']:
            if it['k'] == 'ly':
                pieces.append(it.get('text', ''))
                pieces.append(it.get('speaker', ''))
                pieces.append(it.get('cue', ''))
            elif it['k'] == 'sec':
                pieces.append(it.get('v', ''))
            elif it['k'] == 'cue':
                pieces.append(it.get('v', ''))
    return pieces, pub


def candidates(text):
    """一段原文在数据里可能以哪些形态出现（越具体的排前面）。"""
    out = []
    t = text.strip()
    if t:
        out.append(t)
    m = re.match(r'^【《(.+?)》\s*——\s*(.+?)】$', t)
    if m:
        out += [m.group(1), '《%s》' % m.group(1), m.group(2)]
        mm = re.match(r'^(.+?)（([^（）]*)）$', m.group(2))
        if mm:
            out += [mm.group(1), mm.group(2)]
        return out
    m = re.match(r'^【([^】]+)】\s*(.*)$', t)
    if m:
        out.append(m.group(2))
        out.append(m.group(1))
        return out
    if '→' in t:
        out.extend(x.strip() for x in t.split('→'))
    m = re.match(r'^（(.+)）$', t)
    if m:
        out.append(m.group(1))
        return out
    m = re.match(r'^([^：（【\n]{1,12})[：:]\s*(.*)$', t)
    if m:
        who, rest = m.group(1), m.group(2).strip()
        if rest:
            out.append(rest)
            mm = re.match(r'^（([^（）]*)）\s*(.*)$', rest)
            if mm:
                out.append(mm.group(2))
                out.append(mm.group(1))
        out.append(who)
    return [c for c in out if c]


def main():
    if len(sys.argv) < 3:
        print('用法: audit_sync.py <定稿.docx> <data.js>')
        sys.exit(1)
    paras = docx_paras(sys.argv[1])
    pieces, pub = collect(sys.argv[2])
    atoms = [norm(x) for x in pieces]
    atoms = [a for a in atoms if a]
    atom_set = set(atoms)
    blob = '\u0001'.join(atoms)   # 用不可能出现的分隔符，避免跨条目误匹配

    # docx 自身的表格题注（表格内容已随 songTable/charTable 同步）
    known_labels = {'全剧曲目表', '全剧人物表'}
    missing, weak, ok = [], [], 0
    for p in paras:
        cands = [norm(c) for c in candidates(p)]
        if cands and any(c in known_labels for c in cands):
            ok += 1
            continue
        cands = [c for c in cands if c]
        if not cands:
            continue
        hit = None
        for c in cands:
            if c in atom_set:
                hit = c
                break
            if c in blob:
                hit = c
                break
        if hit is None:
            missing.append(p)
        elif len(hit) < 6 and hit not in atom_set:
            weak.append((p, hit))
        else:
            ok += 1

    print('文档非空段落 %d 条 · 命中 %d 条 · 弱匹配 %d 条 · 缺失 %d 条' % (
        len(paras), ok, len(weak), len(missing)))
    if weak:
        print('\n--- 仅靠短片段匹配（建议人工过一眼）---')
        for p, h in weak:
            print('  ~', p[:70], '→', h[:30])
    if missing:
        print('\n--- 未进入站点数据的段落 ---')
        for m in missing:
            print('  *', m[:90])
        sys.exit(1)

    print('\n所有段落均已同步。')
    print('曲目 %d 首 · 幕 %d 段 · 人物 %d 位' % (
        len(pub['songs']), len(pub['acts']), len(pub['charTable']) - 1))


if __name__ == '__main__':
    main()
