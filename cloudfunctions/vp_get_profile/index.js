// 虚拟支付·解锁态查询云函数（个人主体）
// 前端购买成功后 / 阅读页 onShow 调用，向服务端校正解锁态（以发货推送为准，不依赖本地缓存）。
// openid 由云开发自动注入（cloud.getWXContext().OPENID），无需前端传入。
//
// 2026-09-18 扩展：顺带静默记录「用户访问」到 app_users 集合（openid 唯一标识，无需任何授权），
// 用于运营侧查看「有哪些用户使用过小程序」。个人信息只存 openid + 首次/最近访问时间 + 次数；
// 昵称/头像仅当用户**自愿**填写时才存（个人主体不能用手机号，头像昵称也只能用户手填）。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const db = cloud.database();
  const action = (event && event.action) || 'profile';

  // 静默记录访问（失败不影响主流程）
  await touchUser(db, OPENID);

  // 仅记录访问（启动时调用）：提前返回，省一次读
  if (action === 'touch') return { ok: true, openid: OPENID };

  // 用户自愿保存昵称/头像（头像昵称填写能力）→ 落到 app_users
  if (action === 'updateProfile') {
    const nickname = String((event && event.nickname) || '').trim().slice(0, 30);
    const avatar = String((event && event.avatar) || '').trim().slice(0, 500);
    if (OPENID && (nickname || avatar)) {
      const data = { updateTime: db.serverDate() };
      if (nickname) data.nickname = nickname;
      if (avatar) data.avatar = avatar;
      await db.collection('app_users').doc(OPENID).update({ data }).catch(() => {});
    }
    return { ok: true, openid: OPENID };
  }

  let unlockedAll = false;
  try {
    const r = await db.collection('vp_users').doc(OPENID).get();
    unlockedAll = !!(r.data && r.data.unlockedAll);
  } catch (e) {
    // 文档不存在等：视为未解锁
  }
  // 回带用户**自愿**填写的昵称/头像。
  // 2026-09-20 真机反馈：「头像和昵称，用户可以点选自己微信的，但这里没有同步」——
  // 根因就是这里：updateProfile 写进了 app_users，但查询接口从来不返回，
  // 前端保存后再进页面永远读到空值，「同步」断在读取这一环。失败不阻断解锁态查询。
  let nickname = '';
  let avatar = '';
  try {
    const p = await db.collection('app_users').doc(OPENID).get();
    if (p && p.data) {
      nickname = p.data.nickname || '';
      avatar = p.data.avatar || '';
    }
  } catch (e) {
    // 没填过资料 / 集合不存在：留空即可
  }
  return { openid: OPENID, unlockedAll, nickname, avatar };
};

// 记录/更新用户访问：app_users 以 openid 为 _id。集合不存在时自动创建后重试。
async function touchUser(db, openid) {
  if (!openid) return;
  const _ = db.command;
  const now = db.serverDate();
  const upsert = async () => {
    const ref = db.collection('app_users').doc(openid);
    const r = await ref.get().catch(() => ({ data: null }));
    if (r && r.data) {
      await ref.update({ data: { lastSeen: now, visits: _.inc(1) } });
    } else {
      await ref.set({ data: { openid, firstSeen: now, lastSeen: now, visits: 1 } });
    }
  };
  try {
    await upsert();
  } catch (e) {
    // 集合不存在 → 创建后重试一次
    try {
      await db.createCollection('app_users');
      await upsert();
    } catch (e2) {
      console.error('[vp_get_profile] 记录访问失败:', e2 && e2.message);
    }
  }
}
