# -*- coding: utf-8 -*-
"""道具封面图生成器：为 MP 后台「道具管理」画 4 张道具图。

后台要求：PNG/JPG，尺寸 200x200，小于 200KB。
做法：600x600 画布绘制 → LANCZOS 缩到 200x200 输出（扁平图缩小后依然锐利）。

用法：python tools/make_prop_icons.py
输出：images/props/{points_200,points_800,points_2500,comic_full,comic_pdf,comic_web}.png（200x200 PNG）

设计：扁平插画风、暖色调贴 app 治愈系气质。只画「数量标签」不画价格
（价格改档不必重画图； productId 数字后缀=到账积分数 已由 constants_sync 断言锁死）。
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images", "props")
os.makedirs(OUT, exist_ok=True)

S = 600  # 画布边长
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msyh.ttc"


def font(path, size):
    return ImageFont.truetype(path, size)


def rounded(draw, box, r, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def coin(draw, cx, cy, r, body, rim, glyph_col, glyph="¥", glyph_size=None):
    """一枚金币：外圈暗一档、内芯亮色、中央 ¥。"""
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rim)
    r2 = r - max(3, r // 10)
    draw.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=body)
    f = font(FONT_BOLD, glyph_size or int(r * 1.05))
    bb = draw.textbbox((0, 0), glyph, font=f)
    draw.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]), glyph,
              font=f, fill=glyph_col)


def sparkle(draw, cx, cy, r, col):
    """四角星点缀。"""
    draw.polygon([(cx, cy - r), (cx + r * .3, cy - r * .3), (cx + r, cy),
                  (cx + r * .3, cy + r * .3), (cx, cy + r), (cx - r * .3, cy + r * .3),
                  (cx - r, cy), (cx - r * .3, cy - r * .3)], fill=col)


def vgrad(size, top, bottom):
    """垂直渐变底图（带圆角遮罩）。"""
    w, h = size
    base = Image.new("RGB", size, top)
    px = base.load()
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=72, fill=255)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def label(img, text, y, col, size=86, small=None):
    d = ImageDraw.Draw(img)
    f = font(FONT_BOLD, size)
    bb = d.textbbox((0, 0), text, font=f)
    d.text(((S - (bb[2] - bb[0])) / 2 - bb[0], y), text, font=f, fill=col)
    if small:
        f2 = font(FONT_REG, 34)
        bb2 = d.textbbox((0, 0), small, font=f2)
        d.text(((S - (bb2[2] - bb2[0])) / 2 - bb2[0], y + size + 14), small,
               font=f2, fill=col + (190,) if len(col) == 3 else col)
    return img


def soft_shadow_circle(img, cx, cy, r, col=(0, 0, 0, 28)):
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - r, cy - r + 26, cx + r, cy + r + 26], fill=col)
    img.alpha_composite(sh)


# ── 1) points_200：两枚金币 + 一枚小币 ─────────────────────────
def points_200():
    img = vgrad((S, S), (255, 247, 226), (255, 231, 189))
    d = ImageDraw.Draw(img)
    soft_shadow_circle(img, S // 2, 300, 150)
    coin(d, 250, 265, 108, (255, 202, 84), (232, 165, 47), (146, 94, 12))
    coin(d, 372, 320, 84, (255, 214, 110), (232, 165, 47), (146, 94, 12))
    sparkle(d, 150, 160, 18, (255, 187, 92))
    sparkle(d, 460, 150, 14, (255, 187, 92))
    sparkle(d, 470, 420, 12, (250, 200, 120))
    label(img, "200积分", 430, (122, 82, 20))
    return img


# ── 2) points_800：钱袋 + 金币堆 ───────────────────────────────
def points_800():
    img = vgrad((S, S), (255, 240, 224), (255, 214, 178))
    d = ImageDraw.Draw(img)
    soft_shadow_circle(img, S // 2, 320, 165)
    # 圆润束口袋：大圆袋身 + 收口绳结
    rounded(d, [192, 238, 408, 428], 92, fill=(255, 244, 227), outline=(214, 158, 96), width=8)
    d.ellipse([268, 192, 332, 246], fill=(255, 244, 227), outline=(214, 158, 96), width=8)  # 袋颈
    d.rectangle([256, 218, 344, 248], fill=(214, 158, 96))  # 绳结扎口
    coin(d, 300, 330, 52, (255, 202, 84), (232, 165, 47), (146, 94, 12))  # 袋身大币
    # 袋边洒落金币
    coin(d, 168, 392, 40, (255, 214, 110), (232, 165, 47), (146, 94, 12))
    coin(d, 432, 392, 40, (255, 214, 110), (232, 165, 47), (146, 94, 12))
    sparkle(d, 452, 170, 18, (255, 176, 88))
    sparkle(d, 140, 200, 13, (255, 176, 88))
    label(img, "800积分", 442, (140, 84, 24))
    return img


# ── 3) points_2500：宝箱 + 金币喷涌 ────────────────────────────
def points_2500():
    img = vgrad((S, S), (255, 244, 205), (255, 216, 138))
    d = ImageDraw.Draw(img)
    soft_shadow_circle(img, S // 2, 350, 170)
    # 宝箱箱体
    rounded(d, [178, 300, 422, 428], 28, fill=(188, 124, 66), outline=(142, 88, 40), width=8)
    rounded(d, [170, 252, 430, 316], 30, fill=(214, 150, 84), outline=(142, 88, 40), width=8)
    rounded(d, [278, 296, 322, 352], 12, fill=(255, 214, 110), outline=(142, 88, 40), width=6)
    # 喷出的金币
    for i, (cx, cy, r) in enumerate([(236, 232, 46), (304, 206, 54), (372, 236, 44)]):
        coin(d, cx, cy, r, (255, 206, 92), (232, 165, 47), (146, 94, 12))
    sparkle(d, 150, 170, 20, (255, 190, 74))
    sparkle(d, 452, 158, 15, (255, 190, 74))
    sparkle(d, 462, 250, 12, (255, 205, 110))
    label(img, "2500积分", 448, (128, 82, 16))
    return img


# ── 4) comic_full：摊开的漫画本 + 四格画格 ─────────────────────
def comic_full():
    img = vgrad((S, S), (238, 241, 255), (222, 228, 252))
    d = ImageDraw.Draw(img)
    soft_shadow_circle(img, S // 2, 310, 168)
    # 书本两页
    rounded(d, [128, 176, 302, 408], 20, fill=(255, 255, 255), outline=(150, 158, 214), width=8)
    rounded(d, [298, 176, 472, 408], 20, fill=(255, 253, 246), outline=(150, 158, 214), width=8)
    d.rectangle([296, 176, 304, 408], fill=(190, 196, 238))  # 书脊
    # 左页：两格漫画（山+太阳 / 猫）
    rounded(d, [152, 204, 278, 288], 12, fill=(255, 226, 214))
    d.ellipse([246, 216, 270, 240], fill=(255, 179, 92))
    d.polygon([(158, 284), (206, 232), (250, 284)], fill=(154, 190, 168))
    rounded(d, [152, 306, 278, 384], 12, fill=(226, 238, 255))
    d.ellipse([166, 318, 226, 372], fill=(126, 132, 190))  # 猫头
    d.polygon([(166, 322), (180, 302), (188, 322)], fill=(126, 132, 190))
    d.polygon([(206, 322), (220, 302), (228, 322)], fill=(126, 132, 190))
    # 右页：两格漫画（对话气泡 / 星空）
    rounded(d, [322, 204, 448, 288], 12, fill=(255, 244, 214))
    rounded(d, [340, 224, 418, 262], 16, fill=(255, 255, 255), outline=(214, 176, 106), width=5)
    d.polygon([(356, 258), (352, 276), (372, 260)], fill=(255, 255, 255))
    rounded(d, [322, 306, 448, 384], 12, fill=(58, 62, 118))
    for sx, sy, r in [(348, 324, 9), (384, 342, 7), (424, 326, 8), (366, 362, 6), (408, 364, 9)]:
        d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=(255, 224, 130))
    sparkle(d, 130, 150, 16, (176, 184, 238))
    sparkle(d, 470, 156, 13, (176, 184, 238))
    label(img, "整本解锁", 436, (74, 82, 150))
    return img


# ── 5) comic_pdf：PDF 文档 + 漫画格 + PDF 角标 ──────────────────
def comic_pdf():
    img = vgrad((S, S), (255, 246, 222), (255, 220, 176))
    d = ImageDraw.Draw(img)
    soft_shadow_circle(img, S // 2, 312, 168)
    # 文档页
    rounded(d, [150, 168, 450, 430], 22, fill=(255, 255, 255), outline=(206, 170, 120), width=8)
    d.polygon([(398, 168), (450, 168), (450, 220)], fill=(240, 226, 196))  # 折角
    # 文档内：漫画格 + 三行文字
    rounded(d, [178, 196, 422, 300], 14, fill=(255, 232, 214))
    d.ellipse([350, 210, 404, 264], fill=(255, 179, 92))
    d.polygon([(186, 296), (250, 226), (300, 296)], fill=(150, 190, 166))
    d.rounded_rectangle([186, 322, 414, 338], radius=6, fill=(222, 214, 200))
    d.rounded_rectangle([186, 350, 386, 366], radius=6, fill=(222, 214, 200))
    d.rounded_rectangle([186, 378, 360, 394], radius=6, fill=(222, 214, 200))
    # PDF 角标（红橙 pill，贴在右上）
    rounded(d, [360, 150, 462, 200], 22, fill=(229, 92, 72))
    fpdf = font(FONT_BOLD, 52)
    t = "PDF"
    bb = d.textbbox((0, 0), t, font=fpdf)
    d.text(((411 - (bb[2] - bb[0]) / 2 - bb[0]), 161), t, font=fpdf, fill=(255, 255, 255))
    sparkle(d, 132, 150, 16, (255, 180, 92))
    sparkle(d, 470, 255, 13, (255, 180, 92))
    label(img, "PDF版", 442, (150, 92, 30))
    return img


# ── 6) comic_web：浏览器窗口 + 漫画格 ───────────────────────────
def comic_web():
    img = vgrad((S, S), (224, 244, 238), (188, 224, 214))
    d = ImageDraw.Draw(img)
    soft_shadow_circle(img, S // 2, 312, 168)
    # 浏览器外框
    rounded(d, [128, 158, 472, 430], 24, fill=(255, 255, 255), outline=(150, 190, 178), width=8)
    # 内嵌标题栏
    rounded(d, [136, 166, 464, 206], 18, fill=(232, 246, 242))
    for cx in [170, 196, 222]:
        d.ellipse([cx - 9, 179 - 9, cx + 9, 179 + 9], fill=(150, 190, 178))
    d.rounded_rectangle([258, 174, 446, 198], radius=10, fill=(210, 234, 228),
                        outline=(150, 190, 178), width=4)
    # 内容区：漫画格 + 两行文字
    rounded(d, [156, 228, 444, 326], 14, fill=(255, 232, 214))
    d.ellipse([406, 240, 432, 266], fill=(255, 179, 92))
    d.polygon([(162, 322), (220, 258), (270, 322)], fill=(150, 190, 166))
    d.rounded_rectangle([156, 348, 444, 364], radius=6, fill=(214, 226, 222))
    d.rounded_rectangle([156, 376, 408, 392], radius=6, fill=(214, 226, 222))
    sparkle(d, 132, 150, 16, (150, 200, 184))
    sparkle(d, 470, 255, 13, (150, 200, 184))
    label(img, "网页版", 442, (40, 110, 96))
    return img


if __name__ == "__main__":
    def save_200(img, path):
        """600 画布 → 200x200 输出（后台硬性尺寸）。"""
        img.resize((200, 200), Image.LANCZOS).save(path, optimize=True)

    for im, name in [(points_200(), "points_200"), (points_800(), "points_800"),
                     (points_2500(), "points_2500"), (comic_full(), "comic_full"),
                     (comic_pdf(), "comic_pdf"), (comic_web(), "comic_web")]:
        save_200(im, os.path.join(OUT, name + ".png"))
    for fn in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, fn)
        with Image.open(p) as im:
            print(fn, im.size, os.path.getsize(p), "bytes")
