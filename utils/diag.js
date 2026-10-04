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

// 隐私类失败的**精确分类**。⚠️ 曾踩大坑：用 `/privacy/` 这类宽泛正则判「未声明」，
//    结果把 103/104（用户主动拒绝）、权限不足、真机 bug 全都误判成「后台没配」，
//    于是弹出「需到公众平台配隐私指引」把真实原因盖住 —— 用户反复去后台折腾却永远不好。
// 正确做法（官方《小程序隐私协议开发指南》五、常见错误说明）：以 errno 精确判定。
//   errno 112 / errMsg 含 scope is not declared ⇒ 后台确实没声明该信息类型（唯一需要去后台配的情况）
//   errno 103 / 104                                ⇒ 用户拒绝了官方隐私弹窗（不是后台问题，别去折腾后台）
//   appid privacy api banned                        ⇒ 提审时勾了「未采集隐私」，接口权限被回收
//   其它 privacy 字样                              ⇒ 权限/其它原因，与「信息类型」无关
const SCOPE_UNDECLARED = /api scope is not declared|scope is not declared/i;
const API_BANNED = /privacy api banned/i;
const USER_REFUSED = /\b(103|104)\b/;

function errnoOf(e) {
  const n = e && (e.errno !== undefined ? e.errno : e.errNo);
  return typeof n === 'number' ? n : null;
}

// 唯一该弹「去后台配信息类型」的判据：errno 112 或官方原文 errMsg。
function isPrivacyScopeError(e) {
  const msg = (e && (e.errMsg || e.message)) || String(e || '');
  const en = errnoOf(e);
  if (en === 112) return true;
  if (API_BANNED.test(msg)) return false;   // banned 是另一种问题，别混进「去后台勾选」
  if (USER_REFUSED.test(String(en)) ) return false;
  return SCOPE_UNDECLARED.test(msg);
}

// 用户拒绝了隐私弹窗（103/104）—— 独立分支，提示应是「重新同意」而非「去后台」。
function isPrivacyRefusedError(e) {
  const msg = (e && (e.errMsg || e.message)) || String(e || '');
  const en = errnoOf(e);
  return en === 103 || en === 104 || /user.*refus|disagree|deny.*privacy/i.test(msg);
}

// 后台「未采集隐私」导致接口权限被回收 —— 提审时的勾选项问题，与运行时无关。
function isPrivacyBannedError(e) {
  const msg = (e && (e.errMsg || e.message)) || String(e || '');
  return API_BANNED.test(msg);
}

// 隐私/权限类接口的统一失败处理：按官方 errno 精确分流，不再一律指向后台配置。
function handlePrivacyApiFail(ctx, apiName, e) {
  const msg = (e && (e.errMsg || e.message)) || 'unknown';
  const en = errnoOf(e);
  if (/cancel/i.test(msg)) return; // 用户主动取消选图/拍照，不打扰、不算错误
  const detail = apiName + ' 失败：' + msg + (en !== null ? '（errno ' + en + '）' : '');
  reportError(detail);

  const undeclared = isPrivacyScopeError(e);
  const refused = !undeclared && isPrivacyRefusedError(e);
  const banned = !undeclared && !refused && isPrivacyBannedError(e);
  const state = privacySelfCheck().replace(/^隐私自检: /, '');

  let title, content;
  if (undeclared) {
    // errno 112：唯一需要去后台勾选信息类型的情况。
    title = '需配置隐私指引';
    content = '平台提示该信息类型「未声明」（errno 112）。\n\n'
      + '请到微信公众平台 → 设置 → 服务内容 → 用户隐私保护指引：\n'
      + '1. 在「收集的信息类型」多选列表勾选（选中的照片或视频 / 摄像头 / 相册 / 剪切板 / openid）\n'
      + '2. 用途填满，不要留占位符\n'
      + '3. 提交 → 发布，等状态变「已发布」（官方：声明补充约 5 分钟生效）\n\n'
      + '当前状态：' + state;
  } else if (refused) {
    title = '需要隐私授权';
    content = '你刚才拒绝了隐私授权，所以无法使用「' + apiName + '」。\n\n'
      + '请重新进入本页面再点一次，并选择「同意」。\n'
      + '（这是授权被拒，不是后台配置问题，无需去公众平台配置。）\n\n'
      + '原始信息：' + String(msg).slice(0, 80);
  } else if (banned) {
    title = '接口权限被回收';
    content = '平台返回 appid privacy api banned —— 说明提审时勾选了「未采集隐私」，'
      + '或未声明隐私协议，平台回收了隐私接口调用权限。\n\n'
      + '处理：重新提审时如实勾选隐私声明（或勾选实际收集的信息类型），审核通过后自动恢复。';
  } else {
    // 其它：老老实实把真因说出来，不再伪装成「后台没配」
    title = apiName + '失败';
    content = '原始错误：' + String(msg).slice(0, 150) + '\n'
      + (en !== null ? 'errno：' + en + '\n' : '')
      + '\n（这不是「信息类型未声明」问题，请勿去公众平台反复配置。）\n\n'
      + '当前状态：' + state;
  }

  try {
    if (currentEnvVersion() !== 'release') ctx.setData({ err: '⚠️ ' + detail });
  } catch (e2) { /* 忽略 */ }
  wx.showModal({ title, content, showCancel: false, confirmText: '知道了' });
}

module.exports = { surfaceLastError, currentEnvVersion, reportError, handlePrivacyApiFail, isPrivacyScopeError, isPrivacyRefusedError, isPrivacyBannedError, getFreshError, ERROR_TTL_MS, buildDebug, privacySelfCheck };
