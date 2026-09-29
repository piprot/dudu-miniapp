# -*- coding: utf-8 -*-
"""
webp → JPEG 全量转换（真机兼容性修复）

【为什么必须转】
微信小程序 <image> 的 webp 在**真机上不可靠**：
  - 开发者工具用 webview 渲染 → 显示正常（所以本地/模拟器看不出问题）；
  - 真机 iOS：< 14 完全不支持 webp；>= 14 还需基础库 >= 2.9 且给 <image> 加 webp="true"；
  - 真机 Android：有大量实测失败案例（OPPO/Android 14 等），透明通道 webp 在 Android 11 亦失败。
表现 = 真机上图片位置**空白**（`.sample` 等容器有 background:#fff 时就是一块白）。
社区一致结论：**直接转成 jpg / png**。

本工程三组图均**无透明通道**（已核验），故 JPEG 无损语义。

【体积预算（分包硬上限 2MB）】
  images/samples        4 张 240w  → q85          ≈ 0.09MB（进主包）
  packageReader/panels  32 张 480w → q68          ≈ 1.6MB
  packageSample/sample_panels 54 张 → w512 q66    ≈ 1.6MB

用法：
  python tools/webp_to_jpg.py            # 转换 + 报告
  python tools/webp_to_jpg.py --dry-run  # 只测算不落盘
"""
import io
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (目录, 目标最长边宽 None=不缩放, JPEG 质量)
PLAN = [
    ('images/samples', None, 85),
    ('packageReader/panels', None, 68),
    ('packageSample/sample_panels', 480, 62),
]


def convert_dir(rel, max_w, quality, dry_run=False):
    d = os.path.join(ROOT, rel)
    files = sorted(f for f in os.listdir(d) if f.lower().endswith('.webp'))
    if not files:
        print('  %-32s 无 webp，跳过' % rel)
        return []
    total = 0
    made = []
    for f in files:
        src = os.path.join(d, f)
        im = Image.open(src).convert('RGB')          # 丢掉 alpha（本工程三组图均无 alpha）
        if max_w and im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        out = os.path.join(d, f[:-5] + '.jpg')
        if dry_run:
            buf = io.BytesIO()
            im.save(buf, 'JPEG', quality=quality, optimize=True)  # 基线，不用 progressive
            size = buf.tell()
        else:
            im.save(out, 'JPEG', quality=quality, optimize=True)
            size = os.path.getsize(out)
        total += size
        made.append((f[:-5] + '.jpg', size))
    print('  %-32s %2d 张 → %5.2f MB  (w=%s q=%d)'
          % (rel, len(files), total / 1024 / 1024, max_w or 'orig', quality))
    return made


def main():
    dry_run = '--dry-run' in sys.argv
    print('webp → JPEG 转换%s' % ('（测算模式）' if dry_run else ''))
    budget = {'packageReader/panels': 2.0, 'packageSample/sample_panels': 2.0}
    for rel, max_w, q in PLAN:
        made = convert_dir(rel, max_w, q, dry_run)
        if rel in budget and made:
            mb = sum(s for _, s in made) / 1024 / 1024
            flag = 'OK' if mb <= budget[rel] * 0.9 else '⚠ 逼近上限'
            print('      分包预算 %.1fMB → 占比 %.0f%%  %s' % (budget[rel], mb / budget[rel] * 100, flag))
    if not dry_run:
        print('\n下一步：删除同目录下遗留的 *.webp，并确认全工程无 .webp 引用。')


if __name__ == '__main__':
    main()
