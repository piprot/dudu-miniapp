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

t('接线：四页均已接上背景图库（选图/切模式/换一张/取消/相册）', () => {
  // 2026-10-06 起这套逻辑抽到 utils/card_style_mixin.js，四页共用；
  // 守卫从「页面里逐个定义方法」升级为「mixin 提供方法 + 四页都注入 + wxml 都有控件」。
  const mixin = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'card_style_mixin.js'), 'utf8');
  for (const fn of ['onPickPhoto', 'onPickBuiltinBg', 'onCyclePhotoMode', 'onShufflePhoto',
    'onClearPhoto', 'onPickAlbumBg', 'onPickStyle']) {
    assert.ok(mixin.indexOf(fn + '(') >= 0, 'card_style_mixin 缺方法 ' + fn);
  }
  // applyCardStyle 必须真的算出 bgImg（相册 > 网络图库 > 内置兜底；显式取消则不设该键）
  assert.ok(/bgImg/.test(mixin), 'mixin 未产出 bgImg');
  // 两级来源必须都在：内置兜底（零网络）+ 网络图库（增强项）
  assert.ok(/bg_pack/.test(mixin), 'mixin 未接内置兜底图库 bg_pack');
  assert.ok(/photo_lib/.test(mixin), 'mixin 未保留网络图库 photo_lib');
  assert.ok(/bgFallback/.test(mixin), 'mixin 未给网络图挂内置兜底（白名单没配会白卡）');
  for (const p of ['weather', 'solar', 'quotes', 'line']) {
    const js = fs.readFileSync(
      path.join(__dirname, '..', 'pages', p, p + '.js'), 'utf8');
    assert.ok(/card_style_mixin/.test(js), p + '.js 未引入 card_style_mixin');
    assert.ok(/cardStyle\.cardStyleMethods/.test(js), p + '.js 未注入风格/背景方法');
    assert.ok(/cardStyle\.applyCardStyle\(/.test(js), p + '.js 渲染前未套用 applyCardStyle');
    assert.ok(/cardStyle\.defaults\(/.test(js), p + '.js data 未套用 card_style 字段');
    const wxml = fs.readFileSync(
      path.join(__dirname, '..', 'pages', p, p + '.wxml'), 'utf8');
    for (const b of ['bindtap="onPickPhoto"', 'bindtap="onPickBuiltinBg"',
      'bindtap="onCyclePhotoMode"',
      'bindtap="onShufflePhoto"', 'bindtap="onClearPhoto"',
      'bindtap="onPickAlbumBg"', 'bindtap="onPickStyle"', 'class="bg-scroll"',
      '{{builtinPhotos}}']) {
      assert.ok(wxml.indexOf(b) >= 0, p + '.wxml 缺 ' + b);
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
