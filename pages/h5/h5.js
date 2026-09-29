const { H5 } = require('../../utils/config.js');

// H5 桥接页：小程序内为纯文案工具（无 AI），完整作品与定制样板间放在网页版。
// 个人主体不支持 web-view 组件，故本页改为「展示 + 复制链接」桥接，不在端内嵌网页。
Page({
  data: {
    url: '',
    configured: false
  },
  onLoad(query) {
    // 允许通过 ?u= 临时覆盖（便于调试），否则用 config.H5.comicUrl
    let url = '';
    if (query && query.u) {
      try { url = decodeURIComponent(query.u); } catch (e) { url = ''; }
    } else if (H5 && H5.comicUrl) {
      url = H5.comicUrl;
    }
    this.setData({ url, configured: !!url });
  },
  // ── 复制网页链接（个人主体不支持 web-view，改用复制链接在浏览器打开）──
  onCopyUrl() {
    if (!this.data.url) return;
    wx.setClipboardData({
      data: this.data.url,
      success() { wx.showToast({ title: '已复制网页链接', icon: 'none' }); },
      fail() { wx.showToast({ title: '复制失败，请长按链接手动复制', icon: 'none' }); }
    });
  },
  // ── 分享能力（个人主体：原生转发/朋友圈正常开放）──
  onShareAppMessage() {
    return {
      title: '来看看这些画面感内容 · dudu 画面感',
      path: '/pages/h5/h5'
    };
  },
  onShareTimeline() {
    return {
      title: '来看看这些画面感内容 · dudu 画面感',
      query: ''
    };
  },
  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }
});
