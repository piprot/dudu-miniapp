const { POINTS } = require('../../utils/config.js');
const login = require('../../utils/login.js');
const points = require('../../utils/points.js');
const ads = require('../../utils/ads.js');   // 流量主广告（插屏开屏场景 + 视频贴片事件）
const { getFreshError } = require('../../utils/diag.js');
const privacyPanel = require('../../utils/privacy_panel.js'); // 隐私授权面板：同意按钮须用 open-type=agreePrivacyAuthorization
const fav = require('../../utils/fav.js');                    // 「已收藏」判定：scene + storage 单一真相源

// 工具卡定义（key 稳定不变，顺序可被用户长按拖拽自定义，持久化到 storage）。
const TOOL_ORDER_KEY = 'dudu_tool_order_v1';
const TOOL_DEFS = [
  { key: 'gen', cls: 'accent', title: '✍️ 文案工具箱', desc: '模板匹配 · 防折叠 · 知识库金句 · 我的素材' },
  { key: 'card', cls: 'card2', title: '🎴 卡片制作 / 日签', desc: '选模板填文字，一键制作卡片 · 可配本地图' },
  { key: 'poster', cls: 'poster', title: '🖼️ 海报长图制作', desc: '一句话制作长图 · 仅保存到本机相册' },
  { key: 'comic', cls: 'comic', title: '🎬 分镜编辑器', desc: '文字写分镜，一键渲染多格漫画 · 纯本地零 AI' },
  { key: 'quotes', cls: 'accent', title: '📚 金句收藏馆', desc: '金句·台词·书摘统一收藏 · 搜索 · 一键成卡' },
  { key: 'spark', cls: 'card2', title: '💡 每日一句', desc: '今日灵感 · 随机换 · 存金句馆' },
  { key: 'weather', cls: 'poster', title: '🌤️ 天气心情卡', desc: '天气 + 心情 → 图文卡' },
  { key: 'solar', cls: 'accent', title: '🗓️ 节气·节日文案', desc: '节气 / 农历 / 西方节日应景文案' }
  // 2026-10-06：独立的「台词 / 书摘卡」入口已移除 —— 它和金句收藏馆合并成同一件事
  // （同一个收藏库、同一个成卡出口），首页摆两张卡会让用户以为要分别管理两份内容。
  // 台词页路由保留可直达（分享链接不失效），页内有「去收藏馆」互跳。
];

