// test/test_content_library.js
// 静态内容库 + 每日轮换引擎单测（2026-10-06 新增）
//
// 覆盖三件事：
//   ① 轮换确定性：同一天同 salt 恒定、跨天必变、不同 salt 错开（运营「天天换」的核心契约）
//   ② 库储备量：天气矩阵 64 组合、日常库 ≥120、种子金句 ≥48（够撑一年不重样）
//   ③ 文案纯净度：无空串、无英文残留、无乱码字符、长度合理（卡片是中文产品）
//
// 另含一个「页面接线守卫」：确保 weather.js 的 WEATHER/MOODS key 与
//   content_weather.js 矩阵的 key 完全对齐（错一个字符就静默退兜底句，属线上事故）。
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const rot = require('../utils/daily_rotate');
const cw = require('../utils/content_weather');
const cd = require('../utils/content_daily');
const cq = require('../utils/content_quotes');
const solar = require('../utils/solar_terms');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

// 构造本地日期（避开 UTC 偏移导致的跨日问题）
function d(y, m, day) { return new Date(y, m - 1, day, 10, 0, 0); }

// ── 控件接线守卫的公共读取（2026-10-06 card-config 组件化后新增）────────────
//
//背景图/风格/主题这三块控件已从四页 WXML 抽到 components/card-config/。
// 于是「某页是否接上了背景图库」不能再用`wxml.indexOf('bindtap="onPickBuiltinBg"')`
// 判定——控件不在页面文件里，判据会假红（这正是本轮踩的坑）。
//
// 正确判据是**事件链路是否通到页面 handler**，两种合法形态都要认：
//   A. 页面直绑：页面 WXML 里 bindtap="onPickBuiltinBg"
//   B. 组件上抛：页面 WXML 里 bind:builtin="onPickBuiltinBg"，且card-config
//      组件 WXML 里确实有 bindtap="onPickBuiltinBg" 的控件
// 只认 A 会假红，只认 B 会在组件化回退时假绿。
function cardConfigWxml() {
  const f = path.join(__dirname, '..', 'components', 'card-config', 'index.wxml');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

// 该 handler 是否真的能收到事件（A 或 B 任一形态成立）
function hasWired(wxml, handler) {
  // A. 页面直绑
  if (wxml.indexOf('bindtap="' + handler + '"') >= 0) return true;
  // B. 组件上抛：页面里 bind:<任意事件名>="handler"
  if (new RegExp('bind:[a-z]+="' + handler + '"').test(wxml)) return true;
  return false;
}

// 页面引用的组件是否真的注册并渲染（防「删了 card-config 但WXML 还在引用」）
function usesCardConfig(wxml) {
  return /<card-config\b/.test(wxml);
}

const WEATHER_KEYS = ['sunny', 'cloudy', 'rain', 'snow', 'wind', 'fog', 'thunder', 'night'];
const MOOD_KEYS = ['happy', 'calm', 'tired', 'sad', 'excited', 'anxious', 'grateful', 'lonely'];

// ─────────────────── ① 轮换引擎 ───────────────────

t('dayIndex：同一天恒定、跨天 +1、跨年归零', () => {
  assert.strictEqual(rot.dayIndex(d(2026, 10, 6)), rot.dayIndex(d(2026, 10, 6)));
  assert.strictEqual(rot.dayIndex(d(2026, 10, 7)) - rot.dayIndex(d(2026, 10, 6)), 1);
  assert.strictEqual(rot.dayIndex(d(2026, 1, 1)), 0);
  // 跨闰日 2026-02-28 → 03-01 仍为 +1
  assert.strictEqual(rot.dayIndex(d(2026, 3, 1)) - rot.dayIndex(d(2026, 2, 28)), 1);
});

t('seedOf：同日期同 salt 恒定（幂等，不随机跳）', () => {
  const a = rot.seedOf(d(2026, 10, 6), 'weather:sunny|happy');
  const b = rot.seedOf(d(2026, 10, 6), 'weather:sunny|happy');
  assert.strictEqual(a, b);
});

t('seedOf：跨天必变（这是「天天换」的根本保证）', () => {
  const seen = new Set();
  for (let i = 1; i <= 30; i++) seen.add(rot.seedOf(d(2026, 10, i), 'x'));
  assert.strictEqual(seen.size, 30, '30 天应产生 30 个不同种子，实际 ' + seen.size);
});

t('pickDaily：同一天两次取值完全一致', () => {
  const a = rot.pickDaily(cd.DAILY_LINES, d(2026, 10, 6), 's');
  const b = rot.pickDaily(cd.DAILY_LINES, d(2026, 10, 6), 's');
  assert.strictEqual(a, b);
});

t('pickDaily：不同 salt 错开（避免多模块同时蹦同一句）', () => {
  const a = rot.pickDaily(cd.DAILY_LINES, d(2026, 10, 6), 'weather');
  const b = rot.pickDaily(cd.DAILY_LINES, d(2026, 10, 6), 'solar');
  const c = rot.pickDaily(cd.DAILY_LINES, d(2026, 10, 6), 'quotes');
  const uniq = new Set([a, b, c]);
  // 允许偶然相同（3 选 1 概率撞车），但不能三句全同
  assert.ok(uniq.size > 1, '不同 salt 不应全部取到同一句');
});

t('pickDaily：空库返回 null 而不抛错（边界）', () => {
  assert.strictEqual(rot.pickDaily([], d(2026, 10, 6), 's'), null);
  assert.strictEqual(rot.pickDaily(null, d(2026, 10, 6), 's'), null);
  assert.strictEqual(rot.pickIndex(0, d(2026, 10, 6), 's'), -1);
});

t('pickDailyMulti：取 n 条互不重复，且 n 超容量时收敛到容量', () => {
  const r = rot.pickDailyMulti(cd.DAILY_LINES, d(2026, 10, 6), 'b', 5);
  assert.strictEqual(r.length, 5);
  assert.strictEqual(new Set(r).size, 5, '5 条应互不相同');
  const over = rot.pickDailyMulti(cd.DAILY_LINES, d(2026, 10, 6), 'b', 9999);
  assert.strictEqual(over.length, cd.DAILY_LINES.length, 'n 超容量应收敛到库大小');
  assert.strictEqual(new Set(over).size, over.length, '收敛后仍须不重复');
});

t('pickDailyMulti：同一天确定性（重复调用结果一致）', () => {
  const a = rot.pickDailyMulti(cd.DAILY_LINES, d(2026, 10, 6), 'b', 4);
  const b = rot.pickDailyMulti(cd.DAILY_LINES, d(2026, 10, 6), 'b', 4);
  assert.deepStrictEqual(a, b);
});

t('rotate：连点「换一条」能转完整个库（tap 0..len-1 覆盖全库）', () => {
  const list = cd.DAILY_LINES;
  const seen = new Set();
  for (let k = 0; k < list.length; k++) seen.add(rot.rotate(list, k));
  assert.strictEqual(seen.size, list.length, '转 ' + list.length + ' 次应覆盖全库');
});

t('seasonOf / timeSlotOf：四季与时段判定正确', () => {
  assert.strictEqual(rot.seasonOf(d(2026, 4, 1)), '春');
  assert.strictEqual(rot.seasonOf(d(2026, 7, 1)), '夏');
  assert.strictEqual(rot.seasonOf(d(2026, 10, 1)), '秋');
  assert.strictEqual(rot.seasonOf(d(2026, 1, 1)), '冬');
  assert.strictEqual(cd.timeSlotOf(new Date(2026, 9, 6, 8, 0)), '早');
  assert.strictEqual(cd.timeSlotOf(new Date(2026, 9, 6, 13, 0)), '午');
  assert.strictEqual(cd.timeSlotOf(new Date(2026, 9, 6, 19, 0)), '晚');
  assert.strictEqual(cd.timeSlotOf(new Date(2026, 9, 6, 2, 0)), '深夜');
});

// ─────────────────── ② 库储备量 ───────────────────

t('天气矩阵：8×8 = 64 组合齐全，每组合 ≥4 条（共 ≥256 条）', () => {
  const st = cw.stats();
  assert.strictEqual(st.combos, 64, '组合数应 64，实际 ' + st.combos);
  assert.ok(st.total >= 256, '文案总数应 ≥256，实际 ' + st.total);
  WEATHER_KEYS.forEach(w => MOOD_KEYS.forEach(m => {
    const n = cw.variantCount(w, m);
    assert.ok(n >= 4, w + '|' + m + ' 仅 ' + n + ' 条');
  }));
});

t('日常库：通用 ≥60、每季 ≥15、每时段 ≥12（够撑一年不重样）', () => {
  assert.ok(cd.DAILY_LINES.length >= 60, '通用仅 ' + cd.DAILY_LINES.length);
  ['春', '夏', '秋', '冬'].forEach(s => {
    assert.ok(cd.SEASON_LINES[s].length >= 15, s + ' 仅 ' + cd.SEASON_LINES[s].length);
  });
  ['早', '午', '晚', '深夜'].forEach(s => {
    assert.ok(cd.TIME_LINES[s].length >= 12, s + ' 仅 ' + cd.TIME_LINES[s].length);
  });
});

t('种子金句：≥48 条、id 唯一、6 分类齐全', () => {
  assert.ok(cq.SEED_QUOTES.length >= 48, '仅 ' + cq.SEED_QUOTES.length + ' 条');
  const ids = new Set(cq.SEED_QUOTES.map(q => q.id));
  assert.strictEqual(ids.size, cq.SEED_QUOTES.length, 'seed id 必须唯一');
  const cats = new Set(cq.SEED_QUOTES.map(q => q.category));
  assert.strictEqual(cats.size, 6, '分类数应 6，实际 ' + cats.size);
  Object.keys(cq.CATEGORY_NAMES).forEach(k => {
    assert.ok(cats.has(k), '缺少分类 ' + k);
  });
});

t('种子金句：文本唯一（addQuote 按 text 去重，重复会导致 seed 少灌）', () => {
  const texts = new Set(cq.SEED_QUOTES.map(q => q.text));
  assert.strictEqual(texts.size, cq.SEED_QUOTES.length, '存在重复文案');
});

// ⚠️ 库内重复是「换一条换不出新句子」的隐形根因：
//    轮换下标确实变了，但取到的是同一句话，用户会以为按钮坏了。
//    2026-10-06 曾在「夏」季库踩到（同一句出现两次），故加此守卫。
t('无重复：每个池子内部文本唯一（否则「换一条」像坏了）', () => {
  const check = (arr, label) => {
    const seen = new Set();
    arr.forEach(s => {
      assert.ok(!seen.has(s), label + ' 池内重复文案: ' + s);
      seen.add(s);
    });
  };
  check(cd.DAILY_LINES, 'DAILY');
  Object.keys(cd.SEASON_LINES).forEach(k => check(cd.SEASON_LINES[k], 'SEASON.' + k));
  Object.keys(cd.TIME_LINES).forEach(k => check(cd.TIME_LINES[k], 'TIME.' + k));
  // 天气矩阵：同一组合内不得重复（跨组合重复可接受——不同天气不同语境）
  Object.keys(cw.MATRIX).forEach(k => check(cw.MATRIX[k], 'WEATHER.' + k));
});

t('无重复：节气/节日库文本唯一（跨列表整体查）', () => {
  const all = solar.SOLAR_TERMS.concat(solar.FESTIVALS).map(x => x.text);
  assert.strictEqual(new Set(all).size, all.length, '节气/节日存在重复文案');
});

// ─────────────────── ③ 文案纯净度 ───────────────────

function assertClean(s, label, maxLen) {
  assert.ok(typeof s === 'string' && s.trim().length > 0, label + ' 空文案');
  assert.ok(!/[a-zA-Z]/.test(s), label + ' 混入英文字母: ' + s);
  assert.ok(s.indexOf('\ufffd') === -1, label + ' 含乱码字符: ' + s);
  assert.ok(s.length <= maxLen, label + ' 过长(' + s.length + '): ' + s);
}

t('天气矩阵：全部 256 条文案纯净、无空、无英文、无乱码', () => {
  let n = 0;
  Object.keys(cw.MATRIX).forEach(k => {
    cw.MATRIX[k].forEach((s, i) => { assertClean(s, k + '[' + i + ']', 60); n++; });
  });
  assert.strictEqual(n, cw.stats().total);
});

t('日常库：全部文案纯净（通用/四季/四时段）', () => {
  cd.DAILY_LINES.forEach((s, i) => assertClean(s, 'DAILY[' + i + ']', 60));
  Object.keys(cd.SEASON_LINES).forEach(k =>
    cd.SEASON_LINES[k].forEach((s, i) => assertClean(s, k + '[' + i + ']', 60)));
  Object.keys(cd.TIME_LINES).forEach(k =>
    cd.TIME_LINES[k].forEach((s, i) => assertClean(s, k + '[' + i + ']', 60)));
});

t('种子金句：文案纯净且不超 60 字（卡片正文承载上限）', () => {
  cq.SEED_QUOTES.forEach(q => assertClean(q.text, q.id, 60));
});

t('节气/节日库：文案纯净（回归，防新加内容带英文/乱码）', () => {
  solar.SOLAR_TERMS.forEach(x => assertClean(x.text, 'term:' + x.name, 120));
  solar.FESTIVALS.forEach(x => assertClean(x.text, 'fest:' + x.name, 120));
});

// ─────────────────── ④ 接线守卫 ───────────────────

t('接线：weather.js 的 WEATHER/MOODS key 与矩阵 key 完全对齐', () => {
  // 直接读页面源码取 key，避免 require 页面（会调 Page()）
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'weather', 'weather.js'), 'utf8');
  const grab = (arrName) => {
    const m = src.match(new RegExp('const ' + arrName + ' = \\[([\\s\\S]*?)\\n\\];'));
    assert.ok(m, '未在 weather.js 找到 ' + arrName);
    const keys = [];
    m[1].split('\n').forEach(line => {
      const km = line.match(/key:\s*'([^']+)'/);
      if (km) keys.push(km[1]);
    });
    return keys;
  };
  const ws = grab('WEATHER');
  const ms = grab('MOODS');
  assert.deepStrictEqual(ws, WEATHER_KEYS, 'WEATHER key 与库不一致');
  assert.deepStrictEqual(ms, MOOD_KEYS, 'MOODS key 与库不一致');
});

