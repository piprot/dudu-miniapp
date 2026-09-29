# -*- coding: utf-8 -*-
"""
清掉真正的「AI 字样」（用户 2026-09-23 指令）。

不动的三类：
  ❌ .md 文档 —— 历史决策记录 / 合规审计轨迹，且逐字引用用户原话；
     其中 MP_BACKEND_3ITEMS.md 的「隐私指引」正文还**必须**保留 AI 披露（法律义务）。
  ❌ samples/*.html —— 命中来自 base64 图片数据里的 "/AI+..." 片段，纯误报。
  ❌ `ai_gen` 标识符 —— 是**已部署的云函数名**，改名需重建函数 + 换调用点 + 控制台删旧函数，
     属独立决策，不在本次静默处理。

⚠️ ai_gen 的系统提示词是**功能性内容**（前缀缓存 prefix=true），本脚本改了两处用词，
   会一次性失效前缀缓存（下次调用重新建立，无功能影响）。
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EDITS = [
    # ── 云函数注释 / 元信息 ──
    ('cloudfunctions/ai_gen/index.js',
     '// 用户端 AI 内容云函数（路B-文字版 · 个人主体，低风险）',
     '// 用户端文案云函数（路B-文字版 · 个人主体，低风险）', 1),

    # ── 系统提示词（功能性：仅换用词，保留"别说套话"的原意）──
    ('cloudfunctions/ai_gen/index.js',
     '像深夜随手发的，不像稿、不像 AI。',
     '像深夜随手发的，不像稿、不像套话。', 1),

    ('cloudfunctions/ai_gen/index.js',
     '✗ 差（AI腔/空泛）',
     '✗ 差（机器腔/空泛）', 1),

    ('cloudfunctions/ai_gen/package.json',
     '"description": "用户端 AI 文本润色（豆包/火山方舟，路B-文字版）"',
     '"description": "用户端文本润色（豆包/火山方舟，路B-文字版）"', 1),

    ('cloudfunctions/points/index.js',
     '// 必须由 ai_gen 在「真实调通 AI」后由服务端记账，客户端无法伪造。',
     '// 必须由 ai_gen 在「真实调通模型」后由服务端记账，客户端无法伪造。', 1),

    # ── 前端配置注释 ──
    ('utils/config.js',
     '；app 内不做"用户文字→AI出图"。',
     '；app 内不做"用户文字→出图"。', 1),

    # ── 测试断言文案（失败时打印给开发者看）──
    ('test/test_constants_sync.js',
     '用户选了"某类型"，实际拿到"AI 自己猜"，',
     '用户选了"某类型"，实际拿到"自动判断"，', 1),

    ('test/test_constants_sync.js',
     '用户选了该类型却拿到"AI 自己猜"且无任何提示。请两处同改。',
     '用户选了该类型却拿到"自动判断"且无任何提示。请两处同改。', 1),

    # ── 本地开发脚本（不打包、不上传）──
    ('test_ark_polish.py',
     '「可直接交给画师或 AI 逐格绘制」',
     '「可直接交给画师逐格绘制」', 1),
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
        print('[OK ] %-34s ×%d  %s' % (rel, cnt, old[:30]))

    for p, s in cache.items():
        write(p, s)

    print('\n共替换 %d 处，已写入 %d 个文件。' % (total, len(cache)))


if __name__ == '__main__':
    main()
