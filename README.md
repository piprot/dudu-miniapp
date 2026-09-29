# dudu画面感内容工具 · 连环画小程序（把文章和故事做成漫画）

原生渲染的微信小程序，承载你的故事连环画（32 张 JPEG 面板），内置「整本购买」付费门禁。
付费采用**双策略**设计：① 个人虚拟支付（官方「虚拟支付·个人」，**无需注册公司**，首选）② 兑换码兜底（任意主体可用，本地校验）。标准微信支付 JSAPI（`wx.requestPayment`，需个体工商户/企业商户号）已**移出活动层**，参考实现见 `cloudfunctions_deprecated/` 与 `server/wechatpay_example.js`。

> **个人主体现已可直接收钱**：微信官方「虚拟支付·个人」能力已向**个人主体**开放——无需注册公司/个体户，只要小程序类目含「工具」、已完成认证与备案，并用微信云开发做服务端即可。本文把**个人虚拟支付**作为个人主体的首选付费路径；赞赏码方案保留为兜底。
> 官方文档：<https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html>

---

## 一、目录结构

```
comic_miniapp/
├── app.js / app.json / app.wxss       # 入口；useCloud 时初始化 wx.cloud
├── project.config.json                # appid=wxacf98605ac5b0218（真实）；cloudfunctionRoot 指向云函数
├── sitemap.json
├── panels/                            # 32 张 480w JPEG 面板（已打进主包，1.67MB < 2MB）
├── images/reward_qr.png               # 赞赏码占位图（请替换为你的收款码截图）
├── pages/
│   ├── index/                         # 首页：章节列表 + 手机号一键登录入口 + 购买入口
│   ├── reader/                        # 阅读页：纵向瀑布流展示某话面板
│   └── pay/                           # 购买页：两种支付方式
├── utils/
│   ├── config.js                      # 产品/章节/支付/后端配置（改这里）
│   ├── store.js                       # 解锁状态（本地 + 服务端合并）
│   ├── login.js                       # 登录管理（wx.login 静默 + 手机号一键登录）
│   ├── pay.js                         # 支付策略（虚拟支付 / 微信支付 / 赞赏码兑换）
│   └── ios.js                         # iOS 端微信版本校验（虚拟支付需 ≥ 8.0.68）
├── cloudfunctions/                    # 微信云开发云函数
│   ├── vp_create_order/               # 虚拟支付·下单签名（paySig + signature）
│   ├── vp_deliver/                    # 虚拟支付·发货推送（HTTP 触发）→ 置解锁
│   ├── vp_query/                      # 虚拟支付·查单兜底
│   ├── vp_get_profile/                # 虚拟支付·解锁态查询
│   ├── login/                         # 换 openid / 手机号落库（个体户路径）
│   ├── createOrder/                   # 微信支付 JSAPI 统一下单（个体户路径）
│   ├── payNotify/                     # 支付结果通知（HTTP 触发）→ 置解锁（个体户路径）
│   ├── getProfile/                    # 查当前用户解锁态（个体户路径）
│   └── README.md                      # 云函数部署说明
└── server/
    └── wechatpay_example.js           # 自建服务器版下单示例（不参与上传）
```

## 二、本地预览（无需注册）

