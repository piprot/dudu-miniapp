// pages/spark/spark.js —— 每日一句（2026-10-06 新增 · 纯本地静态库，零 AI）
// 复用 daily.todayQuote() 本地确定性轮换文案库，提供：
//   ① 今日灵感（每天自动换一条）② 随机换一句 ③ 存金句馆 ④ 预览成卡（日签）。
// 2026-10-06 起启用积分：每次成卡扣 8 分（charge('sparkCard')，单价见 config.POINTS.cost）。
// 同时并入 utils/calendar_mix 的节气与东西方节日今日文案（见calendarBlock）。
const daily = require('../../utils/templates/daily');
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { addQuote } = require('../../utils/quotes_store');
const { THEME_LIST } = require('../../utils/themes/index.js');
const privacyPanel = require('../../utils/privacy_panel.js');
const { charge } = require('../../utils/charge.js');

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
    // ── 今日应景（2026-10-06 从「节气」页并入「每日一句」）──
    // 原来节气/节日文案只在 solar 页，用户要专门切页才能看到今天是什么日子。
    // 现按用户要求并入每日一句：日期行下面直接挂「今日 · XX」+ 应景文案，
    // 与主金句并存（主金句仍是主体，应景文案是补充，不抢焦点）。
    almanacText: '',      // 农历丙午年八月廿六
    ganzhiZodiac: '',     // 丙午年 · 马
    todayName: '',        // 今日节日/节气名，无则空
    todayText: '',        // 应景文案，无则空
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
    this.loadAlmanac();
  },

  // 今日历法 + 应景文案：节气 > 农历节日 > 西方节日 > 无（留空）
  loadAlmanac() {
    let lf = null, fest = null, term = null;
    try {
      const L = require('../../utils/calendar_mix');
      lf = L.lunarFull(new Date());
      fest = L.pickFestival(new Date());
    } catch (e) { /* 历法模块异常不应拖垮每日一句 */ }
    try {
      term = require('../../utils/solar_terms').pickForToday();
    } catch (e) { /* 同上 */ }
    // 优先级与 solar 页一致：节气 > 农历/西方节日
    let name = '', text = '';
    if (term && term.type !== 'normal') { name = term.name; text = term.text; }
    else if (fest) { name = fest.name; text = fest.text; }
    this.setData({
      almanacText: lf ? lf.lunarText : '',
      ganzhiZodiac: lf ? (lf.ganzhi + '年 · ' + lf.zodiac) : '',
      todayName: name,
      todayText: text
    });
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
    // kind='daily' 让金句馆能按来源筛选（2026-10-06 统一收藏库后新增）
    addQuote({ text, tags: ['每日一句'], source: '每日一句', kind: 'daily' });
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
    const self = this;
    // ⚠️ 扣费在前、渲染在后：积分不足时**不产出**（charge 会 reject 并弹引导）。
    //    切主题走 mixin.repaint 只重绘已出的卡，不重复扣费。
    //    改价只动 utils/config.js 的 POINTS.cost.sparkCard，云函数 GEN_COST 同名同值。
    charge('sparkCard', { label: '每日一句卡' }).then(() => {
      this._lastPreview = data;
      this.setData({ err: '' });
      return renderCard(self, { canvasId: '#sparkCanvas', type: 'dailysign', theme: self.data.theme, data })
        .catch(err => { self.setData({ err: (err && err.message) || '生成失败' }); });
    }).catch(() => {
      self.setData({ err: '' });
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
