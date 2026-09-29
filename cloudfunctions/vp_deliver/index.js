// 虚拟支付·发货推送云函数（个人主体）
// 微信平台支付成功后把 xpay_goods_deliver_notify 投递到本函数，本函数负责发货。
//
// ── 两种接收形态（都支持，因为「消息推送」在云开发侧可配成两种模式）──
//   A) **云函数模式**（本项目实际使用）：微信把事件以【已解析对象】直接投给本函数
//      —— 字段形如 event.Event / event.OutTradeNo / event.ProductId / event.WeChatPayInfo.MchOrderNo。
//      ⚠️ 这个形态**没有 body、没有 signature query**。
//   B) HTTP 触发模式：微信 POST 原始 XML —— event.body 是 XML 字符串，
//      验签参数在 event.queryStringParameters（signature/timestamp/nonce）。
//
// ── 安全模型：三道闸，缺一不可 ──
//   闸①【不采信推送内容】推送只提供 outTradeNo 这一个线索；openid 与 productId
//      一律以 vp_orders 落库的为准（那是下单时服务端用 code 换回来的 openid）。
//      推送里的 OpenId/ProductId 只用于日志比对。⇒ 伪造 openid 无收益。
//   闸②【必须向微信查单确认真实已支付】这一闸对「云函数模式」是**唯一**的真伪防线：
//      云函数模式下没有签名，而任何小程序用户都能用 wx.cloud.callFunction 直接调本函数，
//      并且 **outTradeNo 在下单时就已经返回给前端了**（vp_create_order 的 signData 里），
//      所以攻击者可以拿自己**未支付**的订单号伪造一次调用白拿货。
//      ⇒ 发货前一律调 xpay/query_order 确认 PAID；未支付不发。
//      （这也正是本文件早期注释里写的「更强的替代方案」。）
//   闸③【发货动作走乐观锁 CAS】pending → delivered 的状态跃迁只允许成功一次，
//      重复/并发推送不会重复发货。幂等做在「发货动作」上，不是做在「查单动作」上。
//
// ── 环境变量 ──
//   VP_PUSH_TOKEN：HTTP 触发模式下的推送来源校验（与 MP 后台「消息推送」的 Token 一致）
//   VP_APP_ID / VP_APP_SECRET / VP_APP_KEY：闸②查单验真用（与 vp_query 同一套）
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function env(name) { return process.env[name] || ''; }
function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex');
}
function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      // ⚠️ 用 Buffer 累积后统一 utf8 解码，避免多字节汉字被分片截断成乱码(???/�)
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8')));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function postJSON(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers)
    }, res => {
      // ⚠️ 用 Buffer 累积后统一 utf8 解码，避免多字节汉字被分片截断成乱码(???/�)
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8')));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();   // 必须显式 end()：否则请求不完整/可能永久挂起（曾导致云函数超时）
  });
}

// ─────────────────────────────────────────────────────────────
// 推送来源校验（仅 HTTP 触发模式适用）
// vp_deliver 作为 HTTP 触发时是公网地址。若不校验来源，任何人只要知道这个 URL，
// 就能 POST 一条 <ProductId>points_2500</ProductId> 白刷积分。
// 校验方式（微信「消息推送」标准校验）：微信在推送 URL 上带 signature/timestamp/nonce，
//   signature = sha1( 将 token、timestamp、nonce 三个字符串按字典序排序后拼接 )
// 用法：在云环境变量设 VP_PUSH_TOKEN，并与 MP 后台【开发管理→消息推送】里填的 Token 保持同一个。
// 未配置时跳过校验（避免首次部署被卡住），但会在日志告警 —— 上线前请务必配置。
// 注：云函数模式没有 query 参数，这一闸不适用，真伪由下方的 verifyPaid 兜住。
// ─────────────────────────────────────────────────────────────
function verifyPushHttp(event) {
  const token = env('VP_PUSH_TOKEN');
  if (!token) {
    console.warn('[vp_deliver] 未配置 VP_PUSH_TOKEN，跳过推送来源校验（存在伪造通知风险，上线前请配置）');
    return true;
  }
  const q = (event && (event.queryStringParameters || event.queryString)) || {};
  const signature = String(q.signature || '');
  const timestamp = String(q.timestamp || '');
  const nonce = String(q.nonce || '');
  if (!signature || !timestamp || !nonce) return false;
  const expected = crypto.createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex');
  return expected === signature;
}

