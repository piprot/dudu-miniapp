// test/test_add_mine.js —— 「添加到我的小程序」组件与收藏判定守卫
// 2026-10-06
//
// 为什么需要这个测试（背景事实，别再重新调研一遍）：
//   微信小程序**没有**主动添加「我的小程序」的 API。
//   · `wx.addToFavorites` 属于**小游戏**（要求 type:'miniProgram' + webViewUrl），
//     小程序侧不存在。社区大量文章误传为小程序 API。
//   · 小程序侧只有 `Page.onAddToFavorites` —— 被动钩子，用户自己点右上角胶囊
//     → 收藏时才触发，开发者无法调起。
//   · 官方社区原话：「目前没有相关 api，你只能添加一个引导框指向右上角提示」。
//   · 仅安卓 7.0.15+ 有收藏入口，iOS 没有。
//
// 所以本测试锁的是**三件容易悄悄坏掉的事**：
//   ① 不许有人写进 `wx.addToFavorites` 这类不存在的 API（会静默失败，用户点了没反应）
//   ② 收藏判定必须走 scene（真的进过收藏/我的小程序入口），不能凭空自己置 true
//   ③ 组件不能改父级传进来的 property（`show`），否则浮层状态会互相打架
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + ((e && e.message) || e)); failed++; }
}

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const COMP = 'components/add-mine/index.js';
const COMP_WXML = 'components/add-mine/index.wxml';
const FAV = 'utils/fav.js';
const PAGE = 'pages/index/index.js';

// ── ① 结构完整性 ────────────────────────────────────────────────
t('组件四个文件齐备（js/json/wxml/wxss）', () => {
  [COMP, 'components/add-mine/index.json', COMP_WXML, 'components/add-mine/index.wxss'].forEach(f => {
    assert.ok(fs.existsSync(path.join(ROOT, f)), '缺文件：' + f);
  });
  assert.ok(/"component"\s*:\s*true/.test(read('components/add-mine/index.json')),
    'index.json 未声明 component:true');
});

t('页面已注册组件映射（usingComponents）', () => {
  assert.ok(/add-mine/.test(read('pages/index/index.json')), 'index.json 未映射 add-mine');
  assert.ok(/<add-mine/.test(read('pages/index/index.wxml')), 'index.wxml 未使用 <add-mine>');
});

// ── ② 绝不调不存在的 API ────────────────────────────────────────
// 这是本测试最硬的一条：写进去不报错，但运行时静默失败，用户点了没反应，
// 而且没有任何日志提示，极难排查。
t('守卫：不得调用 wx.addToFavorites（小程序侧不存在该 API，静默失败）', () => {
  [COMP, FAV, PAGE, COMP_WXML].forEach(f => {
    const code = strip(read(f));
    // 允许出现在注释里（已被 strip 剥掉）；代码里出现就是 bug
    assert.ok(!/wx\.addToFavorites/.test(code),
      f + ' 调了 wx.addToFavorites —— 小程序侧无此 API（那是小游戏 API），运行时会静默失败');
  });
});

t('守卫：不得用 getFavorites 之类的臆造 API 查收藏态', () => {
  [COMP, FAV, PAGE].forEach(f => {
    const code = strip(read(f));
    ['getFavorites', 'addFavorite', 'checkFavorite', 'isFavorite'].forEach(bad => {
      assert.ok(!new RegExp('wx\\.' + bad).test(code), f + ' 调了不存在的 wx.' + bad);
    });
  });
});

// ── ③ 收藏判定走 scene，不许自己置 true ──────────────────────────
t('fav 模块：收藏场景值清单包含全部 6 个真实入口', () => {
  const fav = require('../utils/fav.js');
  // 1010 收藏夹；1103/1104 我的小程序（2.29.1+）；1257 PC 面板；1001/1089 旧「最近使用」
  [1010, 1103, 1104, 1257, 1001, 1089].forEach(s => {
    assert.ok(fav.isFavScene(s), 'scene ' + s + ' 未被识别为收藏入口');
  });
  // 非收藏入口必须判 false，否则会把普通打开误标成「已收藏」
  [1000, 1001 + 0, 1007, 1044, 1050, 1067, 1069, 0, null, undefined, '', 'abc'].forEach(s => {
    if (s === 1001) return; // 1001 确实是收藏相关
    assert.ok(!fav.isFavScene(s), 'scene ' + s + ' 被误判为收藏入口');
  });
});

t('fav 模块：场景值来自 getLaunchOptionsSync（冷启动才拿得到）', () => {
  const src = read(FAV);
  assert.ok(/getLaunchOptionsSync/.test(src), '未读 getLaunchOptionsSync');
  assert.ok(/syncFromLaunch/.test(src), '未导出 syncFromLaunch');
});

t('fav 模块：getLaunchOptionsSync 抛错时按未收藏走，不炸页面', () => {
  const fav = require('../utils/fav.js');
  const g = global.wx;
  global.wx = {
    getLaunchOptionsSync() { throw new Error('boom'); },
    getStorageSync() { return true; }
  };
  try {
    // 抛错分支：markAdded 不会因这次异常被误调；返回值为已有标记
    const r = fav.syncFromLaunch();
    assert.strictEqual(r, true, '已有标记时应返回 true（getStorage 兜底）');
    // 关键：抛错不得把「未收藏」误判成「已收藏」
    global.wx = { getLaunchOptionsSync() { throw new Error('boom'); }, getStorageSync() { return ''; } };
    assert.strictEqual(fav.syncFromLaunch(), false, '无标记且读 scene 失败时应为 false');
  } finally {
    global.wx = g;
  }
});

