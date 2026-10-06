// test/test_quotes_merge.js
// 金句收藏馆 × 台词/书摘卡 合并守卫（2026-10-06 新增）
//
// 用户需求：「台词/书摘卡模块，可以和金句卡模块合起来，而且都可以有收藏功能」
// 拍板方案：合成一页 + 全统一收藏库
//
// 本守卫锁五件事：
//   ① 存储层：kind 互斥枚举存在、脏值归一、旧数据（无 kind）不丢
//   ② 金句页：能录入台词/书摘（来源类型选择器）、能按来源筛选
//   ③ 台词页：能存进统一收藏库、且有互跳到收藏馆的入口
//   ④ 每日一句/节气页存馆时带正确 kind（否则统一库里筛不出来）
//   ⑤ 首页不再摆两张做同一件事的卡
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const rd = (...a) => fs.readFileSync(path.join(...a), 'utf8');
const has = (s, sub) => s.indexOf(sub) >= 0;
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
// 提取函数**定义**体（排除 this.xxx() 调用处——card-config 守卫踩过）
function funcBody(src, name) {
  const re = new RegExp('(?:^|[\\s,;{])' + name + '\\s*\\([^)]*\\)\\s*\\{', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(open + 1, i); }
  }
  return null;
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

// 用假 storage 加载 store（该模块依赖 wx.getStorageSync）
function loadStore(seed) {
  const mem = {};
  global.wx = {
    getStorageSync: k => mem[k],
    setStorageSync: (k, v) => { mem[k] = v; }
  };
  delete require.cache[require.resolve('../utils/quotes_store.js')];
  const m = require('../utils/quotes_store.js');
  if (seed != null) mem[m.KEY] = seed;
  return { store: m, mem };
}

t('存储层：kind 是互斥枚举，且登记了全部来源类型', () => {
  const { store } = loadStore([]);
  assert.ok(store.KINDS && store.KIND_KEYS, '未导出 KINDS / KIND_KEYS');
  ['quote', 'line', 'book', 'famous', 'daily', 'solar', 'festival'].forEach(k => {
    assert.ok(store.KIND_KEYS.indexOf(k) >= 0, 'kind 枚举缺 ' + k);
    assert.ok(store.KINDS[k], k + ' 缺少中文名');
  });
  // 每种来源在页面上都该有入口（至少 quote/line/book/famous 供用户手动选）
  ['quote', 'line', 'book', 'famous'].forEach(k => {
    assert.ok(store.KIND_KEYS.indexOf(k) >= 0, '用户可手动选择的类型缺 ' + k);
  });
});

t('存储层：脏 kind 归一到 quote（不产生脏枚举、不丢数据）', () => {
  const { store } = loadStore([]);
  assert.strictEqual(store.normKind('乱七八糟'), 'quote');
  assert.strictEqual(store.normKind(''), 'quote');
  assert.strictEqual(store.normKind(null), 'quote');
  assert.strictEqual(store.normKind('line'), 'line', '合法值不应被改写');
});

t('存储层：旧数据（无 kind 字段）仍可读、且归为 quote', () => {
  // 不做数据迁移：normKind 默认归一即可，避免迁移脚本把用户数据写坏
  const { store } = loadStore([{ id: 'old1', text: '迁移前的旧金句', tags: ['生活'], source: '', createdAt: 1 }]);
  assert.strictEqual(store.listQuotes().length, 1, '旧数据读不到');
  assert.strictEqual(store.searchQuotes({ kind: 'quote' }).length, 1, '旧数据未归为 quote');
  assert.strictEqual(store.normKind(store.listQuotes()[0].kind), 'quote');
});

t('存储层：按 kind 筛选互斥精确，addQuote 按文本幂等且不降级已有 kind', () => {
  const { store } = loadStore([]);
  store.addQuote({ text: '一句金句', kind: 'quote', tags: ['成长'] });
  store.addQuote({ text: '一段台词', kind: 'line', source: '《活着》', tags: ['电影'] });
  store.addQuote({ text: '一段书摘', kind: 'book', source: '《瓦尔登湖》' });
  assert.strictEqual(store.searchQuotes({ kind: 'line' }).length, 1, '台词筛选不精确');
  assert.strictEqual(store.searchQuotes({ kind: 'book' }).length, 1, '书摘筛选不精确');
  assert.strictEqual(store.searchQuotes({ kind: 'quote' }).length, 1, '金句筛选不精确');
  assert.strictEqual(store.searchQuotes({}).length, 3, '不筛时应返回全部');
  // 幂等：同文本再存一次，不新增、且已有 kind 不被默认值降级
  const again = store.addQuote({ text: '一段台词', kind: 'quote' });
  assert.strictEqual(store.listQuotes().length, 3, '重复文本被重复插入了');
  assert.strictEqual(store.normKind(again.kind), 'line', '已有 kind 被降级成 quote');
});

