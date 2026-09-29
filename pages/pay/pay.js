const { PRODUCT, PAY_CONFIG, VIRTUAL_PAY } = require('../../utils/config.js');
const pay = require('../../utils/pay.js');
const store = require('../../utils/store.js');
const login = require('../../utils/login.js');

function maskPhone(p) {
  if (!p || p.length < 7) return p;
  return p.slice(0, 3) + '****' + p.slice(-4);
}

Page({
  data: {
    title: PRODUCT.title,
    price: PRODUCT.price,
    currency: PRODUCT.currency,
    chapterCount: PRODUCT.chapters.length,
    // 方式一：个人虚拟支付
    virtualEnabled: VIRTUAL_PAY.enabled && !!VIRTUAL_PAY.cloudEnv,
    virtualItem: VIRTUAL_PAY.itemName,
    // 方式二：赞赏码（兜底，个人主体默认关闭 rewardEnabled=false）
    rewardEnabled: PAY_CONFIG.rewardEnabled,
    rewardQr: PAY_CONFIG.rewardQr,
    authorWechat: (PAY_CONFIG.authorWechat && PAY_CONFIG.authorWechat !== '你的微信号') ? PAY_CONFIG.authorWechat : '',
    // 个体户标准微信支付（JSAPI 支付接口）已移除：个人主体禁用，仅保留虚拟支付 + 兑换码兜底
    code: '',
    paying: false,
    owned: false,
    identityText: ''
  },
  onLoad() { this.sync(); },
  onShow() { this.sync(); },
  sync() {
    this.setData({ owned: store.isUnlockedAll() });
    const id = login.getStored();
    let t = '';
    if (id && id.phone) t = '已登录：' + maskPhone(id.phone);
    else if (id && id.openid && !id.anonymous) t = '已登录';
    if (t) this.setData({ identityText: t });
  },

  // 方式一：个人虚拟支付
  onVirtualPay() {
    if (this.data.paying) return;
    this.setData({ paying: true });
    pay.payByVirtual(PRODUCT)
      .then(() => {
        this.setData({ owned: true, paying: false });
        wx.showToast({ title: '支付成功', icon: 'success' });
        this.sync();
      })
      .catch(err => {
        this.setData({ paying: false });
        const msg = (err && err.errMsg) ? err.errMsg : (err && err.message) ? err.message : '支付未完成';
        wx.showModal({ title: '支付未完成', content: msg, showCancel: false });
      });
  },

  // 个体户标准微信支付（JSAPI 支付接口）已移除：个人主体不具备该能力，禁用以免审核风险

  onInputCode(e) { this.setData({ code: e.detail.value }); },
  // 方式二：赞赏码兑换码
  onRewardPay() {
    if (this.data.paying) return;
    this.setData({ paying: true });
    pay.payByReward(this.data.code)
      .then(() => { this.setData({ owned: true, paying: false }); wx.showToast({ title: '解锁成功', icon: 'success' }); })
      .catch(err => { this.setData({ paying: false }); wx.showModal({ title: '提示', content: err.message, showCancel: false }); });
  },
  // ── 分享能力（个人主体：复制链接 wxaurl.cn 受限，改用「转发给好友 + 朋友圈」传播）──
  onShareAppMessage() {
    return {
      title: '解锁《美汐的故事》整本画面感内容 · dudu 画面感',
      path: '/pages/pay/pay'
    };
  },
  onShareTimeline() {
    return {
      title: '解锁《美汐的故事》整本画面感内容 · dudu 画面感',
      query: ''
    };
  },
  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }
});
