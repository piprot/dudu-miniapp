// test/test_card_page.js
// 卡片页逻辑全链路测试（2026-10-01 全面测试新增）：
// 用 mock Page() 真实加载 pages/card/card.js，覆盖
//   初始化种子（文案库）→ 切类型（六类结构正确）→ 换一套（与库一致）
//   → 主题切换 → collectData（清单换行转数组 / 日签自动补日期正文）
//   → buildModel × 引擎消费（6 类 × 6 主题不抛错）→ 文案池异常兜底。
'use strict';
const assert = require('assert');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

// ── mock Page()，捕获页面配置 ──
let pageCfg = null;
const origPage = global.Page;
global.Page = (cfg) => { pageCfg = cfg; };
require('../pages/card/card.js');
global.Page = origPage;

const daily = require('../utils/templates/daily');
const { computeLayout, draw, defaultMeasure } = require('../utils/core/render_engine');
const { THEME_LIST } = require('../utils/themes/index.js');

function makePage() {
  const page = Object.create(pageCfg);
  page.data = JSON.parse(JSON.stringify(pageCfg.data));
  page.setData = function (obj) { Object.assign(this.data, obj); };
  return page;
}

function fakeCtx() {
  const noop = () => {};
  return {
    font: '', textBaseline: '', textAlign: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
    clearRect: noop, fillRect: noop, fillText: noop, beginPath: noop,
    moveTo: noop, arcTo: noop, arc: noop, closePath: noop, fill: noop, stroke: noop,
    save: noop, restore: noop, clip: noop, scale: noop, rect: noop,
    drawImage: noop, measureText: (t) => ({ width: String(t).length * 8 }),
    createLinearGradient: () => ({ addColorStop: noop })
  };
}

const TYPES = ['dailysign', 'quote', 'recommend', 'notice', 'checklist', 'imagetext'];

function pick(page, key) {
  page.onSelectType({ currentTarget: { dataset: { key } } });
}

t('页面初始化：日签正文来自今日推荐，6 套主题与库存就绪', () => {
  const page = makePage();
  assert.strictEqual(page.data.type, 'dailysign');
  assert.ok(page.data.form.body && page.data.form.body.length > 0, '日签种子正文应来自文案库');
  assert.strictEqual(page.data.themes.length, 6);
  assert.strictEqual(page.data.poolSize, daily.poolSize());
});

t('切类型：六类种子全部来自文案库且结构正确', () => {
  const checks = {
    dailysign: f => assert.ok(f.title.indexOf('月') >= 0 && f.body, '日签应有日期标题与正文'),
    quote: f => assert.ok(f.body, '金句应有正文'),
    recommend: f => assert.ok(f.title && f.body && f.tag, '种草应有 title/body/tag'),
    notice: f => assert.ok(f.title && f.body, '公告应有 title/body'),
    checklist: f => assert.ok(typeof f.items === 'string' && f.items.split('\n').length >= 3, '清单 items 应为换行字符串且 ≥3 条'),
    imagetext: f => assert.ok(f.title && f.body, '图文应有 title/body')
  };
  for (const tp of TYPES) {
    const page = makePage();
    pick(page, tp);
    checks[tp](page.data.form);
    assert.strictEqual(page.data.poolSize, daily.poolSizeFor(tp), tp + ' 库存应随类型更新');
  }
});

t('换一套：全类型连续换 5 套均变化且与文案库一致', () => {
  for (const tp of TYPES) {
    const page = makePage();
    pick(page, tp);
    for (let k = 1; k <= 5; k++) {
      page.onShuffleQuote();
      const f = page.data.form;
      if (tp === 'dailysign' || tp === 'quote') {
        assert.strictEqual(f.body, daily.todayQuote(k).t, tp + ' 第 ' + k + ' 套应等于库内 offset=' + k);
      } else {
        const s = daily.seedForType(tp, null, k);
        assert.strictEqual(f.title, s.title, tp + ' 第 ' + k + ' 套标题应一致');
        assert.strictEqual(f.body, s.body, tp + ' 第 ' + k + ' 套正文应一致');
        if (s.tag) assert.strictEqual(f.tag, s.tag);
        if (s.items) assert.strictEqual(f.items, s.items.join('\n'));
      }
    }
  }
});

t('换一套：连续换到整轮长度也不越界、可循环', () => {
  const page = makePage();
  pick(page, 'recommend');
  const N = daily.poolSizeFor('recommend');
  for (let k = 1; k <= N + 3; k++) page.onShuffleQuote(); // 超一轮不抛错
  assert.ok(page.data.form.title, '循环后仍有合法种子');
});

t('主题切换：onPickTheme 生效并重置渲染态', () => {
  const page = makePage();
  page.onPickTheme({ currentTarget: { dataset: { id: 'olive' } } });
  assert.strictEqual(page.data.theme, 'olive');
  assert.strictEqual(page.data.rendered, false);
});

t('collectData：清单换行转数组；日签自动补日期与正文', () => {
  const cPage = makePage();
  pick(cPage, 'checklist');
  cPage.data.form.items = ' 买牛奶 \n写周报\n\n跑步 ';
  const cd = cPage.collectData();
  assert.deepStrictEqual(cd.items, ['买牛奶', '写周报', '跑步'], '应去空白并过滤空行');

  const sPage = makePage();
  sPage.data.form = { title: '', body: '' };
  const sd = sPage.collectData();
  assert.ok(sd.title.indexOf('月') >= 0, '日签标题应自动补今天日期');
  assert.ok(sd.body && sd.body.length > 0, '日签正文应自动补今日推荐');
});

t('buildModel：6 类 × 6 主题全部被引擎消费不抛错', () => {
  for (const tp of TYPES) {
    const page = makePage();
    pick(page, tp);
    for (const th of THEME_LIST) {
      page.onPickTheme({ currentTarget: { dataset: { id: th.id } } });
      const model = page.buildModel();
      assert.strictEqual(model.width, 340);
      const layout = computeLayout(model, {}, defaultMeasure);
      assert.ok(layout.height > 0, tp + '/' + th.id + ' 高度应 > 0');
      draw(fakeCtx(), layout);
    }
  }
});

t('文案池异常兜底：seedForType 返回 null 时回退静态种子不崩', () => {
  const orig = daily.seedForType;
  daily.seedForType = () => null;
  try {
    const page = makePage();
    page.onSelectType({ currentTarget: { dataset: { key: 'recommend' } } });
    assert.ok(page.data.form && page.data.form.title, '应回退到静态 SEED，页面可用');
  } finally {
    daily.seedForType = orig;
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
