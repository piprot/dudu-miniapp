# 个人虚拟支付 · 上线部署清单（comic_miniapp）

> 适用范围：把文章和故事做成漫画连环画的「dudu画面感内容工具」小程序（首篇样例作品《美汐的故事》）接入微信官方「虚拟支付·个人」（无需注册公司）。
> **共 6 个云函数**（已全部通过 `node --check` 语法校验，且由闸门 R8 保证每个函数都有 `index.js` + `package.json`）：
> 虚拟支付 4 个 —— `vp_create_order`（下单签名）/ `vp_deliver`（发货推送，**兼容云函数模式 + HTTP 触发两种形态**）/ `vp_query`（查单兜底）/ `vp_get_profile`（解锁态）；
> 业务 2 个 —— `points`（积分账本 + 每日签到）/ `ai_gen`（AI 文案生成，服务端扣分）。
> **变更（2026-09-18）**：原第 7 个函数 `send_email`（nodemailer + `SMTP_*`）随「发到邮箱」功能整体取消，
> 脚本改为前端「复制脚本」按钮带走（`pages/gen` 的 `onCopyPolished`）——**因此不再需要任何 `SMTP_*` 密钥**。
> 本清单分四段：**① 类目核对与补挂「工具」** → **② 云函数上传部署** → **③ 环境变量/集合/推送配置** → **④ 上线前真单验证**。

---

## 📌 部署进度快照（2026-09-18 01:15，运行时探针终态）

| 项目 | 状态 | 证据 |
|---|---|---|
| 云函数部署 | ✅ 在用 6 个全部 `Active` | `cloud_fn_list`（2026-09-18 复核）：`ai_gen` / `points` / `vp_create_order` / `vp_deliver` / `vp_get_profile` / `vp_query`，孤儿 `send_email` **已消失（用户已在控制台删除）** |
| `vp_deliver` 为**新版**（双模式 + 查单验真） | ✅ 已确认 | 部署报告 `packSize 6.2 KB`；本地新版 gzip **6105 B**、旧版仅 3168 B ⇒ 对得上新版 |
| 数据库集合 | ✅ 2/2 | `cloud_db_read_struct`：`vp_orders`、`vp_users` |
| 消息推送 | ✅ 已配好 | `enable:true`、`pushMode:cloudfunction`、7 个虚拟支付事件全部 → `vp_deliver` |
| 云函数**超时** | ✅ 在用 6 个全部到位 | `cloud_fn_info`：`ai_gen 60` / `vp_create_order 20` / `vp_deliver 20` / `vp_query 20` / `vp_get_profile 20` / `points 10` |
| **环境变量（手动控制台配置，2026-09-18 用户完成）** | ✅ 虚拟支付侧全部生效 | 运行时探针：`vp_create_order` 带 `wx.login` 真 code 返回完整订单（paySig+signature+priceFen=600+orderLogged）⇒ `VP_APP_ID/SECRET/OFFER_ID/APP_KEY` 全部读到且 jscode2session/access_token 出网成功；`vp_query`/`vp_deliver` 查单验真已走到微信侧验签 |
| `vp_query` **pay_sig 修复**（URL 查询参数版） | ✅ 已验证生效 | 修复前探针报 `268490002 签名字段[pay_sig]为空`；修复后同一探针返回 `268490002 数据不存在`（未支付测试单在微信支付侧查无此单，业务层预期）⇒ **签名已被接受**。桩单测验不出字段位置，必须运行时探针 |
| `ai_gen` 外网 + LLM_* | ✅ **全链路真生成通过（2026-09-18 终验）** | 运行时探针两次真生成成功（三格脚本 195/216 字、生成后自动 +30 分：余额 221→251）⇒ `LLM_API_KEY/LLM_MODEL` 云端读到、火山方舟出网调用成功、服务端加分逻辑生效。⚠️ 配置教训：**聊天消息显示层会改写密钥值**，控制台贴密钥必须从文件复制（`%TEMP%\llm_api_key_copy.txt`），勿从聊天复制。LLM_BASE_URL 有内置默认无需配置 |
| 运行时探针方法论 | ✅ 已沉淀 | `tools_local/wxide_bash.sh`（bash 直驱 Electron，绕过 .cmd 括号炸裂）+ skill `wx-cloudfn-runtime-verify` |
| 类目含「工具」/ 4 个道具发布 / 隐私指引 | ✅ **MP 后台三件套全部完成（2026-09-18 15:33 用户确认）** | 类目含「工具」；`points_200(¥6)/points_800(¥18)/points_2500(¥50)/comic_full(¥9.9)` 4 道具已发布（道具图 `images/props/` 200×200 PNG）；旧 `points_2000` 已下架；隐私指引已发布（openid/相册/剪贴板）；小程序简称 + 苹果 IAP 已配。操作指南存档：`MP_BACKEND_3ITEMS.md` |


