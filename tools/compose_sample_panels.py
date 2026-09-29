# -*- coding: utf-8 -*-
"""把用户手工组装的单文件 HTML 画面感内容，逐 panel 重绘成「带字」的成品画格。

为什么：个人主体小程序不能用 web-view，端内示例必须原生渲染。但原 HTML 里
文字（旁白 .narration-bar / 对白心声 .bubble / 音效 .sfx）是叠在 <img> 画格上的
独立 DOM 层，只抽 <img> 会丢「字」——不成画面感内容。本脚本按 HTML 的 CSS 把
每个 .panel = 方形画格(object-fit:cover) + 下方旁白条 + 右上气泡 + 音效字
用 PIL 重绘合成，保证每张成品画格都有字、排版贴近原设计。

输出：packageSample/sample_panels/p01..pNN.jpg（限宽 ART、质量可调，控制在 2MB 分包内）。
依赖：Pillow + 系统微软雅黑字体。
"""
import os
import re
import base64
import io
from html.parser import HTMLParser
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "samples", "画面感内容_精简版_单文件.html")
OUT_DIR = os.path.join(ROOT, "packageSample", "sample_panels")

ART = 480          # 方形画格边长(px) —— 540+ 会让 JPEG 分包超 2MB
QUALITY = 62       # JPEG 质量（**不是 webp**：真机 webp 不可用，见 tools/webp_to_jpg.py）
MSYH = r"C:\Windows\Fonts\msyh.ttc"
MSYH_BD = r"C:\Windows\Fonts\msyhbd.ttc"

C_INK = (58, 48, 37)        # #3a3025
C_NAR_BG = (253, 248, 243)  # #fdf8f3
C_NAR_LINE = (232, 213, 196)# #e8d5c4
C_THOUGHT = (160, 128, 96)  # #a08060
C_SFX = (192, 57, 43)       # #c0392b

VOID = {"img", "br", "meta", "hr", "input", "link", "area", "base", "col", "embed", "source", "track", "wbr"}


class PanelParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.panels = []
        self.stack = []
        self.panel = None
        self.capture = None
        self.bubble = None
        self.sfx = None

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        cls = set(d.get("class", "").split())
        if tag in VOID:
            if self.panel is not None and tag == "img" and "src" in d:
                s = d["src"]
                if s.startswith("data:image"):
                    self.panel["img"] = s
            return
        node = {"tag": tag, "cls": cls, "is_panel": False}
        # 以 .panel-cell 为分组单元：cell = .panel(画格+气泡叠层) + .narration-bar(旁白，兄弟节点)
        if tag == "div" and "panel-cell" in cls and self.panel is None:
            self.panel = {"img": None, "narration": None, "bubbles": [], "sfxs": []}
            self.capture = None
            node["is_panel"] = True
        elif self.panel is not None:
            if tag == "div" and "narration-bar" in cls:
                self.capture = "narration"
            elif tag == "div" and "bubble" in cls:
                self.bubble = {"cls": cls, "text": ""}
                self.capture = "bubble"
            elif tag == "div" and "sfx" in cls:
                self.sfx = {"cls": cls, "text": ""}
                self.capture = "sfx"
        self.stack.append(node)

    def handle_data(self, data):
        if self.panel is None:
            return
        t = data.strip()
        if not t:
            return
        if self.capture == "narration":
            self.panel["narration"] = (self.panel["narration"] or "") + t
        elif self.capture == "bubble" and self.bubble is not None:
            self.bubble["text"] += t
        elif self.capture == "sfx" and self.sfx is not None:
            self.sfx["text"] += t

    def handle_endtag(self, tag):
        if not self.stack:
            return
        node = self.stack[-1]
        if self.panel is not None and tag == "div":
            if self.capture == "bubble" and self.bubble is not None:
                self.panel["bubbles"].append(self.bubble)
                self.bubble = None
                self.capture = None
            elif self.capture == "sfx" and self.sfx is not None:
                self.panel["sfxs"].append(self.sfx)
                self.sfx = None
                self.capture = None
            elif self.capture == "narration":
                self.capture = None
            if node.get("is_panel"):
                self.panels.append(self.panel)
                self.panel = None
        self.stack.pop()


def wrap_text(draw, text, font, max_w):
    lines = []
    line = ""
    for ch in text:
        if ch == "\n":
            lines.append(line)
            line = ""
            continue
        test = line + ch
        if draw.textlength(test, font=font) <= max_w:
            line = test
        else:
            lines.append(line)
            line = ch
    if line:
        lines.append(line)
    return lines