// ─────────────────────────────────────────────────────────────
// 闸②：向微信查单，确认这笔订单**真的已支付**，才允许发货。
// 未配置虚拟支付参数时降级为「不校验」并告警 —— 此时 vp_create_order 也下不了单
// （它同样要求这四个变量），因此不存在「可下单但可不验真」的窗口。
// ─────────────────────────────────────────────────────────────
async function verifyPaid(openid, outTradeNo) {
  const appid = env('VP_APP_ID');
  const secret = env('VP_APP_SECRET');
  const appKey = env('VP_APP_KEY');
  if (!appid || !secret || !appKey) {
    console.warn('[vp_deliver] 未配置 VP_APP_ID/VP_APP_SECRET/VP_APP_KEY，跳过查单验真（尚未配置虚拟支付时属正常）');
    return true;
  }
  const tokenRes = await getJSON(
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + appid + '&secret=' + secret
  );
  if (!tokenRes || !tokenRes.access_token) {
    throw new Error('access_token 获取失败：' + ((tokenRes && tokenRes.errmsg) || ''));
  }
  // B 端查单：pay_sig = HMAC-SHA256(AppKey, "/xpay/query_order&" + post_body)
  // 与 vp_query 完全一致，勿改键序/前缀。
  // ⚠️ pay_sig 的正确位置是 **URL 查询参数**（官方文档 api_query_order）：
  //    放 HTTP header 或放 body 都会报 268490002「签名字段[pay_sig]为空」
  //    —— 2026-09-18 运行时探针实测两种错法各踩一次，与 vp_query 同批修复。
  const bodyObj = { openid, env: 0, order_id: outTradeNo };
  const postBody = JSON.stringify(bodyObj);
  const paySig = hmacSha256(appKey, '/xpay/query_order&' + postBody);
  const res = await postJSON(
    'https://api.weixin.qq.com/xpay/query_order?access_token=' + tokenRes.access_token + '&pay_sig=' + paySig,
    {},
    bodyObj
  );
  return !!(res && res.errcode === 0 && (res.paid || res.order_state === 'PAID' || res.state === 2));
}

// ─────────────────────────────────────────────────────────────
// 道具目录（服务端唯一权威，与 vp_create_order / vp_query 的 PRODUCTS、
// utils/config.js 的 POINTS.packs 保持一致；由 test/test_constants_sync.js 校验）。
// kind: 'unlock' = 解锁整本；'points' = 给该用户加积分（不解锁整本）
// ─────────────────────────────────────────────────────────────
const PRODUCTS = {
  comic_full:  { priceFen: 990,  kind: 'unlock' },
  points_200:  { priceFen: 600,  kind: 'points', points: 200 },
  points_800:  { priceFen: 1800, kind: 'points', points: 800 },
  points_2500: { priceFen: 5000, kind: 'points', points: 2500 },
  // 付费定制画面感内容（2026-09-18）：人工 8 小时交付，邮箱见 custom_comic_requests 集合
  comic_pdf:   { priceFen: 6600, kind: 'custom' },
  comic_web:   { priceFen: 8800, kind: 'custom' }
};

// 发货：按道具目录决定"加积分"还是"解锁整本"。
// ⚠️ 一律用 update 合并字段——早期版本用 set() 覆盖整个文档，会把用户已赚的 points/coupons 清空。
async function deliver(db, openid, productId) {
  const _ = db.command;
  const ref = db.collection('vp_users').doc(openid);
  const cur = await ref.get().catch(() => ({ data: null }));
  if (!(cur && cur.data)) {
    await ref.set({ data: { openid, points: 0, unlockedAll: false, coupons: [], createTime: db.serverDate() } });
  }
  const item = PRODUCTS[productId];
  if (item && item.kind === 'points') {
    await ref.update({ data: { points: _.inc(item.points), updateTime: db.serverDate() } });
    return { kind: 'points', points: item.points };
  }
  if (item && item.kind === 'unlock') {
    await ref.update({ data: { unlockedAll: true, lastProductId: productId, updateTime: db.serverDate() } });
    return { kind: 'unlock' };
  }
  // 定制类（comic_pdf/comic_web）：无即时权益可发——履约走 custom_comic_requests 落库 + 人工 8 小时回邮。
  // 这里只需确认"订单已收"，前端在支付成功页收集邮箱。
  if (item && item.kind === 'custom') {
    return { kind: 'custom' };
  }
  // 未登记的道具：不发货（避免伪造通知/错配道具白拿；真实订单可由 vp_query 兜底查单核对）
  console.error('[vp_deliver] 未登记的道具，未发货:', productId, 'openid:', openid);
  return { kind: 'unknown' };
}

// 极简 XML 字段提取（HTTP 触发模式用，无需第三方依赖）
function extract(xml, tag) {
  const m = xml.match(
    new RegExp('<' + tag + '>[^<]*<!\\[CDATA\\[(.*?)\\]\\]>|<' + tag + '>(.*?)</' + tag + '>')
  );
  return m ? (m[1] || m[2] || '') : '';
}

// 云函数模式取字段：XML→JSON 后同名单标签可能是字符串、重复标签可能是数组，故统一取首个并转字符串
function firstStr(v) {
  if (Array.isArray(v)) v = v[0];
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}
function pick(obj, path) {
  if (!obj) return '';
  const v = String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  return firstStr(v);
}

