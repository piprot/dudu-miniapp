// test/test_picker_wiring.js —— 分层选择器在真实页面的接线核验
// 2026-10-06
//
// 为什么单独写这个：pgGroups/pgHot/pgItems 这些字段**不在页面的 data 字面量里**，
// 是运行时由 catPicker_mixin.build() + card_style_mixin.defaults() 注入的。
// 静态 grep「WXML 字段是否在 JS 出现」会误报一堆缺失（它们确实没在 data 里）。
//
// 这个测试真正验证的是三件事：
//   ① 页面真的调了 mixin 并拿到了字段（不是只写了 WXML 没接线）
//   ② WXML 里绑的每个 pg* 字段都在 mixin 产出里存在
//   ③ 旧的一次性平铺结构（.cats/.tags/.grid）确实从页面消失了
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const catPicker = require('../utils/cat_picker_mixin.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + ((e && e.message) || e)); failed++; }
}

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// mixin 实际会产出的字段（唯一真相源就是它自己，不是手抄一遍）
const MIXIN_FIELDS = Object.keys(catPicker.build({
  groups: [{ key: 'a', name: 'A', items: [{ key: 'x', name: 'X' }] }],
  hotKeys: ['a:x']
}).data);
const MIXIN_METHODS = Object.keys(catPicker.build({ groups: [] }).methods);

t('mixin 产出字段/方法清单（后续断言都以此为准，避免手抄漂移）', () => {
  assert.ok(MIXIN_FIELDS.includes('pgGroups'), '应有 pgGroups');
  assert.ok(MIXIN_FIELDS.includes('pgHot'), '应有 pgHot');
  assert.ok(MIXIN_FIELDS.includes('pgItems'), '应有 pgItems');
  ['onPickGroup', 'onPickGroupItem', 'onPickHot', 'syncPicker'].forEach(m => {
    assert.ok(MIXIN_METHODS.includes(m), '应导出方法 ' + m);
  });
});

const PAGES = [
  { wxml: 'pages/quotes/quotes.wxml', js: 'pages/quotes/quotes.js', name: '金句' },
  { wxml: 'pages/weather/weather.wxml', js: 'pages/weather/weather.js', name: '天气' }
];

