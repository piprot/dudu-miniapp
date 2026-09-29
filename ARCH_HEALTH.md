# comic_miniapp 架构健康度评估与风险清单

> 评估日期：2026-09-11　|　对象：`comic_miniapp`（故事连环画小程序 · 个人虚拟支付接入层）
> 方法：实际读取磁盘文件 + `node --check` + `grep` 红线扫描 + 页面调用链核对（非凭记忆）。
> 结论：**代码层健康（绿）；配置层待填（黄）；账号/控制台前置未满足（红，阻塞）**。

> ⚠️ **阅读须知（2026-09-19 追加）**：本文是**按时间顺序累积的变更日志**，早期条目描述的形态**多数已被后续改动取代**。
> 请把下文当**追溯材料**，当前权威状态以这六条为准：
> - 云函数共 **7 个**（后增 `points` / `ai_gen` / `custom_request`）；集成测试 `node test/run_all.js` **127 项全绿**。
> - `ai_gen` **唯一产出 = 朋友圈文案（`mode:'moments'`）**。**没有「生成连环画脚本」这一步**（2026-09-19 用户拍板「逻辑上不能有生成连环画脚本，只能有付费生成连环画」）；显式传其他 `mode` 一律**明确报错、不静默降级**。
> - **邮件链路已移除**（`send_email` / `SMTP_*` / `pages/email`）；出口 = gen 页「复制脚本」（`onCopyPolished`）。
> - 积分：**新人礼 100**（首次进入一次性，`points` 云函数 CAS 幂等）· 每日签到 base=20（连签 +1 封顶 10，每满 7 天 +15）；花费**首次 −20 / 换一批 −15**（有意复购优惠，勿调平）。
> - 文案长度**跟随用户原文**，类型只定结构与语气、**不定长度**（`OUT_LEN_TIERS`：<50→80-150 · 50-199→150-300 · 200-499→250-450 · ≥500→350-700）。
> - 分包：`packageReader` / `packageSample`；**图片一律 JPEG/PNG（R9 禁 webp）**、**`preloadRule` 预下载合计 ≤2MB（R10）**。

---

## 一、总体健康度

| 维度 | 状态 | 说明 |
|---|---|---|
| 代码语法 | 🟢 健康 | 13 个活动 JS `node --check` 全过 |
| 4 个 vp_* 云函数 | 🟢 对齐官方 | 双签名 / outTradeNo / 幂等 / query_order 规范均与官方 Skill 一致 |
| Redline A（AppID） | 🟢 已清 | `project.config.json` 已填真实 `wxacf98605ac5b0218` |
| Redline B（禁 JSAPI） | 🟢 已清 | 活动层零 `wx.requestPayment` / `getPhoneNumber` 调用 |
| Redline C（收款码） | 🟢 已清 | `PAY_CONFIG.rewardEnabled = false` |
| Redline D（隐私授权） | 🟡 部分 | `app.js` 已调 `wx.requirePrivacyAuthorize`；**本次补上 `app.json` 的 `__usePrivacyCheck__: true`**；后台《隐私保护指引》发布仍待用户 |
| 配置层（appKey/VP_*） | 🟡 待粘贴 | `cloudEnv`✅ `offerId`✅(`1450652139`) 已落盘；`appKey`✅已提供；4 个 `VP_*` 待用户在云控制台粘贴（含现网 AppKey） |
| 账号前置（认证/类目/主体/虚拟支付） | 🟢 已满足 | 认证 ok + 虚拟支付**审核已通过**(09-17 15:42 AppKey 已发) + 个人主体+工具类目达标，vp_* 架构有效 |
| 密钥与泄密防护 | 🟢 安全 | 无硬编码密钥；上传私钥在 Desktop 未入仓库；新增 `.gitignore` |

---

## 二、代码层健康（已验证，证据）

- **语法**：`app.js / utils/{config,pay,login,store,ios}.js / pages/{reader,reader.js,pay/pay.js,index/index.js} / cloudfunctions/vp_*/index.js`（共 13 个）`node --check` 全部 OK。
- **Redline B 扫描**：`grep -n "requestPayment|getPhoneNumber"` → 仅命中 `cloudfunctions_deprecated/*`、`server/wechatpay_example.js`（备份，不参与上传）及注释；活动层无真实调用。
- **密钥扫描**：`grep` 真实 AppSecret `6316...fec6` → 0 命中；`appKey`/`appSecret` 仅以 `process.env['VP_APP_KEY'/'VP_APP_SECRET']` 读取与文档占位出现，无硬编码。
- **调用链**：`pages/pay/pay.js → pay.payByVirtual()` 拉起 `wx.requestVirtualPayment` 并乐观置位；`pages/reader/reader.js onShow → pay.confirmVirtualUnlock()` 调 `vp_get_profile` 以服务端为准校正解锁态。推送丢失时由 `reader.onShow` 自愈；`vp_query` 为可选兜底（前端未直接调用，靠定时触发器或校正补偿）。
- **签名正确**：`vp_create_order` 用 `paySig=HMAC-SHA256(AppKey,"requestVirtualPayment&"+signData)`、`signature=HMAC-SHA256(sessionKey,signData)`；`vp_query` 用 `pay_sig=HMAC-SHA256(AppKey,"/xpay/query_order&"+body)`，符合官方规范。
- **幂等**：`vp_deliver` 按 `MchOrderNo`(wxOrderId) 去重，重复推送返回 `ErrCode:0`。

---

## 三、风险清单（按严重度）

### 🟢 风险 1（已闭环）：主体类型分水岭 — 个人路径确认可用
- **进度**：认证 ok(09-17) → 用户已能提交「虚拟支付」入口申请(09-17) → 决定性验证通过：**当前账号满足个人虚拟支付资格（个人主体 + 认证 + 工具类目达标），整套 vp_* 架构有效，无需回退 `cloudfunctions_deprecated/` JSAPI。**
- **结论**：原截图红灯②「主体类型疑似企业/事业单位」已被证伪（能提交虚拟支付即非企业/事业单位限制路径）。

### 🟢 风险 2（已闭环）：appKey 已提供，待配云环境变量
- **状态**：用户 09-17 15:42 提供**现网 AppKey**（另给沙箱 AppKey，仅沙箱测试用）。`vp_create_order`/`vp_query` 运行时读 `process.env['VP_APP_KEY']`，故 AppKey **只配云环境变量，不进代码**（config.js 的 `appKey` 字段保持空串，仅文档用）。
- **剩余动作**：用户在云控制台把 4 个 `VP_*` 一次性粘贴（见第四节）；无需我再改代码。

### 🟡 风险 3：VP_APP_ID 一致性（配置易错）
- **要求**：云环境变量 `VP_APP_ID` 必须与 `project.config.json` 的 appid 完全一致（=`wxacf98605ac5b0218`），否则 `vp_create_order` 的 `code2Session` 失败报"登录态获取失败"。
- **Fix**：部署时在云控制台逐项核对；代码层无法强制，靠清单约束（DEPLOY_CHECKLIST ③.1 + SECRETS模板 警告）。

### 🟡 风险 4：vp_deliver 推送模式（2026-09-17 已解决：改为兼容两种模式）
- **原现象**：文档/代码按「HTTP 触发 + 把 URL 填到 MP 后台」设计，但实测本小程序云开发侧 `pushMode=cloudfunction`（**云函数模式**），
  该模式把事件以【已解析对象】投给云函数，**没有 body、没有签名**。旧版 `vp_deliver` 只读 `event.body`，会把每条真实通知判成
  `Event !== 'xpay_goods_deliver_notify'` → 返回 `ignored` → **付了钱但静默不发货**（旧代码实测"应到账 800，实际 0"）。
- **Fix（已落地）**：`vp_deliver` 现在**两种形态都支持**；云函数模式下真伪由「发货前调 `xpay/query_order` 确认已支付」兜住
  （云函数模式下没有签名，而任何用户都能 `callFunction` 直调本函数、且 outTradeNo 下单时就返回给前端，所以这一闸是必需的）。
  另外推送里的 `OpenId`/`ProductId` **一律不采信**，发货目标与道具以 `vp_orders` 落库值为准。
- **配置**：推送订阅/启用走 CLI（`cloud_manage_msg_push --action subscribe/setEnable`），不需要 MP 后台填 URL（云函数模式后台没有 URL 项）。
  注意 `vp_deliver` 现在还需要 `VP_APP_ID`/`VP_APP_SECRET`/`VP_APP_KEY`（用于查单验真），不只是 `VP_PUSH_TOKEN`。

### 🟡 风险 5：vp_query 成功判定依赖真实 API 字段名
- 代码以 `res.errcode===0 && (res.paid||res.order_state==='PAID'||res.state===2)` 判定已支付；真实响应字段以 ¥1 真单验证时校准。
- **Fix**：真机验证阶段打印 `vp_query` 原始返回，按需调整判定条件（已在代码留 `raw` 回传便于排查）。

### 🟡 风险 6：iOS 额外前置
- iOS 需「小程序简称」+ 苹果 IAP 开通 + 微信 ≥ 8.0.68，否则 iOS 真机报"当前商户尚未开启 iOS 支付"。`pay.js` 已做微信版本门禁，但 IAP/简称配置需用户在 MP 后台完成。

### 🟢 风险 7（已修复）：Redline D 代码层缺口
- 原 `app.json` 缺 `__usePrivacyCheck__: true`，平台可能不强制隐私弹窗。**本轮已补**，JSON 校验通过。后台《隐私保护指引》发布仍待用户。

### 🟢 风险 8（已修复/防护）：仓库泄密面
- 新增 `.gitignore`（`private.*.key` / `secrets*.json` / `node_modules/`）。上传私钥 `private.wxacf98605ac5b0218.key` 在 Desktop（1675 字节）未入仓库、未回显。**注意**：该私钥仅供 `miniprogram-ci` 上传前端代码，与虚拟支付 `VP_*` 相互独立。

---

## 四、下一步动作（按时间线）

### 已完成（用户侧）
- [x] 认证 ok（09-17）
- [x] 虚拟支付申请已提交，审核中（09-17）→ 证明个人主体 + 工具类目资格达标

