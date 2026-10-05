// 产品与章节配置（整本购买模型）
// 面板文件位于 packageReader/panels/（分包，随阅读页一起加载；共 1.63MB，放主包会超 2MB 上限），
// 命名规则：e{话}_{格}_sm.jpg。主包内的 pages/commission 只用 images/samples/ 下的缩略图，
// 因为主包不能引用分包资源。chapters 里的 panels 只写文件名（不含路径与扩展名），
// 由 packageReader/pages/reader/reader.js 拼成 /packageReader/panels/<name>.jpg。
// PRODUCT = 首篇「样例作品」配置（应用内作品标题）。注意：它不是小程序 APP 名——
// 本小程序 APP 名(平台/工具名)是「dudu画面感内容工具」，在 MP 后台设置，不在代码里。
const PRODUCT = {
  title: '美汐的故事',   // 样例作品 #1（首屏默认展示）；后续每篇作品可单独配一组 PRODUCT
  author: '春英',
  price: 9.9,            // 整本价格（元）
  currency: '¥',
  unlockMode: 'all',      // 'all' = 整本购买（解锁后全部章节开放）
  chapters: [
    { id: 'e01', name: '第1话', free: true,  panels: ['e01_p01_sm','e01_p02_sm','e01_p03_sm','e01_p04_sm'] },
    { id: 'e02', name: '第2话', free: false, panels: ['e02_p01_sm','e02_p02_sm','e02_p03_sm','e02_p04_sm'] },
    { id: 'e03', name: '第3话', free: false, panels: ['e03_p01_sm','e03_p02_sm','e03_p03_sm','e03_p04_sm'] },
    { id: 'e04', name: '第4话', free: false, panels: ['e04_p01_sm','e04_p02_sm','e04_p03_sm','e04_p04_sm'] },
    { id: 'e05', name: '第5话', free: false, panels: ['e05_p01_sm','e05_p02_sm','e05_p03_sm','e05_p04_sm'] },
    { id: 'e06', name: '第6话', free: false, panels: ['e06_p01_sm','e06_p02_sm','e06_p03_sm','e06_p04_sm'] },
    { id: 'e07', name: '第7话', free: false, panels: ['e07_p01_sm','e07_p02_sm','e07_p03_sm','e07_p04_sm'] },
    { id: 'e08', name: '第8话', free: false, panels: ['e08_p01_sm','e08_p02_sm','e08_p03_sm','e08_p04_sm'] }
  ]
};

// ─────────────────────────────────────────────────────────────
// 个人虚拟支付（微信官方「虚拟支付 · 个人」能力，无需注册公司）
// 官方文档：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html
//
// 硬性前置（务必先满足，否则后台「虚拟支付」入口根本不会出现）：
//   ① 小程序主体 = 个人（持有居民身份证）
//   ② 服务类目【含「工具」】  ← 漫画/小说类目不满足条件，需在 MP 后台补一个「工具」类目
//   ③ 已完成小程序【认证 + 备案】
//   ④ 用微信云开发做服务端（签名/发货推送/查单都必须在服务端，前端绝不能持有 AppKey）
//   ⑤ 月支付限额 10 万元（全终端）
//   ⑥ iOS 额外：需配置「小程序简称」+ 开通苹果 IAP，且用户微信 ≥ 8.0.68
// ─────────────────────────────────────────────────────────────
const VIRTUAL_PAY = {
  enabled: true,            // 是否启用个人虚拟支付（满足上述前置后改为 true）
  useCloud: true,           // 个人虚拟支付必须用服务端，这里走微信云开发
  cloudEnv: 'cloudbase-d8ge1hu2324c8fcdf',             // 云开发环境 ID（与 BACKEND.env 填同一个即可）

  // 以下三项在 MP 后台「虚拟支付 → 基本配置」获取；AppKey 必须放云函数环境变量，绝不可写前端
  offerId: '1450652139',    // 虚拟支付商户号 OfferID（服务端用；运行时以云函数环境变量 VP_OFFER_ID 为准）
  appKey: '',               // 现网 AppKey（仅服务端用 → 放云函数环境变量 VP_APP_KEY）

  // 道具（在 MP 后台「虚拟支付 → 道具管理」创建并发布；道具ID 需与后台完全一致）
  // ⚠️ 2026-09-24：comic_full（整本解锁）已随原生阅读器下架，仅作「已付费老用户兜底解锁」语义保留，
  //    不再有新的小程序内购买入口（pages/order 的整本入口已移除）。MP 后台该道具应下架。
  //    新购走 COMMISSION.tiers（comic_pdf/comic_web）与 POINTS.packs（积分充值）。
  productId: 'comic_full',  // 整本解锁道具 ID（已下架售卖，保留用于老用户兜底；前后端一致）
  itemName: '《美汐的故事》整本解锁',
  priceFen: 990,            // 道具单价（分）= PRODUCT.price * 100；须与后台道具价格一致

  // 支付参数（按官方签名规范，固定值）
  env: 0,                   // 固定 0（现网）
  currencyType: 'CNY',
  buyQuantity: 1,
  mode: 'short_series_goods', // 道具直购模式，固定值

  iosMinWechat: '8.0.68'    // iOS 端需微信客户端 ≥ 此版本
};

