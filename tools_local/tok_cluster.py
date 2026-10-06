#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把极浅色底收敛到少量「表面级」令牌。
先用 CIEDE2000 近似的 CIE76 ΔE 验证：同桶色值互相替换是否肉眼无差别。
ΔE < 2 几乎不可辨；2~3.5 轻微；> 3.5 明显。
"""
import re, glob, os, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def srgb_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rgb2lab(hx):
    hx = hx.lstrip('#')
    r, g, b = [srgb_lin(int(hx[i:i+2], 16)) for i in (0, 2, 4)]
    X = r * 0.4124 + g * 0.3576 + b * 0.1805
    Y = r * 0.2126 + g * 0.7152 + b * 0.0722
    Z = r * 0.0193 + g * 0.1192 + b * 0.9505
    Xn, Yn, Zn = 0.95047, 1.0, 1.08883
    def f(t):
        return t ** (1/3) if t > 0.008856 else 7.787 * t + 16/116
    fx, fy, fz = f(X/Xn), f(Y/Yn), f(Z/Zn)
    return (116*fy - 16, 500*(fx-fy), 200*(fy-fz))

def dE(h1, h2):
    a, b = rgb2lab(h1), rgb2lab(h2)
    return sum((x-y)**2 for x, y in zip(a, b)) ** 0.5

# 收集所有 wxss 色值
files = []
for pat in ('pages/**/*.wxss', '*.wxss', 'components/**/*.wxss', 'package*/**/*.wxss'):
    files += glob.glob(os.path.join(ROOT, pat), recursive=True)

cnt = Counter()
for f in files:
    src = open(f, encoding='utf-8').read()
    for x in re.findall(r'#([0-9a-fA-F]{6})', src):
        cnt['#' + x.lower()] += 1

def rel_lum(hx):
    hx = hx.lstrip('#')
    r, g, b = [srgb_lin(int(hx[i:i+2], 16)) for i in (0, 2, 4)]
    return 0.2126*r + 0.7152*g + 0.0722*b

# 只处理暖色系浅底：饱和度低（近乎灰）+ 明度高
def is_warm_light(hx):
    h2 = hx.lstrip('#')
    r, g, b = [int(h2[i:i+2], 16) for i in (0, 2, 4)]
    mx, mn = max(r, g, b), min(r, g, b)
    sat = 0 if mx == 0 else (mx - mn) / mx
    return rel_lum(hx) >= 0.62 and sat <= 0.30 and r >= b  #暖色调（红>=蓝）

cands = [(k, v) for k, v in cnt.items() if is_warm_light(k)]
print('暖系浅底候选：%d 种 / %d 次' % (len(cands), sum(v for k, v in cands)))

# 排除已是令牌的（#fffdf8 等由 --bg-card 提供）
app_src = open(os.path.join(ROOT, 'app.wxss'), encoding='utf-8').read()
existing = set('#' + m.lower() for m in re.findall(r'#[0-9a-fA-F]{6}', app_src))
cands = [(k, v) for k, v in cands if k not in existing]
print('排除已有令牌色后：%d 种 / %d 次' % (len(cands), sum(v for k, v in cands)))

if not cands:
    sys.exit(0)

# 贪心聚类：按出现频次降序，每个色找ΔE 最近的簇首，阈值 3.0
cands.sort(key=lambda kv: -kv[1])
clusters = []   # [代表色, [成员]]
for k, v in cands:
    placed = False
    for cl in clusters:
        if dE(k, cl[0]) < 3.0:
            cl[1].append((k, v))
            placed = True
            break
    if not placed:
        clusters.append([k, [(k, v)]])

clusters.sort(key=lambda cl: -sum(v for k, v in cl[1]))
print('\nΔE<3.0 聚类结果：%d 簇（来自 %d 种）' % (len(clusters), len(cands)))
print()
print('%-10s %-6s %-5s %s' % ('簇首', '次数', '成员', '成员明细'))
for rep, mem in clusters:
    tot = sum(v for k, v in mem)
    detail = ' '.join('%s(%d)' % (k, v) for k, v in sorted(mem, key=lambda t: -t[1]))
    print('%-10s %-6d %-5d %s' % (rep, tot, len(mem), detail))
    # 最大簇内偏差
    worst = max(dE(rep, k) for k, v in mem)
    print('%s  簇内最大 ΔE = %.2f' % (' ' * 10, worst))