// test/test_ui_fluid.js
// 流体交互落地回归（2026-10-01 设计规范 + 交互选型配套）：
//   ① 首页工具卡长按拖拽排序（B 档 #6）：顺序持久化恢复 / 落位重排 / 动态 catchtouchmove 铁律
//   ② 保存按钮翻转反馈（A 档 #27）：三页 flipSaved + 双 keyframes 奇偶交替 + 内联替代 toast
//   ③ 设计令牌：app.wxss page{} 变量 + 页面 wxss var() 消费 + 规范文档存在
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
function live(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

// ── mock Page / wx（storage 内存版）──
let pageCfg = null;
const origPage = global.Page;
global.Page = (cfg) => { pageCfg = cfg; };
const store = {};
const origWx = global.wx;
global.wx = Object.assign({}, global.wx, {
  getStorageSync: (k) => store[k],
  setStorageSync: (k, v) => { store[k] = v; },
  setNavigationBarTitle: () => {},
  vibrateShort: () => {},
  showShareMenu: () => {}
});
require('../pages/index/index.js');
global.Page = origPage;

function makePage() {
  const page = Object.create(pageCfg);
  page.data = JSON.parse(JSON.stringify(pageCfg.data));
  page.setData = function (obj) { Object.assign(this.data, obj); };
  return page;
}

// ── ① 拖拽排序：顺序持久化 ──
t('工具卡默认 3 张、key 稳定（gen/card/poster）', () => {
  const page = makePage();
  assert.strictEqual(page.data.tools.length, 3);
  assert.deepStrictEqual(page.data.tools.map(t => t.key), ['gen', 'card', 'poster']);
  assert.strictEqual(page.data.dragIdx, -1, '初始非拖拽态');
});

t('onLoad 恢复自定义顺序：未知 key 过滤、缺失补尾', () => {
  store['dudu_tool_order_v1'] = ['poster', 'bogus', 'gen'];
  const page = makePage();
  page.onLoad();
  assert.deepStrictEqual(page.data.tools.map(t => t.key), ['poster', 'gen', 'card'],
    'poster 提前、bogus 被过滤、缺失的 card 按默认补尾');
  delete store['dudu_tool_order_v1'];
});

t('onToolDragEnd：落位重排并持久化 key 顺序', () => {
  const page = makePage();
  page.onLoad(); // 默认顺序
  page.data.dragIdx = 0;
  page._dragTarget = 2; // 第 0 张拖到第 2 位
  page.onToolDragEnd();
  assert.deepStrictEqual(page.data.tools.map(t => t.key), ['card', 'poster', 'gen']);
  assert.deepStrictEqual(store['dudu_tool_order_v1'], ['card', 'poster', 'gen'], '顺序应写入 storage');
  assert.strictEqual(page.data.dragIdx, -1, '结束后退出拖拽态');
  assert.strictEqual(page.data.offsets.length, 0);
});

t('onToolDragEnd：无 _dragTarget（未移动）时原地保持、不崩', () => {
  const page = makePage();
  page.data.dragIdx = 1;
  page.onToolDragEnd();
  assert.deepStrictEqual(page.data.tools.map(t => t.key), ['gen', 'card', 'poster']);
});

t('铁律 1：动态 catchtouchmove 绑定（仅拖拽中拦截滚动）', () => {
  const wxml = live('pages/index/index.wxml');
  assert.ok(/catchtouchmove="\{\{dragIdx > -1 \? 'onToolDragMove' : ''\}\}"/.test(wxml),
    '应为动态绑定 catchtouchmove="{{dragIdx > -1 ? ... : \'\'}}"');
  assert.ok(/catchtouchend="\{\{dragIdx > -1 \? 'onToolDragEnd' : ''\}\}"/.test(wxml));
  assert.ok(/bindlongpress="onToolDragStart"/.test(wxml), '长按进入拖拽');
  assert.ok(/wx:key="key"/.test(wxml), '重排后复用节点必须用稳定 key');
});

t('铁律 2/3：被拖行 dragging 类（transition:none）+ 跟手 inline transform + 让位 inline style', () => {
  const appCss = live('app.wxss');
  assert.ok(/\.tool-card\.dragging\s*{[^}]*transition:\s*none/.test(appCss), 'dragging 类必须 transition:none');
  const wxml = live('pages/index/index.wxml');
  assert.ok(/transform:translateY\(' \+ dragDy \+ 'px\)/.test(wxml), '被拖卡 inline 跟手位移');
  assert.ok(/offsets\[index\]/.test(wxml), '其余卡 inline 让位位移');
  const js = live('pages/index/index.js');
  assert.ok(/boundingClientRect/.test(js), '让位量必须实测 rects（铁律 3）');
});

// ── ② 保存翻转反馈 ──
t('两页保存按钮翻转：flipSaved + 双 keyframes 奇偶交替 + 1.6s 复原', () => {
  const appCss = live('app.wxss');
  assert.ok(/@keyframes saveFlipA/.test(appCss) && /@keyframes saveFlipB/.test(appCss),
    '必须双套等价 keyframes（铁律 5 重放）');
  assert.ok(/\.btn\.save-btn\.saved-a/.test(appCss) && /\.btn\.save-btn\.saved-b/.test(appCss));
  for (const pg of ['pages/card/card', 'pages/poster/poster']) {
    const js = live(pg + '.js');
    assert.ok(/flipSaved\(\)/.test(js), pg + ' 应有 flipSaved');
    assert.ok(/_saveTimer/.test(js), pg + ' timer 必须存 this 防竞态（铁律 6）');
    assert.ok(/1600/.test(js), pg + ' 1.6s 复原');
    const wxml = live(pg + '.wxml');
    assert.ok(/save-btn \{\{savedKey \? 'saved-' \+ savedKey : ''\}\}/.test(wxml), pg + ' 按钮翻转类绑定');
    assert.ok(/✓ 已存相册/.test(wxml), pg + ' 内联成功文案（替代 toast）');
  }
});

t('三页保存成功不再弹成功 toast（内联反馈替代）', () => {
  for (const pg of ['pages/card/card', 'pages/poster/poster']) {
    const js = live(pg + '.js');
    const seg = js.slice(js.indexOf('onSaveImage'), js.indexOf('flipSaved()') + 400);
    assert.ok(!/已存到相册.*success/.test(seg), pg + ' onSaveImage 成功链路不应再有成功 toast');
  }
});

// ── ③ 设计令牌 ──
t('设计令牌：app.wxss page{} 变量 + 页面 var() 消费 + 规范文档存在', () => {
  const appCss = live('app.wxss');
  assert.ok(/--bg-page:\s*#f5f0e8/.test(appCss) && /--primary:\s*#f5793b/.test(appCss));
  assert.ok(/--r-pill:\s*999rpx/.test(appCss) && /--shadow-card/.test(appCss));
  for (const pg of ['pages/index/index.wxss', 'pages/gen/gen.wxss', 'pages/card/card.wxss', 'pages/poster/poster.wxss']) {
    const css = live(pg);
    assert.ok(/var\(--(bg-page|bg-card|ink|primary|border)\)/.test(css), pg + ' 应消费令牌变量');
    assert.ok(!/#(f5f0e8|fffdf8|e0d6c2|e7ddca|f5793b|c0504d|2e7d32|2b2b2b)\b/i.test(css),
      pg + ' 不应残留令牌字面值');
  }
  const doc = fs.readFileSync(path.join(__dirname, '..', 'design', 'design-tokens.md'), 'utf8');
  assert.ok(doc.indexOf('--bg-page') >= 0 && doc.indexOf('组件状态卡') >= 0, '规范文档应含令牌表与组件状态卡');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