// 输入形态判定：HTTP 触发必有 body（XML 字符串）；云函数模式没有。
function isHttpMode(event) {
  return !!(event && (typeof event.body === 'string' || typeof event.Body === 'string'));
}

// 统一以结构化的 HTTP 响应返回 XML。云函数模式虽然不看返回值，但保持单一返回路径，
// 既方便日志/排障，也让两种模式下的返回体语义一致（ErrCode 0 = 已受理）。
function httpXml(xml) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: xml
  };
}
function ack(code, msg) {
  return httpXml('<xml><ErrCode>' + code + '</ErrCode><ErrMsg><![CDATA[' + msg + ']]></ErrMsg></xml>');
}

exports.main = async (event) => {
  const httpMode = isHttpMode(event);
  const body = httpMode ? String(event.body || event.Body || '') : '';

  // 闸 0：HTTP 模式下先验签（云函数模式没有 query 参数，此闸不适用）
  if (httpMode && !verifyPushHttp(event)) {
    console.error('[vp_deliver] 推送来源校验失败，已拒绝（疑似伪造通知）');
    return ack(1, 'invalid signature');
  }

  const eventName = httpMode ? extract(body, 'Event') : pick(event, 'Event');
  if (eventName !== 'xpay_goods_deliver_notify') {
    return ack(0, 'ignored');
  }

  // 闸①：推送只提供 outTradeNo 这一个线索
  const outTradeNo = httpMode ? extract(body, 'OutTradeNo') : pick(event, 'OutTradeNo');
  if (!outTradeNo) {
    return ack(1, 'bad notify: no OutTradeNo');
  }
  // 以下两个只用于日志比对，**不参与发货**（发货一律用订单落库的值）
  const pushOpenid = httpMode ? extract(body, 'OpenId') : pick(event, 'OpenId');
  const pushProductId = httpMode ? extract(body, 'ProductId') : pick(event, 'ProductId');
  const wxOrderId = httpMode
    ? extract(body, 'MchOrderNo')
    : (pick(event, 'WeChatPayInfo.MchOrderNo') || pick(event, 'MchOrderNo'));

  const db = cloud.database();
  try {
    const ord = await db.collection('vp_orders').where({ outTradeNo }).get();
    const order = (ord && ord.data && ord.data[0]) || null;
    if (!order) {
      // 下单时落库失败（vp_create_order 会打日志）。重试有意义（落库可能延迟），故返回 1。
      console.error('[vp_deliver] 找不到订单，未发货（下单落库失败？）:', outTradeNo);
      return ack(1, 'order not found');
    }

    // 闸③（前半）:已发货直接 ack，避免重复走查单与外呼
    if (order.status === 'delivered') {
      return ack(0, 'success');
    }

    if (pushOpenid && order.openid && pushOpenid !== order.openid) {
      console.warn('[vp_deliver] 推送 OpenId 与订单落库不一致，以订单为准:', pushOpenid, '→', order.openid, outTradeNo);
    }
    if (pushProductId && order.productId && pushProductId !== order.productId) {
      console.warn('[vp_deliver] 推送 ProductId 与订单落库不一致，以订单为准:', pushProductId, '→', order.productId, outTradeNo);
    }

    // 闸②：向微信确认真的已支付（云函数模式下这是唯一真伪防线）
    const paid = await verifyPaid(order.openid, outTradeNo);
    if (!paid) {
      console.error('[vp_deliver] 查单未确认已支付，未发货（疑似伪造推送/未支付订单直调）:', outTradeNo, 'openid:', order.openid);
      return ack(1, 'not paid');
    }

    // 闸③（后半）：CAS 认领发货权 —— 只把「我读到的那个状态」改成 delivered，
    // 并发/重复推送时 CAS 必然失败（updated=0），于是不再发货。
    const update = { status: 'delivered', deliverTime: db.serverDate() };
    if (wxOrderId) update.wxOrderId = wxOrderId;
    const claim = await db.collection('vp_orders')
      .where({ outTradeNo, status: order.status })
      .update({ data: update })
      .catch(e => { console.error('[vp_deliver] 订单 CAS 失败:', e && e.message); return { stats: { updated: 0 } }; });
    if (!(claim && claim.stats && claim.stats.updated === 1)) {
      return ack(0, 'success');   // 已被并发请求抢先发货
    }

    // 发货目标与道具一律取自订单落库值
    const out = await deliver(db, order.openid, order.productId);
    if (out.kind === 'unknown') {
      console.error('[vp_deliver] 订单道具未登记，未发货（需人工核对）:', outTradeNo, 'productId:', order.productId);
    }
  } catch (e) {
    // 异常时返回非 0，让平台重试
    return ack(1, (e && e.message) || 'err');
  }

  return ack(0, 'success');
};
