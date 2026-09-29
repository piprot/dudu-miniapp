// 端到端串联测试：一条真实用户旅程，跨 6 个云函数跑通完整闭环（零依赖）
//
// 与其余单测的区别：其余测试各测一个函数；本测试让所有云函数**共享同一份内存云数据库**，
// 因此能验出"单看函数都对、串起来却对不上"的集成缺陷（字段名不一致 / 余额传递错 / 幂等失效）。
//
// 用户旅程（一位新用户从 0 到解锁整本）：
//   ① 新用户查档            → 0 积分、未解锁
//   ② 新人礼 + 每日签到     → 首次进入一次性 +80；每日签到 +30，连签 1
//                              （2026-09-18 调参：base 5→20，连签 +1/天 封顶 +10；2026-09-19 加新人礼 100；
//                               2026-09-23 用户拍板降到 新人礼 80 / 每日 base 30）
//   ③ 再签一次（并发/重复） → 幂等，+0
//   ④ 余额不足生成朋友圈    → need:20 且**不扣分**（先守卫后调用模型）
//   ⑤ 下单 ¥18 积分包       → 双签名返回，订单落库 pending
//   ⑥ 发货推送              → 积分 +800
//   ⑦ 伪造推送 + 重复推送   → 拒收 / 幂等，积分不变
//   ⑧ 生成朋友圈（首次）    → −20，出 3 条
//   ⑨ 换一批（带意见）      → −15，出 3 条且与上一版不同
//   ⑩ 图片多模态生成        → −20（moments；多模态是通用能力，与"画面感内容"无关）
//   ⑪ 文章链接生成          → −20，抓正文注入
//   ⑫ 生成画面感内容脚本(mode=comic) → **明确报错**：该路径已移除，画面感内容只能走付费定制（2026-09-19 用户拍板）
//   ⑬ 下单 ¥9.9 整本 → 发货 → 解锁，且**积分不被清零**（回归 set() 覆盖 bug）
//   ⑭ 兜底查单（vp_query）   → 已支付订单按 productId 补发货，买积分包不会误解锁整本
//
// 运行：node test/test_e2e_flow.js     期望：全部 PASS，退出码 0
const assert = require('assert');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');

// ═══════════════════ 1. 共享内存云数据库（所有云函数共用一份）═══════════════════
const UNIVERSE = { users: {}, orders: [], stores: {} };   // stores: 其它集合（app_users/custom_comic_requests）按名独立存
let orderSeq = 0;

function applyData(doc, data) {
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (v && typeof v === 'object' && typeof v.$inc === 'number') {
      doc[k] = (typeof doc[k] === 'number' ? doc[k] : 0) + v.$inc;
    } else {
      doc[k] = v;
    }
  });
}
function matchCond(doc, cond) {
  return Object.keys(cond).every(k => {
    const want = cond[k];
    const have = doc[k];
    if (want && typeof want === 'object' && !Array.isArray(want)) {
      if ('$gte' in want) return typeof have === 'number' && have >= want.$gte;
      if ('$gt' in want) return typeof have === 'number' && have > want.$gt;
      if ('$lt' in want) return typeof have === 'number' && have < want.$lt;
      if ('$ne' in want) return have !== want.$ne;
      if ('$in' in want) return want.$in.indexOf(have) >= 0;
      return false;
    }
    return have === want;
  });
}