PAGES.forEach(p => {
  t(p.name + '页：JS 确实引入并调用了 cat_picker_mixin', () => {
    const js = read(p.js);
    assert.ok(/require\(['"][^'"]*cat_picker_mixin/.test(js), '未 require cat_picker_mixin');
    assert.ok(/initPicker/.test(js), '未定义 initPicker');
    assert.ok(/_pickerOnChange\s*=/.test(js), '未设置 _pickerOnChange 回调（选了也没人接）');
  });

  t(p.name + '页：mixin 方法已注入 Page 配置', () => {
    const js = read(p.js);
    assert.ok(/catPicker\.build\(\{\s*groups:\s*\[\]\s*\}\)\.methods/.test(js),
      '未把 catPicker methods 并入 __pageCfg（WXML 会报事件未绑定）');
  });

  t(p.name + '页：WXML 绑定的每个 pg* 字段都由 mixin 产出', () => {
    const wxml = read(p.wxml);
    const used = new Set();
    const re1 = /\{\{\s*(pg[A-Za-z]*)/g; let m;
    while ((m = re1.exec(wxml))) used.add(m[1]);
    const re2 = /data-(?:group|item)="\{\{\s*(pg[A-Za-z]*)/g;
    while ((m = re2.exec(wxml))) used.add(m[1]);
    assert.ok(used.size > 0, '未发现任何 pg* 绑定，WXML 可能没接上分层选择器');
    const unknown = [...used].filter(f => !MIXIN_FIELDS.includes(f));
    assert.deepStrictEqual(unknown, [], 'WXML 绑了 mixin 不产出的字段：' + unknown.join(', '));
  });

  t(p.name + '页：WXML 绑定的每个选择器事件都由 mixin 提供', () => {
    const wxml = read(p.wxml);
    const handlers = new Set();
    const re = /(?:bindtap|catchtap|bindchange)="([a-zA-Z_]\w*)"/g; let m;
    while ((m = re.exec(wxml))) handlers.add(m[1]);
    const pickerHandlers = [...handlers].filter(h => /^(onPickGroup|onPickGroupItem|onPickHot)$/.test(h));
    assert.ok(pickerHandlers.length > 0, 'WXML 未绑定任何分层选择器事件');
    const missing = pickerHandlers.filter(h => !MIXIN_METHODS.includes(h));
    assert.deepStrictEqual(missing, [], 'WXML 绑了 mixin 没有的事件：' + missing.join(', '));
  });

  t(p.name + '页：旧的一次性平铺结构已移除', () => {
    const wxml = read(p.wxml);
    assert.ok(!/class="cats"/.test(wxml), '旧 .cats 平铺大类仍在（应改分层）');
    assert.ok(!/wx:for="\{\{tags\}\}"/.test(wxml), '旧标签云仍在（应改分层）');
    assert.ok(!/wx:for="\{\{weatherList\}\}"/.test(wxml), '旧天气网格仍在（应改分层）');
    assert.ok(!/wx:for="\{\{moodList\}\}"/.test(wxml), '旧心情网格仍在（应改分层）');
    // 新结构必须在
    assert.ok(/class="picker"/.test(wxml), '缺少 .picker 分层容器');
    assert.ok(/pgHot/.test(wxml), '缺少常用区');
    assert.ok(/pgGroups/.test(wxml), '缺少大类区');
    assert.ok(/pgItems/.test(wxml), '缺少小类区');
  });
});

t('金句页：常用分类必须是真实存在的类目（不能写死凑数）', () => {
  const js = read('pages/quotes/quotes.js');
  const m = js.match(/const HOT_CATS\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, '未定义 HOT_CATS');
  const keys = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.ok(keys.length > 0, '常用分类为空');
  assert.ok(keys.length <= 4, '常用分类超过 4 个会失去「快捷」意义');
  const { CATEGORY_NAMES } = require('../utils/content_quotes.js');
  keys.forEach(k => assert.ok(CATEGORY_NAMES[k], '常用分类 ' + k + ' 不在 CATEGORY_NAMES 里（点了没反应）'));
});

t('天气页：常用项必须落在真实 WEATHER/MOODS 里', () => {
  const js = read('pages/weather/weather.js');
  const m = js.match(/const HOT_PICKS\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, '未定义 HOT_PICKS');
  const keys = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.ok(keys.length > 0, '常用项为空');
  // 从页面源里抠出 WEATHER / MOODS 的 key 做校验（避免为测试改产品代码结构）
  const wKeys = (js.match(/const WEATHER = \[([\s\S]*?)\];/) || ['', ''])[1]
    .split('\n').map(l => (l.match(/key:\s*'([^']+)'/) || [])[1]).filter(Boolean);
  const mKeys = (js.match(/const MOODS = \[([\s\S]*?)\];/) || ['', ''])[1]
    .split('\n').map(l => (l.match(/key:\s*'([^']+)'/) || [])[1]).filter(Boolean);
  keys.forEach(k => {
    const [g, i] = k.split(':');
    const pool = g === 'w' ? wKeys : (g === 'm' ? mKeys : null);
    assert.ok(pool, '未知大类前缀：' + k);
    assert.ok(pool.includes(i), '常用项 ' + k + ' 不在对应列表里（点了没反应）');
  });
});

// ── 二维码：曾整层不显示，必须锁死不许复活 ──
// 2026-10-06 真实 bug：quote_card_render 里 data.qr 设了路径，但加载队列只push 了
// cover 与 bgImg，导致 qrcode 节点的 asset 恒为 undefined → 金句/天气/节气/台词
// 四个页面的二维码全都不显示（引擎只能画一个「码」字灰占位）。
t('二维码守卫：共享渲染器必须真的加载 qr 的 asset（否则四页二维码全不显示）', () => {
  const src = read('utils/quote_card_render.js');
  // 设了路径就必须进加载队列——只看「设了路径」是不够的，那正是当初的 bug
  assert.ok(/data\.qr\s*=/.test(src), '未给 data.qr 赋路径');
  assert.ok(/if\s*\(data\.qr\)\s*jobs\.push/.test(src),
    'data.qr 未进入 jobs 加载队列 → 二维码 asset 恒为空，金句/天气/节气/台词四页二维码都不显示');
  // 找到 qrcode 节点并注入 asset
  assert.ok(/x\.type\s*===\s*'qrcode'/.test(src), '未按 type==\'qrcode\' 定位节点');
  assert.ok(/\bq\.asset\s*=\s*im/.test(src), '未把加载到的图片赋给 qrcode 节点');
});

t('卡面文案守卫：不得出现「长按识别」类引导文案', () => {
  // 二维码自己会说话，卡面写引导语在分享场景像广告。
  // 判据：剥掉注释后（注释里可以解释「为什么删了它」），代码里不得再有该文案。
  ['utils/templates/index.js', 'utils/templates/poster.js'].forEach(f => {
    const raw = read(f);
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')      // 块注释
      .replace(/^\s*\/\/.*$/gm, '');            // 行注释
    assert.ok(!/长按识别/.test(stripped),
      f + ' 剥注释后仍有「长按识别」文案（会真的印在卡面上）');
    // 确认不是靠注释混淆过去的：说明里应保留解释
    assert.ok(!/长按识别小程序码/.test(stripped), f + ' 文案仍在');
  });
});

t('蒙版守卫：内置图蒙版不得超过 0.5（用户反馈「背景太深，看着太郁闷」）', () => {
  const src = read('utils/card_style_mixin.js');
  const m = src.match(/const BUILTIN_VEIL\s*=\s*\{([^}]+)\}/);
  assert.ok(m, '未找到 BUILTIN_VEIL');
  const nums = (m[1].match(/[\d.]+/g) || []).map(Number);
  assert.ok(nums.length >= 6, '三档 × 两段强度，应有 6 个数值，实际 ' + nums.length);
  nums.forEach(n => {
    assert.ok(n <= 0.5, '蒙版强度 ' + n + ' 超过 0.5，会让整张卡发闷（可读性已由文字投影兜住）');
  });
  // 三档必须有明显区分，否则「深/中/淡衬底」是虚标
  const maxes = [Math.max(nums[0], nums[1]), Math.max(nums[2], nums[3]), Math.max(nums[4], nums[5])];
  assert.ok(maxes[0] > maxes[1] && maxes[1] > maxes[2], '三档强度必须严格递减，实际：' + maxes.join(' > '));
});

t('天气卡守卫：城市天气必须是 kicker 小字、金句必须是 hero 主体', () => {
  const js = read('pages/weather/weather.js');
  // 旧版把「城市·天气·心情」塞进 title（20px 粗体标题槽），比金句还抢眼
  assert.ok(/kicker:\s*title/.test(js), '未把城市天气降级为 kicker 小字');
  assert.ok(/hero:\s*true/.test(js), '未把金句升格为 hero 主体');
  assert.ok(!/\{ title, body \}/.test(js), '仍在用 title 承载城市天气（会喧宾夺主）');

  const tpl = read('utils/templates/index.js');
  assert.ok(/d\.kicker/.test(tpl), '模板未支持 kicker 小字槽');
  assert.ok(/kFs\s*=\s*12/.test(tpl), 'kicker 字号应为 12px 小字');
  assert.ok(/d\.hero/.test(tpl), '模板未支持 hero 主体');
});

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
if (failed) process.exit(1);