---

## 0. 审核前红线自检（个人主体，先过这关）

- [x] **Redline A · AppID 已是真实值 `wxacf98605ac5b0218`（非 `touristappid`）**：`project.config.json` 的 `appid` 字段已写入该真实值；`touristappid` 仅能本地预览、无法直接提交审核且会被拒。
- [x] **Redline B · 包内无「个体户/企业专用」接口**：本工程已移除标准微信支付（JSAPI）与手机号快速验证（一键登录）的**全部调用**，仅保留「个人虚拟支付 + 兑换码兜底」。
      - ⚠️ **关键前置（2026-09-17 修复）**：`project.config.json` 的 `packOptions.ignore` 原本只排除了 `server/`，导致 `cloudfunctions_deprecated/`（内含历史 JSAPI 实现与手机号登录云函数）、`test/`（内含测试桩与内部实现细节）、`*.md`（含 `SECRETS模板.md`）、`.workbuddy/memory/` 都会被**打进上传包**。现已全部显式排除（8 条规则）。
      - **自动验证**：`node test/check_audit_redlines.js` —— 按「真实会被打进上传包的集合」扫描（已去注释，区分活代码/注释），输出 `活代码命中 0 处` 才算通过。当前：74 个包内文件，0 命中。
- [x] **Redline C · 应用内不放个人收款码**：`utils/config.js` 的 `PAY_CONFIG.rewardEnabled` 为 `false`，购买页「方式二·赞赏码」整块 `wx:if` 不渲染；个人收款/赞赏请走公众号，不在小程序内放码引导加好友付款（否则判「场外交易」拒审）。
- [x] **Redline D · 隐私授权**：代码侧已完成——`app.js` 第 12–14 行已调用 `wx.requirePrivacyAuthorize`。MP 后台「用户隐私保护指引」已配置并**发布**（2026-09-18 用户确认，含 openid/相册/剪贴板收集说明）。

> 以上任一项不满足都会被审核打回或触发推送/支付异常。建议提交前逐条打勾。
> **一条命令代替人工逐条核对**：`node test/run_all.js`（语法检查 + Redline 闸门 + 全部测试套件）。

---

## ① 类目核对与补挂「工具」（虚拟支付硬性门槛）

⚠️ **我无法从本地工程读取你小程序的真实类目**（类目在微信 MP 后台服务端；本地 `project.config.json` 现已填真实 AppID `wxacf98605ac5b0218`，但类目仍需在 MP 后台核对）。请按下面路径**自行核对**。

### 自测路径（微信公众平台 web 端）
1. 浏览器登录 <https://mp.weixin.qq.com> → 进入你的小程序。
2. 左侧菜单 **「设置」→「基本设置」→「服务类目」**，看当前类目列表。
3. 确认列表中**是否含「工具」**（如「工具 / 其他」「工具 / 信息查询」等子类均可，虚拟支付只要求"含工具"）。

### 若没有「工具」类目 → 补挂路径
4. 点类目区 **「+ 添加类目」**。
5. 一级类目选 **「工具」**，二级选与功能最贴合的子类（内容型小程序常用「工具 / 其他」或「工具 / 信息查询」；选「其他」最稳，避免子类资质要求）。
6. 按提示提交：个人主体通常只需**身份证**（工具类目一般无额外资质）；部分子类可能要补充说明，按页面提示填。
7. 提交后等待审核（多数即时或数小时内）。
8. 审核通过后，类目列表出现「工具」即满足条件——**保留原有漫画类目即可，多类目并存**。

> 备注：虚拟支付明确要求"类目含工具"。若「工具」审核被拒（称与内容不符），则个人主体这条路走不通，需退回个体户路径（README 的「C. 进阶」）或联系微信客服确认该类目适配。

---

## ② 云函数上传部署（微信开发者工具，按序执行）

前置：开发者工具已登录你的账号；`comic_miniapp` 的 `project.config.json` 已填真实 AppID `wxacf98605ac5b0218`（非 `touristappid`，见上方 Redline A）；已开通云开发并拿到环境 ID。
⚠️ **先重新打开一次项目**：`pages/reader` + `panels/` 已拆入分包 `packageReader`，`packOptions.ignore` 与 `preloadRule` 可能需要重开项目才生效（官方行为）。

