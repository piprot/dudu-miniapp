const { COMMISSION, PAY_CONFIG } = require('../../utils/config.js');
const pay = require('../../utils/pay.js');
const points = require('../../utils/points.js');

// 付费定制画面感内容（2026-09-18 重构）：
//   选档（PDF ¥66 / 网页 ¥88）→ 虚拟支付 → 填邮箱（故事自动带上）→ 落库 → 确认页（8 小时人工回邮）。
//   客户全程看不到「剧本脚本」——脚本是我们履约时内部使用的工作稿。
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const STORY_MAX = 30000;  // 故事上限（与云函数 custom_request STORY_MAX 一致，用户要求 3 万字）
const NOTE_MAX = 500;     // 补充说明上限（与服务端 NOTE_MAX 一致）

Page({
  data: {
    tiers: [],             // [{ productId, name, priceFen, priceText, desc, sel }]
    story: '',             // 用户的故事（gen 页带入，可在本页修改/补写；必填）
    note: '',              // 补充说明（画风/篇幅/交付格式等，可选）
    storyMax: STORY_MAX,
    noteMax: NOTE_MAX,
    storyErr: '',
    // 步骤态：select(选档) → paying(支付中) → email(填邮箱) → done(确认页)
    step: 'select',
    email: '',
    emailErr: '',
    paying: false,
    submitting: false,
    paidProductId: '',
    paidOutTradeNo: '',
    deliveryHours: COMMISSION.deliveryHours || 8,
    contact: COMMISSION.contact || { email: '', wechat: '' },
    authorWechat: PAY_CONFIG.authorWechat,
    coupon: null,          // 积分兑换来的 9 折券（无则 null）
    couponTip: '',         // 持券提示（顶部，简）
    couponDetail: '',      // 券后价明细（原价/微信仍付全款/履约退差/券后实付）
    couponFinal: '',       // 确认页：本单用券结论
    err: '',
    // 交互升级：复制翻转反馈 + 邮箱/故事错误抖动（tick 奇偶交替重放动画）
    contactCopied: false,
    emailShakeTick: 0,
    storyShakeTick: 0
  },
  onLoad(query) {
    const tiers = (COMMISSION.tiers || []).map((t, i) => ({ ...t, sel: i === 0 }));
    // 从 gen 页带来的故事（encodeURIComponent 过），支付成功后随邮箱落库
    let story = '';
    if (query && query.story) {
      try { story = decodeURIComponent(query.story); } catch (e) { story = ''; }
    }
    this.setData({ tiers, story });
    this.loadCoupon();
  },

  onShow() {
    this.loadCoupon();
  },

  // 读取用户持有的 9 折券（积分兑换而来）。
  // 2026-09-20 真机反馈：「100 积分兑换画面感内容 9 折券，积分逻辑不通，并没有接续」——
  // 券已经写进 vp_users.coupons，但**下单页从来没有读过它**，换完就等于石沉大海。
  // 这里把它接上：页面顶部明示已持券，下单时随订单一起落库，运营按券减免。
  // （定价权在服务端道具目录 vp_create_order.PRODUCTS，前端不能改支付金额，
  //   而定制本就是 8 小时人工交付 + 客服微信沟通，故走「带券下单 → 客服减免」。）
  loadCoupon() {
    points.getBalance().then(r => {
      const c = (r.coupons || []).find(x => x && x.type === 'comic_discount');
      if (!c) { this.setData({ coupon: null }); this.refreshCouponTip(); return; }
      const v = Number(c.value) > 0 && Number(c.value) < 1 ? Number(c.value) : 0.9;
      this.setData({ coupon: c }, () => this.refreshCouponTip());
    }).catch(() => { /* 云函数未部署 / 网络异常：静默，不挡下单 */ });
  },

  // 把「用券后到底付多少」讲清楚：个人虚拟支付固定收全款，券以履约退差价形式落地。
  // 选档切换时同步刷新，让用户在下单前就看到券后实付。
  refreshCouponTip() {
    const c = this.data.coupon;
    if (!c) { this.setData({ couponTip: '', couponDetail: '' }); return; }
    const v = Number(c.value) > 0 && Number(c.value) < 1 ? Number(c.value) : 0.9;
    const tier = this.data.tiers.find(t => t.sel);
    const priceFen = tier ? Number(tier.priceFen) : 0;
    const off = Math.round(priceFen * (1 - v));
    const yuan = (priceFen / 100).toFixed(2);
    const offYuan = (off / 100).toFixed(2);
    const finalYuan = ((priceFen - off) / 100).toFixed(2);
    this.setData({
      couponTip: '🎫 你有 1 张 ' + (v * 10).toFixed(v * 10 % 1 === 0 ? 0 : 1) + ' 折券',
      couponDetail: (tier ? '本单（' + tier.name + ' 原价 ¥' + yuan + '）：' : '')
        + '微信仍付全款 ¥' + yuan + '，履约后退还 ¥' + offYuan + '，券后实付 ¥' + finalYuan
    });
  },

  onSelectTier(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ tiers: this.data.tiers.map(t => ({ ...t, sel: t.productId === id })), err: '' });
    this.refreshCouponTip();
  },

  async onPay() {
    if (this.data.paying) return;
    const tier = this.data.tiers.find(t => t.sel);
    if (!tier) { this.setData({ err: '请先选择一个档位' }); return; }
    this.setData({ paying: true, err: '' });
    try {
      const outTradeNo = await pay.payByVirtual({ productId: tier.productId });
      this.setData({ step: 'email', paidProductId: tier.productId, paidOutTradeNo: outTradeNo || '' });
    } catch (e) {
      const msg = (e && e.errMsg) || e.message || '';
      if (String(msg).indexOf('cancel') >= 0) {
        this.setData({ err: '支付已取消，可随时重新下单' });
      } else {
        this.setData({ err: '支付未完成：' + (msg || '未知错误') });
      }
    } finally {
      this.setData({ paying: false });
    }
  },

  onInputEmail(e) { this.setData({ email: e.detail.value, emailErr: '', err: '' }); },
  onInputStory(e) { this.setData({ story: e.detail.value, storyErr: '', err: '' }); },
  onInputNote(e) { this.setData({ note: e.detail.value, err: '' }); },

  async onSubmitEmail() {
    if (this.data.submitting) return;
    const email = this.data.email.trim();
    const story = this.data.story.trim();
    if (!EMAIL_RE.test(email)) {
      this.setData({ emailErr: '邮箱格式不正确，请检查（例：name@example.com）', emailShakeTick: (this.data.emailShakeTick || 0) + 1 });
      return;
    }
    // 故事必填：设计师需要按你的文字开工，缺了就没法做
    if (!story) {
      this.setData({ storyErr: '请写下你想做成画面感内容的故事或要点，设计师才能开工', storyShakeTick: (this.data.storyShakeTick || 0) + 1 });
      return;
    }
    this.setData({ submitting: true, err: '' });
    try {
      const r = await wx.cloud.callFunction({
        name: 'custom_request',
        data: {
          action: 'save',
          productId: this.data.paidProductId,
          email,
          story,
          note: this.data.note.trim(),
          outTradeNo: this.data.paidOutTradeNo || '',
          // 把券信息随订单落库 → 运营侧（ops/list-orders.py）能看到并按券减免。
          // 这是「兑换 → 使用」链路的最后一环，缺了它券就只是个摆设。
          coupon: this.data.coupon
            ? { type: this.data.coupon.type, value: this.data.coupon.value }
            : null
        }
      });
      const res = r.result || {};
      if (res.ok) {
        // 用券则记录券后实付结论，确认页显眼提示运营将退差
        const c = this.data.coupon;
        const tier = this.data.tiers.find(t => t.sel);
        let couponFinal = '';
        if (c && tier) {
          const v = Number(c.value) > 0 && Number(c.value) < 1 ? Number(c.value) : 0.9;
          const off = Math.round(Number(tier.priceFen) * (1 - v));
          couponFinal = '已用 ' + (v * 10).toFixed(v * 10 % 1 === 0 ? 0 : 1) + ' 折券：微信已收全款 ¥'
            + (Number(tier.priceFen) / 100).toFixed(2) + '，履约后将退还 ¥' + (off / 100).toFixed(2)
            + '，券后实付 ¥' + ((Number(tier.priceFen) - off) / 100).toFixed(2);
        }
        this.setData({ step: 'done', couponFinal });
      }
      else this.setData({ err: res.err || '提交失败，请重试' });
    } catch (e) {
      this.setData({ err: '提交失败：' + ((e && e.errMsg) || '未知错误') });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onCopyContact() {
    const c = this.data.contact;
    // 翻转反馈：按钮翻转变绿显示「✓ 已复制」，1.6s 后复原
    wx.setClipboardData({
      data: c.email + ' / 微信 ' + c.wechat,
      success: () => {
        this.setData({ contactCopied: true });
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => { this.setData({ contactCopied: false }); }, 1600);
      },
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    });
  },
  onBackHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
  // ── 分享能力（个人主体：复制链接 wxaurl.cn 受限，改用「转发给好友 + 朋友圈」传播）──
  onShareAppMessage() {
    return {
      title: '定制你的画面感内容 · dudu 画面感',
      path: '/pages/commission/commission'
    };
  },
  onShareTimeline() {
    return {
      title: '定制你的画面感内容 · dudu 画面感',
      query: ''
    };
  },
  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }
});