function makeCollection(name) {
  const isUsers = name === 'vp_users';
  const isOrders = name === 'vp_orders';
  // 非 vp_users / vp_orders 的集合（app_users、custom_comic_requests 等）各自独立映射表，
  // 否则会被误并进 UNIVERSE.orders（历史上所有非 vp_users 集合都落 orders 数组，属桩的建模缺陷）。
  if (!isUsers && !isOrders) {
    if (!UNIVERSE.stores[name]) UNIVERSE.stores[name] = {};
    const store = UNIVERSE.stores[name];
    const srows = () => Object.keys(store).map(k => store[k]);
    const sdoc = (id) => ({
      get: async () => {
        const d = store[id];
        if (!d) throw new Error('document does not exist');
        return { data: Object.assign({}, d) };
      },
      set: async ({ data }) => { store[id] = Object.assign({ _id: id }, data); return { stats: { updated: 1, created: 1 } }; },
      update: async ({ data }) => {
        const d = store[id];
        if (!d) throw new Error('document does not exist');
        applyData(d, data);
        return { stats: { updated: 1 } };
      }
    });
    const swhere = (cond) => ({
      get: async () => ({ data: srows().filter(d => matchCond(d, cond)).map(d => Object.assign({}, d)) }),
      count: async () => ({ total: srows().filter(d => matchCond(d, cond)).length }),
      update: async ({ data }) => {
        const hits = srows().filter(d => matchCond(d, cond));
        hits.forEach(d => applyData(d, data));
        return { stats: { updated: hits.length } };
      },
      remove: async () => ({ stats: { removed: 0 } })
    });
    return {
      doc: sdoc,
      where: swhere,
      add: async ({ data }) => {
        const _id = name + '_' + (++orderSeq);
        store[_id] = Object.assign({ _id }, data);
        return { _id };
      }
    };
  }
  const rows = () => (isUsers ? Object.keys(UNIVERSE.users).map(k => UNIVERSE.users[k]) : UNIVERSE.orders);
  const docRef = (id) => ({
    get: async () => {
      const d = isUsers ? UNIVERSE.users[id] : UNIVERSE.orders.find(o => o._id === id);
      if (!d) throw new Error('document does not exist');
      return { data: Object.assign({}, d) };
    },
    set: async ({ data }) => {
      if (isUsers) UNIVERSE.users[id] = Object.assign({ _id: id }, data);
      else { const i = UNIVERSE.orders.findIndex(o => o._id === id); if (i >= 0) UNIVERSE.orders[i] = Object.assign({ _id: id }, data); else UNIVERSE.orders.push(Object.assign({ _id: id }, data)); }
      return { stats: { updated: 1, created: 1 } };
    },
    update: async ({ data }) => {
      const d = isUsers ? UNIVERSE.users[id] : UNIVERSE.orders.find(o => o._id === id);
      if (!d) throw new Error('document does not exist');
      applyData(d, data);
      return { stats: { updated: 1 } };
    }
  });
  const where = (cond) => ({
    get: async () => ({ data: rows().filter(d => matchCond(d, cond)).map(d => Object.assign({}, d)) }),
    count: async () => ({ total: rows().filter(d => matchCond(d, cond)).length }),
    update: async ({ data }) => {
      const hits = rows().filter(d => matchCond(d, cond));
      hits.forEach(d => applyData(d, data));
      return { stats: { updated: hits.length } };   // 乐观锁 CAS 依赖这个计数
    },
    remove: async () => ({ stats: { removed: 0 } })
  });
  return {
    doc: docRef,
    where,
    add: async ({ data }) => {
      const _id = 'ord_' + (++orderSeq);
      UNIVERSE.orders.push(Object.assign({ _id }, data));
      return { _id };
    }
  };
}

// ═══════════════════ 2. 可编程 HTTP Stub（按 host+path 路由）═══════════════════
const ARK_BASE = 'https://ark.example.com/api/v3';
const ARTICLE_URL = 'https://mp.example.com/s/abc';
let httpLog = [];

function route(urlStr, method, bodyStr) {
  const u = new URL(urlStr);
  const host = u.hostname, p = u.pathname;
  httpLog.push(method + ' ' + host + p);

  // 微信：code2session
  if (host === 'api.weixin.qq.com' && p.indexOf('/sns/jscode2session') === 0) {
    // 必须跟随 CURRENT_OPENID：否则订单落库的 openid 与调用者不一致，
    // 会掩盖"订单归属错人"这类真实缺陷（也保证多用户场景可测）。
    return { statusCode: 200, body: JSON.stringify({ openid: CURRENT_OPENID, session_key: 'SK_' + CURRENT_OPENID }) };
  }
  // 微信：access_token
  if (host === 'api.weixin.qq.com' && p.indexOf('/cgi-bin/token') === 0) {
    return { statusCode: 200, body: JSON.stringify({ access_token: 'AT_TEST', expires_in: 7200 }) };
  }
  // 微信：B 端查单
  if (host === 'api.weixin.qq.com' && p.indexOf('/xpay/query_order') === 0) {
    return { statusCode: 200, body: JSON.stringify({ errcode: 0, paid: true, order_state: 'PAID' }) };
  }
  // 文章抓取
  if (host === 'mp.example.com') {
    return {
      statusCode: 200,
      body: '<html><head><title>如何写好朋友圈</title></head><body>'
        + '<div class="rich_media"><div id="js_content"><p>第一段：先说结论。</p><p>第二段：再说理由。</p></div></div>'
        + '<div id="js_pc_qr_code">扫码关注广告</div></body></html>'
    };
  }
  // 大模型：Responses / chat
  if (host === 'ark.example.com') {
    const isRevise = bodyStr.indexOf('【我的修改意见】') >= 0;
    const txt = isRevise ? '【1】改后更克制\n【2】改后更具体\n【3】改后更短' : '【1】初版A\n【2】初版B\n【3】初版C';
    if (/\/responses$/.test(p)) return { statusCode: 200, body: JSON.stringify({ output_text: txt }) };
    return { statusCode: 200, body: JSON.stringify({ choices: [{ message: { content: txt } }] }) };
  }
  return { statusCode: 404, body: '{}' };
}

