# 密钥与部署填写模板（本地文件，勿提交到仓库）

本模板把「你列的 MP 操作」里**需要真实值**的部分集中起来，并标明每个值落到哪里。
填好后，本地工程即到「一键部署」状态；**控制台点击类目/隐私发布/道具发布/绑推送 + 真机 ¥1 测试**仍须你本人做（见 `MP_OPERATIONS.md`）。

## 你要提供的剩余值（来源：MP 后台 / 云开发控制台）

> ✅ **`appid` 已提供并写入** `project.config.json`（= `wxacf98605ac5b0218`），**Redline A 已清除**。下方为仍需你提供的 2 项（appid / appSecret / cloudEnv 已给）。

| 字段 | 来源位置 | 落点 | 状态 |
|---|---|---|---|
| `appid` | MP「设置 → 基本设置」 | `project.config.json` 的 `appid` | ✅ 已填 `wxacf98605ac5b0218` |
| `cloudEnv` | 云开发控制台环境 ID | `utils/config.js` → `VIRTUAL_PAY.cloudEnv` | ✅ 已提供（已写 config.js） |
| `offerId` | MP「支付与交易 → 虚拟支付 → 基本配置」 | `utils/config.js` → `VIRTUAL_PAY.offerId`（已填 `1450652139`；运行时以云环境变量 `VP_OFFER_ID` 为准） | ✅ 已提供 `1450652139` |
| `appSecret` | MP「开发 → 开发设置 → 开发者密钥」 | **云开发环境变量 `VP_APP_SECRET`（不进代码）** | ✅ 已提供（配 VP_APP_SECRET，勿进代码/勿提交） |
| `appKey` | MP「虚拟支付 → 基本配置」现网 AppKey | **云开发环境变量 `VP_APP_KEY`（不进代码）** | ✅ 已提供（现网；另给沙箱 AppKey，仅测试用） |
> ⚠️ **`VP_APP_ID` 环境变量必须与 `project.config.json` 的 `appid` 完全一致（= `wxacf98605ac5b0218`）**。`vp_create_order` 用它调 `code2Session` 换 sessionKey，填错会导致登录态获取失败、下单报「登录态获取失败」。

> `priceFen` 已固定为 `990`（=¥9.9），与后台道具价格一致，无需再填。
> `appSecret` / `appKey` **严禁写进代码仓库**——只配到云开发环境变量，前端/云函数从 `process.env` 读取。

## 填写示例（替换成你的真实值）

```json
{
  "appid": "wxacf98605ac5b0218",
  "cloudEnv": "cloud1-abcdefg1234567",
  "offerId": "1450652139",
  "appSecret": "（只配云开发环境变量 VP_APP_SECRET，不填进代码）",
  "appKey": "（只配云开发环境变量 VP_APP_KEY，不填进代码）"
}
```

## ③ 云环境变量最终取值（请粘贴到云开发控制台 → 环境变量，按环境 ID）
> appid / cloudEnv / offerId 我已写入代码；以下 4 项在云控制台配（密钥仅存环境变量，绝不进代码/仓库）。

| 变量 | 取值 |
|---|---|
| `VP_APP_ID` | `wxacf98605ac5b0218`（须与 project.config.json 的 appid 一致） |
| `VP_APP_SECRET` | 你持有的小程序 AppSecret |
| `VP_OFFER_ID` | `1450652139` |
| `VP_APP_KEY` | 你持有的**现网** AppKey（沙箱 AppKey 仅沙箱测试用，现网验证用现网） |

- 我侧已落盘：appid(config)、cloudEnv(config)、offerId(config)。appKey/appSecret **仅存云环境变量**，不写前端/云函数代码（`vp_create_order`/`vp_query` 运行时读 `process.env`）。
- 另有第 5 个可选但**强烈建议**配置的环境变量 `VP_PUSH_TOKEN`（发货推送来源校验，防伪造通知白拿货）→ 见 **⑧**。

