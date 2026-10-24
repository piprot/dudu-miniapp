// utils/quotes_store.js
// ─────────────────────────────────────────────────────────────────────────
// 金句收藏馆 · 本地存储层（2026-10-06 新增）
//
// 仿「随身文案库」类小程序的个人语料库：金句/文案本地收藏，支持
//   ① 增删改（addQuote / updateQuote / removeQuote / getQuote）
//   ② 标签分类（tags[]）
//   ③ 关键词 + 标签 联合筛选（searchQuotes）
//   ④ 标签云（allTags，带计数）
//   ⑤ 一键导出全部（exportAll → 纯文本）
//
// 全程 wx.storage 本地保存，不上传任何服务器（个人主体合规，零 AI）。
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const { SEED_QUOTES } = require('./content_quotes');

const KEY = 'dudu_quotes_v1';
// 种子库版本：版本号变更 → 清掉旧内置种子（q_seed_ 前缀）并重新播种，
// 用户手动新增的条目（随机 id，非 q_seed_）保留不动。这样「存量用户升级」也能
// 拿到干净的新种子库，不必依赖脆弱的文本回填迁移。
const SEED_VER_KEY = 'dudu_quotes_seed_ver';
const SEED_VERSION = 3; // 2026-10-07：每来源类型 ≥60 条，紧凑格式下 kind 由 id 反解

function readAll() {
  try { return wx.getStorageSync(KEY) || []; } catch (e) { return []; }
}
function writeAll(list) {
  try { wx.setStorageSync(KEY, list); return true; } catch (e) { return false; }
}

