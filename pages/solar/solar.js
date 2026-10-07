// pages/solar/solar.js —— 节气·今日文案（2026-10-06 新增 · 纯本地静态库，零 AI）
// 参照「随身文案库」的「来源分类 / 节日应景」思路，做纯本地节气/节日文案成卡：
//   ① 自动显示今日应景文案（节气 > 节日 > 普通日兜底）
//   ② 浏览 24 节气 / 农历节日 / 西方节日，点任一条即预览成卡
//   ③ 一键存金句馆
// 纯静态本地数据，零 AI、零网络（个人主体合规）：
//   东方 24 节气（utils/solar_terms.js）+ 真实农历/干支/生肖 + 东西方节日
//   （utils/calendar_mix.js，1900–2100 农历换算）。
// 2026-10-06 起启用积分：每次成卡扣 8 分（charge('solarCard')，单价见 config.POINTS.cost）。
const { SOLAR_TERMS, FESTIVALS, pickForToday, pickAnotherNormal } = require('../../utils/solar_terms');
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { addQuote } = require('../../utils/quotes_store');
const { THEME_LIST } = require('../../utils/themes/index.js');
const { dateLabelOf } = require('../../utils/daily_rotate');
const cardStyle = require('../../utils/card_style_mixin');  // 排版风格 + 背景图（四页共用）
const privacyPanel = require('../../utils/privacy_panel.js');
const { charge } = require('../../utils/charge.js');

