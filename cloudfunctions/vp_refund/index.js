// 虚拟支付·退款云函数（管理端，个人主体）
// 场景：
//   ① commission 页 9 折券「履约后退还差价」承诺的代码兑现 —— 定制履约完成后，
//      对用券订单按「全款 − 券后实付」的差额发起部分退款；
//   ② 全额退款（客诉 / 测试单冲正）。
//
// 调用方式（仅限作者本人，小程序端【没有】任何调用入口）：
//   云开发控制台 → 云函数 → vp_refund → 云端测试，event 传：
//   {
//     "adminKey":  "<与云函数环境变量 VP_ADMIN_KEY 相同的随机串>",
//     "outTradeNo": "T1779...",        // vp_orders 里的业务订单号（必传）
//     "refundFen":  660,               // 退款金额（分）；缺省 = 订单全额
//     "memo":       "9折券退差价"       // 备注，仅落库留痕
//   }
//
// 环境变量（云开发控制台配置，切勿写进代码）：
//   VP_APP_ID / VP_APP_SECRET / VP_APP_KEY  —— 与 vp_query/vp_deliver 同一套
//   VP_ADMIN_KEY                             —— 自定长随机串（管理口令，首次使用前必须配置）
//
// 微信侧协议（B 端，与 vp_query 同签名族）：
//   POST https://api.weixin.qq.com/xpay/refund_order?access_token=<AT>&pay_sig=<SIG>
//   pay_sig = HMAC-SHA256(AppKey, "/xpay/refund_order&" + postBody)   ← 键序/前缀与 query_order 完全一致
//   body: { openid, env: 0, wx_order_id, refund_order_id, refund_fee, refund_reason: 0 }
//   ⚠️ wx_order_id 必须传【微信支付交易单号 TransactionId】，不是我们的 outTradeNo
//      （2026-09-30 官方社区帖确认：传 outTradeNo 会报 268490002「数据不存在」）。
//      TransactionId 优先取 vp_orders.wxTransactionId（vp_deliver 发货时已落库），
//      没有时用 /xpay/query_order 现查补取。
//   本接口只是「启动退款任务」；终态以 xpay_refund_notify 推送为准（vp_deliver 已加
//   分支回写 refunded），也可用 query_order 轮询。
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
      // Buffer 累积后统一 utf8 解码，避免多字节汉字被分片截断（与 vp_deliver 同款）
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8')));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function postJSON(url, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8')));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// access_token 获取（与 vp_deliver.verifyPaid 同款）
async function getAccessToken(appid, secret) {
  const r = await getJSON('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + appid + '&secret=' + secret);
  if (!r || !r.access_token) throw new Error('access_token 获取失败: ' + ((r && r.errmsg) || ''));
  return r.access_token;
}

// 查单（顺带兜底补取 TransactionId）。签名路径/键序与 vp_deliver.verifyPaid 一致，勿改。
async function queryOrder(at, appKey, openid, outTradeNo) {
  const bodyObj = { openid, env: 0, order_id: outTradeNo };
  const postBody = JSON.stringify(bodyObj);
  const paySig = hmacSha256(appKey, '/xpay/query_order&' + postBody);
  return postJSON('https://api.weixin.qq.com/xpay/query_order?access_token=' + at + '&pay_sig=' + paySig, bodyObj);
}

exports.main = async (event) => {
  // ── 闸 0：管理口令（缺失/不匹配一律拒绝；小程序端没有入口，此闸防控制台泄露后的滥用）──
  const adminKey = env('VP_ADMIN_KEY');
  if (!adminKey) return { error: '未配置 VP_ADMIN_KEY 环境变量（首次使用前必须在云开发控制台配置）' };
  if (!event || event.adminKey !== adminKey) return { error: 'adminKey 校验失败' };

  const appid = env('VP_APP_ID');
  const secret = env('VP_APP_SECRET');
  const appKey = env('VP_APP_KEY');
  if (!appid || !secret || !appKey) {
    return { error: '服务端未配置虚拟支付参数（VP_APP_ID / VP_APP_SECRET / VP_APP_KEY）' };
  }

  const outTradeNo = event.outTradeNo ? String(event.outTradeNo) : '';
  if (!outTradeNo) return { error: '缺少 outTradeNo' };
  const memo = event.memo ? String(event.memo).slice(0, 100) : '';

  const db = cloud.database();
  const ord = await db.collection('vp_orders').where({ outTradeNo }).get();
  const order = (ord && ord.data && ord.data[0]) || null;
  if (!order) return { error: '订单不存在: ' + outTradeNo };

  // ── 闸 1：状态机（幂等的核心）。只允许对已发货订单发起一次退款。──
  if (order.status === 'refunding') return { error: '该订单退款已在进行中（等 xpay_refund_notify 终态）' };
  if (order.status === 'refunded') return { error: '该订单已退款，拒绝重复退款' };
  if (order.status !== 'delivered') return { error: '订单状态为 ' + order.status + '，只允许对 delivered 订单退款' };

  // ── 闸 2：金额。缺省全额；显式传入必须为正且不超过实付。──
  const refundFen = (event.refundFen != null) ? Math.floor(Number(event.refundFen)) : Number(order.priceFen);
  if (!Number.isFinite(refundFen) || refundFen <= 0) return { error: 'refundFen 必须为正整数（分）' };
  if (refundFen > Number(order.priceFen)) return { error: '退款金额 ' + refundFen + ' 超过实付 ' + order.priceFen };

  // ── 闸 3：向微信确认订单真的已支付（与发货同一道防线）──
  const at = await getAccessToken(appid, secret);
  const q = await queryOrder(at, appKey, order.openid, outTradeNo);
  if (!(q && q.errcode === 0 && (q.paid || q.order_state === 'PAID' || q.state === 2))) {
    return { error: '微信查单未确认已支付，拒绝退款', queryResp: q };
  }
  // TransactionId：优先落库值，查单响应兜底（多候选字段名）
  const wxOrderId = order.wxTransactionId
    || q.transaction_id || q.TransactionId || q.wx_order_id || '';
  if (!wxOrderId) {
    return { error: '拿不到微信支付交易单号（wxTransactionId），拒绝盲退；请在商户后台人工核对', queryResp: q };
  }

  // ── 启动退款任务 ──
  const refundOrderId = 'RF' + outTradeNo;   // 商户退款单号（唯一；重复启动会被微信侧拒，双保险）
  const refundBody = {
    openid: order.openid,
    env: 0,
    wx_order_id: wxOrderId,
    refund_order_id: refundOrderId,
    refund_fee: refundFen,
    refund_reason: 0                        // 0 = 无理由退款（官方合法值）
  };
  const refundPost = JSON.stringify(refundBody);
  const refundSig = hmacSha256(appKey, '/xpay/refund_order&' + refundPost);
  const resp = await postJSON(
    'https://api.weixin.qq.com/xpay/refund_order?access_token=' + at + '&pay_sig=' + refundSig,
    refundBody
  );

  // ── 回写（CAS：只允许从 delivered 跃迁，防并发双退）──
  if (resp && resp.errcode === 0) {
    await db.collection('vp_orders')
      .where({ outTradeNo, status: 'delivered' })
      .update({ data: {
        status: 'refunding',
        refundFen,
        refundOrderId,
        refundMemo: memo,
        refundStartTime: db.serverDate()
      } })
      .catch(e => console.error('[vp_refund] 状态回写失败（退款任务已启动，勿重复发起）:', e && e.message));
  }

  return {
    ok: !!(resp && resp.errcode === 0),
    outTradeNo,
    refundOrderId,
    refundFen,
    wxOrderId,
    resp,
    note: '启动成功 ≠ 退款完成：终态以 xpay_refund_notify 推送（vp_deliver 回写 refunded）或 query_order 轮询为准'
  };
};