// 把逗号 / 空格 / 顿号 分隔的标签串规范成去重数组
function normTags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,，、\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function genId() {
  return 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ── 来源类型（kind）─────────────────────────────────────────────────
// 2026-10-06：金句收藏馆与台词/书摘卡合并成一个库后，需要区分「这条是哪来的」。
//
// 为什么不用 tags 承担：tags 是自由标签（'生活' '勇气'…），而 kind 是**互斥枚举**
//（一条只属于一种来源）。若把'台词'塞进 tags，会出现「这条既是台词又是书摘」的
// 脏数据，筛选时无法做互斥过滤。两者语义正交：category=情绪、tags=自由标签、
// kind=来源。故独立成字段。
const KINDS = {
  quote: '金句',    // 手选/种子金句收藏馆里的条目
  line: '台词',     // 影视台词
  book: '书摘',     // 书本摘录
  famous: '名言',   // 名人名言
  daily: '每日一句', // 来自「每日一句」页
  solar: '节气',// 来自「节气·节日」页的节气文案
  festival: '节日'  // 来自「节气·节日」页的节日文案
};
const KIND_KEYS = Object.keys(KINDS);
/** 归一化来源类型：未登记的一律记为 quote（不丢数据，也不产生脏枚举） */
function normKind(raw) {
  const k = String(raw || '').trim();
  return KIND_KEYS.indexOf(k) >= 0 ? k : 'quote';
}

// 新增一条金句；同一文本已存在则视为更新（幂等，不重复存）。
function addQuote(input) {
  const text = String(input && input.text || '').trim();
  if (!text) return null;
  const list = readAll();
  const exist = list.find(q => q.text === text);
  if (exist) {
    // 已存在：合并标签与出处，不重复插入（按文本幂等）
    const tags = normTags((exist.tags || []).concat(input.tags || []).join(','));
    if (input.source && !exist.source) exist.source = input.source;
    exist.tags = tags;
    // kind 只在「原来没有」或「原来是默认 quote」时才升级，
    // 避免用户手动改过类型后被再次保存覆盖回默认值
    if (input.kind && normKind(exist.kind) === 'quote' && normKind(input.kind) !== 'quote') {
      exist.kind = normKind(input.kind);
    }
    writeAll(list);
    return exist;
  }
  const item = {
    // 允许调用方指定 id（内置种子必须用固定 id q_seed_<category>_<n>：
    // 金句馆的「按主题分类」筛选就是靠这个前缀识别的，见 quotes.js applyFilter）。
    // 用户手动新增的条目不传 id → 走 genId() 随机 id，两类互不干扰。
    id: String(input.id || '').trim() || genId(),
    text,
    tags: normTags(input.tags),
    source: String(input.source || '').trim(),
    kind: normKind(input.kind),
    createdAt: Date.now()
  };
  list.unshift(item);
  writeAll(list);
  return item;
}

function getQuote(id) {
  return readAll().find(q => q.id === id) || null;
}

function updateQuote(id, patch) {
  const list = readAll();
  const q = list.find(x => x.id === id);
  if (!q) return null;
  if (patch.text != null) q.text = String(patch.text).trim();
  if (patch.tags != null) q.tags = normTags(patch.tags);
  if (patch.source != null) q.source = String(patch.source).trim();
  // 来源类型可改（合并后用户能手动纠正「这条其实是台词」）
  if (patch.kind != null) q.kind = normKind(patch.kind);
  writeAll(list);
  return q;
}

function removeQuote(id) {
  const list = readAll().filter(q => q.id !== id);
  return writeAll(list);
}

function listQuotes() {
  return readAll();
}

// keyword 命中 text 或 source；tag 精确匹配（不选则为全部）。
function searchQuotes(opts) {
  opts = opts || {};
  const kw = String(opts.keyword || '').trim().toLowerCase();
  const tag = opts.tag || '';
  // kind 为空=不按来源筛；否则按互斥枚举精确匹配
  const kind = opts.kind ? normKind(opts.kind) : '';
  return readAll().filter(q => {
    if (kind && normKind(q.kind) !== kind) return false;
    if (tag && !(q.tags || []).includes(tag)) return false;
    if (!kw) return true;
    const hay = (q.text + ' ' + (q.source || '') + ' ' + (q.tags || []).join(' ')
      + ' ' + (KINDS[normKind(q.kind)] || '')).toLowerCase();
    return hay.indexOf(kw) > -1;
  });
}

// 返回 [{ tag, count }]，按 count 降序
function allTags() {
  const map = {};
  readAll().forEach(q => (q.tags || []).forEach(t => { map[t] = (map[t] || 0) + 1; }));
  return Object.keys(map).map(t => ({ tag: t, count: map[t] })).sort((a, b) => b.count - a.count);
}

// 导出全部为纯文本（便于复制到备忘录 / 文档 / 其他平台）。
function exportAll() {
  const list = readAll();
  if (!list.length) return '';
  return list.map(q => {
    let line = q.text;
    if (q.tags && q.tags.length) line += '  #' + q.tags.join(' #');
    if (q.source) line += '  —— ' + q.source;
    return line;
  }).join('\n');
}

// 首次使用时注入种子金句（运营可用的「开箱即看」内容库）。
// ⚠️ 幂等：
//   ① 版本号相同 → 直接进入播种；addQuote 内部按 text 去重，重复调用不产生重复条目。
//   ② 版本号变更 → 清掉旧内置种子（q_seed_ 前缀），重新播种；用户自建（随机 id）保留。
//   ③ 每条种子必须传 id + kind：主题分类靠 id 前缀（`q_seed_<category>_`），来源筛选靠 kind 字段。
// 返回 { seeded: Boolean, count: Number }
function seedIfEmpty() {
  try {
    const ver = wx.getStorageSync(SEED_VER_KEY);
    let list = readAll();
    // 版本升级：清掉旧内置种子重播（2026-10-07 用户反馈「切来源类型句子不变」——
    // 旧版 48 条种子全无 kind，全回落 quote，其余 6 类空 → 行为异常。升级重播彻底修好）。
    // ⚠️ 按**种子文本**清除，不按 id 前缀：v1.1.54 之前播种的种子是随机 id（q_<时间戳>_xxx），
    // 只清 q_seed_ 前缀会漏掉它们，导致旧随机 id 种子残留、主题分类前缀匹配不上。
    // 按文本清则无论旧 id 格式都能识别并替换为新种子；用户自建（文本唯一）不受影响。
    if (ver !== SEED_VERSION) {
      const seedTexts = {};
      SEED_QUOTES.forEach(q => { seedTexts[String(q.text || '').trim()] = 1; });
      const kept = list.filter(q => !seedTexts[String(q.text || '').trim()]);
      if (kept.length !== list.length) { writeAll(kept); list = kept; }
      wx.setStorageSync(SEED_VER_KEY, SEED_VERSION);
    }
    let n = 0;
    SEED_QUOTES.forEach(q => {
      // ⚠️ id 决定主题分类（人生/情感/职场…），kind 决定来源类型（金句/台词/书摘…）。
      // 紧凑格式下 category/kind 均不冗余存储，需从 id 反解：
      //   q_seed_<category>_<kind>_<NN> → split('_')[3] 即 kind（quote/line/book/…）。
      const kind = normKind(String(q.id || '').split('_')[3]);
      const item = addQuote({ id: q.id, text: q.text, tags: q.tags, source: q.source || '', kind: kind });
      if (item) { n++; }
    });
    return { seeded: true, count: n };
  } catch (e) {
    return { seeded: false, count: 0 };
  }
}

module.exports = {
  KEY,
  addQuote, getQuote, updateQuote, removeQuote,
  listQuotes, searchQuotes, allTags, exportAll, normTags,
  seedIfEmpty,
  // 来源类型（2026-10-06 金句馆与台词书摘卡合并时新增）
  KINDS, KIND_KEYS, normKind
};
