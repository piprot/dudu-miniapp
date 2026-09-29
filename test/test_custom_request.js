// custom_request 云函数本地单测（零依赖 · 纯 Node 断言）
// 做法：Stub 掉 wx-server-sdk（云数据库）与 https（飞书 webhook），直接调 exports.main，
//      验证「落库 + 飞书全文推送 + 失败不丢单 + 幂等不重复推」这几条真实行为。
//
// 为什么必须有：webhook 推送是「运营者能否看到客户需求」的唯一自动通道，
// 一旦静默失败，客户付了钱、画师却永远不知道 —— 这种故障没有报错、只有沉默，必须靠测试兜住。
//
// 运行：node test/test_custom_request.js    期望：全部 PASS，退出码 0。
const assert = require('assert');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

const FN = path.join(__dirname, '..', 'cloudfunctions', 'custom_request', 'index.js');

// ───────────────────────── 1. 云数据库 Stub（按集合名分开存！）─────────────────────────
let DB = {};         // { 集合名: [doc, ...] }
let seq = 0;

function resetDb() { DB = {}; seq = 0; }

// db.command.pull 的本地等价实现：移除数组字段中匹配给定字段的元（与微信云开发 db.command.pull 同语义）。
// 仅用于让「核销券」这一步在生产代码用原子 pull 的同时，本地测试能跑通。
function isPullCmd(v) { return v && typeof v === 'object' && typeof v.__pull !== 'undefined'; }
function matchesPull(el, pv) {
  if (!el || typeof el !== 'object') return false;
  return Object.keys(pv).every(k => el[k] === pv[k]);
}
function applyData(doc, data) {
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (isPullCmd(v)) {
      if (Array.isArray(doc[k])) doc[k] = doc[k].filter(el => !matchesPull(el, v.__pull));
    } else {
      doc[k] = v;
    }
  });
}

function rowsOf(name) {
  if (!DB[name]) DB[name] = [];
  return DB[name];
}

function makeCollection(name) {
  return {
    where(cond) {
      const hit = () => rowsOf(name).filter(d => Object.keys(cond || {}).every(k => d[k] === cond[k]));
      return {
        get: async () => ({ data: hit().map(d => Object.assign({}, d)) }),
        update: async ({ data }) => { hit().forEach(d => applyData(d, data)); return { stats: { updated: hit().length } }; }
      };
    },
    add: async ({ data }) => {
      const _id = 'doc' + (++seq);
      rowsOf(name).push(Object.assign({ _id }, data));
      return { _id };
    },
    doc(id) {
      return {
        get: async () => { const d = rowsOf(name).find(x => x._id === id); if (!d) throw new Error('document does not exist'); return { data: Object.assign({}, d) }; },
        update: async ({ data }) => {
          const d = rowsOf(name).find(x => x._id === id);
          if (!d) throw new Error('document does not exist');
          applyData(d, data);
          return { stats: { updated: 1 } };
        }
      };
    }
  };
}

const cloudStub = {
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  init: () => {},
  getWXContext: () => ({ OPENID: 'openid-buyer' }),
  database: () => ({
    collection: makeCollection,
    command: { pull: (value) => ({ __pull: value }) },
    serverDate: () => 'SERVER_DATE'
  })
};

// ───────────────────────── 2. https Stub（抓飞书请求）─────────────────────────
let posts = [];          // { url, body, headers }
let webhookReply = { statusCode: 200, body: JSON.stringify({ code: 0, msg: 'success' }) };
// 通道A（应用机器人）要先把 app_id/app_secret 换成 tenant_access_token，再发消息。
// 两个请求都是 POST /open-apis/…，靠 URL 区分（见下面 isTokenUrl）。
let tokenReply = { statusCode: 200, body: JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: 't-TEST-TOKEN', expire: 7200 }) };
const isTokenUrl = (u) => u.indexOf('tenant_access_token') >= 0;

function makeRes(r) {
  const res = new EventEmitter();
  res.statusCode = r.statusCode;
  res.headers = {};
  res.setEncoding = () => {};
  res.resume = () => {};
  res.destroy = () => {};
  process.nextTick(() => { res.emit('data', r.body); res.emit('end'); res.emit('close'); });
  return res;
}

