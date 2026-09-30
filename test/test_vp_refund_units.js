// 虚拟支付·退款云函数单测（零依赖）—— vp_refund + vp_deliver 的 xpay_refund_notify 分支
// 覆盖：
//   · adminKey 缺失/错误 → 拒绝
//   · 订单不存在 / 状态非 delivered / 已在退款中 / 已退款 → 拒绝（状态机幂等）
//   · refundFen 非法（负数/超实付）→ 拒绝
//   · 微信查单未确认已支付 → 拒绝
//   · 拿不到 TransactionId → 拒绝盲退
//   · 全额退款（缺省）→ /xpay/refund_order 收到正确 body，订单 CAS 跃迁 refunding
//   · 部分退款（9 折券退差价）→ refund_fee = 显式传入值
//   · 微信侧报错 → 订单状态不被改动（可安全重试）
//   · vp_deliver 收到 xpay_refund_notify → refunding → refunded 回写
// 运行：node test/test_vp_refund_units.js
const assert = require('assert');
const path = require('path');
const Module = require('module');

// ───────────── 1. 内存版云数据库（支持多键 where + update CAS）─────────────
let users = {};
let orders = [];

function matchCond(doc, cond) {
  return Object.keys(cond).every(k => doc[k] === cond[k]);
}
// 与 test_vp_units.applyData 同款：{$inc:n} 解引用，其余直接赋值
function applyData(doc, data) {
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (v && typeof v === 'object' && typeof v.$inc === 'number') doc[k] = (doc[k] || 0) + v.$inc;
    else doc[k] = v;
  });
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
        },
        add: async ({ data }) => { orders.push(Object.assign({}, data)); return { _id: 'o' + orders.length }; }
      })
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
  database: () => ({
    collection,
    command: { inc: (n) => ({ $inc: n }) },
    serverDate: () => 'SERVER_DATE'
  })
};

// ───────────── 2. https Stub：可编程路由 ─────────────
let queryPaid = true;
let refundResp = { errcode: 0, errmsg: 'ok' };
let lastRefundBody = null;   // 记录 refund_order 收到的 body，断言用
let queryNoTxn = false;      // 模拟查单响应拿不到 TransactionId