t('接线：矩阵无「孤儿 key」（每个 key 都能被页面选中）', () => {
  Object.keys(cw.MATRIX).forEach(k => {
    const [w, m] = k.split('|');
    assert.ok(WEATHER_KEYS.includes(w), '矩阵含未知天气 key: ' + w);
    assert.ok(MOOD_KEYS.includes(m), '矩阵含未知心情 key: ' + m);
  });
});

t('接线：城市改为省市静态列表，app.json 不再声明位置隐私接口', () => {
  const app = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'app.json'), 'utf8'));
  // 2026-10-06 定案：放弃 wx.getLocation（只回经纬度、需隐私声明、拿不到城市名），
  // 改为省市级联 picker → 合规负担归零。这条断言反向锁住该决定，防止被误加回来。
  const declared = app.requiredPrivateInfos || [];
  assert.ok(!declared.includes('getLocation'),
    'app.json 又声明了 getLocation：城市方案已改为静态列表，应移除该声明');
  assert.ok(!(app.permission && app.permission['scope.userLocation']),
    'app.json 又声明了 scope.userLocation：城市方案已改为静态列表，应移除该权限');
});

t('接线：天气页不再调用 wx.getLocation', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'weather', 'weather.js'), 'utf8');
  // 去掉注释行再断言，避免「为什么不用它」的说明注释造成误判
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(code.indexOf('wx.getLocation') < 0, 'weather.js 仍在调用 wx.getLocation');
});

