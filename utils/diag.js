// utils/diag.js
// 真机排障辅助：把 App.onError/onUnhandledRejection 持久化到 storage 的「最近一次异常」
// 在任意页面的 onShow 里浮出到该页自己的 err 视图——这样即使不返回首页也能看到真因。
// 仅 开发版/体验版 展示（正式版 end-user 无感），避免吓到真实用户。
'use strict';

function currentEnvVersion() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion; // 'develop' | 'trial' | 'release'
  } catch (e) {
    return 'release';
  }
}

// 在页面 onShow 调用：若有最近一次异常且当前非正式版，则展示到本页 err 视图。
function surfaceLastError(ctx) {
  try {
    if (currentEnvVersion() === 'release') return;
    const rec = wx.getStorageSync('__lastAppError__');
    if (rec && rec.msg && !ctx._diagSurfaced) {
      ctx._diagSurfaced = true;
      ctx.setData({ err: '⚠️ 最近一次异常（已上报）：' + rec.msg });
    }
  } catch (e) { /* 忽略 */ }
}

module.exports = { surfaceLastError, currentEnvVersion };
