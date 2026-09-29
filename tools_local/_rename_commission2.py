# -*- coding: utf-8 -*-
"""
收尾：把仍指向「定制产品」的剩余「连环画」表述改为「画面感内容」。
保留：阅读包产品《美汐的故事》与成品示例的「连环画」称呼（属另一产品，待用户拍板）。
每处替换断言命中次数，任一处不匹配即整体失败（不写盘）。
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EDITS = [
    # ① 朋友圈文案页：「我的故事」类型说明（用户可见，指的正是定制产品）
    ('pages/gen/gen.js',
     "desc: '往事 / 小说 / 随笔，可做成连环画'",
     "desc: '往事 / 小说 / 随笔，可做成画面感内容'", 1),

    # ② ai_gen 用户可见报错（非 moments 模式被拒时返回）
    ('cloudfunctions/ai_gen/index.js',
     "err: '不支持的 mode: ' + rawMode + '（本应用只提供朋友圈文案生成；连环画请走「付费定制」入口）'",
     "err: '不支持的 mode: ' + rawMode + '（本应用只提供朋友圈文案服务；画面感内容请走「付费定制」入口）'", 1),

    # ③ 元信息 / 注释
    ('cloudfunctions/custom_request/package.json',
     '"description": "付费定制连环画需求收集（邮箱+故事落库，人工 8 小时履约）"',
     '"description": "付费定制画面感内容需求收集（邮箱+故事落库，人工 8 小时履约）"', 1),

    ('project.config.json',
     '"description": "故事连环画小程序（原生渲染 + 付费门禁）"',
     '"description": "dudu 画面感内容小程序（原生渲染 + 付费门禁）"', 1),

    ('pages/gen/gen.wxss',
     '/* ── 「我的故事」专属：选中文案 → 做成连环画 ── */',
     '/* ── 「我的故事」专属：选中文案 → 做成画面感内容 ── */', 1),

    ('pages/gen/gen.wxss',
     '/* 定制连环画入口卡 */',
     '/* 定制画面感内容入口卡 */', 1),
]


def read(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def main():
    cache = {}
    for rel, old, new, cnt in EDITS:
        p = os.path.join(ROOT, rel)
        if p not in cache:
            cache[p] = read(p)
        got = cache[p].count(old)
        if got != cnt:
            print('[FAIL] %s\n       期望命中 %d 次，实际 %d 次\n       串: %r' % (rel, cnt, got, old))
            sys.exit(1)

    total = 0
    for rel, old, new, cnt in EDITS:
        p = os.path.join(ROOT, rel)
        cache[p] = cache[p].replace(old, new)
        total += cnt
        print('[OK ] %-42s ×%d' % (rel, cnt))

    for p, s in cache.items():
        write(p, s)

    print('\n共替换 %d 处，已写入 %d 个文件。' % (total, len(cache)))


if __name__ == '__main__':
    main()
