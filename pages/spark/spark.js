// pages/spark/spark.js —— 每日一句（2026-10-06 新增 · 免费本地工具，零 AI）
// 复用 daily.todayQuote() 本地确定性轮换文案库，提供：
//   ① 今日灵感（每天自动换一条）② 随机换一句 ③ 存金句馆 ④ 预览成卡（日签）。
// 全程本地；不调用 utils/charge（个人主体合规）。
const daily = require('../../utils/templates/daily');
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { addQuote } = require('../../utils/quotes_store');
const { THEME_LIST } = require('../../utils/themes/index.js');
const privacyPanel = require('../../utils/privacy_panel.js');

function dateLabel() {
  const d = new Date();
  const wk = '日一二三四五六'.charAt(d.getDay());
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + wk;
}

const __pageCfg = {
  data: {
    privacyShow: false,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    quote: { text: '', c: '' },
    dateLabel: '',
    canvasH: 0,
    rendered: false,
    err: '',
    savedTick: 0,
    savedKey: ''
  },

  onLoad() {
    this._offset = 0;
    const q = daily.todayQuote(0);
    this.setData({ quote: { text: q.text, c: q.c }, dateLabel: dateLabel() });
  },

  // 随机换一句（本地确定性轮换，跨天不撞车）
  onShuffle() {
    this._offset = (this._offset || 0) + 1;
    const q = daily.todayQuote(this._offset);
    this.setData({ quote: { text: q.text, c: q.c } });
  },

  // 存进金句收藏馆
  onSaveToVault() {
    const text = this.data.quote.text;
    if (!text) return;
    addQuote({ text, tags: ['每日一句'], source: '每日一句' });
    wx.showToast({ title: '已存金句馆', icon: 'none' });
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id });
    if (this._lastPreview) {
      renderCard(this, { canvasId: '#sparkCanvas', type: 'dailysign', theme: id, data: this._lastPreview }).catch(() => {});
    }
  },

  onPreview() {
    const data = { title: this.data.dateLabel, body: this.data.quote.text, author: '每日一句 · ' + (this.data.quote.c || '') };
    this._lastPreview = data;
    const self = this;
    this.setData({ err: '' });
    renderCard(this, { canvasId: '#sparkCanvas', type: 'dailysign', theme: this.data.theme, data }).catch(err => {
      self.setData({ err: (err && err.message) || '生成失败' });
    });
  },

  flipSaved() {
    const tick = (this.data.savedTick || 0) + 1;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this.setData({ savedTick: tick, savedKey: tick % 2 ? 'a' : 'b' });
    this._saveTimer = setTimeout(() => { this.setData({ savedKey: '' }); }, 1600);
  },

  onSaveImage() {
    const self = this;
    saveCanvas(self, {
      savingKey: '_saving',
      historyTool: 'spark',
      historyRecord: { kind: 'spark', title: String(self.data.quote.text || '').slice(0, 20) }
    }).then(() => self.flipSaved()).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return;
      if (/auth|deny|authorize/i.test(msg)) return;
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  },

  onShareAppMessage() {
    return { title: 'dudu 画面感 · 每日一句', path: '/pages/spark/spark' };
  }
};

Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
