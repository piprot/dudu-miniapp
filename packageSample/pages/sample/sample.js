// 成品示例阅读页（独立分包 packageSample）：原生渲染用户手工组装的网页版画面感内容，
// 视觉等同「网页版(comic_web)」交付形态，规避个人主体小程序无法用 web-view 的限制。
// 画格在 packageSample/sample_panels/（由 tools/extract_sample_panels.py 从
// samples/画面感内容_精简版_单文件.html 抽取，数量须与 COUNT 一致）。
// 单独成包是为了把示例画格(~1.5MB)与 reader 产品画格(1.6MB)各自控制在 2MB 上限内。
const PANEL_BASE = '/packageSample/sample_panels/';
const COUNT = 54;     // 画格总数（须与 tools/extract_sample_panels.py 抽出的张数一致）
// 只预览前 N 页：整本 54 页铺出来把页面拉得极长，用户滑不到底也看不出重点。
// 8 页足够看出画风与品质，又留得住「想看全本」的动机（2026-09-21 真机反馈）。
const PREVIEW = 8;

Page({
  data: {
    comicTitle: '真正的底气，从来都是自己挣来的',
    panels: [],
    preview: 0,
    total: COUNT
  },
  onLoad() {
    const pads = i => String(i).padStart(2, '0');
    const n = Math.min(PREVIEW, COUNT);
    const panels = [];
    for (let i = 1; i <= n; i++) panels.push(PANEL_BASE + 'p' + pads(i) + '.jpg');
    this.setData({ panels, preview: n });
    wx.setNavigationBarTitle({ title: '成品示例（预览）' });
  },
  onBack() {
    // 分包页面，且入口可能在栈底：reLaunch 回首页最稳（navigateBack 在栈只有一层时会失败）
    wx.reLaunch({ url: '/pages/index/index' });
  },
  // ── 分享能力（个人主体：复制链接 wxaurl.cn 受限，改用「转发给好友 + 朋友圈」传播）──
  onShareAppMessage() {
    return {
      title: '成品示例｜dudu 画面感内容',
      path: '/packageSample/pages/sample/sample'
    };
  },
  onShareTimeline() {
    return {
      title: '成品示例｜dudu 画面感内容',
      query: ''
    };
  },
  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }
});