t('接线：weather 页已接上省市级联 picker 与最近使用', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'weather', 'weather.js'), 'utf8');
  for (const fn of ['onProvinceChange', 'onCityChange', 'onPickRecent', 'onClearCity', 'restoreCity']) {
    assert.ok(src.indexOf(fn + '(') >= 0, 'weather.js 缺方法 ' + fn);
  }
  const wxml = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'weather', 'weather.wxml'), 'utf8');
  assert.ok(wxml.indexOf('bindchange="onProvinceChange"') >= 0, 'wxml 缺省 picker');
  assert.ok(wxml.indexOf('bindchange="onCityChange"') >= 0, 'wxml 缺市 picker');
  assert.ok(wxml.indexOf('bindtap="onPickRecent"') >= 0, 'wxml 缺最近使用区');
});

t('接线：四页均已接上背景图库（选图/切档位/换一张/取消/相册）', () => {
  // 2026-10-06 起这套逻辑抽到 utils/card_style_mixin.js，四页共用；
  // 守卫从「页面里逐个定义方法」升级为「mixin 提供方法 + 四页都注入 + wxml 都有控件」。
  const mixin = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'card_style_mixin.js'), 'utf8');
  for (const fn of ['onPickBuiltinBg', 'onCyclePhotoMode', 'onShufflePhoto',
    'onClearPhoto', 'onPickAlbumBg', 'onPickStyle']) {
    assert.ok(mixin.indexOf(fn + '(') >= 0, 'card_style_mixin 缺方法 ' + fn);
  }
  // applyCardStyle 必须真的算出 bgImg（相册 > 内置图；显式取消则不设该键）
  assert.ok(/bgImg/.test(mixin), 'mixin 未产出 bgImg');
  // 两级来源：内置图库（零网络）+ 手机相册。网络图库已整层移除（见下方专项守卫）。
  assert.ok(/bg_pack/.test(mixin), 'mixin 未接内置图库 bg_pack');
  // bgFallback 现在挂给相册图：临时路径可能被系统回收，挂了才能不白卡
  assert.ok(/bgFallback/.test(mixin), 'mixin 未给相册图挂内置兜底（原图失效会白卡）');
  for (const p of ['weather', 'solar', 'quotes', 'line']) {
    const js = fs.readFileSync(
      path.join(__dirname, '..', 'pages', p, p + '.js'), 'utf8');
    assert.ok(/card_style_mixin/.test(js), p + '.js 未引入 card_style_mixin');
    assert.ok(/cardStyle\.cardStyleMethods/.test(js), p + '.js 未注入风格/背景方法');
    assert.ok(/cardStyle\.applyCardStyle\(/.test(js), p + '.js 渲染前未套用 applyCardStyle');
    assert.ok(/cardStyle\.defaults\(/.test(js), p + '.js data 未套用 card_style 字段');
    const wxml = fs.readFileSync(
      path.join(__dirname, '..', 'pages', p, p + '.wxml'), 'utf8');
    // 2026-10-06：控件抽到 card-config 后，判据从「页面 WXML 里有这个字面串」
    // 升级为「这个 handler 能收到事件」（页面直绑 or 组件上抛都算）。
    // 同时要求页面确实引用了 card-config，否则上面的宽松判定会假绿。
    if (usesCardConfig(wxml)) {
      const cc = cardConfigWxml();
      assert.ok(cc.length > 0, '页面引用了 <card-config> 但组件 WXML 不存在');
      for (const b of ['bindtap="onPickBuiltinBg"', 'bindtap="onCyclePhotoMode"',
        'bindtap="onShufflePhoto"', 'bindtap="onClearPhoto"',
        'bindtap="onPickAlbumBg"', 'bindtap="onPickStyle"',
        'class="bg-scroll"', '{{builtinPhotos}}']) {
        assert.ok(cc.indexOf(b) >= 0, 'card-config/index.wxml 缺 ' + b);
      }
      for (const h of ['onPickBuiltinBg', 'onCyclePhotoMode', 'onShufflePhoto',
        'onClearPhoto', 'onPickAlbumBg', 'onPickStyle']) {
        assert.ok(hasWired(wxml, h), p + '.wxml 未把 ' + h + ' 接到 card-config 上');
      }
    } else {
      for (const b of ['bindtap="onPickBuiltinBg"',
        'bindtap="onCyclePhotoMode"',
        'bindtap="onShufflePhoto"', 'bindtap="onClearPhoto"',
        'bindtap="onPickAlbumBg"', 'bindtap="onPickStyle"', 'class="bg-scroll"',
        '{{builtinPhotos}}']) {
        assert.ok(wxml.indexOf(b) >= 0, p + '.wxml 缺 ' + b);
      }
    }
  }
});

