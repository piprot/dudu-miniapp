const { PAY_CONFIG, VIRTUAL_PAY } = require('./config.js');
const store = require('./store.js');
const ios = require('./ios.js');

// ─────────────────────────────────────────────────────────────
// 策略零：个人虚拟支付（微信官方「虚拟支付·个人」，无需公司）
// 流程：wx.login 拿 code → 云函数 vp_create_order 双签名下发 payData
//      → wx.requestVirtualPayment 拉起支付
//      → 平台向云函数 vp_deliver 推送 xpay_goods_deliver_notify（权威发货）
//      → 前端乐观解锁 + vp_get_profile 校正（推送丢失时 query_order 兜底）
// 关键：offerId/appKey/sessionKey 全在服务端，前端只持有签名后的 payData。
// ─────────────────────────────────────────────────────────────
function payByVirtual(product) {
  return new Promise((resolve, reject) => {
    if (!VIRTUAL_PAY.enabled) {
      reject(new Error('虚拟支付未启用：请先在 config.js 填好 VIRTUAL_PAY 并在 MP 后台开通虚拟支付。'));
      return;
    }
    if (!VIRTUAL_PAY.useCloud || !VIRTUAL_PAY.cloudEnv) {
      reject(new Error('虚拟支付需用微信云开发做服务端：请填 VIRTUAL_PAY.cloudEnv。'));
      return;
    }
    if (!ios.checkIosVersion(VIRTUAL_PAY.iosMinWechat)) {
      reject(new Error('iOS 端微信版本过低，请更新微信后重试。'));
      return;
    }
    // 允许覆盖商品（默认 comic_full；积分充值包传 pack 的 productId）。
    // 注意：**不把 priceFen 传给服务端** —— 定价权在服务端道具目录（vp_create_order 的 PRODUCTS），
    // 前端传价会被忽略；此处 opt.priceFen 仅作本地展示用途。
    const opt = product || {};
    const productId = opt.productId || VIRTUAL_PAY.productId;
    wx.showLoading({ title: '准备支付' });
    wx.login({
      success: loginRes => {
        if (!loginRes.code) { wx.hideLoading(); reject(new Error('wx.login 失败')); return; }
        wx.cloud.callFunction({
          name: 'vp_create_order',
          data: { code: loginRes.code, productId }
        }).then(r => {
          wx.hideLoading();
          const p = r.result;
          if (!p || !p.signData) {
            reject(new Error((p && p.error) ? p.error : '下单失败：服务端未返回支付参数，请检查云函数日志。'));
            return;
          }
          wx.requestVirtualPayment({
            signData: p.signData,
            mode: p.mode,
            paySig: p.paySig,
            signature: p.signature,
            success() {
              // 支付成功（回调可能丢失，不能仅据此发货）。乐观置位 + 稍后校正。
              // 注：积分充值包不走 unlockedAll，发货以 vp_deliver 推送为准（已在服务端按 productId 区分）。
              if (productId === VIRTUAL_PAY.productId) store.setServerUnlocked(true);
              // 带回订单号：定制类（comic_pdf/comic_web）落库幂等用（2026-09-18）
              resolve(p.outTradeNo || true);
            },
            fail(err) {
              reject(err);
            }
          });
        }).catch(err => {
          wx.hideLoading();
          reject(err);
        });
      },
      fail: () => { wx.hideLoading(); reject(new Error('wx.login 失败')); }
    });
  });
}


// 向服务端查询当前用户解锁态并校正本地（发货推送到达后调用；reader onShow 也调）
function confirmVirtualUnlock() {
  return new Promise(resolve => {
    if (!VIRTUAL_PAY.enabled || !VIRTUAL_PAY.useCloud || !VIRTUAL_PAY.cloudEnv) { resolve(false); return; }
    wx.cloud.callFunction({ name: 'vp_get_profile', data: {} })
      .then(r => {
        if (r.result && r.result.unlockedAll) store.setServerUnlocked(true);
        resolve(!!(r.result && r.result.unlockedAll));
      })
      .catch(() => resolve(false));
  });
}

// 策略二：兑换码（个人主体可用，本地校验，兜底；redeemCodes 仅小范围/熟人运营用，规模化请改服务端核销）
function payByReward(code) {
  return new Promise((resolve, reject) => {
    const valid = PAY_CONFIG.redeemCodes.includes((code || '').trim().toUpperCase());
    if (!valid) {
      reject(new Error('兑换码无效，请确认后重试；或先完成赞赏后联系作者获取兑换码。'));
      return;
    }
    store.unlockAll();
    resolve(true);
  });
}

module.exports = { payByVirtual, confirmVirtualUnlock, payByReward };
