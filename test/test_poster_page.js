// test/test_poster_page.js
// 海报页逻辑全链路测试（mock Page 真实加载 pages/poster/poster.js）：
//   初始化（今日金句种子 / 6 主题 / 单价）→ 主题切换 → 换一套（与库一致）
//   → collectData（日期标签 / 二维码 / 空内容自动回填今日金句 / 头像背景槽位）
//   → buildModel × 引擎消费（6 主题不抛错）→ 空内容生成被拦截。
'use strict';

// 2026-10-24 分包改造：安装路径重定向钩子（pages/ 与 utils/ 的虚拟路径 → 真实位置）。
//   详见 test/_paths.js。不装的话本文件里的 path.join(ROOT,'pages',...) 会 ENOENT。
require('./_paths.js');
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

t('页面初始化：金句默认为今日推荐，6 套主题与单价就绪', () => {
  const page = makePage();
  // ⚠️ 2026-10-25 修正：海报用的是**独立的海报文案池** posterQuote（65 条），
  //   与日签/金句的 todayQuote（1404 条）刻意分开，避免「日签和海报出同一句话」。
  //   旧断言拿 todayQuote 比对，是拿 A 池校验 B 池——永远红，且掩盖真回归。
  assert.strictEqual(page.data.form.quote, daily.posterQuote().text, '金句种子应来自海报文案库今日推荐');
  assert.strictEqual(page.data.themes.length, 6);
  assert.ok(page.data.posterCost > 0, '海报单价应从 POINTS.cost 读取');
  assert.strictEqual(page.data.quotePoolSize, daily.posterPoolSize(), '库存展示应等于海报文案库容量');
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
    assert.strictEqual(page.data.form.quote, daily.posterQuote(k).t, '第 ' + k + ' 套应等于海报文案库 offset=' + k);
  }
});

t('collectData：带日期标签、二维码；背景图按所选注入（合规后无头像）', () => {
  const page = makePage();
  // ⚠️ 2026-10-25：背景图已统一由 card_style_mixin 管理（localBg / bgSource / bgPhotoId），
  //   页面私有的 data.bgImg 槽位已废弃——继续写 bgImg 会静默失效（海报永远没背景）。
  page.data.localBg = 'local://b.jpg';
  page.data.bgSource = 'album';
  const d = page.collectData();
  assert.ok(d.dateLabel.indexOf('月') >= 0 && d.dateLabel.indexOf('星期') >= 0, '应有今天日期标签');
  assert.ok(d.qr, '应带小程序码路径');
  assert.strictEqual(d.bgImg, 'local://b.jpg');
  // 合规整改（社交-笔记）后已移除署名头像：collectData 不应再产出 avatar/nickname/author
  assert.strictEqual(d.avatar, undefined, '不应再有 avatar');
  assert.strictEqual(d.nickname, undefined, '不应再有 nickname');
  assert.strictEqual(d.author, undefined, '不应再有 author');
  assert.ok(d.quote, '金句不应为空');
});

// 2026-10-25 新增：海报页接入出图设置（与其余五页共用 card_style_mixin）。
// 锁三件事：① 默认就带出图参数（不是只有相册选图）② 内置图库能注入 bgImg + bgVeil
// ③ 相册图不叠衬底（用户自己的图不该被替他改）。
t('出图设置：默认即带排版风格与内置背景（不再是「只有选择手机图片」）', () => {
  const page = makePage();
  assert.ok(page.data.styleList.length >= 9, '应有 ≥9 种排版风格');
  assert.ok(page.data.styleGroups.length >= 2, '风格应按「卡片版式 / 成图版式」分组');
  assert.ok(page.data.builtinPhotos.length >= 60, '应有 ≥60 张内置压缩背景图');
  assert.strictEqual(page.data.bgSource, 'builtin', '默认背景来源应为内置图库（零网络零白名单）');
  assert.ok(page.data.bgPhotoId, '默认应选中一张内置背景');
  // 主题 chip 已并入「出图设置」，但数据源必须还在（渲染引擎按 theme 取配色）
  assert.strictEqual(page.data.themes.length, 6, '仍应保留 6 套主题数据源');
});

t('出图设置：内置背景注入 bgImg + bgVeil，相册图不叠衬底', () => {
  const page = makePage();
  const d1 = page.collectData();
  assert.ok(d1.bgImg, '内置图库应注入 bgImg（否则海报永远无背景）');
  assert.ok(Array.isArray(d1.bgVeil) && d1.bgVeil.length === 2, '内置图应带衬底强度 bgVeil');
  assert.ok(d1.styleKey, '应带排版风格 styleKey');

  page.setData({ localBg: 'wxfile://tmp/a.jpg', bgSource: 'album' });
  const d2 = page.collectData();
  assert.strictEqual(d2.bgImg, 'wxfile://tmp/a.jpg', '相册图应优先生效');
  assert.strictEqual(d2.bgVeil, undefined, '相册图是用户自己的图，不该叠衬底');
  assert.ok(d2.bgFallback, '相册图应挂内置兜底，防临时路径失效后变纯色');
});

t('collectData：全空表单自动回填今日金句（首用永远有产出）', () => {
  const page = makePage();
  page.data.form = { title: '', quote: '', body: '', author: '', nickname: '' };
  const d = page.collectData();
  assert.strictEqual(d.quote, daily.posterQuote().text, '空内容应回填海报文案库今日推荐');
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