t('守卫：背景图走网络必须有失败降级（不得白卡）', () => {
  // quote_card_render 在 bgImg 加载失败时应删掉 backgroundImage 回退主题渐变
  const r = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'quote_card_render.js'), 'utf8');
  assert.ok(r.indexOf('backgroundImageAsset') >= 0, '渲染器未注入背景 asset');
  assert.ok(/delete model\.backgroundImage/.test(r),
    '背景图加载失败时未删除 backgroundImage，会画出坏图');
});

t('接线：四个新页面共用 quote_card_render（改一次全站生效）', () => {
  const pages = ['weather', 'solar', 'quotes', 'line'];
  for (const p of pages) {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'pages', p, p + '.js'), 'utf8');
    assert.ok(src.indexOf("require('../../utils/quote_card_render')") >= 0,
      p + ' 页未共用 quote_card_render，字体/背景改动不会生效');
    // 都必须能生成分享图（saveCanvas → exportAndSave → 存相册 + 记历史）
    assert.ok(src.indexOf('saveCanvas') >= 0, p + ' 页缺分享图能力（saveCanvas）');
  }
});

t('接线：四页都能让风格真正落到渲染（styleKey 进 applyCardStyle）', () => {
  // 背景/风格控件本身在上面的守卫里已覆盖；这里守「切换风格后卡片真的变了」：
  // mixin.applyCardStyle 必须把 styleKey 写进 renderCard 的 data，
  // 且只接受 font_kit 认得的 key（防止 dataset 注入任意字体串）。
  const mixin = require('../utils/card_style_mixin');
  assert.ok(/hasStyle\(d\.styleKey\)/.test(fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'card_style_mixin.js'), 'utf8')),
    'applyCardStyle 未校验 styleKey 合法性');

  const page = { data: { styleKey: 'poster', localBg: '', bgSource: 'none', bgPhotoId: '' } };
  const out = mixin.applyCardStyle(page, { body: 'x' });
  assert.strictEqual(out.styleKey, 'poster', 'styleKey 未落到卡片数据');
  assert.ok(!('bgImg' in out), '显式取消背景（none）时不应塞 bgImg 键');

  page.data.styleKey = 'evil;font:url(x)';
  assert.ok(!('styleKey' in mixin.applyCardStyle(page, {})), '非法 styleKey 未被拦下');

  // 非法图库 id 绝不能变成任意 URL —— 只能回落内置兜底图（bg_pack 认得的路径）
  const bgPack = require('../utils/bg_pack');
  page.data.bgSource = 'lib';
  page.data.bgPhotoId = 'not-a-real-id';
  const inj = mixin.applyCardStyle(page, {});
  assert.strictEqual(inj.bgImg, bgPack.pathOf(mixin.FALLBACK_ID),
    '非法图库 id 未回落到内置兜底图（防 dataset 注入任意 URL）');
  page.data.bgSource = 'builtin';
  page.data.bgPhotoId = '../../secret.jpg';
  const inj2 = mixin.applyCardStyle(page, {});
  assert.strictEqual(inj2.bgImg, bgPack.pathOf(mixin.FALLBACK_ID),
    '非法内置路径未被拦下（防 dataset 注入任意包内路径）');
});