- [ ] **1. 开通云开发**：顶部「云开发」→ 开通 → 记录**环境 ID**（稍后填 `VIRTUAL_PAY.cloudEnv`；当前代码已填 `cloudbase-d8ge1hu2324c8fcdf`，若不同请改 `utils/config.js`）。
- [ ] **2. 上传 4 个普通云函数**（逐个右键 → 「上传并部署：云端安装依赖」）：
  - [ ] `cloudfunctions/vp_create_order`
  - [ ] `cloudfunctions/vp_query`
  - [ ] `cloudfunctions/vp_get_profile`
  - [ ] `cloudfunctions/points` —— ⚠️ **2026-09-17 修复**：该函数目录原先**只有 `index.js`、缺 `package.json`**，会导致「云端安装依赖」失败/运行时 `MODULE_NOT_FOUND`（本地 `node --check` 看不出来）。现补 `package.json`，并加闸门 **R8**（每个云函数必须有 `index.js` + `package.json`，且 `index.js` 里 `require` 的三方模块必须在 `dependencies` 中声明）长期守卫。
  - ℹ️ 原 `cloudfunctions/send_email` 已删除（2026-09-18 功能取消），无需再上传；云端若还留着旧函数，见上方快照的清理项。
- [x] **3. `vp_deliver`（不需要 HTTP 触发）** —— **2026-09-17 已用 CLI 部署完成**，且**无需开启 HTTP 触发**：
  - 本小程序的推送模式实测为**云函数模式**（`pushMode=cloudfunction`），事件由微信直接投给云函数，**没有 URL 可填**。
  - `vp_deliver` 已重写为**两种形态都兼容**（云函数模式的解析对象 + HTTP 触发的原始 XML），并按 `xpay/query_order` 查单验真。详见 §3.3。
  - 已完成的部署命令（备查）：`wechatide -c WorkBuddy cloud_fn_deploy --appid wxacf98605ac5b0218 --env cloudbase-d8ge1hu2324c8fcdf --path "<...>\cloudfunctions\vp_deliver" --remote-npm-install`
- [x] **3b. `ai_gen` 已部署** —— **「允许外网访问」已于 2026-09-18 终验确认开启**（CLI 无此工具、需控制台开，但彼时 ai_gen 全链路真生成已通，见 §快照 line24）。下方 4b 已据终验勾选，提审前控制台再瞄一眼即可。
- [x] **3c. 本轮两个函数已部署并运行时验收通过（2026-09-19 01:5x）** —— 两笔 `execution_success`，`points` 5.0KB / `ai_gen` 16.3KB：
  - `points`（新人礼 100 分）`taskId = confirmation_cloud_fn_deploy_cdbb4ebf-4008-49f5-9e69-61d66949f19a`
  - `ai_gen`（移除 comic 脚本路径）`taskId = confirmation_cloud_fn_deploy_6b2b5ed5-2047-4cae-944f-4a853f51a1c9`
  - **实测结果**（脚本 `ops/accept_deploy.py`，6 项全过）：
    - `points{action:'daily'}` → `{ok:true, awarded:0, already:true, signupBonus:100, points:143}`，余额 **43→143**（增量 +100 == signupBonus + awarded，账目自洽）；再调一次 → `signupBonus:0`，余额仍 143（**CAS 幂等实证**）。
    - `ai_gen{mode:'comic'}` → `{"ok":false,"err":"不支持的 mode: comic（本应用只提供朋友圈文案生成；连环画请走「付费定制」入口）"}`（新代码生效）；`ai_gen{}` → 正常返回内容守卫（**依赖完整，非 -504002**）。
    - `ops/probe_fns.py` 复跑：**7 个函数全健康**。
  - ⚠️ 部署命令**必须带 `--remote-npm-install`**（守卫已注入 `ops/wxcli.py`，会自动补）：不带则云端依赖被覆盖 ⇒ 真调报 `Cannot find module 'wx-server-sdk'`，**部署返回体却仍是绿的**。
    📌 `filesCount: 2` **不是**判据（带 flag 时本地包也只有这两个文件），**只能在部署后真调一次**。
- [ ] **4. 核对依赖**：6 个函数 `package.json` 均含 `wx-server-sdk`；「云端安装依赖」成功即无需本地 `npm install`。可跑 `node test/check_audit_redlines.js` 看 R8 一行是否报「6 个函数…依赖声明齐全」。

---

## ②b 超时 / 环境变量 / 外网访问（三种做法，优先第 0 种）

