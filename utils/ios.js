// iOS 端虚拟支付版本校验：微信客户端需 ≥ 8.0.68（官方要求）
// 不满足时弹窗提示更新微信，并返回 false 阻止拉起支付。
function checkIosVersion(minVer) {
  const sys = wx.getSystemInfoSync();
  if (sys.platform !== 'ios') return true; // 非 iOS 直接放行
  const base = (minVer || '8.0.68').split('.').map(Number);
  const cur = (sys.version || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const c = cur[i] || 0;
    const b = base[i] || 0;
    if (c > b) return true;
    if (c < b) {
      wx.showModal({
        title: '提示',
        content: 'iOS 端需微信 ' + (minVer || '8.0.68') + ' 及以上版本，请更新微信后重试',
        showCancel: false
      });
      return false;
    }
  }
  return true;
}

module.exports = { checkIosVersion };
