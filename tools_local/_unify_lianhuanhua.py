# -*- coding: utf-8 -*-
"""
「连环画」→「画面感内容」全量统一（用户 2026-09-23 拍板：全部统一）。

范围：
  ✅ 代码/配置/模板：.js .json .wxml .wxss .py
  ✅ 资产文件名：samples/连环画_精简版_单文件.html（真实存在的构建输入）
  ❌ .md 文档：**刻意不改**。它们是历史决策记录，且含对用户原话的逐字引用
     （如「逻辑上不能有生成连环画脚本，只能有付费生成连环画」），改写等于篡改审计轨迹。
  ❌ _backup/ tools_local/ node_modules/ cloudfunctions_deprecated/：备份与本地工具

替换顺序（重要）：
  ① 「画面感连环画」→「画面感内容」   先消重，避免出现「画面感画面感内容」
  ② 「连环画生成 9 折券」→「画面感内容 9 折券」  避免被 ③ 拆成「画面感内容生成 9 折券」
  ③ 其余「连环画」→「画面感内容」
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD_ASSET = 'samples/连环画_精简版_单文件.html'
NEW_ASSET = 'samples/画面感内容_精简版_单文件.html'

EXTS = ('.js', '.json', '.wxml', '.wxss', '.py')
SKIP_DIRS = ('_backup', 'tools_local', 'node_modules', 'cloudfunctions_deprecated', '.git', '.workbuddy')

RULES = [
    ('画面感连环画', '画面感内容'),
    ('连环画生成 9 折券', '画面感内容 9 折券'),
    ('连环画', '画面感内容'),
]

# 本脚本自身位于 tools_local/（已在 SKIP_DIRS 内），不会被自己扫到。
SELF = os.path.abspath(__file__)


def read(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def walk():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if not fn.endswith(EXTS):
                continue
            p = os.path.join(dirpath, fn)
            if os.path.abspath(p) == SELF:
                continue
            yield p


def main():
    # ── 步骤 0：重命名资产文件 ──
    old_abs = os.path.join(ROOT, OLD_ASSET)
    new_abs = os.path.join(ROOT, NEW_ASSET)
    if os.path.exists(old_abs):
        if os.path.exists(new_abs):
            print('[FAIL] 目标资产已存在，避免覆盖: ' + NEW_ASSET)
            sys.exit(1)
        os.rename(old_abs, new_abs)
        print('[OK ] 资产重命名 %s → %s' % (os.path.basename(OLD_ASSET), os.path.basename(NEW_ASSET)))
    else:
        print('[SKIP] 资产已是新名或不存在: ' + OLD_ASSET)

    # ── 步骤 1：全文替换 ──
    total = 0
    touched = 0
    for p in sorted(walk()):
        src = read(p)
        if '连环画' not in src:
            continue
        s = src
        for old, new in RULES:
            s = s.replace(old, new)
        if s == src:
            continue
        cnt = src.count('连环画') - s.count('连环画')
        write(p, s)
        touched += 1
        total += cnt
        print('[OK ] %-58s 替换 %d 处' % (os.path.relpath(p, ROOT).replace('\\', '/'), cnt))

    print('\n共替换 %d 处，写入 %d 个文件。' % (total, touched))

    # ── 步骤 2：自校验 ──
    left = []
    for p in sorted(walk()):
        s = read(p)
        if '连环画' in s:
            left.append(os.path.relpath(p, ROOT).replace('\\', '/'))
    if left:
        print('\n[FAIL] 仍有残留：')
        for f in left:
            print('   ' + f)
        sys.exit(1)
    print('[OK ] 自校验通过：.js/.json/.wxml/.wxss/.py 内「连环画」= 0')


if __name__ == '__main__':
    main()
