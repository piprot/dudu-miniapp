# 云函数部署说明（微信云开发）

本目录下的云函数分为两套：

## 一、个人虚拟支付（个人主体首选，无需公司）

官方文档：<https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html>

| 云函数 | 触发方式 | 职责 |
|---|---|---|
| `vp_create_order` | 普通云函数（前端 `wx.cloud.callFunction` 调用） | 用 `wx.login` 的 code 换 sessionKey；**按服务端道具目录 `PRODUCTS` 取价（前端传的 `priceFen` 一律忽略，防篡改）**；生成 outTradeNo；构造 signData；用 AppKey 算 `paySig`、用 sessionKey 算 `signature`；落 `vp_orders`；返回 `signData/mode/paySig/signature` 给前端拉起 `wx.requestVirtualPayment` |
| `vp_deliver` | **两种形态都支持**：① 云函数模式（本项目实际使用，事件为已解析对象，无 body/无签名）② HTTP 触发（原始 XML + `signature` 验签） | 接收 `xpay_goods_deliver_notify` → **不采信推送里的 `OpenId`/`ProductId`，一律以 `vp_orders` 落库值为准** → **发货前调 `xpay/query_order` 确认真实已支付**（云函数模式没有签名，这是唯一真伪防线；且 outTradeNo 下单时就返回给前端，攻击者可拿未支付订单号直调本函数）→ 乐观锁 CAS 幂等（`pending`→`delivered` 只成功一次）→ **按 `PRODUCTS[productId].kind` 发货**（`points` 加积分 / `unlock` 解锁整本；未登记道具不发货），一律 `update` 合并写入（不用 `set`，避免清空用户积分/优惠券）→ 返回 `<xml><ErrCode>0</ErrCode></xml>` |
| `vp_query` | 普通云函数 | 兜底查单：推送丢失时主动调 `xpay/query_order`，查到已支付则从 `vp_orders` 取本单 `productId`、**按同一套道具目录补发货**（早期版本"查单即解锁整本"会发错货） |
| `vp_get_profile` | 普通云函数 | 读 `vp_users` 返回当前用户解锁态（openid 由云开发自动注入） |

> ⚠️ **道具目录在 4 处各存一份**（`utils/config.js` 的 `POINTS.packs` + 上述三个云函数的 `PRODUCTS`）——云函数独立打包，无法跨包 require 前端 config。
> 改档位/价格后**必须跑** `node test/test_constants_sync.js`，它会比对四处的单价、积分数量与档位集合，专门拦"改一处忘三处"。

### 环境变量（云开发控制台 → 环境变量，切勿写进代码）

| 变量 | 说明 |
|---|---|
| `VP_APP_ID` | 小程序 AppID（MP 后台「设置」） |
| `VP_APP_SECRET` | 小程序 AppSecret（MP 后台「开发设置 → 开发密钥」） |
| `VP_OFFER_ID` | 虚拟支付商户号（MP 后台「虚拟支付 → 基本配置」） |
| `VP_APP_KEY` | 现网 AppKey（MP 后台「虚拟支付 → 基本配置」；**仅服务端用**） |
| `VP_PUSH_TOKEN` | **仅 HTTP 触发模式需要**：与 MP 后台「消息推送」的 Token 一致，用于校验推送来源。云函数模式（本项目实际使用）没有签名，可不配——真伪由 `vp_deliver` 的查单验真兜住 |

### 数据库集合

- `vp_orders`：`{ outTradeNo, openid, productId, priceFen, status('pending'|'delivered'), wxOrderId, createTime, deliverTime }`
- `vp_users`：`{ openid, unlockedAll, productId, updateTime }`（文档 ID = openid）

### 部署步骤

1. 开通微信云开发，拿到环境 ID 填到 `utils/config.js` 的 `VIRTUAL_PAY.cloudEnv`，并建集合 `vp_orders`、`vp_users`。
2. 云开发控制台配置上述环境变量（`vp_deliver` 也需 `VP_APP_ID`/`VP_APP_SECRET`/`VP_APP_KEY`，它要自查单）。
3. 右键 `vp_create_order` / `vp_query` / `vp_get_profile` / `vp_deliver` →「上传并部署：云端安装依赖」。
4. 绑发货推送（**云函数模式，推荐，无需 URL**）：
   ```bash
   wechatide -c WorkBuddy cloud_manage_msg_push --appid <appid> --env <envId> \
     --function-name vp_deliver --action subscribe
   wechatide -c WorkBuddy cloud_manage_msg_push --appid <appid> --env <envId> \
     --function-name vp_deliver --action setEnable --enable
   ```
   （`subscribe` 缺省 `--event-types` 时默认订阅虚拟支付 7 事件。备选：IDE「云开发控制台 → 消息推送」面板手工添加。）
   HTTP 触发模式仍可用（函数开启 HTTP 触发 + 把地址填到 MP 后台消息推送 + 配 `VP_PUSH_TOKEN`），但本项目不需要。
