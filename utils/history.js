// utils/history.js
// ─────────────────────────────────────────────────────────────────────────
// 本地历史收藏（P5 存储层 · 2026-10-01）
// 按工具分桶存储生成记录（card / comic / poster / gen），仅存本机（wx.storage），
// 不上传任何服务器（个人主体合规）。用于「最近生成」回看与一键复用。
//   addHistory(tool, record) → 连续去重入栈，每工具上限 CAP=50
//   listHistory(tool, limit) → 取某工具历史（新→旧）
//   historyCount(tool) / clearHistory(tool)
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const KEY = 'dudu_history_v1';
const CAP = 50;

function readAll() {
  try { return wx.getStorageSync(KEY) || {}; } catch (e) { return {}; }
}
function writeAll(map) {
  try { wx.setStorageSync(KEY, map); } catch (e) { /* 存储失败不影响主流程 */ }
}
// 去重比较时剔除时间戳
function strip(r) { const c = Object.assign({}, r); delete c.time; return c; }

function addHistory(tool, record) {
  if (!tool) return false;
  const r = Object.assign({ time: Date.now() }, record || {});
  const map = readAll();
  const list = map[tool] || [];
  if (list.length && JSON.stringify(strip(list[0])) === JSON.stringify(strip(r))) {
    return false; // 与最近一条相同：幂等去重
  }
  list.unshift(r);
  map[tool] = list.slice(0, CAP);
  writeAll(map);
  return true;
}

function listHistory(tool, limit) {
  const list = (readAll()[tool] || []).slice();
  return (typeof limit === 'number') ? list.slice(0, limit) : list;
}

function historyCount(tool) {
  return (readAll()[tool] || []).length;
}

function clearHistory(tool) {
  const map = readAll();
  delete map[tool];
  writeAll(map);
}

module.exports = { addHistory, listHistory, historyCount, clearHistory, KEY, CAP };
