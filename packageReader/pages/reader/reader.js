// ⚠️ 本页在分包 packageReader 内，比原来的 pages/reader 深一层，
//    故 require 主包 utils 要多退一级（../../../utils），少退一级会解析到 packageReader/utils 而报模块找不到。
//    分包引用主包代码是官方允许的方向；反过来（主包引用分包）不允许。
const { PRODUCT } = require('../../../utils/config.js');
const store = require('../../../utils/store.js');
const pay = require('../../../utils/pay.js');

// 面板已随本页一起搬入分包：packageReader/panels/。
// 分包页面引用分包内资源没问题；主包页面不能引用这里（pages/commission 另用 images/samples/ 缩略图）。
const PANEL_BASE = '/packageReader/panels/';
const SUBPACKAGE_NAME = 'reader';   // 与 app.json subPackages[0].name 一致

Page({
  data: {
    chapterName: '',
    panels: [],     // 形如 /packageReader/panels/e01_p01_sm.jpg
    showPay: false,
    subReady: false, // 分包是否已就绪（规避首进分包下载竞态导致画格加载失败）
    loadedCount: 0, // 已成功加载的画格数
    loadErr: 0,     // 加载失败的画格数（>0 显示重试）
    showError: false
  },
  onLoad(query) {
    const id = query.ch || 'e01';
    this.shareCh = id;
    const ch = PRODUCT.chapters.find(c => c.id === id) || PRODUCT.chapters[0];
    if (!store.canRead(ch)) {
      // 兜底：未解锁则提示去购买
      this.setData({ showPay: true, chapterName: ch.name });
      return;
    }
    wx.setNavigationBarTitle({ title: ch.name });
    // 关键修复：先确认分包已下载完成，再渲染画格。否则首进分包时图片会先于
    // 分包资源就绪而 binderror，表现为「部分画面加载失败（N 张）」。
    // 页面能打开即说明分包已加载，故 success 通常立即回调；网络慢时则等到下载完成。
    this.ensureSubpackage(() => this.renderChapter(ch));
  },
  ensureSubpackage(done) {
    if (typeof wx.loadSubpackage !== 'function') { done(); return; }
    wx.loadSubpackage({
      name: SUBPACKAGE_NAME,
      success: () => done(),
      fail: (e) => {
        console.error('[reader] 分包下载失败:', e);
        this.setData({ showError: true, loadErr: 1 });
      }
    });
  },
  renderChapter(ch) {
    this.setData({
      chapterName: ch.name,
      panels: ch.panels.map(p => PANEL_BASE + p + '.jpg'),
      subReady: true,
      loadedCount: 0,
      loadErr: 0,
      showError: false
    });
  },
  onShow() {
    // 进入页面时向服务端校正解锁态（虚拟支付发货推送可能刚到达）
    if (!store.isUnlockedAll()) {
      pay.confirmVirtualUnlock().then(unlocked => {
        if (unlocked && this.data.showPay) {
          // 刚被发货解锁：重载当前章节内容
          const ch = PRODUCT.chapters.find(c => c.name === this.data.chapterName);
          if (ch && store.canRead(ch)) {
            this.renderChapter(ch);
            this.setData({ showPay: false });
          }
        }
      });
    }
  },
  // 加载计数 / 失败计数（真机空白排查）
  onPanelLoad() {
    this.setData({ loadedCount: this.data.loadedCount + 1 });
  },
  onPanelError() {
    const loadErr = this.data.loadErr + 1;
    this.setData({ loadErr });
    // 分包已就绪却仍有失败：可能是个别资源解码失败，标记错误视图由用户「重新加载」
    if (this.data.subReady) this.setData({ showError: true });
  },
  onRetryLoad() {
    const ch = PRODUCT.chapters.find(c => c.name === this.data.chapterName) || PRODUCT.chapters[0];
    this.renderChapter(ch);
  },
  goPay() {
    wx.navigateTo({ url: '/pages/pay/pay' });
  },
  // ── 分享能力（个人主体：复制链接 wxaurl.cn 受限，改用「转发给好友 + 朋友圈」传播）──
  // 阅读页带章节参数：分享后好友打开直接落到同一章。
  onShareAppMessage() {
    const ch = this.shareCh || 'e01';
    return {
      title: '《美汐的故事》· ' + (this.data.chapterName || '画面感内容'),
      path: '/packageReader/pages/reader/reader?ch=' + ch
    };
  },
  onShareTimeline() {
    const ch = this.shareCh || 'e01';
    return {
      title: '《美汐的故事》· ' + (this.data.chapterName || '画面感内容'),
      query: 'ch=' + ch
    };
  },
  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }
});
