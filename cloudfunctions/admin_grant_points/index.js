// admin_grant_points —— 一次性测试积分充值（2026-10-07）
//
// ⚠️⚠️ 临时管理函数，仅供开发期给**调用者自己**充值，充完应删除 ⚠️⚠️
//
// 设计要点：
//   身份用 cloud.getWXContext().OPENID（云开发自动注入，前端无法伪造），
//   所以**不给 openid 传参的余地**——谁调用就只能给自己加分，天然防越权。
//   这样也就不需要 token 环境变量、不需要手动查自己的 openid。
//
// 幂等：余额已达 targetPoints 时直接拒绝，避免重复点把分数刷高。
// 幂等键 targetPoints 由调用方传（如 1000），已达标就不再加。
//
// 只更新 points + updateTime，不碰 coupons / lastDailyDate /
// dailyStreak / signupBonusAt，避免破坏签到、新人礼、兑换逻辑。
//
// 调用：
//   wx.cloud.callFunction({ name:'admin_grant_points',
//     data:{ amount:1000, mode:'add', targetPoints:1000 } })
//   → { ok:true, openid, before, after, delta }
'use strict';
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const e = event || {};
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID || '';
  if (!openid) return { ok: false, err: '未获取到用户身份（openid）' };

  const db = cloud.database();

  const mode = e.mode === 'set' ? 'set' : 'add';
  const amount = Math.floor(Number(e.amount) || 0);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, err: 'amount 必须为正整数' };

  const target = Math.floor(Number(e.targetPoints) || 0); // 幂等阈值

  const ref = db.collection('vp_users').doc(openid);
  let doc = null;
  try {
    const r = await ref.get();
    doc = (r && r.data) || null;
  } catch (e0) {
    doc = null;
  }
  const before = doc && typeof doc.points === 'number' ? doc.points : 0;

  // 幂等：已达目标余额则拒绝重复充值
  if (target > 0 && before >= target) {
    return { ok: false, err: '已达目标余额(' + before + ')，拒绝重复充值', openid, before, after: before };
  }

  const after = mode === 'set' ? amount : before + amount;
  if (after < 0) return { ok: false, err: '结果余额为负，拒绝', openid, before };

  await ref.set({
    data: Object.assign(
      { points: after, updateTime: db.serverDate() },
      doc ? {} : { openid, unlockedAll: false, coupons: [], createTime: db.serverDate() }
    )
  });

  return { ok: true, openid, mode, before, after, delta: after - before };
};