def compose(panel, f_reg, f_bub, f_sfx):
    # ---- 画格(方形 cover) ----
    raw = base64.b64decode(re.sub(r"^data:image/[a-z]+;base64,", "", panel["img"]))
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
    im = im.resize((ART, ART), Image.LANCZOS)

    canvas = Image.new("RGB", (ART, ART), (255, 255, 255))
    canvas.paste(im, (0, 0))
    d = ImageDraw.Draw(canvas)

    # ---- 气泡(叠在画格右上) ----
    for b in panel["bubbles"]:
        txt = b["text"].strip()
        if not txt:
            continue
        is_thought = "thought" in b["cls"]
        pos = "tr"
        for c in b["cls"]:
            if c.startswith("pos-"):
                pos = c[4:]
        maxw = int(ART * 0.58)
        lines = wrap_text(d, txt, f_bub, maxw)
        pad_x, pad_y = 12, 10
        lh = f_bub.size + 4
        bw = max(d.textlength(ln, font=f_bub) for ln in lines) + pad_x * 2
        bh = len(lines) * lh + pad_y * 2
        m = 8
        if pos == "tr":
            bx, by = ART - m - bw, m
        elif pos == "tl":
            bx, by = m, m
        elif pos == "br":
            bx, by = ART - m - bw, ART - m - bh
        else:
            bx, by = m, ART - m - bh
        bx, by = max(2, bx), max(2, by)
        fill = (255, 255, 255, 242) if not is_thought else (253, 248, 243, 242)
        outline = C_INK if not is_thought else C_THOUGHT
        rad = 12 if not is_thought else 16
        # 画气泡(用 RGBA 临时层以支持半透明)
        layer = Image.new("RGBA", (ART, ART), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.rounded_rectangle([bx, by, bx + bw, by + bh], radius=rad, fill=fill, outline=outline, width=2)
        ty = by + pad_y
        for ln in lines:
            ld.text((bx + pad_x, ty), ln, font=f_bub, fill=C_INK)
            ty += lh
        canvas.paste(layer, (0, 0), layer)
        d = ImageDraw.Draw(canvas)

    # ---- 音效字(红粗斜体，叠在画格) ----
    for s in panel["sfxs"]:
        txt = s["text"].strip()
        if not txt:
            continue
        pos = "tr"
        for c in s["cls"]:
            if c.startswith("pos-"):
                pos = c[4:]
        tw = int(d.textlength(txt, font=f_sfx))
        th = f_sfx.size + 4
        sl = Image.new("RGBA", (tw + 8, th + 8), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sl)
        sd.text((4, 4), txt, font=f_sfx, fill=C_SFX)
        sl = sl.rotate(-5, expand=True, fillcolor=(0, 0, 0, 0))
        m = 10
        if pos in ("tr", "br"):
            sx = ART - sl.width - m
        else:
            sx = m
        sy = m if pos in ("tr", "tl") else ART - sl.height - m
        canvas.paste(sl, (max(2, sx), max(2, sy)), sl)
        d = ImageDraw.Draw(canvas)

    # ---- 旁白条(画格下方) ----
    nar = (panel["narration"] or "").strip()
    bar_bg = Image.new("RGB", (ART, 400), C_NAR_BG)
    bd = ImageDraw.Draw(bar_bg)
    bar_h = 36
    if nar:
        lines = wrap_text(bd, nar, f_reg, ART - 24)
        lh = f_reg.size + 6
        bar_h = max(36, len(lines) * lh + 16)
        y = 8
        for ln in lines:
            bd.text((12, y), ln, font=f_reg, fill=C_INK)
            y += lh
    bd.line([(0, 0), (ART, 0)], fill=C_NAR_LINE, width=2)

    full = Image.new("RGB", (ART, ART + bar_h), (255, 255, 255))
    full.paste(canvas, (0, 0))
    full.paste(bar_bg.crop((0, 0, ART, bar_h)), (0, ART))
    # 整体细边框(画面感内容格感)
    ImageDraw.Draw(full).rectangle([0, 0, ART - 1, ART + bar_h - 1], outline=C_INK, width=2)
    return full


def main():
    f_reg = ImageFont.truetype(MSYH, 15)
    f_bub = ImageFont.truetype(MSYH, 16)
    f_sfx = ImageFont.truetype(MSYH_BD, 22)

    html = open(SRC, encoding="utf-8", errors="replace").read()
    p = PanelParser()
    p.feed(html)
    panels = p.panels
    if not panels:
        raise SystemExit("未解析到任何 .panel")

    os.makedirs(OUT_DIR, exist_ok=True)
    # 清掉旧文件
    for fn in os.listdir(OUT_DIR):
        if fn.endswith(".jpg"):
            os.remove(os.path.join(OUT_DIR, fn))

    total = 0
    for i, pn in enumerate(panels, 1):
        img = compose(pn, f_reg, f_bub, f_sfx)
        out = os.path.join(OUT_DIR, "p%02d.jpg" % i)
        img.save(out, "JPEG", quality=QUALITY, optimize=True)   # 基线 JPEG，勿改回 webp（真机不支持）
        total += os.path.getsize(out)

    print("panels:", len(panels), "->", os.path.relpath(OUT_DIR, ROOT), "(%d KB)" % (total // 1024))


if __name__ == "__main__":
    main()
