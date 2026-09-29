# MP 后台操作 runbook（个人虚拟支付上线 · 人工点击步骤）

> 本文件只覆盖**必须在 mp.weixin.qq.com 人工点击**的部分（你列的 5 项 + ¥1 真单验证）。
> 云函数部署/环境变量/集合等见 `DEPLOY_CHECKLIST.md`。
> 前置：开发者工具已用**真实 AppID**打开 `comic_miniapp/`（见下方步骤 0）。

---

## 0. 换真实 AppID（红线 A，否则无法提交审核）

1. 打开微信开发者工具 →「导入项目」→ 目录选 `comic_miniapp/`。
2. **AppID 已预填 `wxacf98605ac5b0218`**（导入时确认是「自己的小程序」，不要切回「测试号 / touristappid」）。
3. 编译一次。`project.config.json` 的 `appid` 字段会**自动**改写为真实值。
   - 若你希望我直接写进文件，把真实 AppID 发我即可（不进代码仓库敏感区，仅本地配置）。

---

## 1. 补挂「工具」类目（虚拟支付硬性门槛）

1. 浏览器登录 <https://mp.weixin.qq.com> → 进入你的小程序。
2. 左侧「**设置 → 基本设置 → 服务类目**」→ 看当前类目。
3. 若**不含「工具」**：点「**+ 添加类目**」→ 一级选「**工具**」→ 二级选「工具 / 其他」（最稳，避免子类资质）。
4. 按提示提交：个人主体通常只需身份证；提交后等审核（多数即时/数小时内）。
5. 列表出现「工具」即满足条件。**原有漫画类目保留**，多类目并存。

> 若「工具」被拒（称与内容不符），个人主体这条路走不通，需退回个体户路径（见 `README.md` C 节，参考 `cloudfunctions_deprecated/`）。

---

## 2. 开通虚拟支付 + 发布道具

1. 左侧「**支付与交易 → 虚拟支付**」→「开通」→ 填身份证 / 提现账户 / 支付管理员 → 审核（约 5 分钟）→ 扫码人脸签约。
2. 「**基本配置**」记录 **OfferID**、**现网 AppKey**（AppKey 只填云函数环境变量，见 `DEPLOY_CHECKLIST.md` ③.1，**不要写进代码**）。
3. 「**道具管理**」→「新建道具」：
   - 道具 ID：`comic_full`（须与 `utils/config.js` 的 `VIRTUAL_PAY.productId` 一致）
   - 道具名称：《美汐的故事》整本解锁
   - 价格：**990**（分，= ¥9.9，须与 `priceFen` 一致）
   - 道具图：PNG/JPG，**200×200、<200KB**（可用 AI 生图去水印；ID/名称仅后台可见）
4. 点「**发布**」→ 等几分钟到半小时全平台同步（未同步完下单会报 `COIN_OR_PRODUCT_ID_CREATED_IN_RECENTLY`）。

---

## 3. 配《隐私保护指引》（红线 D）

1. 左侧「**设置 → 服务内容 → 用户隐私保护指引**」→「编辑 / 新建」。
2. 把 `隐私保护指引_草稿.md` 全文粘贴进编辑器；如页面要求补《个人信息收集清单》等必填项，按提示补全。
3. 点「**提交**」→「**发布**」。发布后 `app.js` 里的 `wx.requirePrivacyAuthorize` 才会正常弹授权。

---

## 4. 绑发货推送（支付后解锁的关键，否则付了不解锁）

> 前置：`vp_deliver` 已按 HTTP 触发方式部署，且你已复制其触发 URL（形如 `https://.../release/.../vp_deliver`）。详见 `DEPLOY_CHECKLIST.md` ②.3 与 ③.3。

1. 左侧「**开发管理 → 开发设置 → 消息推送**」→ 启用消息推送 → **绑定你的云开发环境**。
2. 推送模式选/保持「**云函数模式**」（本项目实测 `pushMode=cloudfunction`）。
   ⚠️ 云函数模式下**没有 URL 填写项**，事件是在**云开发侧**绑定到具体云函数的：
   在开发者工具「**云开发控制台 → 消息推送**」面板逐条添加，或直接用 CLI：
   ```bash
   wechatide -c WorkBuddy cloud_manage_msg_push --appid wxacf98605ac5b0218 \
     --env cloudbase-d8ge1hu2324c8fcdf --function-name vp_deliver --action subscribe
   wechatide -c WorkBuddy cloud_manage_msg_push --appid wxacf98605ac5b0218 \
     --env cloudbase-d8ge1hu2324c8fcdf --function-name vp_deliver --action setEnable --enable
   ```
   （`subscribe` 不传 `--event-types` 时默认订阅虚拟支付 7 事件，含 `xpay_goods_deliver_notify`。）
3. 复核：`cloud_query_msg_push --action list` 应显示 `enable: true`、`callbacks` 含 `xpay_goods_deliver_notify → vp_deliver`。
4. 验证：支付成功后云开发「日志」里 `vp_deliver` 应收到 `xpay_goods_deliver_notify` 并返回 `ErrCode:0`。
   ⚠️ 云函数模式下事件是【已解析对象】（`event.Event`），**没有 `event.body`**；`vp_deliver` 两种形态都支持，
   且发货前会调 `xpay/query_order` 确认真实已支付（`VP_APP_ID`/`VP_APP_SECRET`/`VP_APP_KEY` 必须配）。

---

## 5. ¥1 真单验证（必须做，上线前最后一关）

> 用**真机**（非模拟器）扫码预览即可拉起真实支付，不必先发布。

1. 真机打开小程序 → 第 1 话免费读，其余锁定。
2. 购买页点「**方式一 · 微信支付（个人虚拟支付）**」→ 拉起支付 → 付 **¥1 级**小额。
3. 打开云开发「日志」确认 `vp_deliver` 收到 `xpay_goods_deliver_notify`，返回 `ErrCode:0`。
4. 查 `vp_users` 集合：该 openid 文档出现 `unlockedAll: true`。
5. 返回阅读页：整本解锁、各话可看；杀进程重进仍解锁（以服务端为准）。
6. MP「**虚拟支付 → 交易订单**」能看到这笔订单，金额与账单一致。
7. **iOS 额外**：用 iOS 真机微信 ≥ 8.0.68 走一遍（需后台已配「小程序简称」+ 开通苹果 IAP）。

---

## 完成判据（全部打勾即可提交审核）

- [x] 0. 真实 AppID 已写入工程 `project.config.json`（wxacf98605ac5b0218，非 touristappid）
- [ ] 1. 类目含「工具」
- [ ] 2. 虚拟支付已开通 + 道具 `comic_full`(990) 已发布
- [ ] 3. 《隐私保护指引》已提交并发布
- [ ] 4. `vp_deliver` HTTP 触发地址已绑消息推送
- [ ] 5. ¥1 真单验证通过（Android + iOS）
