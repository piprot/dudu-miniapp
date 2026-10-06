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

const KEY = 'dudu_quotes_v1';

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

// 新增一条金句；同一文本已存在则视为更新（幂等，不重复存）。
function addQuote(input) {
  const text = String(input && input.text || '').trim();
  if (!text) return null;
  const list = readAll();
  const exist = list.find(q => q.text === text);
  if (exist) {
    // 已存在：合并标签与出处，不重复插入
    const tags = normTags((exist.tags || []).concat(input.tags || []).join(','));
    if (input.source && !exist.source) exist.source = input.source;
    exist.tags = tags;
    writeAll(list);
    return exist;
  }
  const item = {
    id: genId(),
    text,
    tags: normTags(input.tags),
    source: String(input.source || '').trim(),
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
  return readAll().filter(q => {
    if (tag && !(q.tags || []).includes(tag)) return false;
    if (!kw) return true;
    const hay = (q.text + ' ' + (q.source || '') + ' ' + (q.tags || []).join(' ')).toLowerCase();
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

module.exports = {
  KEY,
  addQuote, getQuote, updateQuote, removeQuote,
  listQuotes, searchQuotes, allTags, exportAll, normTags
};