// 赞赏码 / 兑换码（个人主体的兜底方案；但【个人主体上线务必把 rewardEnabled 设为 false】——
// 小程序内展示个人微信收款码/赞赏码并引导加好友付款，会被审核判「场外交易/无资质收款」直接拒绝。
// 赞赏、收款请走公众号，不要在小程序内放个人收款码。redeemCodes 仅作赠阅/活动核销用。）
const PAY_CONFIG = {
  // 【审核关键】个人主体上线务必保持 false：方式二(赞赏码/兑换码)入口默认关闭，避免应用内收款码导致审核拒绝
  rewardEnabled: false,
  // true=已具备微信支付能力（个体户/企业商户号）；个人主体请用 VIRTUAL_PAY（虚拟支付）
  wechatPayEnabled: false,
  // 后端统一下单接口（个体户 JSAPI 路径用，详见 server/wechatpay_example.js）
  orderApi: 'https://your-domain.com/api/comic/order',
  // 赞赏码图片：把你的微信赞赏码/收款码截图放到 images/reward_qr.png 替换占位图
  rewardQr: '/images/reward_qr.png',
  // 你的微信（仅页面提示读者「赞赏后联系作者取码」用，不会自动收款）
  authorWechat: 'yunlinyue',
  // 兑换码（演示用，正式上线应改为服务端核销 + 一次性 + 防刷）
  redeemCodes: ['MEIXI2026', 'COMIC666']
};

// 后端配置（微信云开发 / 自建服务器）。
// 重要：手机号快速验证组件 与 标准微信支付(JSAPI) 都【仅限非个人主体(个体户/企业)且已认证】。
//       个人主体调用这两个能力会被拒审，故包内禁止出现其调用（由 test/check_audit_redlines.js 守卫）。
// 个人主体请用 VIRTUAL_PAY（虚拟支付）+ 云开发，用户以 openid 标识即可完成发货与解锁，无需手机号。
const BACKEND = {
  useCloud: false,      // true=启用云开发后端（个体户路径：手机号登录 + 标准微信支付 JSAPI）
  env: 'cloudbase-d8ge1hu2324c8fcdf',              // 云开发环境 ID（虚拟支付与个体户路径共用同一个环境）
  loginMode: 'anonymous', // 'anonymous'=仅 openid 静默标识（个人主体默认、可用）；'phone'=手机号一键登录（需非个人主体+认证，个人主体会隐藏）
  orderApi: 'https://your-domain.com/api/comic/order'
};

// 定制画面感内容（路B 变现 · 个人主体合规漏斗）
// 用户付费后加作者微信，作者用 WorkBuddy 人工生成专属画面感内容；app 内不做"用户文字→出图"。
// 付费复用个人虚拟支付 vp_*（与路A 同一套），productId 复用 comic_full。
const COMMISSION = {
  currency: '¥',
  itemName: '定制画面感内容',
  // ── 2026-09-18 用户拍板：付费定制两档 + 邮箱人工交付 ──
  // 客户流程：选档 → 虚拟支付 → 填邮箱 → 落库（custom_comic_requests）→ 8 小时内人工生成回邮。
  // productId/priceFen 必须与 MP 后台道具、vp_create_order/vp_deliver/vp_query 的 PRODUCTS 三方一致。
  deliveryHours: 8,
  contact: {
    email: '39764023@qq.com',
    wechat: 'yunlinyue'
  },
  tiers: [
    { productId: 'comic_pdf',  name: '画面感内容PDF',  priceFen: 6600, priceText: '¥66', desc: '高清 PDF 文件，可下载保存、方便打印' },
    { productId: 'comic_web',  name: '画面感内容HTML', priceFen: 8800, priceText: '¥88', desc: '在线 HTML 内容，随时打开翻阅、便于分享' }
  ]
};

