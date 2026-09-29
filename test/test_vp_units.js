// 虚拟支付云函数行为单测（零依赖）
// 覆盖 vp_deliver（发货推送）与 vp_create_order（下单）：
//   · 积分包 → 只加积分、不解锁整本
//   · 整本   → 解锁，且**不清空用户已有积分/优惠券**（回归早期 set() 覆盖 bug）
//   · 未登记的道具 → 不发货（防伪造通知白拿）
//   · 幂等（同 MchOrderNo 重复推送不重复发放）
//   · 下单价格由服务端目录决定，前端传 priceFen 篡改无效
//   · 【云函数模式】解析对象事件（无 body/无签名）也能发货 —— 本项目 MP 后台实际就是这个模式
//   · 【云函数模式】拿未支付订单号直调 → 查单验真拦住（云函数模式没有签名，这是唯一防线）
//   · 【云函数模式】推送里的 OpenId/ProductId 一律不采信，以 vp_orders 落库值为准
// 运行：node test/test_vp_units.js
const assert = require('assert');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');

// ───────────────────────── 1. 内存版云数据库 ─────────────────────────
let users = {};    // openid -> doc
let orders = [];   // vp_orders 记录

function applyData(doc, data) {
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (v && typeof v === 'object' && typeof v.$inc === 'number') doc[k] = (doc[k] || 0) + v.$inc;
    else doc[k] = v;
  });
}
function matchCond(doc, cond) {
  return Object.keys(cond).every(k => doc[k] === cond[k]);
}

function collection(name) {
  if (name === 'vp_orders') {
    return {
      where: (cond) => ({
        get: async () => ({ data: orders.filter(o => matchCond(o, cond)).map(o => Object.assign({}, o)) }),
        update: async ({ data }) => {
          const hits = orders.filter(o => matchCond(o, cond));
          hits.forEach(o => applyData(o, data));
          return { stats: { updated: hits.length } };
        }
      }),
      add: async ({ data }) => { orders.push(Object.assign({}, data)); return { _id: 'o' + orders.length }; }
    };
  }
  return {
    doc: (id) => ({
      get: async () => { if (!users[id]) throw new Error('document does not exist'); return { data: Object.assign({}, users[id]) }; },
      set: async ({ data }) => { users[id] = Object.assign({}, data); return { stats: {} }; },
      update: async ({ data }) => { if (!users[id]) throw new Error('document does not exist'); applyData(users[id], data); return { stats: { updated: 1 } }; }
    }),
    where: (cond) => ({
      get: async () => ({ data: Object.keys(users).map(k => Object.assign({}, users[k])).filter(d => matchCond(d, cond)) })
    })
  };
}

const cloudStub = {
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  init() {},
  getWXContext: () => ({ OPENID: 'u1' }),
  database: () => ({
    collection,
    command: { inc: (n) => ({ $inc: n }), gte: (n) => ({ $gte: n }) },
    serverDate: () => 'SERVER_DATE'
  })
};

// ───────────────────────── 2. https Stub（vp_create_order / vp_query 用）─────────────────────────
// 可编程路由：按 host+path 决定返回体。早期这里只返回一个固定体，
// 导致 vp_query 的两步调用（先取 access_token 再查单）无法被测（且 request 不 end 会永久挂起）。
let lastGetUrl = '';
let queryOrderHits = 0;
let queryPaid = true;   // 可切换：验证"未支付不发货"