### 审核等待期可并行准备（不依赖 offerId/appKey，现在就能做）
- [ ] 发布《隐私保护指引》（含 openid 收集说明）—— Redline D 后台侧，独立于虚拟支付审核
- [ ] 云开发环境预填已知 2 项 `VP_APP_ID=wxacf98605ac5b0218`、`VP_APP_SECRET`（appSecret 仅配环境变量，不进代码）
- [ ] 上传 3 个普通云函数 `vp_create_order`/`vp_query`/`vp_get_profile`（右键→上传并部署：云端安装依赖）
- [ ] `vp_deliver` 上传并开 HTTP 触发，复制触发 URL 备用（绑推送待审核通过后做）
- [ ] 准备道具草稿 `comic_full`(990)（若控制台允许预审，发布待审核通过后最终确认）

### 审核已通过（AppKey 已提供 09-17 15:42）→ 收口步骤
- [x] OfferID `1450652139` 已填 `VIRTUAL_PAY.offerId`；现网 AppKey 已提供（沙箱另给）
- [ ] **云控制台粘贴 4 个 VP_\* 环境变量**：`VP_APP_ID=wxacf98605ac5b0218` / `VP_APP_SECRET`(你持有) / `VP_OFFER_ID=1450652139` / `VP_APP_KEY`(现网 AppKey) —— AppKey 仅环境变量，不进代码
- [ ] 道具 `comic_full`(990) 创建并**发布**（发布后等几分钟到半小时全平台同步，否则下单报 `COIN_OR_PRODUCT_ID_CREATED_IN_RECENTLY`）
- [ ] `vp_deliver` 绑消息推送 `xpay_goods_deliver_notify`（云函数模式，用 CLI `cloud_manage_msg_push --action subscribe` 即可，无需 URL）
- [ ] 真机 ¥1 验证：支付→`vp_deliver` 收通知(ErrCode:0)→`vp_users` 解锁→阅读页整本解锁
- [ ] （可选）沙箱：如需无资损自测，另配沙箱 AppKey + env=1，但 ¥1 现网验证走现网 AppKey

## 五、本轮已落盘的修复
- `app.json`：新增 `"__usePrivacyCheck__": true`（Redline D 补全）。
- `.gitignore`：新增防泄密忽略规则。
- 校验：`node -e` 确认 `app.json` 仍为合法 JSON 且开关生效。

## 六、方向决策（最终态 · 09-17 16:10）

基于用户确认「**个人主体 + 微信认证 + 小程序备案均通过**，名 *dudu画面感内容生成工具*」：

- **唯一合规方向 = 路A（作者预生成 + 用户阅读/付费）**：作者用 WorkBuddy 预生成连环画，小程序作阅读器 + 个人虚拟支付(`vp_*`)付费门禁。当前 `comic_miniapp` 代码即正确，**无需重做**，支付层 `vp_*` 重新完全生效。
- **路B（用户端自由 AIGC 实时生成）技术上可行、属合规灰区（09-17 16:23 用户指正后修正）**：个人主体小程序同样可通过云函数调大模型实现"用户输入→AI出内容"（市面大量个人主体 AI 工具即如此，非企业专属，微信无个人主体层硬封锁）。但面向公众提供生成式 AI 服务，按《生成式人工智能服务管理暂行办法》倾向**企业主体 + 算法备案**；**纯文本类（如防折叠）风险低、普遍放行，图像/连环画生成属"深度合成"范畴，风险显著高于纯文本**。是否在本个人账号做路B 是**风险决策而非技术封锁**——要完全合规须另开企业账号 + 备案。
- **命名澄清**：通过的"备案"是**小程序备案**（个人可做，所有小程序强制），**不是**深度合成算法备案。名称里的"生成"指**作者端生成**（WorkBuddy 侧），app 是分发/阅读载体，命名合规；若审核被质疑可弱化"生成"表述（如"内容"）。
- **路B 与个人虚拟支付 vp_\* 不互斥（同认个人主体）**：只有"合规干净的路B（须企业+备案）"才与个人虚拟支付（个人）冲突，那时支付层才需换企业版。灰区路B 与个人 vp_\* 可并存。
- **下一步（待用户拍板方向）**：① 路A＝回到支付收口（见第四节），AI 生成链路本账号不做；② 路B-文字版（灰区、低风险）＝在现有 vp_\* 服务端加"调大模型的云函数"；③ 路B-连环画版（灰区、中高风险）＝技术可行，需掂量深度合成监管风险；④ 路B 干净版＝另开企业号 + 算法备案 + 支付层重做。