const __pageCfg = {
  data: Object.assign({
    privacyShow: false,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    today: { type: 'normal', name: '', text: '' },
    // ── 今日概览（公历 + 农历 + 干支生肖 + 今日节日）──
    todayLabel: '',       // 10月6日 · 星期二
    lunarText: '',        // 农历丙午年八月廿六
    ganzhi: '',
    zodiac: '',
    festivalName: '',     // 今日节日（节气/农历/西方），无则空
    festivalKind: '',     // 'term' | 'lunar' | 'western'
    // ── 分层结构：一级分组默认收起，点开才看条目 ──
    // 为什么要分层：24 节气 + 10 农历节日 + 15 西方节日 = 49 条平铺，
    // 用户要滚很久才看到想找的那一条（认知负荷 8 项里的「渐进披露」不通过）。
    // 现在：第一层只显示 3 个分组头（含条目数），第二层才是条目，且默认全收起。
    groups: [
      { key: 'term', name: '二十四节气', icon: '🌾', desc: '东方节气 · 物候与时令', open: false, items: [], limit: 48 },
      { key: 'lunar', name: '农历传统节日', icon: '🏮', desc: '按真实农历日期推算', open: false, items: [], limit: 48 },
      { key: 'western', name: '西方节日', icon: '🎄', desc: '公历固定日期', open: false, items: [], limit: 48 }
    ],
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
    this.buildGroups();
    this.refreshToday();
  },

  // 三组条目：东方节气 + 农历节日 + 西方节日，每组 100+ 条文案（文案级扁平化）。
  // 扁平化逻辑抽到 utils/solar_browse（纯函数），本页只负责 setData，便于守卫测试复用。
  buildGroups() {
    try {
      const { buildGroups } = require('../../utils/solar_browse');
      this.setData({ groups: buildGroups() });
    } catch (e) {
      // 浏览库异常：保留默认空分组，主功能（今日文案）仍可用，不白屏
      console.error('solar buildGroups 失败：', e);
    }
  },

  // 今日概览：公历 / 农历 / 干支 / 生肖 / 今日节日
  // ⚠️ 历法模块（calendar_mix / solar_terms）用 require 懒加载并各自 try/catch：
  //    万一模块缺失或抛错，只损失「农历/节日」这层增强，节气主功能不能白屏。
  refreshToday() {
    const now = new Date();
    let lf = null, fest = null, term = null;
    try {
      const L = require('../../utils/calendar_mix');
      lf = L.lunarFull(now);
      fest = L.pickFestival(now);
    } catch (e) { /* 历法不可用：留空即可，不影响节气浏览 */ }
    try {
      term = pickForToday();
    } catch (e) {
      // 连节气库都不可用时给一句兜底，保证页面有内容可读
      let fb = '今天也在好好生活，愿你不必匆忙。';
      try { fb = pickAnotherNormal(now, 0); } catch (e2) { /* 用上面那句写死的 */ }
      term = { type: 'normal', name: '今日', text: fb };
    }
    // 节日优先级：节气 > 农历节日 > 西方节日（与 pickForToday 口径一致）
    this.setData({
      today: term,
      todayLabel: dateLabelOf(now),
      lunarText: lf ? lf.lunarText : '',
      ganzhi: lf ? lf.ganzhi : '',
      zodiac: lf ? lf.zodiac : '',
      festivalName: term.type !== 'normal' ? term.name : (fest ? fest.name : ''),
      festivalKind: term.type !== 'normal' ? 'term' : (fest ? fest.kind : '')
    });
    if (!this.data.sel.text) this.setData({ sel: { name: term.name, text: term.text } });
  },

  // 展开/收起某个分组（分层的第一层）
  onToggleGroup(e) {
    const key = e.currentTarget.dataset.key;
    const groups = this.data.groups.map(g => (g.key === key ? Object.assign({}, g, { open: !g.open }) : g));
    this.setData({ groups });
  },

  // 点条目 → 展开它的文案（分层的第二层）。用 uid 唯一定位（同一节日有 5 条文案，name 会重复）。
  // 手风琴：展开一条时把同组其它条目全部收起，避免同时铺开多条详情把页面撑得极长
  //（2026-10-07 用户反馈「全是铺陈、来回翻」）。
  onToggleItem(e) {
    const key = e.currentTarget.dataset.key;
    const uid = e.currentTarget.dataset.uid;
    const groups = this.data.groups.map(g => {
      if (g.key !== key) return g;
      const target = g.items.find(it => it.uid === uid);
      const willOpen = target ? !target.open : false;
      const items = g.items.map(it => Object.assign({}, it, { open: willOpen && it.uid === uid }));
      return Object.assign({}, g, { items });
    });
    this.setData({ groups });
  },

  // 「展开更多」：分级放开该组的显示条数 show：INITIAL(8) → limit(48) → 全部。
  // 数据一直都在 items 里，只是逐级显示，避免一打开就铺 48 行让人来回翻。
  onShowMore(e) {
    const key = e.currentTarget.dataset.key;
    const groups = this.data.groups.map(g => {
      if (g.key !== key) return g;
      let show;
      if (g.show < g.limit) show = g.limit;              // 8 → 48
      else show = g.items.length;                         // 48 → 全部
      return Object.assign({}, g, { show });
    });
    this.setData({ groups });
  },

  // 点条目上的「成卡」→ 立即出卡（扣 8 积分）
  onPickItem(e) {
    const name = e.currentTarget.dataset.name;
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    this.preview(name, text);
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
    const self = this;
    // ⚠️ 扣费在前、渲染在后：积分不足时**不产出**（charge 会 reject 并弹引导）。
    //    切主题/改风格走 mixin.repaint 只重绘已出的卡，不重复扣费。
    //    改价只动 utils/config.js 的 POINTS.cost.solarCard，云函数 GEN_COST 同名同值。
    charge('solarCard', { label: '节气文案卡' }).then(() => {
      this.setData({ sel: { name, text } });
      // ⚠️ 不再传 author 落款：节气/节日卡右下角已有小程序码、右上角已有「dudu 画面感」
      //    品牌水印，左下角落款会与右上角品牌重复（2026-10-07 设计整改）。左下角留白更干净。
      // solarLines：公历/农历/干支生肖三行小字（2026-10-07 用户要求「都展示出来、排列整齐、字号小一点」）。
      // 空值自动过滤，避免出现「公历：」这种空标签。干支与生肖拼一行，省一纵向空间。
      const solarLines = [
        this.data.todayLabel || '',
        this.data.lunarText || '',
        (this.data.ganzhi && this.data.zodiac) ? (this.data.ganzhi + '年 · ' + this.data.zodiac) : (this.data.ganzhi || this.data.zodiac || '')
      ].filter(Boolean);
      const data = cardStyle.applyCardStyle(this, { title: name, body: text, solarLines });
      this._lastData = { type: 'dailysign', theme: this.data.theme, data };
      this._cardOpts = { canvasId: '#solarCanvas', type: 'dailysign', theme: this.data.theme, data };
      this.setData({ err: '' });
      return renderCard(self, { canvasId: '#solarCanvas', type: 'dailysign', theme: self.data.theme, data })
        .then(() => {
          // 成卡后自动滚回顶部预览：从很深的条目成卡时，用户还要手动往上滑很久才看到结果
          // （2026-10-07 用户反馈「来回翻」）。selector 需要基础库 ≥2.23.1，低版本静默跳过。
          if (wx.pageScrollTo && typeof wx.createSelectorQuery === 'function') {
            wx.pageScrollTo({ selector: '#solarCanvas', duration: 300, fail() {} });
          }
        })
        .catch(err => { self.setData({ err: (err && err.message) || '生成失败' }); });
    }).catch(() => {
      self.setData({ err: '' });   // charge 已弹积分不足引导
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
    // kind 按来源区分：节气 or 节日（2026-10-06 统一收藏库后新增），
    // 这样金句馆里能按「节气 / 节日」筛出不同来源的文案。
    const name = this.data.sel.name || '';
    const isTerm = /节气/.test(name) || this.data.today.type === 'term';
    addQuote({
      text,
      tags: [isTerm ? '节气' : '节日'],
      source: name,
      kind: isTerm ? 'solar' : 'festival'
    });
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
