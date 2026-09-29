// 虚拟支付·我的订单列表（个人主体）
// 订单中心页 pages/order/order 的数据来源。
// 关键：openid 由云开发自动注入（cloud.getWXContext().OPENID），前端**无需也不能**传 openid，
//      否则会沦为「任意用户可传他人 openid 查单」的越权接口。服务端按注入的 OPENID 查自己的单。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 道具展示名（与 utils/config.js 的 POINTS.packs / VIRTUAL_PAY / COMMISSION，
// 以及各 vp_* 云函数的 PRODUCTS 对齐）。仅用于订单列表展示，**不决定定价**
// （定价权在服务端 vp_create_order 的 PRODUCTS，前端/本函数传价均被忽略）。
// ⚠️ 改道具名时请同步这几处，但本映射不参与改价，故不进 test_constants_sync 的校验范围。
const ITEM_NAMES = {
  comic_full: '《美汐的故事》整本解锁',
  points_200: '200 积分包',
  points_800: '800 积分包',
  points_2500: '2500 积分包',
  comic_pdf: '画面感内容PDF',
  comic_web: '画面感内容HTML'
};

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// serverDate 在云函数侧是 Date 对象；服务端先格式化成展示串再回传，
// 避免客户端因时区/解析差异把时间显示错（与 vp_* 其它函数保持一致）。
function fmtTime(d) {
  const dt = (d && d instanceof Date) ? d : (d ? new Date(d) : null);
  if (!dt || isNaN(dt.getTime())) return '';
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())
    + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { error: '未获取到用户身份（OPENID 为空），请稍后重试', list: [] };

  const db = cloud.database();
  let list = [];
  try {
    const res = await db.collection('vp_orders')
      .where({ openid: OPENID })
      .orderBy('createTime', 'desc')
      .limit(100)
      .get();
    list = (res && res.data ? res.data : []).map(o => {
      const priceFen = Number(o.priceFen || 0);
      const status = o.status || 'pending';
      const statusText = status === 'delivered' ? '已支付'
        : status === 'pending' ? '支付处理中'
          : status === 'paid' ? '已支付'
            : status;
      return {
        outTradeNo: o.outTradeNo || '',
        productId: o.productId || '',
        productName: ITEM_NAMES[o.productId] || (o.productId || '未知商品'),
        amountText: '¥' + (priceFen / 100).toFixed(2),
        priceFen,
        status,
        statusText,
        timeText: fmtTime(o.createTime)
      };
    });
  } catch (e) {
    return { error: '查询订单失败：' + (e && e.message ? e.message : '未知错误'), list: [] };
  }
  return { openid: OPENID, list };
};
