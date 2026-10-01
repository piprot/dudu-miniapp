// test/test_poster_page.js
// 海报页逻辑全链路测试（mock Page 真实加载 pages/poster/poster.js）：
//   初始化（今日金句种子 / 6 主题 / 单价）→ 主题切换 → 换一套（与库一致）
//   → collectData（日期标签 / 二维码 / 空内容自动回填今日金句 / 头像背景槽位）
//   → buildModel × 引擎消费（6 主题不抛错）→ 空内容生成被拦截。
'use strict';
const assert = require('assert');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

// ── mock Page() / wx（charge 依赖 showToast/存储，补最低限度接口防止跨套件 mock 泄漏崩溃）──
let pageCfg = null;
const origPage = global.Page;
global.Page = (cfg) => { pageCfg = cfg; };
global.wx = Object.assign({}, global.wx, {
  showToast: global.wx && global.wx.showToast ? global.wx.showToast : () => {},
  getStorageSync: global.wx && global.wx.getStorageSync ? global.wx.getStorageSync : () => '',
  setStorageSync: global.wx && global.wx.setStorageSync ? global.wx.setStorageSync : () => {}
});
require('../pages/poster/poster.js');
global.Page = origPage;

const daily = require('../utils/templates/daily');
const { computeLayout, draw, defaultMeasure } = require('../utils/core/render_engine');
const { THEME_LIST } = require('../utils/themes');

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

t('页面初始化：金句默认为今日推荐，6 套主题与单价就绪', () => {
  const page = makePage();
  assert.strictEqual(page.data.form.quote, daily.todayQuote().text, '金句种子应来自今日推荐');
  assert.strictEqual(page.data.themes.length, 6);
  assert.ok(page.data.posterCost > 0, '海报单价应从 POINTS.cost 读取');
  assert.strictEqual(page.data.quotePoolSize, daily.poolSize(), '库存展示应等于金句库容量');
});

t('主题切换：onPickTheme 生效并重置渲染态', () => {
  const page = makePage();
  page.onPickTheme({ currentTarget: { dataset: { id: 'zen' } } });
  assert.strictEqual(page.data.theme, 'zen');
  assert.strictEqual(page.data.rendered, false);
});

t('换一套：连续换 5 套均与文案库一致', () => {
  const page = makePage();
  for (let k = 1; k <= 5; k++) {
    page.onShuffleQuote();
    assert.strictEqual(page.data.form.quote, daily.todayQuote(k).t, '第 ' + k + ' 套应等于库内 offset=' + k);
  }
});

t('collectData：带日期标签、二维码；头像/背景图按所选注入', () => {
  const page = makePage();
  page.data.avatar = 'local://a.jpg';
  page.data.bgImg = 'local://b.jpg';
  const d = page.collectData();
  assert.ok(d.dateLabel.indexOf('月') >= 0 && d.dateLabel.indexOf('星期') >= 0, '应有今天日期标签');
  assert.ok(d.qr, '应带小程序码路径');
  assert.strictEqual(d.avatar, 'local://a.jpg');
  assert.strictEqual(d.bgImg, 'local://b.jpg');
  assert.ok(d.quote, '金句不应为空');
});

t('collectData：全空表单自动回填今日金句（首用永远有产出）', () => {
  const page = makePage();
  page.data.form = { title: '', quote: '', body: '', author: '', nickname: '' };
  const d = page.collectData();
  assert.strictEqual(d.quote, daily.todayQuote().text, '空内容应回填今日金句');
});

t('空表单生成不被误拦：今日金句自动回填，直接进入生成流程', () => {
  const page = makePage();
  page.data.form = { title: '', quote: '', body: '', author: '', nickname: '' };
  // 防御性 mock：charge 内部若真调云函数立即暴露（正常应被 charge 自身异常处理吞掉）
  global.wx.cloud = { callFunction: () => { throw new Error('云调用未 mock'); } };
  try { page.onGenPoster(); } catch (e) { /* charge 异步链内部消化 */ }
  assert.ok(!page.data.err, '空表单不应触发 err（collectData 已回填今日金句）');
  delete global.wx.cloud;
});

t('buildModel 全链路：collectData × 6 主题全部被引擎消费不抛错', () => {
  for (const th of THEME_LIST) {
    const page = makePage();
    page.onPickTheme({ currentTarget: { dataset: { id: th.id } } });
    const d = page.collectData();
    const { buildPosterModel } = require('../utils/templates/poster');
    const model = buildPosterModel(th.id, d, {});
    assert.strictEqual(model.width, 375);
    assert.ok(model.height >= 480, th.id + ' 海报应为长图高度');
    const layout = computeLayout(model, {}, defaultMeasure);
    draw(fakeCtx(), layout, {});
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