5. `utils/config.js` 设 `VIRTUAL_PAY.enabled=true`、`offerId`、确认 `priceFen` 与后台道具价格一致。
6. 真机小额测试：购买 → 拉起支付 → 后台收到 `xpay_goods_deliver_notify` → `vp_users` 出现 `unlockedAll=true` → 阅读页整本解锁。

> 签名算法（务必与官方一致）：`paySig = HMAC-SHA256(AppKey, "requestVirtualPayment&" + signData)`；`signature = HMAC-SHA256(sessionKey, signData)`；`signData` 为订单参数的 JSON 字符串（键顺序固定，前后端一致）。

---

## 二、标准微信支付（个体工商户 / 企业）—— 已移出活动层

> **个人主体小程序禁用此路径**：`wx.requestPayment`（JSAPI）与 `getPhoneNumber`（手机号快速验证组件）均仅限非个人主体（个体户/企业且已认证）。本仓库以个人虚拟支付为唯一付费通道，故将个体户 JSAPI 实现移出云函数活动根目录，避免误部署或触发审核风险。
>
> - 云函数参考实现（已移除、仅留作参考）：`cloudfunctions_deprecated/login`、`createOrder`、`payNotify`、`getProfile`。
> - 自建服务器版下单示例（不参与上传，仅文档）：`server/wechatpay_example.js`。
>
> 若后续升级为个体户/企业主体，再从 `cloudfunctions_deprecated/` 恢复并参照 `server/wechatpay_example.js` 部署即可。

---

## 三、内容生成 / 需求收集（与支付无关）

| 云函数 | 触发方式 | 职责 |
|---|---|---|
| `ai_gen` | ① 小程序 `wx.cloud.callFunction`（走积分）② **HTTP 访问服务**（H5 通道，走日额度） | 朋友圈文案生成。同一份函数按调用形态分叉：小程序侧扣积分、H5 侧按「设备标识 + IP」双桶日额度限流（`H5_FREE_DAILY`，计数落 `h5_usage`）。H5 分支**不碰积分**（`test/test_h5_parity.js` 第 9/10 条守）。 |
| `custom_request` | 小程序云函数 | **付费后**收「完整故事 + 邮箱」（`STORY_MAX=30000`），带 `outTradeNo`，落 `custom_comic_requests`，推飞书群，人工 8 小时回邮履约。依赖 `cloud.getWXContext().OPENID`，故**只在小程序里可用**。 |
| `h5_request` | **HTTP 访问服务**（建议路径 `/h5req`） | **付款前**收「故事梗概 + 邮箱 + 档位偏好」= **线索**，落 `h5_requests`（`paid:false` / `status:'lead'`），返回 6 位取件码，推飞书群。⛔ **不调用任何生成接口**——H5 前台不开放自助生成（自助文生图属深度合成服务，须企业主体算法备案）。 |
| `points` | 小程序云函数 | 积分账本（余额在 `vp_users.points`，openid 维度原子增减）。 |

> ⚠️ **`custom_comic_requests` 与 `h5_requests` 必须分开**：
> 前者是**已付款订单**（履约依据），后者是**未付款线索**。
> 混进一个集合，运营会误把未付款的线索当订单去履约。
> `test/test_h5_comic.js` 第 12 条会拦。

### h5_request 的环境变量

与 `custom_request` **同名同义**：`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_CHAT_ID`。

> ⚠️ 微信云函数的**环境变量按函数隔离** —— `custom_request` 配过的，`h5_request` 要再配一次。
> 不配也能跑：只落库、不推送，线索不会丢（返回里会标 `notify='未配置通知通道（仅落库）'`）。
>
> 自检推送链路：
> ```bash
> curl -X POST "https://<你的域名>/h5req" -H "Content-Type: application/json" \
>   -d '{"action":"test_notify"}'
> ```

### HTTP 访问服务只能控制台手工配

`/h5api` → `ai_gen`、`/h5req` → `h5_request` 两条路径映射**无法用 CLI 完成**
（`cli.bat cloud` 无 service 子命令；`tcb` 会报 `DescribeCloudBaseGWAPI service evil`）。
详细步骤见 `h5/README.md` 的「部署」一节。

