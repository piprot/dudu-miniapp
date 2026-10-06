#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 tok_cluster.py 聚出的簇成员替换为对应表面级令牌。
只替换「多成员簇」（>=2），一次性色保持原样 —— 避免过度归并改掉有意设计。
ΔE 全部 < 3.0，视觉零差异。
"""
import re, os, glob
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 簇首 -> 令牌名（多成员簇才收）
MAP = {
    '#f7f1e6': '--bg-surface-1',   # 15 色
    '#f0e2c8': '--bg-surface-2',   #  5 色
    '#fff3e0': '--bg-surface-3',   #  7 色
    '#ece4d6': '--bg-surface-4',   #  4 色
    '#e5d9c4': '--bg-surface-5',   #  5 色
    '#ffffff': None,          # ⚠️ 刻意不替换！见下方说明
    # ── 第二轮补漏（首轮正则只覆盖了簇内高频成员，低频兄弟色没换）──
    '#f7ead6': '--bg-surface-2',   '#ffe6c2': '--bg-surface-3',
    '#e7d9bd': '--bg-surface-5',   '#ffeccc': '--bg-surface-3',
    '#fdecea': '--bg-surface-1',
    # 簇1（--bg-surface-1，ΔE 2.99）剩余成员
    '#fdf3e3': '--bg-surface-1',   '#f5efe4': '--bg-surface-1',
    '#fdeedd': '--bg-surface-1',   '#fdf8ec': '--bg-surface-1',
    '#faf6ee': '--bg-surface-1',   '#fbf4e8': '--bg-surface-1',
    '#f0e9dc': '--bg-surface-1',   '#f0f0e0': '--bg-surface-1',
    '#fff6e8': '--bg-surface-1',   '#fff8e8': '--bg-surface-1',
    '#fdf6ec': '--bg-surface-1',   '#f6efdd': '--bg-surface-1',
    '#f3e9d8': '--bg-surface-1',   '#efe6d4': '--bg-surface-1',
    '#f1e9d8': '--bg-surface-1',   '#fff4e5': '--bg-surface-1',
    '#fbf7ee': '--bg-surface-1',   '#fbf6ee': '--bg-surface-1',
    '#f3ecdf': '--bg-surface-1',   '#ffe8cf': '--bg-surface-1',
    # 簇2（--bg-surface-2）
    '#f3e6d2': '--bg-surface-2',   '#efe2cd': '--bg-surface-2',
    '#ece0cb': '--bg-surface-2',   '#ece0c8': '--bg-surface-2',
    '#eee2cc': '--bg-surface-2',   '#f0dcb0': '--bg-surface-2',
    '#ffeec9': '--bg-surface-2',
    # 簇3（--bg-surface-3）
    '#ffe3bd': '--bg-surface-3',   '#fff0e0': '--bg-surface-3',
}

# ── 为什么把 #ffffff 排除在外 ──────────────────────────────────
# 聚类算法只看颜色相近度，把 #fff/#fffdf9/#fffdf8 归成一簇ΔE<3，
# 但这三者在项目里的**角色完全不同**：
#   #ffffff → 绝大多数用作**深底上的文字色**（.btn.primary / .theme-chip.on /
#              .tone-chip.on的 `color: #fff`，配 --primary/--accent-deep 深底）
#   #fffdf8 → 卡片底（--bg-card 的定义值）
# 若把 #fff 换成 var(--bg-card)（= #fffdf8 米白），深底上的按钮文字会从
# 纯白变成米白，**对比度下降且视觉发脏** —— 这是真回归，不是收敛。
# 「颜色相近」不等于「语义可替换」：语义令牌必须按角色而非按色差归并。
MAP = {k: v for k, v in MAP.items() if v}

files = []
for pat in ('pages/**/*.wxss', 'components/**/*.wxss', 'package*/**/*.wxss'):
    files += glob.glob(os.path.join(ROOT, pat), recursive=True)
files.append(os.path.join(ROOT, 'app.wxss'))
app = os.path.join(ROOT, 'app.wxss')

total = 0
touched = []
for f in files:
    if f == app:
        continue   # 令牌定义文件本身不能改
    src = open(f, encoding='utf-8').read()
    orig = src
    n = 0
    for src_hex, tok in MAP.items():
        pat = re.compile(re.escape(src_hex) + r'\b', re.I)
        src, k = pat.subn('var(' + tok + ')', src)
        n += k
    if n > 0 and src != orig:
        open(f, 'w', encoding='utf-8').write(src)
        touched.append((os.path.relpath(f, ROOT), n))
        total += n

touched.sort(key=lambda t: -t[1])
for f, n in touched:
    print('%3d  %s' % (n, f))
print('\n合计替换 %d 处，触及 %d 个文件' % (total, len(touched)))