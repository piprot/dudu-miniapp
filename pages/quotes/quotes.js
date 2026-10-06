// pages/quotes/quotes.js —— 金句收藏馆（2026-10-06 新增 · 免费本地工具，零 AI）
// 仿「随身文案库」类小程序的个人语料库：本地收藏金句/文案，支持
//   标签分类 · 关键词搜索 · 复制 · 增删改 · 一键成卡（金句卡）。
// 全程 wx.storage 本地保存，不调用 utils/charge（个人主体合规：纯本地文字处理）。
const store = require('../../utils/quotes_store');
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { THEME_LIST } = require('../../utils/themes/index.js');
const { pickDaily } = require('../../utils/daily_rotate');
const { CATEGORY_NAMES } = require('../../utils/content_quotes');
const cardStyle = require('../../utils/card_style_mixin');  // 排版风格 + 背景图（四页共用）
const catPicker = require('../../utils/cat_picker_mixin.js'); // 分层选择器（大类→小类下钻 + 常用前置）
const privacyPanel = require('../../utils/privacy_panel.js'); // 隐私授权面板：同意按钮须用 open-type=agreePrivacyAuthorization

// 常用分类：进页最常点的四个。**必须是真实高频**，不是凑数——
// 常用区的作用是让用户一步到位，若放不相关的项反而误导（用户会点「人生」但其实要「职场」）。
const HOT_CATS = ['growth', 'life', 'work', 'calm'];

// 分层选择器：大类 = 主题分类，小类 = 该类下真实存在的标签（从库里统计，不是写死）。
// 标签云随收藏无限增长，绝不能一次性平铺（旧版几十个 tag 铺满屏，观感极差）。
function buildPickerGroups(allQuotes) {
  const keys = Object.keys(CATEGORY_NAMES);
  return keys.map(k => {
    const items = [{ key: '__all__', name: '全部' }];
    const seen = {};
    allQuotes.forEach(q => {
      if (!q.id || q.id.indexOf('q_seed_' + k + '_') !== 0) return;
      (q.tags || []).forEach(t => { if (!seen[t]) { seen[t] = 1; items.push({ key: t, name: t }); } });
    });
    return { key: k, name: CATEGORY_NAMES[k], items };
  });
}

