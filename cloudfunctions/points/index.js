// 积分账本云函数（个人主体 · 基于 openid）
// 职责：余额查询(balance) + 花费(spend) + 每日登录奖励(daily) + 新人礼(daily 内附带)。赚取(earn) 不放这里——
// 必须由 ai_gen 在「真实调通模型」后由服务端记账，客户端无法伪造。
//
// 存储：云数据库集合 vp_users（文档 _id = openid），字段：
//   points(Number) / coupons(Array) / lastDailyDate(String 'YYYY-MM-DD') / dailyStreak(Number)
//   signupBonusAt(Number) —— 新人礼领取时间戳，**0 = 未领**（见下方 SIGNUP）
//
// 余额与花费用 db.command.inc 原子增减，避免并发丢更新。
//
// 调用：
//   { action: 'balance' }                              → { ok, points, coupons }
//   { action: 'spend', reason, delta, grant }          → { ok, points, delta:-N }（余额不足返回 ok:false）
//     reason: 兑换项 id（如 'comic_discount'）；delta: 花费积分数(正)；grant: 要写入 coupons 的权益对象
//   { action: 'daily' }                                → { ok, awarded, signupBonus, points, streak, already? }
//     每日登录奖励：客户端可重复调用，服务端按「北京时间自然日」只发一次（幂等 + CAS 防并发）。
//     新人礼也走这个 action（详见 claimSignup 注释）：**每人一次性**，与「每日奖励是否开启」无关。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ── 新人礼（首次进入小程序一次性赠送）──
// 用户拍板（2026-09-19 原 100；2026-09-23 降为 80）：每个用户刚登录就送 80 积分。
// ⚠️ 与 utils/config.js 的 POINTS.signupBonus 保持一致（云函数跨包 require 前端 config 不可靠，
//    故此处独立一份，改数值时两处必须同改）；test_constants_sync.js 第 19 条会校验。
const SIGNUP = {
  enabled: true,
  amount: 80            // 一次性赠送积分数（2026-09-23 由 100 降为 80）
};

// ── 每日登录奖励规则 ──
// ⚠️ 与 utils/config.js 的 POINTS.daily 保持一致：云函数跨包 require 前端 config 不可靠，故此处独立一份，
//    改数值时两处必须同改。
const DAILY = {
  enabled: true,
  base: 30,             // 每日基础积分（连签第 1 天）——用户拍板（2026-09-23 调整 base 30）
  streakCap: 10,        // 连签加成：每多签一天 +1，封顶 +10（第 11 天起固定 40/天，防长尾通胀）
  milestoneEvery: 7,    // 每连续 N 天算一个里程碑
  milestoneBonus: 15    // 里程碑额外奖励
};

// ── 积分兑换目录成本（服务端权威）──
// ⚠️ 与 utils/config.js 的 POINTS.redeem[].cost 保持一致：云函数跨包 require 前端 config 不可靠，故此处独立一份，
//    改数值时两处必须同改；test_constants_sync.js 第 22 条会校验两者一致。
// 作用（2026-09-23 新增）：spend 时服务端强制 `delta === REDEEM[reason]`，防止被篡改的客户端传
//    { reason:'comic_discount', delta:1 } 用 1 积分换走 200 分的券（此前服务端只校验「余额够 + 不重复」，不校验成本）。
const REDEEM = {
  comic_discount: 200    // 画面感内容 9 折券（2026-09-23 由 100 升为 200）
};

// ── 端内产出型工具扣费（服务端权威成本表，2026-10-01 重做后所有生成动作走积分）──
// ⚠️ 与 utils/config.js 的 POINTS.cost 保持一致：云函数跨包 require 前端 config 不可靠，故此处独立一份，
//    改数值时两处必须同改（test_constants_sync.js 也会校验前端 config 与这里一致）。
// 前端 utils/charge.js 的 charge(action) 直接以 action 名作为 reason、以 POINTS.cost[action] 作为 delta 调本 action；
//    此前 spend 只认 REDEEM（兑换权益），导致 optFormat/momentsGen/comicGen/cardGen/posterGen 全部被拒
//    → 前端统一报「积分扣除失败，请重试」（2026-10-02 真机反馈）。补上生成类 reason 即闭环。
// generation 只扣积分、不写任何权益（grant 忽略）。
const GEN_COST = {
  momentsGen: 20,    // 套模板出文案（需与 config.POINTS.cost.momentsGen 一致）
  optFormat: 2,      // 排版优化（防折叠/加 emoji/分段，每次应用）
  comicGen: 20,      // 分镜编辑器·生成分镜
  cardGen: 20,       // 卡片制作·生成卡片
  posterGen: 20      // 海报长图·生成海报
};

