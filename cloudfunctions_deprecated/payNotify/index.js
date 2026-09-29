const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const crypto = require('crypto');

// APIv3 密钥（与 createOrder 同源，从环境变量读取）
const API_V3_KEY = process.env.WX_API_V3_KEY || 'YOUR_APIV3_KEY';

// 解密微信支付回调通知（AES-256-GCM）
function decryptResource(resource) {
  const { ciphertext, nonce, associated_data } = resource;
  const buf = Buffer.from(ciphertext, 'base64');
  const authTag = buf.slice(buf.length - 16);
  const data = buf.slice(0, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', API_V3_KEY, nonce);
  decipher.setAuthTag(authTag);
  if (associated_data) decipher.setAAD(Buffer.from(associated_data));
  const decoded = decipher.update(data, 'binary', 'utf8') + decipher.final('utf8');
  return JSON.parse(decoded);
}

// 该函数需以「HTTP 触发」方式部署（云函数 HTTP 触发 / 云托管），并将触发地址配置为商户平台 notify_url
exports.main = async (event) => {
  let body = event;
  if (typeof event.body === 'string') {
    try { body = JSON.parse(event.body); } catch (e) { body = event; }
  }
  const resource = body.resource;
  if (!resource) return { code: 'FAIL', message: '无 resource' };

  const res = decryptResource(resource);
  if (res.trade_state === 'SUCCESS') {
    const outTradeNo = res.out_trade_no;
    const orders = await db.collection('orders').where({ outTradeNo }).get();
    if (orders.data.length) {
      const o = orders.data[0];
      await db.collection('orders').doc(o._id).update({ data: { status: 'paid', paidAt: Date.now() } });
      await db.collection('users').where({ openid: o.openid }).update({ data: { unlockedAll: true } });
    }
  }
  // 微信要求返回 200 + {code:'SUCCESS'} 才认为通知成功
  return { code: 'SUCCESS', message: '成功' };
};