t('页面：onLoad 里同步收藏标记，onAddToFavorites 里落标记', () => {
  const js = read(PAGE);
  assert.ok(/fav\.syncFromLaunch\(\)/.test(js), 'onLoad 未调用 fav.syncFromLaunch()');
  // onAddToFavorites 触发 == 用户点了收藏，此时就该把状态更新，不必等下次冷启动
  const m = js.match(/onAddToFavorites\s*\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(m, '未找到 onAddToFavorites');
  assert.ok(/fav\.markAdded\(\)/.test(m[1]), 'onAddToFavorites 里未落收藏标记');
  assert.ok(/selectComponent/.test(m[1]), '未通知组件把按钮转成「已添加 ✓」');
  assert.ok(/title\s*:/.test(m[1]), '未 return 自定义收藏卡片标题');
});

t('页面：浮层显隐由组件内部管，页面不 setData panelOpen', () => {
  const js = read(PAGE);
  assert.ok(!/setData\(\{\s*addMineShow\s*:\s*true/.test(js), '页面不应打开浮层（那是组件内部状态）');
  assert.ok(!/panelOpen/.test(js), '页面不该碰组件内部状态 panelOpen');
});

// ── ④ 组件状态纪律 ─────────────────────────────────────────────
t('组件：不得 setData 父级传入的 property（show）', () => {
  const src = read(COMP);
  const code = strip(src);
  assert.ok(/panelOpen/.test(code), '浮层开合应走内部状态 panelOpen');
  // ⚠️ 判据必须匹配 setData 对象里**任意位置**的 show 键，不能只匹配第一个键。
  //   写成 /setData\(\{\s*show/ 时，`setData({ panelOpen: true, show: true })` 会漏过去
  //   （2026-10-06 负向验证实测漏过，属假绿）。
  const bad = code.match(/setData\(\{[^}]*\bshow\s*:/g);
  assert.ok(!bad,
    '组件 setData 了 properties.show —— 组件改父级 prop 会让状态来源互相打架：' + (bad || []).join(' | '));
});

t('组件：WXML 绑的每个事件都必须在 methods 里存在', () => {
  const wxml = read(COMP_WXML);
  const src = read(COMP);
  const handlers = new Set();
  const re = /(?:bindtap|catchtap|bindchange|catchtouchmove)="([a-zA-Z_]\w*)"/g;
  let m;
  while ((m = re.exec(wxml))) handlers.add(m[1]);
  assert.ok(handlers.size >= 3, 'WXML 事件过少，测试本身可能失效');
  const missing = [...handlers].filter(h => !new RegExp('\\b' + h + '\\s*\\(').test(src));
  assert.deepStrictEqual(missing, [], 'WXML 绑了组件没有的事件：' + missing.join(', '));
});

t('组件：浮层遮罩与面板的 catchtap 组合正确（点面板不该被遮罩关掉）', () => {
  const wxml = read(COMP_WXML);
  assert.ok(/class="am-mask"[^>]*bindtap="onMaskTap"/.test(wxml), '遮罩未绑 onMaskTap');
  assert.ok(/class="am-panel"[^>]*catchtap="noop"/.test(wxml),
    '面板缺 catchtap="noop"，点面板内容会连带触发遮罩的关闭');
});

// ── ⑤ 文案与引导内容 ───────────────────────────────────────────
t('组件：文案讲「怎么做」而不是承诺做不到的「一键添加」', () => {
  const js = read(COMP);
  const wxml = read(COMP_WXML);
  // iOS 根本没有收藏入口，文案里必须提到收藏入口在「右上角」这个位置，
  // 否则用户在 iOS 上照着做会找不到
  assert.ok(/右上角/.test(wxml), 'WXML 未提示右上角胶囊位置');
  assert.ok(/收藏/.test(wxml), 'WXML 未说明要选「收藏」');
  assert.ok(/我的小程序/.test(js) || /我的小程序/.test(wxml), '未提及「我的小程序」');
  // 按钮文案承诺的是结果（添加到我的小程序），不是手段（一键）
  const lbl = (js.match(/label:\s*\{[^}]*value:\s*'([^']*)'/) || [])[1] || '';
  assert.ok(lbl.indexOf('添加到我的小程序') >= 0, '按钮文案应为「添加到我的小程序」，实际：' + lbl);
  assert.ok(!/一键添加|立即添加/.test(lbl), '按钮文案不得承诺「一键」（微信做不到）');
});

t('组件：箭头位置由 getMenuButtonBoundingClientRect 实测，不写死', () => {
  const src = read(COMP);
  assert.ok(/getMenuButtonBoundingClientRect/.test(src), '未实测胶囊位置');
  assert.ok(/measureCapsule/.test(src), '未定义 measureCapsule');
  // CSS 必须有兜底值：拿不到测量值时不能没有位置
  const wxss = read('components/add-mine/index.wxss');
  assert.ok(/\.am-arrow\s*\{[\s\S]*?top:/.test(wxss), '.am-arrow 缺 top 兜底值');
  assert.ok(/\.am-arrow\s*\{[\s\S]*?right:/.test(wxss), '.am-arrow 缺 right 兜底值');
});

t('组件：存储不可用（隐私模式）不得让页面崩', () => {
  const src = read(COMP);
  // isAdded / markAdded 都在 fav 里带 try-catch，组件只调封装函数
  assert.ok(/fav\.isAdded\(\)/.test(src), '组件应调 fav.isAdded()（内含 try-catch），而不是自己裸调 wx.getStorageSync');
  assert.ok(!/wx\.getStorageSync/.test(strip(src)), '组件仍在裸调 wx.getStorageSync（无防护）');
});

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
if (failed) process.exit(1);
