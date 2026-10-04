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

// 最近一次异常的有效期：超过该时长视为"陈旧"（来自旧 session 的陈年错误），自动清除不再展示，
// 避免「上一轮真机调试的报错」在下一轮构建里继续骚扰首页（2026-10-04 排障踩坑后加）。
const ERROR_TTL_MS = 3 * 60 * 1000;

// 读取"新鲜"异常：带时间戳，超过 TTL 直接清掉并返回 null；新鲜则返回记录（由调用方负责展示后清除）。
function getFreshError() {
  try {
    const rec = wx.getStorageSync('__lastAppError__');
    if (rec && rec.msg) {
      if (Date.now() - (rec.t || 0) < ERROR_TTL_MS) return rec;
      wx.removeStorageSync('__lastAppError__'); // 陈旧错误，清掉，不再展示
    }
  } catch (e) { /* 忽略 */ }
  return null;
}

// 调试面板信息（开发/体验版 onShow 显示）：环境 + 最近异常 + 页面 data 关键字段。
// ⚠️ 必须导出！comic/card/poster 三页解构导入本模块的 buildDebug 并调用 buildDebug(this)。
//    曾一度漏导出 → 解构得到 undefined → "buildDebug is not a function"
//    （压缩后显示为 g is not a function）。这就是 2026-10-04 真机弹窗的真因。
function buildDebug(ctx) {
  try {
    const env = currentEnvVersion();
    let lastErr = '（无）';
    try {
      const rec = wx.getStorageSync('__lastAppError__');
      if (rec && rec.msg) lastErr = String(rec.msg).slice(0, 120);
    } catch (e) { /* 忽略 */ }
    const dataKeys = (ctx && ctx.data) ? Object.keys(ctx.data).join(',') : '';
    return 'env=' + env + ' | 隐私: ' + privacySelfCheck() + ' | 最近异常：' + lastErr + ' | data: ' + dataKeys;
  } catch (e) {
    return 'buildDebug 异常：' + (e && e.message);
  }
}

// 隐私自检：把平台当前的隐私协议状态直接读出来，用于判断「后台没配」还是「配了没发布」。
// ⚠️ 判读要点（2026-10-04 实测确认）：
//   needAuthorization === false  ⇒ 用户已同意过当前生效的版本；若此时仍报
//                                   scope is not declared ⇒ **新版指引没生效**（后台多半只保存未发布）
//   needAuthorization === true   ⇒ 新版指引已生效、平台要求用户重新点一次同意（这是正常现象）
//   privacyContractName 为空      ⇒ 指引压根没发布过
function privacySelfCheck() {
  try {
    const s = wx.getPrivacySetting ? wx.getPrivacySetting() : null;
    if (!s) return '隐私自检: getPrivacySetting 不可用（基础库过旧）';
    return '隐私自检: needAuthorization=' + (s.needAuthorization === true ? 'true' : 'false')
      + ' | 协议名=' + (s.privacyContractName || '(空=未发布)')
      + ' | 判读=' + (s.needAuthorization === true
        ? '新版已生效,应可正常使用'
        : (s.privacyContractName ? '当前生效版本未含本次新增类型,需后台发布' : '指引未发布'));
  } catch (e) {
    return '隐私自检失败: ' + ((e && e.message) || e);
  }
}

// 记录一条异常（首页 onShow 会展示一次，便于事后定位真机问题）。
function reportError(msg) {
  try {
    wx.setStorageSync('__lastAppError__', { msg: String(msg).slice(0, 500), t: Date.now() });
  } catch (e) { /* 忽略 */ }
}

// 在页面 onShow 调用：若有"新鲜"的异常且当前非正式版，则展示到本页 err 视图。
function surfaceLastError(ctx) {
  try {
    if (currentEnvVersion() === 'release') return;
    const rec = getFreshError();
    if (rec && !ctx._diagSurfaced) {
      ctx._diagSurfaced = true;
      ctx.setData({ err: '⚠️ 最近一次异常（已上报）：' + rec.msg });
    }
  } catch (e) { /* 忽略 */ }
}

// 判断是否为「隐私信息类型未声明」类错误（后台《用户隐私保护指引》未勾选对应信息类型）。
// 典型原文：fail api scope is not declared in the privacy agreement
function isPrivacyScopeError(msg) {
  return /scope is not declared|not declared|privacy|隐私|未声明|指引/i.test(msg || '');
}

// 隐私/权限类接口的统一失败处理：区分「用户主动取消」与「真实失败」。
// cancel 不上报（用户就是不想给），其余一律上报真实 errMsg —— 避免真因被静默吞掉。
// ⚠️ 若为「信息类型未声明」类错误，直接指路 MP 后台配置，不再给一堆 raw 英文 errMsg。
function handlePrivacyApiFail(ctx, apiName, e) {
  const msg = (e && (e.errMsg || e.message)) || 'unknown';
  if (/cancel/i.test(msg)) return; // 用户主动取消，不打扰、不算错误
  const detail = apiName + ' 失败：' + msg;
  reportError(detail);
  const privacy = isPrivacyScopeError(msg);
  // 自检状态直接拼进提示：一眼区分「压根没配」与「配了但没发布」
  const hint = privacy ? '｜' + privacySelfCheck().replace(/^隐私自检: /, '') : '';
  try {
    if (currentEnvVersion() !== 'release') {
      ctx.setData({
        err: privacy
          ? '⚠️ 需到微信公众平台 → 设置 → 服务内容 → 用户隐私保护指引，勾选并发布对应「信息类型」（选图/存图/剪贴板/openid）后重试' + hint
          : '⚠️ ' + detail
      });
    }
  } catch (e2) { /* 忽略 */ }
  wx.showModal({
    title: privacy ? '需配置隐私指引' : '操作失败',
    content: privacy
      ? '平台提示该信息类型「未声明」。\n\n请到微信公众平台 → 设置 → 服务内容 → 用户隐私保护指引：\n1. 勾选「收集的信息类型」多选列表（选中的照片或视频 / 相册 / 剪切板 / openid）\n2. 用途填满（不要留占位符）\n3. 提交 → 发布，等状态变「已发布」\n\n当前状态：' + privacySelfCheck().replace(/^隐私自检: /, '')
      : String(msg).slice(0, 200),
    showCancel: false,
    confirmText: '知道了'
  });
}

module.exports = { surfaceLastError, currentEnvVersion, reportError, handlePrivacyApiFail, isPrivacyScopeError, getFreshError, ERROR_TTL_MS, buildDebug, privacySelfCheck };
