// 虚拟支付·下单云函数（个人主体）
// 负责：拿 sessionKey、生成 outTradeNo、构造 signData、双签名，返回给前端拉起 wx.requestVirtualPayment
// 环境变量（云开发控制台→环境变量，切勿写进代码）：
//   VP_APP_ID / VP_APP_SECRET / VP_OFFER_ID / VP_APP_KEY
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ─────────────────────────────────────────────────────────────
// 道具目录（服务端唯一权威）：前端只能传 productId，**价格一律由服务端决定**。
// 早期版本直接采信前端传的 priceFen，等于把定价权交给了客户端（可传 goodsPrice=1 白拿），
// 多档不同价的积分包上线后风险放大，故此处收口：未登记的 productId 直接拒绝。
// ⚠️ 与 vp_deliver / vp_query 的 PRODUCTS、utils/config.js 的 POINTS.packs 必须同步
//    （由 test/test_constants_sync.js 自动校验四处一致）。
// 注：goodsPrice 仍须与 MP 后台道具价格完全一致，否则微信侧会拒单。
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
function genOutTradeNo() {
  // 8-32 位，不能以 _ 开头；T + 时间戳 + 随机
  return 'T' + Date.now() + Math.floor(Math.random() * 1e6);
}

exports.main = async (event) => {
  const appid = env('VP_APP_ID');
  const secret = env('VP_APP_SECRET');
  const offerId = env('VP_OFFER_ID');
  const appKey = env('VP_APP_KEY');

  // 只认 productId，价格取服务端目录；忽略前端传入的 priceFen（防篡改）。
  // ⚠️ 2026-09-24 起：整本解锁 comic_full 已随原生阅读器下架，不再作为默认商品。
  //   新购路径（commission 的 comic_pdf/comic_web、积分充值包）均显式传 productId，
  //   故 productId 改为【必传】——缺失即拒，避免静默生成已下架道具的订单。
  //   （comic_full 仍保留在 PRODUCTS 中，仅用于已付费老用户的兜底发货/解锁，不新增售卖入口。）
  const productId = (event && event.productId) ? String(event.productId) : '';
  if (!productId) return { error: '缺少 productId：下单必须显式指定道具' };
  const item = PRODUCTS[productId];
  if (!item) return { error: '未知道具：' + productId };
  const priceFen = item.priceFen;
  if (event && event.priceFen != null && Number(event.priceFen) !== priceFen) {
    console.warn('[vp_create_order] 前端传价与服务端目录不一致，已按服务端价下单:', event.priceFen, '→', priceFen, productId);
  }

  if (!appid || !secret || !offerId || !appKey) {
    return { error: '服务端未配置虚拟支付参数（VP_APP_ID / VP_APP_SECRET / VP_OFFER_ID / VP_APP_KEY）' };
  }

  // 1) 用 wx.login 的 code 换 sessionKey（用于用户态签名 signature）
  const sess = await getJSON(
    'https://api.weixin.qq.com/sns/jscode2session?appid=' + appid +
    '&secret=' + secret + '&js_code=' + event.code + '&grant_type=authorization_code'
  );
  if (!sess.openid || !sess.session_key) {
    return { error: '登录态获取失败：' + (sess.errmsg || 'unknown') };
  }
  const openid = sess.openid;
  const sessionKey = sess.session_key;

  // 2) 构造 signData（键顺序固定，字符串需与前端发出的一致）
  const outTradeNo = genOutTradeNo();
  const signDataObj = {
    offerId: offerId,
    buyQuantity: 1,
    env: 0,
    currencyType: 'CNY',
    productId: productId,
    goodsPrice: priceFen,
    outTradeNo: outTradeNo,
    attach: openid            // 发货推送时原样回传，用于定位用户
  };
  const signData = JSON.stringify(signDataObj); // 这就是「post_body」

  // 3) 双签名
  //    paySig（服务端，AppKey）：HMAC-SHA256(AppKey, "requestVirtualPayment&" + signData)
  //    signature（用户态，sessionKey）：HMAC-SHA256(sessionKey, signData)
  const paySig = hmacSha256(appKey, 'requestVirtualPayment&' + signData);
  const signature = hmacSha256(sessionKey, signData);

  // 4) 落库（pending），发货推送到达后更新为 delivered
  // 注意：这条记录是「本单买的是什么道具」的唯一凭据，vp_query 兜底查单靠它发货，
  //       所以写失败必须留痕（早期静默 catch 会导致补发货时找不到商品）。
  const db = cloud.database();
  let orderLogged = true;
  await db.collection('vp_orders').add({
    data: { outTradeNo, openid, productId, priceFen, status: 'pending', createTime: db.serverDate() }
  }).catch(e => {
    orderLogged = false;
    console.error('[vp_create_order] vp_orders 落库失败（不影响拉起支付，但兜底查单将无法判断道具）:', e && e.message);
  });

  return { signData, mode: 'short_series_goods', paySig, signature, productId, priceFen, orderLogged, outTradeNo };
};
