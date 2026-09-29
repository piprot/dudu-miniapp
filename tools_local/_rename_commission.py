# -*- coding: utf-8 -*-
"""
「定制连环画」→「画面感内容」改名下游同步（产品已改名，落地页/券名/分享标题必须跟上）。
原则：
  ① 只改**产品交付物名称**，不动 productId / priceFen / 集合名 / 字段名（否则后台道具与库失配）。
  ② 刻意保留「画师」「人工交付」等**真人履约**表述 —— 对深度合成合规有利，不得删。
  ③ 阅读包产品《美汐的故事》"整本连环画" 属另一个产品，本脚本不碰。
每处替换断言命中次数，任一处不匹配即整体失败（不写盘）。
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EDITS = [
    # ══ 1. commission 落地页（被改名产品的页面）══
    ('pages/commission/commission.json',
     '"navigationBarTitleText": "生成我的连环画"',
     '"navigationBarTitleText": "画面感内容定制"', 1),

    ('pages/commission/commission.wxml',
     '<view class="hero-title">定制我的连环画 🎨</view>',
     '<view class="hero-title">定制画面感内容 🎨</view>', 1),

    ('pages/commission/commission.wxml',
     '你写的故事，我们画成完整连环画，',
     '你写的故事，我们做成完整画面感内容，', 1),

    ('pages/commission/commission.wxml',
     '留下你的邮箱，连环画完成后直接回邮给你',
     '留下你的邮箱，完成后直接回邮给你', 1),

    ('pages/commission/commission.wxml',
     '写下你想做成连环画的故事正文；',
     '写下你想做成画面感内容的故事正文；', 1),

    # 「生成」→「交付」：交付是人工的，用词必须与真人履约一致
    ('pages/commission/commission.wxml',
     '微信安全支付 · 生成后{{deliveryHours}}小时内回邮到你填写的邮箱',
     '微信安全支付 · 完成 {{deliveryHours}} 小时内回邮到你填写的邮箱', 1),

    ('pages/commission/commission.wxml',
     '<text class="hl">{{deliveryHours}} 小时内</text>生成，并回邮到你的邮箱',
     '<text class="hl">{{deliveryHours}} 小时内</text>完成，并回邮到你的邮箱', 1),

    ('pages/commission/commission.js',
     "'请写下你想做成连环画的故事或要点，画师才能开工'",
     "'请写下你想做成画面感内容的故事或要点，画师才能开工'", 1),

    ('pages/commission/commission.js',
     "title: '定制你的专属连环画 · dudu 画面感'",
     "title: '定制你的画面感内容 · dudu 画面感'", 2),

    # ══ 2. 券名（用户可见：积分页兑换目录 + 落库 label + 运营推送）══
    ('utils/config.js',
     "itemName: '定制连环画',",
     "itemName: '定制画面感内容',", 1),

    ('utils/config.js',
     "name: '连环画生成 9 折券', desc: '付费生成连环画时抵扣 10%'",
     "name: '画面感内容 9 折券', desc: '付费定制画面感内容时抵扣 10%'", 1),

    ('cloudfunctions/custom_request/index.js',
     "const COUPON_TYPES = { comic_discount: '连环画 9 折券' };",
     "const COUPON_TYPES = { comic_discount: '画面感内容 9 折券' };", 1),

    ('test/test_custom_request.js',
     "assert.strictEqual(doc.coupon.label, '连环画 9 折券', '应带上可读名称供运营识别');",
     "assert.strictEqual(doc.coupon.label, '画面感内容 9 折券', '应带上可读名称供运营识别');", 1),

    ('test/test_custom_request.js',
     "assert.ok(txt.indexOf('连环画 9 折券') >= 0, '推送里要出现券名');",
     "assert.ok(txt.indexOf('画面感内容 9 折券') >= 0, '推送里要出现券名');", 1),

    # 积分页券引导弹窗（用户可见）+ 内部注释
    ('pages/points/points.js',
     "'在「定制连环画」下单时，这张 9 折券会随订单一起提交，客服按券减免相应差价。现在去下单看看？'",
     "'在「画面感内容定制」下单时，这张 9 折券会随订单一起提交，客服按券减免相应差价。现在去下单看看？'", 1),

    ('pages/points/points.js',
     '// 用户看不懂。这里用 config.POINTS.redeem 目录映射回「连环画生成 9 折券」。',
     '// 用户看不懂。这里用 config.POINTS.redeem 目录映射回「画面感内容 9 折券」。', 1),
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
        print('[OK ] %-38s ×%d' % (rel, cnt))

    for p, s in cache.items():
        write(p, s)

    print('\n共替换 %d 处，已写入 %d 个文件。' % (total, len(cache)))


if __name__ == '__main__':
    main()