## ④ 豆包（火山方舟）环境变量（ai_gen 云函数用）
> 用户指定润色必须用豆包，其他模型不行。`ai_gen` 调火山方舟 OpenAI 兼容接口。
> 端点固定 `https://ark.cn-beijing.volces.com/api/v3/chat/completions`，密钥仅存环境变量，不进代码。

| 变量 | 取值 |
|---|---|
| `LLM_API_KEY` | 你的火山方舟 API Key（控制台「API Key 管理」创建，个人实名也可） |
| `LLM_BASE_URL` | 可省略，默认 `https://ark.cn-beijing.volces.com/api/v3` |
| `LLM_MODEL` | 你的豆包接入点 ID（如 `ep-xxxxxxxx`，控制台「接入点详情」获取；必填） |

- 与 `VP_*` 同样：只配云函数环境变量，绝不写进仓库/前端代码。`ai_gen/index.js` 运行时读 `process.env`。

## ⑤ ~~邮件发送环境变量~~（已取消，2026-09-18）
> 原「分支②：把连环画脚本发到邮箱」及 `send_email` 云函数（nodemailer + `SMTP_*`）已整体移除，
> 脚本改为前端 **「复制脚本」** 按钮带走（`pages/gen/gen.wxml` + `gen.js` 的 `onCopyPolished`）。
> ⇒ **不再需要 `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` 任何一个密钥**；
> 若你已在云开发控制台配过，可以直接删掉。（章节号保留，避免打乱下方 ⑥ / ⑦ / ⑧ 的互引。）

## ⑤·补 飞书群机器人 webhook（定制单通知运营者，可选）
> 用途：客户在 commission 页提交定制需求 → `custom_request` 云函数**先落库、再推飞书群**，
> 把「故事全文 + 补充说明 + 订单号 + 邮箱 + 文档 ID」推给你，不用盯云开发控制台。
> **不配也能用**：只落库、不推送（文档 `notify` 字段明确写「未配置 webhook（仅落库）」），**绝不丢单**。

| 变量 | 必填？ | 长什么样 | 从哪拿 |
|---|---|---|---|
| `FEISHU_WEBHOOK` | **必填才推送** | `https://open.feishu.cn/open-apis/bot/v2/hook/2f1c…`（一串 UUID） | 飞书群 → 设置 → 群机器人 → 添加机器人 → **自定义机器人** → 复制 webhook 地址 |
| `FEISHU_WEBHOOK_SECRET` | 可选 | 形如 `Kx9p…` 的串 | 建机器人时「安全设置」勾了**签名校验**才有；选「自定义关键词」则不需要 |

**安全设置怎么选**（建机器人那一步会问你，三个选一个）：
- ✅ **推荐：自定义关键词 = `新定制单`** —— 推送标题固定为「新定制单 · <档位> ¥<金额>」，
  `post` 富文本与降级 `text` **两条路径都带这个标题**，所以一定命中。**不用把密钥给我。**
- ✅ 也可以选**签名校验**，把那串 secret 一起给我（代码已支持 `timestamp` + `sign`）。
- ❌ **别选 IP 白名单** —— 云函数出口 IP 是动态的，会随机被拒。

**怎么下发**（不用手填控制台，仓库已有官方接口脚本，改环境变量**不需重新部署代码**）：
```bash
python tools/set_cloudfn_env.py --secrets-file <临时目录密钥JSON> --dry-run   # 先看计划，不调接口
python tools/set_cloudfn_env.py --secrets-file <临时目录密钥JSON>             # 写入 + 回读校验
```
（把 `FEISHU_WEBHOOK` / `FEISHU_WEBHOOK_SECRET` 加进那个 JSON 即可；脚本会顺带把 `custom_request` 超时设成 20s。）

**配完怎么验**（唯一不产生真实订单就能验通链路的手段）：
```
custom_request { action: 'test_notify' }
```
→ 返回 `{ok:true, configured:true}` 且飞书群收到一条「新定制单 · 自检 ¥0.00」即为成功。

