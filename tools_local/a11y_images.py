#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""为四页的背景缩略图补 aria 语义（结构一致，逐页精确匹配）。
缩略图本身标 aria-hidden（父容器 .bg-item 已承载可读标签），
避免读屏重复播报同一张图。
"""
import re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (文件名, 内置区 aria, 网络区 aria)
PAGES = ['weather', 'solar', 'quotes', 'line']
LBL_BUILTIN = '选用内置背景图，摄影者 {{item.author}}'
LBL_LIB = '选用网络背景图，摄影者 {{item.author}}'

total = 0
for pg in PAGES:
    f = os.path.join(ROOT, 'pages', pg, pg + '.wxml')
    src = open(f, encoding='utf-8').read()
    orig = src

    # ① 内置区：onPickBuiltinBg
    def add_builtin(m):
        head, rest = m.group(1), m.group(2)
        if 'aria-label' in head:
            return m.group(0)
        return head + '\n        aria-label="' + LBL_BUILTIN + '">' + rest
    src, n1 = re.subn(
        r'(bindtap="onPickBuiltinBg"[^>]*?)\s*>',
        lambda m: m.group(1) + '\n        aria-label="' + LBL_BUILTIN + '">'
        if 'aria-label' not in m.group(1) else m.group(0),
        src)

    # ② 网络区：onPickPhoto
    def add_lib(m):
        if 'aria-label' in m.group(1):
            return m.group(0)
        return m.group(1) + '\n        aria-label="' + LBL_LIB + '">'
    src, n2 = re.subn(
        r'(bindtap="onPickPhoto"[^>]*?)\s*>',
        add_lib, src)

    # ③ 缩略图 aria-hidden（仅 bg-thumb，不动 avatar / panels）
    def hide(m):
        tag = m.group(0)
        if 'aria-hidden' in tag or 'aria-label' in tag:
            return tag
        return tag[:-2].rstrip() + '\n          aria-hidden="true" />'
    src, n3 = re.subn(r'<image class="bg-thumb"[^>]*/>', hide, src)

    if src != orig:
        open(f, 'w', encoding='utf-8').write(src)
        print('%-10s aria-label +%d  aria-hidden +%d' % (pg, n1 + n2, n3))
        total += n1 + n2 + n3
print('\n合计补%d 处' % total)