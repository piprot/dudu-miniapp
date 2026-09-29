#!/usr/bin/env python3
# 生成虚拟支付道具占位图（MP 后台「虚拟支付 → 道具配置」上传用）
# 规格：PNG/JPG、200x200、<200KB。图上写「产品名 + 现价」，避免后台看板与代码价对不上。
# 2026-09-23：两档改名 —— PDF 版 → 画面感内容PDF、网页版 → 画面感内容HTML，故重出版。
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'comic_props')
os.makedirs(OUT, exist_ok=True)

SIZE = 200

# 优先用系统里存在的中文字体；找不到就退而求其次用默认字体（英文/数字仍可见）
_FONT_CANDIDATES = [
    r'C:\Windows\Fonts\msyh.ttc',     # 微软雅黑
    r'C:\Windows\Fonts\simhei.ttf',   # 黑体
    r'C:\Windows\Fonts\simsun.ttc',    # 宋体
]


def load_font(px):
    for p in _FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, px)
            except Exception:
                pass
    return ImageFont.load_default()


def gen(kicker, name_en, name_px, price_text, file_name):
    """kicker=中文前缀；name_en=PDF/HTML；name_px=该行字号（HTML 更长所以要小一号）。"""
    img = Image.new('RGB', (SIZE, SIZE), (255, 255, 255))
    d = ImageDraw.Draw(img)
    # 暖橙渐变背景
    top = (255, 244, 230)
    bot = (255, 214, 170)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        d.line([(0, y), (SIZE, y)], fill=(r, g, b))
    # 圆角卡片边界
    d.rectangle([6, 6, SIZE - 7, SIZE - 7], outline=(214, 140, 70), width=3)
    mid = load_font(22)
    big = load_font(name_px)
    price = load_font(34)
    d.text((SIZE // 2, 48), kicker, font=mid, fill=(120, 80, 40), anchor='mm')
    d.text((SIZE // 2, 94), name_en, font=big, fill=(90, 50, 20), anchor='mm')
    d.text((SIZE // 2, 146), price_text, font=price, fill=(200, 70, 20), anchor='mm')
    path = os.path.join(OUT, file_name)
    img.save(path, 'PNG')
    print('wrote', path, os.path.getsize(path), 'bytes')


gen('画面感内容', 'PDF', 44, '¥66', 'comic_pdf.png')
gen('画面感内容', 'HTML', 34, '¥88', 'comic_web.png')
