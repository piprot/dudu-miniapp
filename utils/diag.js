// utils/diag.js
// 真机排障辅助：统一记录「最近一次异常」到 storage，供首页横幅展示。
// ⚠️ 探针类 UI 请写成「静态 + 不依赖 JS/数据」，否则探针自身可能被静默隐藏，
//    造成「探针不显示 = 页面不渲染」的误判（2026-10-03 踩过）。
'use strict';

function currentEnvVersion() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion; // 'develop' | 'trial' | 'release'
  } catch (e) {
    return 'release';
  }
}

// 记录一条异常（首页 onShow 会展示一次，便于事后定位真机问题）。
function reportError(msg) {
  try {
    wx.setStorageSync('__lastAppError__', { msg: String(msg).slice(0, 500), t: Date.now() });
  } catch (e) { /* 忽略 */ }
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

// 隐私/权限类接口的统一失败处理：区分「用户主动取消」与「真实失败」。
// cancel 不上报（用户就是不想给），其余一律上报真实 errMsg —— 避免真因被静默吞掉。
function handlePrivacyApiFail(ctx, apiName, e) {
  const msg = (e && (e.errMsg || e.message)) || 'unknown';
  if (/cancel/i.test(msg)) return; // 用户主动取消，不打扰、不算错误
  const detail = apiName + ' 失败：' + msg;
  reportError(detail);
  try {
    if (currentEnvVersion() !== 'release') {
      ctx.setData({ err: '⚠️ ' + detail });
    }
  } catch (e2) { /* 忽略 */ }
  wx.showToast({ title: String(msg).slice(0, 40), icon: 'none', duration: 2600 });
}

module.exports = { surfaceLastError, currentEnvVersion, reportError, handlePrivacyApiFail };
