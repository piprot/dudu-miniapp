# -*- coding: utf-8 -*-
"""
剥离面向用户的「AI」字样（文案层体检 A 组收尾）。
原则：只删「AI」这两个字，语义与能力描述一字不动。
每处替换都断言命中次数，任何一处不匹配即整体失败退出（不写盘）。
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (相对路径, 旧串, 新串, 期望命中次数)
EDITS = [
    # ── gen.js ──
    ('pages/gen/gen.js',
     '// 每个类型的「结构暗示」：在已选横幅下提示 AI 会怎么写（与 BUILD / 云函数结构 cue 一致）',
     '// 每个类型的「结构暗示」：在已选横幅下提示会怎么写（与 BUILD / 云函数结构 cue 一致）', 1),

    ('pages/gen/gen.js',
     "struct: 'AI 读取文章正文 → 按「'",
     "struct: '读取文章正文 → 按「'", 2),          # 252 行 onSelectUrl + 265 行 onSelectTone

    ('pages/gen/gen.js',
     "'🔗 已选「粘贴文章链接」：AI 会先读取文章正文，再按上面选的调性写 3 条。长度跟随文章，绝不编造。'",
     "'🔗 已选「粘贴文章链接」：会先读取文章正文，再按上面选的调性写 3 条。长度跟随文章，绝不编造。'", 1),

    ('pages/gen/gen.js',
     "title: '用 AI 写能直接发的朋友圈文案 · dudu 画面感'",
     "title: '一键写出能直接发的朋友圈文案 · dudu 画面感'", 2),   # onShareAppMessage + onShareTimeline

    # ── gen.wxml ──
    ('pages/gen/gen.wxml', 'AI 读文章代写', '贴文章代写', 1),
    ('pages/gen/gen.wxml', '，AI 帮你写', '，帮你写', 1),

    # ── index.wxml ──
    ('pages/index/index.wxml', '配张图，AI 立刻帮你写成', '配张图，立刻帮你写成', 1),
]


def read(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def main():
    # 1) 先全量校验
    cache = {}
    for rel, old, new, cnt in EDITS:
        p = os.path.join(ROOT, rel)
        if p not in cache:
            cache[p] = read(p)
        got = cache[p].count(old)
        if got != cnt:
            print('[FAIL] %s\n       期望命中 %d 次，实际 %d 次\n       串: %r' % (rel, cnt, got, old))
            sys.exit(1)

    # 2) 再统一落盘
    total = 0
    for rel, old, new, cnt in EDITS:
        p = os.path.join(ROOT, rel)
        s = cache[p]
        s = s.replace(old, new)
        cache[p] = s
        total += cnt
        print('[OK ] %-26s ×%d  %r' % (rel, cnt, old[:34]))

    for p, s in cache.items():
        write(p, s)

    print('\n共替换 %d 处，已写入 %d 个文件。' % (total, len(cache)))


if __name__ == '__main__':
    main()