function makeRes(r) {
  const { EventEmitter } = require('events');
  const res = new EventEmitter();
  res.statusCode = r.statusCode;
  res.headers = {};
  res.setEncoding = () => {};
  res.resume = () => {};
  res.destroy = () => {};
  process.nextTick(() => { res.emit('data', r.body); res.emit('end'); res.emit('close'); });
  return res;
}
function fakeGet(url, cb) { const r = route(url, 'GET', ''); process.nextTick(() => cb(makeRes(r))); return { on() { return this; } }; }
function fakeRequest(opts, cb) {
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  let written = '';
  req.write = (c) => { written += c; };
  req.destroy = () => {};
  req.setTimeout = () => {};
  req.on = EventEmitter.prototype.on.bind(req);
  req.end = () => {
    const url = (opts.protocol === 'http:' ? 'http://' : 'https://') + opts.hostname + (opts.path || '');
    const r = route(url, opts.method || 'GET', written);
    process.nextTick(() => cb(makeRes(r)));
  };
  return req;
}
const fakeHttpMod = { get: fakeGet, request: fakeRequest };

// ═══════════════════ 3. wx-server-sdk Stub ═══════════════════
let CURRENT_OPENID = 'U_ALICE';
const cloudStub = {
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  init() {},
  getWXContext: () => ({ OPENID: CURRENT_OPENID }),
  database: () => ({
    collection: makeCollection,
    command: { inc: (n) => ({ $inc: n }), gte: (n) => ({ $gte: n }) },
    serverDate: () => 'SERVER_DATE'
  }),
  downloadFile: async () => ({
    fileContent: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)])
  })
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return cloudStub;
  if (request === 'https' || request === 'http') return fakeHttpMod;
  return origLoad.apply(this, arguments);
};

// ═══════════════════ 4. 环境变量（等价于云函数环境变量）═══════════════════
process.env.VP_APP_ID = 'wxacf98605ac5b0218';
process.env.VP_APP_SECRET = 'secret-test';
process.env.VP_OFFER_ID = '1450652139';
process.env.VP_APP_KEY = 'appkey-test';
process.env.VP_PUSH_TOKEN = 'pushtoken-test';
process.env.LLM_API_KEY = 'llm-key-test';
process.env.LLM_MODEL = 'ep-e2e-test';
process.env.LLM_BASE_URL = ARK_BASE;

const CF = (n) => require(path.join(__dirname, '..', 'cloudfunctions', n, 'index.js'));
const aiGen = CF('ai_gen');
const pointsFn = CF('points');
const createOrder = CF('vp_create_order');
const deliver = CF('vp_deliver');
const queryOrder = CF('vp_query');
const getProfile = CF('vp_get_profile');

// ═══════════════════ 5. 工具 ═══════════════════
let pass = 0, fail = 0;
const steps = [];
async function t(name, fn) {
  try { await fn(); console.log('  PASS  ' + name); pass++; steps.push('PASS ' + name); }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + (e && e.message)); fail++; steps.push('FAIL ' + name); }
}
const pts = () => (UNIVERSE.users.U_ALICE && UNIVERSE.users.U_ALICE.points) || 0;
function notifyXml(f) {
  const kv = Object.keys(f).map(k => '<' + k + '><![CDATA[' + f[k] + ']]></' + k + '>').join('');
  return '<xml><Event><![CDATA[xpay_goods_deliver_notify]]></Event>' + kv + '</xml>';
}
function signedPush(body, token) {
  const ts = '1700000000', nonce = 'n' + Math.random().toString(36).slice(2, 8);
  const signature = crypto.createHash('sha1').update([token, ts, nonce].sort().join('')).digest('hex');
  return { body, queryStringParameters: { signature, timestamp: ts, nonce } };
}
const okPush = (body) => deliver.main(signedPush(body, 'pushtoken-test'));
const errCode = (r) => (/<ErrCode>(\d+)<\/ErrCode>/.exec((r && r.body) || '') || [])[1];

