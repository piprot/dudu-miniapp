#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""删掉四页 WXML 里的「更多背景（网络图库 · 增强项）」整块。

为什么用标签配对定位而不是行号：
  四页的该区块结构完全一致（block > block-title + 折叠说明 + toggle + hint×2
  + scroll-view + picked + loc-hint），但它前面紧挨着「背景」区块的收尾 `</view>`，
  后紧跟 theme-row。行号硬编码一旦上游插一行就会连错区块 —— 上游删一行就删掉
  正确的 `</view>`，WXML 标签不配对，小程序编译直接报错但很难看出是哪一行错的。

定位策略：从 block-title 含「网络图库」的那行往上找最近的 `<view class="block">`，
  再从那里往下做 view 标签深度计数，取深度回到 0 的那一行 = 该 block 的闭合。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ['weather', 'solar', 'quotes', 'line']
TITLE_KEY = '网络图库'


def find_block_start(lines, title_idx):
    """从 block-title 行往上找最近的一行 <view class="block">。"""
    for i in range(title_idx, -1, -1):
        s = lines[i].strip()
        if s.startswith('<view class="block"') and s.endswith('>'):
            return i
    return -1


def find_block_end(lines, start):
    """从 start 起做 <view / </view> 深度计数，返回闭合行下标。"""
    depth = 0
    for i in range(start, len(lines)):
        line = lines[i]
        # 只统计真正的标签出现，避免属性值或文案里的尖括号干扰
        opens = line.count('<view')
        closes = line.count('</view>')
        depth += opens - closes
        if depth <= 0:
            return i
    return -1


def main():
    total_removed = 0
    for p in PAGES:
        path = os.path.join(ROOT, 'pages', p, p + '.wxml')
        with io.open(path, 'r', encoding='utf-8') as f:
            lines = f.read().split('\n')

        title_idx = -1
        for i, l in enumerate(lines):
            if TITLE_KEY in l and 'block-title' in l:
                title_idx = i
                break
        if title_idx < 0:
            print('[SKIP] %s.wxml 未找到网络图库 block-title' % p)
            continue

        start = find_block_start(lines, title_idx)
        if start < 0:
            print('[FAIL] %s.wxml 找不到 block 起始标签' % p)
            return 1
        end = find_block_end(lines, start)
        if end < 0:
            print('[FAIL] %s.wxml block 未闭合' % p)
            return 1

        removed = end - start + 1
        # 连同 block 后面紧跟的空行一起删，避免留三连空行
        tail = end + 1
        while tail < len(lines) and lines[tail].strip() == '':
            tail += 1
        removed = tail - start

        sample = [l.strip() for l in lines[start:start + 2]]
        del lines[start:tail]
        with io.open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        total_removed += removed
        print('[OK] %-8s 删除 L%d-L%d（%d 行）起始: %s' % (p, start + 1, end + 1, removed, sample[1][:40]))

    print('\n共删除 %d 行' % total_removed)
    return 0


if __name__ == '__main__':
    sys.exit(main())
