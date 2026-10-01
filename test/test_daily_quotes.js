// test/test_daily_quotes.js
// 每日文案库单测：储备量、确定性、一整轮不重复、换一句不撞车、文案纯净度。
'use strict';
const assert = require('assert');
const daily = require('../utils/templates/daily');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

t('储备充足：库内 ≥ 400 条（一年不重样）', () => {
  assert.ok(daily.poolSize() >= 400, '实际 ' + daily.poolSize() + ' 条，须 ≥ 400');
});

t('文案纯净：全部非空、≤30 字、不含英文字母（卡片中文产品）', () => {
  const seen = new Set();
  const N = daily.poolSize();
  for (let i = 0; i < N; i++) {
    const q = daily.quoteForDate('2026-01-01', i % 1 === 0 ? i : i); // 遍历全库：offset i 命中所有 idx
  }
  // 直接用 dayIndex+STEP 遍历会绕；改为校验连续 N 天取到的句子
  const texts = new Set();
  for (let d = 0; d < N; d++) {
    const di = Math.floor(Date.UTC(2026, 0, 1) / 86400000) + d;
    const y = 2026, m = 0, day = 1 + d;
    const date = new Date(Date.UTC(y, m, day));
    const s = date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
    const q = daily.quoteForDate(s, 0);
    assert.ok(q.t && q.t.length > 0, '存在空文案');
    assert.ok(q.t.length <= 30, '文案过长: ' + q.t);
    assert.ok(!/[a-zA-Z]/.test(q.t), '混入英文字母: ' + q.t);
    texts.add(q.t);
  }
  assert.strictEqual(texts.size, N, '连续 ' + N + ' 天应取满全库不重复');
});

t('确定性：同一日期两次取值完全一致', () => {
  const a = daily.quoteForDate('2026-10-01', 0);
  const b = daily.quoteForDate('2026-10-01', 0);
  assert.strictEqual(a.t, b.t);
  assert.strictEqual(a.index, b.index);
  assert.strictEqual(a.text, a.t, 'text 应为 t 的可读别名（页面层防误用）');
});

t('跨天必换：相邻两天文案不同', () => {
  const a = daily.quoteForDate('2026-10-01', 0);
  const b = daily.quoteForDate('2026-10-02', 0);
  assert.notStrictEqual(a.t, b.t);
});

t('一整轮不重复：连续 400 天取到 400 条互不相同', () => {
  const texts = new Set();
  const base = Math.floor(Date.UTC(2026, 0, 1) / 86400000);
  for (let d = 0; d < 400; d++) {
    const dt = new Date((base + d) * 86400000);
    const s = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
    texts.add(daily.quoteForDate(s, 0).t);
  }
  assert.strictEqual(texts.size, 400, '400 天应 400 条不重复，实际 ' + texts.size);
});

t('换一句：同一天 offset 0..10 互不撞车', () => {
  const texts = new Set();
  for (let k = 0; k <= 10; k++) texts.add(daily.quoteForDate('2026-10-01', k).t);
  assert.strictEqual(texts.size, 11, 'STEP 与库容量应互质，换一句不重复');
});

t('offset 环绕：超大 offset 不越界、可循环', () => {
  const a = daily.quoteForDate('2026-10-01', 0);
  const b = daily.quoteForDate('2026-10-01', daily.poolSize() * 97);
  assert.ok(b.t && b.t.length > 0);
  // (di + N*97*STEP) ≡ di (mod N) → 回到当日主推
  assert.strictEqual(a.t, b.t);
});

t('todayQuote：返回今天（本地）且带分类', () => {
  const q = daily.todayQuote();
  assert.strictEqual(q.date, daily.dateStrOf());
  assert.ok(q.c && q.c.length > 0, '应带分类标签');
  assert.ok(q.t.length > 0);
});

t('日期解析健壮：非法输入回退今天，不抛错', () => {
  const q = daily.quoteForDate('not-a-date', 0);
  assert.ok(q.t && q.t.length > 0);
});

// ── 各卡片类型专属文案池（2026-10-01 接入全类型）──
const STRUCT_TYPES = ['recommend', 'notice', 'checklist', 'imagetext'];
function dateFromBase(baseMs, d) {
  const dt = new Date(baseMs + d * 86400000);
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
}

t('各类型文案库储备充足（每类 ≥ 60 条；日签/金句复用 400+ 金句库）', () => {
  for (const tp of STRUCT_TYPES) {
    const n = daily.poolSizeFor(tp);
    assert.ok(n >= 60, tp + ' 储备 ' + n + ' 条，须 ≥ 60');
  }
  assert.strictEqual(daily.poolSizeFor('dailysign'), daily.poolSize());
  assert.strictEqual(daily.poolSizeFor('quote'), daily.poolSize());
  assert.strictEqual(daily.poolSizeFor('nope'), null);
});

t('结构符合卡片主题（种草带价签 / 清单带条目 / 公告图文成对）', () => {
  for (let i = 0; i < 60; i++) {
    const r = daily.seedForType('recommend', '2026-10-01', i);
    assert.ok(r.title && r.body && r.tag, '种草卡种子须含 title/body/tag @offset ' + i);
    const n = daily.seedForType('notice', '2026-10-01', i);
    assert.ok(n.title && n.body, '公告卡种子须含 title/body @offset ' + i);
    const c = daily.seedForType('checklist', '2026-10-01', i);
    assert.ok(c.title && Array.isArray(c.items) && c.items.length >= 3 && c.items.length <= 5, '清单卡种子须含 title 与 3-5 条 items @offset ' + i);
    const it = daily.seedForType('imagetext', '2026-10-01', i);
    assert.ok(it.title && it.body, '图文卡种子须含 title/body @offset ' + i);
  }
});

t('各类型按日轮换一整轮不重复', () => {
  const baseMs = Math.floor(Date.UTC(2026, 0, 1) / 86400000) * 86400000;
  for (const tp of STRUCT_TYPES) {
    const N = daily.poolSizeFor(tp);
    const seen = new Set();
    for (let d = 0; d < N; d++) {
      seen.add(JSON.stringify(daily.seedForType(tp, dateFromBase(baseMs, d), 0)));
    }
    assert.strictEqual(seen.size, N, tp + ' 连续 ' + N + ' 天应取满全池不重复');
  }
});

t('各类型「换一套」同日 offset 0..10 不撞车', () => {
  for (const tp of STRUCT_TYPES) {
    const seen = new Set();
    for (let k = 0; k <= 10; k++) seen.add(JSON.stringify(daily.seedForType(tp, '2026-10-01', k)));
    assert.strictEqual(seen.size, 11, tp);
  }
});

t('结构池文案纯净：无空串、≤40 字、无英文字母', () => {
  const check = (s, label) => {
    assert.ok(typeof s === 'string' && s.length > 0, label + ' 空文案');
    assert.ok(s.length <= 40, label + ' 过长: ' + s);
    assert.ok(!/[a-zA-Z]/.test(s), label + ' 混入英文: ' + s);
  };
  for (const tp of STRUCT_TYPES) {
    const N = daily.poolSizeFor(tp);
    for (let i = 0; i < N; i++) {
      const s = daily.seedForType(tp, '2026-10-01', i);
      check(s.title, tp + '.title');
      if (s.body) check(s.body, tp + '.body');
      if (s.tag) check(s.tag, tp + '.tag');
      if (s.items) s.items.forEach((it, j) => check(it, tp + '.items[' + j + ']'));
    }
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
