# -*- coding: utf-8 -*-
"""从用户手工组装的单文件 HTML 示例里抽取画格，落为小程序可读的 JPEG。

⚠️ 本脚本只抽 <img>、**会丢文字**（旁白/对白/音效是独立 DOM 层），产物「只有画没有字」。
   要「带字」的成品画格请用 tools/compose_sample_panels.py，它以 .panel-cell 为单位
   PIL 重绘合成。本脚本仅作无字变体的备用通道。

为什么：个人主体小程序不能用 web-view，端内「示例」必须用原生 <image> 渲染。
这份 HTML（samples/画面感内容_精简版_单文件.html）里的 54 张画格是 base64 内联的，
抽出来转成统一 JPEG（限宽 480、质量 62）放进独立分包 packageSample/sample_panels/，
供 packageSample/pages/sample 原生阅读页纵向展示——视觉等同网页版，零域名零 web-view。
独立分包是为了把示例画格（~1.6MB）与 reader 产品画格（1.6MB）各自控制在 2MB 上限内。

⚡ 格式必须是 JPEG/PNG，**不能用 webp**：小程序 <image> 的 webp 在真机上整片空白
   （开发者工具用 webview 渲染所以本地看不出）。详见 tools/webp_to_jpg.py 顶部。

用法：python tools/extract_sample_panels.py
依赖：Pillow
"""
import os
import re
import base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "samples", "画面感内容_精简版_单文件.html")
OUT_DIR = os.path.join(ROOT, "packageSample", "sample_panels")
MAX_W = 480        # 600 会让 JPEG 分包超 2MB
QUALITY = 62


def main():
    import io
    from PIL import Image

    os.makedirs(OUT_DIR, exist_ok=True)
    html = open(SRC, encoding="utf-8", errors="replace").read()

    # 按文档顺序抓所有 <img src="data:image/...;base64,...">
    pat = re.compile(r'<img\b[^>]*\bsrc="(data:image/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=]+))"',
                     re.I)
    hits = pat.findall(html)
    if not hits:
        raise SystemExit("未在 HTML 中找到内联画格")

    total = 0
    for i, (_, b64) in enumerate(hits, 1):
        raw = base64.b64decode(b64)
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        if im.width > MAX_W:
            h = round(im.height * MAX_W / im.width)
            im = im.resize((MAX_W, h), Image.LANCZOS)
        out = os.path.join(OUT_DIR, "p%02d.jpg" % i)
        im.save(out, "JPEG", quality=QUALITY, optimize=True)   # 基线 JPEG，勿改回 webp（真机不支持）
        total += os.path.getsize(out)

    print("panels:", len(hits), "->", os.path.relpath(OUT_DIR, ROOT),
          "(%d KB)" % (total // 1024))


if __name__ == "__main__":
    main()