// ─────────────────────────────────────────────────────────────
// 积分机制（路B 行为激励 + 兑换 + 充值）
// 设计原则：
//   ① 赚取(earn) 全部由服务端记账（每日签到 / 新人礼，由 points 云函数幂等发放），客户端无法伪造。
//   ② 余额与花费(spend) 存云数据库 vp_users.points（openid 维度），由 points 云函数原子增减。
//   ③ 充值(recharge) 走个人虚拟支付 vp_*，名义=「购买虚拟商品(积分权益包)」，积分是附属记账单位，
//      绝不当作法币/可提现代币宣传（个人主体合规红线，详见 ARCH_HEALTH.md）。
//   ④ 兑换(redeem) = 花积分换 app 内权益（优惠券/增值服务），不涉及法币。
// ─────────────────────────────────────────────────────────────
const POINTS = {
  enabled: true,
  // 行为赚取（免费激励，鼓励使用；数值可由你调整）
  // 2026-09-19 用户拍板：**「生成画面感内容脚本」这一步不存在**。画面感内容只能走**付费定制**
  // （pages/commission → ¥66/¥88 下单 → 人工绘制），脚本是履约时的内部工作稿，
  // 不对用户生成、也不送积分。故 earn 与 cost 里都已无 comic 相关档位。
  earn: {
    // （空）—— 生成类行为一律扣分，不再有「生成赚分」
  },
  // 花费（积分兑换 + 端内产出型工具扣费）
  // ⚠️ 2026-10-01 重做：此前为合规（零 AI）把端内功能都改成免费；现用户要求**所有产出型工具都走积分扣除**。
  //    统一在此集中配置，页面通过 utils/charge.js 的 charge(action) 落地；改价只动这里，
  //    页面按钮文案与积分页 earnTip 都从本表读取，自动同步（不再写死数字）。
  //    计费出口此刻真实存在：套模板 / 排版优化 / 公众号文章 / 生成分镜 / 生成卡片。
  cost: {
    momentsGen: 20,      // 模板匹配·套模板出文案（每次生成）
    optFormat: 2,        // 排版优化 / 公众号文章：每次应用（防折叠 / 加 emoji / 分段）
    comicGen: 20,        // 分镜编辑器·生成分镜
    cardGen: 20,         // 卡片制作·生成卡片
    posterGen: 20,       // 海报长图·生成海报（2026-10-01 新增；纯前端扣费档，与 cardGen 同价）
    // 「换一批」比首次便宜 5 分 —— 用户拍板的有意设计（复购优惠），保留常量备用。
    // ⚠️ 勿"修正"为 >= momentsGen；test/test_constants_sync.js 第 12 条会断言 momentsRevise < momentsGen。
    momentsRevise: 15    // （保留备用）换一批复购优惠价；端内暂无入口
  },
  // ── 新人礼（首次进入小程序一次性赠送）──
  // 用户拍板（2026-09-19 原 100；2026-09-23 降为 80）：每个用户刚登录就送 80 积分。
  // 规则：用户首次进入小程序时由服务端发放，**每人仅一次**（幂等 CAS，重复进出/并发都不会重发）。
  // 与「每日登录奖励」相互独立：daily.enabled 关掉也照发（新人礼不是每日奖励的一部分）。
  // ⚠️ 数值须与 cloudfunctions/points/index.js 的 SIGNUP 保持一致（改一处必须两处同改）。
  signupBonus: {
    enabled: true,
    amount: 80              // 一次性赠送积分数（2026-09-23 由 100 降为 80）
  },
  // ── 每日登录奖励（签到送积分）──
  // 规则：进入小程序即由服务端自动发放，每天（北京时间自然日）仅一次；客户端可重复调用但不会重复发放。
  // 奖励 = base + 连签每日递增 +1（封顶 streakCap，即第 streakCap+1 天起恒为 base+streakCap），
  //       每连续 milestoneEvery 天再额外加 milestoneBonus。用户拍板（2026-09-23 调整）：base=30，多签一天+1。
  // ⚠️ 数值须与 cloudfunctions/points/index.js 的 DAILY 保持一致（云函数不能可靠跨包 require，改一处必须两处同改）。
  daily: {
    enabled: true,          // 是否开启每日登录奖励
    base: 30,               // 每日基础积分（连签第 1 天）
    streakCap: 10,          // 连签加成封顶：每天 +1，最多加 10（第 11 天起固定 40/天）
    milestoneEvery: 7,      // 每连续 N 天算一个里程碑
    milestoneBonus: 15      // 里程碑额外奖励（与当日基础+连签加成叠加）
  },
  // 积分兑换(redeem) 目录：花 cost 积分，grant 权益写入 vp_users.coupons
  // 这是示例项，可增删；spend 时服务端会校验余额后再扣减并落地 grant。
  redeem: [
  ],
  // 积分充值（¥→积分）：走个人虚拟支付，每个 pack 对应 MP 后台一个虚拟支付道具（productId）
  // 注意：productId / priceFen 必须与 MP 后台道具**完全一致**（priceFen = 元 × 100）；
  //      单价刻意递增（¥6→200=33.3/元 · ¥18→800=44.4/元 · ¥50→2500=50/元），
  //      即"大包更划算"，角标 `tag` 打在真正的最高档上。改价必须同步 MP 后台道具。
  //      ⚠️ 道具ID/价格发布后一般不可改，需新建道具（旧的下架）——以 MP 后台实际规则为准。
  //      ⚠️ productId 的数字后缀必须等于 amount，否则后来的人会看错档位（一致性测试会查这点）。
  rechargeEnabled: true,   // 是否开放充值（个人主体卖积分有审核风险，关闭则积分只靠免费行为赚取）
  packs: [
    { productId: 'points_200',  priceFen: 600,  amount: 200,  name: '200 积分',  priceText: '¥6' },
    { productId: 'points_800',  priceFen: 1800, amount: 800,  name: '800 积分',  priceText: '¥18' },
    { productId: 'points_2500', priceFen: 5000, amount: 2500, name: '2500 积分', priceText: '¥50', tag: '最超值' }
  ]
};

module.exports = { PRODUCT, VIRTUAL_PAY, PAY_CONFIG, BACKEND, COMMISSION, POINTS };
