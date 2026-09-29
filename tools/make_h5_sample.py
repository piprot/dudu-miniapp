# -*- coding: utf-8 -*-
"""把权威示例 HTML 抽成 H5 样板间资产（原画 JPEG + manifest.js）。

为什么需要本脚本：
  H5 样板间要「让客户看到成品长什么样」，就必须是**真实交付形态**的复刻。
  权威示例 samples/画面感内容_精简版_单文件.html（10.4MB，54 格内联 base64）里，
  画格是 1024×1024 纯画面，旁白/气泡/音效是叠在上面的**独立 DOM 层**。
  所以正确做法不是把字烧进图（会糊、且不可选），而是：
     原画抽成独立 JPEG 文件 + 文字抽成结构化数据 → H5 用 CSS 还原同样的排版。

  与既有工具的边界（勿混用）：
  - tools/extract_sample_panels.py  → 只抽 <img>，**丢字**（无字变体，备用）
  - tools/compose_sample_panels.py  → 用 PIL 把字**烧进**图，产物给小程序的
                                     原生 <image> 用（小程序不能 web-view）
  - 本脚本                          → 字图分离，产物给 H5（能跑 HTML/CSS 的场合）

输出：
  h5/assets/sample/aNN.jpg     免费试读分集的画格原画（640×640，q74）
  h5/assets/sample/manifest.js window.H5_SAMPLE = {...}（封面 + 分集 + 页 + 格 + 文字）

⚠️ h5/ 已在 project.config.json 的 packOptions.ignore 内，本脚本产物不会进小程序包。
用法：python tools/make_h5_sample.py
依赖：Pillow
"""
import os
import re
import io
import json
import base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "samples", "画面感内容_精简版_单文件.html")
OUT_DIR = os.path.join(ROOT, "h5", "assets", "sample")
MANIFEST = os.path.join(OUT_DIR, "manifest.js")

ART = 640          # 原画最长边（H5 无分包 2MB 限制，640 在 DPR2 手机上足够、且体积可控）
QUALITY = 74       # JPEG 质量
FREE_EPISODES = 2  # 免费试读的分集数（第一集、第二集整页展示；其余只留标题+锁）

# ── 结构标记（与 samples/画面感内容_精简版_单文件.html 的实际标记一致）──
RE_COVER = re.compile(
    r'<div class="cover">\s*<h1>(?P<title>.*?)</h1>\s*<div class="divider">\s*</div>'
    r'\s*<p class="subtitle">(?P<subtitle>.*?)</p>\s*<p class="author">(?P<author>.*?)</p>',
    re.S)
RE_MARK = re.compile(
    r'<div class="episode-title">\s*<span class="ep-num">(?P<num>.*?)</span>\s*'
    r'<h2>(?P<name>.*?)</h2>'
    r'|<div class="page-label">(?P<label>.*?)</div>'
    r'|<div class="grid-(?P<grid>2x2|2x3)">'
    r'|<div class="panel-cell">',
    re.S)
RE_IMG = re.compile(r'<img\b[^>]*\bsrc="data:image/[a-z]+;base64,(?P<b64>[A-Za-z0-9+/=]+)"'
                    r'(?:[^>]*\balt="(?P<alt>[^"]*)")?', re.I)
RE_NAR = re.compile(r'<div class="narration-bar">(?P<t>.*?)</div>', re.S)
RE_BUB = re.compile(r'<div class="(?P<cls>bubble[^"]*)"[^>]*>(?P<t>.*?)</div>', re.S)
RE_SFX = re.compile(r'<div class="(?P<cls>sfx[^"]*)"[^>]*>(?P<t>.*?)</div>', re.S)
RE_TAG = re.compile(r'<[^>]+>')


def clean(s):
    """去标签、压空白。"""
    return re.sub(r'\s+', ' ', RE_TAG.sub('', s or '')).strip()


def parse_panels(body):
    """按文档顺序切出每个 panel-cell 的原始片段（不含前导标记）。"""
    return re.split(r'<div class="panel-cell">', body)[1:]