> ⚠️ `wechatide` 侧**确实没有**任何配置云函数的工具：共 **51 个**（`cloud_fn_deploy` 只有
> `--appid/--env/--path/--remote-npm-install` 四个参数），没有改超时、配环境变量、开外网访问、开 HTTP 触发、查云函数日志的入口。
> 底层 CloudBase MCP 虽有 `updateFunctionConfig`，但 `wechatide` **未暴露**；直接调本地 MCP 传输层属官方明令禁止的「底层绕过」，**不要那样做**。

### ②b-0 用微信官方接口批量写（**推荐；2026-09-18 实测打通**）

微信开放接口有「环境配置」（`type:3` = **超时 + 环境变量**），且**对小程序自有的 access_token 开放**：

```
POST https://api.weixin.qq.com/tcb/uploadfuncconfig?access_token=…   {"type":3, env, function_name, config}   # 写
POST https://api.weixin.qq.com/tcb/getfuncconfig?access_token=…      {"type":3, env, function_name}            # 读回
```

- 路径是**全小写 `uploadfuncconfig`**。官方文档文件名 `api_getuploadfuntionconfig`（"funtion" 少一个 c）是**错的**，照抄得 `40066 invalid url`。
- 实测判据：拿假 token 打这两个路径返回 `40001 invalid credential`（= 接口存在、凭证不合法）；对照 `tcb/databasecollectionget`（确定可用的小程序云开发接口）同样返回 `40001`。
- **本仓库已备好脚本** `tools/set_cloudfn_env.py`：读密钥 JSON → 取 `stable_token` → 逐函数写 `timeout`+`environment` → **回读校验**；只读密钥、不落盘、输出脱敏。需 `VP_APP_ID`/`VP_OFFER_ID` 已在脚本常量里，密钥从 JSON 读。
  ```bash
  python tools/set_cloudfn_env.py --secrets-file <临时目录里的密钥JSON> --dry-run   # 先看计划，不调接口
  python tools/set_cloudfn_env.py --secrets-file <临时目录里的密钥JSON>             # 真正写入并回读
  ```
- ⚠️ **`type:3` 是整份替换、不是增量** ⇒ 必须把该函数**全部**环境变量**连同 `timeout`** 一起发；只发 `environment` 有把 timeout 打回默认的风险（脚本已按此规避，且永远带上 timeout）。
- ⚠️ 取 token 用 `/cgi-bin/stable_token`，别用 `/cgi-bin/token`（后者会顶掉别处正在用的 token）。

### ②b-1~3 控制台手做（不方便交出密钥时走这条）

**统一入口**：微信开发者工具 → 顶部「**云开发**」→「**云函数**」→ 点函数名 →「**配置**」。
（超时时间、环境变量、允许外网访问都在这个「配置」页上，**一趟可以全做完**。）

### ②b-1 超时时间（**默认仅 3 秒，不改必挂**）

| 函数 | 建议超时 | 理由 |
|---|---|---|
| `ai_gen` | **60 秒** | 调大模型 + 抓文章，3 秒必超时 |
| `vp_deliver` | **20 秒** | 内含一次 `xpay/query_order` 外部调用 |
| `vp_query` | **20 秒** | 内含 access_token + 查单两次外部调用 |
| `vp_create_order` | **20 秒** | 内含 code2session 外部调用 |
| `points` | **10 秒** | 纯数据库操作 |
| `vp_get_profile` | **10 秒** | 纯数据库操作 |

- [x] **4a.** 超时已全部到位（2026-09-18 00:36 用 `cloud_fn_info` 复核：`ai_gen 60`、其余 20 或 10，与上表一致）。
  - 复核命令（改完可跑，应显示 `timeout` 与上表一致）：
    ```bash
    wechatide -c WorkBuddy cloud_fn_info --appid wxacf98605ac5b0218 \
      --env cloudbase-d8ge1hu2324c8fcdf \
      --names "ai_gen,points,vp_create_order,vp_deliver,vp_get_profile,vp_query"
    ```
  - 2026-09-17 23:45 实测：全部仍是 `timeout: 3`，全部待改 → 2026-09-18 逐个改完（含当时仍在用的 `send_email`）。

### ②b-2 允许外网访问

- [x] **4b.** `ai_gen` → 「配置」→ 打开「**允许外网访问**」。**2026-09-18 终验已确认生效**（ai_gen 真生成通过；`index.js:63` 用 `https.request` 直连 `ark.cn-beijing.volces.com`，不开则生成报网络错误）。⚠️ 提审前建议控制台再确认一次仍为开（控制台配置不受代码部署影响；本轮仅改了响应解码逻辑、未动外网开关，状态应不变）。

### ②b-3 环境变量