t('守卫：内置兜底图随包存在、无 webp、且在包体预算内', () => {
  // 三条硬约束，任何一条破了都会让"零网络出图"落空：
  //   ① 文件真实存在（清单与磁盘不能漂移）
  //   ② 一律 JPEG —— 真机 <image> 不支持 webp（R9 红线同源）
  //   ③ 总体积不把主包顶爆（2MB 上限，图片是包体大户）
  const fsx = require('fs');
  const pathx = require('path');
  const bgPack = require('../utils/bg_pack');
  const dir = pathx.join(__dirname, '..', 'images', 'bg');
  const files = fsx.readdirSync(dir);
  assert.strictEqual(files.length, bgPack.BUILTIN.length,
    'images/bg 文件数与 bg_pack 清单不一致（漏图或清单未更新）');
  files.forEach(f => {
    assert.ok(/\.jpe?g$/i.test(f), '内置背景图必须 JPEG，发现: ' + f);
  });
  let total = 0;
  files.forEach(f => { total += fsx.statSync(pathx.join(dir, f)).size; });
  // 预算依据：基础包体 864KB + 内置图上限 1000KB ≈ 1864KB/ 2048KB ≈ 91%，
  // 再多就顶爆主包（超限是上传直接失败）。改动前务必跑
  // `node tools_local/pack_volume.js` 复核真实占用。
  assert.ok(total < 1000 * 1024, '内置背景图总体积 ' + Math.round(total / 1024)
    + 'KB，超出 1000KB 预算（基础包体 864KB，加起来会顶爆主包 2MB）');
});

t('守卫：内置兜底图必须是深色调（这是背景图，上方要压白字）', () => {
  // 用户 2026-10-06 明确指出：「需要深色色调才行，因为是做背景图的」。
  // 压暗前实测42/60 张偏亮（>120），最亮 3 张有 90%+ 像素落在亮区，
  // 白字压上去基本不可读 —— 这类缺陷肉眼可见，必须由测试锁住，不能靠人记。
  //
  // 亮度值（lum）由入库前的色调映射写入 bg_pack清单：
  //   target = 52 + 36 * ((m0 - 50) / 160)，factor = clamp(target/m0, 0.24, 0.85)
  // 换图 / 重新压缩后若本守卫失败，必须重跑色调映射，而不是放宽区间。
  const bgPack = require('../utils/bg_pack');
  const s = bgPack.stats();

  assert.strictEqual(s.lumMissing, 0,
    '有 ' + s.lumMissing + ' 张内置图缺lum 字段（换图后需重新导出亮度并写入清单）');
  assert.strictEqual(s.lumOutliers, 0,
    '内置背景图亮度必须在 ' + bgPack.LUM_MIN + '~' + bgPack.LUM_MAX
    + ' 区间内（过亮→ 白字不可读，过黑 → 失去层次）。越界: '
    + bgPack.BUILTIN.filter(b => b.lum < bgPack.LUM_MIN || b.lum > bgPack.LUM_MAX)
      .map(b => b.id + '=' + b.lum).join(', '));

  // 逐条再断言一次，防止 stats() 实现本身出错时守卫失效（双保险）
  bgPack.BUILTIN.forEach(b => {
    assert.strictEqual(typeof b.lum, 'number', b.id + ' 缺 lum');
    assert.ok(b.lum >= bgPack.LUM_MIN && b.lum <= bgPack.LUM_MAX,
      b.id + ' 亮度 ' + b.lum + ' 越界');
  });

  // 区间收敛还不够：60 张若全挤在同一亮度会看起来像同一张图，
  // 所以要求既有足够跨度（层次），又不能出现极端离群（视觉突兀）。
  assert.ok(s.lumMax - s.lumMin >= 20,
    '亮度跨度仅 ' + (s.lumMax - s.lumMin).toFixed(1)
    + '，60 张会显得像同一张图（色调映射应映射到区间而非固定值）');
  assert.ok(s.lumAvg >= 55 && s.lumAvg <= 88,
    '平均亮度 ' + s.lumAvg + ' 偏离深色区（应在 55~88）');
});

t('接线：风格/背景偏好持久化，但相册临时路径必须不落盘', () => {
  // tempFilePath 会被系统回收，存进 storage 下次启动就是坏图；
  // 这条锁住「只持久化 styleKey / bgPhotoId / photoMode」的取舍。
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'card_style_mixin.js'), 'utf8');
  const writes = src.match(/writeStore\(\{[^}]*\}\)/g) || [];
  assert.ok(writes.length >= 3, '持久化调用过少，风格/图库选择不会保持');
  for (const w of writes) {
    assert.ok(w.indexOf('localBg') < 0, '相册临时路径被持久化了：' + w);
  }
});