const fakeHttps = {
  request(opts, cb) {
    const req = new EventEmitter();
    let written = '';
    req.write = (c) => { written += c; };
    req.destroy = () => {};
    req.setTimeout = () => {};
    req.end = () => {
      const url = 'https://' + opts.hostname + opts.path;
      posts.push({ url: url, body: written, headers: opts.headers || {} });
      cb(makeRes(isTokenUrl(url) ? tokenReply : webhookReply));
    };
    return req;
  }
};

// ───────────────────────── 3. 注入 Stub ─────────────────────────
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return cloudStub;
  if (request === 'https') return fakeHttps;
  return origLoad.apply(this, arguments);
};

/** 环境变量在模块加载时读取 → 改环境必须重新加载模块。 */
function loadWith(env) {
  delete require.cache[require.resolve(FN)];
  Object.keys(process.env).filter(k => k.indexOf('FEISHU_') === 0).forEach(k => delete process.env[k]);
  Object.keys(env || {}).forEach(k => { process.env[k] = env[k]; });
  return require(FN);
}

const HOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/TEST-HOOK';
const APP_ID = 'cli_test_app_id';
const CHAT = 'oc_test_chat_id';

/** 从飞书 payload 里抽出全部可见文本（兼容 post 与 text 两种形态、两个通道）。 */
function textOf(bodyStr) {
  const b = JSON.parse(bodyStr);
  // 通道A（im/v1/messages）：content 是 **JSON 字符串**（飞书强制二次编码）
  // 通道B（webhook）：content 是对象
  const c = typeof b.content === 'string' ? JSON.parse(b.content) : b.content;
  if (b.msg_type === 'post') {
    const zh = c.post.zh_cn;
    return (zh.content || []).map(p => p.map(e => e.text).join('')).join('\n');
  }
  return (c && c.text) || '';
}

/** 通道A 的 content 是字符串 → 想读标题得先解一层。 */
function titleOf(bodyStr) {
  const b = JSON.parse(bodyStr);
  const c = typeof b.content === 'string' ? JSON.parse(b.content) : b.content;
  return c.post ? c.post.zh_cn.title : '';
}

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
}

const baseOrder = {
  action: 'save',
  productId: 'comic_web',
  email: 'buyer@example.com',
  story: '我是一名89年的二胎孕妈，主业欠薪半年，孕期又查出二胎。\n但我没认输，开始做副业，现在月入5000了。',
  note: '希望画风偏水彩，色调温暖。',
  outTradeNo: 'T20260918001'
};

