// pages/quotes/quotes.js —— 金句收藏馆（2026-10-06 新增 · 免费本地工具，零 AI）
// 仿「随身文案库」类小程序的个人语料库：本地收藏金句/文案，支持
//   标签分类 · 关键词搜索 · 复制 · 增删改 · 一键成卡（金句卡）。
// 全程 wx.storage 本地保存，不调用 utils/charge（个人主体合规：纯本地文字处理）。
const store = require('../../utils/quotes_store');
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { THEME_LIST } = require('../../utils/themes/index.js');
const privacyPanel = require('../../utils/privacy_panel.js'); // 隐私授权面板：同意按钮须用 open-type=agreePrivacyAuthorization

const __pageCfg = {
  data: {
    privacyShow: false,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    list: [],            // 当前筛选结果
    tags: [],            // 标签云 [{tag,count}]
    count: 0,            // 收藏总数
    keyword: '',
    activeTag: '',
    showEditor: false,
    edit: { id: '', text: '', tags: '', source: '' },
    canvasH: 0,
    rendered: false,
    err: '',
    savedTick: 0,
    savedKey: ''
  },

  onLoad() { this.refresh(); },
  onShow() { this.refresh(); },

  // 从本地库刷新列表 + 标签云 + 总数
  refresh() {
    const list = store.searchQuotes({ keyword: this.data.keyword, tag: this.data.activeTag });
    this.setData({
      list,
      tags: store.allTags(),
      count: store.listQuotes().length
    });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    this.refresh();
  },

  onPickTag(e) {
    const tag = e.currentTarget.dataset.tag;
    this.setData({ activeTag: (this.data.activeTag === tag ? '' : tag) });
    this.refresh();
  },

  // ── 编辑 / 新增 ──
  onAdd() {
    this.setData({ showEditor: true, edit: { id: '', text: '', tags: '', source: '' } });
  },
  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const q = store.getQuote(id);
    if (!q) return;
    this.setData({
      showEditor: true,
      edit: { id: q.id, text: q.text, tags: (q.tags || []).join(','), source: q.source || '' }
    });
  },
  onField(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ edit: Object.assign({}, this.data.edit, { [field]: e.detail.value }) });
  },
  onCloseEditor() { this.setData({ showEditor: false }); },
  noop() {},

  onSaveEdit() {
    const text = String(this.data.edit.text || '').trim();
    if (!text) { wx.showToast({ title: '金句内容不能为空', icon: 'none' }); return; }
    if (this.data.edit.id) {
      store.updateQuote(this.data.edit.id, { text, tags: this.data.edit.tags, source: this.data.edit.source });
    } else {
      store.addQuote({ text, tags: this.data.edit.tags, source: this.data.edit.source });
    }
    this.setData({ showEditor: false });
    this.refresh();
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    const self = this;
    wx.showModal({
      title: '删除这条金句',
      content: '确定删除？此操作不可恢复。',
      success(r) {
        if (r.confirm) { store.removeQuote(id); self.refresh(); wx.showToast({ title: '已删除', icon: 'none' }); }
      }
    });
  },

  onCopy(e) {
    const text = e.currentTarget.dataset.text || '';
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success() { wx.showToast({ title: '已复制', icon: 'none' }); },
      fail() { wx.showToast({ title: '复制受限，请长按文案手动复制', icon: 'none', duration: 3200 }); }
    });
  },

  // 一键成卡（金句卡）：把选中的金句渲染到 canvas
  onMakeCard(e) {
    const id = e.currentTarget.dataset.id;
    const q = store.getQuote(id);
    if (!q) return;
    const self = this;
    this.setData({ err: '' });
    renderCard(this, {
      canvasId: '#quotesCanvas',
      type: 'quote',
      theme: this.data.theme,
      data: { body: q.text, author: q.source || '金句收藏馆' }
    }).catch(err => {
      self.setData({ err: (err && err.message) || '生成失败' });
    });
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id });
    // 若已渲染，按新主题重绘当前内容（保留最近一次成卡文案）
    if (this._lastQuote) {
      const self = this;
      renderCard(this, { canvasId: '#quotesCanvas', type: 'quote', theme: id, data: this._lastQuote }).catch(() => {});
    }
  },

  // 保存成功翻转反馈（与 card.js 同款：双套 keyframes 奇偶交替重放）
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
      historyTool: 'quote',
      historyRecord: { kind: 'quote', title: String((self._lastQuote && self._lastQuote.body) || '').slice(0, 20) }
    }).then(() => self.flipSaved()).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return;
      if (/auth|deny|authorize/i.test(msg)) return;
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  },

  onShareAppMessage() {
    return { title: 'dudu 画面感 · 金句收藏馆', path: '/pages/quotes/quotes' };
  }
};

// 记住最近一次成卡文案，供切主题时重绘
const _origMake = __pageCfg.onMakeCard;
__pageCfg.onMakeCard = function (e) {
  const id = e.currentTarget.dataset.id;
  const q = store.getQuote(id);
  if (q) this._lastQuote = { body: q.text, author: q.source || '金句收藏馆' };
  return _origMake.call(this, e);
};

Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
