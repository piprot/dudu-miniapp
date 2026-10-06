// pages/solar/solar.js —— 节气·今日文案（2026-10-06 新增 · 免费本地工具，零 AI）
// 参照「随身文案库」的「来源分类 / 节日应景」思路，做纯本地节气/节日文案成卡：
//   ① 自动显示今日应景文案（节气 > 节日 > 普通日兜底）
//   ② 浏览 24 节气 / 常用节日，点任一条即预览成卡
//   ③ 一键存金句馆
// 纯静态本地数据（utils/solar_terms.js），零 AI、零网络（个人主体合规）。
const { SOLAR_TERMS, FESTIVALS, pickForToday, pickAnotherNormal } = require('../../utils/solar_terms');
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { addQuote } = require('../../utils/quotes_store');
const { THEME_LIST } = require('../../utils/themes/index.js');
const { dateLabelOf } = require('../../utils/daily_rotate');
const cardStyle = require('../../utils/card_style_mixin');  // 排版风格 + 背景图（四页共用）
const privacyPanel = require('../../utils/privacy_panel.js');

const __pageCfg = {
  data: Object.assign({
    privacyShow: false,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    today: { type: 'normal', name: '', text: '' },
    termList: SOLAR_TERMS.map(t => ({ name: t.name, text: t.text, date: t.month + '/' + t.day })),
    festivalList: FESTIVALS.map(t => ({ name: t.name, text: t.text, date: t.month + '/' + t.day })),
    tab: 'term',          // 'term' | 'festival'
    sel: { name: '', text: '' },
    todayTap: 0,          // 「换一条」点击次数
    canvasH: 0,
    rendered: false,
    err: '',
    savedTick: 0,
    savedKey: ''
  }, cardStyle.defaults('literary')),   // 日签气质默认文艺风

  onLoad() {
    this.initCardStyle('literary');
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

  // 「换一条」：仅普通日可换（节气/节日是固定文案，换了就不应景了）。
  // 每次点击 tap+1，并按新种子重新取一条，立即重绘预览。
  onShuffleToday() {
    if (this.data.today.type !== 'normal') {
      wx.showToast({ title: '节气/节日文案固定，不可换', icon: 'none', duration: 2000 });
      return;
    }
    const tap = (this.data.todayTap || 0) + 1;
    const text = pickAnotherNormal(new Date(), tap);
    this.setData({ todayTap: tap, today: Object.assign({}, this.data.today, { text }) }, () => {
      this.preview(dateLabelOf(), text);
    });
  },

  preview(name, text) {
    if (!text) return;
    this.setData({ sel: { name, text } });
    const data = cardStyle.applyCardStyle(this, { title: name, body: text, author: 'dudu 画面感' });
    this._lastData = { type: 'dailysign', theme: this.data.theme, data };
    this._cardOpts = { canvasId: '#solarCanvas', type: 'dailysign', theme: this.data.theme, data };
    const self = this;
    this.setData({ err: '' });
    renderCard(this, { canvasId: '#solarCanvas', type: 'dailysign', theme: this.data.theme, data }).catch(err => {
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
    // ⚠️ 兼容组件上抛（e.detail.id）与页面直绑（e.currentTarget.dataset.id）。
    //    主题行移进 card-config 组件后事件走 e.detail，只读 currentTarget 会静默失效。
    const id = ((e && e.detail && e.detail.id) ||
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id));
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id });
    if (this._lastData) {
      this._lastData.theme = id;
      this._cardOpts = Object.assign({}, this._cardOpts, { theme: id });
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

// 注入风格/背景交互（与天气/金句/台词书摘同一套）
Object.assign(__pageCfg, cardStyle.cardStyleMethods);
Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
