// 积分前端助手：封装对 points 云函数的调用
// 仅余额查询 + 花费 + 每日登录奖励；赚取由服务端在 ai_gen 内完成（真实调通模型后才加分）
function callPoints(action, extra) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'points',
      data: Object.assign({ action }, extra || {})
    }).then(r => {
      const res = r.result || {};
      if (res.ok) resolve(res);
      else reject(new Error(res.err || '积分操作失败'));
    }).catch(err => reject(err));
  });
}

// 读取当前用户积分余额 + 已得优惠券
function getBalance() {
  return callPoints('balance').then(res => ({ points: res.points || 0, coupons: res.coupons || [] }));
}

// 花费积分兑换权益（delta 为正数；grant 为要写入的权益对象）
function spend(reason, delta, grant) {
  return callPoints('spend', { reason, delta, grant });
}

// ── 每日登录奖励（签到）+ 新人礼 ──
// 服务端按「北京时间自然日」幂等发放：客户端重复调用也只发一次。
// 新人礼（signupBonus）**搭同一次调用返回**：服务端在首次登录时一次性赠送，
// 返回体里的 `signupBonus` 字段表示本次是否真的送出（0 = 已领过/未开启）。
// 因此调用方即使在「每日奖励关闭」时也不要跳过本调用，否则会一起错过新人礼。
const DAILY_KEY = 'comic_daily_v1';
const CN_OFFSET_MS = 8 * 3600 * 1000;

function todayKeyCN() {
  return new Date(Date.now() + CN_OFFSET_MS).toISOString().slice(0, 10);
}

// 直接请求服务端领取（幂等）
function dailyCheckin() {
  return callPoints('daily');
}

// 带本地缓存的每日检查：同一天只真正请求一次，避免每次进页面都打云函数。
// 缓存不准（换设备/清缓存）最多多打一次，服务端幂等，不会多发。
function maybeDailyCheckin() {
  const today = todayKeyCN();
  let cache = null;
  try { cache = wx.getStorageSync(DAILY_KEY) || null; } catch (e) { cache = null; }
  if (cache && cache.date === today) {
    return Promise.resolve({ ok: true, skipped: true, already: true, awarded: 0, points: cache.points, streak: cache.streak, today });
  }
  return dailyCheckin().then(res => {
    try {
      wx.setStorageSync(DAILY_KEY, { date: res.today || today, points: res.points, streak: res.streak });
    } catch (e) {}
    return res;
  });
}

module.exports = { getBalance, spend, dailyCheckin, maybeDailyCheckin, todayKeyCN };