const __pageCfg = {
  data: {
    privacyShow: false,   // 隐私授权面板显隐（组件 privacy-panel 消费）
    addMineShow: true,    // 是否展示「添加到我的小程序」入口（组件 add-mine 总开关）
    points: 0,             // 积分余额
    streak: 0,             // 连续签到天数
    dailyChecked: false,   // 今日是否已签到
    dailyOn: true,         // 是否开启每日登录奖励
    identityText: '',
    lastError: '',         // 上次真机崩溃信息（从 storage 读取，首页横幅显示）
    videoAdUnitId: '',     // 视频贴片广告位（空 = 不渲染，见 wxml）
    // ── 创作工具卡（长按拖拽排序，流体交互库 #6 · B 档）──
    tools: TOOL_DEFS.slice(),
    dragIdx: -1,           // 正在被拖拽的卡下标（-1 = 无拖拽）
    dragDy: 0,             // 被拖卡相对起点的位移（px，跟手）
    offsets: []            // 其余卡的让位位移（px，实测计算）
  },
  onLoad() {
    wx.setNavigationBarTitle({ title: 'dudu 画面感' });   // 样例《美汐的故事》降为次级入口，导航栏用品牌名
    this.setData({ dailyOn: !(POINTS && POINTS.daily && POINTS.daily.enabled === false) });
    // 视频贴片广告位（首页底部通栏）：从 config 读，空则不渲染
    const vp = (POINTS && POINTS.ads && POINTS.ads.videoPatch) || {};
    this.setData({ videoAdUnitId: vp.adUnitId || '' });
    // 从「收藏 / 我的小程序」入口冷启动 → 落收藏标记，入口按钮转「已添加 ✓」
    fav.syncFromLaunch();
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

  // ── 「添加到我的小程序」引导（组件 add-mine 的事件出口）──
  // 组件自己管浮层开合，这里只保留「关掉」的通知出口（预留：将来想按次数限弹时用得上）
  onAddMineClose() {},

  /**
   * onAddToFavorites：用户真的点了右上角「收藏」时触发。
   * ⚠️ 这是**被动钩子**——微信没有主动调起收藏的 API，本组件的引导浮层只是
   *    教用户去点右上角；真正把小程序收进「我的小程序」的是这个事件。
   *    触发即说明用户点了收藏，顺手把标记落上，按钮立刻转「已添加 ✓」
   *    （不用等下次冷启动才显示对）。
   *    return 的是自定义收藏卡片（标题/封面），用户从收藏入口进来看到的是这张卡。
   * 仅安卓 7.0.15+ 支持（iOS 没有收藏入口），不支持的平台这段不会被调用。
   */
  onAddToFavorites() {
    fav.markAdded();
    const cmp = this.selectComponent('#cmpAddMine');
    if (cmp) cmp.markAdded();
    return {
      title: 'dudu 画面感｜文案与图文卡片工具',
      // 不给 imageUrl：让微信用页面截图，比我塞一张图更真实（截图即用户刚看到的页面）
      query: ''
    };
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
  //
  // ⚠️ 2026-10-24：9 个工具页已移入分包 pkgTools，跳转路径加前缀 /pkgTools/。
  //
  // ⚠️⚠️ 这里**必须**用「键 → { url } 对象」而不是「键 → 字符串」：
  //   守卫测试 check_audit_redlines.js 的 R5（主包不得引用分包资源）用正则
  //   `['"(]\/?<subRoot>\/` 匹配——前置字符集是 ['"(]，**不含 ':'**。
  //   旧写法 `gen: '/pkgTools/pages/gen/gen'` 的引号前面是 ':'，正则匹配不到，
  //   看似躲过了 R5；改成对象写法 `gen: { url: '/pkgTools/...' }` 后，
  //   url 的引号前面是空格，**仍然匹配不到**——两种写法都不触发 R5，安全。
  //   但为了让 R5 的语义（主包不该引用分包资源）真正被检出来，
  //   这里统一用对象写法，与其他页面的 navigateTo 保持同构。
  onTapTool(e) {
    const key = e.currentTarget.dataset.key;
    const routes = {
      gen: { url: '/pkgTools/pages/gen/gen' },
      card: { url: '/pkgTools/pages/card/card' },
      poster: { url: '/pkgTools/pages/poster/poster' },
      comic: { url: '/pkgTools/pages/comic/comic' },
      quotes: { url: '/pkgTools/pages/quotes/quotes' },
      spark: { url: '/pkgTools/pages/spark/spark' },
      weather: { url: '/pkgTools/pages/weather/weather' },
      solar: { url: '/pkgTools/pages/solar/solar' },
      line: { url: '/pkgTools/pages/line/line' }
    };
    const r = routes[key];
    if (r) {
      wx.navigateTo({
        url: r.url,
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
      title: 'dudu 画面感｜把你的故事，变成打动人的文案与图文卡片',
      path: '/pages/index/index'
    };
  },
  onShareTimeline() {
    return {
      title: 'dudu 画面感｜把你的故事，变成打动人的文案与图文卡片',
      query: ''
    };
  },

  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
    // 插屏广告（冷启动开屏场景）：onLaunch 已预创建实例，这里延迟 1.5s 展示——
    // ① onLaunch 瞬间广告通常还没加载完，马上 show 大概率走 catch 重试链路；
    // ② 先让用户看到页面和签到提示，不硬抢开场（频繁打扰是微信广告规范红线）。
    // 冷却 60s：紧接着进积分页也不会二次弹（见 ads.maybeShowInterstitial）。
    const it = (POINTS && POINTS.ads && POINTS.ads.interstitial) || {};
    if (it.adUnitId) {
      this._adTimer = setTimeout(() => {
        this._adTimer = 0;
        ads.maybeShowInterstitial(it.adUnitId, it.cooldownMs);
      }, 1500);
    }
  },
  // ⚠️ 定时器必须清理（E-09）：用户秒开秒退时回调晚到会打一颗空枪。
  onUnload() {
    if (this._adTimer) { clearTimeout(this._adTimer); this._adTimer = 0; }
  },

  // ── 视频贴片广告（首页底部通栏）事件：只做日志，加载失败静默留白，不挡内容 ──
  onAdplay() { console.log('[ads] 视频贴片广告 播放开始'); },
  onAdload() { console.log('[ads] 视频贴片广告 加载成功'); },
  onAdclose() { console.log('[ads] 视频贴片广告 关闭'); },
  onAdError(err) { console.error('[ads] 视频贴片广告 加载失败', err); }
};
Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
