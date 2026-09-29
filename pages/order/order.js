// 订单中心页（交易类小程序提审刚需：MP 后台「小程序订单中心path」必须指向一个真实可访问的页面）
//
// 数据来源：云函数 vp_list_orders，按服务端注入的 OPENID 返回当前用户的 vp_orders。
//
// 关于「登录态」：本小程序为个人主体，用户以 openid 静默标识（由虚拟支付服务端注入），
// 没有显式「微信登录」流程；openid 在云能力就绪后即自动可用。因此本页**没有**传统的
// 登录拦截页——实际「无登录态」等价于「云能力未就绪 / 查询失败」，统一用「重试」引导处理。
const app = getApp();

Page({
  data: {
    loading: true,
    list: [],
    empty: false,
    err: ''
  },
  onShow() {
    this.load();
  },
  load() {
    if (typeof wx.cloud === 'undefined' || !wx.cloud) {
      // wx.cloud 未初始化（极少见，理论上 app.js onLaunch 已 init）：引导重试
      this.setData({ loading: false, err: '云能力未就绪，请下拉重试', empty: false });
      return;
    }
    this.setData({ loading: true, err: '' });
    wx.cloud.callFunction({ name: 'vp_list_orders', data: {} })
      .then(r => {
        const res = (r && r.result) || {};
        if (res.error) {
          this.setData({ err: res.error, loading: false, empty: false });
          return;
        }
        const list = res.list || [];
        this.setData({ list, loading: false, empty: list.length === 0 });
      })
      .catch(err => {
        const msg = (err && err.errMsg) ? err.errMsg : '加载失败，请稍后重试';
        this.setData({ err: msg, loading: false, empty: false });
      });
  },
  onRetry() {
    this.load();
  },
  goPay() {
    // 原「解锁整本(comic_full)」入口已随 AI 内容外迁移除；仅保留充值路径
    wx.navigateTo({ url: '/pages/points/points' });
  },
  onPullDownRefresh() {
    this.load();
    wx.stopPullDownRefresh();
  },
  // ── 分享能力（个人主体：复制链接 wxaurl.cn 受限，改用「转发给好友 + 朋友圈」传播）──
  onShareAppMessage() {
    return {
      title: '我的订单｜虚拟支付记录 · dudu 画面感',
      path: '/pages/order/order'
    };
  },
  onShareTimeline() {
    return {
      title: '我的订单｜虚拟支付记录 · dudu 画面感',
      query: ''
    };
  },
  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }
});
