#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""给纯装饰性视觉元素加 aria-hidden（WCAG 1.1.1）。
只处理两类明确的装饰元素，不碰有语义的：
  · .dot 色块（主题色预览，父元素已有 {{item.name}} 提供名称）
  · .bg-thumb 缩略图（父容器已有 aria-label）
"""
import re, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATTERNS = [
    (r'<view class="dot" style="background:\{\{item\.color\}\}"></view>',
     '<view class="dot" style="background:{{item.color}}" aria-hidden="true"></view>'),
]

n = 0
for pat in ('pages/**/*.wxml', 'components/**/*.wxml', 'package*/**/*.wxml'):
    for f in glob.glob(os.path.join(ROOT, pat), recursive=True):
        src = open(f, encoding='utf-8').read()
        orig = src
        for rx, rep in PATTERNS:
            src = re.sub(rx, rep, src)
        if src != orig:
            k = sum(1 for _ in re.finditer(r'aria-hidden', src)) - \
                sum(1 for _ in re.finditer(r'aria-hidden', orig))
            open(f, 'w', encoding='utf-8').write(src)
            print('%-40s +%d' % (os.path.relpath(f, ROOT).replace('\\', '/'), k))
            n += k
print('\n共补%d 处装饰标记' % n)