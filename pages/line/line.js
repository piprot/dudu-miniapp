// pages/line/line.js —— 台词 / 书摘卡（2026-10-06 新增 · 免费本地工具，零 AI）
// 参照「随身文案库」的「来源分类」思路：影视台词 / 书本摘录 / 名言 → 金句卡。
//   ① 选类型 ② 粘贴文本 + 出处 ③ 一键成卡（金句卡）。
// 全程本地；不调用 utils/charge（个人主体合规）。
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { THEME_LIST } = require('../../utils/themes/index.js');
const cardStyle = require('../../utils/card_style_mixin');  // 排版风格 + 背景图（四页共用）
const privacyPanel = require('../../utils/privacy_panel.js');

const KINDS = [
  { key: 'line', name: '台词' },
  { key: 'book', name: '书摘' },
  { key: 'famous', name: '名言' }
];
function kindName(k) { const it = KINDS.find(x => x.key === k); return it ? it.name : ''; }

const __pageCfg = {
  data: Object.assign({
    privacyShow: false,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    kinds: KINDS,
    kind: 'line',
    kindLabel: '台词',
    text: '',
    source: '',
    canvasH: 0,
    rendered: false,
    err: '',
    savedTick: 0,
    savedKey: ''
  }, cardStyle.defaults('literary')),   // 台词/书摘默认文艺风

  onLoad() { this.initCardStyle('literary'); },

  onPickKind(e) { this.setData({ kind: e.currentTarget.dataset.key, kindLabel: kindName(e.currentTarget.dataset.key) }); },

  onField(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  onGen() {
    const text = (this.data.text || '').trim();
    if (!text) { wx.showToast({ title: '先粘贴一段台词或书摘', icon: 'none' }); return; }
    const author = (this.data.source || '').trim() || ('来自' + kindName(this.data.kind));
    const data = cardStyle.applyCardStyle(this, { body: text, author });
    this._lastData = { type: 'quote', theme: this.data.theme, data };
    this._cardOpts = { canvasId: '#lineCanvas', type: 'quote', theme: this.data.theme, data };
    const self = this;
    this.setData({ err: '' });
    renderCard(this, { canvasId: '#lineCanvas', type: 'quote', theme: this.data.theme, data }).catch(err => {
      self.setData({ err: (err && err.message) || '生成失败' });
    });
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
      renderCard(this, { canvasId: '#lineCanvas', type: this._lastData.type, theme: id, data: this._lastData.data }).catch(() => {});
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
      historyTool: 'line',
      historyRecord: { kind: 'line', title: String(self.data.text || '').slice(0, 20) }
    }).then(() => self.flipSaved()).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return;
      if (/auth|deny|authorize/i.test(msg)) return;
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  },

  onShareAppMessage() {
    return { title: 'dudu 画面感 · 台词书摘卡', path: '/pages/line/line' };
  }
};

// 注入风格/背景交互（与天气/节气/金句同一套）
Object.assign(__pageCfg, cardStyle.cardStyleMethods);
Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
