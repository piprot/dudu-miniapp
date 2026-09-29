// 虚拟支付·查单兜底云函数（个人主体）
// 发货推送可能丢失，前端调本函数主动查单补发货。也可由定时任务每 5 分钟轮询 pending 订单。
// 环境变量：VP_APP_ID / VP_APP_SECRET / VP_APP_KEY
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

// 道具目录（服务端唯一权威，与 vp_create_order / vp_deliver 的 PRODUCTS、
// utils/config.js 的 POINTS.packs 保持一致；由 test/test_constants_sync.js 校验）。
const PRODUCTS = {
  comic_full:  { priceFen: 990,  kind: 'unlock' },
  points_200:  { priceFen: 600,  kind: 'points', points: 200 },
  points_800:  { priceFen: 1800, kind: 'points', points: 800 },
  points_2500: { priceFen: 5000, kind: 'points', points: 2500 },
  // 付费定制画面感内容（2026-09-18）：人工 8 小时交付，邮箱见 custom_comic_requests 集合
  comic_pdf:   { priceFen: 6600, kind: 'custom' },
  comic_web:   { priceFen: 8800, kind: 'custom' }
};

// 发货（与 vp_deliver 同语义）：按道具目录加积分/解锁；一律 update 合并，绝不 set 覆盖丢字段
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
  return { kind: 'unknown' };
}

exports.main = async (event) => {
  const appid = env('VP_APP_ID');
  const secret = env('VP_APP_SECRET');
  const appKey = env('VP_APP_KEY');
  const openid = event.openid;
  const orderId = event.outTradeNo;
  if (!appid || !secret || !appKey || !openid || !orderId) {
    return { error: '参数缺失（openid/outTradeNo 或服务端密钥未配置）' };
  }

  const tokenRes = await getJSON(
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + appid + '&secret=' + secret
  );
  if (!tokenRes.access_token) return { error: 'access_token 获取失败：' + (tokenRes.errmsg || '') };
  const accessToken = tokenRes.access_token;

  // B 端查单：pay_sig = HMAC-SHA256(AppKey, "/xpay/query_order&" + post_body)
  // ⚠️ pay_sig 的正确位置是 **URL 查询参数**（官方文档 api_query_order：
  //    ?access_token=...&pay_sig=...；请求体只含 openid/env/order_id）。
  //    放 HTTP header 或放 body 都会报 268490002「签名字段[pay_sig]为空」
  //    —— 2026-09-18 运行时探针实测两种错法各踩一次；桩单测验不出（桩不验真实接口字段位置）。
  //    签名内容 = 实际发出的原始 body 字符串（不含 pay_sig）。
  const bodyObj = { openid, env: 0, order_id: orderId };
  const postBody = JSON.stringify(bodyObj);
  const pay_sig = hmacSha256(appKey, '/xpay/query_order&' + postBody);

  const res = await postJSON(
    'https://api.weixin.qq.com/xpay/query_order?access_token=' + accessToken + '&pay_sig=' + pay_sig,
    {},
    bodyObj
  );

  // 查到已支付 → 补发货
  // ⚠️ 必须幂等：本函数由前端主动调用，用户可拿同一个 outTradeNo 反复调用。
  //    早期版本不判断订单状态就发货，导致「支付一次 → 无限刷积分」。
  //    做法与 points 的每日签到一致：乐观锁 CAS —— 只把「我读到的那个状态」改成 delivered，
  //    并发/重复调用时 CAS 必然失败（updated=0），于是不再发货。
  if (res && (res.errcode === 0) && (res.paid || res.order_state === 'PAID' || res.state === 2)) {
    const db = cloud.database();
    // 本单买的是什么道具：从 vp_orders 取下单时落库的 productId，
    // 避免早期版本"查单即解锁整本"（买积分包也会被解锁整本 / 发错货）。
    const ord = await db.collection('vp_orders').where({ outTradeNo: orderId }).get().catch(() => ({ data: [] }));
    const orderDoc = (ord && ord.data && ord.data[0]) || null;
    const productId = orderDoc ? (orderDoc.productId || '') : '';

    // 已发过货 → 直接返回，绝不重复发货
    if (orderDoc && orderDoc.status === 'delivered') {
      return { paid: true, already: true, kind: 'skipped', productId };
    }

    if (orderDoc) {
      const prevStatus = orderDoc.status;
      const claim = await db.collection('vp_orders')
        .where({ outTradeNo: orderId, status: prevStatus })
        .update({ data: { status: 'delivered', deliverTime: db.serverDate() } })
        .catch(e => { console.error('[vp_query] 订单 CAS 失败:', e && e.message); return { stats: { updated: 0 } }; });
      if (!(claim && claim.stats && claim.stats.updated === 1)) {
        // 被并发请求抢先发货 → 本次不再发货
        return { paid: true, already: true, kind: 'skipped', productId };
      }
    }
    // 订单记录缺失（下单时落库失败）→ productId 为空，deliver 会判 unknown 并要求人工核对
    const out = await deliver(db, openid, productId);
    if (out.kind === 'unknown') {
      console.error('[vp_query] 已支付但无法确定道具（订单缺 productId？），未发货，需人工核对:', orderId, 'openid:', openid);
      return { paid: true, kind: 'unknown', productId, needManual: true };
    }
    return { paid: true, kind: out.kind, points: out.points || 0, productId };
  }
  return { paid: false, raw: res };
};
