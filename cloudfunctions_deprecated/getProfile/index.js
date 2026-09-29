const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 返回当前用户的服务端解锁态（前端进入时拉取，作为权威判定）
exports.main = async () => {
  const openid = cloud.getWXContext().OPENID;
  const users = await db.collection('users').where({ openid }).get();
  const u = users.data[0] || { unlockedAll: false, phone: '' };
  return { openid, unlockedAll: !!u.unlockedAll, phone: u.phone || '' };
};
