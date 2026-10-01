// test/test_history.js
// 历史收藏（P5 存储层）+ 分享闭环封装（P6）纯逻辑单测（mock wx storage / canvas 导出）。
'use strict';
const assert = require('assert');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

// ── mock wx（storage + canvas 导出 + 相册保存）──
const storage = {};
global.wx = {
  getStorageSync: (k) => storage[k] || '',
  setStorageSync: (k, v) => { storage[k] = v; },
  canvasToTempFilePath: (opt) => { setTimeout(() => opt.success({ tempFilePath: global.__exportPath || 'tmp://img.png' }), 0); },
  saveImageToPhotosAlbum: (opt) => { setTimeout(() => opt.success({}), 0); }
};

const history = require('../utils/history');
const share = require('../utils/share');

t('addHistory → listHistory：入栈且新→旧', () => {
  history.clearHistory('card');
  history.addHistory('card', { title: 'a' });
  history.addHistory('card', { title: 'b' });
  const list = history.listHistory('card');
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].title, 'b', '最新在前');
  assert.ok(list[0].time > 0, '应带时间戳');
});

t('连续去重：与最近一条完全相同不重复入栈', () => {
  history.clearHistory('poster');
  assert.strictEqual(history.addHistory('poster', { title: 'x', theme: 'warm' }), true);
  assert.strictEqual(history.addHistory('poster', { title: 'x', theme: 'warm' }), false, '重复应返回 false');
  assert.strictEqual(history.historyCount('poster'), 1);
});

t('容量上限：每工具最多 CAP=50 条', () => {
  history.clearHistory('comic');
  for (let i = 0; i < 60; i++) history.addHistory('comic', { seq: i });
  assert.ok(history.historyCount('comic') <= history.CAP, '不应超过 50');
  assert.strictEqual(history.historyCount('comic'), 50);
  const list = history.listHistory('comic');
  assert.strictEqual(list[0].seq, 59, '应保留最新 50 条');
});

t('工具分桶隔离 + limit 截取 + clear', () => {
  history.clearHistory('card');
  history.clearHistory('gen');
  history.addHistory('card', { title: 'c1' });
  history.addHistory('gen', { title: 'g1' });
  assert.strictEqual(history.listHistory('card', 5).length, 1);
  assert.strictEqual(history.listHistory('gen', 5)[0].title, 'g1');
  history.clearHistory('card');
  assert.strictEqual(history.historyCount('card'), 0);
  assert.strictEqual(history.historyCount('gen'), 1, 'clear 只清对应工具');
});

t('exportAndSave：导出→保存→历史入栈 全链路成功', () => {
  history.clearHistory('poster');
  const page = {};
  const p = share.exportAndSave(page, { fake: 'canvas' }, {
    historyTool: 'poster',
    historyRecord: { title: '海报1' },
    savingKey: '_saving'
  });
  return p.then((path) => {
    assert.strictEqual(path, 'tmp://img.png');
    assert.strictEqual(history.historyCount('poster'), 1, '保存成功应写入历史');
    assert.strictEqual(page._saving, false, 'saving 标记应复位');
  });
});

t('exportAndSave：保存中重复调用被拒绝（防重复提交）', () => {
  const page = {};
  // 让导出挂起：临时替换 canvasToTempFilePath 为不回调
  const orig = global.wx.canvasToTempFilePath;
  global.wx.canvasToTempFilePath = () => {};
  const first = share.exportAndSave(page, {}, { historyTool: 'card', savingKey: '_savingCard' });
  const second = share.exportAndSave(page, {}, { historyTool: 'card', savingKey: '_savingCard' });
  global.wx.canvasToTempFilePath = orig;
  return second.then(() => { throw new Error('第二次调用应当被拒绝'); })
    .catch((e) => { assert.strictEqual(e.message, 'busy'); })
    .then(() => new Promise(r => setTimeout(r, 10))) // 等第一个挂起流程超时释放（不会回调，手动复位）
    .then(() => { page._savingCard = false; });
});

t('exportAndSave：导出空文件路径视为失败（不允许假成功）', () => {
  global.__exportPath = '';
  const page = {};
  const p = share.exportAndSave(page, {}, { historyTool: 'card', savingKey: '_savingEmpty' });
  return p.then(() => { throw new Error('空路径应当失败'); })
    .catch((e) => { assert.ok(/空|file/i.test(e.message)); })
    .then(() => { global.__exportPath = 'tmp://img.png'; });
});

t('shareConfig：统一分享配置出口', () => {
  const c = share.shareConfig('标题', '/pages/poster/poster');
  assert.strictEqual(c.title, '标题');
  assert.strictEqual(c.path, '/pages/poster/poster');
  assert.ok(share.shareConfig().title, '缺省也有标题');
});

// exportAndSave 的返回值是 Promise，t() 的 fn 返回 Promise 不会自动 await —— 手动等待
setTimeout(() => {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}, 300);
