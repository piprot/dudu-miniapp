const { POINTS, COMMISSION } = require('../../utils/config.js');
const login = require('../../utils/login.js');
const points = require('../../utils/points.js');

Page({
  data: {
    points: 0,             // 积分余额
    streak: 0,             // 连续签到天数
    dailyChecked: false,   // 今日是否已签到
    dailyOn: true,         // 是否开启每日登录奖励
    identityText: ''
  },
  onLoad() {
    wx.setNavigationBarTitle({ title: 'dudu 画面感' });   // 样例《美汐的故事》降为次级入口，导航栏用品牌名
    this.setData({ dailyOn: !(POINTS && POINTS.daily && POINTS.daily.enabled === false) });
  },
  onShow() {
    this.syncLogin();
    this.claimDaily();
  },
  syncLogin() {
    // 个人主体以 openid 标识用户（虚拟支付服务端注入），无需登录入口；仅展示本地缓存的已登录态
    const id = login.getStored();
    let identityText = '';
    if (id && id.openid && !id.anonymous) identityText = '已登录';
    this.setData({ identityText });
  },
  // 每日登录奖励 + 新人礼：进入即由服务端幂等发放（同一天重复进页面不会重复发）
  async claimDaily() {
    try {
      const res = await points.maybeDailyCheckin();
      const bal = await points.getBalance();
      this.setData({
        points: bal.points,
        streak: res.streak || 0,
        dailyChecked: !!(res.already || res.skipped || res.awarded > 0)
      });
      const title = this.claimToastText(res);
      if (title) wx.showToast({ title, icon: 'none', duration: 2600 });
    } catch (e) {
      // 云函数未部署 / 网络异常时静默失败，不打扰首页浏览
    }
  },
  // 合成一条提示：新人礼与签到同一次调用里可能同时到账，
  // 分两条 showToast 会互相覆盖（后者顶掉前者），所以必须合并成一条。
  claimToastText(res) {
    const gift = (res && res.signupBonus) || 0;
    const awarded = (res && res.awarded) || 0;
    if (gift > 0) {
      return '🎉 新人礼 +' + gift + ' 积分' + (awarded > 0 ? '，签到 +' + awarded : '');
    }
    if (awarded > 0) {
      return res.milestone
        ? '连签 ' + res.streak + ' 天，+' + awarded + ' 积分！'
        : '签到成功 +' + awarded + ' 积分';
    }
    return '';
  },
  goPoints() {
    wx.navigateTo({ url: '/pages/points/points' });
  },
  // 纯本地文案工具箱（B1 合规版，零 AI）。
  goGen() {
    wx.navigateTo({ url: '/pages/gen/gen' });
  },
  // 画面感分镜编辑器（A 方向，本地 canvas，零 AI）。
  goComic() {
    wx.navigateTo({ url: '/pages/comic/comic' });
  },
  // 卡片 / 日签生成器（B 方向，本地 canvas，零 AI，可配本地图）。
  goCard() {
    wx.navigateTo({ url: '/pages/card/card' });
  },
  // ── 分享能力（个人主体：复制链接 wxaurl.cn 受限，改用「转发给好友 + 朋友圈」传播）──
  onShareAppMessage() {
    return {
      title: 'dudu 画面感｜把你的故事，变成打动人的文案与画面感内容',
      path: '/pages/index/index'
    };
  },
  onShareTimeline() {
    return {
      title: 'dudu 画面感｜把你的故事，变成打动人的文案与画面感内容',
      query: ''
    };
  },
  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }
});