- [ ] **4c.** 按 §3.1 的表逐个函数配置环境变量并保存；**改完需重新部署一次该云函数**才生效。
  - 注意 `vp_deliver` 现在也需要 `VP_APP_ID`/`VP_APP_SECRET`/`VP_APP_KEY`（它要自查单验真），不只是 `VP_PUSH_TOKEN`。


---

## ②c 运行时真机验证（不用真机、不用支付，CLI 就能验）

> **2026-09-18 打通**：`wechatide automation_evaluate` 能**在小程序模拟器运行时里真执行 JS**，
> 于是可用 `wx.cloud.callFunction` **真调云函数**并读回真实返回值。
> 它比"看配置页"硬：同时证明 ①函数已部署到目标环境 ②环境变量在**运行时真的读到了** ③数据库/出网可用。
> （"配置页写着有"≠"运行时读得到"——只有真调一次才算验过。）

### 调用方式

```bash
# 前置：项目窗口已开（已开时返回 type:"reuse"）
wechatide -c WorkBuddy open_project_window --project "<项目绝对路径>" --window-mode liteMode
# 真调一个云函数
wechatide -c WorkBuddy automation_evaluate \
  --project "<项目绝对路径>" \
  --fn-source "function(){ return wx.cloud.callFunction({name:'vp_get_profile'}) }"
```
返回在 `result.result.result`（工具会自动 await Promise）。要并发多探针，把多个 `callFunction` 塞进一个 `Promise.all` 一次打完更快。

### 探针设计原则（**别乱传参，否则真扣分/真发信**）

先读函数的**校验顺序**，再挑"能穿过前置校验、但会在下一步停下"的入参，做到**零副作用、零花费**：

| 函数 | 安全探针入参 | 未配环境变量时 | 已配时 |
|---|---|---|---|
| `vp_create_order` | `{productId:'points_200'}`（**故意不传 `code`**） | `服务端未配置虚拟支付参数（…）` | `登录态获取失败：invalid code` ← 顺带证明 AppID/Secret 有效 |
| `vp_query` | `{openid:'<openid>', outTradeNo:'PROBE_NOT_EXIST'}` | `参数缺失（openid/outTradeNo 或服务端密钥未配置）` | `access_token 获取失败…` 或查单报错 |
| `ai_gen` | `{}` | `服务端未配置 LLM_API_KEY（…）` | `请输入文字、上传图片或粘贴文章链接`（该分支在**扣分之前**，不花积分） |
| `points` | `{action:'balance'}` | — | `{ok:true, points, coupons}` |

⚠️ 不要对 `ai_gen` 传 `{mode:'moments'}` 且带正文——那会**真扣积分**并调大模型。
（原 `send_email` 探针已随该函数取消而移除。）

### 2026-09-18 00:20 实测结论

```
points          : ok, points=5                                              ✅ 账本可用
vp_get_profile  : ok, openid=oYYznxSf3E9YeDYwKFaXSnbp5WnE, unlockedAll=false ✅ 部署 + 库读通
vp_create_order : 服务端未配置虚拟支付参数                                   ❌
vp_query        : 参数缺失（…或服务端密钥未配置）                             ❌
ai_gen          : 服务端未配置 LLM_API_KEY                                   ❌
send_email      : 服务端未配置 SMTP                                          ❌   ← 该函数已废弃，此行仅存历史
```
⇒ **在用的 6 个函数环境变量全部未配**（不是"配了没生效"）。`ai_gen` 出网仍不可判定——缺 key，调用走不到网络那一步。
⇒ 开发者测试号 openid：`oYYznxSf3E9YeDYwKFaXSnbp5WnE`（后续积分/解锁 E2E 直接用这个号）。

> 改完环境变量后**重跑本节探针**即可闭环；`ai_gen` 配好 `LLM_*` 后，用 `{mode:'moments', prompt:'测试'}` 真生成一次，即可一次性验出**环境变量正确 + 允许外网访问**两件事（会扣 20 积分，看余额 43→23 最直观）。
> ⚠️ **不要再用 `mode:'comic'` 做探针**（2026-09-19 起）：免费「生成连环画脚本」路径已整体移除，显式传 `comic` 只会返回 `不支持的 mode`，探不出环境变量与出网。连环画只能走付费定制。


---

## ③ 环境变量 / 数据库集合 / 发货推送配置

### 3.1 云开发环境变量（控制台 → 云函数 → 对应函数 → 配置 → 环境变量；**切勿写进代码**）
> 环境变量按**函数**维度配置（也可用「云开发 → 环境变量」统一下发）。下表标明每个变量归谁用。

