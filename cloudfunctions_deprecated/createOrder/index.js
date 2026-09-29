const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const crypto = require('crypto');
const https = require('https');

// ===== 商户密钥从云开发「环境变量」读取，切勿硬编码/提交到仓库 =====
// 在云开发控制台 -> 环境变量 配置：WX_APPID / WX_MCHID / WX_SERIAL / WX_PRIVATE_KEY(换行用 \n) / WX_API_V3_KEY / WX_NOTIFY_URL
const APPID = process.env.WX_APPID || 'YOUR_APPID';
const MCHID = process.env.WX_MCHID || 'YOUR_MCHID';
const SERIAL = process.env.WX_SERIAL || 'YOUR_CERT_SERIAL';
const PRIVATE_KEY = (process.env.WX_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const API_V3_KEY = process.env.WX_API_V3_KEY || 'YOUR_APIV3_KEY';
const NOTIFY_URL = process.env.WX_NOTIFY_URL || 'https://your-domain.com/api/comic/notify';

function nonceStr() { return crypto.randomBytes(16).toString('hex'); }

// 商户证书签名（微信支付 v3）
function buildSignature(method, urlPath, body, nonce, timestamp) {
  const msg = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  return crypto.createSign('RSA-SHA256').update(msg).sign(PRIVATE_KEY, 'base64');
}

exports.main = async (event) => {
  const { price, openid } = event;
  const wxContext = cloud.getWXContext();
  const realOpenid = openid || wxContext.OPENID;
  const amount = Math.round(price * 100); // 单位：分
  const outTradeNo = 'COMIC' + Date.now() + Math.floor(Math.random() * 1000);
  const body = JSON.stringify({
    appid: APPID,
    mchid: MCHID,
    description: '美汐的故事·整本',
    out_trade_no: outTradeNo,
    notify_url: NOTIFY_URL,
    amount: { total: amount, currency: 'CNY' },
    payer: { openid: realOpenid }
  });

  const nonce = nonceStr();
  const ts = Math.floor(Date.now() / 1000).toString();
  const urlPath = '/v3/pay/transactions/jsapi';
  const sig = buildSignature('POST', urlPath, body, nonce, ts);
  const authorization =
    `WECHATPAY2-SHA256-RSA2048 mchid="${MCHID}",nonce_str="${nonce}",signature="${sig}",timestamp="${ts}",serial_no="${SERIAL}"`;

  const resp = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.mch.weixin.qq.com',
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: authorization }
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (!resp.prepay_id) throw new Error('统一下单失败: ' + JSON.stringify(resp));

  // 组装前端 wx.requestPayment 所需参数（JSAPI）
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const np = nonceStr();
  const pkg = 'prepay_id=' + resp.prepay_id;
  const paySignMsg = `${APPID}\n${timeStamp}\n${np}\n${pkg}\n`;
  const paySign = crypto.createSign('RSA-SHA256').update(paySignMsg).sign(PRIVATE_KEY, 'base64');

  await db.collection('orders').add({
    data: { outTradeNo, openid: realOpenid, total: amount, status: 'pending', createdAt: Date.now() }
  });

  return { timeStamp, nonceStr: np, package: pkg, signType: 'RSA', paySign };
};
