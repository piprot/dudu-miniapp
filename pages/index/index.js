const { POINTS, COMMISSION } = require('../../utils/config.js');
const login = require('../../utils/login.js');
const points = require('../../utils/points.js');
const { getFreshError } = require('../../utils/diag.js');

// 工具卡定义（key 稳定不变，顺序可被用户长按拖拽自定义，持久化到 storage）。
const TOOL_ORDER_KEY = 'dudu_tool_order_v1';
const TOOL_DEFS = [
  { key: 'gen', cls: 'accent', title: '✍️ 文案工具箱', desc: '模板匹配 · 防折叠 · 知识库金句 · 我的素材库' },
  { key: 'comic', cls: '', title: '🎞️ 画面感分镜编辑器', desc: '写文字脚本，一键出分镜图 · 全程本地' },
  { key: 'card', cls: 'card2', title: '🎴 卡片制作 / 日签生成器', desc: '选模板填文字，一键出卡片 · 可配本地图' },
  { key: 'poster', cls: 'poster', title: '🖼️ 海报长图生成器', desc: '一句话出长图 · 带头像昵称和专属码' }
];

Page({
  data: {
    points: 0,             // 积分余额
    streak: 0,             // 连续签到天数
    dailyChecked: false,   // 今日是否已签到
    dailyOn: true,         // 是否开启每日登录奖励
    identityText: '',
    lastError: '',         // 上次真机崩溃信息（从 storage 读取，首页横幅显示）
    // ── 创作工具卡（长按拖拽排序，流体交互库 #6 · B 档）──
    tools: TOOL_DEFS.slice(),
    dragIdx: -1,           // 正在被拖拽的卡下标（-1 = 无拖拽）
    dragDy: 0,             // 被拖卡相对起点的位移（px，跟手）
    offsets: []            // 其余卡的让位位移（px，实测计算）
  },
  onLoad() {
    wx.setNavigationBarTitle({ title: 'dudu 画面感' });   // 样例《美汐的故事》降为次级入口，导航栏用品牌名
    this.setData({ dailyOn: !(POINTS && POINTS.daily && POINTS.daily.enabled === false) });
    // 恢复用户自定义的工具卡顺序（未知 key 过滤、缺失的按默认顺序补尾）
    let order = [];
    try { order = wx.getStorageSync(TOOL_ORDER_KEY) || []; } catch (e) { order = []; }
    if (order && order.length) {
      const tools = [];
      order.forEach(k => {
        const d = TOOL_DEFS.find(t => t.key === k);
        if (d && !tools.find(t => t.key === k)) tools.push(d);
      });
      TOOL_DEFS.forEach(d => { if (!tools.find(t => t.key === d.key)) tools.push(d); });
      this.setData({ tools });
    }
  },
  onShow() {
    this.syncLogin();
    this.claimDaily();
    this.showLastError();
  },
  // 读取并展示上次真机崩溃信息（正式版也能看到，不再静默丢失）。
  // ⚠️ 仅展示"新鲜"错误（默认 3 分钟内）：旧 session 的陈年错误会自动过期清除，不再反复骚扰。
  showLastError() {
    try {
      const e = getFreshError();
      if (e && e.msg) {
        this.setData({ lastError: e.msg });
        wx.removeStorageSync('__lastAppError__');
      }
    } catch (e) { /* 忽略 */ }
  },
  // 把错误文案复制到剪贴板，便于一键发给开发者定位（红横幅上"复制"按钮调用）。
  copyError() {
    const msg = this.data.lastError || '';
    if (!msg) return;
    wx.setClipboardData({
      data: msg,
      success: () => wx.showToast({ title: '已复制错误，可发给开发者', icon: 'none', duration: 2200 }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    });
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
  // 统一的工具卡点击入口（排序后绑定跟卡走，按 key 分发）。
  onTapTool(e) {
    const key = e.currentTarget.dataset.key;
    const routes = { gen: '/pages/gen/gen', comic: '/pages/comic/comic', card: '/pages/card/card', poster: '/pages/poster/poster' };
    if (routes[key]) {
      wx.navigateTo({
        url: routes[key],
        fail: (err) => {
          // 导航失败（页面不存在/被拦截）会表现为「点进去是空的」——显式暴露原因，不再静默。
          wx.showModal({ title: '打不开该工具', content: '导航失败：' + ((err && err.errMsg) || '未知错误'), showCancel: false });
        }
      });
    }
  },
  // ── 长按拖拽排序（流体交互库 #6 · B 档）──
  // 铁律 1：catchtouchmove 动态绑定，仅拖拽中拦截滚动；铁律 2/3：被拖卡 inline 跟手、
  // 让位量用 boundingClientRect 实测（不按均匀行高估算）。
  onToolDragStart(e) {
    const idx = e.currentTarget.dataset.idx;
    if (idx == null || idx < 0 || this.data.dragIdx > -1) return;
    const self = this;
    if (typeof wx.vibrateShort === 'function') {
      try { wx.vibrateShort({ type: 'light' }); } catch (err) { /* 部分机型不支持，忽略 */ }
    }
    wx.createSelectorQuery().selectAll('.tool-card').boundingClientRect(rects => {
      if (!rects || rects.length !== self.data.tools.length) return; // 测量与数据不一致 → 放弃本次拖拽
      self._dragRects = rects;
      self._dragStartY = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0;
      self._dragTarget = idx;
      self.setData({ dragIdx: idx, dragDy: 0, offsets: [] });
    }).exec();
  },
  onToolDragMove(e) {
    if (this.data.dragIdx < 0 || !this._dragRects) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const rects = this._dragRects;
    const idx = this.data.dragIdx;
    const dy = touch.clientY - this._dragStartY;
    // 被拖卡虚拟中心落在哪一行 → 落点目标（实测 rects）
    const center = rects[idx].top + dy + rects[idx].height / 2;
    let target = idx;
    for (let i = 0; i < rects.length; i++) {
      if (center >= rects[i].top && center <= rects[i].top + rects[i].height) { target = i; break; }
    }
    // 其余行让位量 = 模拟目标顶位 − 原顶位（实测）
    const offsets = [];
    for (let i = 0; i < rects.length; i++) {
      if (i === idx) { offsets.push(0); continue; }
      if (target > idx && i > idx && i <= target) offsets.push(rects[idx].top - rects[i].top);
      else if (target < idx && i >= target && i < idx) offsets.push(rects[idx].top - rects[i].top);
      else offsets.push(0);
    }
    this._dragTarget = target;
    this.setData({ dragDy: dy, offsets });
  },
  onToolDragEnd() {
    if (this.data.dragIdx < 0) return;
    const from = this.data.dragIdx;
    const to = (this._dragTarget == null) ? from : this._dragTarget;
    const tools = this.data.tools.slice();
    const moved = tools.splice(from, 1)[0];
    tools.splice(to, 0, moved);
    this._dragRects = null;
    this._dragTarget = null;
    try { wx.setStorageSync(TOOL_ORDER_KEY, tools.map(t => t.key)); } catch (e) { /* 存储异常不阻断 UI */ }
    this.setData({ tools, dragIdx: -1, dragDy: 0, offsets: [] });
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