def parse_structure(body):
    """按文档顺序解析出 episodes → pages → panel 序号列表。"""
    episodes, page, ep = [], None, None
    n = 0
    for m in RE_MARK.finditer(body):
        if m.group("num") is not None:
            ep = {"num": clean(m.group("num")), "name": clean(m.group("name")),
                  "pages": []}
            episodes.append(ep)
            page = None
        elif m.group("label") is not None:
            if ep is None:                       # 容错：分集标题缺失时也建一个
                ep = {"num": "", "name": "", "pages": []}
                episodes.append(ep)
            page = {"label": clean(m.group("label")), "grid": "2x3", "idx": []}
            ep["pages"].append(page)
        elif m.group("grid") is not None:
            if page is not None:
                page["grid"] = m.group("grid")
        else:
            n += 1
            if page is None:
                page = {"label": "", "grid": "2x3", "idx": []}
                (ep or episodes[-1])["pages"].append(page)
            page["idx"].append(n)
    return episodes, n


def main():
    from PIL import Image

    html = open(SRC, encoding="utf-8", errors="replace").read()
    cut = html.find('<div class="comic-container">')
    if cut < 0:
        raise SystemExit("未找到 .comic-container")
    body = html[cut:]

    mc = RE_COVER.search(body)
    if not mc:
        raise SystemExit("未解析到封面（.cover h1/subtitle/author）")
    cover = {"title": clean(mc.group("title")), "subtitle": clean(mc.group("subtitle")),
             "author": clean(mc.group("author"))}

    episodes, total = parse_structure(body)
    cells = parse_panels(body)
    if len(cells) != total:
        raise SystemExit("panel-cell 切分数(%d)与结构解析数(%d)不一致" % (len(cells), total))

    os.makedirs(OUT_DIR, exist_ok=True)
    for fn in os.listdir(OUT_DIR):                # 清旧产物，保证单一来源
        if fn.endswith((".jpg", ".js")):
            os.remove(os.path.join(OUT_DIR, fn))

    written, bytes_total = 0, 0
    out_eps = []
    for ei, ep in enumerate(episodes):
        free = ei < FREE_EPISODES
        oep = {"num": ep["num"], "name": ep["name"], "locked": not free, "pages": []}
        for pg in ep["pages"]:
            opg = {"label": pg["label"], "grid": pg["grid"], "panels": []}
            for idx in pg["idx"]:
                src = cells[idx - 1]
                mi = RE_IMG.search(src)
                if not mi:
                    raise SystemExit("panel #%d 未找到内联图片" % idx)
                alt = mi.group("alt") or ""
                if free:
                    raw = base64.b64decode(mi.group("b64"))
                    im = Image.open(io.BytesIO(raw)).convert("RGB")
                    w, h = im.size
                    s = min(w, h)                       # 原为方图，居中裁方保险
                    if w != h:
                        im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
                    if s != ART:
                        im = im.resize((ART, ART), Image.LANCZOS)
                    name = "a%02d.jpg" % idx
                    path = os.path.join(OUT_DIR, name)
                    im.save(path, "JPEG", quality=QUALITY, optimize=True)
                    bytes_total += os.path.getsize(path)
                    written += 1
                    art = "assets/sample/" + name
                else:
                    art = ""                            # 未解锁不落图，避免白送
                mn = RE_NAR.search(src)
                narr = clean(mn.group("t")) if mn else ""
                o = {"art": art, "alt": alt, "narration": narr,
                     "bubbles": [{"cls": clean(b.group("cls")).replace(" ", "."),
                                  "text": clean(b.group("t"))}
                                 for b in RE_BUB.finditer(src) if clean(b.group("t"))],
                     "sfxs": [{"cls": clean(s.group("cls")).replace(" ", "."),
                               "text": clean(s.group("t"))}
                              for s in RE_SFX.finditer(src) if clean(s.group("t"))]}
                opg["panels"].append(o)
            oep["pages"].append(opg)
        out_eps.append(oep)

    data = {"cover": cover, "totalEpisodes": len(episodes), "totalPanels": total,
            "freeEpisodes": min(FREE_EPISODES, len(episodes)), "episodes": out_eps}
    with open(MANIFEST, "w", encoding="utf-8") as f:
        f.write("// 由 tools/make_h5_sample.py 生成，勿手改。\n"
                "// 源：samples/画面感内容_精简版_单文件.html（权威示例）\n"
                "window.H5_SAMPLE = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")

    print("封面:", cover["title"])
    print("分集:", len(episodes), "| 总格:", total, "| 免费分集:", data["freeEpisodes"])
    for e in out_eps:
        print("   %s %s %s 页%s" % (e["num"], e["name"],
                                   len(e["pages"]), "（锁）" if e["locked"] else ""))
    print("落图:", written, "张 (%d KB)" % (bytes_total // 1024))
    print("清单:", os.path.relpath(MANIFEST, ROOT))


if __name__ == "__main__":
    main()