1. 下载[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 「导入项目」→ 目录指向 `comic_miniapp/` → AppID 已预填 `wxacf98605ac5b0218`（确认是自己的小程序，即可编译预览 / 提交）。
3. 首页第 1 话免费读；其余 7 话锁定 → 购买页 → 输入演示兑换码 `MEIXI2026` 或 `COMIC666` 即解锁（模拟付费）。

## 三、改成你自己的内容

- 标题/作者/价格：`utils/config.js` 的 `PRODUCT`。
- 章节与面板：把 JPEG 放进分包 `packageReader/panels/`，按 `e{话}_{格}_sm.jpg` 命名，更新 `PRODUCT.chapters`。
  **不要用 webp**：小程序 `<image>` 的 webp 在真机上整片空白（开发者工具用 webview 渲染，本地看不出），详见 `tools/webp_to_jpg.py`。
- 想上更高清：把 682w 的 `e01_p01.jpg` 放进**分包**（subpackage），主包仅留缩略图预览，避免超 2MB。

## 四、付费与登录：主体类型决定你能做什么（关键）

> **硬性规则**：① 微信支付、② `getPhoneNumber`（手机号快速验证组件）都**仅限非个人主体（个体户/企业/组织）且已完成微信认证**的小程序开放。个人主体这两项都用不了（手机号能力自 2023-08 起还按 ¥0.03/次 收费，有 1000 次体验额度）。

### 4.1 当前已落地的先行方案（个人主体·赞赏码，无需后端即可上线）

购买页「方式二」完整闭环：

1. 读者长按/扫码赞赏页面上的**微信赞赏码**（你把 `images/reward_qr.png` 换成自己的收款码截图）；
2. 点「**联系作者取兑换码**」→ 调起小程序**客服会话**，把付款截图发给你的客服；
3. 你（或客服）回一个兑换码（当前演示码 `MEIXI2026` / `COMIC666`，可改 `utils/config.js` 的 `redeemCodes`）；
4. 读者输入兑换码 → `utils/pay.js` 校验通过 → `store.unlockAll()` 解锁整本。

> 注意：`redeemCodes` 写在客户端，**可被提取**，仅适合小范围/熟人运营。要防刷、防破解，请用 4.3 的服务端核销。

### 4.2 想真正用微信支付 + 手机号登录 → 升级为【个体工商户】（推荐，成本极低）

1. 当地市场监管局 / 政务 App 线上注册「个体工商户」，多数地区免费、当天拿证（只需身份证 + 经营场所）。
2. 微信公众平台把小程序主体注册/变更为「企业/个体户」，完成微信认证（300 元/年）。
3. 开通**微信支付商户号**（mchid），在商户平台关联该小程序 AppID；申请 **APIv3 密钥** 与 **商户证书**。
4. 开通**微信云开发**，得到环境 ID 填到 `utils/config.js` 的 `BACKEND.env`；新建数据库集合 `users`、`orders`。
5. 从 `cloudfunctions_deprecated/` 恢复个体户云函数（`login/createOrder/payNotify/getProfile`，见 `cloudfunctions/README.md` 第二节），并在云开发控制台配置环境变量（商户密钥，**切勿写进代码**）。
6. `utils/config.js` 把 `BACKEND.useCloud = true`、`PAY_CONFIG.wechatPayEnabled = true`；并在 `utils/pay.js`、`pages/pay`、`pages/index`、`utils/login.js` 中恢复 `payByWechat`/`onWechatPay`/`getPhoneNumber` 登录栏（当前活动源码已移除这些，需从 git 历史或 `server/wechatpay_example.js` 参考补回）。
7. 重新编译：首页出现「手机号一键登录」按钮；购买页可启用个体户微信支付。

### 4.3 手机号一键登录（仅非个人主体）

- 采用微信官方 `getPhoneNumber` 组件：`<button open-type="getPhoneNumber" bindgetphonenumber="onPhoneLogin">`。
- 该按钮**必须由用户主动点击**，不能静默（隐私规则）。点击后微信回传 `code`，云函数 `login` 用云开发 `access_token` 调 `getuserphonenumber` 换明文手机号并落库。
- `wx.login` 在 `ensureLogin` 中静默执行，用于拿 openid 作为用户主键；已登录态本地缓存，下次启动自动恢复。
- 前端逻辑见 `utils/login.js` + `pages/index` 的登录栏；后端见 `cloudfunctions/login`。

### 4.4 服务端解锁（修掉「客户端可被提取」的漏洞）

- 之前本地 `redeemCodes` 在客户端，技术用户可提取白嫖。升级后：
  - 微信支付成功 → 微信回调 `payNotify`（HTTP 触发云函数）→ 解密通知 → 在 `users` 集合把该 openid 置 `unlockedAll=true`。
  - 前端解锁判定 = 本地(赞赏码) **或** 服务端(`store.serverUnlocked`)。即使用户清缓存，重新拉 `getProfile` 仍以服务端为准。
- 赞赏码方案保留为个人主体的兜底；规模化运营建议统一走服务端核销。

## 五、安全边界（诚实说明）

- 小程序主包内容**客户端可见**，本地 `Storage` 解锁是 UX 门禁，不是防盗。
- 真正「不买看不到」必须把付费章节面板放到**服务端**，用户支付成功后再下发（即上面的云开发方案 + 云端存储 + 临时下载域名）。
- 客户端 `redeemCodes` 仅适合熟人小范围；生产请走服务端核销 + 一次性码 + 防刷。

## 六、iOS 支付提示（必读）

- 官方「虚拟支付·个人」**已原生支持 iOS**：iOS 端走 **Apple IAP** 链路，由微信虚拟支付统一封装，无需你自己接 StoreKit。前提：MP 后台配置「小程序简称」+ 开通苹果 IAP，且用户微信客户端 ≥ **8.0.68**（前端 `utils/ios.js` 已做版本拦截）。
- 费率差异：Android 等 **1%**（腾讯技术服务费）；**iOS 12%**（含 Apple 佣金）。结算周期：Android T+3；iOS 约 45–60 天。全终端**月支付限额 10 万元**。
- iOS 退款只能由用户在 App Store 申请，开发者无法主动退款；退款成功会推送 `xpay_refund_notify`，后端按相同逻辑回收道具即可。
- 注意：**标准微信支付（JSAPI，`wx.requestPayment`）在 iOS 卖数字内容仍受 Apple 规则约束**，所以个人主体请走「虚拟支付」而非标准微信支付。

## 七、上线清单

### A. 个人主体·虚拟支付上线（首选，无需公司）

满足硬前置即可用微信官方「虚拟支付」直接收钱：

1. [ ] **类目**：微信公众平台 →「设置 → 基本设置 → 服务类目」确保**含「工具」**（虚拟支付强制要求；漫画/小说类目不满足条件，需补挂一个「工具」类目）。
2. [ ] **认证 + 备案**：个人主体已完成小程序认证与 ICP 备案。
3. [ ] **开通虚拟支付**：MP 后台 →「支付与交易 → 虚拟支付」→ 开通 → 填身份证/提现账户/支付管理员 → 审核（约 5 分钟）→ 扫码人脸签约。
4. [ ] **记参数**：后台「虚拟支付 → 基本配置」拿到 **OfferID**、**现网 AppKey**；「道具管理」创建道具（道具 ID 建议 `comic_full`，价格填 `990` 分 = ¥9.9）并**发布**（发布后等几分钟到半小时全平台同步）。
5. [ ] **开通云开发**：微信开发者工具 → 云开发 → 开通环境，拿到环境 ID；新建数据库集合 `vp_orders`、`vp_users`。
6. [ ] **填配置**：`utils/config.js` 的 `VIRTUAL_PAY` 设 `enabled:true`、`cloudEnv:'你的环境ID'`、`offerId`、`priceFen:990`（appKey **放云函数环境变量 VP_APP_KEY，不要写前端**）。
7. [ ] **部署云函数**：右键上传 `cloudfunctions/vp_create_order`、`vp_deliver`、`vp_query`、`vp_get_profile`（云端安装依赖）；在云开发控制台配置环境变量 `VP_APP_ID / VP_APP_SECRET / VP_OFFER_ID / VP_APP_KEY`（APP_ID/APP_SECRET 在 MP 后台「开发设置」）。
8. [ ] **配发货推送**：本项目推送模式为**云函数模式**（`pushMode=cloudfunction`），用 CLI 把 `xpay_goods_deliver_notify` 绑到 `vp_deliver` 即可（`cloud_manage_msg_push --action subscribe` + `setEnable`），**不需要 MP 后台填 URL**。`vp_deliver` 已兼容云函数模式与 HTTP 触发两种形态；云函数模式下它会先调 `xpay/query_order` 确认已支付再发货（防伪造/防拿未支付订单号白刷），故需配 `VP_APP_ID`/`VP_APP_SECRET`/`VP_APP_KEY`。详见 `DEPLOY_CHECKLIST.md` §3.3。
9. [ ] 用真机小额（¥1 级）测试：购买 → 拉起支付 → 收到发货推送 → `vp_users` 出现该 openid 且 `unlockedAll=true` → 阅读页整本解锁。

> 月支付限额 10 万元（全终端）；iOS 需微信 ≥ 8.0.68 且后台已配置「小程序简称」+ 开通苹果 IAP。详见 `cloudfunctions/README.md`。

### B. 个人主体·赞赏码兜底（任意主体，无需后端）

若虚拟支付暂未开通，保留可用闭环，只需 4 步：

1. [ ] 在 `project.config.json` 把 `appid` 换成你的真实 AppID。
2. [ ] 把 `images/reward_qr.png` 替换成你的微信赞赏码/收款码截图。
3. [ ] MP 后台「客服」模块启用客服会话并绑定你的微信。
4. [ ] `utils/config.js` 填 `authorWechat`，并把 `redeemCodes` 改成你自己的码（默认 `MEIXI2026` / `COMIC666` 仅演示）。

完成后：第 1 话免费 → 其余锁定 → 扫码赞赏 → 点「联系作者取兑换码」发截图 → 你回码 → 读者输入解锁。

### C. 进阶（可选，需个体工商户走标准微信支付）

> 标准微信支付（JSAPI, `wx.requestPayment`）与手机号登录已**移出活动层**，仅留参考实现于 `cloudfunctions_deprecated/` 与 `server/wechatpay_example.js`（均不参与上传）。个人主体请勿部署。

- [ ] 注册个体工商户 → 完成微信认证 → 开通微信支付商户号 → 开通微信云开发
- [ ] 从 `cloudfunctions_deprecated/` 恢复个体户路径（`login/createOrder/payNotify/getProfile`），配置商户密钥环境变量，建 `users`/`orders` 集合
- [ ] `utils/config.js` 设 `BACKEND.useCloud=true`、`PAY_CONFIG.wechatPayEnabled=true`，并在 `utils/login.js` 补回 `ensureLogin`/`loginWithPhone`
- [ ] 此时首页出现「手机号一键登录」，购买页可启用个体户微信支付（原「方式三」）

### D. 通用检查

- [ ] 服务类目含「工具」（虚拟支付硬性要求）；如同时卖实体周边可再挂对应类目
- [ ] 真机预览各机型排版；上传前确认主包 ≤ 2MB（当前 1.67MB 安全）
