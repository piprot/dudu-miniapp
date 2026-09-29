# -*- coding: utf-8 -*-
"""示例画面感内容 · HTML 组装版生成器。

把《美汐的故事》32 张画格（packageReader/panels/*.jpg）组装成
一个**自包含**的网页版画面感内容 HTML（画格以 base64 内联，离线也能看），
代表「网页版」(comic_web, ¥88) 的交付形态，也作为付费前给用户看的「示例」。

为什么是 HTML 组装版：用户付费前必须看到「成品长什么样」——原生 reader 只是
小程序内渲染，不能代表网页版交付物；HTML 组装版 = 用户付完钱拿到的东西，
所见即所得，转化才有抓手。

用法：python tools/make_sample_web.py
输出：samples/meixi_story.html（自包含，可直接浏览器打开 / 托管后喂给 web-view）

⚠️ 2026-09-18 用户已手工组装一份更完整的单文件示例
   `samples/画面感内容_精简版_单文件.html`（10.4MB / 54 张内联画格 / 标题《真正的底气，从来都是自己挣来的》），
   作为付费前「示例」的**权威版本**；本脚本产物（meixi_story.html）已被移除、仅作从工程面板
   重新生成的备选。需用工程内 32 张面板再生成时再跑本脚本。
"""
import os
import re
import base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL_DIR = os.path.join(ROOT, "packageReader", "panels")
CFG = os.path.join(ROOT, "utils", "config.js")
OUT_DIR = os.path.join(ROOT, "samples")
OUT = os.path.join(OUT_DIR, "meixi_story.html")


def load_chapters():
    txt = open(CFG, encoding="utf-8").read()
    out = []
    pat = re.compile(
        r"\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*free:\s*(true|false)"
        r"\s*,\s*panels:\s*\[([^\]]*)\]\s*\}", re.S)
    for m in pat.finditer(txt):
        cid, name, free, parr = m.groups()
        panels = re.findall(r"'([^']+)'", parr)
        out.append((cid, name, free == "true", panels))
    return out


def panel_data_uri(fname):
    path = os.path.join(PANEL_DIR, fname + ".jpg")
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return "data:image/jpeg;base64," + b64


def build_html(chapters):
    blocks = []
    for cid, name, free, panels in chapters:
        tag = '<span class="free">免费试读</span>' if free else ""
        blocks.append('  <div class="chapter">%s%s</div>' % (name, tag))
        for p in panels:
            uri = panel_data_uri(p)
            blocks.append('  <img class="panel" loading="lazy" src="%s" alt="%s">' % (uri, p))
    chapters_html = "\n".join(blocks)

    return """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>《美汐的故事》· 网页版示例</title>
<style>
  :root{ --bg:#fbf6ef; --ink:#3a332c; --sub:#8a7d6e; --accent:#f0a85a; --accent2:#7b6cc7; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ background:var(--bg); color:var(--ink);
        font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
        -webkit-font-smoothing:antialiased; line-height:1.6; }
  .wrap{ max-width:480px; margin:0 auto; padding-bottom:48px; }
  .hero{ padding:38px 22px 24px; text-align:center;
         background:linear-gradient(160deg,#fff3e2,#ffe9d6); }
  .hero h1{ font-size:25px; letter-spacing:3px; }
  .hero .brand{ display:inline-block; margin-top:12px; font-size:13px; color:var(--sub);
                border:1px solid #e7d8c4; border-radius:999px; padding:4px 14px; }
  .cta{ display:block; margin:20px 18px 4px; text-align:center; text-decoration:none;
        background:linear-gradient(135deg,#f0a85a,#ef8f6a); color:#fff; font-weight:700;
        padding:14px; border-radius:14px; box-shadow:0 8px 20px rgba(240,150,90,.35); }
  .chapter{ margin:30px 18px 4px; font-size:15px; font-weight:700; letter-spacing:1px;
            color:var(--accent2); display:flex; align-items:center; gap:10px; }
  .chapter:before{ content:""; width:6px; height:18px; border-radius:3px; background:var(--accent2); }
  .free{ font-size:11px; font-weight:600; color:#fff; background:#7bbf8a;
         border-radius:999px; padding:2px 9px; letter-spacing:0; }
  .panel{ display:block; width:calc(100% - 28px); margin:12px auto; border-radius:14px;
          box-shadow:0 6px 18px rgba(120,100,80,.16); background:#f3ece2; }
  .foot{ text-align:center; color:var(--sub); font-size:12px; padding:26px 22px 0; line-height:1.8; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>《美汐的故事》</h1>
    <span class="brand">dudu 画面感 · 网页版示例</span>
  </div>
  <a class="cta" href="#">↑ 这就是你的画面感内容成品 · 立即定制</a>
__CHAPTERS__
  <div class="foot">本页即「网页版」交付形态示例 —— 你的故事也将以同样的方式被画成画面感内容，<br>可在线翻阅、随时分享。</div>
</div>
</body>
</html>
""".replace("__CHAPTERS__", chapters_html)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    chapters = load_chapters()
    if not chapters:
        raise SystemExit("未能从 utils/config.js 解析出 chapters")
    html = build_html(chapters)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    size = os.path.getsize(OUT)
    print("chapters:", len(chapters),
          "panels:", sum(len(c[3]) for c in chapters),
          "->", os.path.relpath(OUT, ROOT),
          "(%d KB)" % (size // 1024))


if __name__ == "__main__":
    main()
