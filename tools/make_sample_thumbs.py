#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成「作品预览缩略图」（主包用），供 pages/commission 展示样例作品。

为什么需要它：
  packageReader/panels/ 已拆到分包（1.63MB，避免主包超 2MB 上限）。
  而 pages/commission 在主包里，**主包不能引用分包资源**，所以它不能再用
  /packageReader/panels/xxx.jpg；把 4 张原图复制回主包又会让
  "面板重新生成时副本忘记同步" 变成隐患。
  因此这里从 panels/ 派生**小尺寸缩略图**放进 images/samples/（约 90KB 总计），
  既保持主包轻量，也不需要人工维护副本——本脚本随时可重跑覆盖。

格式：**JPEG（不是 webp）**。原因见 tools/webp_to_jpg.py 顶部说明：
  小程序 <image> 的 webp 在真机上不可靠（开发者工具用 webview 渲染所以看不出），
  真机会整片空白。所有进包的图片一律 JPEG/PNG。

用法（在 comic_miniapp 目录下）：
  <managed python> tools/make_sample_thumbs.py

重跑时机：packageReader/panels/ 里的面板重新生成后。
产物：images/samples/*.jpg（文件名与源面板一致，便于追溯对应关系）
"""
import os
import sys

from PIL import Image

# 需要缩略图的样例面板（按 commission 页展示顺序）
SAMPLES = [
    "e01_p01_sm",
    "e02_p01_sm",
    "e03_p01_sm",
    "e04_p01_sm",
]

SRC_DIR = os.path.join("packageReader", "panels")
OUT_DIR = os.path.join("images", "samples")

# 缩略图宽度（源为 480w）。240w 在手机上足够清晰，JPEG q85 约 20KB/张。
THUMB_W = 240
QUALITY = 85


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src_dir = os.path.join(root, SRC_DIR)
    out_dir = os.path.join(root, OUT_DIR)

    if not os.path.isdir(src_dir):
        print("找不到源目录: %s（请在 comic_miniapp 目录下运行）" % src_dir)
        return 1

    os.makedirs(out_dir, exist_ok=True)

    total = 0
    print("源目录 : %s" % SRC_DIR)
    print("输出   : %s（宽度 %dpx, jpg q%d）\n" % (OUT_DIR, THUMB_W, QUALITY))

    for name in SAMPLES:
        src = os.path.join(src_dir, name + ".jpg")
        dst = os.path.join(out_dir, name + ".jpg")
        if not os.path.isfile(src):
            print("  跳过（源不存在）: %s" % src)
            continue
        im = Image.open(src)
        if im.mode != "RGB":
            im = im.convert("RGB")
        w, h = im.size
        nh = max(1, round(h * THUMB_W / w))
        im = im.resize((THUMB_W, nh), Image.LANCZOS)
        im.save(dst, "JPEG", quality=QUALITY, optimize=True)   # 基线 JPEG，勿改回 webp
        size = os.path.getsize(dst)
        total += size
        print("  %-16s %4dx%-5d → %3dx%-5d  %6.1f KB  (源 %6.1f KB, 压缩到 %.0f%%)"
              % (name, w, h, THUMB_W, nh, size / 1024,
                 os.path.getsize(src) / 1024, size * 100.0 / os.path.getsize(src)))

    print("\n合计 %.1f KB（主包增重）。源面板合计 %.1f KB。"
          % (total / 1024,
             sum(os.path.getsize(os.path.join(src_dir, n + ".jpg"))
                 for n in SAMPLES
                 if os.path.isfile(os.path.join(src_dir, n + ".jpg"))) / 1024))
    print("提示：pages/commission/commission.js 的 samples 应指向 /images/samples/<name>.jpg")
    return 0


if __name__ == "__main__":
    sys.exit(main())