t('存储层：updateQuote 可改来源类型', () => {
  const { store } = loadStore([]);
  const it = store.addQuote({ text: '来源待定的一条', kind: 'quote' });
  store.updateQuote(it.id, { kind: 'book' });
  assert.strictEqual(store.normKind(store.getQuote(it.id).kind), 'book', '来源类型改不动');
});

t('存储层：搜索命中来源名（搜「台词」能找到台词条目）', () => {
  const { store } = loadStore([]);
  store.addQuote({ text: '风吹麦浪', kind: 'line', source: '《一一》' });
  const byName = store.searchQuotes({ keyword: '台词' });
  assert.strictEqual(byName.length, 1, '按来源中文名搜不到');
});

t('金句页：编辑器有来源类型选择器，且保存时带上 kind', () => {
  const wxml = rd(ROOT, 'pages', 'quotes', 'quotes.wxml');
  const js = rd(ROOT, 'pages', 'quotes', 'quotes.js');
  // 选择器
  assert.ok(/来源类型/.test(wxml), '编辑器缺「来源类型」选择器');
  assert.ok(/onPickKind/.test(wxml), '选择器未绑定 onPickKind');
  assert.ok(/kindOptions/.test(wxml), '选择器未用 kindOptions 渲染');
  // handler
  const pick = funcBody(js, 'onPickKind');
  assert.ok(pick, 'quotes.js 缺 onPickKind');
  assert.ok(/normKind/.test(strip(pick)), 'onPickKind 未做枚举归一（可能存脏值）');
  // 保存带 kind
  const save = funcBody(js, 'onSaveEdit');
  assert.ok(save, 'quotes.js 缺 onSaveEdit');
  const code = strip(save);
  assert.ok(/kind:\s*store\.normKind\(/.test(code), 'onSaveEdit 未把 kind 写进存储');
  assert.ok(/addQuote\(\s*patch/.test(code) || /addQuote\(patch\)/.test(code),
    '新增路径未复用 patch（新增/编辑行为会不一致）');
  // 编辑已有条目时回填 kind
  const edit = funcBody(js, 'onEdit');
  assert.ok(/kind:\s*store\.normKind\(q\.kind\)/.test(strip(edit)),
    'onEdit 未回填 kind（编辑时来源会丢）');
});

t('金句页：列表有来源筛选条，且筛选走同一条过滤路径', () => {
  const wxml = rd(ROOT, 'pages', 'quotes', 'quotes.wxml');
  const js = rd(ROOT, 'pages', 'quotes', 'quotes.js');
  assert.ok(/kind-filter/.test(wxml), '缺来源筛选条');
  assert.ok(/onFilterKind/.test(wxml), '筛选条未绑定 onFilterKind');
  const f = funcBody(js, 'onFilterKind');
  assert.ok(f && /applyFilter\(\)/.test(strip(f)), 'onFilterKind 未触��� applyFilter');
  // applyFilter 必须把 filterKind 传给 store
  const af = funcBody(js, 'applyFilter');
  assert.ok(/kind:\s*this\.data\.filterKind/.test(strip(af)),
    'applyFilter 未传 filterKind（筛选点了没反应）');
  // ⚠️ refresh 必须复用 applyFilter，不能自己再调一次 searchQuotes——
  //    两处各筛一次会导致 onShow 时筛选被悄悄重置（合并时踩过）
  const rf = funcBody(js, 'refresh');
  assert.ok(/applyFilter\(\)/.test(strip(rf)), 'refresh 未复用 applyFilter');
  assert.ok(!/searchQuotes/.test(strip(rf)),
    'refresh 仍自己调 searchQuotes —— 会绕过 kind 筛选，两处逻辑分叉');
  // 列表项显示来源徽标
  assert.ok(/kindName/.test(wxml), '列表项未显示来源徽标');
});

t('台词页：能存进统一收藏库并带上来源类型', () => {
  const js = rd(ROOT, 'pages', 'line', 'line.js');
  const wxml = rd(ROOT, 'pages', 'line', 'line.wxml');
  const save = funcBody(js, 'onSaveToVault');
  assert.ok(save, '台词页缺 onSaveToVault（并入统一库后就存不进去了）');
  const code = strip(save);
  assert.ok(/addQuote\(/.test(code), 'onSaveToVault 未写入收藏库');
  assert.ok(/kind:\s*this\.data\.kind/.test(code), '未带 kind（统一库里无法按来源筛选）');
  // 必须先校验空内容
  assert.ok(/if\s*\(\s*!text\s*\)/.test(code), '未校验空内容（会存进空条目）');
  // 按钮在页面上
  assert.ok(/bindtap="onSaveToVault"/.test(wxml), '台词页缺「存金句馆」按钮');
});

t('台词页：存馆不扣积分（积分只对成卡收费）', () => {
  const js = rd(ROOT, 'pages', 'line', 'line.js');
  const save = funcBody(js, 'onSaveToVault');
  assert.ok(!/charge\(/.test(strip(save)),
    'onSaveToVault 里调了 charge —— 存馆不应扣费，全站口径是「成卡才扣」');
  // 而成卡仍要扣
  const gen = funcBody(js, 'onGen');
  assert.ok(/charge\('lineCard'/.test(strip(gen)), '成卡未扣费');
});

t('台词页：与金句馆双向可达（不制造死胡同）', () => {
  const wxml = rd(ROOT, 'pages', 'line', 'line.wxml');
  const js = rd(ROOT, 'pages', 'line', 'line.js');
  assert.ok(/onGoQuotes/.test(wxml) && /onGoQuotes/.test(js), '台词页缺「去收藏馆」入口');
  const go = funcBody(js, 'onGoQuotes');
  assert.ok(/\/pages\/quotes\/quotes/.test(strip(go)), 'onGoQuotes 未跳到金句收藏馆');
  // 反向：金句页要能说明「台词已并入」
  const qwxml = rd(ROOT, 'pages', 'quotes', 'quotes.wxml');
  assert.ok(/台词/.test(qwxml), '金句页未提及台词/书摘（用户不知道这里能收台词）');
});

t('每日一句 / 节气页存馆时带正确 kind（统一库要能筛出来源）', () => {
  const spark = rd(ROOT, 'pages', 'spark', 'spark.js');
  const sSave = funcBody(spark, 'onSaveToVault');
  assert.ok(sSave && /kind:\s*'daily'/.test(strip(sSave)),
    '每日一句存馆未带 kind=daily');

  const solar = rd(ROOT, 'pages', 'solar', 'solar.js');
  const soSave = funcBody(solar, 'onSaveToVault');
  const code = strip(soSave);
  assert.ok(soSave && /kind:/.test(code), '节气页存馆未带 kind');
  // 节气与节日是两种来源，不能一律记成节气
  assert.ok(/'solar'/.test(code) && /'festival'/.test(code),
    '节气页未区分「节气」与「节日」两种来源');
});

t('首页不再摆两张做同一件事的卡', () => {
  const js = rd(ROOT, 'pages', 'index', 'index.js');
  const block = (js.match(/const TOOL_DEFS = \[([\s\S]*?)\n\];/) || ['', ''])[1];
  assert.ok(block.length, '未能定位 TOOL_DEFS');
  const keys = (block.match(/key:\s*'(\w+)'/g) || []).map(s => s.split("'")[1]);
  // 合并后金句与台词是同一件事，首页只应保留一个入口
  assert.ok(keys.indexOf('quotes') >= 0, '金句收藏馆入口丢了');
  assert.ok(keys.indexOf('line') < 0,
    '首页仍有独立「台词/书摘卡」入口 —— 与金句馆是同一件事，两张卡会让用户以为要分别管理');
  // 描述要说清合并了什么，否则用户不知道台词去哪了
  const qDesc = (block.match(/key: 'quotes'[\s\S]{0,160}/) || [''])[0];
  assert.ok(/台词/.test(qDesc), '金句馆描述未提及台词/书摘');
  // 路由表可保留 line（分享链接不失效），但不能是首页入口
  assert.ok(/line: '\/pages\/line\/line'/.test(js), 'line 路由被删了，分享链接会失效');
});

t('合并后五处仍各自只扣一次费、且 action 不变', () => {
  // 防合并时手抖改了计费口径
  const MAP = {
    quotes: 'quoteCard', spark: 'sparkCard', weather: 'weatherCard',
    solar: 'solarCard', line: 'lineCard'
  };
  Object.keys(MAP).forEach(page => {
    const js = rd(ROOT, 'pages', page, page + '.js');
    const n = (strip(js).match(new RegExp("charge\\(\\s*'" + MAP[page] + "'", 'g')) || []).length;
    assert.strictEqual(n, 1, page + '.js 里 charge(\'' + MAP[page] + '\') 出现 ' + n + ' 次（应恰好 1 次）');
  });
});

console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;