(async () => {
  // ① 未配置 webhook：只落库，且明确记「未配置」，不假装成功
  await t('未配置 FEISHU_WEBHOOK → 落库成功 + notify 标明未配置 + 零请求', async () => {
    resetDb(); posts = [];
    const fn = loadWith({});
    const r = await fn.main(Object.assign({}, baseOrder));
    assert.strictEqual(r.ok, true, '应落库成功');
    assert.strictEqual(r.notified, false);
    assert.strictEqual(posts.length, 0, '不该发任何请求');
    const doc = DB['custom_comic_requests'][0];
    assert.ok(/未配置/.test(doc.notify), 'notify 应标明未配置，实际=' + doc.notify);
  });

  // ② 配置 webhook：推 post 富文本，且**故事全文逐字在内**（不是摘要）
  await t('配置 webhook → 故事全文逐字推送（含换行/补充说明）', async () => {
    resetDb(); posts = [];
    const fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    const r = await fn.main(Object.assign({}, baseOrder));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.notified, true, 'notified 应为 true，实际 notify=' + r.notify);
    assert.strictEqual(posts.length, 1, '短工单应只发一条');
    assert.strictEqual(posts[0].url, HOOK);
    const body = JSON.parse(posts[0].body);
    assert.strictEqual(body.msg_type, 'post', '首选富文本');
    const txt = textOf(posts[0].body);
    baseOrder.story.split('\n').forEach(line => {
      assert.ok(txt.indexOf(line) >= 0, '故事全文里必须逐字含：' + line);
    });
    assert.ok(txt.indexOf(baseOrder.note) >= 0, '补充说明也要在推送里');
    assert.ok(txt.indexOf(baseOrder.email) >= 0, '邮箱要在推送里');
    assert.ok(txt.indexOf(baseOrder.outTradeNo) >= 0, '订单号要在推送里');
    assert.ok(/89年的二胎孕妈/.test(txt), '开头不能丢字');
    // 文档上要回写成功状态，运营侧查得到
    assert.ok(/已推送飞书/.test(DB['custom_comic_requests'][0].notify), '文档应记已推送');
  });

  // ③ 长故事：拆多条连发，且拼起来仍是原文（绝不截断）
  await t('长故事（4200 字）→ 自动拆条连发，累计文本仍含全部原文', async () => {
    resetDb(); posts = [];
    const lines = [];
    for (let i = 0; i < 120; i++) lines.push('第' + (i + 1) + '段：' + '情'.repeat(30));
    const story = lines.join('\n');                 // ≈ 120*35 = 4200 字
    const fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    const r = await fn.main(Object.assign({}, baseOrder, { story, outTradeNo: 'T-LONG' }));
    assert.strictEqual(r.notified, true, r.notify);
    assert.ok(posts.length >= 2, '4200 字必须拆条，实际 ' + posts.length + ' 条');
    const all = posts.map(p => textOf(p.body)).join('\n');
    lines.forEach(l => assert.ok(all.indexOf(l) >= 0, '缺段：' + l.slice(0, 12)));
    assert.ok(/（1\/\d+）/.test(JSON.parse(posts[0].body).content.post.zh_cn.title), '多条时标题应带 (1/N)');
  });

  // ④ 推送失败（飞书业务码非 0）：落库仍成功 + 记失败原因 —— 绝不丢单
  await t('飞书拒收 → 订单照样落库 + notify 记失败原因（不丢单）', async () => {
    resetDb(); posts = [];
    webhookReply = { statusCode: 200, body: JSON.stringify({ code: 9499, msg: 'Bad Request' }) };
    const fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    const r = await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-FAIL' }));
    assert.strictEqual(r.ok, true, '推送失败不能导致落库失败');
    assert.strictEqual(r.notified, false);
    assert.ok(/推送失败/.test(r.notify), 'notify 应含失败原因，实际=' + r.notify);
    assert.strictEqual(DB['custom_comic_requests'].length, 1, '订单必须在库里');
    assert.ok(posts.length >= 2, 'post 失败后应降级 text 再试一次');
    assert.strictEqual(JSON.parse(posts[1].body).msg_type, 'text', '降级为 text');
    webhookReply = { statusCode: 200, body: JSON.stringify({ code: 0, msg: 'success' }) };
  });

  // ⑤ post 被拒时降级 text 仍能送达
  await t('post 被拒 → 自动降级 text 仍送达', async () => {
    resetDb(); posts = [];
    let n = 0;
    const origReq = fakeHttps.request;
    fakeHttps.request = function (opts, cb) {
      const req = origReq.call(fakeHttps, opts, cb);
      const origEnd = req.end;
      req.end = function () {
        n++;
        if (n === 1) { // 第一条（post）失败
          posts.push({ url: 'https://' + opts.hostname + opts.path, body: '' });
          cb(makeRes({ statusCode: 400, body: '{"code":9499,"msg":"bad"}' }));
          return;
        }
        origEnd();
      };
      return req;
    };
    const fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    const r = await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-DOWN' }));
    fakeHttps.request = origReq;
    assert.strictEqual(r.notified, true, '降级后应成功，实际=' + r.notify);
    assert.ok(posts.length >= 1);
  });

  // ⑥ 幂等：同订单号重复提交 → already，且**不重复推送**（否则运营侧被刷屏）
  await t('幂等：同 outTradeNo 重复提交不重复建单、不重复推送', async () => {
    resetDb(); posts = [];
    const fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    const a = await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-SAME' }));
    const b = await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-SAME' }));
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.already, true, '第二次应命中幂等');
    assert.strictEqual(DB['custom_comic_requests'].length, 1, '只应有一条记录');
    assert.strictEqual(posts.length, 1, '只应推送一次');
  });

  // ⑦ 签名：配了 secret 时 payload 必须带 timestamp + sign
  await t('配置 FEISHU_WEBHOOK_SECRET → payload 带 timestamp 与 HMAC-SHA256 sign', async () => {
    resetDb(); posts = [];
    const fn = loadWith({ FEISHU_WEBHOOK: HOOK, FEISHU_WEBHOOK_SECRET: 's3cr3t' });
    await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-SIGN' }));
    const b = JSON.parse(posts[0].body);
    assert.ok(b.timestamp && /^\d{10}$/.test(b.timestamp), '应有 10 位秒级 timestamp');
    assert.ok(b.sign && b.sign.length > 20, '应有 base64 签名');
    const crypto = require('crypto');
    const expect = crypto.createHmac('sha256', b.timestamp + '\n' + 's3cr3t').update('').digest('base64');
    assert.strictEqual(b.sign, expect, '签名算法应为 HMAC-SHA256(ts+"\\n"+secret)');
  });

  // ⑧ 服务端校验：非法输入必须在推送之前被挡掉
  await t('入参校验：邮箱/档位/空故事/超长故事 均拒绝且不推送', async () => {
    resetDb(); posts = [];
    const fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    const bad = [
      [{ email: 'not-an-email' }, '邮箱'],
      [{ productId: 'comic_x' }, '档位'],
      [{ story: '   ' }, '故事'],
      [{ story: 'x'.repeat(30001) }, '过长']
    ];
    for (const [patch, label] of bad) {
      const r = await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-BAD-' + label }, patch));
      assert.strictEqual(r.ok, false, label + ' 应被拒');
    }
    assert.strictEqual(DB['custom_comic_requests'], undefined, '非法输入不该落库');
    assert.strictEqual(posts.length, 0, '非法输入不该推送');
  });

  // ⑨ test_notify 自检接口能真的发出一条
  await t('test_notify 自检：未配置时 ok=false 且 configured=false；配置后真发出', async () => {
    resetDb(); posts = [];
    let fn = loadWith({});
    let r = await fn.main({ action: 'test_notify' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.configured, false);
    assert.strictEqual(posts.length, 0);

    posts = [];
    fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    r = await fn.main({ action: 'test_notify' });
    assert.strictEqual(r.ok, true, r.err);
    assert.strictEqual(r.configured, true);
    assert.strictEqual(posts.length, 1);
  });

  // ⑩ 通道A（应用机器人）：先换 tenant_access_token，再调 im/v1/messages
  await t('通道A 应用机器人 → 换 token 后发 im/v1/messages（全文逐字、content 为 JSON 字符串）', async () => {
    resetDb(); posts = [];
    const fn = loadWith({ FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: 'app-secret', FEISHU_CHAT_ID: CHAT });
    const r = await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-APP' }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.notified, true, 'notified 应为 true，实际 notify=' + r.notify);
    assert.strictEqual(posts.length, 2, '应恰好两次请求（换 token + 发消息），实际 ' + posts.length);
    assert.ok(isTokenUrl(posts[0].url), '第一次应先换 token');
    const tb = JSON.parse(posts[0].body);
    assert.strictEqual(tb.app_id, APP_ID);
    assert.strictEqual(tb.app_secret, 'app-secret');
    const mu = posts[1].url;
    assert.ok(/\/im\/v1\/messages/.test(mu), '第二次应发消息，实际 ' + mu);
    assert.ok(/receive_id_type=chat_id/.test(mu), '应以 chat_id 为接收方');
    assert.strictEqual(posts[1].headers.Authorization, 'Bearer t-TEST-TOKEN', '必须带 Bearer token');
    const mb = JSON.parse(posts[1].body);
    assert.strictEqual(mb.receive_id, CHAT);
    assert.strictEqual(mb.msg_type, 'post', '首选富文本');
    assert.strictEqual(typeof mb.content, 'string', 'content 必须是 JSON 字符串（飞书强制二次编码）');
    const txt = textOf(posts[1].body);
    baseOrder.story.split('\n').forEach(line => {
      assert.ok(txt.indexOf(line) >= 0, '故事全文里必须逐字含：' + line);
    });
    assert.ok(txt.indexOf(baseOrder.email) >= 0, '邮箱要在推送里');
    assert.ok(txt.indexOf(baseOrder.note) >= 0, '补充说明也要在推送里');
    assert.ok(/已推送飞书/.test(DB['custom_comic_requests'][0].notify), '文档应记已推送');
  });

  // ⑪ 两个通道都配 → 优先应用机器人（webhook 零请求）
  await t('两通道都配 → 优先应用机器人，webhook 零请求', async () => {
    resetDb(); posts = [];
    const fn = loadWith({ FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: 'app-secret', FEISHU_CHAT_ID: CHAT, FEISHU_WEBHOOK: HOOK });
    const r = await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-BOTH' }));
    assert.strictEqual(r.notified, true, r.notify);
    assert.ok(posts.every(p => p.url.indexOf('/bot/v2/hook/') < 0), '配了 app 就不该再打 webhook');
    assert.ok(/\/im\/v1\/messages/.test(posts[posts.length - 1].url));
  });

  // ⑫ 长故事拆条：token 只换一次（缓存生效），且原文累加不丢字
  await t('通道A 长故事拆条 → token 只换一次（缓存），累计文本仍含全部原文', async () => {
    resetDb(); posts = [];
    const lines = [];
    for (let i = 0; i < 120; i++) lines.push('第' + (i + 1) + '段：' + '情'.repeat(30));
    const story = lines.join('\n');
    const fn = loadWith({ FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: 'app-secret', FEISHU_CHAT_ID: CHAT });
    const r = await fn.main(Object.assign({}, baseOrder, { story, outTradeNo: 'T-APP-LONG' }));
    assert.strictEqual(r.notified, true, r.notify);
    const tokenCalls = posts.filter(p => isTokenUrl(p.url)).length;
    const msgCalls = posts.filter(p => !isTokenUrl(p.url)).length;
    assert.strictEqual(tokenCalls, 1, 'token 应只换一次（缓存生效），实际 ' + tokenCalls);
    assert.ok(msgCalls >= 2, '4200 字必须拆条，实际 ' + msgCalls + ' 条');
    const all = posts.filter(p => !isTokenUrl(p.url)).map(p => textOf(p.body)).join('\n');
    lines.forEach(l => assert.ok(all.indexOf(l) >= 0, '缺段：' + l.slice(0, 12)));
    assert.ok(/（1\/\d+）/.test(titleOf(posts[1].body)), '多条时标题应带 (1/N)');
  });

  // ⑬ 换不到 token：仍不丢单，且不该裸发消息
  await t('换 token 失败 → 订单照样落库 + notify 记失败原因，且不尝试发消息', async () => {
    resetDb(); posts = [];
    tokenReply = { statusCode: 200, body: JSON.stringify({ code: 99991663, msg: 'app_secret 错误' }) };
    const fn = loadWith({ FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: 'wrong', FEISHU_CHAT_ID: CHAT });
    const r = await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-NOTOKEN' }));
    tokenReply = { statusCode: 200, body: JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: 't-TEST-TOKEN', expire: 7200 }) };
    assert.strictEqual(r.ok, true, 'token 失败不能导致落库失败');
    assert.strictEqual(r.notified, false);
    assert.ok(/推送失败/.test(r.notify), 'notify 应含失败原因，实际=' + r.notify);
    assert.ok(/tenant_access_token|app_secret/.test(r.notify), '失败原因要能定位，实际=' + r.notify);
    assert.strictEqual(DB['custom_comic_requests'].length, 1, '订单必须在库里');
    assert.strictEqual(posts.filter(p => !isTokenUrl(p.url)).length, 0, '没拿到 token 不该去发消息');
  });

  // ⑭ test_notify：app 三件套缺一不可，且要回传 mode 说明走的是哪条通道
  await t('test_notify 自检：app 三件套缺一不可；配齐后 mode=app 且真发出；只配 webhook 则 mode=webhook', async () => {
    resetDb(); posts = [];
    let fn = loadWith({ FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: 'app-secret' });   // 缺 FEISHU_CHAT_ID
    let r = await fn.main({ action: 'test_notify' });
    assert.strictEqual(r.configured, false, '缺 FEISHU_CHAT_ID 不该算已配置');
    assert.strictEqual(r.mode, 'none');
    assert.strictEqual(posts.length, 0);

    posts = [];
    fn = loadWith({ FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: 'app-secret', FEISHU_CHAT_ID: CHAT });
    r = await fn.main({ action: 'test_notify' });
    assert.strictEqual(r.ok, true, r.err);
    assert.strictEqual(r.configured, true);
    assert.strictEqual(r.mode, 'app');
    assert.strictEqual(posts.filter(p => !isTokenUrl(p.url)).length, 1, '应真发出 1 条');

    posts = [];
    fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    r = await fn.main({ action: 'test_notify' });
    assert.strictEqual(r.mode, 'webhook', '只配 webhook 时 mode 应为 webhook');
    assert.strictEqual(r.ok, true, r.err);
  });

  // ⑭ 优惠券（积分兑换 → 下单使用）：合法券随订单落库 + 推送里标出，运营才能按券减免。
  //    背景：此前券只在 points 页显示，下单链路完全没读它 —— 用户换了券却无处可用
  //    （2026-09-20 真机反馈「积分逻辑不通，并没有接续」）。
  await t('优惠券｜合法 9 折券 → 落库 coupon 并带可读名 + 推送标出「已用权益」', async () => {
    resetDb(); posts = [];
    // 模拟用户已兑换一张券（vp_users.coupons 里有一张 comic_discount）
    DB['vp_users'] = [{ _id: 'openid-buyer', points: 100, coupons: [{ type: 'comic_discount', value: 0.9, grantedAt: 1 }] }];
    const fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    const r = await fn.main(Object.assign({}, baseOrder, {
      outTradeNo: 'T-COUPON',
      coupon: { type: 'comic_discount', value: 0.9 }
    }));
    assert.strictEqual(r.ok, true, r.err);
    const doc = DB['custom_comic_requests'][0];
    assert.ok(doc.coupon, 'coupon 应落库，实际=' + JSON.stringify(doc.coupon));
    assert.strictEqual(doc.coupon.type, 'comic_discount');
    assert.strictEqual(doc.coupon.value, 0.9);
    assert.strictEqual(doc.coupon.label, '画面感内容 9 折券', '应带上可读名称供运营识别');
    // 券减额 / 券后应付必须算对（comic_web=8800 → 9 折减 880，券后 7920），运营才能按此退差
    assert.strictEqual(doc.discountFen, 880, '券减额应 = round(8800*0.1)=880');
    assert.strictEqual(doc.finalFen, 7920, '券后应付应 = 8800-880=7920');
    const txt = textOf(posts[0].body);
    assert.ok(txt.indexOf('已用权益') >= 0, '推送必须标出用券，否则运营按原价结算、券等于白换');
    assert.ok(txt.indexOf('画面感内容 9 折券') >= 0, '推送里要出现券名');
    assert.ok(txt.indexOf('7920') >= 0 || txt.indexOf('券后实付') >= 0, '推送应显眼写出券后实付');
    // 核销：下单成功后券应从 vp_users.coupons 移除，否则同一张券可被多单重复使用
    const u = DB['vp_users'][0];
    assert.ok(!(u.coupons || []).some(c => c.type === 'comic_discount'), '券用过后应被核销（移出 vp_users.coupons），防止重复使用');
  });

  // ⑮ 券白名单：未登记类型 / 越界折率一律丢弃（不采信前端），且不得挡住正常建单
  await t('优惠券｜非白名单类型或非法折率 → 丢弃不落库、不影响建单与推送', async () => {
    resetDb(); posts = [];
    const fn = loadWith({ FEISHU_WEBHOOK: HOOK });
    const bads = [
      { type: 'free_all', value: 0 },          // 未登记类型
      { type: 'comic_discount', value: 1 },    // 1 = 等于没打折，非法
      { type: 'comic_discount', value: 0 },    // 0 = 白拿，非法
      { type: 'comic_discount', value: 'abc' } // 非数字
    ];
    for (let i = 0; i < bads.length; i++) {
      resetDb(); posts = [];
      const r = await fn.main(Object.assign({}, baseOrder, { outTradeNo: 'T-CBAD-' + i, coupon: bads[i] }));
      assert.strictEqual(r.ok, true, '非法券不该挡住建单：' + JSON.stringify(bads[i]));
      const doc = DB['custom_comic_requests'][0];
      assert.strictEqual(doc.coupon, null, '非法券必须落成 null：' + JSON.stringify(bads[i]));
      assert.ok(textOf(posts[0].body).indexOf('已用权益') < 0, '非法券不该出现在推送里');
    }
  });

  console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
  process.exitCode = fail ? 1 : 0;
})();
