const { POINTS } = require('../../utils/config.js');
const points = require('../../utils/points.js');
const pay = require('../../utils/pay.js');

Page({
  data: {
    points: 0,
    coupons: [],
    redeem: [],        // 兑换目录（来自 config.POINTS.redeem）
    packs: [],         // 充值包（来自 config.POINTS.packs）
    rechargeEnabled: true,
    avatar: '',           // 用户自愿填写的头像（cloud fileID）
    nickname: '',         // 用户自愿填写的昵称
    savingProfile: false,
    privacyNeed: false,   // 《隐私保护指引》是否待用户同意（真机「点加号没反应」的兜底入口）
    privacyName: '《隐私保护指引》',
    err: '',
    spending: false,
    recharging: false,
    // 每日登录奖励
    dailyOn: true,
    dailyChecked: false,
    streak: 0,
    today: '',
    dailyRule: '',
    earnTip: '',       // 积分增减说明（按 config 计算，别在 wxml 写死数字，否则改价后文案与现实不符）
    claiming: false
  },
  onLoad() {
    const d = POINTS.daily || {};
    const g = POINTS.signupBonus || {};
    const maxPerDay = (d.base || 20) + (d.streakCap || 0);
    // 新人礼：一次性发放，只有开启时才写进说明（关掉就别承诺）。
    const giftNote = (g.enabled !== false && g.amount > 0) ? '新人礼 +' + g.amount + '（首次进入一次性）· ' : '';
    // 真实积分消费出口：目前仅「兑换定制9折券」（config.POINTS.redeem[0].cost = 200）。
    // ⚠️ 2026-09-24 修正：此前这里写成「生成朋友圈文案 −20 / 写修改意见换一批 −15」，
    //    而小程序早已无此生成入口（去了 H5 且免费），等于向用户承诺一个不存在的积分消费 —— 误导。
    //    现已改为实际存在的出口。改价/下线功能时务必同步这行。
    const redeemCost = (POINTS.redeem && POINTS.redeem[0] && POINTS.redeem[0].cost) || 200;
    this.setData({
      redeem: POINTS.redeem || [],
      packs: POINTS.packs || [],
      rechargeEnabled: POINTS.rechargeEnabled !== false,
      dailyOn: d.enabled !== false,
      dailyRule: '每日 +' + (d.base || 20) + ' 起，连签每天递增 +1（最高 +' + maxPerDay + '）；每连签 ' + (d.milestoneEvery || 7) + ' 天额外 +' + (d.milestoneBonus || 0),
      // ⚠️ 只能写**当前真实存在**的增减项。赚分只剩「每日签到」（config.POINTS.earn 为空）；
      //    花费只剩「兑换定制9折券」。改价/下线功能时务必同步这行。
      earnTip: '积分增减：' + giftNote
        + '每日签到 +' + (d.base || 20) + ' 起，连签每日 +1（最多 +' + ((d.base || 20) + (d.streakCap || 10)) + ' / 天）'
        + ' · 兑换定制9折券 −' + redeemCost
        + '（积分不足可先充值或每日签到赚取）'
    });
  },
  onShow() {
    this.refresh();
    this.checkDaily();
    this.checkPrivacy();
  },
  // ── 隐私授权兜底 ──
  // 真机反馈（2026-09-21）：「点加号没有反应」。加号是 open-type="chooseAvatar" 按钮，
  // 「头像」属隐私受保护信息 —— 未同意《隐私保护指引》时框架会挂起，用户看不到任何反馈。
  // 这里用 wx.getPrivacySetting 主动问一次，未同意就在页面顶部亮出**可点**的「去同意」。
  // ⚠️ 只能由用户点击触发 wx.requirePrivacyAuthorize；绝不能写进 app.js 的授权回调里（会死循环）。
  checkPrivacy() {
    if (typeof wx.getPrivacySetting !== 'function') return;
    wx.getPrivacySetting({
      success: (res) => {
        this.setData({
          privacyNeed: !!(res && res.needAuthorization),
          privacyName: (res && res.privacyContractName) || '《隐私保护指引》'
        });
      }
    });
  },
  onAgreePrivacy() {
    if (typeof wx.requirePrivacyAuthorize !== 'function') {
      wx.showToast({ title: '当前微信版本不支持，请升级后再试', icon: 'none' });
      return;
    }
    wx.requirePrivacyAuthorize({
      success: () => {
        this.setData({ privacyNeed: false });
        wx.showToast({ title: '已同意，现在可以选头像了', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '需要同意后才能选择头像', icon: 'none' })
    });
  },
  refresh() {
    points.getBalance()
      .then(r => {
        const raw = r.coupons || [];
        const types = raw.map(c => c && c.type);
        this.setData({
          points: r.points || 0,
          // 服务端只存 { type, value, grantedAt }，直接渲染会显示成 "comic_discount（0.9）"，
          // 用户看不懂。这里用 config.POINTS.redeem 目录映射回「画面感内容 9 折券」。
          coupons: raw.map(c => Object.assign({}, c, { label: this.couponLabel(c) })),
          // 已拥有的兑换项：按钮置灰 + 文案改「已拥有」，避免重复花积分买同一张券
          redeem: (POINTS.redeem || []).map(it => Object.assign({}, it, {
            owned: !!(it.grant && types.indexOf(it.grant.type) >= 0)
          }))
        });
      })
      .catch(() => {});
    this.loadProfile();
  },
  // grant（只有 type/value）→ 可读名称；查不到就退回 type 本身
  couponLabel(c) {
    const t = c && c.type;
    const hit = (POINTS.redeem || []).find(r => r.grant && r.grant.type === t);
    return (hit && hit.name) || t || '权益';
  },
  hasCoupon(type) {
    return !!type && (this.data.coupons || []).some(c => c && c.type === type);
  },
  goCommission() {
    wx.navigateTo({ url: '/pages/commission/commission' });
  },
  // 我的订单（订单中心页，满足交易类小程序提审要求）
  goOrder() {
    wx.navigateTo({ url: '/pages/order/order' });
  },
  // 兑换成功后的「下文」：只说「兑换成功」而没有去处，用户会认为积分逻辑断了（2026-09-20 真机反馈）。
  guideToUse(item) {
    const t = item && item.grant && item.grant.type;
    if (t !== 'comic_discount') return;
    setTimeout(() => {
      wx.showModal({
        title: '🎫 9 折券已到账',
        content: '在「画面感内容定制」下单时，这张 9 折券会随订单一起提交，客服按券减免相应差价。现在去下单看看？',
        confirmText: '去下单',
        cancelText: '稍后再说',
        success: (res) => { if (res.confirm) this.goCommission(); }
      });
    }, 700);
  },
  // 回填**已保存**的头像/昵称。
  // 2026-09-20 真机反馈：「头像和昵称，用户可以点选自己微信的，但这里没有同步」。
  // 两处原因都已修：① vp_get_profile 此前不返回 nickname/avatar（服务端已补）；
  //                  ② 本页 refresh 只取积分，从不回读资料（此处补上）。
  // 只在本地为空时回填 —— 否则会覆盖用户正在编辑、还没点保存的内容。
  loadProfile(force) {
    wx.cloud.callFunction({ name: 'vp_get_profile', data: { action: 'profile' } })
      .then(r => {
        const res = (r && r.result) || {};
        const patch = {};
        if (res.nickname && (force || !this.data.nickname)) patch.nickname = res.nickname;
        if (res.avatar && (force || !this.data.avatar)) patch.avatar = res.avatar;
        if (Object.keys(patch).length) this.setData(patch);
      })
      .catch(() => { /* 云函数未部署 / 网络异常：静默 */ });
  },
  // ── 我的资料（可选）：头像/昵称只能由用户主动填写（个人主体不可用手机号/静默获取）──
  // chooseAvatar 被拦时**没有任何回调**（不报错、不弹窗），用户看到的就是「点加号没反应」。
  // ⚠️ 但**不能**用「点击后 N 秒无回调就报错」来做兜底（2026-09-21 我自己踩过）：
  //    真机上点加号会先弹出微信头像面板（相册/拍照/使用微信头像），用户挑图常要 >2s，
  //    固定超时必然**盖在人家正常弹出的面板上乱报错** —— 假阳性比不说话更糟。
  // ✅ 可靠信号 = **连点两次**：面板打开时会盖住按钮，用户根本点不到；
  //    能点第二次就说明面板没出现。据此提示一次，既不会误报，也不至于毫无反馈。
  onAvatarTap() {
    if (this._avatarPicked) return;                 // 已经成功选过一次，不再打扰
    const now = Date.now();
    if (this._avatarLastTap && now - this._avatarLastTap < 4000) {
      this._avatarLastTap = 0;                      // 连点两次仍无反应 → 给一次说明
      wx.showModal({
        title: '头像选择没有弹出',
        content: '你可以先点右边的昵称输入框，用系统弹出的「使用微信昵称」填入昵称。'
          + '若头像面板一直不出现，请在小程序后台的《隐私保护指引》里确认已声明「微信昵称、头像」。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    this._avatarLastTap = now;
  },
  onChooseAvatar(e) {
    this._avatarPicked = true;                 // 成功回调到达 → 后续不再触发上面的提示
    const url = e && e.detail && e.detail.avatarUrl;
    if (!url) return;
    wx.showLoading({ title: '上传中' });
    wx.cloud.uploadFile({
      cloudPath: 'avatars/' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.png',
      filePath: url
    }).then(up => {
      wx.hideLoading();
      this.setData({ avatar: up.fileID });
      // ⚠️ 选完就即时落库，不再只提示「记得点保存」：
      //    用户选完头像直接退出页面 → 头像丢失 → 表现为「选了微信头像但这里没同步」（2026-09-20 真机反馈）。
      this.autoSaveProfile('头像已同步');
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '头像上传失败', icon: 'none' });
    });
  },
  // 昵称同步（type=nickname → 聚焦即弹系统「使用微信昵称」，用户点一下直接关联微信昵称）：
  //  · bindinput 只做本地实时预览（点了微信昵称要立刻在框里看到变化）；
  //  · bindblur 才落库 —— 与头像 chooseAvatar 选完即 autoSaveProfile 对齐，
  //    实现提示文案承诺的「选好即自动保存」，解决「选了微信昵称但这里没同步」。
  //    （注意：微信「使用微信昵称」快捷填充的值在 blur 才落，所以保存绑在 blur 而非 input）
  onNicknameInput(e) { this.setData({ nickname: (e && e.detail && e.detail.value) || '' }); },
  onNicknameBlur(e) {
    const v = (e && e.detail && e.detail.value) || '';
    this.setData({ nickname: v });
    if (v.trim()) this.autoSaveProfile('昵称已同步');
  },
  // 静默保存（只提交非空字段，服务端同样只写非空字段）
  autoSaveProfile(okTip) {
    const nickname = String(this.data.nickname || '').trim();
    const avatar = this.data.avatar || '';
    if (!nickname && !avatar) return;
    wx.cloud.callFunction({ name: 'vp_get_profile', data: { action: 'updateProfile', nickname, avatar } })
      .then(() => {
        if (okTip) wx.showToast({ title: okTip, icon: 'none' });
        this.loadProfile(true);   // 回读确认真的落库了（保存成功 ≠ 落库成功）
      })
      .catch(() => { /* 静默：用户仍可点「保存资料」重试 */ });
  },
  onSaveProfile() {
    if (this.data.savingProfile) return;
    const nickname = this.data.nickname.trim();
    const avatar = this.data.avatar;
    if (!nickname && !avatar) { wx.showToast({ title: '先填写昵称或选择头像', icon: 'none' }); return; }
    this.setData({ savingProfile: true });
    wx.cloud.callFunction({ name: 'vp_get_profile', data: { action: 'updateProfile', nickname, avatar } })
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'none' });
        this.loadProfile(true);
      })
      .catch(() => wx.showToast({ title: '保存失败，请重试', icon: 'none' }))
      .then(() => this.setData({ savingProfile: false }));
  },
  // 每日登录奖励（服务端幂等）：进页面自动检查一次，同一天不会重复发放。
  // ⚠️ 不按 dailyOn 提前 return：新人礼与签到共用同一个 action，提前返回会让
  //    「每日奖励关闭」时连新人礼也拿不到。服务端自己认 DAILY.enabled，多调无副作用。
  async checkDaily() {
    try {
      const res = await points.maybeDailyCheckin();
      this.applyDaily(res);
    } catch (e) {
      // 云函数未部署 / 网络异常时静默
    }
  },
  // 手动补领（客户端可重复调，服务端仍只发一次）
  async onClaimDaily() {
    if (!this.data.dailyOn || this.data.claiming) return;
    this.setData({ claiming: true, err: '' });
    try {
      const res = await points.dailyCheckin();
      this.applyDaily(res);
      this.refresh();
    } catch (e) {
      this.setData({ err: (e && e.message) ? e.message : '签到失败' });
    } finally {
      this.setData({ claiming: false });
    }
  },
  applyDaily(res) {
    const gift = (res && res.signupBonus) || 0;
    this.setData({
      streak: res.streak || 0,
      today: res.today || '',
      dailyChecked: !!(res.already || res.skipped || res.awarded > 0)
    });
    // 新人礼与签到可能在同一次调用里一起到账：合并成一条提示
    // （分两次 showToast 会互相覆盖，用户只会看到后一条）
    const awarded = res.awarded || 0;
    let title = '';
    if (gift > 0) {
      title = '🎉 新人礼 +' + gift + ' 积分' + (awarded > 0 ? '，签到 +' + awarded : '');
    } else if (awarded > 0) {
      title = res.milestone
        ? '连签 ' + res.streak + ' 天，+' + awarded + ' 积分！'
        : '签到成功 +' + awarded + ' 积分';
    }
    if (title) {
      wx.showToast({ title, icon: 'none', duration: 2600 });
      // 余额变了要重取（onShow 里的 refresh 发生在本次发放之前，显示的是旧余额）
      this.refresh();
    }
  },
  // 积分兑换：花 cost 积分换 grant 权益（服务端校验余额后扣减）
  async onRedeem(e) {
    const item = this.data.redeem[Number(e.currentTarget.dataset.idx)];
    if (!item) return;
    if (this.data.spending) return;
    // 同一权益只能持有一张：否则可以反复花积分买同一张券，纯亏积分（服务端也会兜底拒绝）
    if (this.hasCoupon(item.grant && item.grant.type)) {
      wx.showToast({ title: '已拥有该权益，无需重复兑换', icon: 'none' });
      return;
    }
    if (this.data.points < item.cost) {
      wx.showToast({ title: '积分不足', icon: 'none' });
      return;
    }
    this.setData({ spending: true, err: '' });
    try {
      const r = await points.spend(item.id, item.cost, item.grant);
      this.setData({ points: r.points });
      wx.showToast({ title: '兑换成功', icon: 'success' });
      this.refresh();          // 刷新优惠券
      this.guideToUse(item);   // 兑换后给「去哪用」的下文，别让用户换完就没了
    } catch (err) {
      this.setData({ err: (err && err.message) ? err.message : '兑换失败' });
    } finally {
      this.setData({ spending: false });
    }
  },
  // 积分充值：选 pack → 个人虚拟支付（名义=购买虚拟商品/积分权益包）
  async onRecharge(e) {
    const pack = this.data.packs[Number(e.currentTarget.dataset.idx)];
    if (!pack) return;
    if (this.data.recharging) return;
    if (!this.data.rechargeEnabled) {
      wx.showToast({ title: '充值未开放', icon: 'none' });
      return;
    }
    this.setData({ recharging: true, err: '' });
    try {
      await pay.payByVirtual({
        productId: pack.productId,
        priceFen: pack.priceFen,
        itemName: pack.name
      });
      // 充值结果由 vp_deliver 发货推送权威到账；稍后刷新（推送可能延迟）
      wx.showToast({ title: '支付成功，积分到账中', icon: 'none' });
      setTimeout(() => this.refresh(), 2500);
    } catch (err) {
      this.setData({ err: (err && err.message) ? err.message : '支付未完成' });
    } finally {
      this.setData({ recharging: false });
    }
  },
  // ── 分享能力（个人主体：复制链接 wxaurl.cn 受限，改用「转发给好友 + 朋友圈」传播）──
  onShareAppMessage() {
    return {
      title: 'dudu 画面感｜积分与权益中心',
      path: '/pages/points/points'
    };
  },
  onShareTimeline() {
    return {
      title: 'dudu 画面感｜积分与权益中心',
      query: ''
    };
  },
  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }
});