function vpRoute(urlStr) {
  const u = new URL(urlStr);
  if (u.pathname.indexOf('/sns/jscode2session') === 0) {
    return JSON.stringify({ openid: 'u1', session_key: 'SESSION_KEY' });
  }
  if (u.pathname.indexOf('/cgi-bin/token') === 0) {
    return JSON.stringify({ access_token: 'AT_TEST', expires_in: 7200 });
  }
  if (u.pathname.indexOf('/xpay/query_order') === 0) {
    queryOrderHits++;
    return JSON.stringify({ errcode: 0, paid: queryPaid, order_state: queryPaid ? 'PAID' : 'UNPAID' });
  }
  return '{}';
}
function makeRes(body) {
  return {
    on(ev, fn) {
      if (ev === 'data') fn(body);
      if (ev === 'end') fn();
      return this;
    },
    setEncoding() {}, resume() {}, destroy() {}
  };
}
const fakeHttps = {
  request: (opts, cb) => {
    const req = { on() { return req; }, destroy() {}, setTimeout() {}, write() {}, end() { process.nextTick(() => cb(makeRes(vpRoute('https://' + opts.hostname + (opts.path || ''))))); } };
    return req;
  },
  get: (url, cb) => {
    lastGetUrl = url;
    process.nextTick(() => cb(makeRes(vpRoute(url))));
    return { on() { return this; } };
  }
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return cloudStub;
  if (request === 'https' || request === 'http') return fakeHttps;
  return origLoad.apply(this, arguments);
};

process.env.VP_APP_ID = 'wxacf98605ac5b0218';
process.env.VP_APP_SECRET = 'secret-test';
process.env.VP_OFFER_ID = '1450652139';
process.env.VP_APP_KEY = 'appkey-test';

const deliver = require(path.join(__dirname, '..', 'cloudfunctions', 'vp_deliver', 'index.js'));
const createOrder = require(path.join(__dirname, '..', 'cloudfunctions', 'vp_create_order', 'index.js'));
const queryOrder = require(path.join(__dirname, '..', 'cloudfunctions', 'vp_query', 'index.js'));

// ───────────────────────── 3. 工具 ─────────────────────────
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
}
function reset() { users = {}; orders = []; queryOrderHits = 0; }
function notifyXml(f) {
  const kv = Object.keys(f).map(k => '<' + k + '><![CDATA[' + f[k] + ']]></' + k + '>').join('');
  return '<xml><Event><![CDATA[xpay_goods_deliver_notify]]></Event>' + kv + '</xml>';
}
const push = (body) => deliver.main({ body });
const errCode = (r) => (/<ErrCode>(\d+)<\/ErrCode>/.exec(r && r.body) || [])[1];
// 微信「消息推送」签名：sha1(token/timestamp/nonce 按字典序排序后拼接)
const sha1Sign = (token, ts, nonce) => crypto.createHash('sha1').update([token, ts, nonce].sort().join('')).digest('hex');