const DAY_MS = 86400000;
const CN_OFFSET_MS = 8 * 3600 * 1000;   // 北京时间 UTC+8

// 时间戳 → 北京时间的自然日键（'YYYY-MM-DD'）
function dayKeyCN(ts) {
  return new Date(ts + CN_OFFSET_MS).toISOString().slice(0, 10);
}

// 连签第 streak 天的奖励 = 基础 + 连签加成(封顶) (+ 里程碑奖励)
function dailyReward(streak) {
  const bonus = Math.min(Math.max(streak - 1, 0), Math.max(DAILY.streakCap, 0));
  let reward = DAILY.base + bonus;
  if (DAILY.milestoneEvery > 0 && streak % DAILY.milestoneEvery === 0) reward += DAILY.milestoneBonus;
  return reward;
}

function openidOf() {
  const c = cloud.getWXContext();
  return (c && c.OPENID) || '';
}

// 读取用户文档；不存在返回 null
async function getDoc(db, openid) {
  const r = await db.collection('vp_users').doc(openid).get().catch(() => ({ data: null }));
  return (r && r.data) ? r.data : null;
}

// 原子加分（earn 用，仅供同服务端的 ai_gen 间接走；本函数不对外暴露 earn action）
async function award(db, openid, delta) {
  const _ = db.command;
  const ref = db.collection('vp_users').doc(openid);
  const doc = await getDoc(db, openid);
  if (!doc) {
    await ref.set({ data: { openid, points: delta, unlockedAll: false, coupons: [], createTime: db.serverDate() } });
  } else {
    const data = { points: _.inc(delta), updateTime: db.serverDate() };
    if (!Array.isArray(doc.coupons)) data.coupons = [];
    await ref.update({ data });
  }
  const after = await getDoc(db, openid);
  return after ? after.points : delta;
}

// 保证用户文档存在，且 lastDailyDate(string) / dailyStreak(number) / signupBonusAt(number) 字段存在——
// 每日领取与新人礼都用「读到什么就 CAS 什么」的乐观锁，字段缺失会导致 where 匹配不上而误判「已领/已送」。
//
// ⚠️ 语义提示（有意为之，非 bug）：老用户文档本来没有 signupBonusAt，这里会补成 0 = 未领，
//    因此**存量用户下次进入时也会收到这份新人礼**。这是「每个用户都送一次」的字面实现；
//    若日后要改成「只送功能上线后注册的用户」，判据应换成 createTime 与上线时间比较，而不是改这里的默认值。
async function ensureUser(db, openid) {
  const ref = db.collection('vp_users').doc(openid);
  let doc = await getDoc(db, openid);
  if (!doc) {
    doc = { openid, points: 0, unlockedAll: false, coupons: [], lastDailyDate: '', dailyStreak: 0, signupBonusAt: 0, createTime: db.serverDate() };
    await ref.set({ data: doc });
    return doc;
  }
  const patch = {};
  if (typeof doc.lastDailyDate !== 'string') patch.lastDailyDate = '';
  if (typeof doc.dailyStreak !== 'number') patch.dailyStreak = 0;
  if (typeof doc.signupBonusAt !== 'number') patch.signupBonusAt = 0;
  if (Object.keys(patch).length) {
    await ref.update({ data: patch });
    doc = Object.assign({}, doc, patch);
  }
  return doc;
}

