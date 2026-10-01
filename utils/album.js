// utils/album.js
// ─────────────────────────────────────────────────────────────────────────
// 稳健的「保存到相册」封装，专治两类真机死循环：
//   ① 隐私模式下 wx.openSetting 不显示「保存到相册」scope（用户点「去设置」后无处可点）。
//   ② 系统相册权限被拒后，单纯 re-run saveImageToPhotosAlbum 仍失败。
//
// 流程：
//   1) saveImageToPhotosAlbum —— 若隐私未同意，app.js 的 onNeedPrivacyAuthorize 会拦截并弹窗，
//      用户「同意」后框架自动重跑本调用（无需我们手动处理隐私）。
//   2) 若仍失败（系统相册权限）：先 getSetting 看 scope.writePhotosAlbum 状态——
//        · 未询问过 → wx.authorize 直接拉起系统授权框（最顺滑）；
//        · 已拒绝   → 直接走 openSetting 引导；
//        · 已授权   → 直接重试保存。
//   3) openSetting 之后若已开启则立即重试；否则给出明确的系统设置指引（不再死循环）。
// ─────────────────────────────────────────────────────────────────────────
function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    const trySave = () => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success() { resolve({ ok: true }); },
        fail(e) { handleFail(e); }
      });
    };

    const handleFail = (e) => {
      const msg = (e && e.errMsg) || '';
      // 只处理「授权 / 拒绝 / 需要授权」类错误；其他（如导出失败）直接 reject。
      if (!/auth|deny|authorize/i.test(msg)) { reject(e); return; }

      wx.getSetting({
        success(res) {
          const auth = (res.authSetting && res.authSetting['scope.writePhotosAlbum']);
          if (auth === true) {
            trySave();                      // 已授权却失败？重试一次
          } else if (auth === false) {
            goSetting();                    // 之前拒绝过 → 只能去设置
          } else {
            // 从未询问过：直接拉起系统授权框（比 openSetting 体验好，且不依赖隐私模式的 scope 列表）
            wx.authorize({
              scope: 'scope.writePhotosAlbum',
              success() { trySave(); },
              fail() { goSetting(); }
            });
          }
        },
        fail() { goSetting(); }
      });
    };

    const goSetting = () => {
      wx.showModal({
        title: '需要相册权限',
        content: '保存图片需要相册权限。点「去设置」开启「保存到相册」后重试；若设置页没有该项，请到手机系统设置里给微信开启相册权限，再回来保存。',
        confirmText: '去设置',
        cancelText: '取消',
        success(r) {
          if (!r.confirm) { reject(new Error('user cancel')); return; }
          wx.openSetting({
            success(res2) {
              if (res2.authSetting && res2.authSetting['scope.writePhotosAlbum']) {
                trySave();                  // 开启后立刻重试
              } else {
                wx.showToast({ title: '请开启相册权限后重试', icon: 'none', duration: 3000 });
                reject(new Error('no album auth after setting'));
              }
            },
            fail() { reject(new Error('openSetting fail')); }
          });
        },
        fail() { reject(new Error('modal cancel')); }
      });
    };

    trySave();
  });
}

module.exports = { saveImageToAlbum };
