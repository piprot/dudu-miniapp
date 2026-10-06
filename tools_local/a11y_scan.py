#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""筛出「无可访问名称」的交互元素。

判定规则（对齐 WCAG 4.1.2 Name, Role, Value + 1.1.1）：
元素若含可见文本，读屏器可直接播报，**不需要** aria-label
（加了反而重复播报，违反 2.5.3 Label in Name）。
只有以下情况才是真缺口：
  ①纯图形/纯图标类（无可见文字，或只有 emoji）
  ② 图片类（<image>）
  ③ 文本被视觉隐藏但仍是唯一标识

输出：需要人工确认的清单（不自动改写，语义必须逐个判断）。
"""
import re, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TAG_RE = re.compile(r'<(view|text|image|button|navigator)\b([^>]*)>', re.S)
# 事件属性（决定是不是可交互元素）
EVT_RE = re.compile(r'\b(bind(?:tap|change|input|confirm|longpress|chooseavatar|error|load)|catchtap)\s*=')
ARIA_RE = re.compile(r'\baria-label\s*=')
# 可见文字：标签内的非标签文本 + {{}} 插值
TEXT_RE = re.compile(r'>\s*([^<>{}]*\S[^<>]*?)\s*<')
EMOJI_RE = re.compile(r'^[\U0001F300-\U0001FAFF☀-➿\s]*$')
VAR_RE = re.compile(r'\{\{[^}]+\}\}')

rows = []
for pat in ('pages/**/*.wxml', 'components/**/*.wxml', 'package*/**/*.wxml'):
    for f in glob.glob(os.path.join(ROOT, pat), recursive=True):
        src = open(f, encoding='utf-8').read()
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        for m in TAG_RE.finditer(src):
            tag, attrs = m.group(1), m.group(2)
            if not EVT_RE.search(attrs):
                continue
            line = src[:m.start()].count('\n') + 1

            # 该标签的「开标签到闭合标签」之间的文本
            seg = src[m.end():m.end() + 220]
            inner = re.match(r'\s*([^<]*)', seg)
            inner_txt = (inner.group(1).strip() if inner else '')
            # 只取到下一个标签前的纯文本
            if not inner_txt:
                nxt = re.search(r'<[a-zA-Z]', seg)
                inner_txt = seg[:nxt.start()].strip() if nxt else ''

            # ⚠️ 必须递归看整棵子树：很多元素直接文本为空，但子节点带
            # {{item.name}} / {{points}}，读屏器遍历子节点即可播报。
            # 只看直接文本会大量误报（第一版就栽在这：index积分条、
            # weather 的 cell、card 的 type 全被子节点文字掩盖）。
            if not inner_txt:
                depth, pos = 1, m.end()
                subtree = ''
                while pos < len(src) and depth > 0:
                    nxt_open = re.compile(r'<([a-zA-Z][\w-]*)\b[^>]*?(/?)>').search(src, pos)
                    nxt_close = re.compile(r'</([a-zA-Z][\w-]*)\s*>').search(src, pos)
                    if not nxt_close:
                        break
                    if nxt_open and nxt_open.start() < nxt_close.start():
                        tagm = nxt_open.group(1)
                        if nxt_open.group(2) == '/':
                            pos = nxt_open.end()
                            continue
                        depth += 1
                        pos = nxt_open.end()
                    else:
                        depth -= 1
                        pos = nxt_close.end()
                subtree = src[m.end():pos] if depth == 0 else ''
                texts = re.findall(r'>([^<>]+)<', subtree)
                inner_txt = ' '.join(t.strip() for t in texts if t.strip())

            has_aria = bool(ARIA_RE.search(attrs))
            # 有意义的文字：非纯 emoji，且不是纯符号；{{}} 插值也算（读屏会读变量绑定）
            meaningful = bool(inner_txt) and not EMOJI_RE.match(inner_txt)

            rows.append({
                'file': rel, 'line': line, 'tag': tag,
                'text': inner_txt[:26],
                'evt': (EVT_RE.search(attrs).group(1) if EVT_RE.search(attrs) else ''),
                'aria': has_aria,
                'ok': has_aria or meaningful,
            })

gap = [r for r in rows if not r['ok']]
print('可交互元素总数: %d' % len(rows))
print('  已有 aria-label: %d' % sum(1 for r in rows if r['aria']))
print('  有可见文字(读屏可播报): %d' % sum(1 for r in rows if not r['aria'] and r['ok']))
print('  ** 无可访问名称(需人工补)**: %d' % len(gap))
print()
byfile = {}
for r in gap:
    byfile.setdefault(r['file'], []).append(r)
for f in sorted(byfile, key=lambda k: -len(byfile[k])):
    print('\n--- %s (%d) ---' % (f, len(byfile[f])))
    for r in byfile[f]:
        print('  L%-4d %-10s %-14s 文本=%r' % (r['line'], r['tag'], r['evt'], r['text']))