t('守卫：设计令牌必须被真正使用（禁止大面积硬编码色值回流）', () => {
  // 2026-10-06 /normalize 审计发现：app.wxss 里19 个令牌定义得好好的，
  // 但 15 个 wxss 里有 152 种硬编码色值、318 次使用 —— 令牌形同虚设，
  // 改主题色要翻 15 个文件。
  // 已做两次收敛：
  //   ① 精确匹配（值与令牌完全相同）→ 53 处，零视觉差异
  //   ② 表面级聚类（58 种浅暖底 ΔE<3.0 → 5 档令牌）→ 45 处，零视觉差异
  // 本守卫防止色值重新失控。
  const fs2 = require('fs');
  const path2 = require('path');
  const root = path2.join(__dirname, '..');

  function walk(dir, acc) {
    for (const e of fs2.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'tools_local' || e.name === '_backup') continue;
      const p = path2.join(dir, e.name);
      if (e.isDirectory()) walk(p, acc);
      else if (e.name.endsWith('.wxss')) acc.push(p);
    }
    return acc;
  }
  const files = walk(root, []).filter(f => path2.basename(f) !== 'app.wxss');

  // 统计「令牌未覆盖的暖系浅底」数量 —— 这是最容易失控的一类
  const appSrc = fs2.readFileSync(path2.join(root, 'app.wxss'), 'utf8');
  const tokens = new Set();
  let m2;
  const tre = /(--[a-z0-9-]+):\s*#[0-9a-fA-F]{3,6}/g;
  while ((m2 = tre.exec(appSrc)) !== null) {
    let hex = m2[0].slice(m2[0].indexOf('#'));
    if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    tokens.add(hex.toLowerCase());
  }
  assert.ok(tokens.size >= 20, '令牌数量异常少（' + tokens.size + '），app.wxss 是否被改坏');

  const loose = {};
  files.forEach(f => {
    const src = fs2.readFileSync(f, 'utf8');
    (src.match(/#[0-9a-fA-F]{6}\b/g) || []).forEach(h => {
      const k = h.toLowerCase();
      if (tokens.has(k)) return;                // 命中令牌定义值，不算
      // 只统计暖系极浅底（明度高+ 低饱和），这是失控重灾区
      const r = parseInt(k.slice(1, 3), 16), g = parseInt(k.slice(3, 5), 16), b = parseInt(k.slice(5, 7), 16);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (L >= 0.86 && sat <= 0.32 && r >= b) {
        const rel = path2.relative(root, f).replace(/\\/g, '/');
        loose[rel] = (loose[rel] || 0) + 1;
      }
    });
  });
  const total = Object.values(loose).reduce((a, c) => a + c, 0);
  // 阈值 20 的依据（非拍脑袋）：两轮收敛后残留 16 处，逐处核对过**全是有语义的一次性设计**，
  // 不得归并——
  //   #ffffff ×9  卡片底/输入框底/深底上的白字（不是「浅暖底」，是纯白）
  //   #f3fff0 #ddf5d8  poster 卡的绿意底（有意的色相区分）
  //   #fdeaea          danger 浅红底（语义色，不是浅暖底）
  //   #fffdf9 #fdf8ef #fbf6ef #e8dcc8  hero/预览/样本卡的单次微调
  // 换言之16 是「有意保留」的基线，不是「没收敛干净」。多于此数说明有人又手调了浅底。
  assert.ok(total <= 20,
    '暖系浅底硬编码回升到 ' + total + ' 处（有意保留的语义色基线是 16，阈值 20）。'
    + '新增浅底必须用 --bg-surface-1~5；确需新档先用'
    + ' `python tools_local/tok_cluster.py` 复核。分布: '
    + JSON.stringify(loose));

  // 令牌使用率：var() 引用应占绝对多数
  const allSrc = files.map(f => fs2.readFileSync(f, 'utf8')).join('\n');
  const varRefs = (allSrc.match(/var\(--[a-z0-9-]+\)/g) || []).length;
  const hardRefs = (allSrc.match(/#[0-9a-fA-F]{6}\b/g) || []).length;
  const ratio = varRefs / (varRefs + hardRefs);
  assert.ok(ratio > 0.6,
    '令牌引用率仅 ' + (ratio * 100).toFixed(0) + '%（var ' + varRefs
    + ' / 硬编码 ' + hardRefs + '），阈值 60%');
});

t('守卫：所有可交互元素与图片都必须有可访问名称（/harden）', () => {
  // 2026-10-06 /harden 审计：118 个可交互元素、11 个 <image>，
  // 其中 aria-label 与 alt **一个都没有** —— 读屏用户完全不知道控件是干什么的。
  //
  // ⚠️ 本守卫的判定刻意**不是**「每个 bindtap 都必须有 aria-label」——
  // 那是错的。实测 118 个里109 个靠可见文字即可播报（`成卡` `＋ 收藏金句`
  // `#{{item.tag}}` `{{item.name}}` 等），硬塞 aria-label 会让读屏**重复播报**
  // （违反 WCAG 2.5.3 Label in Name）。
  // 真正缺口只有两类：① <image> ② 子树里完全没有文字的控件。
  //
  // 判定必须**递归整棵子树**：第一版扫描器只看标签直接文本，
  // 漏掉了 `<view><text>{{item.name}}</text></view>` 这类嵌套结构，
  // 误报 19 处（首页积分条、weather 的 cell、card 的 type 全是假警报）。
  const root = path.join(__dirname, '..');
  function walk(dir, acc) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '_backup') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, acc);
      else if (e.name.endsWith('.wxml')) acc.push(p);
    }
    return acc;
  }
  const files = walk(root, []);

  const EMOJI_ONLY = /^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\s]*$/u;
  const imgTotal = [];
  const noName = [];

  files.forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f).replace(/\\/g, '/');

    // ① <image> 必须带 aria-label 或 aria-hidden（二者必居其一）
    const imgs = src.match(/<image\b[^>]*?(?:\/>|>)/gs) || [];
    imgs.forEach(tag => {
      imgTotal.push(rel);
      if (!/\baria-(label|hidden)\s*=/.test(tag)) {
        noName.push(rel + ' <image> 缺 aria-label/aria-hidden: ' + tag.slice(0, 50));
      }
    });

    // ② 可交互元素：递归子树，确认有可播报文字或已有 aria
    //    边界推进用「找下一个开标签与下一个闭标签，谁在前走谁」，
    //    不用两个 lastIndex 独立推进的写法 —— 那种写法会让 openRe
    //    在 closeRe 走过之后仍从旧位置续搜，子树边界算错，
    //    把 `<view ...>{{item.name}}</view>` 误判成「无文字」
    //    （第一版栽在这：card/gen/reader 共 10+ 处假警报）。
    const openRe = /<([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
    const closeRe = /<\/([a-zA-Z][\w-]*)\s*>/g;
    const tagRe2 = /<(view|text|button|navigator)\b([^>]*)>/g;
    let m3;
    while ((m3 = tagRe2.exec(src)) !== null) {
      const attrs = m3[2];
      if (!/\b(bind|catch)(tap|change|input|confirm|longpress|chooseavatar)\s*=/.test(attrs)) continue;
      if (/\baria-label\s*=/.test(attrs)) continue;
      const line = src.slice(0, m3.index).split('\n').length;

      let depth = 1;
      let pos = m3.index + m3[0].length;
      while (depth > 0 && pos < src.length) {
        openRe.lastIndex = pos;
        closeRe.lastIndex = pos;
        const no = openRe.exec(src);
        const nc = closeRe.exec(src);
        if (!nc) break;
        if (no && no.index < nc.index) {
          pos = no.index + no[0].length;
          if (no[2] !== '/') depth++;
        } else {
          pos = nc.index + nc[0].length;
          depth--;
        }
      }
      // 元素**自身**的直接文本（开标签之后、任何子标签之前）也算可播报内容。
      // 漏这一步会把 `<view ...>{{showHelp ? '收起说明' : '怎么用'}}</view>`
      // 判成无文字 —— 它的文字就在开标签正后方，不在任何 `>...<` 之间。
      const afterOpen = src.slice(m3.index + m3[0].length);
      const lead = (afterOpen.match(/^[^<]+/) || [''])[0].trim();
      const subtree = depth === 0
        ? src.slice(m3.index + m3[0].length, pos - (src.slice(pos).match(/^<\/[\w-]+>/) || [''])[0].length)
        : '';
      const texts = [lead]
        .concat((subtree.match(/>([^<>]+)</g) || []).map(s => s.slice(1, -1).trim()))
        .filter(s => s && !EMOJI_ONLY.test(s));
      if (texts.length === 0) {
        noName.push(rel + ':' + line + ' 可交互元素子树内无任何文字，且无 aria-label');
      }
    }
  });

  assert.strictEqual(noName.length, 0,
    '以下元素缺可访问名称（读屏无法播报）：\n    - ' + noName.join('\n    - '));

  // 扫描器自证有效：imgTotal 的数量必须等于用独立方法（直接数 <image 出现次数）
  // 数出来的数量。两者不等说明上面那个正则漏配了，noName 的结论不可信。
  //
  // ⚠️ 这里**刻意不用硬编码下限**。原写法是 `imgTotal.length >= 11`，
  //  那是 2026-10-06 /harden 当时的基线（8 张网络缩略图 + 1 头像 + 2 分镜）。
  //   网络图库整层删除后真实数量降到 7，硬编码基线立刻变成假警报 ——
  //   而修它的错误方式是"把 11 改成 7"，下次再删图又会假警报一次。
  //   动态交叉验证才是不需要维护的版本。
  let rawCount = 0;
  files.forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    rawCount += (src.match(/<image\b/g) || []).length;
  });
  assert.strictEqual(imgTotal.length, rawCount,
    '扫描器漏配：正则抓到 ' + imgTotal.length + ' 张<image>，'
    + '直接计数为 ' + rawCount + ' 张，正则 <image\\b[^>]*?(?:\\/>|>) 失效');
  assert.ok(rawCount > 0, '全仓 <image> 数量为 0，扫描范围或路径可能错了');
});