// ── 新人礼：每个用户一次性赠送（幂等 + CAS 乐观锁）──
// 为什么必须做 CAS、而不能「读到没领过就送」：
//   本函数被 index 页 onShow 触发（maybeDailyCheckin），前端可被**无限重放**——
//   用户反复进出首页、并发请求同时到达时，两个请求都可能读到「signupBonusAt 尚为 0」，
//   各自 inc 一次 100 ⇒ 同一用户被重复赠分。CAS 把写入条件锁在「读到的那份旧值上」，
//   并发下只有一个能 updated=1，另一个拿到 0 后按"已领"返回，绝不重复发放。
// 与 DAILY.enabled 解耦：签到开关关掉也照发，新人礼不是"每日奖励"的一部分。
//
// 返回 { awarded }：awarded=SIGNUP.amount 表示本次真送出；0 表示已领过/未开启/并发被抢。
async function claimSignup(db, openid, doc) {
  if (!SIGNUP.enabled) return { awarded: 0, enabled: false };
  // 已领过（signupBonusAt 为真值）→ 连 CAS 请求都不必发，直接返回，省一次写
  if (doc && doc.signupBonusAt) return { awarded: 0, already: true };

  const _ = db.command;
  const res = await db.collection('vp_users')
    .where({ _id: openid, signupBonusAt: 0 })
    .update({ data: { points: _.inc(SIGNUP.amount), signupBonusAt: Date.now(), updateTime: db.serverDate() } })
    .catch(e => { console.error('[points] 新人礼 CAS 失败:', e && e.message); return { stats: { updated: 0 } }; });

  if (!(res && res.stats && res.stats.updated === 1)) {
    // 已被另一个并发请求领走（或文档不存在）→ 不发放
    return { awarded: 0, already: true };
  }
  return { awarded: SIGNUP.amount };
}

// 每日登录奖励 + 新人礼：幂等 + 乐观锁（CAS）
// 返回 { ok, awarded, signupBonus, points, streak, today, already?, milestone? }
// 注意 awarded 与 signupBonus 是**两笔独立的分**：awarded=当日签到，signupBonus=一次性新人礼（0 表示没有）。
// 前端提示要**分别标出各自金额**（如「新人礼 +100，签到 +20」），不要合并成一个总数——
// 用户分不清哪笔是签到、哪笔是新人礼。
async function doDaily(db, openid) {
  const _ = db.command;
  const doc = await ensureUser(db, openid);
  const now = Date.now();
  const today = dayKeyCN(now);
  const yesterday = dayKeyCN(now - DAY_MS);
  let curPoints = typeof doc.points === 'number' ? doc.points : 0;

  // ① 新人礼（一次性）。**放在 DAILY.enabled 判断之前**——第一次进门就该拿到，
  //    不能因为"签到开关被关掉"就把新人礼也一起吞了（两者是独立的激励）。
  const gift = await claimSignup(db, openid, doc);
  const signupBonus = gift.awarded || 0;
  if (signupBonus) curPoints += signupBonus;

  // ② 每日登录奖励
  if (!DAILY.enabled) {
    return { ok: true, awarded: 0, enabled: false, signupBonus, points: curPoints, streak: doc.dailyStreak || 0, today };
  }

  // 今日已领 → 直接返回（客户端重复调用 / 反复进页面都只发一次）
  if (doc.lastDailyDate === today) {
    return { ok: true, awarded: 0, already: true, signupBonus, points: curPoints, streak: doc.dailyStreak || 0, today };
  }

  // 昨天领过 → 连签 +1；否则（首次或断签）重置为 1
  const streak = doc.lastDailyDate === yesterday ? (doc.dailyStreak || 0) + 1 : 1;
  const awarded = dailyReward(streak);
  const milestone = DAILY.milestoneEvery > 0 && streak % DAILY.milestoneEvery === 0;

  // CAS：仅当 lastDailyDate 仍是读到的旧值时才写入 → 并发下只有一个请求能成功
  const res = await db.collection('vp_users')
    .where({ _id: openid, lastDailyDate: doc.lastDailyDate })
    .update({ data: { points: _.inc(awarded), lastDailyDate: today, dailyStreak: streak, updateTime: db.serverDate() } })
    .catch(e => { console.error('[points] daily CAS 失败:', e && e.message); return { stats: { updated: 0 } }; });

  if (!(res && res.stats && res.stats.updated === 1)) {
    // 已被另一个并发请求领走 → 按"今日已领"返回，绝不重复发放。
    // 余额以重读为准（里面含本次刚发的新人礼），不自己算加减。
    const after = await getDoc(db, openid);
    return {
      ok: true, awarded: 0, already: true, signupBonus,
      points: after && typeof after.points === 'number' ? after.points : curPoints,
      streak: after && typeof after.dailyStreak === 'number' ? after.dailyStreak : (doc.dailyStreak || 0),
      today
    };
  }

  return { ok: true, awarded, signupBonus, points: curPoints + awarded, streak, today, milestone };
}

