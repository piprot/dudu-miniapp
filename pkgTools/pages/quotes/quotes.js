// pages/quotes/quotes.js —— 金句收藏馆（2026-10-06 新增 · 纯本地静态库，零 AI）
// 仿「随身文案库」类小程序的个人语料库：本地收藏金句/文案，支持
//   标签分类 · 关键词搜索 · 复制 · 增删改 · 一键成卡（金句卡）。
// 2026-10-06 起启用积分：每次成卡扣 8 分（charge('quoteCard')，单价见 config.POINTS.cost）。
// 语料仍全程 wx.storage 本地保存，不上传服务器。
const store = require('../../utils/quotes_store');
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { THEME_LIST } = require('../../utils/themes/index.js');
const { pickDaily } = require('../../utils/daily_rotate');
const { CATEGORY_NAMES } = require('../../utils/content_quotes');
const cardStyle = require('../../utils/card_style_mixin');  // 排版风格 + 背景图（四页共用）
const catPicker = require('../../utils/cat_picker_mixin.js'); // 分层选择器（大类→小类下钻 + 常用前置）
const privacyPanel = require('../../../utils/privacy_panel.js'); // 隐私授权面板：同意按钮须用 open-type=agreePrivacyAuthorization
const { charge } = require('../../utils/charge.js');
const points = require('../../../utils/points.js');   // 余额显示（扣费提示用）
const { POINTS } = require('../../../utils/config.js');

// 常用分类：进页最常点的四个。**必须是真实高频**，不是凑数——
// 常用区的作用是让用户一步到位，若放不相关的项反而误导（用户会点「人生」但其实要「职场」）。
const HOT_CATS = ['growth', 'life', 'work', 'calm'];

// 分层选择器：大类 = 主题分类，小类 = 该类下真实存在的标签（从库里统计，不是写死）。
// 标签云随收藏无限增长，绝不能一次性平铺（旧版几十个 tag 铺满屏，观感极差）。
//
// ⚠️ 2026-10-24：新增「我写的」大类（key=__mine__）。
//   起因：用户反馈「金句收藏馆需要加入用户自己写进去的，目前的太固定了」。
//   根因不只是"没有编辑器"——编辑器早就有（onAdd/onEdit），但**自建条目看不见**：
//   applyFilter 里按 `q_seed_<cat>_` 前缀过滤主题分类，而用户自建条目 id 是
//   随机 `q_<时间戳>_<随机>`，不含 q_seed_ → 一旦选中任何主题大类，
//   用户自己写的东西就被整批滤掉（表现：写完了、刷新就没了）。
//   修法：把「主题分类」与「来源归属」两个维度彻底正交：
//     · __mine__ → 只看用户自建（与主题分类无关）
//     · 具体大类 → 该大类的种子条目 **+ 用户的自建条目**（自建条目不参与主题分类，
//       但必须始终可见，否则用户会以为没存上）
//     · 无分类 → 全部
function buildPickerGroups(allQuotes) {
  const keys = Object.keys(CATEGORY_NAMES);
  const groups = [];
  // ① 「我写的」放在最前——这是用户自己产出的内容，最该一键可达
  const mine = [];
  const mineSeen = {};
  allQuotes.forEach(q => {
    if (isSeedId(q.id)) return;
    (q.tags || []).forEach(t => { if (!mineSeen[t]) { mineSeen[t] = 1; mine.push({ key: t, name: t }); } });
  });
  groups.push({ key: '__mine__', name: '我写的', items: [{ key: '__all__', name: '全部' }].concat(mine) });
  // ② 六个主题大类（种子库专属）
  keys.forEach(k => {
    const items = [{ key: '__all__', name: '全部' }];
    const seen = {};
    allQuotes.forEach(q => {
      if (!q.id || q.id.indexOf('q_seed_' + k + '_') !== 0) return;
      (q.tags || []).forEach(t => { if (!seen[t]) { seen[t] = 1; items.push({ key: t, name: t }); } });
    });
    groups.push({ key: k, name: CATEGORY_NAMES[k], items });
  });
  return groups;
}

/**
 * 判断是否为内置种子条目。
 * 种子 id 形如 q_seed_<category>_<kind>_<NN>；用户自建 id 为随机 q_<ts>_<rand>。
 * 用「是否含 q_seed_ 前缀」判定，不靠 id 段数——老版本种子曾用随机 id（v1.1.54 之前）。
 */
