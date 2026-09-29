// pages/comic/comic.js —— 画面感分镜编辑器（A 方向，纯本地 canvas，零 AI）
// 用户写文字脚本 → 解析 → 本地 canvas 渲染多格分镜图 → 存相册。
// 全程不调用云端 / 不生成内容，不构成深度合成，个人主体可过审。
const { parseScript } = require('../../utils/comic_markup');
const { computeLayout, draw } = require('../../utils/comic_render');

const SAMPLES = {
  story: `# 江边的告别
【分镜1】
场景：江边傍晚
旁白：那天下班，风很轻
小明：你真的要走了吗
小红：嗯，车票已经买好了
情绪：忧伤

【分镜2】
旁白：很多年后，我还记得那个背影
情绪：温馨`,
  sell: `# 一本让我开窍的书
【分镜1】
旁白：以前写文案像挤牙膏
我：到底差在哪
情绪：紧张

【分镜2】
旁白：直到用了「结构模板」
我：原来不是文笔，是骨架
情绪：欢乐`,
  tutorial: `# 三步做出画面感
【分镜1】
旁白：第一步，写下你的故事
情绪：默认

【分镜2】
旁白：第二步，套一个结构模板
情绪：默认

【分镜3】
旁白：第三步，一键出分镜图
情绪：欢乐`
};

function getDpr() {
  try {
    const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return info.pixelRatio || 2;
  } catch (e) { return 2; }
}

Page({
  data: {
    script: SAMPLES.story,
    cols: 2,
    rendered: false,
    canvasH: 0,
    err: '',
    showHelp: false
  },

  onLoad() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  onScriptInput(e) {
    this.setData({ script: e.detail.value, err: '' });
  },

  onLoadSample(e) {
    const kind = e.currentTarget.dataset.kind;
    const s = SAMPLES[kind];
    if (s) this.setData({ script: s, err: '', rendered: false });
  },

  onToggleHelp() {
    this.setData({ showHelp: !this.data.showHelp });
  },

  onClear() {
    this.setData({ script: '', rendered: false, err: '', canvasH: 0 });
  },

  onToggleCols() {
    const cols = this.data.cols === 2 ? 1 : 2;
    this.setData({ cols });
    if (this.data.rendered) this.renderComic();
  },

  // 解析 + 渲染到 canvas（2d 模式）。
  onGenComic() {
    const model = parseScript(this.data.script);
    if (!model.panels.length) {
      this.setData({ err: '脚本里还没有分镜内容：用【分镜】或 --- 起头，写几句旁白 / 对白试试', rendered: false });
      return;
    }
    this.setData({ err: '' });
    this.renderComic(model);
  },

  renderComic(model) {
    const self = this;
    const m = model || parseScript(this.data.script);
    wx.createSelectorQuery().select('#comicCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        self.setData({ err: '画布初始化失败，请重试' });
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = getDpr();
      const cssW = res[0].width || 340;
      const layout = computeLayout(m, { width: cssW, cols: self.data.cols }, (t, f) => {
        ctx.font = f;
        return ctx.measureText(t).width;
      });
      canvas.width = Math.round(layout.width * dpr);
      canvas.height = Math.round(layout.height * dpr);
      ctx.scale(dpr, dpr);
      draw(ctx, layout, { width: layout.width, cols: self.data.cols });
      self.canvasNode = canvas;
      self.setData({ canvasH: layout.height, rendered: true });
    });
  },

  onSaveImage() {
    const self = this;
    if (!self.canvasNode) {
      wx.showToast({ title: '请先生成分镜', icon: 'none' });
      return;
    }
    wx.canvasToTempFilePath({
      canvas: self.canvasNode,
      success(r) { self.saveToAlbum(r.tempFilePath); },
      fail() { wx.showToast({ title: '导出失败，请重试', icon: 'none' }); }
    });
  },

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success() { wx.showToast({ title: '已存到相册', icon: 'success' }); },
      fail(e) {
        const msg = (e && e.errMsg) || '';
        if (/auth|deny|authorize/i.test(msg)) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许「保存到相册」',
            confirmText: '去设置',
            success(r) { if (r.confirm) wx.openSetting(); }
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  },

  onShareAppMessage() {
    return { title: '写文字脚本，一键出分镜图 · dudu 画面感', path: '/pages/comic/comic' };
  },
  onShareTimeline() {
    return { title: '写文字脚本，一键出分镜图 · dudu 画面感', query: '' };
  }
});