function vpRoute(urlStr, bodyObj) {
  const u = new URL(urlStr);
  if (u.pathname.indexOf('/cgi-bin/token') === 0) {
    return JSON.stringify({ access_token: 'AT_TEST', expires_in: 7200 });
  }
  if (u.pathname.indexOf('/xpay/query_order') === 0) {
    return JSON.stringify({
      errcode: 0,
      paid: queryPaid,
      order_state: queryPaid ? 'PAID' : 'UNPAID',
      transaction_id: queryNoTxn ? undefined : 'WX_TXN_10001'
    });
  }
  if (u.pathname.indexOf('/xpay/refund_order') === 0) {
    lastRefundBody = bodyObj;
    return JSON.stringify(refundResp);
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
    const req = {
      on() { return req; }, destroy() {}, setTimeout() {},
      write(b) { req._body = b; },
      end() {
        process.nextTick(() => {
          const url = 'https://' + opts.hostname + (opts.path || '');
          let parsed = null;
          try { parsed = JSON.parse(req._body || '{}'); } catch (e) { /* ignore */ }
          cb(makeRes(vpRoute(url, parsed)));
        });
      }
    };
    return req;
  },
  get: (url, cb) => {
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
process.env.VP_APP_KEY = 'appkey-test';
process.env.VP_ADMIN_KEY = 'ADMIN-KEY-TEST';

const refund = require(path.join(__dirname, '..', 'cloudfunctions', 'vp_refund', 'index.js'));
const deliver = require(path.join(__dirname, '..', 'cloudfunctions', 'vp_deliver', 'index.js'));

// ───────────── 3. 工具 ─────────────
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
}
function reset() {
  users = {}; orders = [];
  queryPaid = true; refundResp = { errcode: 0, errmsg: 'ok' }; lastRefundBody = null; queryNoTxn = false;
}
// 造一笔已发货订单（含微信交易单号，与 vp_deliver 落库行为一致）
function seedDelivered(no, priceFen) {
  orders.push({ outTradeNo: no, openid: 'u1', productId: 'comic_pdf', priceFen, status: 'delivered', wxTransactionId: 'WX_TXN_' + no });
}
const errCode = (r) => (/<ErrCode>(\d+)<\/ErrCode>/.exec(r && r.body) || [])[1];

(async () => {
  await t('adminKey 缺失/错误 → 拒绝', async () => {
    reset(); seedDelivered('T1', 6600);
    assert.ok((await refund.main({ outTradeNo: 'T1' })).error, '缺 adminKey 应拒绝');
    assert.ok((await refund.main({ adminKey: 'WRONG', outTradeNo: 'T1' })).error, '错 adminKey 应拒绝');
    assert.strictEqual(orders[0].status, 'delivered', '订单状态不应被改动');
  });

  await t('订单不存在 → 拒绝', async () => {
    reset();
    const r = await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'NOPE' });
    assert.ok(r.error, '应拒绝');
  });

  await t('状态机：pending / refunding / refunded 一律拒绝，只认 delivered', async () => {
    reset();
    orders.push({ outTradeNo: 'TP', openid: 'u1', productId: 'comic_pdf', priceFen: 6600, status: 'pending', wxTransactionId: 'X1' });
    assert.ok((await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'TP' })).error, 'pending 应拒绝');
    orders.push({ outTradeNo: 'TR', openid: 'u1', productId: 'comic_pdf', priceFen: 6600, status: 'refunding', wxTransactionId: 'X2' });
    assert.ok((await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'TR' })).error, 'refunding 应拒绝');
    orders.push({ outTradeNo: 'TD', openid: 'u1', productId: 'comic_pdf', priceFen: 6600, status: 'refunded', wxTransactionId: 'X3' });
    assert.ok((await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'TD' })).error, 'refunded 应拒绝');
  });

  await t('金额闸：负数 / 超实付 → 拒绝', async () => {
    reset(); seedDelivered('T2', 6600);
    assert.ok((await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'T2', refundFen: -1 })).error, '负数应拒绝');
    assert.ok((await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'T2', refundFen: 99999 })).error, '超实付应拒绝');
    assert.strictEqual(orders[0].status, 'delivered', '订单状态不应被改动');
  });

  await t('查单未确认已支付 → 拒绝退款', async () => {
    reset(); seedDelivered('T3', 6600); queryPaid = false;
    const r = await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'T3' });
    assert.ok(r.error, '应拒绝');
    assert.strictEqual(orders[0].status, 'delivered', '订单状态不应被改动');
  });

  await t('拿不到 TransactionId → 拒绝盲退（wx_order_id 传 outTradeNo 会报数据不存在）', async () => {
    reset(); seedDelivered('T4', 6600);
    delete orders[0].wxTransactionId;
    queryNoTxn = true;
    const r = await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'T4' });
    assert.ok(r.error, '应拒绝');
    assert.ok(!lastRefundBody, '不应发起 refund_order 外呼');
  });

  await t('全额退款（缺省 refundFen）→ body 正确 + 订单 CAS 跃迁 refunding', async () => {
    reset(); seedDelivered('T5', 990);
    const r = await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'T5', memo: '客诉全额退' });
    assert.ok(r.ok, '应成功: ' + JSON.stringify(r));
    assert.strictEqual(lastRefundBody.wx_order_id, 'WX_TXN_T5', 'wx_order_id 必须是微信交易单号');
    assert.strictEqual(lastRefundBody.refund_fee, 990, '缺省应全额退');
    assert.strictEqual(lastRefundBody.refund_order_id, 'RFT5', '退款单号 = RF + outTradeNo');
    assert.strictEqual(lastRefundBody.refund_reason, 0);
    assert.strictEqual(lastRefundBody.openid, 'u1');
    assert.strictEqual(lastRefundBody.env, 0);
    assert.strictEqual(orders[0].status, 'refunding', '应跃迁为 refunding');
    assert.strictEqual(orders[0].refundFen, 990);
    assert.strictEqual(orders[0].refundMemo, '客诉全额退');
  });

  await t('部分退款（9 折券退差价：66 元全款退 6.6 元）→ refund_fee = 660 分', async () => {
    reset(); seedDelivered('T6', 6600);
    const r = await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'T6', refundFen: 660, memo: '9折券退差价' });
    assert.ok(r.ok, '应成功: ' + JSON.stringify(r));
    assert.strictEqual(lastRefundBody.refund_fee, 660, '退差价金额应正确');
    assert.strictEqual(orders[0].status, 'refunding');
    assert.strictEqual(orders[0].refundFen, 660);
  });

  await t('微信侧报错 → 返回失败且订单状态不被改动（可安全重试）', async () => {
    reset(); seedDelivered('T7', 6600);
    refundResp = { errcode: 268490002, errmsg: '数据不存在' };
    const r = await refund.main({ adminKey: 'ADMIN-KEY-TEST', outTradeNo: 'T7' });
    assert.strictEqual(r.ok, false, '应返回失败');
    assert.strictEqual(orders[0].status, 'delivered', '状态不应被改动');
  });

  await t('vp_deliver 收到 xpay_refund_notify → refunding 跃迁 refunded（幂等）', async () => {
    reset();
    orders.push({ outTradeNo: 'T8', openid: 'u1', productId: 'comic_pdf', priceFen: 6600, status: 'refunding' });
    const notify = '<xml><Event><![CDATA[xpay_refund_notify]]></Event><OutTradeNo><![CDATA[T8]]></OutTradeNo></xml>';
    const r1 = await deliver.main({ body: notify });
    assert.strictEqual(errCode(r1), '0', '推送应被受理');
    assert.strictEqual(orders[0].status, 'refunded', '应回写 refunded');
    const r2 = await deliver.main({ body: notify });
    assert.strictEqual(errCode(r2), '0', '重复推送也应 ack');
    assert.strictEqual(orders[0].status, 'refunded', '重复推送不应改变状态');
  });

  await t('发货推送仍正常（回归：新增 refund 分支不影响原事件）', async () => {
    reset();
    users.u1 = { openid: 'u1', points: 0, unlockedAll: false };
    orders.push({ outTradeNo: 'T9', openid: 'u1', productId: 'points_200', priceFen: 600, status: 'pending', wxTransactionId: 'WX_TXN_T9' });
    const notify = '<xml><Event><![CDATA[xpay_goods_deliver_notify]]></Event><OutTradeNo><![CDATA[T9]]></OutTradeNo><OpenId><![CDATA[u1]]></OpenId><ProductId><![CDATA[points_200]]></ProductId><TransactionId><![CDATA[WX_TXN_9999]]></TransactionId></xml>';
    const r = await deliver.main({ body: notify });
    assert.strictEqual(errCode(r), '0');
    assert.strictEqual(orders[0].status, 'delivered', '应正常发货');
    assert.strictEqual(users.u1.points, 200, '应 +200 积分');
    assert.strictEqual(orders[0].wxTransactionId, 'WX_TXN_9999', '推送里的 TransactionId 应落库（推送优先于无值场景）');
  });

  console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
  // ⚠️ 用 exitCode 而非 process.exit()：run_all 是进程内执行，exit() 会把整个 runner 杀掉
  process.exitCode = fail ? 1 : 0;
})();