function isSeedId(id) {
  return !!(id && String(id).indexOf('q_seed_') === 0);
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
    edit: { id: '', text: '', tags: '', source: '', kind: 'quote' },
    // 用户自建条目数（2026-10-24：「我写的」分组 + 顶部提示用）
    mineCount: 0,
    // 来源类型筛选（2026-06 与台词/书摘卡合并后新增；空 = 全部）
    filterKind: '',
    // 可选来源类型（由 store.KINDS 派生，wxml 循环渲染成筛选条+编辑器选择器）
    kindOptions: Object.keys(store.KINDS).map(k => ({ key: k, name: store.KINDS[k] })),
    canvasH: 0,
    rendered: false,
    err: '',
    points: 0,          // 积分余额（顶部展示，扣费后刷新）
    cardCost: 0,        // 成卡单价（按钮上明写）
    savedTick: 0,
    savedKey: ''
  }, cardStyle.defaults('literary')),   // 金句卡默认文艺风

  onLoad() { this.initCardStyle('literary'); store.seedIfEmpty(); this.initPicker(); this.refresh(); },

  // 余额显示：进入页面时拉一次（成卡后由 charge 的 onDone 刷新）
  async refreshBalance() {
    try { const bal = await points.getBalance();
      const c = (POINTS && POINTS.cost && POINTS.cost['quoteCard']) || 0;
      this.setData({ points: (bal && bal.points) || 0, cardCost: c });
    } catch (e) { /* 静默，不阻断浏览 */ }
  },
  // 点余额条去积分页（充值/签到）
  goPoints() { wx.navigateTo({ url: '/pages/points/points' }); },

  onShow() { this.refresh(); },

  // 首次进入预置一张「免费预览」卡：让成卡前的换背景 / 换风格 / 换衬底也能实时重绘，
  // 不必先成卡。预览**不开放免费保存**——onSaveImage 用 _charged 闸门拦截，
  // 只有真正点过「成卡」（charge 成功）才能存相册，避免白嫖出图。
  onReady() { this.seedPreview(); },

  // 用「今日推荐」作底稿，构造 _cardOpts + _lastQuote 并立即渲染一张预览卡。
  // 这样 repaint（换背景/风格）在第一次成卡前就有数据可重绘，改背景即时可见。
  seedPreview() {
    const tp = this.data.todayPick;
    const base = { body: (tp && tp.text) || '今天也要认真生活。', author: (tp && tp.source) || 'dudu 画面感' };
    this._lastQuote = base;
    const data = cardStyle.applyCardStyle(this, base);
    this._cardOpts = { canvasId: '#quotesCanvas', type: 'quote', theme: this.data.theme, data };
    this._charged = false;
    renderCard(this, this._cardOpts).catch(() => {});
  },

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
    //
    // ⚠️ 2026-10-24：groupKey 从 **回调参数** 取，不读 this.data.pgGroup。
    //   mixin 的 onPickGroup 里先 setData({pgGroup}) 再回调，若 setData 尚未
    //   同步生效，this.data.pgGroup 还是旧值 → 点「我写的」却按旧大类筛选。
    //   mixin 回调时会把 pgGroup 已更新（它 setData 在前），但保险起见
    //   这里用「回调时的 pgGroup + 兜底」双保险，并以 activeCat 为唯一真相源。
    this._pickerOnChange = (it) => {
      if (!it) return;
      const groupKey = this.data.pgGroup || '';
      const tag = (it.key === '__all__') ? '' : it.key;
      this.setData({ activeCat: groupKey, activeTag: tag });
      this.applyFilter();
    };
    // ⚠️ 2026-10-24：进页**不预选**任何主题大类。
    //   旧版默认落在 HOT_CATS[0]='growth'，而主题大类筛选会连带滤掉
    //   用户自建条目（见 applyFilter 的说明）→ 用户进来第一眼看到的
    //   永远是「成长」类种子，自己写的东西不在列表里，像是没存上。
    //   现在默认 activeCat=''（全部），用户自建条目与种子条目并列可见。
    this.setData({ activeCat: '', activeTag: '' });
    this._pickerOnChange({ key: '__all__' });
    this.refreshBalance();
  },

  // 标签云随收藏增长 → 大类下的小类也要跟着变，重进页面时重建一次分组
  rebuildPickerGroups() {
    const groups = buildPickerGroups(store.listQuotes());
    const items = (groups.find(g => g.key === this.data.pgGroup) || { items: [] }).items;
    this.setData({ pgGroups: groups, pgItems: items });
  },

  // 从本地库刷新列表 + 标签云 + 总数
  refresh() {
    // ⚠️ 列表必须走 applyFilter（它带 filterKind），不能在这里另起一次 searchQuotes——
    //    曾经两处各调一次导致「筛选后 onShow 刷新又变回全部」。单一出口。
    this.applyFilter();
    const all = store.listQuotes();
    this.setData({
      tags: store.allTags(),
      count: all.length,
      todayPick: this.pickToday(all, this.data.filterKind)
    });
    // 分组依赖库里的标签集合，收藏/删标签后必须重建，
    // 否则会出现「新建的标签在分类下选不到」。
    if (this.data.pgGroups && this.data.pgGroups.length) this.rebuildPickerGroups();
  },

  // 「今日推荐」：按日期从「当前来源类型(kind)」的池子里稳定轮换一条，
  // 同一天不变、跨天必变；切换来源类型时池子也跟着变 → 既是「每天轮换」也是「切种类变」。
  // salt 带 kind，保证各来源的今日轮换彼此独立。
  pickToday(all, kind) {
    let pool = (all && all.length) ? all : [];
    if (kind) pool = pool.filter(q => store.normKind(q.kind) === store.normKind(kind));
    if (!pool.length) return null;
    const q = pickDaily(pool, new Date(), 'quotes:today:' + (kind || 'all'));
    return q ? { id: q.id, text: q.text, source: q.source || '' } : null;
  },

  // 筛选统一入口：分类（大类）+ 标签（小类）两级同时生效。
  // 分层选择器的回调改activeCat/activeTag 后调用这里。
  //
  // ⚠️ 2026-10-24 重写（原实现是「先按来源/标签搜，再按 q_seed_ 前缀过滤分类」）：
  //   旧版最后一行 `list.filter(q => q.id.indexOf('q_seed_' + cat + '_') === 0)`
  //   把**用户自建条目全部滤掉**——它们 id 是随机 q_xxx，不含 q_seed_。
  //   结果：用户写完金句、点保存、列表里却找不到（刷新后更以为没存上）。
  //   这正是「金句馆需要加入用户自己写进去的」的真正病根——不是缺编辑器，是写完看不见。
  //
  //   新口径（分类与来源正交）：
  //     · activeCat = '__mine__' → 只显示用户自建条目
  //     · activeCat = 某个主题大类 → 该大类的种子条目 **+ 全部用户自建条目**
  //       （自建条目没有主题分类归属，但必须始终可见，否则用户会以为没存上）
  //     · activeCat = ''        → 全部
  //   标签筛选（activeTag）对所有条目一视同仁，用户自建条目的标签同样能筛出来。
  applyFilter() {
    const cat = this.data.activeCat;
    const list = store.searchQuotes({
      keyword: this.data.keyword,
      tag: this.data.activeTag,
      kind: this.data.filterKind      // 空 = 不按来源筛
    }).map(q => Object.assign({}, q, {
      // 预置展示名，wxml 直接用，不必在模板里做三元运算
      kindName: store.KINDS[store.normKind(q.kind)] || '',
      // 标记是否用户自建（wxml 显示「我写的」角标）
      mine: !isSeedId(q.id)
    }));
    let out = list;
    if (cat === '__mine__') {
      out = list.filter(q => q.mine);
    } else if (cat) {
      // 主题大类：种子条目按前缀取，用户自建条目**一并保留**
      out = list.filter(q => q.mine || (q.id && q.id.indexOf('q_seed_' + cat + '_') === 0));
    }
    this.setData({
      list: out,
      mineCount: list.filter(q => q.mine).length
    });
  },

  // 一键把今日推荐成卡
  onMakeTodayCard() {
    const t = this.data.todayPick;
    if (!t) return;
    this.renderQuote({ body: t.text, author: t.source || '金句收藏馆' });
  },

  // 金句卡统一渲染出口：注入风格 + 背景，并记录 _cardOpts 供切主题/改风格时原样重绘。
  //
  // ⚠️ 扣费也收在这里（唯一出口），这样 onMakeCard / onMakeTodayCard / 编辑后重渲染
  //    三条入口**都**会自动扣 8 分，不会漏。改价只动 config.POINTS.cost.quoteCard。
  //    注意：切主题/改风格走 mixin.repaint，不经过本函数，**不重复扣费**（只重绘已出的卡）。
  renderQuote(base) {
    const self = this;
    return charge('quoteCard', { onDone: (r) => this.setData({ points: (r && r.points) || 0 }), label: '金句卡' }).then(() => {
      this._lastQuote = base;
      this._charged = true;   // 已付费：解锁「保存到相册」（预览阶段 _charged=false，拦截免费存图）
      const data = cardStyle.applyCardStyle(this, base);
      this._cardOpts = { canvasId: '#quotesCanvas', type: 'quote', theme: this.data.theme, data };
      this.setData({ err: '' });
      return renderCard(this, {
        canvasId: '#quotesCanvas',
        type: 'quote',
        theme: this.data.theme,
        data
      }).catch(err => {
        self.setData({ err: (err && err.message) || '生成失败' });
      });
    }).catch(() => {
      // charge 已弹「积分不足」引导；不产出、不重复提示
      self.setData({ err: '' });
    });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  // ── 编辑 / 新增 ──
  onAdd() {
    // 默认「金句」；若当前正按「台词/书摘」筛选，则沿用该类型，少点一次
    const kind = this.data.filterKind || 'quote';
    this.setData({ showEditor: true, edit: { id: '', text: '', tags: '', source: '', kind } });
  },
  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const q = store.getQuote(id);
    if (!q) return;
    this.setData({
      showEditor: true,
      edit: {
        id: q.id,
        text: q.text,
        tags: (q.tags || []).join(','),
        source: q.source || '',
        // 旧数据没有 kind 字段，normKind 会归为 'quote'，编辑时可手动纠正
        kind: store.normKind(q.kind)
      }
    });
  },

  // 编辑器里选来源类型（互斥枚举，一次只能一种）
  onPickKind(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ 'edit.kind': store.normKind(key) });
  },

  // 列表按来源筛选（空字符串 = 全部）
  onFilterKind(e) {
    const key = e.currentTarget.dataset.key;
    const kind = key ? store.normKind(key) : '';
    if (kind === this.data.filterKind) return; // 幂等：重复点同一个 chip 不重刷
    this.setData({ filterKind: kind });
    // 修法两处（2026-10-08 用户反馈「节气、节日这两个 sheet 还没有改」）：
    // ① 走 refresh() 单一出口——旧版只调 applyFilter()，**今日推荐不会重选**，
    //    切来源后 todayPick 还停留在上一个 sheet 的句子（「切了句子不变」的真正接线缺口；
    //    v1.1.58 只修了 pickToday 纯函数与种子库，漏了这层页面接线）。
    // ② 把「主题大类 / 标签」过滤一并归位——节气/节日共 120 条种子全部挂在「时间」分类
    //    （q_seed_time_solar_* / q_seed_time_festival_*），而进页默认大类是「成长」；
    //    残留 activeCat='growth' 会让这两个 sheet 相交为空、整版空掉。
    //    来源类型与主题分类是正交维度：切来源 = 想看该来源的全部。
    //    pgItem/pgGroupOpen 同步归位，避免「高亮挂在旧标签上、列表却是全部」的错觉。
    this.setData({ activeCat: '', activeTag: '', pgItem: '', pgGroupOpen: false });
    // ⚠️ 2026-10-24：pgGroup 也要归位到「我写的」以外的位置。
    //   pgGroup 是分层选择器的「当前大类」，applyFilter 用的却是 activeCat，
    //   两个字段各说各话 → 高亮在 A、列表却是 B（用户会以为点错了）。
    //   这里把 pgGroup 同步成空态（不选任何大类 = 全部），与 activeCat='' 一致。
    this.setData({ pgGroup: '', pgGroupName: '' });
    this.refresh();
  },
  onField(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ edit: Object.assign({}, this.data.edit, { [field]: e.detail.value }) });
  },
  onCloseEditor() { this.setData({ showEditor: false }); },
  noop() {},

  // 点「我写的 N 条」→ 切到「我写的」分组，只看用户自建条目（2026-10-24）。
  // 这是一条**明确的自写入口**：以前用户写完只能在「全部」里翻，找不到就会以为没存上。
  onPickMine() {
    const groups = this.data.pgGroups || [];
    const g = groups.find(x => x.key === '__mine__');
    if (!g) {
      // 分组还没建好（极少见）：退化为只按标签清空 + 手动标记
      this.setData({ activeCat: '__mine__', activeTag: '', pgGroup: '__mine__', pgGroupName: '我写的', pgItem: '__all__', pgGroupOpen: true });
      this.applyFilter();
      return;
    }
    this.setData({
      activeCat: '__mine__',
      activeTag: '',
      pgGroup: '__mine__',
      pgGroupName: '我写的',
      pgItems: g.items || [],
      pgItem: '__all__',
      pgGroupOpen: true
    });
    this.applyFilter();
  },

  onSaveEdit() {
    const text = String(this.data.edit.text || '').trim();
    if (!text) { wx.showToast({ title: '内容不能为空', icon: 'none' }); return; }
    const patch = {
      text,
      tags: this.data.edit.tags,
      source: this.data.edit.source,
      kind: store.normKind(this.data.edit.kind)
    };
    if (this.data.edit.id) {
      store.updateQuote(this.data.edit.id, patch);
    } else {
      store.addQuote(patch);
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
    // ⚠️ 闸门：免费预览卡（未点过「成卡」）不允许存相册，否则等于白嫖出图。
    if (!this._charged) {
      wx.showToast({ title: '请先点「成卡」生成后再保存', icon: 'none', duration: 2200 });
      return;
    }
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
    return { title: 'dudu 画面感 · 金句收藏馆', path: '/pkgTools/pages/quotes/quotes' };
  }
};

// 注入风格/背景交互（与天气/节气/台词书摘同一套）
// 分层选择器方法：在 initPicker 里挂（它的 data 依赖库里的标签集合，运行时才确定），
// 这里只挂方法壳。
Object.assign(__pageCfg, cardStyle.cardStyleMethods, catPicker.build({groups: []}).methods);
Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
