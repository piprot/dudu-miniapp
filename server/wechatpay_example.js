/**
 * 微信支付（JSAPI v2 统一下单）示例 —— 个体户/企业商户号就绪后启用
 *
 * 这是「方式一·微信支付」的后端参考实现。小程序前端 wx.requestPayment 需要的参数
 * （timeStamp / nonceStr / package / signType / paySign）由本接口返回。
 *
 * 前置条件（个人主体不具备，必须升级为个体户或企业）：
 *   1. 微信公众平台注册【小程序】（企业/个体户主体）并拿到 AppID
 *   2. 开通【微信支付】，拿到 商户号 mchid、商户 API 密钥 key（32位）
 *   3. 在小程序后台「开发 -> 开发设置」配置 request 合法域名（你的服务器域名）
 *   4. 用户在小程序内通过 wx.login 拿到 code -> 换 openid（下方示例）
 *
 * ⚠️ 以下均为占位符，切勿填入真实密钥后提交到公开仓库。
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const APPID = 'YOUR_WX_APPID';          // 小程序 AppID
const MCHID = 'YOUR_MCH_ID';            // 微信支付商户号
const API_KEY = 'YOUR_API_KEY_32BIT';   // 商户 API 密钥（商户平台设置）
const NOTIFY_URL = 'https://your-domain.com/api/comic/notify'; // 支付结果回调

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function randomStr(len = 32) {
  return crypto.randomBytes(len / 2).toString('hex');
}

// 生成 JSAPI 支付签名（MD5，统一下单与前端调起一致）
function sign(params) {
  const sorted = Object.keys(params).filter(k => params[k] !== '' && params[k] !== undefined)
    .sort().map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHash('md5').update(sorted + '&key=' + API_KEY).digest('hex').toUpperCase();
}

// 将对象转为微信 XML
function toXml(obj) {
  let xml = '<xml>';
  for (const k in obj) xml += `<${k}>${obj[k]}</${k}>`;
  return xml + '</xml>';
}

// 用 code 换 openid（生产请用 HTTPS + 服务端缓存 session）
async function getOpenid(code) {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=YOUR_APP_SECRET&js_code=${code}&grant_type=authorization_code`;
  const r = await axios.get(url);
  return r.data.openid;
}

// 统一下单接口：前端 pay.js 中 PAY_CONFIG.orderApi 指向这里
app.post('/api/comic/order', async (req, res) => {
  try {
    const { price, code } = req.body;           // price 单位：元（示例按整本）
    const openid = await getOpenid(code);
    const nonceStr = randomStr();
    const outTradeNo = 'COMIC' + Date.now();    // 商户订单号（需唯一，建议落库）
    const totalFee = Math.round(price * 100);   // 分

    const params = {
      appid: APPID,
      mch_id: MCHID,
      nonce_str: nonceStr,
      body: '美汐的故事·整本',
      out_trade_no: outTradeNo,
      total_fee: totalFee,
      spbill_create_ip: req.ip,
      notify_url: NOTIFY_URL,
      trade_type: 'JSAPI',
      openid
    };
    params.sign = sign(params);

    const { data } = await axios.post('https://api.mch.weixin.qq.com/pay/unifiedorder', toXml(params), {
      headers: { 'Content-Type': 'text/xml' },
      responseType: 'text'
    });
    // 解析返回中的 prepay_id（此处省略 XML 解析，生产请补全）
    const prepayId = data.match(/<prepay_id><!\[CDATA\[(.*?)\]\]><\/prepay_id>/)?.[1];
    if (!prepayId) return res.json({ err: 'unifiedorder failed' });

    // 组装前端 wx.requestPayment 所需参数
    const payParams = {
      appId: APPID,
      timeStamp: String(Math.floor(Date.now() / 1000)),
      nonceStr: randomStr(),
      package: 'prepay_id=' + prepayId,
      signType: 'MD5'
    };
    payParams.paySign = sign(payParams);

    res.json(payParams);
  } catch (e) {
    res.status(500).json({ err: e.message });
  }
});

// 支付结果回调（微信异步通知，需校验签名 + 处理幂等 + 标记订单已支付）
app.post('/api/comic/notify', (req, res) => {
  // TODO: 校验签名、更新订单状态、返回 <xml><return_code><![CDATA[SUCCESS]]></return_code></xml>
  res.send('<xml><return_code><![CDATA[SUCCESS]]></return_code></xml>');
});

app.listen(3000, () => console.log('comic pay server on :3000'));
