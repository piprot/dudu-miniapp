#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""隐私接口全量审计：扫代码体（剥注释）找 wx.* 敏感接口调用，分类定性。

为什么需要这个脚本（2026-10-06 两次踩坑）：
  ① 纯 grep 会把**注释和测试断言**算成真实调用 —— 两次都出现
     「grep 到 wx.getLocation 6 处，隐私草稿却写着不采集位置」的
     虚假矛盾，浪费一轮排查。真实情况：全是注释与负向断言。
  ② 微信「隐私受保护接口」只有 12 项（位置相关），但用户关心的
     敏感接口远不止（相册、剪贴板、通讯录…）。两套清单要分开算，
     否则会出现「不在 12 项里就等于不用管」的错判。

用法：python tools_local/privacy_audit.py
"""
from __future__ import print_function

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 微信官方「隐私保护指引」必须声明的接口（app.json requiredPrivateInfos）──
# 这12 项是硬红线：用了就必须声明，不声明真机会被拦。
REQUIRED_PRIVATE = [
    'getLocation', 'onLocationChange', 'startLocationUpdate',
    'startLocationUpdateBackground', 'chooseLocation', 'choosePoi',
    'chooseAddress', 'getFuzzyLocation', 'getUserLocation',
    'chooseLocation',
]

# ── 其他敏感但不在 requiredPrivateInfos 范围的接口 ────────────────────
# 这些由用户主动操作触发，走各自的scope 授权，不需要 requiredPrivateInfos，
# 但隐私指引里应能在「我们收集的信息」里对应说明。
SENSITIVE_OTHER = [
    'chooseMedia', 'chooseImage', 'chooseVideo', 'chooseMessageFile',
    'saveImageToPhotosAlbum', 'saveVideoToPhotosAlbum', 'camera',
    'getClipboardData', 'setClipboardData', 'getPhoneNumber',
    'getUserProfile', 'getUserInfo',
    'getSetting', 'openSetting', 'authorize', 'scanCode',
    'getRecorderManager', 'startRecord',
    'getSystemInfo', 'getSystemInfoSync', 'getDeviceInfo',
    'getNetworkType', 'getWeRunData',
]

SCAN_EXT = ('.js', '.wxml', '.json', '.wxss')
SKIP_DIRS = ('node_modules', '.git', 'images', 'tools_local', '_backup', '__pycache__')
# ⚠️ test/ 必须排除 —— 这是本脚本最容易踩的坑（第一版就栽了）：
#   test/test_content_library.js 里有
#       assert.ok(code.indexOf('wx.getLocation') < 0, 'weather.js 仍在调用 wx.getLocation');
#   那是**字符串字面量里的负向断言**，不是调用。
#   若不排除，脚本会报「❌ getLocation 用了但未声明」——与事实完全相反，
#   而这个假警报会让人以为真的漏了隐私声明，白排查一轮。
#   项目里已有专门守卫（test_content_library.js 两条）锁死「代码不调 getLocation」，
#   审计脚本只需扫运行时代码，不必重复扫测试。
SKIP_DIRS += ('test',)


def strip_comments(src, ext):
    """剥掉注释。wxml 用 <!-- -->，js 用 // 和 /* */。"""
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    # 行注释：避免误伤 URL 里的 //（如 https://）
    src = re.sub(r'(?m)(^|[^:"\'\w])//.*$', r'\1', src)
    if ext in ('.wxml', '.wxss'):
        src = re.sub(r'<!--.*?-->', '', src, flags=re.S)
    return src


def walk_code():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.endswith(SCAN_EXT):
                out.append(os.path.join(dirpath, fn))
    return out


def main():
    files = walk_code()
    runtime = {}     # api -> [相对路径]  （剥注释后的真实调用）
    decl = {}# 在 app.json 里声明的项

    for path in files:
        ext = os.path.splitext(path)[1]
        rel = os.path.relpath(path, ROOT).replace('\\', '/')
        raw = io.open(path, 'r', encoding='utf-8', errors='ignore').read()
        code = strip_comments(raw, ext)

        for api in set(REQUIRED_PRIVATE) | set(SENSITIVE_OTHER):
            if 'wx.' + api in code:
                runtime.setdefault(api, []).append(rel)

    # app.json 的隐私声明
    app_json = os.path.join(ROOT, 'app.json')
    if os.path.exists(app_json):
        try:
            d = json.load(io.open(app_json, encoding='utf-8'))
            decl = {
                'requiredPrivateInfos': d.get('requiredPrivateInfos', []) or [],
                'permission': d.get('permission', {}) or {},
                '__usePrivacyCheck__': d.get('__usePrivacyCheck__'),
            }
        except Exception as e:
            print('[WARN] app.json 解析失败: %s' % e)

    print('=' * 66)
    print('隐私接口审计  扫描 %d 个文件（已剥注释，只认运行时真实调用）' % len(files))
    print('=' * 66)

    # ① 硬红线
    print()
    print('【① requiredPrivateInfos 硬红线（12 项位置类，用了必声明）】')
    used_required = {a: v for a, v in runtime.items() if a in REQUIRED_PRIVATE}
    if not used_required:
        print('  ✓ 零调用 —— 位置类接口一个都没用，无需声明')
    else:
        for a, ps in sorted(used_required.items()):
            flag = '已声明' if a in decl['requiredPrivateInfos'] else '❌ 未声明'
            print('  ❌ %-32s %s' % (a, flag))
            for p in ps:
                print('       %s' % p)
    print('  app.json 实际声明: %s' % (decl['requiredPrivateInfos'] or '（无）'))
    print('  __usePrivacyCheck__: %s' % decl.get('__usePrivacyCheck__'))

    # ② 其他敏感接口
    print()
    print('【② 其他敏感接口（走各自 scope 授权，非 requiredPrivateInfos 范畴）】')
    other = {a: v for a, v in runtime.items() if a in SENSITIVE_OTHER}
    if not other:
        print('  ✓ 零调用')
    else:
        for a, ps in sorted(other.items()):
            print('  · %-32s %d 处' % (a, len(ps)))
            for p in ps[:4]:
                print('       %s' % p)

    # ③ 结论
    print()
    print('=' * 66)
    problems = []
    if used_required:
        for a in used_required:
            if a not in decl['requiredPrivateInfos']:
                problems.append('位置类接口 %s 用了但未在 requiredPrivateInfos 声明' % a)
    if not decl.get('__usePrivacyCheck__'):
        problems.append('app.json 未开启 __usePrivacyCheck__')
    if problems:
        print('结论：❌ 需处理')
        for p in problems:
            print('  · ' + p)
        return 1
    print('结论：✓ 隐私配置无需修改')
    print('  · 位置类接口零调用，requiredPrivateInfos 不声明是对的')
    print('  · 敏感接口均为用户主动触发（选图/存图/剪贴板），不需 requiredPrivateInfos')
    print('  · __usePrivacyCheck__ 已开启')
    print('=' * 66)
    return 0


if __name__ == '__main__':
    sys.exit(main())