exports.main = async (event) => {
  const openid = openidOf();
  if (!openid) return { ok: false, err: '未获取到用户身份（openid）' };
  const action = (event && event.action) || 'balance';
  const db = cloud.database();

  if (action === 'balance') {
    const doc = await getDoc(db, openid);
    return {
      ok: true,
      points: doc && typeof doc.points === 'number' ? doc.points : 0,
      coupons: Array.isArray(doc && doc.coupons) ? doc.coupons : []
    };
  }

  if (action === 'daily') {
    return await doDaily(db, openid);
  }

  if (action === 'spend') {
    const reason = (event && event.reason) || '';
    const delta = Math.floor(Number(event && event.delta) || 0);
    if (delta <= 0) return { ok: false, err: 'delta 必须为正整数' };

    // ── ① 端内产出型工具扣费（2026-10-01 重做后所有生成动作走积分）──
    // 服务端权威成本表 GEN_COST（与 utils/config.js POINTS.cost 同源，独立一份）。
    // generation 只扣积分、不写权益（grant 忽略）。沿用余额原子扣减 + 不足拦截。
    if (Object.prototype.hasOwnProperty.call(GEN_COST, reason)) {
      if (delta !== GEN_COST[reason]) {
        return { ok: false, err: '扣费成本不符（' + reason + ' 应为 ' + GEN_COST[reason] + ' 积分，收到 ' + delta + '）' };
      }
      const _ = db.command;
      const doc = await getDoc(db, openid);
      const cur = doc && typeof doc.points === 'number' ? doc.points : 0;
      if (cur < delta) return { ok: false, err: '积分不足', points: cur };
      await db.collection('vp_users').doc(openid).update({ data: { points: _.inc(-delta), updateTime: db.serverDate() } });
      const after = await getDoc(db, openid);
      return { ok: true, points: after && typeof after.points === 'number' ? after.points : cur - delta, delta: -delta };
    }

    // ── ② 兑换权益（coupon grant）：沿用既有 REDEEM 校验 ──
    // 服务端权威校验兑换项与成本（2026-09-23）：只认登记过的 reason，且 delta 必须**等于**登记成本。
    // 否则被篡改的客户端可传 { reason:'comic_discount', delta:1 } 用 1 积分换走 200 分的券。
    if (!Object.prototype.hasOwnProperty.call(REDEEM, reason)) {
      return { ok: false, err: '未知兑换项: ' + reason };
    }
    if (delta !== REDEEM[reason]) {
      return { ok: false, err: '兑换成本不符（' + reason + ' 应为 ' + REDEEM[reason] + ' 积分，收到 ' + delta + '）' };
    }
    const _ = db.command;
    const doc = await getDoc(db, openid);
    const cur = doc && typeof doc.points === 'number' ? doc.points : 0;
    if (cur < delta) return { ok: false, err: '积分不足', points: cur };
    const grant = event && event.grant;
    // 服务端兜底去重：同一权益（grant.type）只允许持有一张。
    // 前端也会置灰「已拥有」，但前端可被绕过（直接调云函数就是重复扣分白买），
    // 所以真正的约束放在这里（2026-09-20：兑换链路接续整治的一部分）。
    if (grant && typeof grant === 'object' && grant.type) {
      const held = Array.isArray(doc && doc.coupons) ? doc.coupons : [];
      if (held.some(c => c && c.type === grant.type)) {
        return { ok: false, err: '已拥有该权益，无需重复兑换', points: cur };
      }
    }
    const data = { points: _.inc(-delta), updateTime: db.serverDate() };
    // 落地兑换权益（grant）到 coupons
    if (grant && typeof grant === 'object') {
      const list = Array.isArray(doc && doc.coupons) ? doc.coupons.slice() : [];
      list.push(Object.assign({ grantedAt: Date.now() }, grant));
      data.coupons = list;
    }
    await db.collection('vp_users').doc(openid).update({ data });
    const after = await getDoc(db, openid);
    return { ok: true, points: after && typeof after.points === 'number' ? after.points : cur - delta, delta: -delta };
  }

  return { ok: false, err: '未知 action: ' + action };
};
