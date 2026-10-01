// utils/charge.js
// ─────────────────────────────────────────────────────────────────────────
// 统一的「产出型动作扣积分」流程（2026-10-01 接入所有内容工具）。
//
// 设计：所有工具的扣分只在这里发生，单价全部来自 utils/config.js 的 POINTS.cost，
// 页面只需调用 charge(action)，不要在各自页面里手写 spend / 余额判断（避免散落、漏改）。
//
// 流程：
//   1) 读取权威余额；不足 → 弹窗引导去积分页（签到领 / 充值）；
//   2) spend 扣费；成功 → resolve(true)（调用方继续产出）；失败 → 提示并 reject（不产出）。
//   成本为 0 的 action 视为免费，直接 resolve(true)（方便把某工具调成免费只需改 config）。
// ─────────────────────────────────────────────────────────────────────────
const points = require('./points');
const { POINTS } = require('./config');

function costOf(action) {
  return (POINTS && POINTS.cost && POINTS.cost[action]) || 0;
}

function charge(action, opts) {
  opts = opts || {};
  const cost = costOf(action);
  return new Promise((resolve, reject) => {
    if (!cost) { resolve(true); return; }   // 免费动作：直接放行

    points.getBalance().then(bal => {
      const balPoints = (bal && bal.points) || 0;
      if (balPoints < cost) {
        wx.showModal({
          title: '积分不足',
          content: (opts.label || '该功能') + '需 ' + cost + ' 积分；去积分页签到领积分或充值后就能用。',
          confirmText: '去积分',
          cancelText: '再看看',
          success(r) { if (r.confirm) wx.navigateTo({ url: '/pages/points/points' }); }
        });
        reject(new Error('insufficient'));
        return;
      }
      points.spend(opts.reason || action, cost).then(() => {
        resolve(true);
      }).catch(() => {
        wx.showToast({ title: '积分扣除失败，请重试', icon: 'none' });
        reject(new Error('spend fail'));
      });
    }).catch(() => {
      wx.showToast({ title: '读取余额失败，请重试', icon: 'none' });
      reject(new Error('balance fail'));
    });
  });
}

module.exports = { costOf, charge };
