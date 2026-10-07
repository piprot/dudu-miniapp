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

// 统一从各种错误形态里取出可读原因：云调用失败给 errMsg，业务失败给 message。
// 2026-10-07：原提示只写「请重试」把真实原因吞掉了，排障只能靠猜，故统一在此提取。
function reasonOf(err) {
  if (!err) return '未知原因';
  if (typeof err === 'string') return err;
  return err.message || err.errMsg || err.err || '未知原因';
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
      }).catch(err => {
        // 暴露真实原因：最常见的是服务端 GEN_COST 与前端 config.POINTS.cost 不同值，
        // 云函数会返回「扣费成本不符（xx 应为 N 积分，收到 M）」，原提示只说「请重试」看不见。
        console.error('[charge] 积分扣除失败：', err);
        wx.showToast({ title: '积分扣除失败·' + String(reasonOf(err)).slice(0, 12), icon: 'none', duration: 3000 });
        reject(err instanceof Error ? err : new Error(String(reasonOf(err))));
      });
    }).catch(err => {
      // 同上：balance 失败只有两条路径 —— wx.cloud.callFunction 被拒（云未初始化/网络/函数未部署），
      // 或云函数返回 ok:false（openid 为空）。把原因打出来，避免再靠猜。
      console.error('[charge] 读取余额失败：', err);
      wx.showToast({ title: '读取余额失败·' + String(reasonOf(err)).slice(0, 12), icon: 'none', duration: 3000 });
      reject(err instanceof Error ? err : new Error(String(reasonOf(err))));
    });
  });
}

module.exports = { costOf, charge };
