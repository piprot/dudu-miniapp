// test/test_quotes_page.js —— 金句收藏馆页面行为守卫（2026-10-08 新增）
//
// 背景（用户反馈「节气、节日这两个 sheet 还没有改」）：
//   节气/节日共 120 条种子全部挂在「时间」分类（q_seed_time_solar_* / q_seed_time_festival_*），
//   而金句馆进页默认大类是「成长」(HOT_CATS[0]='growth')。旧版 onFilterKind 只切
//   filterKind、不清 activeCat → 「节气 ∩ 成长 = 0 条」，这两个 sheet 整版空掉，
//   看起来就像「切了没反应」。其余 5 类来源在成长分类下各有 10 条，所以显得正常。
//
// 修复：onFilterKind 切来源时把 activeCat/activeTag/pgItem/pgGroupOpen 一并归位。
// 本测试用 mock Page() 真实加载 pages/quotes/quotes.js，锁住这条行为链。
'use strict';
const assert = require('assert');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

// ── mock wx.storage（内存版）──
const mem = {};
global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; }
};

// ── mock Page()，捕获页面配置 ──
let pageCfg = null;
const origPage = global.Page;
global.Page = (cfg) => { pageCfg = cfg; };
require('../pages/quotes/quotes.js');
global.Page = origPage;

const store = require('../utils/quotes_store');

function makePage() {
  const page = Object.create(pageCfg);
  page.data = JSON.parse(JSON.stringify(pageCfg.data));
  page.setData = function (obj) { Object.assign(this.data, obj); };
  return page;
}

t('页面初始化：种子就绪（420 条）、今日推荐非空、默认分类过滤生效', () => {
  const page = makePage();
  page.onLoad();
  assert.ok(page.data.count >= 420, '种子总数应 ≥420，实际 ' + page.data.count);
  assert.ok(page.data.todayPick && page.data.todayPick.text, '今日推荐应非空');
  assert.strictEqual(page.data.filterKind, '', '默认来源筛选=全部');
  // 进页默认落「成长」大类（设计如此），列表是成长分类下的条目
  assert.strictEqual(page.data.activeCat, 'growth');
  assert.ok(page.data.list.length > 0, '默认列表非空');
});

t('【回归核心】切「节气」sheet：分类归位、60 条全量可见（修复前为 0 条空版）', () => {
  const page = makePage();
  page.onLoad();
  page.onFilterKind({ currentTarget: { dataset: { key: 'solar' } } });
  assert.strictEqual(page.data.filterKind, 'solar');
  assert.strictEqual(page.data.activeCat, '', '切来源后主题大类必须归位（残留 growth 会清空节气 sheet）');
  assert.strictEqual(page.data.activeTag, '', '切来源后标签也应归位');
  assert.strictEqual(page.data.pgGroupOpen, false, '小类区应收起，避免高亮与列表不一致的错觉');
  assert.strictEqual(page.data.list.length, 60, '节气 sheet 应见全部 60 条，实际 ' + page.data.list.length);
  assert.ok(page.data.list.every(q => q.kindName === '节气'), '列表应全部是节气条目');
  // 今日推荐也切到节气池
  assert.ok(page.data.todayPick && page.data.todayPick.text, '节气 sheet 今日推荐应非空');
});

t('【回归核心】切「节日」sheet：同理 60 条全量可见', () => {
  const page = makePage();
  page.onLoad();
  page.onFilterKind({ currentTarget: { dataset: { key: 'festival' } } });
  assert.strictEqual(page.data.activeCat, '');
  assert.strictEqual(page.data.list.length, 60, '节日 sheet 应见全部 60 条，实际 ' + page.data.list.length);
  assert.ok(page.data.list.every(q => q.kindName === '节日'), '列表应全部是节日条目');
});

t('复现修复前病灶：残留 activeCat=growth 时节气 sheet 确实为空（证明修复必要）', () => {
  const page = makePage();
  page.onLoad();
  // 手工制造旧版行为：切到节气但大类残留「成长」
  page.setData({ filterKind: 'solar', activeCat: 'growth', activeTag: '' });
  page.applyFilter();
  assert.strictEqual(page.data.list.length, 0,
    '成长分类下没有节气种子 → 旧版这里整版空掉，正是用户看到的「没反应」');
});

t('真实动线：选了大类再看别的来源，来源切换依然把分类归位（不被残留卡死）', () => {
  const page = makePage();
  page.onLoad();
  page.onFilterKind({ currentTarget: { dataset: { key: 'solar' } } });
  // 用户点大类「职场」→ 节气∩职场=0（诚实空态，属正常）
  page.onPickGroup({ currentTarget: { dataset: { group: 'work' } } });
  assert.strictEqual(page.data.activeCat, 'work');
  assert.strictEqual(page.data.list.length, 0, '职场分类下无节气条目，空态是诚实的');
  // 再切到「节日」→ 分类必须归位，不能被 work 残留卡死
  page.onFilterKind({ currentTarget: { dataset: { key: 'festival' } } });
  assert.strictEqual(page.data.activeCat, '');
  assert.strictEqual(page.data.list.length, 60, '切来源后应摆脱残留分类，见全部节日');
  // 大类选「时间」→ 节日∩时间=60（节日种子全在时间分类）
  page.onPickGroup({ currentTarget: { dataset: { group: 'time' } } });
  assert.strictEqual(page.data.list.length, 60, '时间分类下节日应全量可见');
});

t('切回「全部」来源：分类保持归位，列表恢复非空', () => {
  const page = makePage();
  page.onLoad();
  page.onFilterKind({ currentTarget: { dataset: { key: 'solar' } } });
  page.onFilterKind({ currentTarget: { dataset: { key: '' } } });
  assert.strictEqual(page.data.filterKind, '');
  assert.strictEqual(page.data.activeCat, '');
  assert.ok(page.data.list.length >= 420, '全部 sheet 应回到全库，实际 ' + page.data.list.length);
});

t('幂等：重复点同一个来源 chip 不重刷、不误清用户后续选择', () => {
  const page = makePage();
  page.onLoad();
  page.onFilterKind({ currentTarget: { dataset: { key: 'solar' } } });
  const before = JSON.stringify({ f: page.data.filterKind, c: page.data.activeCat, n: page.data.list.length });
  page.onFilterKind({ currentTarget: { dataset: { key: 'solar' } } });
  const after = JSON.stringify({ f: page.data.filterKind, c: page.data.activeCat, n: page.data.list.length });
  assert.strictEqual(after, before, '重复点击应无副作用');
});

t('今日推荐：节气/节日/金句三池各自独立轮换（切 sheet 句子要变）', () => {
  const page = makePage();
  page.onLoad();
  const picks = {};
  ['quote', 'solar', 'festival'].forEach(k => {
    page.onFilterKind({ currentTarget: { dataset: { key: k } } });
    picks[k] = page.data.todayPick && page.data.todayPick.text;
  });
  assert.ok(picks.quote && picks.solar && picks.festival, '三池今日推荐都应非空');
  assert.strictEqual(new Set(Object.values(picks)).size, 3,
    '三个来源的今日推荐应互不相同：' + JSON.stringify(picks));
});

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
if (fail > 0) process.exitCode = 1;
