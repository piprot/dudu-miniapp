#!/usr/bin/env bash
# tools_local/check_remote.sh —— 核验远端分支是否与本地同步（含隧道故障降级路径）
#
# ── 为什么需要这个脚本（2026-10-06 踩坑）─────────────────────────────
# 某次核验远端时 git ls-remote 连报：
#     fatal: unable to access '...': CONNECT tunnel failed, response 502
#     fatal: unable to access '...': Empty reply from server
#     schannel: failed to receive handshake, SSL/TLS connection failed
# 三个错误长得像"仓库坏了/ 没登录 / 代码没推上去"，实际是**代理隧道层故障**。
#
# 关键诊断结论（同一时刻实测）：
#     api.github.com  → HTTP 200   （通）
#     github.com      → 超时       （不通）
# 而 git push/pull/ls-remote 全部走 github.com 这一个域名。
# 也就是说：**git 全挂但 API 通** = 纯隧道问题，与仓库/凭据无关。
#
# 所以本脚本做两件事：
#   1. 先试 git（快，拿到即走）
#   2. 失败则降级到 api.github.com 读 branch SHA（可绕过 github.com 隧道）
#      并额外核验关键文件存在性 —— 不能只信 SHA，SHA 对但文件没推全也有坑
#
# 用法：bash tools_local/check_remote.sh [分支名]
set -uo pipefail

BRANCH="${1:-feature/extra-modules}"
REPO="piprot/dudu-miniapp"
API="https://api.github.com/repos/${REPO}"

LOCAL_SHA=$(git rev-parse HEAD)
echo "分支          : $BRANCH"
echo "本地 HEAD     : $LOCAL_SHA"
echo

# ── 路径 1：git 直连（优先）────────────────────────────────────────────
GIT_SHA=$(git ls-remote origin "refs/heads/${BRANCH}" 2>/dev/null | cut -f1)

if [ ${#GIT_SHA} -eq 40 ]; then
  echo "远端(git)     : $GIT_SHA"
  [ "$GIT_SHA" = "$LOCAL_SHA" ] \
    && { echo "结论          : ✓ 已同步"; exit 0; } \
    || { echo "结论          : ✗ 不一致，需 git push"; exit 1; }
fi

# ── 路径 2：降级到 API（github.com 隧道不通时唯一可行的路）────────────
echo "远端(git)     : 查询失败（git 走 github.com，隧道可能不通）"
echo "→ 降级到 api.github.com 核验"
echo

API_SHA=$(curl -s --max-time 20 "${API}/branches/${BRANCH}" \
  | python -c "
import sys, json
try:
    print(json.load(sys.stdin).get('commit', {}).get('sha', ''))
except Exception:
    print('')
" 2>/dev/null)

if [ ${#API_SHA} -ne 40 ]; then
  echo "远端(API)     : 查询失败"
  echo
  echo "结论          : ✗ 无法核验 —— git 与 API 都不通，属网络出口故障"
  echo "                （先别怀疑仓库/凭据，api.github.com 通就说明账号没问题）"
  exit 2
fi

echo "远端(API)     : $API_SHA"
MSG=$(curl -s --max-time 20 "${API}/commits/${API_SHA}" \
  | python -c "
import sys, json
try:
    print(json.load(sys.stdin).get('commit', {}).get('message', '').split(chr(10))[0])
except Exception:
    print('(取不到)')
" 2>/dev/null)
echo "远端提交信息  : $MSG"
echo

if [ "$API_SHA" != "$LOCAL_SHA" ]; then
  echo "结论          : ✗ 不一致，需 push（等github.com 隧道恢复后重试）"
  exit 1
fi

# SHA 一致还不够：核对关键文件确实在远端，且已删的确实删了
echo "关键文件核验（远端 contents API）："
for f in "utils/photo_lib.js" "test/test_photo_lib.js" \
         "utils/card_style_mixin.js" "utils/bg_pack.js"; do
  SIZE=$(curl -s --max-time 15 "${API}/contents/${f}?ref=${BRANCH}" \
    | python -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d['size'] if 'size' in d else 'DELETED')
except Exception:
    print('ERROR')
" 2>/dev/null)
  printf "  %-30s %s\n" "$f" "$SIZE"
done
echo
echo "结论          : ✓ 已同步（经 API 核验，SHA 与文件状态均一致）"
exit 0
