// pages/gen/gen.js —— 文案工作台 · 工具箱（B1 合规版，零 AI 调用）
// 三个模块：
//   ① 模板匹配：选类型 → 填引导字段（或从「我的素材库」自动填入）→ 套人工模板出文案。
//   ② 排版优化：对任意文本做防折叠 / 自动加 emoji / 自动分段 / 字数统计（纯本地算法）。
//   ③ 知识库 + 素材库：内置静态金句/骨架库 + 用户本地素材库，给「指导」与「自动填入」体感。
// 本页不调用任何云端大模型，不构成深度合成，个人主体可正常过审。
const points = require('../../utils/points');
const templates = require('../../utils/templates');
const tools = require('../../utils/text_tools');
const knowledge = require('../../utils/knowledge');
const profile = require('../../utils/profile');

// ── 类型（顶部 Tab）──
const KINDS = [
  { id: 'value', icon: '💡', label: '价值型', tagline: '建立专业壁垒', desc: '讲干货与方法论，让用户觉得你靠谱', ratio: '每周 2' },
  { id: 'persona', icon: '🧭', label: '人设型', tagline: '让人信任你', desc: '用选择与代价，露出真实的你', ratio: '每周 1' },
  { id: 'deal', icon: '🤝', label: '成交型', tagline: '把信任变订单', desc: '给信号、证据与动作，不像广告', ratio: '每月 2-4' },
  { id: 'life', icon: '🌿', label: '生活型', tagline: '保持真实温度', desc: '分享日常片段，关系更有温度', ratio: '随时' },
  { id: 'story', icon: '📖', label: '我的故事', tagline: '把故事变作品', desc: '往事 / 随笔，可做成画面感内容', ratio: '不定时' }
];

// 每个类型的「结构提示」：告诉用户这套模板会怎么组织（与 templates.js 一致）。
const KIND_STRUCT = {
  value: '开头切入 → 中间展开「为什么」→ 结尾给收获感',
  persona: '选择 → 代价 → 为什么不后悔 → 给犹豫的人一句话',
  deal: '时机（信号）→ 信任（证据）→ 动作（引导）',
  life: '片段 → 感受细节 → 轻轻收住，留生活气',
  story: '时间地点 → 人物 → 转折 → 回望，克制收尾'
};

// 每个类型的引导字段（与 templates.js 占位符一一对应；只保留模板用到的 key）。
const FIELDS = {
  value: [
    { key: 'identity', label: '我是一个（身份 / 领域）', placeholder: '例如：做知识付费的独立创作者', type: 'input', required: true },
    { key: 'audience', label: '核心用户是谁', placeholder: '例如：想做个人品牌的新手', type: 'input', required: true },
    { key: 'scene', label: '想借哪个现象 / 故事讲', placeholder: '例如：最近很多人问我怎么开始', type: 'textarea', required: true },
    { key: 'point', label: '你想传递的核心观点', placeholder: '例如：开始比完美重要', type: 'textarea', required: true }
  ],
  persona: [
    { key: 'identity', label: '我是一个（身份 / 领域）', placeholder: '例如：裸辞创业的设计师', type: 'input', required: true },
    { key: 'choice', label: '你最近做的一个选择', placeholder: '例如：辞掉稳定工作去接自由单', type: 'textarea', required: true },
    { key: 'reason', label: '为什么做这个选择', placeholder: '例如：不想再等「合适的时机」', type: 'textarea', required: true },
    { key: 'cost', label: '代价是什么', placeholder: '例如：收入不稳、要重新证明自己', type: 'textarea', required: true }
  ],
  deal: [
    { key: 'identity', label: '我是一个（身份 / 领域）', placeholder: '例如：做职场陪跑教练', type: 'input', required: true },
    { key: 'product', label: '产品 / 服务叫什么', placeholder: '例如：21 天简历精修陪跑', type: 'input', required: true },
    { key: 'signal', label: '现在是什么时机（信号）', placeholder: '例如：秋招马上开始', type: 'textarea', required: true },
    { key: 'evidence', label: '真实证据（变化 / 结果）', placeholder: '例如：上批学员 8 人拿到面试', type: 'textarea', required: true }
  ],
  life: [
    { key: 'moment', label: '今天想分享的生活片段', placeholder: '例如：下班后去江边散步，看到一位老人练书法', type: 'textarea', required: true },
    { key: 'feeling', label: '当下的感受 / 细节', placeholder: '例如：风很轻，突然觉得慢下来也不是浪费时间', type: 'textarea', required: true },
    { key: 'meaning', label: '想留下的温度', placeholder: '例如：忙碌之外，也要给自己一点喘息', type: 'textarea', required: true }
  ],
  story: [
    { key: 'timePlace', label: '时间 / 地点', placeholder: '例如：高三那年冬天，老家巷口', type: 'input', required: true },
    { key: 'person', label: '人物', placeholder: '例如：我和总在路口等我的外婆', type: 'input', required: true },
    { key: 'turn', label: '转折', placeholder: '例如：她突然记不起我的名字了', type: 'textarea', required: true },
    { key: 'lookback', label: '回望', placeholder: '例如：后来我才懂，那是最慢也最暖的告别', type: 'textarea', required: true }
  ]
};

