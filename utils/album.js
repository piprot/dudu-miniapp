// utils/album.js
// ─────────────────────────────────────────────────────────────────────────
// 「保存到相册」封装。
//
// ⚠️ 历史坑（2026-10-03 真机修复）：不要再用 `wx.authorize({ scope:
//    'scope.writePhotosAlbum' })` —— 该 scope 在现代微信中已废弃、无法通过
//    authorize 申请（旧流程会永远失败 → 陷入「需要相册权限」死循环）。
//    现在隐私授权（app.js onNeedPrivacyAuthorization 拦截 saveImageToPhotosAlbum，
//    用户同意后框架自动重跑）通过后，若因「保存到相册」权限被拒，只需引导去
//    小程序设置页（wx.openSetting）由用户手动开启，然后重试。
//
// 流程：
//   1) 直接 saveImageToPhotosAlbum；隐私未同意时由 app.js 拦截弹窗，同意后框架自动重跑。
//   2) 若失败且是授权类错误：getSetting 看 scope.writePhotosAlbum——
//        · 已授权 → 重试一次（可能是瞬时失败）；· 未授权/未询问 → 引导 openSetting。
//   3) openSetting 开启后立即重试；仍未开启则给出明确指引并把真实 errMsg 上报
//      （写入 __lastAppError__，首页错误横幅可见，便于事后定位）。
// ─────────────────────────────────────────────────────────────────────────

const { reportError, isPrivacyScopeError, privacySelfCheck } = require('./diag.js');

const ERR_KEY = '__lastAppError__';

function reportErr(msg) {
  reportError(msg);
}

function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    let retried = false; // 只允许重试一次，防止「已授权却反复失败」时死循环

    const trySave = () => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success() { resolve({ ok: true }); },
        fail(e) {
          const msg = (e && e.errMsg) || '';
          // 隐私信息类型未声明（后台《用户隐私保护指引》没勾选「相册（保存到相册）」）→ 直接指路后台，不进授权重试逻辑。
          if (isPrivacyScopeError(msg)) {
            const tip = '保存失败：后台《用户隐私保护指引》未声明「相册（保存到相册）」信息类型。请到 mp.weixin.qq.com → 设置 → 服务内容 → 用户隐私保护指引，勾选并发布后重试。\n\n当前状态：' + privacySelfCheck().replace(/^隐私自检: /, '');
            reportErr(tip);
            wx.showModal({ title: '需配置隐私指引', content: tip, showCancel: false });
            reject(e); return;
          }
          // 只处理「授权 / 拒绝 / 需要授权」类错误；其他（如导出失败）直接 reject。
          if (!/auth|deny|authorize|permission/i.test(msg)) { reject(e); return; }
          if (retried) { reportErr('保存到相册失败：' + msg); reject(e); return; }
          retried = true;
          handleAuthFail();
        }
      });
    };

    const handleAuthFail = () => {
      wx.getSetting({
        success(res) {
          const auth = (res.authSetting && res.authSetting['scope.writePhotosAlbum']);
          if (auth === true) {
            trySave();                        // 已授权却失败？重试一次
          } else {
            goSetting();                      // 未授权 → 只能去设置页手动开启
          }
        },
        fail() { goSetting(); }
      });
    };

    const goSetting = () => {
      wx.showModal({
        title: '需要相册权限',
        content: '保存图片需要「保存到相册」权限。点「去设置」开启后会自动重试；若设置页没有该项，请到手机「设置 → 应用 → 微信 → 照片和视频」允许微信访问相册。',
        confirmText: '去设置',
        cancelText: '取消',
        success(r) {
          if (!r.confirm) { reject(new Error('user cancel')); return; }
          wx.openSetting({
            success(res2) {
              if (res2.authSetting && res2.authSetting['scope.writePhotosAlbum']) {
                trySave();                    // 开启后立刻重试
              } else {
                const tip = '请在设置里开启「保存到相册」后重试';
                reportErr(tip);
                wx.showToast({ title: tip, icon: 'none', duration: 3000 });
                reject(new Error('no album auth'));
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