t('守卫：网络图库已整层移除，不得复活（首屏与出卡零网络请求）', () => {
  // 2026-10-06 演进史（三轮，值得留着当反面教材）：
  //   ① 原始版：四页无条件渲染 24 张网络缩略图 → 未配白名单时首屏 24 个 doomed 请求
  //   ② /optimize：改默认折叠 + 惰性探测 → 首屏 0 请求，但探测本身仍是网络请求
  //   ③ 最终：整层删除。原因很直接 —— downloadFile 白名单**始终没配**，
  //     那 100 张图一张都没成功显示过，折叠只是把失败推迟，没解决失败。
  //     内置 60 张已覆盖需求，删掉后出卡路径上彻底不存在网络请求。
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'card_style_mixin.js'), 'utf8');
  const d = require('../utils/card_style_mixin').defaults('literary');

  // ① 状态字段必须从 data 里消失（留空数组等于名存实亡）
  for (const k of ['photos', 'netAvailable', 'netLibOpen', 'netProbing']) {
    assert.ok(!(k in d), '网络图库遗留字段仍在 data 里：' + k);
  }
  // ② 模块本体不得存在
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'utils', 'photo_lib.js')),
    'utils/photo_lib.js 应已删除（网络图库整层移除）');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'test', 'test_photo_lib.js')),
    'test/test_photo_lib.js 应已删除');
  assert.ok(!/require\(['"]\.\/photo_lib['"]\)/.test(src), 'mixin 仍 require photo_lib');
  // ③ 四页 WXML 不得残留任何网络图库痕迹
  ['weather', 'solar', 'quotes', 'line'].forEach(pg => {
    const wxml = fs.readFileSync(
      path.join(__dirname, '..', 'pages', pg, pg + '.wxml'), 'utf8');
    for (const k of ['网络图库', 'onPickPhoto', 'onToggleNetLib',
      'netLibOpen', 'netAvailable', 'netProbing', 'downloadFile']) {
      assert.ok(wxml.indexOf(k) < 0, pg + '.wxml 仍残留「' + k + '」');
    }
    // 内置图库必须还在（不能把整块背景功能一起删掉）。
    // 判据同样是「事件链路通」：控件在 card-config 里也算数。
    assert.ok(hasWired(wxml, 'onPickBuiltinBg'), pg + '.wxml 丢了内置图库选择');
    const listSrc = usesCardConfig(wxml) ? cardConfigWxml() : wxml;
    assert.ok(listSrc.indexOf('builtinPhotos') > 0, pg + '.wxml 丢了内置图库清单');
  });
  // ④ 样式表不得留孤儿类
  const appWxss = fs.readFileSync(
    path.join(__dirname, '..', 'app.wxss'), 'utf8');
  for (const k of ['.net-toggle', '.net-hint']) {
    assert.ok(appWxss.indexOf(k) < 0, 'app.wxss 残留孤儿样式 ' + k);
  }
  // ⑤ 全仓不得再有 picsum 的**运行时网络依赖**。
  //    判据是「picsum 域名」而不是字符串 picsum，因为：
  //      · bg_pack.js 的文件头注释里有图源出处（溯源信息，必须留）
  //      · bg_pack.js 每条清单还有 picsumId 字段（整数溯源 id，必须留）
  //    两者都该留。要禁的是**代码去请求 picsum.photos 这个域名**。
  //    剥掉注释后再判，避免把溯源信息误判成网络依赖。
  const runtimeHits = [];
  for (const dir of ['utils', 'pages']) {
    const full = path.join(__dirname, '..', dir);
    for (const e of fs.readdirSync(full, { withFileTypes: true })) {
      if (!e.isFile() || !/\.(js|wxml|wxss)$/.test(e.name)) continue;
      const raw = fs.readFileSync(path.join(full, e.name), 'utf8');
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')// 块注释
        .replace(/^\s*\/\/.*$/gm, '')       // 行注释
        .replace(/<!--[\s\S]*?-->/g, '');   // wxml 注释
      if (/picsum\.photos/i.test(code)) runtimeHits.push(dir + '/' + e.name);
      if (/BASE\s*=\s*['"]https?:/i.test(code)) {
        runtimeHits.push(dir + '/' + e.name + '（含 http(s) BASE 常量）');
      }
    }
  }
  assert.strictEqual(runtimeHits.length, 0,
    '这些文件在代码体（已剥注释）里仍引用 picsum 域名，说明有运行时网络依赖：'
    + runtimeHits.join(', '));
});

t('守卫：背景必须零网络可用（内置图库 + 相册，两级足矣）', () => {
  // 上面那条防「网络图库复活」，这条防「任何形式的新网络依赖」。
  // 判定方式：applyCardStyle 产出的 bgImg 要么是包内路径，要么是相册临时路径。
  const mixin = require('../utils/card_style_mixin');
  const p = { data: Object.assign({}, mixin.defaults('literary')),
    setData(x) { Object.assign(this.data, x); } };

  const cases = [
    { desc: '默认内置图', patch: {} },
    { desc: '指定内置图', patch: { bgSource: 'builtin', bgPhotoId: require('../utils/bg_pack').ids()[5] } },
    { desc: '旧 lib storage', patch: { bgSource: 'lib', bgPhotoId: '999' } },
    { desc: '相册图', patch: { localBg: 'wxfile://tmp/a.jpg' } },
    { desc: '取消背景', patch: { localBg: '', bgSource: 'none', bgPhotoId: '' } }
  ];
  for (const c of cases) {
    p.setData(c.patch);
    const d = mixin.applyCardStyle(p, { body: 'x' });
    if (!d.bgImg) {           // 显式取消背景 =无图，合法
      assert.strictEqual(c.desc, '取消背景', c.desc + ' 意外丢了背景');
      continue;
    }
    assert.ok(!/^https?:\/\//i.test(d.bgImg),
      c.desc + ' 的 bgImg 竟是网络 URL：' + d.bgImg);
    assert.ok(String(d.bgImg).indexOf('/images/bg/') === 0
      || String(d.bgImg).indexOf('wxfile://') === 0,
      c.desc + ' 的 bgImg 既非包内路径也非相册路径：' + d.bgImg);
  }
});

t('守卫：不得引入包内字体文件（主包 2MB 上限 + canvas 不支持）', () => {
  // 2026-10-06 定案：字体走系统族，不落地字体文件。原因：
  //   ① 主包 2MB，完整中文字体 10MB+；② loadFontFace 不读包内路径；
  //   ③ canvas 原生组件不支持 loadFontFace 添加的字体。
  // 这条锁住决定，防止日后有人"顺手把字体打包进来"。
  const root = path.join(__dirname, '..');
  for (const dir of ['utils', 'pages', 'images']) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    const stack = [full];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) stack.push(f);
        else if (/\.(ttf|otf|woff2?)$/i.test(e.name)) {
          throw new Error('发现包内字体文件（应改用系统字体族）: ' + path.relative(root, f));
        }
      }
    }
  }
});