const DEFAULT_KIND = 'value';

// 已填字段数：非空即算（鼓励先写，不卡「必须全填」）。
function countFilled(fields, form) {
  const f0 = form || {};
  return (fields || []).filter(f => String(f0[f.key] || '').trim().length > 0).length;
}

// 给引导字段编号（1)/2)/3)…）。
function withNo(list) {
  return (list || []).map((f, i) => Object.assign({}, f, { no: i + 1 }));
}

Page({
  data: {
    points: 0,
    mode: 'tpl',               // 'tpl'=模板匹配 | 'opt'=排版优化
    kinds: KINDS,
    kind: DEFAULT_KIND,
    kindInfo: { label: '', desc: '', struct: '' },
    fields: [],
    form: {},
    filled: 0,
    fieldTotal: 1,
    readyGen: false,
    // ── 模板匹配结果 ──
    moments: [],               // 该类型下的模板成品（最多 3 条）
    selectedMoment: 0,
    err: '',
    // ── 我的素材库（本地）──
    profile: {},               // 已保存的素材库
    pf: {},                    // 编辑中的素材库
    showProfile: false,
    // ── 知识库金句（当前类型）──
    kbQuotes: [],
    // ── 排版优化器 ──
    optRaw: '',
    optResult: '',
    optStats: { chars: 0, lines: 0, emojiCount: 0 },
    optMode: 'antiFold',
    // ── 交互升级（Apple 流体）：聚焦光环 / 复制翻转 / 生成失败抖动 ──
    fieldFocus: '',          // 当前聚焦的字段 key（label/输入框高亮）
    copiedKey: '',           // 正在展示「✓ 已复制」的按钮：sel | all | opt
    genShakeTick: 0          // 生成失败计数：奇偶交替两套 keyframes，连续失败也重放抖动
  },

  onLoad() {
    const k = KINDS.find(x => x.id === DEFAULT_KIND) || KINDS[0];
    const fields = withNo(FIELDS[DEFAULT_KIND]);
    const profile0 = profile.loadProfile();
    const prefill = profile.applyProfileToForm(DEFAULT_KIND, profile0);
    const pf = Object.assign({}, profile0);
    // quotes 以换行存，编辑态用换行展示
    this.setData({
      kind: DEFAULT_KIND,
      kindInfo: { label: k.label, desc: k.desc, struct: KIND_STRUCT[DEFAULT_KIND] || '' },
      fields,
      form: prefill,
      pf,
      profile: profile0,
      filled: countFilled(fields, prefill),
      fieldTotal: fields.length,
      readyGen: countFilled(fields, prefill) > 0,
      kbQuotes: knowledge.quotesFor(DEFAULT_KIND)
    });
    this.refreshBalance();
  },

  onShow() { this.refreshBalance(); },

  async refreshBalance() {
    try {
      const bal = await points.getBalance();
      this.setData({ points: bal.points });
    } catch (e) { /* 静默，不阻断浏览 */ }
  },

  onGoPoints() { wx.navigateTo({ url: '/pages/points/points' }); },

  // ── 顶部：切换「模板匹配 / 排版优化」──
  onSwitchMode(e) {
    const m = e.currentTarget.dataset.mode;
    if (m && m !== this.data.mode) this.setData({ mode: m });
  },

  // ── ① 模板匹配：选择内容类型 ──
  onSelectKind(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.kind) return;
    const k = KINDS.find(x => x.id === id) || {};
    const fields = withNo(FIELDS[id]);
    // 切换类型时用素材库自动填入对应字段
    const prefill = profile.applyProfileToForm(id, this.data.profile);
    this.setData({
      kind: id,
      kindInfo: { label: k.label, desc: k.desc, struct: KIND_STRUCT[id] || '' },
      fields,
      form: prefill,
      filled: countFilled(fields, prefill),
      fieldTotal: fields.length,
      readyGen: countFilled(fields, prefill) > 0,
      moments: [],
      selectedMoment: 0,
      kbQuotes: knowledge.quotesFor(id),
      err: ''
    });
  },

  onFieldInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const form = Object.assign({}, this.data.form);
    form[key] = e.detail.value;
    const fields = this.data.fields;
    const filled = countFilled(fields, form);
    const hasAny = filled > 0;
    this.setData({ form, filled, readyGen: hasAny });
  },

  // 聚焦光环：记录当前聚焦字段（容器加 .focus → 输入框橙边 + 柔光）
  onFieldFocus(e) { this.setData({ fieldFocus: e.currentTarget.dataset.key || '' }); },
  onFieldBlur() { this.setData({ fieldFocus: '' }); },

  // 一键套模板出文案（纯本地字符串替换，不调云端）。
  onGenMoments() {
    const k = this.data.kind;
    const form = this.data.form;
    const tplCount = (templates.TEMPLATES[k] || []).length;
    const filled = countFilled(FIELDS[k] || [], form);
    if (filled === 0) {
      // 抖动提示：整个表单区左右轻晃（tick 奇偶交替保证连续失败也重放动画）
      this.setData({ err: '先填一两项，或从「我的素材库」保存后自动填入', genShakeTick: (this.data.genShakeTick || 0) + 1 });
      return;
    }
    const moments = templates.render(k, form);
    const valid = moments.filter(m => m && m.trim().length > 0);
    if (!valid.length) {
      this.setData({ err: '再补一两项内容，让模板有东西可套', moments: [], selectedMoment: 0, genShakeTick: (this.data.genShakeTick || 0) + 1 });
      return;
    }
    this.setData({
      moments: valid,
      selectedMoment: 0,
      err: '',
      readyGen: true
    });
    wx.showToast({ title: '已套出 ' + valid.length + ' 条', icon: 'none' });
  },

  onSelectMoment(e) {
    const idx = e.currentTarget.dataset.idx;
    if (typeof idx === 'number') this.setData({ selectedMoment: idx });
  },

  // 点知识库金句 → 追加到选中文案末尾（纯本地拼接，非生成）。
  onInsertQuote(e) {
    const q = e.currentTarget.dataset.q;
    if (!q) return;
    const idx = this.data.selectedMoment;
    const arr = this.data.moments.slice();
    if (!arr[idx]) return;
    arr[idx] = arr[idx] + '\n' + q;
    this.setData({ moments: arr });
    wx.showToast({ title: '已插入金句', icon: 'none' });
  },

  onCopyMoment() {
    const m = this.data.moments[this.data.selectedMoment];
    if (!m) return;
    this.copyText(m, 'sel', '已复制');
  },

  onCopyAll() {
    if (!this.data.moments.length) return;
    this.copyText(this.data.moments.join('\n\n——\n\n'), 'all', '已复制全部 ' + this.data.moments.length + ' 条');
  },

  // 复制翻转反馈：按钮 rotateX 翻转变绿显示「✓ 已复制」，1.6s 后复原
  copyText(text, key, tip) {
    const self = this;
    wx.setClipboardData({
      data: text,
      success() {
        if (key) {
          self.setData({ copiedKey: key });
          if (self._copyTimer) clearTimeout(self._copyTimer);
          self._copyTimer = setTimeout(() => { self.setData({ copiedKey: '' }); }, 1600);
        } else {
          wx.showToast({ title: tip, icon: 'none' });
        }
      },
      fail() { wx.showToast({ title: '复制受限，请长按文案手动复制', icon: 'none', duration: 3200 }); }
    });
  },

  // ── 我的素材库：编辑 / 保存（本地）──
  onToggleProfile() {
    this.setData({ showProfile: !this.data.showProfile });
  },
  onPfInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const pf = Object.assign({}, this.data.pf);
    pf[key] = e.detail.value;
    this.setData({ pf });
  },
  onSaveProfile() {
    const pf = Object.assign({}, this.data.pf);
    // quotes 以换行存储
    profile.saveProfile(pf);
    const prefill = profile.applyProfileToForm(this.data.kind, pf);
    const fields = this.data.fields;
    this.setData({
      profile: pf,
      form: prefill,
      filled: countFilled(fields, prefill),
      readyGen: countFilled(fields, prefill) > 0,
      showProfile: false
    });
    wx.showToast({ title: '素材库已保存', icon: 'none' });
  },

  // ── ② 排版优化器：对任意文本做防折叠 / 加 emoji / 分段 ──
  onOptInput(e) {
    const optRaw = e.detail.value;
    this.setData({
      optRaw,
      optResult: '',
      optStats: { chars: 0, lines: 0, emojiCount: 0 }
    });
  },

  onPasteOpt() {
    const self = this;
    wx.getClipboardData({
      success(res) {
        const optRaw = (res.data || '').trim();
        self.setData({ optRaw });
        if (!optRaw) wx.showToast({ title: '剪贴板里没有内容', icon: 'none' });
      },
      fail() { wx.showToast({ title: '读取剪贴板失败，请手动粘贴', icon: 'none', duration: 3200 }); }
    });
  },

  // 应用某一种优化（antiFold / emoji / split）。
  applyOpt(type) {
    const raw = this.data.optRaw;
    if (!raw || !raw.trim()) {
      this.setData({ err: '先在上方粘贴或输入一段文字' });
      return;
    }
    let out = raw;
    if (type === 'antiFold') out = tools.antiFold(raw, 20);
    else if (type === 'emoji') out = tools.insertEmoji(raw);
    else if (type === 'split') out = tools.autoSplit(raw);
    const optStats = tools.countStats(out);
    this.setData({ optResult: out, optStats, optMode: type, err: '' });
  },

  onOptAntiFold() { this.applyOpt('antiFold'); },
  onOptEmoji() { this.applyOpt('emoji'); },
  onOptSplit() { this.applyOpt('split'); },

  onCopyOpt() {
    const t = this.data.optResult;
    if (!t) return;
    this.copyText(t, 'opt', '已复制排版结果');
  },

  // ── 分享能力（个人主体：原生转发 / 朋友圈正常开放）──
  onShareAppMessage() {
    return {
      title: '套模板 3 秒写出能直接发的朋友圈文案 · dudu 画面感',
      path: '/pages/gen/gen'
    };
  },
  onShareTimeline() {
    return {
      title: '套模板 3 秒写出能直接发的朋友圈文案 · dudu 画面感',
      query: ''
    };
  },
  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }
});
