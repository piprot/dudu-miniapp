// pages/weather/weather.js —— 天气心情卡（2026-10-06 新增 · 免费本地工具，零 AI）
// 参照「天气星语」剥离星座/占卜风险后的纯本地版本：天气 + 心情 → 图文卡。
//   ① 选天气 ② 选心情 ③ 写一句（可选）④ 选本地图（可选）⑤ 一键成卡。
// 全程本地；不调用 utils/charge（个人主体合规）。
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { THEME_LIST } = require('../../utils/themes/index.js');
const { handlePrivacyApiFail } = require('../../utils/diag.js');
const privacyPanel = require('../../utils/privacy_panel.js');

const WEATHER = [
  { key: 'sunny', name: '晴', icon: '☀️' },
  { key: 'cloudy', name: '多云', icon: '⛅' },
  { key: 'rain', name: '雨', icon: '🌧️' },
  { key: 'snow', name: '雪', icon: '❄️' },
  { key: 'wind', name: '风', icon: '🌬️' },
  { key: 'fog', name: '雾', icon: '🌫️' },
  { key: 'thunder', name: '雷', icon: '⛈️' },
  { key: 'night', name: '夜', icon: '🌙' }
];
const MOODS = [
  { key: 'happy', name: '开心', icon: '😊' },
  { key: 'calm', name: '平静', icon: '😌' },
  { key: 'tired', name: '疲惫', icon: '😪' },
  { key: 'sad', name: '低落', icon: '😔' },
  { key: 'excited', name: '兴奋', icon: '🤩' },
  { key: 'anxious', name: '焦虑', icon: '😰' },
  { key: 'grateful', name: '感恩', icon: '🥰' },
  { key: 'lonely', name: '孤独', icon: '🫧' }
];

function nameOf(list, key) { const it = list.find(x => x.key === key); return it ? it.name : ''; }

const __pageCfg = {
  data: {
    privacyShow: false,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    weatherList: WEATHER,
    moodList: MOODS,
    weather: 'sunny',
    mood: 'happy',
    note: '',
    cover: '',
    canvasH: 0,
    rendered: false,
    err: '',
    savedTick: 0,
    savedKey: ''
  },

  onPickWeather(e) { this.setData({ weather: e.currentTarget.dataset.key }); },
  onPickMood(e) { this.setData({ mood: e.currentTarget.dataset.key }); },

  onNote(e) { this.setData({ note: e.detail.value }); },

  onChooseImage() {
    const self = this;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success(r) {
        const p = r.tempFiles && r.tempFiles[0] && r.tempFiles[0].tempFilePath;
        if (p) {
          self.setData({ cover: p, rendered: false });
          wx.showToast({ title: '已选图，点生成', icon: 'none' });
        }
      },
      fail(e) { handlePrivacyApiFail(self, '选择配图', e); }
    });
  },

  onGen() {
    const wn = nameOf(WEATHER, this.data.weather);
    const mn = nameOf(MOODS, this.data.mood);
    const note = (this.data.note || '').trim();
    const body = note || ('今天天气' + wn + '，心情' + mn + '。记录此刻，留下一点画面感。');
    const title = wn + ' · ' + mn;
    const hasCover = !!this.data.cover;
    const type = hasCover ? 'imagetext' : 'quote';
    const data = hasCover
      ? { cover: this.data.cover, title, body }
      : { title, body };
    this._lastData = { type, theme: this.data.theme, data };
    const self = this;
    this.setData({ err: '' });
    renderCard(this, { canvasId: '#weatherCanvas', type, theme: this.data.theme, data }).catch(err => {
      self.setData({ err: (err && err.message) || '生成失败' });
    });
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id });
    if (this._lastData) {
      renderCard(this, { canvasId: '#weatherCanvas', type: this._lastData.type, theme: id, data: this._lastData.data }).catch(() => {});
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
      historyTool: 'weather',
      historyRecord: { kind: 'weather', title: (self._lastData && self._lastData.data.title) || '天气心情卡' }
    }).then(() => self.flipSaved()).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return;
      if (/auth|deny|authorize/i.test(msg)) return;
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  },

  onShareAppMessage() {
    return { title: 'dudu 画面感 · 天气心情卡', path: '/pages/weather/weather' };
  }
};

Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