**16:33 已落地路B-文字版漏斗（按用户最终设计，合规）**：用户输文字 → `pages/gen` 调 `ai_gen` 云函数（豆包/火山方舟，服务端密钥）润色成连环画脚本 → 点"下一步" → `pages/commission` 展示别人的连环画 + 付费链接（复用 `vp_*`）→ 付费后展示作者微信号，作者用 WorkBuddy 人工出图。app 内**仅做文字润色（低风险）**，连环画生成在 app 外由作者人工完成，个人主体合规，无 in-app 深度合成。新增：cloudfunctions/ai_gen(+package.json)、pages/gen/*、pages/commission/*；config.js 增 `COMMISSION`；app.json 注册两页；index 加入口按钮。待用户配 `LLM_API_KEY`/`LLM_MODEL` 环境变量 + 上传 ai_gen + 支付收口（同第四节）。

### 路B-文字版双分支漏斗（2026-09-17 17:50 落地）

> ⚠️ **本节是历史记录，已被后续两次改动取代，勿按本文实现**：
> 1. 2026-09-18：**分支② 发到邮箱**（`send_email` + `SMTP_*` + `pages/email`）整体移除（个人主体合规取舍）；出口改为 gen 页「复制脚本」。
> 2. 2026-09-19：**不再有 `mode:'comic'`「生成连环画脚本」这一步**（用户拍板「逻辑上不能有生成连环画脚本，只能有付费生成连环画」）。
>    `ai_gen` 现**唯一产出 = `moments`**，显式传其他 `mode` 一律明确报错（不静默降级）；连环画**只能走付费定制**（`pages/commission` → ¥66/¥88 → 人工绘制），脚本是履约内部工作稿。
> 3. 2026-09-17 起「换一批」加入本流程；2026-09-18 起文案长度**跟随用户原文**（不再是固定 150-300）。

- **gen 双分支**：用户输文字 → `pages/gen` 调 `ai_gen(mode:'comic')` 润色成「连环画叙事脚本」（非分镜表）→ 出结果后给两个分支：
  - **分支① 朋友圈文案**：调 `ai_gen(mode:'moments')` 一次返回 3 条防折叠文案，前端 `parseMoments` 按 `【1】【2】【3】` 拆成数组，用户点选/复制。
  - **分支② 发到邮箱**：`pages/email` 调 `send_email`(nodemailer + `SMTP_*`) 把脚本以纯文本发到用户邮箱；该页带「上一步/下一步」。
  - **下一步**：`pages/commission` 展示别人的连环画 + 付费（复用 `vp_*`）→ 付费后展示作者微信号；commission 新增「上一步」返回 gen。
- 合规边界不变：app 内**仅做文字润色（低风险）**，连环画生成在 app 外由作者人工完成。
- 新增/改动：`ai_gen/index.js`(支持 `mode` 双提示词，均 ≥256 token 保缓存) / `cloudfunctions/send_email`(+package.json) / `pages/email/*`(全套) / `pages/gen`(双分支 UI) / `pages/commission`(上一步) / `app.json`(注册 email 页) / `SECRETS模板.md`(增 SMTP 表)。
- 待用户配置：`LLM_API_KEY`/`LLM_MODEL`(ai_gen) + `SMTP_*`(send_email) + 上传两个云函数 + 支付收口（同第四节）。

### 积分机制（2026-09-17 18:04 落地）
- **设计**：赚取(earn) 全部服务端记账（ai_gen comic+30、send_email +10，调通后才加分，防伪造）→ 存 `vp_users.points`；花费(spend) 原子扣减（朋友圈文案 −20 在 `ai_gen` 内扣、兑换权益在 `points` 云函数扣）并落地权益到 `vp_users.coupons`；充值(recharge) 走「个人虚拟支付·个人」，`vp_deliver` 按 `productId` 命中 pack 时 `db.command.inc(amount)` 加积分。（注：本节 18:04 初稿曾把 moments 记为 earn +20，**已于 19:39 修正为花费 −20**，见下节。）
- **合规红线（个人主体）**：积分仅作 app 内行为激励与兑换自身虚拟服务，**不当作法币、不可提现/转让/转赠**；充值名义须是「购买虚拟商品（生成额度包）」，不得宣传"积分=钱"。若审核风险偏高，把 `POINTS.rechargeEnabled=false` 关闭充值，积分只靠免费行为赚取。
- **新增/改动**：`cloudfunctions/points`(+余额/花费) / `cloudfunctions/ai_gen`、`cloudfunctions/send_email`(服务端加分) / `utils/points.js`+`utils/config.js`(POINTS) / `pages/gen`、`pages/email`(余额展示+加分提示) / `pages/points/*`(余额+兑换+充值) / `utils/pay.js`(payByVirtual 支持传 pack) / `cloudfunctions/vp_deliver`(pack 到账积分) / `app.json`(注册 points 页) / `SECRETS模板.md`(⑥ 充值包)。
- **待用户**：~~MP 后台为 `points_60`/`points_300` 创建并发布虚拟支付道具~~ **（已被下方 20:05「道具改三档」取代，并于 20:15 调价为 `points_200`/`points_800`/`points_2500`）**；真机验证三档到账与整本解锁；确认兑换权益用途（当前示例=连环画生成9折券）。

### 积分口径修正 + 多模态输入 + 一个线上隐患修复（2026-09-17 19:39）
**① 朋友圈文案 = 积分兑换（花费 −20），并改为「服务端权威扣费」**
- 口径：`config.POINTS = { earn: { comicScript: 30, emailSend: 10 }, cost: { momentsGen: 20 } }`；朋友圈文案**不再加分**，改为每次生成**花 20 积分**（用户拍板确认原话「积分兑换」= 花 −20）。
- 落点：扣分**放进 `ai_gen` 云函数**（而非前端调 `points`），保持「账本只能服务端改」的性质——前端若可调 `spend/refund`，等价于给自己发币。
  - `chargePoints(openid, cost)`：`where({_id, points: _.gte(cost)}).update({points: _.inc(-cost)})`，`stats.updated===0` 即余额不足 → **天然防并发超扣/扣成负数**。
  - 生成失败（Responses + 兜底 chat 均失败 / 返回空）→ `awardPoints(openid, cost)` **自动退回**，用户不吃亏。
  - 返回：`{ ok:true, mode:'moments', options, cost:20, points:<扣后余额> }`；余额不足返回 `{ ok:false, err:'积分不足', points, need:20 }`。
- 前端 `pages/gen`：只做**快速预检**（余额 <20 直接 toast 拦截，不浪费一次往返）+ 结果提示「已兑换 −20 积分」；`pages/points` 的 `spend` 仅保留给「兑换权益（写 `coupons`）」。

**② 多模态输入：文字 / 图片 / 文章链接（用户要求「最开始三类输入」）**
- `pages/gen` 新增：`wx.chooseMedia` 选图 → `wx.cloud.uploadFile` 到 `gen-input/` 拿 fileID（展示缩略图、可删，暂支持 1 张）；文章链接输入框 + 「粘贴」（`wx.getClipboardData` 自动抽 `https?://` 链接）。
- `ai_gen` 新增入参：`imageFileId`（云存储）与 `url`（网页）。`prompt` 变为可选——三者任一即可，`canSubmit` 统一控制按钮可用态。
- **图片 vision**：`cloud.downloadFile` → 校验大小(≤8MB) → 魔数嗅探 mime(png/jpg/gif/webp) → `data:image/*;base64,...`。Responses 路径用 `{type:'input_image', image_url}`，chat 兜底路径用 `{type:'image_url', image_url:{url}}`；`input_text`/`text` 分支持分别构造。纯图无文字时补默认指令（「根据这张图片写…」）；图文并存时追加「请同时参考我上传的图片内容」。
- **文章链接抓取**：`fetchArticle` 跟随 3xx（≤4 跳）、15s 超时、限 600KB、伪装微信内置浏览器 UA；正文提取 `extractMainText` 优先定位公众号 `id="js_content"` 容器并**截断其后的页面噪声**（`js_pc_qr_code`/`js_tags`/`js_article_comment`/`js_related`/`rich_media_tool` 等），再剥标签 + 解码实体（含 `&#x..;` 数字实体）；正文上限 4000 字超出截断；与手写文字合并为「【来源标题】/【来源正文】/【我的补充】」三段。
- **安全**：新增 SSRF 守卫 `isBlockedHost` —— 拒绝 `localhost`/`.local`/`.internal` 与内网段（10./127./192.168./172.16-31./169.254.，含云元数据 169.254.169.254）。
- 服务端输入硬上限从 2000 提到 **6000 字**（前端 textarea 仍 2000；链接抓取正文 4000，故 2000 会误伤）。

**③ 修掉一个线上隐患：`postJSON` 缺 `req.end()`（真 bug，非重构）**
- `ai_gen` 与 `vp_query` 的 `postJSON` 只 `req.write(body)` 就返回，**没有 `req.end()`**——Node 的 `http.ClientRequest` 需 `end()` 才认为请求完成；现象是云函数偶发挂起到超时（写单测时被 100% 复现：promise 永不 settle，Node 事件循环空转后静默退出）。
- 已补 `req.end()`（两处）。`getText`/`getJSON` 本来就有，无问题。

**④ 新增本地单测 `test/test_ai_gen_units.js`（零依赖 + Stub 云 SDK/HTTP）**
- 做法：`Module._load` 拦截注入 `wx-server-sdk`（内存版云数据库 `vp_users` + `downloadFile`）与 `https`/`http`（Ark 返回与网页返回可编程），直接调用 `exports.main` 断言真实行为。
- 覆盖 11 例，**11 PASS / 0 FAIL**：comic 纯文本 +30 落库 · moments 余额不足不改余额且不调模型 · moments 充足 50→30 · 模型失败自动退回 50 · url 抓取注入正文且剔除噪声 · 内网链接被 SSRF 拦 · 图片构造 `input_image` 且 mime 嗅探为 png · 纯图补默认指令 · 三类全空报错 · Responses 404 自动回退 chat/completions · 超长文本拦截。
- 运行：`node test/test_ai_gen_units.js`。

**⑤ 同步改动**：`pages/gen/gen.wxml|wxss`（图片/链接输入区 + 「消耗 20 积分」文案）· `pages/points/points.wxml`（底部口径改为「脚本 +30 · 邮箱 +10 · 朋友圈 −20」）· `utils/config.js`（`cost.momentsGen`）。

### 每日登录奖励（签到送积分，2026-09-17 19:55 落地）
- **需求**：每天登录送积分。
- **实现原则 = 服务端权威 + 幂等 + 防并发**（客户端能被反复调用，但绝不能反复发币）：
  - `points` 云函数新增 `action:'daily'`，**不新增云函数**（复用已部署的 points，少一步用户配置）。
  - **幂等**：以「北京时间自然日」为键，用 `vp_users.lastDailyDate` 记录上次领取日；同日重复调用返回 `{ awarded:0, already:true }`，余额与 streak 均不变。
  - **防并发 = 乐观锁 CAS**：读到旧 `lastDailyDate` 后执行 `where({_id, lastDailyDate: 旧值}).update({ points: inc(reward), lastDailyDate: today, dailyStreak: streak })`；`stats.updated===0` 即说明已被另一个并发请求领走 → 按「今日已领」返回，**绝不重复发放**。
  - **连签**：`lastDailyDate === 昨天` → streak+1；否则（首次或断签）重置为 1。
  - **奖励**：`base + min(streak-1, streakCap)`，每连续 `milestoneEvery` 天额外 `milestoneBonus`。当前口径 = 每日 +5 起、连签每天递增 +1、封顶 +10；每连签 7 天额外 +15（故第 7 天 = 10+15 = **+25**）。
  - **老用户兼容**：历史文档没有 `lastDailyDate`/`dailyStreak` 字段时 `ensureUser()` 自动补齐——CAS 依赖该字段存在，字段缺失会导致 `where` 匹配不上而误判「今日已领」。
- **前端**：`utils/points.js` 新增 `dailyCheckin()`（直接领取）与 `maybeDailyCheckin()`（**本地按日缓存，同一天只真正打一次云函数**；缓存失真最多多打一次，服务端幂等兜底）。首页 `onShow` 自动领取 + toast「签到成功 +N 积分」/「连签 N 天，+X 积分！」，顶部积分条显示「✓ 今日已签到 · 连续 N 天」。积分页新增「每日签到」卡片（连续天数 + 规则文案 + 手动补领按钮，重复点也只发一次）。
- **配置**：`config.POINTS.daily`（`enabled`/`base`/`streakCap`/`milestoneEvery`/`milestoneBonus`），**须与 `cloudfunctions/points/index.js` 的 `DAILY` 两处同改**（云函数跨包 require 前端 config 不可靠）。
- **合规**：签到积分属 app 内行为激励，不可提现/转让，与既有积分红线一致；`daily.enabled=false` 可一键关闭（前端自动隐藏签到条目）。
- **测试**：`test/test_points_daily.js` **11 PASS / 0 FAIL** —— 首次领取 · 同日重复调用幂等 · 连签递增 · 加成封顶 · 第 7 天里程碑 · 断签重置 · CAS 并发冲突不重复发放 · **北京时间日界（UTC 16:00 = 北京次日 00:00，相隔 1 秒算新的一天）** · 老文档缺字段自动补齐 · `balance`/`spend` 回归。

### 朋友圈文案「换一批」（不满意→提意见重生成 3 条，15 积分，2026-09-17 20:20 落地）
- **需求（用户原话）**：生成的文案不喜欢 → 说出修改意见后，可以 15 积分再生成 3 个文案。
- **交互**：`pages/gen` 的 moments 结果区下方新增「换一批」块 —— 一个修改意见输入框（300 字）+ 按钮「换一批（再出 3 条 · 消耗 15 积分）」。**必须填写修改意见按钮才可用**（`canRevise`），符合"说出修改意见后才能换"。
- **档位与防滥用**：首次生成 `−20`、带意见换一批 `−15`。**是否走 15 分档由服务端按 `feedback` 是否非空判定**（`ai_gen` 内 `isRevise`），前端无法自选价格档 —— 否则可以把首次生成也压到 15。`feedback` 为空白串时按首次 20 处理（已加测试）。
- **提示词注入位置**：把「上一版文案 + 修改意见 + 要求与上一版明显不同、不要照抄」拼进**用户消息**而非系统提示词 —— 系统提示词是显式缓存的前缀，改动它会打散缓存命中。
- **入参**：新增 `feedback`（≤300 字，超长服务端截断）与 `previous`（上一版 3 条，各 ≤300 字，供模型"改而不是重写"）。返回新增 `revised` 与 `cost`（前端按真实扣费数提示，不写死）。
- **边界**：纯 feedback（无正文/图片）也放行（修改意见+上一版本身就是上下文）；余额不足返回 `need`（区分 15/20）且不扣分、不调模型；模型失败照旧**自动退回**已扣的 15。
- **重构**：`gen.js` 把首次生成与换一批合并为 `genMoments(revise)`，避免两套重复逻辑（前端只做余额快速预检，权威扣费仍在云函数）。
- **测试**：`test_ai_gen_units.js` 扩到 **19 PASS**，新增 8 例：只扣 15 且 `revised=true` · 无 feedback 仍扣 20 · **空白 feedback 不能压价** · 修改意见与上一版都注入且要求"明显不同"、系统提示词仍为字符串（缓存前缀稳定）· 余额不足（12<15）返回 `need:15` 不扣分 · 失败退回 15 · 纯 feedback 放行 · 超长 feedback 截断到 300。
- **顺带**：把「跨文件常量一致性」测试扩到 8 例（新增 `POINTS.cost`↔`POINTS_COST`、`POINTS.earn`↔`POINTS_EARN`、前端 gen 页价格回退值），并重命名为 `test/test_constants_sync.js`（原名 `test_vp_catalog_consistency.js` 已名不副实，已全量更新引用，grep 复查无残留）。
- ~~一个定价观察（供你判断）~~ **→ 2026-09-17 20:19 用户确认：换一批（15）比首次（20）便宜是「有意的复购优惠」，保持不变。**
  - **设计意图**：用户对生成的文案不满意时，降低"再试一次"的门槛，鼓励多改几次直到满意，而不是放弃。属于有意的复购/挽回定价，不是笔误。
  - **已做的固化（防止被"修正"）**：
    1. `utils/config.js` 与 `cloudfunctions/ai_gen/index.js` 的 `POINTS_COST` 旁写明「有意设计，勿修正为 ≥ 首次价」；
    2. `test_constants_sync.js` 第 12 条断言 `momentsRevise < moments`（config 与云函数两侧都守）——日后若有人凭直觉调平/调高，测试立刻失败并把理由摆出来；
    3. **优惠必须被用户看见**：`gen.wxml` 的「换一批」标题旁加了 `复购优惠 · 比首次少 N 积分` 标签，`points.wxml` 的费用说明也标注「复购优惠，比首次省 N 积分」；两者数值均由 config 计算（`gen.js` 的 `reviseSave`、`points.js` 的 `earnTip`），不在 wxml 写死，改价不会漂；第 13 条断言守住"这两处 UI 必须出现优惠标注"。
    - 理由：用户感知不到的优惠不会改变行为——只把数值设成 15 而界面不说，用户仍以为每次都是原价，"复购优惠"就白设了。

### 积分充值道具改三档 + 支付链路三处加固（2026-09-17 20:05 落地，20:15 调价）
**① 道具档位（用户指定）**：`points_200`(¥6→200) / `points_800`(¥18→800) / **`points_2500`(¥50→2500)**，整本仍为 `comic_full`(¥9.9)。
- **20:15 调价（用户拍板"¥50 给 2500"）**：原为 ¥50→2000，导致单价倒挂（¥18=44.4 积分/元 **高于** ¥50=40 积分/元，大包反而更贵）。现三档单价 **33.3 / 44.4 / 50 积分/元，单调递增**，符合"大包更划算"。
- **道具 ID 同时从 `points_2000` 改为 `points_2500`**：ID 后缀必须等于到账数量，否则会留下"`points_2000` 实发 2500"的误导档位——云函数与 config 完全一致、价格也对，所有既有测试都会绿，但后来的人必然看错档位。新增断言把"ID 即语义"钉死（见下 ② 第 9 条）。
- 「最超值」角标从 ¥18 档**移到 ¥50 档**（现在它才是真正的最高单价），并加断言防止角标打错档。
- 同步 4 处：`config.POINTS.packs` + `vp_create_order`/`vp_deliver`/`vp_query` 的 `PRODUCTS`，另 `pages/points` 展示 `priceText` 与角标。
- ⚠️ 若你已在 MP 后台建了 `points_2000`：请改建 `points_2500` 并把旧的 `points_2000` 下架（道具 ID/价格发布后一般不可改）。**从未发布过则无需处理。**

**② 新增一致性守卫测试 `test/test_constants_sync.js`（11 PASS）** —— 专门拦"改一处忘三处"
- 云函数不能跨包 require 前端 config（每个云函数独立打包），道具目录必须在 4 处各存一份，这是**结构性缺点**，靠人工同步迟早出错。该测试从三个云函数源码里抠出 `PRODUCTS` 字面量并与 `config` 逐档比对：三处 `PRODUCTS` 必须完全相同 · packs 与 PRODUCTS 逐档对齐（priceFen/积分数）· 无"隐藏档位"（云函数有、config 没登记）· `comic_full` 与 `VIRTUAL_PAY`/`COMMISSION` 价格一致 · `priceText` 与 `priceFen` 对得上 · `POINTS.daily` ↔ 云函数 `DAILY` 一致 · `POINTS.cost/earn` ↔ `POINTS_COST/POINTS_EARN` 一致。
- **20:15 新增 3 条（把本次调价的教训变成规则）**：
  9. `productId` 数字后缀 = 到账积分（防 ID 与语义脱钩）；
  10. **积分单价随金额单调递增**——这是用户拍板的商业规则，写成断言后，以后调价若又调出倒挂会立刻失败，而不是等用户发现；
  11. `tag: '最超值'` 必须指向单价最高的档位（否则是在误导用户）。
  - 已反向验证这三条**真的会失败**（喂旧数据 `¥50→2000` 报"单价未递增: 40.0 不高于 44.4"；喂"只改金额不改 ID"报"ID 与数量脱钩"），不是假绿。

**③ 修掉 3 个真实缺陷（都在支付/发货链路，均已加回归测试）**
1. **定价权在前端（可篡改）**：`vp_create_order` 原来直接采信前端传的 `priceFen`（`Number(event.priceFen) || 990`）。单档时危害有限，改成三档不同价后，攻击者可传 `productId=points_2500` + `priceFen=1`。
   → **收口为服务端道具目录 `PRODUCTS`**：只认 `productId`，价格一律取服务端；未登记道具直接拒单；前端传价与服务端不一致时记警告日志。前端 `pay.js` 不再上送 `priceFen`。返回体补 `productId/priceFen/orderLogged` 便于排查。
2. **`set()` 覆盖导致丢数据**：`vp_deliver` 的整本分支与 `vp_query` 的补发货分支都用 `doc().set({openid, unlockedAll:true, ...})` —— 云数据库 `set` 是**整文档覆盖**，会把用户已赚的 `points`/`coupons` **清空**（买了整本、积分归零）。
   → 统一改为 `update()` 合并写入；文档不存在时先建档再 update。回归测试断言"买整本后积分 555 / 优惠券 2 张必须仍在"。
3. **发货语义不区分道具**：`vp_query` 兜底查单原来"查到已支付就解锁整本"，买积分包也会被解锁整本（发错货）；`vp_deliver` 对**任何未登记 productId** 都走解锁分支（伪造通知可白拿整本）。
   → 两处统一为 `deliver()`：按 `PRODUCTS[productId].kind` 分派（`points` 加积分 / `unlock` 解锁），**未登记道具一律不发货**并 `console.error` 留痕；`vp_query` 从 `vp_orders` 取本单 `productId` 后按目录发货，取不到则标记 `needManual` 交人工核对（绝不猜成"解锁整本"）。

**④ 发货推送来源校验（新增，防伪造通知）**
- 风险：`vp_deliver` 是 HTTP 触发的公网地址，**原来不校验来源** —— 任何人知道该 URL 就能 POST `<ProductId>points_2500</ProductId>` + 自己的 `OpenId` 白刷 2500 积分。
- 处理：新增 `verifyPush()`，按微信「消息推送」标准校验 `signature = sha1(token/timestamp/nonce 字典序排序后拼接)`；配 `VP_PUSH_TOKEN` 环境变量 + MP 后台消息推送 Token 一致即生效。**未配置时跳过校验但日志告警**（不阻塞首次部署，上线前必须配）。伪造请求返回 `ErrCode=1` 且不发货。
- 更强替代（未做，留作选项）：推送仅作"有事发生"的信号，发货前调 `xpay/query_order` 向微信确认已支付再发货（`vp_query` 已有该逻辑，可抽到 vp_deliver）。代价是每次发货多一次 API 调用。

**⑤ 测试**：`test_vp_units.js` **17 PASS / 0 FAIL** —— 积分包只加积分不解锁 · 幂等（同 MchOrderNo 不重复发）· **买整本不清空积分/优惠券（回归）** · 未登记道具不发货 · 新用户自动建档 · 非发货事件忽略/缺 OutTradeNo 返 1 · 伪造推送（无签名/错签名）被拒且不发货 · 下单 `priceFen=1` 篡改无效（实付 5000）· 三档价格逐一正确 · 双签名符合官方规范 · 未知道具拒单 · 缺密钥明确报错 · **查单幂等/并发/缺记录/未支付（20:35 新增 5 例）**。
- 全量（20:15 调价后）：JS 34 个语法通过 · 红线闸门通过 · 云函数冒烟 7/7 · `ai_gen` 19/19 · 每日签到 11/11 · 一致性 **11/11** · 虚拟支付 17/17 · 端到端 21/21。

**⑥ 待用户（控制台动作，我无凭证）**
- MP 后台「虚拟支付 → 道具管理」**新建并发布 3 个道具** `points_200`(¥6) / `points_800`(¥18) / **`points_2500`(¥50)**，价格须与上表完全一致；若已建过 `points_2000` 或旧的 `points_60`/`points_300` 需下架（道具 ID/价格发布后一般不可改）。
- 云环境变量补 `VP_PUSH_TOKEN`，并把同一串填到 MP 后台【开发管理 → 消息推送】的 Token。
- 重新上传 `vp_create_order` / `vp_deliver` / `vp_query`（`vp_get_profile` 无改动）。
- 真机验证：三档各买一次确认到账数量正确（¥50 应到 **2500**）；买一次整本，确认**积分不被清零**。

### 路A 内可延展的产品方向（支付收口后）
1. **内容线**：多系列/多章节，每系列独立 `productId` 或解锁态；免费试读前 N 页（不进付费门禁，拉转化）。
2. **定价/促销**：¥9.9 基础品 + ¥1 引流品 + 系列包/限时折扣（虚拟支付支持多 `productId`，改 `config.js` + 后台对应道具即可）。
3. **阅读体验**：阅读页打磨、书架/目录、收藏、进度记忆。
4. **分发/运营**：群/朋友圈分享、公众号导流、免费试读→付费整本转化漏斗（你本身有公众号链路，可直接复用）。

---

## 2026-09-17｜跑通性测试：发现并修掉 1 个真实缺陷 + 1 个打包漏洞

本轮做的是「不写新功能、只验证能否跑通」。结论：**跑得通，但暴露了两个此前所有单测都测不到的问题** —— 都属于"每个模块单看都对、串起来才错"的类型。

### ① 新增端到端串联测试 → 抓出 `vp_query` 不幂等（真实缺陷，可无限刷积分）

**为什么之前的测试测不到**：`test_vp_units.js` 只测 `vp_deliver` 与 `vp_create_order`，`vp_query` 从未被覆盖；每个函数各自用独立的内存 DB，跨函数的"同一订单被处理两次"根本无法表达。

**缺陷**：`vp_query`（兜底查单）只判断"微信说已支付"，就无条件 `update({status:'delivered'})` 并调 `deliver()`。而本函数**由前端主动调用、参数 `openid`/`outTradeNo` 全由前端提供** —— 用户只要支付过一次，就能拿同一个 `outTradeNo` 反复调用，**每次 +200/800/2500 积分**（按档位）。这是纯粹的资损漏洞。

**修复**（`cloudfunctions/vp_query/index.js` 第 96-132 行）：与 `points` 每日签到同一套**乐观锁 CAS** 思路——
1. 先读订单，若 `status === 'delivered'` → 直接返回 `{already:true, kind:'skipped'}`；
2. 否则按"读到的那个状态"做 CAS：`where({outTradeNo, status: 旧值}).update({status:'delivered'})`；
3. `stats.updated !== 1` 即说明被并发请求抢先 → 同样不发货；
4. 订单记录缺失（下单时落库失败）→ `productId` 为空 → `deliver` 判 `unknown` → 返 `needManual`，**绝不猜成"解锁整本"**。

**为什么不靠"查单前先判断、跳过微信查询"**：那样会让"微信已支付但本地状态没落库"的情况漏发货。幂等必须做在**发货动作**上，而不是做在**查单动作**上 —— 测试里专门断言了这一点（5 个并发查单仍然 5 次都真的调了微信，但只发一次货）。

**回归**：`test_vp_units.js` 新增 5 例（积分包不误解锁 / 重复查 3 次不重发 / 5 并发只发一次 / 订单缺失需人工核对 / 未支付不发货）→ 12 → **17 PASS**；`test_e2e_flow.js` 亦有 3 例覆盖。

### ② `packOptions.ignore` 漏排 → 废弃代码与内部文档会被打进上传包

**发现过程**：写"审核红线扫描"时顺手算了真实打包集合，发现 `project.config.json` 的 `packOptions.ignore` **只有 `{folder: server}` 一条**。按官方文档（`packOptions.ignore` 是打包排除的唯一手段，`value` 以 `miniprogramRoot` 为根，本工程未设即项目根），以下都会被**打进上传代码包**：

| 本该排除 | 内容 | 风险 |
|---|---|---|
| `cloudfunctions_deprecated/` | 4 个云函数，含**真实**的 JSAPI 统一下单 + 手机号登录实现 | 审核红线 Redline B（包内含个体户专用接口） |
| `test/` | 6 个测试文件 + Python 脚本，含测试桩与全部内部实现细节 | 泄露实现、包体膨胀 |
| `*.md` | `SECRETS模板.md`（含环境变量名与格式）、`DEPLOY_CHECKLIST.md`、`ARCH_HEALTH.md` | **内部机密文档随包分发** |
| `.workbuddy/memory/` | 项目记忆文件 | 同上 |
| `__pycache__/` | Python 字节码 | 垃圾文件 |

**修复**：`packOptions.ignore` 扩到 8 条（`server` / `cloudfunctions_deprecated` / `test` / `__pycache__` / `.workbuddy` / `.gitignore` / 后缀 `.md` / 后缀 `.py`）。修复后：项目 112 个文件 → **仅 72 个进代码包**（云函数 13 个由 IDE 单独上传）。
⚠️ 官方注：`packOptions` 改动**可能需重新打开项目才生效**。

### ③ 审核红线从"人工 grep"升级为"自动闸门"

新增 `test/check_audit_redlines.js`：按**真实打包集合**逐文件扫描，并且**先去注释**，把「活代码命中（阻断）」与「仅注释命中（提示）」分开报。检查项对应用户定的三条硬红线 + 一条附加：
- **R1** AppID 非 `touristappid`
- **R2** 包内无个体户专用能力的**活代码调用**（标准微信支付 JSAPI / 手机号快速验证）；同时**反向确认**个人虚拟支付入口 `wx.requestVirtualPayment` 仍在
- **R3** `PAY_CONFIG.rewardEnabled === false`（并在配了 `rewardQr` 时提示）
- **R4** 包内无硬编码密钥字面量（`sk-…` / 32 位 hex）

**为什么必须"按打包集合 + 去注释"**：直接 `grep` 整个工程会扫到 `cloudfunctions_deprecated/`（本该排除）和各处**解释性注释**，导致结果既漏报又误报。首轮扫描报"命中 6 处"，实际**活代码 0 处、全部是注释**。为让闸门能真正归零，把 5 处注释里的接口字面量改写为中文描述（`utils/config.js` 77-79、`utils/login.js` 3、`pages/index/index.wxml` 25、`pages/pay/pay.js` 24/58、`pages/pay/pay.wxml` 35），保留完整技术理由。现况：**76 个包内文件（含分包），活代码 0 命中、注释 0 命中**。

### ④ 一键测试入口

新增 `test/run_all.js`：语法检查（全量 JS） → 审核红线闸门 → 6 个测试套件，输出一张表 + `SUMMARY` 行。提交前跑这一条命令即可。

**本轮全量结果**（`node test/run_all.js`）：

```
✓  JS 语法检查                 34 个文件，全部通过
✓  check_audit_redlines.js    审核红线全部通过
✓  smoke_cloudfunctions.js    7 OK / 0 FAIL
✓  test_constants_sync.js     8 PASS / 0 FAIL
✓  test_ai_gen_units.js       19 PASS / 0 FAIL
✓  test_points_daily.js       11 PASS / 0 FAIL
✓  test_vp_units.js           17 PASS / 0 FAIL
✓  test_e2e_flow.js           21 PASS / 0 FAIL
════ SUMMARY：全部通过 ════
```

**端到端旅程覆盖**（`test_e2e_flow.js`，6 个云函数共用一份内存 DB）：新用户查档 → 每日签到（含并发只发一次）→ 余额不足拒绝且**不调模型**（不白烧钱）→ 下单 ¥18（价格服务端判定，前端 `priceFen:1` 篡改无效）→ 发货推送 +800 → 伪造推送/重复推送被拒/幂等 → 朋友圈首生成 −20 · 换一批 −15 · 空白 feedback 不能压价 → 图片多模态 +30 → 文章链接抓正文 → 买整本解锁且**积分不被清零** → 兜底查单补发货（买积分包不误解锁整本）+ 幂等 + 并发 → **账目自洽**（最终余额 = 各项收支之和 815，无凭空增减）。

### ⑤ 容量预警（已解决 → 分包拆分）

**原问题**：代码包体积 1.70 MB / 主包上限 2 MB（36 张 `panels/*.webp` 占绝大部分），再增一组章节图即超限、无法上传。

**处置**：把 `pages/reader` + `panels/` 整体迁入独立分包 `packageReader`，主包只留入口与轻量页。

**拆分后实测**（`test/check_audit_redlines.js` 闸门输出）：

| 包 | 文件数 | 体积 | 上限 | 占比 |
|---|---|---|---|---|
| 主包 | 40 | **0.12 MB** | 2.00 MB | 6.2% |
| 分包 `packageReader` | 36 | **1.63 MB** | 2.00 MB | 81.6% |
| 合计 | 76 | 1.76 MB | 20.00 MB | — |

**关键改动**：
- `app.json`：从 `pages` 摘除 `pages/reader/reader`，新增 `subPackages[{root:"packageReader",name:"reader",pages:["pages/reader/reader"]}]` + `preloadRule`（`pages/index/index` 在 wifi 下预下载 `reader`）。
- `packageReader/pages/reader/reader.js`：`require` 深度 `../../utils/` → `../../../utils/`（已验证解析到工程根 `utils/`）；新增 `PANEL_BASE = '/packageReader/panels/'`，`onLoad`/`onShow` 两处均使用。
- `pages/index/index.js`：跳转 URL → `/packageReader/pages/reader/reader`（跳转到分包页面是允许的）。
- `pages/commission/commission.js`（主包，**不能引用分包资源**）：示例图从 `/panels/e0X_p01_sm.webp` 改为主包内 `/images/samples/e0X_p01_sm.webp`，由 `tools/make_sample_thumbs.py`（Pillow）从原图派生 240w 缩略图（4 张共 50.5KB，可重复执行）。

**新增守门断言**：闸门加 R5（主包不得引用分包资源，跳转目标已排除避免误报）/ R6（页面声明 · 四件套 · 跳转目标一致）/ R7（各包体积与预下载规则）；`test_constants_sync.js` 加 #14（章节声明的面板文件必须真实存在于 `packageReader/panels/`，无缺失/无孤儿）。三组反向验证（主包误用分包图 → R5 红；跳转路径过期 → R6 红；分包声明不存在页面 → R6 红；章节声明不存在面板 → #14 红）均按预期失败。

> **注意**：拆分/规则改动后，开发者工具可能需**重新打开项目**，`packOptions.ignore` / `preloadRule` 才会生效（官方行为）。

---

## 2026-09-18｜取消「发到邮箱」功能：改为「复制脚本」带走

**动因**：用户拍板——「发邮件那个功能取消吧，就弄成复制就好了，或者允许用户复制就行」。
`send_email`（nodemailer + `SMTP_*`）虽已能跑，但它要用户**额外配一套邮箱授权码**，且真发信存在投递失败 / 进垃圾箱的不确定性；
而「把脚本复制走」是**零配置、零失败面**的一条路，`gen.wxml` 本就有「复制脚本」按钮，删掉那个分支即可收口。

**移除范围（本地源码）**：
- 删 `pages/email/*`（4 文件）+ `cloudfunctions/send_email/`（2 文件）+ `test/smoke_cloudfunctions.js` 里的 nodemailer Stub；`app.json` 摘除 `"pages/email/email"`。
- `pages/gen`：删 `onSendEmail`（原 L203-208）、删「② 发到我的邮箱」按钮与 `.branch-btn.email` 样式；顺带去掉因失去对照而孤立的「①」序号（只剩一个分支时保留序号反而像 bug）。
- **积分**：`config.POINTS.earn.emailSend`（10）删除 ⇒ `earn` 只剩 `comicScript: 30`；`pages/points` 的 `earnTip` 同步去掉「发到邮箱 +10」。（`ai_gen` 的 `POINTS_EARN` 本就只有 `comic`，无需改。）
- **把「复制脚本」升级为结果区主操作**：加 `.copy-btn.primary`（蓝底 + 加粗 + 阴影）+ 「📋」图标 + 提示「复制后即可粘贴到微信 / 备忘录，或直接发给画师」；正文加 `user-select="true"`，长按也能唤出系统复制菜单——**按钮与长按两条路都通**，避免"唯一出口不够显眼"。

**新增守门断言**：`test_constants_sync.js` **#15** —— `config.POINTS.earn` 的每一项都必须映射到某云函数的发放常量（`MAP: { comicScript → comic }`）。
理由：本次踩的正是「config 承诺『发到邮箱 +10』、而云端已取消发放」的**空头赚分承诺**——界面会引导用户去赚一笔**永远赚不到**的积分，而所有既有测试仍全绿。现在再出现这种脱钩会立刻红灯。
配套把 `test/smoke_cloudfunctions.js` 的云函数清单**改为从 `cloudfunctions/` 目录自动发现**（原先手写 7 条；删除函数时忘了同步就会 require 抛错、看起来像故障，新增函数忘了加则少测一个也看不出来）。

**本轮全量结果**（`node test/run_all.js`）：

```
✓  JS 语法检查                 32 个文件，全部通过
✓  check_audit_redlines.js    审核红线 + 分包检查全部通过（R8：6 个函数均有 index.js+package.json、依赖声明齐全）
✓  smoke_cloudfunctions.js    6 OK / 0 FAIL
✓  test_constants_sync.js     15 PASS / 0 FAIL
✓  test_ai_gen_units.js       19 PASS / 0 FAIL
✓  test_points_daily.js       11 PASS / 0 FAIL
✓  test_vp_units.js           23 PASS / 0 FAIL
✓  test_e2e_flow.js           22 PASS / 0 FAIL
════ SUMMARY：全部通过 ════
```

体积：主包 38 文件 **0.13 MB**（6.6%）/ 分包 `packageReader` 36 文件 1.63 MB / 合计 1.76 MB。
（上文各历史条目中提到的 `send_email` / `pages/email` / 「邮箱 +10」均为**当时状态的真实记录**，故原文保留不改写。）

**⚠️ 云端遗留（待用户手动清理）**：`send_email` 云函数在**云端仍是 `Active`**（本地源码已删）。CLI 的 51 个工具里只有 `cloud_fn_deploy` / `cloud_fn_inc_deploy` / `cloud_fn_info` / `cloud_fn_list`，**没有删除云函数的工具**，需在「云开发控制台 → 云函数」右键删除。
留着不影响审核与运行（云函数不进小程序上传包、不参与代码审核），但会长期混淆后来人。同一时刻（00:36）复核：**云函数超时全部正确**（`ai_gen 60`、其余 20 / 10）。


---

## 2026-09-18（晚）体验版真机问题修复 + 图片格式定案：全量 webp → JPEG

### 1. 真机报的 4 个问题与根因

| 现象 | 根因 | 修复 |
|---|---|---|
| 免费试读「部分画面加载失败（4 张）」、重试很久 | ① 首进分包下载竞态（图先于分包就绪）② **webp 真机不可渲染**（见 §2） | `reader.js` 先 `wx.loadSubpackage({name:'reader'})` 成功再渲染，`<image>` 由 `subReady` 门控；另见 §2 |
| 「添加图片」点了没反应 | `app.json` 有 `__usePrivacyCheck__:true`，但 `app.js` 里 `wx.requirePrivacyAuthorize` 是**空壳**、未注册 `wx.onNeedPrivacyAuthorize` ⇒ `wx.chooseMedia` 被静默拦截 | `app.js` 注册 `wx.onNeedPrivacyAuthorize` → 弹《隐私保护指引》→ 同意后 `resolve({event:'agree'})`，框架自动重跑原 API |
| 「复制」跳进空白的「个人信息与权限使用记录」页 | 同上（`wx.setClipboardData` 同属隐私受保护 API） | 同上 |
| 定制页「先看看样例效果」下面图片空白 | **webp 真机不可渲染**（见 §2） | 见 §2 |

### 2. ⚠️ 根因定案：小程序 `<image>` 的 webp 在真机上不可用（模拟器完全看不出来）

- **决定性判据**：模拟器（开发者工具）截图**全部正常渲染**，真机空白。
  开发者工具用 **webview** 渲染（webview 支持 webp），真机用原生图片解码 → 差异只在真机暴露。
- 平台边界（多来源一致）：**iOS < 14 完全不支持**；iOS ≥ 14 还需**基础库 ≥ 2.9 且给 `<image>` 加 `webp="true"`**；**Android 亦有大量实测失败**（含 Android 14 / OPPO 实测、Android 11 透明通道 webp 失败）。社区一致结论：**直接转 jpg / png**。
- 受害者：`images/samples/`(4) + `packageReader/panels/`(32) + `packageSample/sample_panels/`(54) 全是 webp ⇒ 读者页与定制页样例图在真机整片空白。
- **修复**：新增工具 **`tools/webp_to_jpg.py`**，三组图全量转 **基线 JPEG**（不用 progressive，最大化兼容），转换后删除全部 webp。
  参数按分包 2MB 预算实测选定：缩略图 `q85`（0.09MB）、产品画格 `q68`（1.64MB / 82%）、示例画格 `w480 q62`（1.60MB / 80%）。
  三组图均**无透明通道**（已核验），故 JPEG 无损语义。
- 同步更新引用与工具链：`commission.js` / `reader.js` / `sample.js` / `test_constants_sync.js` / `utils/config.js` / `README.md`，
  以及 3 个生成脚本（`make_sample_thumbs.py` 顺带修了 `SRC_DIR` 仍指向旧 `panels/` 的失效路径、`compose_sample_panels.py` 参数改为 `ART 480 / q62`、`extract_sample_panels.py`），**避免重跑一次就退回 webp**。
- `cloudfunctions/ai_gen/index.js` 里的 `image/webp` mime 嗅探**保留**：那是「用户上传图片给大模型」的入参识别，与端内渲染无关。

### 3. 新增闸门 R9：包内禁止 webp（`test/check_audit_redlines.js`）

这个坑静态检查不出来、只有真机暴露，必须固化成机械可验证的约束：
包内出现 `*.webp` 文件、或 `.js/.wxml/.wxss/.json` 的**活代码**引用 `.webp` 路径 ⇒ **阻断**（仅注释命中给提示）。
**已反向验证**：临时塞入 `images/samples/__probe.webp` → 报红 1 项；删除后 → 全绿。

### 4. 顺带实证：`packOptions.ignore` 的 `folder` 是「根级路径前缀」，不是「同名目录」

排查过程中一度怀疑 `{value:"samples",type:"folder"}` 把 `images/samples/` 也排除了。
从开发者工具 `app.asar` 里挖出真实实现（`doRule`）后**证伪**：

```js
else if ("folder" === n.type) i = leading(e,"/").startsWith(trailing(leading(t,"/"), "/"));
// 即 "/images/samples/e01.jpg".startsWith("/samples/") === false  → 不被排除
```

结论：`folder` 只匹配**相对 miniprogramRoot 的根级前缀**；`prefix`/`suffix` 则只匹配**文件名(basename)**。
⇒ 项目根目录下 `samples/`（10.6MB 单文件 HTML）被正确排除，`images/samples/` 正常进包。**（故此前的怀疑不成立，真正原因是 §2。）**

### 5. 「有哪些用户用过」+ 定制需求可见性

- **合规硬边界**（个人主体）：**手机号拿不到**（`getPhoneNumber` 仅非个人主体+已认证开放，2023-08 起按次计费；且本项目红线脚本 R2 明令禁止包内出现）；
  **头像昵称不能静默获取**（`wx.getUserProfile` 已被回收）。唯一合规路径 = 用户**自愿手填**（头像昵称填写能力）。
- **用户识别用 openid 即可**（零授权、不涉隐私）：`vp_get_profile` 新增 `touchUser()` → `app_users` 以 openid 为 `_id` upsert（`firstSeen`/`lastSeen`/`visits`；文档不存在用 **`set()`** 建、存在才 `update()`+`_.inc(1)`；集合不存在则 `createCollection` 后重试）。
  `app.js` onLaunch 在 `cloud.init` 后以 `action:'touch'` 发射即忘。积分页新增「我的资料（可选）」保存自愿填的头像昵称。
- **定制需求采集层修复**：commission 页「你的故事」原本是**只读**、`note` 前端从不采集 ⇒ 客户未在 gen 页写过就落库成占位符。
  已改为**必填可编辑 textarea** + 新增「补充说明」字段（≤500 字），`onSubmitEmail` 校验 story 非空。
- **「我没有数据库」是误解**：微信云开发自带数据库，现有 4 个集合 `vp_users` / `vp_orders` / `custom_comic_requests` / `app_users`。
  入口：开发者工具 → 云开发 → 数据库。
- **通知渠道仍悬置**（未实现）：落库后不主动通知运营者。已排除「邮件」（功能已删）、「订阅号」（不支持模板消息，只能 48h 客服消息或全员群发）、「小程序订阅消息」（字段 ≤20 字装不下故事正文）。候选：飞书/企业微信群机器人 webhook（推荐）或纯查库。

### 本轮全量结果（`node test/run_all.js`）

```
✓  JS 语法检查                 34 个文件，全部通过
✓  check_audit_redlines.js    审核红线 + 分包检查全部通过（新增 R9 包内禁止 webp）
✓  smoke_cloudfunctions.js    7 OK / 0 FAIL
✓  test_constants_sync.js     15 PASS / 0 FAIL
✓  test_ai_gen_units.js       20 PASS / 0 FAIL
✓  test_points_daily.js       12 PASS / 0 FAIL
✓  test_vp_units.js           23 PASS / 0 FAIL
✓  test_e2e_flow.js           22 PASS / 0 FAIL
════ SUMMARY：全部通过 ════
```

体积：主包 44 文件 **0.32 MB**（16.1%）/ 分包 `packageReader` 36 文件 **1.65 MB**（82.4%）/ 分包 `packageSample` 58 文件 **1.60 MB**（79.9%）/ 合计 3.57 MB。



---

## 2026-09-18 22:2x · 体验版 1.1.3 上传成功（补 R10 闸门 + 隐私拦截器纠错）

**上传被平台拒过两次，根因都不在本地闸门覆盖范围内**，已各补一条硬闸门：

| 现象 | 真因 | 固化 |
|---|---|---|
| `upload` 报 `code 20058, preloadRule [pages/index/index] source size 3320KB exceed max limit 2MB` | `preloadRule` 预下载**合计** ≤2MB；`reader`(1.65) + `sample`(1.60) 逐包都合规但合计 3.25MB 超限 | **闸门 R10**：按 preloadRule 分组求和各分包体积，>2MB 阻断。修法 = `packages` 只留 `reader`，`sample` 改按需下载 |
| 真机「添加图片」点了没反应 /「复制」跳空授权页 | `__usePrivacyCheck__:true` 下受保护 API 被静默拦截；且原拦截器回调里**嵌套** `wx.requirePrivacyAuthorize` → 它自身会再触发监听器 ⇒ **无限弹窗循环** | `app.js#setupPrivacyGuard()` 重写：`resolve({event:'exposureAuthorization'})` → `resolve({event:'agree'})`，回调内**绝不**嵌套 requirePrivacyAuthorize，补 `fail` settle，兼容探测两个 API 名 |

**R10 反向验证**：临时改回 `["reader","sample"]` → 报红「合计 3.25 MB 超 2MB」；还原 → 「合计 1.65 MB」通过。
**R9（webp）** 本轮亦复验：塞 `__probe.webp` → 报红；删除 → 全绿。

```
✓  JS 语法检查                 34 个文件，全部通过
✓  check_audit_redlines.js    审核红线 + 分包检查全部通过（R9 webp + R10 预下载合计）
✓  smoke_cloudfunctions.js    7 OK / 0 FAIL
✓  test_constants_sync.js     15 PASS / 0 FAIL
✓  test_ai_gen_units.js       20 PASS / 0 FAIL
✓  test_points_daily.js       12 PASS / 0 FAIL
✓  test_vp_units.js           23 PASS / 0 FAIL
✓  test_e2e_flow.js           22 PASS / 0 FAIL
════ SUMMARY：全部通过 ════
```

**平台返回的真实包体**（`upload` 成功返回体的 `info.size.packages`，比本地估算更权威，可作对账依据）：

| 包 | 字节 | MB |
|---|---|---|
| main | 295,297 | 0.28 |
| /packageReader/ | 1,725,081 | 1.65 |
| /packageSample/ | 1,675,445 | 1.60 |
| **TOTAL** | **3,695,823** | **3.52** |

**云函数运行时验证（不只看 status）**：`vp_get_profile` 探针 `{action:'touch'}` 返回 `{ok:true, openid}`（旧版返回 `{openid, unlockedAll}`）⇒ 新版真生效；`app_users` 集合已自动创建，`cloud_db_read_doc` 读到真实文档 `{_id:openid, visits:1, firstSeen, lastSeen}`。`ai_gen` 部署返回 `filesCount:2 / packSize:12.7KB` 且无内层 error。

> 注意：云函数部署任务的 `status:"success"` 可能是**假绿**——真实失败信息藏在内层 `result.<函数名>.error`。本轮两个函数第一次「成功」实为 `FailedOperation.UpdateFunctionCode: 当前函数处于Updating状态`，须读内层字段并带间隔重试。

---

## 2026-09-18 23:xx · 朋友圈文案升级：五类型框架 + 配比引导 + 连环画直连

**背景**：用户带来网页版《朋友圈文案工作台》三件套（`README.md` / `server.js` / `index朋友圈文案.html`），
要求「朋友圈文案部分升级一下」。核心差异不是「新版覆盖旧版」，而是补上两个缺口：

| 缺口 | 网页版有 / 小程序无 | 本次落地 |
|---|---|---|
| 用户可控类型 | 网页版先选 4 类 Tab 再填表；小程序只能让 AI 猜 | **gen 页顶部类型 Tab**（智能判断 / 价值 / 人设 / 成交 / 生活 / 我的故事） |
| 差异化字数 | 网页版每类独立区间；小程序统一 150-300 / 120-220 | 提示词按类型给区间：价值 100-200 · 人设 150-220 · 成交 180-280 · 生活 80-150 · 叙事 200-400 |
| 发布节奏引导 | 网页版有配比表（价值 50-55% 等） | gen 页「📊 四类内容怎么配比着发？」可展开卡片（默认收起） |

**新增第 5 类「叙事型（我的故事 / 往事 / 小说 / 随笔）」**——这是用户点名的关键补充。
理由：**定制连环画的入口就在 gen 页**，但此前没有对应类型，用户写的往事/小说被迫往营销框架里套。
叙事型是唯一**显式禁止营销引导**的类型（提示词内写明禁止产品/引导/促销），因为它是连环画的**素材**，不是广告。
结果区在叙事型下多一个紫调专属卡「📖 这条可以变成连环画」→ 直跳 commission 并**带上选中的那条文案**。

### 实现要点

- **`kind` 契约**：`auto|value|persona|deal|life|story`（`MOMENTS_KINDS` 白名单）。
  服务端 `normalizeKind()` 归一化，非法值一律退化 `auto`（脏值永不透传，有测试钉死）。
  缺省 `auto` = AI 自行判定并要求首组标注「（类型：XX型）」。
- **⚠️ 关键设计：类型声明拼进「用户消息」而非「系统提示词」**。
  `caching.prefix=true` 要求系统提示词**逐字节一致**才能命中缓存；把 kind 做成插值会让每次请求前缀都不同
  ⇒ 缓存全失效、输入成本翻数倍。所以 `SYSTEM_PROMPT_MOMENTS` 是**单一固定字符串**（不含任何 kind 插值），
  kind 只影响 `buildKindDirective()` 产出的用户消息前缀。
  **有专门测试**用两次不同 kind 请求的 `input[0].content` 做 `strictEqual` 比对来钉死这条。
- **切换类型清空旧结果**：不同类别的字数/结构差异大，留着旧结果会让用户误以为新类型产出。
- **`isStory` 以服务端返回的 `kind` 为准回写**（服务端做了归一化，比前端本地状态可信）。
- **`onGoCustom` 取值优先级**：选中的那条文案 > 原始输入 > 不带参。
  用户已经挑好了最心动的那条，直接当定制素材最顺。

### 新增测试（`test_ai_gen_units.js` 20 → 28 PASS）

| 用例 | 守什么 |
|---|---|
| `kind=story` → 用户消息带「叙事型」声明 + 返回 `kind=story` | 类型路由打通；声明在用户消息**最前** |
| `kind=deal` → 含「成交型（180-280 字）」 | 区间正确映射 |
| `kind` 非法值（`../../etc/passwd`）→ 归一化 `auto`，脏值不入模型输入 | 注入防护 |
| 缺省 `kind` → `auto` | 老前端兼容（不带 kind 字段） |
| `comic` 模式不受 `kind` 影响 | 类型声明不污染连环画路径 |
| **★ 系统提示词跨 kind 逐字节一致** | 前缀缓存不被打散（6 个 kind 两两比对） |
| **★ 系统提示词字数区间与类型一一对应** | 防漏改：5 个区间标签 + 叙事型显式禁止营销 |
| 换一批（`feedback`）时类型声明仍在最前 | 不会被 `previous` 块挤掉 |

### 回归

```
✓  JS 语法检查                 35 个文件，全部通过
✓  check_audit_redlines.js    审核红线 + 分包检查全部通过（R9 webp + R10 预下载合计）
✓  smoke_cloudfunctions.js    7 OK / 0 FAIL
✓  test_constants_sync.js     15 PASS / 0 FAIL
✓  test_ai_gen_units.js       28 PASS / 0 FAIL   ← 20 → 28，新增 8 条类型路由用例
✓  test_points_daily.js       12 PASS / 0 FAIL
✓  test_vp_units.js           23 PASS / 0 FAIL
✓  test_custom_request.js     9 PASS / 0 FAIL
✓  test_e2e_flow.js           22 PASS / 0 FAIL
════ SUMMARY：全部通过 ════
```

**未采纳**：网页版的「模型设置（填 API Key）」与「SSE 流式输出」。
理由：小程序里 Key 绝不能进前端（个人虚拟支付红线，且已有云函数托管）；云函数是**非流式**返回，
改成流式需要 SSE 透传 + 前端分片渲染，收益（观感）不抵复杂度（且移动端弱网下分片反而更易断）。

---

## 2026-09-19 00:xx · 字数规则改为「跟随用户输入」（推翻按类型定死字数）

**用户原话**：「其实应该来源于用户的字数，如果用户写了个长的，我们给的反馈就是长的，如果用户是短的，我们就给短的反馈。
如果用户就给了一句话，特别简单的，也至少给生成 80 个字，这样才有具体，有细节，有内容。」

⇒ 上一版「按类型定死字数」（价值 100-200 / 成交 180-280 / 叙事 200-400）**方向错了**。
类型应该只决定**结构与语气**，不决定**长度**。已重构：**长度由用户原文的实际字数推出**。

### 新规则（四条，按优先级）

| 优先级 | 规则 | 落地 |
|---|---|---|
| 1（最高） | 用户明确要求的长度（"再长一点/短一点/多写点"） | 提示词写明「以用户要求为准，要长则不设上限」 |
| 2 | **本次长度**（由用户原文长度推出） | `momentLengthHint(n)` → 写进用户消息【本次长度】 |
| 3 | 类型的结构描述 | 各类型只描述要素与段落结构，不再带字数 |

**硬下限 80 字**：任何情况（含只有一句话、只有一个词、只有一张图）每组不低于 80 字。
**补足方式**：靠**把用户已有的信息写具体**（展开动作/场景/光线/气味/情绪层次），
**不是**编造原文没有的人物、地点、事件 —— 提示词里明确「这条比字数更重要，宁可写短也不许编」。

### 长度档位（`OUT_LEN_TIERS`，前后端各一份副本）

| 用户原文 | 输出/组 |
|---|---|
| < 50 字（一句话级） | **80-150** |
| 50-199 字 | 150-300 |
| 200-499 字 | 250-450 |
| ≥ 500 字 | 350-700 |

### 🐛 顺带修掉一个真会出问题的隐患：`max_output_tokens` 写死导致长输出被截断

原 `maxOut` 对 moments 写死 **1500**。但新规则下用户给长文时，3 组 × 350-700 字 ≈ **2100 字**，
1500 token 明显不够 ⇒ **第 2、3 组被截断成半截话**，`parseMoments` 拆出来的就是残句。
而这是**恰好发生在用户最在意的那个场景**（长输入→长输出）里的静默故障，本地测试全绿也发现不了。

修法：`maxOut = min(4000, max(1500, round(3 × 单组上限 × 1.2) + 200))`
—— 随档位浮动、保留 1500 旧下限（短输入不退化）、4000 封顶防撑爆。
实测：短 1500 / 中 1500 / 长 **2720**。**已加断言**要求「随长度单调递增且长文档位 ≥2100」，并反向验证过（改回死值即 FAIL）。

### 前端可见性：把规则做成用户看得见的提示

输入框下新增实时提示「**预计输出 80-150 字**」+ 一行说明「文案长度跟着你的输入走：你写得多，就给得更长；
只写一句话也至少 80 字（靠展开细节，不编造事实）」。
⇒ 直接回应「为什么文案那么短」的困惑：用户输入时就知道会给多长，而不是生成完才失望。
类型说明也从「建议 100-200 字」改为「**结构**：切题 → 展开 → 收获」（因为字数不再由类型决定）。

### ⚠️ 防漂移：`OUT_LEN_TIERS` 有两份副本，已加源码级闸门

前端 `pages/gen/gen.js`（界面提示）与云函数 `cloudfunctions/ai_gen/index.js`（权威约束）各存一份。
不一致的后果很具体：**界面提示 80-150，实际生成 350-700** —— 用户会认为功能撒谎，而所有既有测试仍全绿。

新增 `test_constants_sync.js` 三条断言（均反向验证过会 FAIL）：
1. `OUT_LEN_TIERS` 前后端**归一化空白后逐字一致**。
2. `OUT_LEN_FLOOR = 80` 两处都在，且**每个档位下限都 ≥80**（防只改末档忘了首档）。
3. 前端 `KINDS` 的 id 全部在服务端 `MOMENTS_KINDS` 白名单内（**反向也查**：白名单里的类型前端必须有入口，
   防「永远选不到的死类型」）。静默失败场景：前端加类型但忘了同步服务端 ⇒ 服务端安静退化为 auto，
   用户选了类型却拿到「AI 自己猜」且无任何提示。

### 回归（全绿）

```
✓ JS 语法检查 35 · 红线+R9+R10 · smoke 7
✓ test_constants_sync.js  15 → 18 PASS   ← +3（OUT_LEN_TIERS 一致 / FLOOR / KINDS 白名单）
✓ test_ai_gen_units.js    20 → 35 PASS   ← +15（类型路由 8 + 长度规则 5 + maxOut 2）
✓ points 12 · vp 23 · custom_request 9 · e2e 22
════ SUMMARY：全部通过 ════
```

**⏸ 仍未部署**：`ai_gen` 本轮改动（类型框架 + 长度规则 + maxOut 修复）**尚未推到云端**——
微信开发者工具未运行（`wechatide` 写操作返回假的 `Waiting for user authorization`，
`tasklist` 查不到 `微信开发者工具.exe`）。需用户手动打开 IDE 后部署。

---

## 2026-09-19 01:xx · 部署事故与修复 + 长度规则运行时验证通过

### 🔴 事故：CLI 部署把 `ai_gen` 的依赖搞丢了（线上不可用）

用 `wechatide cloud_fn_deploy` 部署后，返回体**完全正常**：
```json
{"success":true,"detail":"execution_success","result":{"ai_gen":{"filesCount":2,"packSize":"16.7 KB"}}}
```
**没有任何 error 字段**。但真调一次直接炸：
```
errCode: -504002 functions execute fail | Error: Cannot find module 'wx-server-sdk'
```
⇒ 整个 AI 生成功能**线上不可用**，而部署返回体是绿的。

**根因**：不带 `--remote-npm-install` 时只上传 `index.js` + `package.json`（`filesCount:2` 就是线索），
云端原有依赖被覆盖没了。`custom_request` 碰巧还留着早年 IDE GUI 部署装的依赖所以没炸，`ai_gen` 重部署两次就炸了。

**修复**：`cloud_fn_deploy ... --remote-npm-install`（第 4 次尝试成功；前 3 次撞 `Updating` 锁，该锁在带 npm 安装时持续更久）。

> **新增铁律**：**云函数部署必须带 `--remote-npm-install`；部署成功 ≠ 函数可用；改完必须跑运行时探针。**
> 已做成**代码层守卫**：`ops/wxcli.py#guard_deploy()` 对 `cloud_fn_deploy` **自动注入**该 flag 并打印警告。

### ✅ 修复后运行时验证（硬证据）

| 项 | 结果 |
|---|---|
| 快速探针（无输入 → 扣费前返回） | `{ok:false, err:'请输入文字、上传图片或粘贴文章链接'}` ⇒ 函数体已执行、依赖已恢复 |
| 真生成：输入 **18 字**「那年夏天，我在老屋的院子里等一场雨。」`kind:'story'` | **输出 139 / 131 / 131 字**（档位 80-150）✅ 全部 ≥80 下限 |
| `kind` 回传 | `story` ✅ |
| 积分对账 | 83 → **43**（2 次 × 20） |

样张质量（叙事型）：老槐叶 / 青石板 / 青苔的腥气 / 收音机卡带 / 冰棒 / 陶缸 → 收在
「后来才懂，那年等的不只是雨，是没敢说出口的软话」。**全程无产品、无引导、无促销** ⇒ 叙事型的禁止营销规则生效。

### 🐛 工具链两个坑（已固化进 skill `wx-cloudfn-runtime-verify`）

1. **`wechatide.cmd` 的 `%*` 会劈开含空格/括号的参数值** → 报 `'C:/Program' 不是内部或外部命令`（指向它自己目录），
   看起来像工具坏了。迷惑点：**同客户端别的工具正常**（`automation_runtime_info --project X` ✅，
   `automation_evaluate --fn-source "function(){return 1;}"` ❌）。引号/转义/去空格全试过，无效。
   **正解 = `ops/wxcli.py`**（绕过 cmd.exe，复刻 wechatide.cmd 直接调 Electron，纯 argv 给 CreateProcess）。
2. **别用正则筛 `tasklist` 判 IDE 是否在跑**：输出是 GBK 字节，`微信开发者工具.exe` 解码后为
   `Î¢ÐÅ¿ª·¢Õß¹¤¾ß.exe`，**匹配不到 ≠ 没在运行**（我曾因此误判，白跑多轮）。
   用 `tasklist /FI "IMAGENAME eq 微信开发者工具.exe"`。

### 回归（全绿，未受影响）

```
✓ JS 语法检查 35 · 红线+R9+R10 · smoke 7
✓ constants 18 · ai_gen 35 · points 12 · vp 23 · custom_request 9 · e2e 22
════ SUMMARY：全部通过 ════
```

---

## 00:5x · 事故爆炸半径核查：7 个云函数逐个真调 → **全部健康**

### 为什么要查

「部署丢依赖」事故的破坏方式是**返回体全绿但云端依赖被覆盖没了**，当时只发现 `ai_gen` 一个。
同一个部署通道在同期碰过的其它函数，**理论上都可能中招** —— 不能假设只有一个。
这正是「**部署成功 ≠ 函数可用**」的直接推论：既然部署返回体不可信，就只能逐个真调。

### 新增工具 `ops/probe_fns.py`（工程外，可复用）

| 设计点 | 说明 |
|---|---|
| **逐函数独立调用** | 一次传 7 个 → 实测 `timeout waiting for automator response`（automator 响应超时）。逐个探实测 **3 秒/个**。 |
| **零副作用** | 入参逐个对照 `exports.main` 开头的守卫顺序选：`vp_deliver {}` → Event 不匹配即 `ack(0,'ignored')`；`ai_gen {}` → 空输入在 `chargePoints` **之前** return；`custom_request {action:'test_notify'}` → 官方自检入口。 |
| **判据独立于工具层** | 逐层剥开工具包装、还原 `RESULT:` 里的 JSON，**只看云函数自己返回的内容**，避免把工具报错误判成函数问题。 |

### 结果：7/7 通过

| 函数 | 实际返回 | 读数 |
|---|---|---|
| `vp_get_profile` | `{ok:true, openid:'oYYznxSf3E9YeDYwKFaXSnbp5WnE'}` | ✅ |
| `vp_query` | `{error:'参数缺失（openid/outTradeNo 或服务端密钥未配置）'}` | ✅ 守卫 |
| `points` | `{ok:true, points:43, coupons:[]}` | ✅ |
| `vp_deliver` | `<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[ignored]]></ErrMsg></xml>` | ✅ 正确 ack |
| `vp_create_order` | `{error:'登录态获取失败：invalid code, rid: 6aad6d4c-…'}` | ✅ 顺带证明 `VP_APP_ID/VP_APP_SECRET` **运行时读得到** |
| `ai_gen` | `{ok:false, err:'请输入文字、上传图片或粘贴文章链接'}` | ✅ 守卫 |
| `custom_request` | `{ok:false, configured:false, err:'未配置 FEISHU_WEBHOOK'}` | ✅ 待配 webhook |

**两条附带结论**

1. 事故**爆炸半径被控制在了 `ai_gen` 一个函数**（已修），其余 6 个当时未被该通道破坏。
2. 探针跑完积分仍是 **43** ⇒ 再次证明 `ai_gen` 空输入走的是**扣分前**返回，探针确实零成本。

### 既有回归（复跑，未受影响）

```
✓ JS 语法检查 35 个文件 · 红线+R9+R10 · smoke 7 OK
✓ constants 18 · ai_gen 35 · points 12 · vp 23 · custom_request 9 · e2e 22
════ SUMMARY：全部通过 ════
```