| 变量 | 归属函数 | 取值来源 |
|---|---|---|
| `VP_APP_ID` | vp_* | MP 后台「设置 → 基本设置」AppID |
| `VP_APP_SECRET` | vp_* | MP 后台「开发 → 开发设置 → 开发者密钥」AppSecret |
| `VP_OFFER_ID` | vp_* | MP 后台「支付与交易 → 虚拟支付 → 基本配置」OfferID |
| `VP_APP_KEY` | vp_* | MP 后台「虚拟支付 → 基本配置」现网 AppKey |
| `VP_PUSH_TOKEN` | vp_deliver（**仅 HTTP 触发模式用**） | 自定义随机串；若你改用 HTTP 触发模式，需**同时**填到 MP 后台【开发管理 → 消息推送 → Token】，两边一致（发货推送来源校验）。**当前用的是云函数模式，此项可不配**——该模式没有签名，真伪由 `vp_deliver` 的查单验真（`VP_APP_KEY`）兜住 |
| `LLM_API_KEY` | ai_gen | 大模型 Key（豆包/火山方舟） |
| `LLM_MODEL` | ai_gen | 接入点/模型名（方舟为 `ep-xxxxxxxx` 形式的接入点 ID） |
| `LLM_BASE_URL` | ai_gen | 可选；不填默认 `https://ark.cn-beijing.volces.com/api/v3` |

> ~~`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`~~ —— 随 `send_email` 于 2026-09-18 一并取消，**不需要再配**（原值若已填，可删掉）。

- [ ] **5.** 在云开发控制台为对应函数新增上述变量并保存（**改完即对新调用生效，不需要重新部署代码**——超时改动手起效、没有任何重新部署，二者同属「函数配置」，可互证）。
  - ⚠️ `vp_deliver` 在**云函数模式**下没有签名可验，其防伪造完全依赖「发货前调 `xpay/query_order` 确认已支付」，
    因此 **`VP_APP_ID`/`VP_APP_SECRET`/`VP_APP_KEY` 三个变量 `vp_deliver` 也必须配**（它自己会去查单），
    否则会降级为"不校验"并在日志打告警。
  - ⚠️ `VP_PUSH_TOKEN` 仅在**改用 HTTP 触发模式**时才需要；当前是云函数模式，可以不配。
  - ⚠️ 不配 `LLM_API_KEY`/`LLM_MODEL` 时 `ai_gen` 无法生成（前端会提示失败且**不扣分**）。

### 3.2 数据库集合（云开发控制台 → 数据库 → 新建集合）
全工程只用到 **2 个集合**（`vp_*` 与 `points`/`ai_gen` 共用同一份 `vp_users`）：
- [ ] **6.** 新建集合 `vp_orders`（订单：outTradeNo/openid/productId/priceFen/status/wxOrderId/时间）
  - 这条记录是「本单买的是什么道具」的**唯一凭据**，`vp_query` 兜底查单靠它判断发货内容，务必建好（下单写失败时云函数会打 `vp_orders 落库失败` 日志）。
- [ ] **7.** 新建集合 `vp_users`（文档 ID = openid；字段 unlockedAll/points/coupons/lastDailyDate/dailyStreak/updateTime）
  - 积分余额（`points`）、每日签到日期（`lastDailyDate`/`dailyStreak`）、解锁态（`unlockedAll`）都落在这里，是**服务端权威账本**；前端只读展示，改不了余额。

### 3.3 发货推送（关键，否则支付后不解锁）
> **本项目的推送模式是「云函数模式」（`pushMode=cloudfunction`）**，不是 HTTP 触发。
> 两种模式的差别（`vp_deliver` **两种都支持**，见其文件头注释）：
> - **云函数模式**：微信把事件以【已解析对象】直接投给云函数（`event.Event` / `event.OutTradeNo`），
>   **没有 body、没有签名 query**。真伪全靠 `vp_deliver` 发货前调 `xpay/query_order` 确认已支付。
> - HTTP 触发模式：微信 POST 原始 XML 到触发 URL，靠 `VP_PUSH_TOKEN` + `signature` 验签。

