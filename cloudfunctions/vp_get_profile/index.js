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
      // app_users 仍保留（含访问日志与历史资料，前端 loadProfile 读这里）
      await db.collection('app_users').doc(OPENID).update({ data }).catch(() => {});
      // 镜像到 vp_users（积分/权益总表）：管理员在云开发控制台看 vp_users 即可读到可读用户名/头像，
      // 不必再切到 app_users 拼 openid。详见 syncVpProfile 注释（关键：防覆盖积分）。
      await syncVpProfile(db, OPENID, nickname, avatar);
    }
    return { ok: true, openid: OPENID };
  }

  // 一次性回填（admin 在 IDE 云函数测试面板手动触发一次）：把 app_users 里**已填过**的昵称/头像
  // 同步到 vp_users。仅服务「本功能上线前就填过资料的老用户」——他们此前只写进了 app_users，
  // vp_users 里看不到。日常写入已由 updateProfile→syncVpProfile 自动镜像，无需重复跑。
  // ⚠️ app_users 超过 1000 条时需重复触发（云数据库单次 get 上限 1000）。
  if (action === 'backfillProfiles') {
    let synced = 0, skipped = 0;
    const list = await db.collection('app_users').limit(1000).get().catch(() => ({ data: [] }));
    for (const u of (list.data || [])) {
      const nickname = (u && u.nickname || '').toString().trim();
      const avatar = (u && u.avatar || '').toString().trim();
      if (!nickname && !avatar) { skipped++; continue; }
      await syncVpProfile(db, u._id || u.openid, nickname, avatar);
      synced++;
    }
    return { ok: true, synced, skipped, note: '若 app_users 超过 1000 条请重复触发本 action' };
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

// 把昵称/头像同步镜像到 vp_users（积分/权益总表，_id = openid）。
// 为什么单独镜像一份：管理员在云开发控制台看「有哪些用户」时默认看 vp_users（含积分），
// 此前昵称/头像只写在 app_users，vp_users 里全是 openid 看不出是谁。镜像后 admin 一眼可读。
//
// ⚠️ 绝不能 set 整个文档：vp_users 存着 points/coupons/signupBonusAt 等资产，set 会整体覆盖清空积分！
//    所以先 get 判断文档是否存在：存在 → 仅 update 两个字段；不存在（极罕见：填了资料却从没触发过签到
//    的新用户）→ 用最小安全默认值 set（此时确实还没积分，不会丢资产）。
async function syncVpProfile(db, openid, nickname, avatar) {
  if (!openid || (!nickname && !avatar)) return;
  const ref = db.collection('vp_users').doc(openid);
  const r = await ref.get().catch(() => ({ data: null }));
  const patch = { updateTime: db.serverDate() };
  if (nickname) patch.nickname = nickname;
  if (avatar) patch.avatar = avatar;
  if (r && r.data) {
    await ref.update({ data: patch }).catch(() => {});
  } else {
    await ref.set({
      data: Object.assign(
        { openid, points: 0, unlockedAll: false, coupons: [], lastDailyDate: '', dailyStreak: 0, signupBonusAt: 0, createTime: db.serverDate() },
        patch
      )
    }).catch(() => {});
  }
}

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
