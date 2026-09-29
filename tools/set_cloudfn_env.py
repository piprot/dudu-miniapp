#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给云函数写「超时时间 + 环境变量」（微信官方接口 type 3「环境配置」）。

为什么需要它：`wechatide` CLI 没有任何配置云函数的工具，控制台又要手点 6 遍。

⛔⛔ 2026-09-18 实测证伪：本脚本**对本项目无效，不要再用**。拿到真 AppSecret 后实测：
    /cgi-bin/stable_token      ✅ 取到 token（137 位）
    /cgi-bin/getcallbackip     ✅ 90 个 IP      ⇒ token 本身有效
    /tcb/databasecollectionget ✅ errcode=0     ⇒ /tcb/* 整体认这个 token
    /tcb/getfuncconfig         ❌ 40014 invalid access_token
    /tcb/uploadfuncconfig      ❌ 40014（6 个函数全失败）
  ⇒ 根因：`*funcconfig` 属于**开放平台/第三方服务商**接口集（权限集 49/64），
    要的是 `component_access_token` / `authorizer_access_token`，**普通小程序自有的
    access_token 调不了**。文档：…/oplatform/openApi/OpenApiDoc/cloudbase-batch/scf-mgnt/
  ⇒ 教训：当初用「假 token → 40001」断定"接口存在且认我们的 token"是**假阳性**——
    假 token 打任何接口都是 40001，证明不了凭证类型。必须用真 token 做**同族接口对照**。
  ⇒ 替代通道见文件末尾 TOOLBOX 一节（`tcb` CLI）。文件保留仅供溯源，勿照跑。

    POST https://api.weixin.qq.com/tcb/uploadfuncconfig?access_token=...   {"type":3,...}
    POST https://api.weixin.qq.com/tcb/getfuncconfig?access_token=...      {"type":3,...}

实测判据：假 token 打这两个路径返回 `40001 invalid credential`（= 接口存在、凭证不合法），
而路径拼错会返回 `40066 invalid url`。⚠️ 正确路径是**全小写 `uploadfuncconfig`**——
官方文档文件名 `api_getuploadfuntionconfig`（"funtion" 少个 c）是**错的**，照抄会 40066。

用法：
    python tools/set_cloudfn_env.py --secrets-file <path> [--dry-run]

`--secrets-file` 指向一个 JSON（**放临时目录，别放仓库**）：
    {
      "VP_APP_SECRET": "...",
      "VP_APP_KEY": "...",
      "LLM_API_KEY": "...",
      "LLM_MODEL": "ep-xxxxxxxx",
      "LLM_BASE_URL": "https://ark.cn-beijing.volces.com/api/v3"
    }
未提供的键会被跳过（该函数就少写那个变量，不会写成空值）。
（原 `SMTP_*` 已于 2026-09-18 随 send_email 取消，不再需要。）

⚠️ 两个坑：
  1. `type 3` 是**整份替换**（不是增量）⇒ 每次必须把该函数的**全部**环境变量 **连同 timeout** 一起发；
     只发 environment 有把 timeout 打回默认的风险，所以本脚本永远同时带上 timeout。
  2. 取 token 用 `/cgi-bin/stable_token`（不是 `/cgi-bin/token`）——后者会把别处正在用的 token 顶掉。

脚本**只读密钥文件、不写任何密钥到磁盘**，输出一律脱敏。
"""

import argparse
import json
import sys
import urllib.request
import urllib.error

API = "https://api.weixin.qq.com"
APPID = "wxacf98605ac5b0218"
ENV_ID = "cloudbase-d8ge1hu2324c8fcdf"
VP_OFFER_ID = "1450652139"  # 非密钥，可随 VP_* 一起下发

# 函数 -> (超时秒, 需要哪些环境变量键)
# 注：原 send_email（SMTP_*）已于 2026-09-18 随「发到邮箱」功能取消，不再下发；SMTP_* 已无需配置。
PLAN = {
    "vp_create_order": (20, ["VP_APP_ID", "VP_APP_SECRET", "VP_OFFER_ID", "VP_APP_KEY"]),
    "vp_query":        (20, ["VP_APP_ID", "VP_APP_SECRET", "VP_APP_KEY"]),
    "vp_deliver":      (20, ["VP_APP_ID", "VP_APP_SECRET", "VP_APP_KEY"]),
    "vp_get_profile":  (20, []),
    "points":          (10, []),
    "ai_gen":          (60, ["LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL"]),
    # 定制单落库后推飞书群（可选能力：没配就只落库，不推送）。
    # 超时给 20s：内部有一次出网 POST（自带 5s 超时），默认 3s 会把它掐断。
    "custom_request":  (20, ["FEISHU_WEBHOOK", "FEISHU_WEBHOOK_SECRET"]),
}

# 可缺省的键：缺了不算失败（只是功能降级），不参与「⚠️ 缺」告警与 ✅ 判定。
# FEISHU_WEBHOOK_SECRET 只在机器人开了「签名校验」时才需要。
OPTIONAL = {"FEISHU_WEBHOOK_SECRET"}

# 非密钥的固定值：AppID / OfferID 必须下发；LLM_BASE_URL 是火山方舟的**公开端点**，
# 不是密钥（ai_gen/index.js:380 有同样的内置默认）。放进 STATIC 后用户就不必提供，
# 也避免脚本把「本就可省略」的变量误报成「⚠️ 缺」。
STATIC = {
    "VP_APP_ID": APPID,
    "VP_OFFER_ID": VP_OFFER_ID,
    "LLM_BASE_URL": "https://ark.cn-beijing.volces.com/api/v3",
}


def post_json(url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"errcode": -1, "errmsg": "HTTP %s: %s" % (e.code, e.read()[:200])}
    except Exception as e:  # noqa: BLE001
        return {"errcode": -1, "errmsg": "%s: %s" % (type(e).__name__, e)}


def get_token(appsecret):
    r = post_json(API + "/cgi-bin/stable_token", {
        "grant_type": "client_credential", "appid": APPID, "secret": appsecret,
        "force_refresh": False,
    })
    if not r.get("access_token"):
        sys.exit("取 access_token 失败：errcode=%s errmsg=%s" % (r.get("errcode"), r.get("errmsg")))
    return r["access_token"]


def upload_config(token, fn, timeout, env_vars):
    """type 3 = 环境配置（timeout + environment）。整份替换，故一次发全。"""
    cfg = {"timeout": timeout, "environment": [{"key": k, "value": v} for k, v in env_vars]}
    return post_json(API + "/tcb/uploadfuncconfig?access_token=" + token, {
        "type": 3, "env": ENV_ID, "function_name": fn,
        "config": json.dumps(cfg, ensure_ascii=False),
    })


def read_config(token, fn):
    r = post_json(API + "/tcb/getfuncconfig?access_token=" + token, {
        "type": 3, "env": ENV_ID, "function_name": fn,
    })
    if r.get("errcode") not in (0, None):
        return None, r
    try:
        return json.loads(r.get("config") or "{}"), None
    except ValueError:
        return None, {"errcode": -2, "errmsg": "config 不是合法 JSON: %r" % r.get("config")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--secrets-file", required=True, help="JSON 密钥文件路径（别放仓库）")
    ap.add_argument("--dry-run", action="store_true", help="只打印将要下发的变量名，不调接口")
    args = ap.parse_args()

    try:
        with open(args.secrets_file, "r", encoding="utf-8") as f:
            secrets = json.load(f)
    except FileNotFoundError:
        print("找不到密钥文件：%s\n（--secrets-file 要指向一个真实存在的 JSON，建议放临时目录、别放仓库）" % args.secrets_file)
        return 2
    except json.JSONDecodeError as e:
        print("密钥文件不是合法 JSON：%s" % e)
        return 2
    values = dict(STATIC)
    values.update({k: str(v) for k, v in secrets.items() if v not in (None, "")})

    if args.dry_run:
        for fn, (t, keys) in PLAN.items():
            print("%-16s timeout=%2ds  vars=%s" % (fn, t, ",".join(keys) or "(无)"))
        return 0

    if "VP_APP_SECRET" not in values:
        sys.exit("secrets 里缺 VP_APP_SECRET —— 没有它拿不到 access_token，无法写配置")

    print("APPID=%s  ENV=%s" % (APPID, ENV_ID))
    token = get_token(values["VP_APP_SECRET"])
    print("access_token 获取成功（长度 %d）\n" % len(token))

    ok = fail = 0
    for fn, (timeout, keys) in PLAN.items():
        env_vars = [(k, values[k]) for k in keys if k in values]
        missing = [k for k in keys if k not in values and k not in OPTIONAL]
        res = upload_config(token, fn, timeout, env_vars)
        if res.get("errcode") != 0:
            print("❌ %-16s 写入失败 errcode=%s errmsg=%s" % (fn, res.get("errcode"), res.get("errmsg")))
            fail += 1
            continue
        back, err = read_config(token, fn)
        if err:
            print("⚠️  %-16s 写入成功但回读失败：%s" % (fn, err))
            ok += 1
            continue
        got_t = back.get("timeout")
        got_keys = [e.get("key") for e in (back.get("environment") or [])]
        required = [k for k in keys if k not in OPTIONAL]
        verdict = "✅" if got_t == timeout and set(got_keys) >= set(required) else "⚠️"
        print("%s %-16s timeout=%s(期望 %s)  变量=%s%s" % (
            verdict, fn, got_t, timeout, ",".join(got_keys) or "(无)",
            ("  ⚠️ 缺: " + ",".join(missing)) if missing else ""))
        ok += 1

    print("\n完成：成功 %d / 失败 %d" % (ok, fail))
    print("复核：可重跑本脚本（幂等），或用 DEPLOY_CHECKLIST.md §②c 的模拟器探针验「运行时真的读到」。")
    return 1 if fail else 0


# ══════════════════════════════════════════════════════════════════════
# TOOLBOX：配置云函数的**可行**通道（2026-09-18 实测，替代上面那条死路）
#
# `tcb`（CloudBase CLI 3.8.2，本机 `C:\Users\Administrator\AppData\Roaming\npm\tcb.cmd`）
#   —— 能力远超 wechatide，且是本项目目前唯一能写「超时 + 环境变量」的自动化通道：
#
#   tcb login --apiKeyId <SecretId> --apiKey <SecretKey>   # 非交互式登录（腾讯云 API 密钥）
#   tcb env list                                           # 先验能否看到微信云开发 env
#   tcb fn deploy                                          # ⭐ 读 cloudbaserc.json，应用
#                                                          #    functions[].timeout / envVariables
#   tcb fn delete <name>                                   # ⭐ 删云函数（wechatide 没有！可清孤儿 send_email）
#   tcb fn log <name>                                      # ⭐ 云函数日志（wechatide 没有！）
#   tcb fn list | detail | invoke | code | trigger
#
# 两个已实测的边界：
#   1. `tcb fn env` **只有 pull，没有 push** ⇒ 写环境变量不能靠它，只能靠 `fn deploy`
#      （或控制台）。
#   2. 当前**未登录**（`tcb env list` → "No valid identity information"）⇒ 需腾讯云凭据。
#
# ⚠️ 用 `fn deploy` 下发密钥时，`cloudbaserc.json` 里会含明文 envVariables ⇒
#    该文件**必须 gitignore / 放仓库外**，别提交。
# ══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    sys.exit(main())