(async () => {
  // ── vp_deliver ──
  await t('买 800 积分包 → +800 且不解锁整本，优惠券保留', async () => {
    reset();
    users.u1 = { openid: 'u1', points: 100, unlockedAll: false, coupons: [{ type: 'a' }] };
    orders.push({ outTradeNo: 'T1', openid: 'u1', productId: 'points_800', status: 'pending' });
    const r = await push(notifyXml({ OpenId: 'u1', OutTradeNo: 'T1', MchOrderNo: 'W1', ProductId: 'points_800' }));
    assert.strictEqual(errCode(r), '0', '应返回成功');
    assert.strictEqual(users.u1.points, 900, '积分应为 100+800=900，实际 ' + users.u1.points);
    assert.strictEqual(users.u1.unlockedAll, false, '积分包不应解锁整本');
    assert.strictEqual(users.u1.coupons.length, 1, '优惠券不应丢');
    assert.strictEqual(orders[0].status, 'delivered');
  });

  await t('同一 MchOrderNo 重复推送 → 幂等，不重复加分', async () => {
    const r = await push(notifyXml({ OpenId: 'u1', OutTradeNo: 'T1', MchOrderNo: 'W1', ProductId: 'points_800' }));
    assert.strictEqual(errCode(r), '0');
    assert.strictEqual(users.u1.points, 900, '重复推送后仍应为 900，实际 ' + users.u1.points);
  });

  await t('买整本 comic_full → 解锁，且【不清空】已有积分与优惠券（回归 set() 覆盖 bug）', async () => {
    reset();
    users.u2 = { openid: 'u2', points: 555, unlockedAll: false, coupons: [{ type: 'c' }, { type: 'd' }] };
    orders.push({ outTradeNo: 'T2', openid: 'u2', productId: 'comic_full', status: 'pending' });
    const r = await push(notifyXml({ OpenId: 'u2', OutTradeNo: 'T2', MchOrderNo: 'W2', ProductId: 'comic_full' }));
    assert.strictEqual(errCode(r), '0');
    assert.strictEqual(users.u2.unlockedAll, true, '应解锁整本');
    assert.strictEqual(users.u2.points, 555, '积分【必须保留】555，实际 ' + users.u2.points);
    assert.strictEqual(users.u2.coupons.length, 2, '优惠券【必须保留】2 张，实际 ' + users.u2.coupons.length);
  });

  await t('未登记的道具（伪造/错配）→ 不发货：不解锁、不加分', async () => {
    reset();
    users.u3 = { openid: 'u3', points: 10, unlockedAll: false, coupons: [] };
    orders.push({ outTradeNo: 'T3', openid: 'u3', productId: 'hacker_free', status: 'pending' });
    const r = await push(notifyXml({ OpenId: 'u3', OutTradeNo: 'T3', MchOrderNo: 'W3', ProductId: 'hacker_free' }));
    assert.strictEqual(errCode(r), '0', '仍应答 0（避免平台无意义重试），但不发货');
    assert.strictEqual(users.u3.unlockedAll, false, '不得解锁整本');
    assert.strictEqual(users.u3.points, 10, '积分不应变');
  });

  await t('新用户买 200 积分包 → 自动建档并到账', async () => {
    reset();
    orders.push({ outTradeNo: 'T4', openid: 'u4', productId: 'points_200', status: 'pending' });
    const r = await push(notifyXml({ OpenId: 'u4', OutTradeNo: 'T4', MchOrderNo: 'W4', ProductId: 'points_200' }));
    assert.strictEqual(errCode(r), '0');
    assert.strictEqual(users.u4.points, 200, '应为 200，实际 ' + users.u4.points);
    assert.strictEqual(users.u4.unlockedAll, false);
  });

  await t('非发货事件 → 忽略；缺 OutTradeNo → 返回错误码 1', async () => {
    reset();
    const r1 = await push('<xml><Event><![CDATA[something_else]]></Event></xml>');
    assert.strictEqual(errCode(r1), '0', '非发货事件应直接 ack');
    const r2 = await push(notifyXml({ OpenId: 'u9', MchOrderNo: 'W9', ProductId: 'points_200' }));
    assert.strictEqual(errCode(r2), '1', '缺 OutTradeNo 应返回 1 让平台重试');
  });

  // ── 推送来源校验（防伪造通知白拿货）──
  await t('配置 VP_PUSH_TOKEN 后：无签名/错误签名的伪造推送被拒且不发货', async () => {
    reset();
    process.env.VP_PUSH_TOKEN = 'my-push-token';
    try {
      users.u5 = { openid: 'u5', points: 0, unlockedAll: false, coupons: [] };
      orders.push({ outTradeNo: 'T5', openid: 'u5', productId: 'comic_full', status: 'pending' });
      const xml = notifyXml({ OpenId: 'u5', OutTradeNo: 'T5', MchOrderNo: 'W5', ProductId: 'comic_full' });

      const noSig = await push(xml);
      assert.strictEqual(errCode(noSig), '1', '无签名应拒绝');
      assert.strictEqual(users.u5.unlockedAll, false, '伪造推送不得解锁');

      const wrongSig = await deliver.main({ body: xml, queryStringParameters: { signature: 'deadbeef', timestamp: '1', nonce: '2' } });
      assert.strictEqual(errCode(wrongSig), '1', '错误签名应拒绝');
      assert.strictEqual(users.u5.unlockedAll, false);

      const ts = '1700000000', nonce = 'abc123';
      const good = await deliver.main({
        body: xml,
        queryStringParameters: { signature: sha1Sign('my-push-token', ts, nonce), timestamp: ts, nonce }
      });
      assert.strictEqual(errCode(good), '0', '正确签名应放行');
      assert.strictEqual(users.u5.unlockedAll, true, '正确签名应正常发货');
    } finally { delete process.env.VP_PUSH_TOKEN; }
  });

  // ── 云函数模式（本项目 MP 后台实际配置的模式：pushMode=cloudfunction）──
  // 该模式下微信把事件以【已解析对象】投给云函数：没有 body、没有签名 query。
  // 所以真伪只能靠"发货前向微信查单确认已支付"这一闸兜住 —— 下面专测这一闸。
  const cfPush = (f) => deliver.main(Object.assign({ MsgType: 'event', Event: 'xpay_goods_deliver_notify' }, f));

  await t('云函数模式：解析对象事件（无 body/无签名）→ 正常发货', async () => {
    reset();
    users.u6 = { openid: 'u6', points: 0, unlockedAll: false, coupons: [] };
    orders.push({ outTradeNo: 'C1', openid: 'u6', productId: 'points_800', status: 'pending' });
    const r = await cfPush({ OpenId: 'u6', OutTradeNo: 'C1', ProductId: 'points_800', WeChatPayInfo: { MchOrderNo: 'WC1' } });
    assert.strictEqual(errCode(r), '0', '云函数模式应正常受理');
    assert.strictEqual(users.u6.points, 800, '应到账 800，实际 ' + users.u6.points);
    assert.strictEqual(orders.find(o => o.outTradeNo === 'C1').status, 'delivered');
    assert.strictEqual(orders.find(o => o.outTradeNo === 'C1').wxOrderId, 'WC1', 'MchOrderNo 应能取出并落库');
  });

  await t('云函数模式：拿自己【未支付】的订单号直接调用 → 查单验真拦住，不发货', async () => {
    // 这是云函数模式最现实的攻击：outTradeNo 下单时就返回给前端了，攻击者知道自己的订单号，
    // 而云函数模式的推送没有签名 —— 没有这闸就能白拿货。
    reset();
    users.u7 = { openid: 'u7', points: 0, unlockedAll: false, coupons: [] };
    orders.push({ outTradeNo: 'C2', openid: 'u7', productId: 'points_2500', status: 'pending' });
    queryPaid = false;
    try {
      const r = await cfPush({ OpenId: 'u7', OutTradeNo: 'C2', ProductId: 'points_2500' });
      assert.strictEqual(errCode(r), '1', '未支付必须拒绝');
      assert.strictEqual(users.u7.points, 0, '未支付绝不到账');
      assert.strictEqual(orders.find(o => o.outTradeNo === 'C2').status, 'pending', '订单不得被标成已发货');
    } finally { queryPaid = true; }
  });

  await t('云函数模式：推送里的 OpenId / ProductId 与订单不符 → 一律以订单落库为准', async () => {
    reset();
    users.u8 = { openid: 'u8', points: 0, unlockedAll: false, coupons: [] };
    users.evil = { openid: 'evil', points: 0, unlockedAll: false, coupons: [] };
    // 攻击者把别人的订单发到自己头上，并把道具升档成 2500
    orders.push({ outTradeNo: 'C3', openid: 'u8', productId: 'points_200', status: 'pending' });
    const r = await cfPush({ OpenId: 'evil', OutTradeNo: 'C3', ProductId: 'points_2500' });
    assert.strictEqual(errCode(r), '0');
    assert.strictEqual(users.evil.points, 0, '绝不能发给推送里声称的 openid');
    assert.strictEqual(users.u8.points, 200, '应按订单发 200，实际 ' + users.u8.points);
  });

  await t('云函数模式：订单不存在 → 返回 1（交平台重试），不凭空发货', async () => {
    reset();
    users.u9 = { openid: 'u9', points: 0, unlockedAll: false, coupons: [] };
    const r = await cfPush({ OpenId: 'u9', OutTradeNo: 'NOT_EXIST', ProductId: 'points_2500' });
    assert.strictEqual(errCode(r), '1');
    assert.strictEqual(users.u9.points, 0);
  });

  await t('云函数模式：并发 5 次相同推送 → 乐观锁保证只发一次', async () => {
    reset();
    users.u10 = { openid: 'u10', points: 0, unlockedAll: false, coupons: [] };
    orders.push({ outTradeNo: 'C4', openid: 'u10', productId: 'points_2500', status: 'pending' });
    const before = queryOrderHits;
    await Promise.all([0, 1, 2, 3, 4].map(() => cfPush({ OpenId: 'u10', OutTradeNo: 'C4', ProductId: 'points_2500' })));
    assert.strictEqual(users.u10.points, 2500, '并发只应发一次 2500，实际 ' + users.u10.points);
    assert.ok(queryOrderHits >= before + 1, '至少真的要查过一次单');
  });

  await t('云函数模式：非发货事件 → 忽略；缺 OutTradeNo → 返回 1', async () => {
    reset();
    const r1 = await deliver.main({ MsgType: 'event', Event: 'xpay_refund_notify' });
    assert.strictEqual(errCode(r1), '0', '非发货事件应直接 ack');
    const r2 = await cfPush({ OpenId: 'u9', ProductId: 'points_200' });
    assert.strictEqual(errCode(r2), '1', '缺 OutTradeNo 应返回 1');
  });

  // ── vp_create_order ──
  await t('下单 2500 积分包：goodsPrice 用服务端价 5000，前端传 priceFen=1 被忽略', async () => {
    reset();
    const r = await createOrder.main({ code: 'CODE', productId: 'points_2500', priceFen: 1 });
    const sd = JSON.parse(r.signData);
    assert.strictEqual(sd.goodsPrice, 5000, '服务端价应为 5000，实际 ' + sd.goodsPrice);
    assert.strictEqual(sd.productId, 'points_2500');
    assert.strictEqual(sd.buyQuantity, 1);
    assert.strictEqual(r.priceFen, 5000);
    assert.strictEqual(orders.length, 1, '应落库一条 vp_orders');
    assert.strictEqual(orders[0].productId, 'points_2500');
  });

  await t('下单三档价格逐一正确（600 / 1800 / 5000）', async () => {
    reset();
    const expect = { points_200: 600, points_800: 1800, points_2500: 5000 };
    for (const pid of Object.keys(expect)) {
      const r = await createOrder.main({ code: 'CODE', productId: pid });
      assert.strictEqual(JSON.parse(r.signData).goodsPrice, expect[pid], pid + ' 价格错误');
    }
  });

  await t('双签名符合官方规范（paySig / signature）', async () => {
    reset();
    const r = await createOrder.main({ code: 'CODE', productId: 'points_800' });
    const expectPaySig = crypto.createHmac('sha256', process.env.VP_APP_KEY).update('requestVirtualPayment&' + r.signData, 'utf8').digest('hex');
    const expectSig = crypto.createHmac('sha256', 'SESSION_KEY').update(r.signData, 'utf8').digest('hex');
    assert.strictEqual(r.paySig, expectPaySig, 'paySig 不符');
    assert.strictEqual(r.signature, expectSig, 'signature 不符');
    assert.ok(lastGetUrl.indexOf('js_code=CODE') > 0, '应带 code 换 sessionKey');
  });

  await t('未知道具 → 拒绝下单（不返回 signData）', async () => {
    reset();
    const r = await createOrder.main({ code: 'CODE', productId: 'points_999999' });
    assert.ok(r.error && r.error.indexOf('未知道具') === 0, '应返回未知道具错误，实际: ' + JSON.stringify(r));
    assert.strictEqual(r.signData, undefined);
    assert.strictEqual(orders.length, 0, '不应落库');
  });

  await t('缺服务端密钥 → 明确报错（不泄露密钥）', async () => {
    const keep = process.env.VP_APP_KEY;
    delete process.env.VP_APP_KEY;
    try {
      const r = await createOrder.main({ code: 'CODE', productId: 'points_200' });
      assert.ok(r.error && r.error.indexOf('未配置虚拟支付参数') > -1, '应提示未配置，实际: ' + JSON.stringify(r));
    } finally { process.env.VP_APP_KEY = keep; }
  });

  // ── vp_query（兜底查单）──
  await t('查单补发货：订单是积分包 → 只加积分、不误解锁整本', async () => {
    reset();
    users.u1 = { openid: 'u1', points: 0, unlockedAll: false, coupons: [] };
    orders.push({ outTradeNo: 'Q1', openid: 'u1', productId: 'points_200', status: 'pending' });
    const r = await queryOrder.main({ openid: 'u1', outTradeNo: 'Q1' });
    assert.strictEqual(r.paid, true);
    assert.strictEqual(r.kind, 'points');
    assert.strictEqual(users.u1.points, 200);
    assert.strictEqual(users.u1.unlockedAll, false, '买积分包不得解锁整本');
  });

  await t('查单幂等：同一订单重复查 → 不重复发货（防"支付一次无限刷积分"）', async () => {
    reset();
    users.u1 = { openid: 'u1', points: 0, unlockedAll: false, coupons: [] };
    orders.push({ outTradeNo: 'Q2', openid: 'u1', productId: 'points_800', status: 'pending' });
    const a = await queryOrder.main({ openid: 'u1', outTradeNo: 'Q2' });
    assert.strictEqual(a.kind, 'points');
    assert.strictEqual(users.u1.points, 800);
    for (let i = 0; i < 3; i++) {
      const r = await queryOrder.main({ openid: 'u1', outTradeNo: 'Q2' });
      assert.strictEqual(r.already, true, '第 ' + (i + 1) + ' 次重复查单应识别为已发货');
      assert.strictEqual(r.kind, 'skipped');
    }
    assert.strictEqual(users.u1.points, 800, '重复查单不得重复发货');
  });

  await t('查单并发（5 个请求同时打）→ 乐观锁保证只发一次', async () => {
    reset();
    users.u1 = { openid: 'u1', points: 0, unlockedAll: false, coupons: [] };
    orders.push({ outTradeNo: 'Q3', openid: 'u1', productId: 'points_2500', status: 'pending' });
    await Promise.all([0, 1, 2, 3, 4].map(() => queryOrder.main({ openid: 'u1', outTradeNo: 'Q3' })));
    assert.strictEqual(users.u1.points, 2500, '5 个并发只应发一次 2500，实际 ' + users.u1.points);
    assert.strictEqual(queryOrderHits, 5, '每次都要真的向微信查单（幂等靠发货前 CAS，不靠跳过查单）');
  });

  await t('查单：订单记录缺失 → 不发货，标记需人工核对', async () => {
    reset();
    users.u1 = { openid: 'u1', points: 0, unlockedAll: false, coupons: [] };
    const r = await queryOrder.main({ openid: 'u1', outTradeNo: 'NOT_LOGGED' });
    assert.strictEqual(r.paid, true);
    assert.strictEqual(r.kind, 'unknown');
    assert.strictEqual(r.needManual, true);
    assert.strictEqual(users.u1.points, 0, '无法确定道具时绝不发货');
  });

  await t('查单：未支付 → 不发货', async () => {
    reset();
    users.u1 = { openid: 'u1', points: 0, unlockedAll: false, coupons: [] };
    orders.push({ outTradeNo: 'Q4', openid: 'u1', productId: 'points_200', status: 'pending' });
    queryPaid = false;
    try {
      const r = await queryOrder.main({ openid: 'u1', outTradeNo: 'Q4' });
      assert.strictEqual(r.paid, false);
      assert.strictEqual(users.u1.points, 0);
      const ord = orders.find(o => o.outTradeNo === 'Q4');
      assert.strictEqual(ord.status, 'pending', '未支付不得把订单标成已发货');
    } finally { queryPaid = true; }
  });

  console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
  process.exitCode = fail ? 1 : 0;
})();