t('接线：seedIfEmpty 幂等（三道闸：flag / 非空库 / text 去重）', () => {
  // 注入内存版 wx storage，模拟「首次进入」
  const mem = {};
  global.wx = {
    getStorageSync: k => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: k => { delete mem[k]; }
  };
  delete require.cache[require.resolve('../utils/quotes_store')];
  delete require.cache[require.resolve('../utils/content_quotes')];
  const store = require('../utils/quotes_store');

  const r1 = store.seedIfEmpty();
  assert.strictEqual(r1.seeded, true, '首次应灌种子');
  assert.strictEqual(r1.count, cq.SEED_QUOTES.length, '应灌入 ' + cq.SEED_QUOTES.length + ' 条');
  assert.strictEqual(store.listQuotes().length, cq.SEED_QUOTES.length, '库内条数应等于种子数');

  // 第二次：flag 已置位 → 不再灌
  const r2 = store.seedIfEmpty();
  assert.strictEqual(r2.seeded, false, '二次不应重复灌');
  assert.strictEqual(store.listQuotes().length, cq.SEED_QUOTES.length, '条数不应变化');

  // 模拟「用户自己收藏过」：清 flag 但库非空 → 仍不覆盖
  delete mem[store.SEED_FLAG_KEY];
  const r3 = store.seedIfEmpty();
  assert.strictEqual(r3.seeded, false, '库非空时不应覆盖用户数据');
  assert.strictEqual(store.listQuotes().length, cq.SEED_QUOTES.length);

  delete global.wx;
});

t('接线：solar 普通日走轮换库（不再返回写死的那一句）', () => {
  const r1 = solar.pickForToday(new Date(2026, 5, 15, 10, 0)); // 6/15 非节气非节日
  const r2 = solar.pickForToday(new Date(2026, 5, 16, 10, 0));
  assert.strictEqual(r1.type, 'normal', '6/15 应为普通日');
  assert.ok(r1.text && r1.text.length > 0);
  assert.notStrictEqual(r1.text, r2.text, '相邻普通日文案应不同（天天换）');
  // 同一普通日两次调用必须一致（幂等）
  const again = solar.pickForToday(new Date(2026, 5, 15, 10, 0));
  assert.strictEqual(r1.text, again.text, '同一天普通日文案应稳定');
});

t('接线：节气/节日优先级仍高于普通日轮换（未被新库覆盖）', () => {
  // 2026-10-23 霜降、2026-10-01 国庆
  const t1 = solar.pickForToday(new Date(2026, 9, 23, 10, 0));
  assert.strictEqual(t1.type, 'term');
  assert.ok(t1.name.indexOf('霜降') === 0, '应命中霜降，实为 ' + t1.name);
  const f1 = solar.pickForToday(new Date(2026, 9, 1, 10, 0));
  assert.strictEqual(f1.type, 'festival');
  assert.strictEqual(f1.name, '国庆节');
});

t('接线：pickAnotherNormal 换一条必换（同一天 tap 递增）', () => {
  const base = new Date(2026, 5, 15, 10, 0);
  const a = solar.pickAnotherNormal(base, 1);
  const b = solar.pickAnotherNormal(base, 2);
  assert.ok(a && b);
  assert.notStrictEqual(a, b, 'tap 不同应换出不同文案');
  assert.strictEqual(solar.pickAnotherNormal(base, 1), a, '同 tap 应稳定');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
