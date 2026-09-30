// pages/card/card.js —— 画面感卡片 / 海报生成器（B 方向，纯本地 canvas，零 AI）
// 选模板 → 填文字（可选本地选图）→ 本地 canvas 渲染卡片 → 存相册。
// 全程不调用云端 / 不生成内容，不构成深度合成，个人主体可过审。
const { CARD_TEMPLATES, computeCardLayout, drawCard } = require('../../utils/card_render');

const TYPE_KEYS = ['dailysign', 'quote', 'recommend', 'notice', 'checklist', 'imagetext'];

// 每日日签的二维码（打包进小程序包内，绘制到卡片右下角）。
const QR_PATH = '/images/qrcode_miniapp.png';

// 今日日期标签：「9月30日 · 星期三」。
function todayLabel() {
  const d = new Date();
  const wk = '日一二三四五六'.charAt(d.getDay());
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + wk;
}

function getDpr() {
  try {
    const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return info.pixelRatio || 2;
  } catch (e) { return 2; }
}

// 各模板的默认占位文本，降低首用门槛。
const SEED = {
  dailysign: { type: 'dailysign', title: todayLabel(), body: '把日子过成自己喜欢的样子。' },
  quote: { type: 'quote', title: '', body: '把复杂的事，讲简单；把简单的事，做扎实。', author: '' },
  recommend: { type: 'recommend', title: '推荐一件好物', body: '用了就回不去的小确幸，今天安利给你。', tag: '¥ 39 起', cover: '' },
  notice: { type: 'notice', title: '活动公告', body: '本周六晚 8 点，社群分享会准时开始，欢迎来聊。', author: '' },
  checklist: { type: 'checklist', title: '今日待办', items: ['梳理今天的三件要事', '写下一条朋友圈文案', '读 10 页书'], cover: '' },
  imagetext: { type: 'imagetext', title: '一张图，一段话', body: '记录此刻，分享给在意的人。', cover: '' }
};

Page({
  data: {
    types: TYPE_KEYS.map(k => ({ key: k, name: CARD_TEMPLATES[k].name, hint: CARD_TEMPLATES[k].hint })),
    type: 'dailysign',
    form: SEED.dailysign,
    cover: '',
    showHelp: false,
    err: '',
    rendered: false,
    canvasH: 0
  },

  onLoad() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  onSelectType(e) {
    const k = e.currentTarget.dataset.key;
    const seed = Object.assign({}, SEED[k]);
    if (seed.items) seed.items = seed.items.join('\n'); // 清单以换行编辑
    this.setData({ type: k, form: seed, cover: seed.cover || '', rendered: false, err: '' });
  },

  onField(e) {
    const field = e.currentTarget.dataset.field;
    const val = e.detail.value;
    const form = Object.assign({}, this.data.form, { [field]: val });
    // 清单：把文本框按行转数组（渲染时再用）。
    this.setData({ form });
  },

  onToggleHelp() {
    this.setData({ showHelp: !this.data.showHelp });
  },

  onChooseImage() {
    const self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(r) {
        const p = r.tempFiles && r.tempFiles[0] && r.tempFiles[0].tempFilePath;
        if (p) {
          self.setData({ cover: p, form: Object.assign({}, self.data.form, { cover: p }), rendered: false });
          wx.showToast({ title: '已选图，点生成', icon: 'none' });
        }
      },
      fail() { /* 用户取消，忽略 */ }
    });
  },

  buildModel() {
    const f = this.data.form;
    const model = { type: this.data.type };
    if (f.title !== undefined) model.title = f.title;
    if (f.body !== undefined) model.body = f.body;
    if (f.author !== undefined) model.author = f.author;
    if (f.tag !== undefined) model.tag = f.tag;
    if (this.data.cover) model.cover = this.data.cover;
    if (this.data.type === 'checklist') {
      model.items = String(f.items || '').split('\n').map(s => s.trim()).filter(Boolean);
    }
    // 每日日签：右下角固定叠加包内小程序码（全自动，无需选图）。
    if (this.data.type === 'dailysign') {
      model.qr = QR_PATH;
      model.title = model.title || todayLabel();   // 标题留空时自动用今天日期
    }
    return model;
  },

  onGenCard() {
    const model = this.buildModel();
    const hasText = (model.title || model.body || (model.items && model.items.length) || model.author);
    const tpl = CARD_TEMPLATES[this.data.type];
    if (!hasText && !(tpl.hasCover && model.cover)) {
      this.setData({ err: '先填点内容，或选一张图再生成', rendered: false });
      return;
    }
    this.setData({ err: '' });
    this.renderCard(model);
  },

  renderCard(model) {
    const self = this;
    const m = model || self.buildModel();
    wx.createSelectorQuery().select('#cardCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        self.setData({ err: '画布初始化失败，请重试' });
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = getDpr();
      const cssW = res[0].width || 340;

      const layout = computeCardLayout(m, { width: cssW }, (t, f) => {
        ctx.font = f;
        return ctx.measureText(t).width;
      });

      // 加载本地图片（封面 / 二维码）。全部加载完（失败也继续，对应槽位置 null）再绘制。
      const loadImg = (src) => new Promise(resolve => {
        const img = canvas.createImage();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
      const jobs = [];
      if (m.cover) jobs.push(loadImg(m.cover).then(im => { self._coverImg = im; }));
      else self._coverImg = null;
      if (m.qr) jobs.push(loadImg(m.qr).then(im => { self._qrImg = im; }));
      else self._qrImg = null;

      const drawAll = () => {
        canvas.width = Math.round(layout.width * dpr);
        canvas.height = Math.round(layout.height * dpr);
        ctx.scale(dpr, dpr);
        drawCard(ctx, layout, { model: m, coverImg: self._coverImg, qrImg: self._qrImg });
        self.canvasNode = canvas;
        self.setData({ canvasH: layout.height, rendered: true });
      };

      Promise.all(jobs).then(drawAll);
    });
  },

  onSaveImage() {
    const self = this;
    if (!self.canvasNode) {
      wx.showToast({ title: '请先生成卡片', icon: 'none' });
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
    return { title: '选模板填文字，一键出卡片海报 · dudu 画面感', path: '/pages/card/card' };
  },
  onShareTimeline() {
    return { title: '选模板填文字，一键出卡片海报 · dudu 画面感', query: '' };
  }
});