const __pageCfg = {
  data: Object.assign({
    privacyShow: false,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    list: [],            // 当前筛选结果
    tags: [],            // 全部标签（保留给统计/未来用；UI 不再平铺展示，见分层选择器）
    count: 0,            // 收藏总数
    keyword: '',
    activeTag: '',
    // 旧字段 cats（6 大类平铺）已删——改用分层选择器的 pgGroups/pgHot/pgItems
    activeCat: '',
    todayPick: null,     // 今日推荐一条（天天换）
    showEditor: false,
    edit: { id: '', text: '', tags: '', source: '' },
    canvasH: 0,
    rendered: false,
    err: '',
    savedTick: 0,
    savedKey: ''
  }, cardStyle.defaults('literary')),   // 金句卡默认文艺风

  onLoad() { this.initCardStyle('literary'); store.seedIfEmpty(); this.initPicker(); this.refresh(); },
  onShow() { this.refresh(); },

  // 分层选择器初始化：大类=分类，小类=该类下真实存在的标签
  initPicker() {
    const picker = catPicker.build({
      groups: buildPickerGroups(store.listQuotes()),
      hotKeys: HOT_CATS.map(c => c + ':__all__'),
      activeGroup: HOT_CATS[0],
      activeItem: '__all__',
      groupLabel: '按主题',
      itemLabel: '细选标签'
    });
    Object.assign(this.data, picker.data);
    // 小类/常用选择器 → 更新筛选条件（分类 + 标签两级同时生效）
    this._pickerOnChange = (it) => {
      if (!it) return;
      const groupKey = this.data.pgGroup;
      const tag = (it.key === '__all__') ? '' : it.key;
      this.setData({ activeCat: groupKey, activeTag: tag });
      this.applyFilter();
    };
    // 进页默认落在第一个常用大类上
    this._pickerOnChange({ key: '__all__' });
  },

  // 标签云随收藏增长 → 大类下的小类也要跟着变，重进页面时重建一次分组
  rebuildPickerGroups() {
    const groups = buildPickerGroups(store.listQuotes());
    const items = (groups.find(g => g.key === this.data.pgGroup) || { items: [] }).items;
    this.setData({ pgGroups: groups, pgItems: items });
  },

  // 从本地库刷新列表 + 标签云 + 总数
  refresh() {
    const list = store.searchQuotes({ keyword: this.data.keyword, tag: this.data.activeTag });
    const all = store.listQuotes();
    this.setData({
      list,
      tags: store.allTags(),
      count: all.length,
      todayPick: this.pickToday(all)
    });
    // 分组依赖库里的标签集合，收藏/删标签后必须重建，
    // 否则会出现「新建的标签在分类下选不到」。
    if (this.data.pgGroups && this.data.pgGroups.length) this.rebuildPickerGroups();
  },

  // 「今日推荐」：按日期从全库里稳定轮换一条，同一天不变、跨天必变。
  pickToday(all) {
    const pool = (all && all.length) ? all : [];
    if (!pool.length) return null;
    const q = pickDaily(pool, new Date(), 'quotes:today');
    return q ? { id: q.id, text: q.text, source: q.source || '' } : null;
  },

  // 筛选统一入口：分类（大类）+ 标签（小类）两级同时生效。
// 分层选择器的回调改activeCat/activeTag 后调用这里。
// 分类是「种子文案专属」字段（id 以 q_seed_ 开头），用户自建条目不参与分类筛选。
  applyFilter() {
    const cat = this.data.activeCat;
    let list = store.searchQuotes({ keyword: this.data.keyword, tag: this.data.activeTag });
    if (cat) list = list.filter(q => q.id && q.id.indexOf('q_seed_' + cat + '_') === 0);
    this.setData({ list });
  },

  // 一键把今日推荐成卡
  onMakeTodayCard() {
    const t = this.data.todayPick;
    if (!t) return;
    this.renderQuote({ body: t.text, author: t.source || '金句收藏馆' });
  },

  // 金句卡统一渲染出口：注入风格 + 背景，并记录 _cardOpts 供切主题/改风格时原样重绘。
  renderQuote(base) {
    this._lastQuote = base;
    const data = cardStyle.applyCardStyle(this, base);
    this._cardOpts = { canvasId: '#quotesCanvas', type: 'quote', theme: this.data.theme, data };
    const self = this;
    this.setData({ err: '' });
    return renderCard(this, {
      canvasId: '#quotesCanvas',
      type: 'quote',
      theme: this.data.theme,
      data
    }).catch(err => {
      self.setData({ err: (err && err.message) || '生成失败' });
    });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
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
    return this.renderQuote({ body: q.text, author: q.source || '金句收藏馆' });
  },

  onPickTheme(e) {
    // 兼容组件上抛（e.detail.id）与页面直绑（e.currentTarget.dataset.id）。
    // 出图设置抽成 card-config 组件后事件走 e.detail，只读 currentTarget 会静默失效。
    const id = ((e && e.detail && e.detail.id) ||
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id));
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id });
    // 若已渲染，按新主题重绘当前内容（保留最近一次成卡文案）
    if (this._lastQuote) {
      this._cardOpts = Object.assign({}, this._cardOpts, { theme: id });
      renderCard(this, { canvasId: '#quotesCanvas', type: 'quote', theme: id, data: this._cardOpts.data }).catch(() => {});
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

// 注入风格/背景交互（与天气/节气/台词书摘同一套）
// 分层选择器方法：在 initPicker 里挂（它的 data 依赖库里的标签集合，运行时才确定），
// 这里只挂方法壳。
Object.assign(__pageCfg, cardStyle.cardStyleMethods, catPicker.build({groups: []}).methods);
Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
