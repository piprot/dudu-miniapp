// pages/solar/solar.js —— 节气·今日文案（2026-10-06 新增 · 免费本地工具，零 AI）
// 参照「随身文案库」的「来源分类 / 节日应景」思路，做纯本地节气/节日文案成卡：
//   ① 自动显示今日应景文案（节气 > 节日 > 普通日兜底）
//   ② 浏览 24 节气 / 常用节日，点任一条即预览成卡
//   ③ 一键存金句馆
// 纯静态本地数据（utils/solar_terms.js），零 AI、零网络（个人主体合规）。
const { SOLAR_TERMS, FESTIVALS, pickForToday } = require('../../utils/solar_terms');
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { addQuote } = require('../../utils/quotes_store');
const { THEME_LIST } = require('../../utils/themes/index.js');
const privacyPanel = require('../../utils/privacy_panel.js');

const __pageCfg = {
  data: {
    privacyShow: false,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    today: { type: 'normal', name: '', text: '' },
    termList: SOLAR_TERMS.map(t => ({ name: t.name, text: t.text, date: t.month + '/' + t.day })),
    festivalList: FESTIVALS.map(t => ({ name: t.name, text: t.text, date: t.month + '/' + t.day })),
    tab: 'term',          // 'term' | 'festival'
    sel: { name: '', text: '' },
    canvasH: 0,
    rendered: false,
    err: '',
    savedTick: 0,
    savedKey: ''
  },

  onLoad() {
    const t = pickForToday();
    this.setData({ today: t, sel: { name: t.name, text: t.text } });
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },

  // 点节气/节日 → 设为当前并立即预览成卡
  onPickTerm(e) {
    const t = e.currentTarget.dataset;
    this.preview(t.name + ' · 节气', t.text);
  },
  onPickFestival(e) {
    const t = e.currentTarget.dataset;
    this.preview(t.name, t.text);
  },

  preview(name, text) {
    if (!text) return;
    this.setData({ sel: { name, text } });
    this._lastData = { type: 'dailysign', theme: this.data.theme, data: { title: name, body: text, author: 'dudu 画面感' } };
    const self = this;
    this.setData({ err: '' });
    renderCard(this, { canvasId: '#solarCanvas', type: 'dailysign', theme: this.data.theme, data: this._lastData.data }).catch(err => {
      self.setData({ err: (err && err.message) || '生成失败' });
    });
  },

  // 直接生成「今日」卡片
  onGenToday() {
    if (!this.data.today.text) { wx.showToast({ title: '今日无特别文案', icon: 'none' }); return; }
    this.preview(this.data.today.name, this.data.today.text);
  },

  onSaveToVault() {
    const text = this.data.sel.text;
    if (!text) return;
    addQuote({ text, tags: ['节气'], source: this.data.sel.name });
    wx.showToast({ title: '已存金句馆', icon: 'none' });
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id });
    if (this._lastData) {
      this._lastData.theme = id;
      renderCard(this, { canvasId: '#solarCanvas', type: this._lastData.type, theme: id, data: this._lastData.data }).catch(() => {});
    }
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
      historyTool: 'solar',
      historyRecord: { kind: 'solar', title: (self._lastData && self._lastData.data.title) || '节气文案' }
    }).then(() => self.flipSaved()).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return;
      if (/auth|deny|authorize/i.test(msg)) return;
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  },

  onShareAppMessage() {
    return { title: 'dudu 画面感 · 节气今日文案', path: '/pages/solar/solar' };
  }
};

Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