- [ ] **8.** 用 CLI 一次性配好（**不需要进 MP 后台填 URL**；云函数模式下后台没有 URL 填写项）：
  ```bash
  # 确认当前模式（应为 pushMode=cloudfunction）
  wechatide -c WorkBuddy cloud_query_msg_push --appid wxacf98605ac5b0218 \
    --env cloudbase-d8ge1hu2324c8fcdf --action list
  # 绑定事件 → 云函数（不传 --event-types 时默认订阅虚拟支付 7 事件）
  wechatide -c WorkBuddy cloud_manage_msg_push --appid wxacf98605ac5b0218 \
    --env cloudbase-d8ge1hu2324c8fcdf --function-name vp_deliver --action subscribe
  # 启用
  wechatide -c WorkBuddy cloud_manage_msg_push --appid wxacf98605ac5b0218 \
    --env cloudbase-d8ge1hu2324c8fcdf --function-name vp_deliver --action setEnable --enable
  ```
  （写操作需在开发者工具窗口点确认；备选路径：IDE「云开发控制台 → 消息推送」面板手工逐条添加。）
- [ ] **9.** 复核：`cloud_query_msg_push --action list` 应显示 `enable: true` 且 `callbacks` 含 `xpay_goods_deliver_notify → vp_deliver`。
- [ ] **10.** （可选兜底）若担心推送丢失，可加一个**定时触发器**每 5 分钟调 `vp_query` 扫描 `vp_orders` 中 `pending` 订单补发货（见 `cloudfunctions/README.md`）。

### 3.4 前端配置
- [ ] **11.** `utils/config.js` 核对（**当前代码已填好，只需确认与你后台一致**）：`VIRTUAL_PAY.enabled = true`、`cloudEnv = 'cloudbase-d8ge1hu2324c8fcdf'`、`offerId = '1450652139'`、`priceFen = 990`（须与后台道具价格一致）。若你的环境 ID / OfferID 不同，改这里。
- [ ] **12.** MP 后台「虚拟支付 → 道具管理」已创建**4 个**道具并**发布**（发布后等几分钟到半小时全平台同步，否则下单报 `COIN_OR_PRODUCT_ID_CREATED_IN_RECENTLY`）。道具图用 PNG/JPG、200×200、<200KB；道具 ID/名称仅后台可见。

  | 道具 ID（须与代码完全一致） | 价格 | 说明 | 单价 |
  |---|---|---|---|
  | `comic_full` | ¥9.9（990 分） | 整本解锁 | — |
  | `points_200` | ¥6（600 分） | 200 积分 | 33.3 积分/元 |
  | `points_800` | ¥18（1800 分） | 800 积分 | 44.4 积分/元 |
  | `points_2500` | ¥50（5000 分） | 2500 积分 | 50 积分/元（角标「最超值」） |

  - 单价刻意**递增**（大包更划算），由 `test_constants_sync.js` 断言锁定；改价若调出倒挂会立刻测试失败。
  - `productId` 的数字后缀必须等于到账积分数（同样有断言），改数量时**必须连 ID 一起改**。
  - 道具 ID / 价格**发布后一般不可修改**，需要用新 ID 重建（旧的先下架）。
    ⚠️ 2026-09-17 20:15 调价：三档原为 `points_2000`(¥50→2000)，现为 **`points_2500`(¥50→2500)**。若你已建过 `points_2000`，请改建 `points_2500` 并把旧的 `points_2000` 下架。
  - 改档位后跑 `node test/test_constants_sync.js`（或总入口 `node test/run_all.js`）校验代码 4 处同步（会比对单价、积分数量、档位集合、ID 与数量是否脱钩、单价是否递增、角标是否打对档）。
- [x] **13.** iOS：MP 后台已配置「小程序简称」+ 开通苹果 IAP（**2026-09-18 快照 line26 确认「已配」**）。否则 iOS 真机报"当前商户尚未开启 iOS 支付"。提审前如有 iOS 真机建议再验一次。

---

## ④ 上线前真机验证（必须做）

### 4.1 分包加载（本次新增，先验）
- [ ] **14.** 重新打开项目后真机预览：首页点任一章节 → 能正常跳到阅读页并**加载出图片**（若白屏/图片 404，检查是否漏改 `reader.js` 的 `PANEL_BASE` 或 `onShow` 那处路径）。
- [ ] **15.** 阅读页解锁后**返回再进一次**（走 `onShow` 重载路径）：图片仍正常显示——这处曾是最容易漏改的地方。

### 4.2 支付与解锁（金额用 ¥1 级或真实档位，测试环境可先小额）
- [ ] **16.** 真机**预览即可支付测试**（预览态能拉起真实支付，不必先发布）：第 1 话免费读 → 其余锁定 → 购买页点「方式一·微信支付」→ 拉起支付。
- [ ] **17.** 完成支付 → 打开云开发「日志」看 `vp_deliver` 是否收到 `xpay_goods_deliver_notify`，返回 `ErrCode:0`。
- [ ] **18.** 查 `vp_users` 集合：该 openid 文档出现 `unlockedAll: true`。
- [ ] **19.** 返回阅读页：整本解锁、各话可看；杀进程重进仍解锁（以服务端为准）。
- [ ] **20.** MP 后台「虚拟支付 → 交易订单」能看到这笔订单，金额与账单一致。