(async () => {
  console.log('=== 端到端串联：一位新用户的完整旅程 ===\n');

  // ── ① 新用户查档 ──
  console.log('[① 新用户]');
  await t('全新用户查档 → 未解锁、无记录不报错', async () => {
    const r = await getProfile.main({});
    assert.strictEqual(r.openid, 'U_ALICE');
    assert.strictEqual(r.unlockedAll, false);
  });

  // ── ②③ 新人礼 + 每日签到 ──
  console.log('[② 新人礼 + 每日签到]');
  await t('首次进入 → 新人礼 +80 与签到 +30 同时到账（余额 110）、连签 1', async () => {
    const r = await pointsFn.main({ action: 'daily' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.signupBonus, 80, '首次进入应发新人礼 80，实际 ' + r.signupBonus);
    assert.strictEqual(r.awarded, 30);
    assert.strictEqual(r.streak, 1);
    assert.strictEqual(pts(), 110, '数据库里应真有 110 分（80 新人礼 + 30 签到），实际 ' + pts());
  });
  await t('重复进入 → 新人礼与签到都幂等（signupBonus:0 / awarded:0，余额仍 110）', async () => {
    const r = await pointsFn.main({ action: 'daily' });
    assert.strictEqual(r.signupBonus, 0, '新人礼绝不能重发，实际 ' + r.signupBonus);
    assert.strictEqual(r.awarded, 0);
    assert.strictEqual(r.already, true);
    assert.strictEqual(pts(), 110, '余额不应变，实际 ' + pts());
  });
  await t('并发签到（两个请求同时打）→ 只发一次，且都不再发新人礼', async () => {
    UNIVERSE.users.U_ALICE.lastDailyDate = '2000-01-01';  // 伪造成"没签过"
    UNIVERSE.users.U_ALICE.dailyStreak = 0;
    const before = pts();
    const [a, b] = await Promise.all([pointsFn.main({ action: 'daily' }), pointsFn.main({ action: 'daily' })]);
    const total = (a.awarded || 0) + (b.awarded || 0);
    assert.strictEqual(total, 1 * 30, '两个并发请求合计只应发 30 分，实际 ' + total);
    assert.strictEqual((a.signupBonus || 0) + (b.signupBonus || 0), 0, '已领过新人礼，并发也不应重发');
    assert.strictEqual(pts(), before + 30);
  });

  // ── ④ 余额不足：先守卫、后调模型 ──
  console.log('[④ 余额不足守门]');
  await t('余额不足（15 分想生成 20 分的朋友圈文案）→ 拒绝且不扣分、不给 need 以外的副作用', async () => {
    UNIVERSE.users.U_ALICE.points = 15;   // 把余额压到 20 以下才能走到"不足"分支（模拟老用户只剩 15，不看前面发了多少）
    const before = pts();
    httpLog = [];
    const r = await aiGen.main({ mode: 'moments', prompt: '今天天气不错' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.err, '积分不足');
    assert.strictEqual(r.need, 20);
    assert.strictEqual(pts(), before, '余额不足绝不能扣分');
    assert.strictEqual(httpLog.length, 0, '余额不足时不应调用大模型（白白烧钱）');
  });

  // ── ⑤⑥ 下单 → 发货 ──
  console.log('[⑤ 下单 ¥18 积分包]');
  let order800 = null;
  await t('下单 points_800 → 双签名 + 价格服务端判定 1800 + 订单落库 pending', async () => {
    const r = await createOrder.main({ code: 'CODE', productId: 'points_800' });
    assert.ok(r.signData, '应返回 signData');
    assert.strictEqual(r.priceFen, 1800);
    assert.strictEqual(r.productId, 'points_800');
    assert.ok(r.paySig && r.signature, '双签名都要有');
    const sd = JSON.parse(r.signData);
    assert.strictEqual(sd.goodsPrice, 1800);
    assert.strictEqual(sd.attach, 'U_ALICE', 'attach 必须是 openid，发货推送靠它定位用户');
    const ord = UNIVERSE.orders.find(o => o.outTradeNo === sd.outTradeNo);
    assert.ok(ord, '订单必须落库');
    assert.strictEqual(ord.status, 'pending');
    assert.strictEqual(ord.productId, 'points_800');
    order800 = { outTradeNo: sd.outTradeNo };
  });

  console.log('[⑥ 发货推送]');
  await t('签名合法的发货推送 → 积分 +800', async () => {
    const before = pts();
    const r = await okPush(notifyXml({ OpenId: 'U_ALICE', OutTradeNo: order800.outTradeNo, MchOrderNo: 'W_800', ProductId: 'points_800' }));
    assert.strictEqual(errCode(r), '0');
    assert.strictEqual(pts(), before + 800);
    const ord = UNIVERSE.orders.find(o => o.outTradeNo === order800.outTradeNo);
    assert.strictEqual(ord.status, 'delivered');
  });
  await t('同一订单重复推送 → 幂等，积分不再增加', async () => {
    const before = pts();
    await okPush(notifyXml({ OpenId: 'U_ALICE', OutTradeNo: order800.outTradeNo, MchOrderNo: 'W_800', ProductId: 'points_800' }));
    assert.strictEqual(pts(), before, '重复推送不得重复发货');
  });
  await t('伪造推送（签名错/缺 signature）→ 拒收，积分不变', async () => {
    const before = pts();
    // 故意用**已登记**的最高档 points_2500：这样若签名校验失效，攻击者能直接白拿 2500，
    // 测试必然变红。若用未登记的假 ID，会被"未登记道具不发货"顺手拦住，
    // 反而掩盖了签名校验本身失效的问题（假绿）。
    const bad = await deliver.main({ body: notifyXml({ OpenId: 'U_ALICE', OutTradeNo: order800.outTradeNo, MchOrderNo: 'W_HACK', ProductId: 'points_2500' }) });
    assert.strictEqual(errCode(bad), '1', '无签名推送必须被拒');
    const wrong = await deliver.main({ body: notifyXml({ OpenId: 'U_ALICE', OutTradeNo: order800.outTradeNo, MchOrderNo: 'W_HACK2', ProductId: 'points_2500' }), queryStringParameters: { signature: 'deadbeef', timestamp: '1', nonce: 'x' } });
    assert.strictEqual(errCode(wrong), '1', '伪造签名必须被拒');
    assert.strictEqual(pts(), before, '拒收后积分不能变');
  });

  // 本项目 MP 后台的实际模式是 cloudfunction（云函数模式）：微信把事件以【已解析对象】
  // 投给云函数，没有 body、也没有签名 query。这条断言锁住"该模式必须能正常发货"——
  // 旧版只认 event.body XML，会把真实推送判成 ignored，付了钱却静默不发货。
  await t('云函数模式推送（无 body/无签名）→ 同样正常发货', async () => {
    const c = await createOrder.main({ code: 'CODE', productId: 'points_200' });
    const sd = JSON.parse(c.signData);
    const before = pts();
    const r = await deliver.main({
      MsgType: 'event', Event: 'xpay_goods_deliver_notify',
      FromUserName: 'U_ALICE', OpenId: 'U_ALICE',
      OutTradeNo: sd.outTradeNo, ProductId: 'points_200',
      WeChatPayInfo: { MchOrderNo: 'W_CF' }
    });
    assert.strictEqual(errCode(r), '0', '云函数模式应被受理');
    assert.strictEqual(pts(), before + 200, '云函数模式也应到账 200');
    const ord = UNIVERSE.orders.find(o => o.outTradeNo === sd.outTradeNo);
    assert.strictEqual(ord.status, 'delivered');
  });

  // ── ⑦⑧ 生成朋友圈 ──
  console.log('[⑦ 生成朋友圈文案]');
  let firstOptions = null;
  await t('首次生成 → −20 分、出 3 条', async () => {
    const before = pts();
    const r = await aiGen.main({ mode: 'moments', prompt: '今天和朋友去爬山' });
    assert.strictEqual(r.ok, true, '生成应成功: ' + r.err);
    assert.strictEqual(r.cost, 20);
    assert.strictEqual(r.revised, false);
    assert.strictEqual(r.options.length, 3);
    assert.strictEqual(pts(), before - 20);
    assert.strictEqual(r.points, pts(), '返回的余额要与库里一致');
    firstOptions = r.options;
  });
  await t('换一批：带修改意见 → 只扣 15 分、出 3 条、revised:true', async () => {
    const before = pts();
    const r = await aiGen.main({
      mode: 'moments', prompt: '今天和朋友去爬山',
      feedback: '太文艺了，写得口语一点，别用感叹号',
      previous: firstOptions
    });
    assert.strictEqual(r.ok, true, '换一批应成功: ' + r.err);
    assert.strictEqual(r.cost, 15);
    assert.strictEqual(r.revised, true);
    assert.strictEqual(r.options.length, 3);
    assert.strictEqual(pts(), before - 15);
    assert.notDeepStrictEqual(r.options, firstOptions, '换一批必须和上一版不同');
  });
  await t('换一批：feedback 只有空白 → 不能压价，仍按首次 20 扣', async () => {
    const before = pts();
    const r = await aiGen.main({ mode: 'moments', prompt: '今天和朋友去爬山', feedback: '   ' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.cost, 20, '空白 feedback 不得享受 15 分档');
    assert.strictEqual(pts(), before - 20);
  });

  // ── ⑧ 多模态输入（图片 / 文章链接）──
  //    注意：不再有「生漫画/生脚本」这条路 —— 2026-09-19 用户拍板，画面感内容只能走付费定制。
  //    多模态与文章抓取本身仍是通用能力，故改挂到唯一的产出模式 moments 上继续覆盖。
  console.log('[⑧ 多模态输入]');
  await t('图片多模态生成朋友圈文案 → 走通且扣 20 分', async () => {
    const before = pts();
    httpLog = [];
    const r = await aiGen.main({ mode: 'moments', imageFileId: 'cloud://env/pic.png' });
    assert.strictEqual(r.ok, true, '图片生成应成功: ' + r.err);
    assert.ok(Array.isArray(r.options) && r.options.length >= 1, '应返回文案');
    assert.strictEqual(pts(), before - 20, '生成应扣 20，实际 ' + (before - pts()));
  });
  await t('文章链接生成朋友圈文案 → 抓正文、剔除页面噪声、注入模型输入', async () => {
    httpLog = [];
    const r = await aiGen.main({ mode: 'moments', url: ARTICLE_URL, prompt: '帮我写成朋友圈文案' });
    assert.strictEqual(r.ok, true, '文章链接应成功: ' + r.err);
    assert.ok(httpLog.some(l => l.indexOf('mp.example.com') >= 0), '应真的去抓了这个链接');
    assert.ok(Array.isArray(r.options) && r.options.length >= 1, '应返回文案');
  });
  await t('mode=comic（生成画面感内容脚本）→ 明确报错且不扣分（该路径已移除）', async () => {
    const before = pts();
    httpLog = [];
    const r = await aiGen.main({ mode: 'comic', prompt: '把这段改成画面感内容脚本' });
    assert.strictEqual(r.ok, false, 'comic 模式必须被拒绝，实际: ' + JSON.stringify(r));
    assert.ok(/不支持的 mode/.test(r.err), '应明确提示 mode 不支持，实际: ' + r.err);
    assert.strictEqual(pts(), before, '被拒时不得扣分');
    assert.strictEqual(httpLog.length, 0, '被拒时不应发起任何外部请求');
  });
  await t('SSRF 守卫：内网地址被拒，且不发起请求', async () => {
    httpLog = [];
    const r = await aiGen.main({ mode: 'comic', url: 'http://127.0.0.1:8080/admin' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(httpLog.length, 0, '内网地址绝不能真的去请求');
  });

  // ── ⑪ 买整本 ──
  console.log('[⑨ 买整本（回归：积分不被清零）]');
  await t('下单→发货 comic_full → 解锁整本，积分与优惠券保留', async () => {
    const pointsBefore = pts();
    const c = await createOrder.main({ code: 'CODE', productId: 'comic_full' });
    assert.strictEqual(c.priceFen, 990);
    const sd = JSON.parse(c.signData);
    await okPush(notifyXml({ OpenId: 'U_ALICE', OutTradeNo: sd.outTradeNo, MchOrderNo: 'W_FULL', ProductId: 'comic_full' }));
    const prof = await getProfile.main({});
    assert.strictEqual(prof.unlockedAll, true, '应解锁整本');
    assert.strictEqual(pts(), pointsBefore, '买整本绝不能清空已有积分（早期 set() 覆盖 bug）');
  });

  // ── ⑫ 兜底查单 ──
  console.log('[⑩ 兜底查单（发货推送丢了的情况）]');
  await t('查单补发货：买的是积分包 → 只加积分、不误解锁整本', async () => {
    UNIVERSE.users.U_BOB = { _id: 'U_BOB', openid: 'U_BOB', points: 0, unlockedAll: false, coupons: [], lastDailyDate: '', dailyStreak: 0 };
    CURRENT_OPENID = 'U_BOB';
    const c = await createOrder.main({ code: 'CODE', productId: 'points_200' });
    const sd = JSON.parse(c.signData);
    const r = await queryOrder.main({ openid: 'U_BOB', outTradeNo: sd.outTradeNo });
    assert.strictEqual(r.paid, true);
    assert.strictEqual(r.kind, 'points', '买积分包补发货不该解锁整本');
    assert.strictEqual(UNIVERSE.users.U_BOB.points, 200);
    assert.strictEqual(UNIVERSE.users.U_BOB.unlockedAll, false, '关键回归：查单不能"一律解锁整本"');
    CURRENT_OPENID = 'U_ALICE';
  });
  await t('兜底查单幂等：再查 3 次都不重复加积分', async () => {
    CURRENT_OPENID = 'U_BOB';
    const pending = UNIVERSE.orders.filter(o => o.openid === 'U_BOB' && o.status === 'delivered');
    const last = pending[pending.length - 1];
    for (let i = 0; i < 3; i++) {
      const r = await queryOrder.main({ openid: 'U_BOB', outTradeNo: last.outTradeNo });
      assert.strictEqual(r.paid, true);
      assert.strictEqual(r.already, true, '第 ' + (i + 1) + ' 次重复查单应识别为已发货');
      assert.strictEqual(r.kind, 'skipped');
    }
    assert.strictEqual(UNIVERSE.users.U_BOB.points, 200, '重复查单不得重复发货（否则支付一次可无限刷积分）');
  });
  await t('并发兜底查单（5 个请求同时打）→ 只发一次', async () => {
    UNIVERSE.users.U_CAROL = { _id: 'U_CAROL', openid: 'U_CAROL', points: 0, unlockedAll: false, coupons: [], lastDailyDate: '', dailyStreak: 0 };
    CURRENT_OPENID = 'U_CAROL';
    const c = await createOrder.main({ code: 'CODE', productId: 'points_2500' });
    const sd = JSON.parse(c.signData);
    await Promise.all([0, 1, 2, 3, 4].map(() => queryOrder.main({ openid: 'U_CAROL', outTradeNo: sd.outTradeNo })));
    assert.strictEqual(UNIVERSE.users.U_CAROL.points, 2500, '5 个并发查单只应发一次 2500，实际 ' + UNIVERSE.users.U_CAROL.points);
    CURRENT_OPENID = 'U_ALICE';
  });

  // ── ⑬ 收尾：账目自洽 ──
  console.log('[⑪ 账目自洽]');
  await t('Alice 的积分 = 各项收支之和（无凭空增减）', async () => {
    // 80(新人礼) +30(签到) +30(并发补签) −125(④守门时把余额 140→15，模拟老用户) +800(充值) +200(云函数模式推送充值)
    //   −20(首次) −15(换一批) −20(空白feedback) −20(图片) −20(文章) = 920
    // 2026-09-18：生成从「+30 赚分」改为「−30 扣分」
    // 2026-09-19：新增新人礼 +100；且「生成画面感内容脚本」路径移除，图片/文章两例改走 moments
    //             （单项 −30 → −20），故 900 → 920。
    // 2026-09-23：新人礼 100→80、每日 base 20→30，但 80+30+30 = 100+20+20 = 140，终值 920 不变。
    // ④ 那步是**直接赋值** 15，终值不受前面发了多少影响（若这条断言突然变了，说明④ 被改成相对增减，需重新核算）。
    assert.strictEqual(pts(), 920, '最终余额应为 920，实际 ' + pts());
  });
  await t('全程只发了 1 次重复发货尝试，订单状态全部落地', async () => {
    const bad = UNIVERSE.orders.filter(o => o.status !== 'delivered' && o.productId !== 'points_800');
    assert.strictEqual(bad.length, 0, '不应有遗留 pending 订单: ' + JSON.stringify(bad.map(o => o.outTradeNo)));
  });

  console.log('\n════════ 结果：' + pass + ' PASS / ' + fail + ' FAIL ════════');
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('测试脚本自身异常：', e);
  process.exitCode = 1;
});