## ⑥ 积分充值包（个人虚拟支付 · 虚拟商品名义）
> 积分充值走「个人虚拟支付·个人」，名义=「购买虚拟商品（生成额度包）」，积分是附属记账单位，绝不当作法币/可提现代币宣传（个人主体合规红线）。
> 每个 pack 对应 MP 后台一个虚拟支付道具（productId），`priceFen` 须与后台道具价格**完全一致**（`priceFen = 元 × 100`）。
> ⚠️ 道具 ID / 价格发布后一般不可修改，改档位需**新建道具**（旧的先下架）；以 MP 后台实际规则为准。

**当前档位（三档，改这里必须同步 4 处：`config.POINTS.packs` + 三个云函数的 `PRODUCTS`）**

| 档位 | productId（MP 后台建同名道具） | 价格 | priceFen | 积分 | 单价 |
|---|---|---|---|---|---|
| 一档 | `points_200` | ¥6 | `600` | 200 | 33.3 积分/元 |
| 二档 | `points_800` | ¥18 | `1800` | 800 | 44.4 积分/元 |
| 三档 | `points_2500` | ¥50 | `5000` | 2500 | 50 积分/元（角标「最超值」） |
| 整本（非充值） | `comic_full` | ¥9.9 | `990` | — （解锁整本） | — |

- 单价刻意**递增**（大包更划算）。2026-09-17 20:15 用户拍板把三档从 ¥50→2000 调为 **¥50→2500**，修正了原先"18 元档比 50 元档更划算"的倒挂；道具 ID 同步改为 `points_2500`（若已建过 `points_2000` 需改建并下架旧的）。
- **`productId` 的数字后缀必须等于到账积分数**——只改数量不改 ID 会留下"`points_2000` 实发 2500"的误导档位，且所有既有测试仍会通过。改数量时**必须连 ID 一起改**（有断言守着）。
- **一致性由测试自动保证**：`node test/test_constants_sync.js` 会比对 config 与 3 个云函数的 `PRODUCTS`（含单价、积分数量、档位集合、`priceText` 与 `priceFen` 是否对得上、ID 后缀与数量是否脱钩、单价是否单调递增、`tag` 是否打在最高单价档），以及 `POINTS.daily`↔`DAILY`、`POINTS.cost`↔`POINTS_COST`、`POINTS.earn`↔`POINTS_EARN`（第 15 条：拦"界面承诺了赚分、却没有任何云函数发放"的空头承诺）、前端 gen 页价格回退值。改档位/改价后**必须跑这个测试**（或总入口 `node test/run_all.js`），它专门拦"改一处忘三处"导致线上少发/多发积分。
- `POINTS.rechargeEnabled` 可一键关闭充值（关闭后积分只靠免费行为赚取：**新人礼 100 + 每日签到**）。
- `POINTS.redeem` 为「积分兑换」目录（花积分换 app 内权益），可自行增删。
- **定价权在服务端**：`vp_create_order` 只认 `productId`，价格取服务端 `PRODUCTS`，**前端传的 `priceFen` 一律忽略**（早期版本采信前端传价，可被篡改成 1 分钱白拿）。
- **发货语义**（`vp_deliver` / `vp_query` 同一套）：`kind:'points'` → 给该 openid `db.command.inc(points)` 加积分、不解锁整本；`kind:'unlock'` → 置 `unlockedAll=true`（**用 update 合并，绝不用 set 覆盖**，否则会清空用户已赚的积分/优惠券）；**未登记的 productId → 不发货**（防伪造通知白拿）。
- **积分口径**（须与 `ai_gen`/`points` 云函数内的常量一致）：
  - 赚：**新人礼 `+100`**（每个用户**首次进入一次性**，`points` 云函数 `SIGNUP` + `vp_users.signupBonusAt` CAS 幂等）· **每日签到 base=20**（连签每天递增 +1、封顶 +10；每连签 7 天额外 +15）
    - ~~发到邮箱 `+10`（`send_email`）~~ 已随邮件功能取消（2026-09-18）。
    - ~~生成连环画脚本 `+30`（`ai_gen` mode=comic）~~ **已整体移除（2026-09-19）**：用户拍板「逻辑上不能有生成连环画脚本这一步，只能有付费生成连环画」。
      连环画只能走**付费定制**（`pages/commission` → ¥66/¥88 → 人工绘制），脚本是履约内部工作稿，不对用户生成、也不送积分。
      ⇒ 赚取行为只剩「新人礼」与「签到」两项；`ai_gen` 现在**唯一产出 = 朋友圈文案**，显式传其他 `mode` 一律明确报错（不静默降级）。
  - 花：生成朋友圈防折叠文案 `−20`（**首次**）· 写修改意见「换一批」再出 3 条 `−15` · 积分兑换权益（`points` action=spend，写 `vp_users.coupons`）
    - **`15 < 20` 是有意设计的复购优惠**（用户 2026-09-17 确认），不是笔误：用户对结果不满意时降低"再试一次"的门槛。**请勿调平/调高**——`test_constants_sync.js` 第 12 条会断言这一点；第 13 条还会检查"复购优惠"字样在 `gen.wxml`/`points.wxml` 中真的有展示（优惠要被看见才有效）。真要加强优惠感可调大差值，别取消它。
    - 两个档位都走 `ai_gen` mode=moments：**价格由服务端按「是否带 `feedback`」判定**，前端无法自选档位（否则可把首次也压到 15）；余额守卫原子扣减，生成失败自动退回。
  - 签到配置：`config.POINTS.daily` ↔ `cloudfunctions/points/index.js` 的 `DAILY`，**两处同改**（同样由上面那个测试校验）