### 4.3 积分与每日签到
- [ ] **21.** 三档充值到账正确：¥6→**200**、¥18→**800**、¥50→**2500**（充值后查 `vp_users.points` 增量）。
- [ ] **22.** **买整本不冲掉积分**：先充值有余额 → 再买整本 → `points` 数值**不变**（解锁与积分是两套记账，勿混）。
- [ ] **23.** 每日签到：当天首次进入自动加分；**再次进入不重复加**（看 `lastDailyDate` 是否等于今天、`points` 是否只增一次）。
- [ ] **24.** 朋友圈文案：首次生成 **−20**；写修改意见「换一批」**−15**（复购优惠）；生成**失败要退回积分**。

### 4.4 AI 生成（依赖 `ai_gen` 外网 + `LLM_*` 环境变量）
- [ ] **25.** `ai_gen` 能正常生成（说明「允许外网访问」已开、`LLM_API_KEY`/`LLM_MODEL` 正确）。
- [x] ~~**26.** `send_email` 能收到邮件~~ —— **该功能已取消**（2026-09-18）；脚本改为前端「复制脚本」按钮带走，无需再验邮件。

### 4.5 iOS
- [x] **27.** iOS 额外：用 iOS 真机微信 ≥ 8.0.68 走一遍以上流程，确认 Apple IAP 拉起成功（2026-09-18 已配，见 13）。

> 费率：Android 1% / iOS 12%（Apple 佣金）；全终端月限额 10 万元。标准微信支付与手机号登录仍仅限个体户/企业。
> 一次性跑完本地全部自动检查：`node test/run_all.js`（语法检查 + 红线/分包/云函数闸门 + 11 套件）。

---

## ⑤ H5（公众号投放）部署 —— 独立于小程序上线

H5 是**另一条投放链路**（公众号文章 / 菜单 / 阅读原文），与小程序审核互不阻塞。
完整说明见 **`h5/README.md`**，这里只列需要**人工**做的动作（CLI 做不了）。

### 5.1 必须人工的（CLI 无法代劳）

- [ ] **28.** 云开发控制台 → **HTTP 访问服务**，加两条路径映射：
      `/h5api` → `ai_gen`、`/h5req` → `h5_request`。
      （`cli.bat cloud` 无 service 子命令，`tcb` 报 `DescribeCloudBaseGWAPI service evil` → 只能手工点。）
- [ ] **29.** 云开发控制台 → 数据库 → 新建集合：`h5_usage`（H5 文案日额度）、
      `h5_requests`（定制线索）、`h5_req_usage`（提交限流）。
- [ ] **30.** `h5_request` 的环境变量（**按函数隔离，`custom_request` 配过也要再配一次**）：
      `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_CHAT_ID`。
      不配也能跑（只落库、不推送，线索不会丢）。
- [ ] **31.** 小程序码图片放到 `h5/assets/` 下，`h5/assets/config.js` 的 `mpQr` 填相对路径。
      不配时页面只能退化成「在微信里搜索小程序名」，转化会明显变差。
- [ ] **32.** 正式投放前换**已备案域名**：云开发 HTTP 访问服务的默认域名仅供调试，
      微信内未备案域名会被拦截；绑好备案域名后把 `config.js` 的 `api`/`apiReq` 一起改掉，
      静态页也挂到同域名下（顺带免跨域）。

### 5.2 上线前验证

- [ ] **33.** 推送链路自检：
      `curl -X POST "https://<域名>/h5req" -H "Content-Type: application/json" -d '{"action":"test_notify"}'`
      → 返回 `{"ok":true,"configured":true}`，飞书群收到自检消息。
- [ ] **34.** 样板间走一遍：公众号里打开 `comic.html` → 免费试读 2 集能正常翻 → 填需求提交 →
      拿到 6 位取件码 → `h5_requests` 里出现该条（`paid:false` / `status:'lead'`）。
- [ ] **35.** **合规复核**：页面上「AI 生成」标识常驻可见、**没有任何「生成」按钮**、
      未出现工程路径（如 `config.js`）泄漏给客户。
      （本地 `node test/test_h5_comic.js` 第 6/7/9/9b 条已守，但线上再过一眼实物。）
- [ ] **36.** 提交限流：同一设备连提 4 次，第 4 次应返回「今天提交得有点多」；重复提交同一内容应返回**同一个取件码**。