## ⑧ 发货推送来源校验（强烈建议配置）
> `vp_deliver` 是 HTTP 触发的**公网地址**。不校验来源时，任何人只要知道这个 URL 就能 POST 一条
> `<ProductId>points_2500</ProductId>` + 自己的 `OpenId`，**白刷 2500 积分**。

| 变量 | 取值 |
|---|---|
| `VP_PUSH_TOKEN` | 自定义一串随机字符串；**同时**填到 MP 后台【开发管理 → 消息推送】的 Token 里（两边必须一致） |

- 校验方式：微信推送时在 URL 上带 `signature`/`timestamp`/`nonce`，服务端按 `sha1(token/timestamp/nonce 按字典序排序后拼接)` 比对。
- **未配置 `VP_PUSH_TOKEN` 时跳过校验**（首次部署不被卡住），但云函数日志会打印告警——**上线前务必配置**。
- 更强方案（可选）：把推送只当"有事发生"的信号，发货前调 `xpay/query_order` 向微信确认已支付（`vp_query` 已有该逻辑）。

## ⑦ 多模态输入（图片 / 文章链接）—— 无需新增密钥
> `ai_gen` 已支持 `imageFileId`（云存储图片）与 `url`（网页正文抓取），仅复用已有 `LLM_*` 环境变量，**不需要新密钥**。

| 依赖 | 说明 |
|---|---|
| 云存储 | 前端 `wx.cloud.uploadFile` 上传到 `gen-input/`，`ai_gen` 用 `cloud.downloadFile` 读回（同环境，无需额外权限配置） |
| 出网 | `ai_gen` 需启用外网访问（抓文章正文要用）；若云函数未开外网，`url` 分支会返回「抓取失败」 |
| 限制 | 图片 ≤1 张 / ≤8MB；正文抓取 ≤600KB、提取上限 4000 字；合并后输入硬上限 6000 字；内网/回环地址被 SSRF 守卫拒绝 |


## 仍需你本人完成的（我无法代劳）
- MP 后台：补挂「工具」类目、发布《隐私保护指引》、虚拟支付开通 + 道具 `comic_full`(990) 发布。
- 云开发控制台：配 4 个 `VP_*` 环境变量、上传 `vp_*` 并开启 `vp_deliver` 的 HTTP 触发、把触发 URL 绑到消息推送。
- 真机：¥1 级支付 → 确认 `vp_deliver` 收 `xpay_goods_deliver_notify` → `vp_users` 解锁 → 阅读页整本解锁。
