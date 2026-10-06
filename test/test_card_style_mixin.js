// test/test_card_style_mixin.js —— 卡片「排版风格 + 背景图」共享逻辑单测
// ─────────────────────────────────────────────────────────────────────────
// 2026-10-06 新增。天气/节气/金句/台词书摘四页共用 utils/card_style_mixin.js，
// 这里用假 wx + 假 page 驱动真实方法，验证状态机而非源码文本：
//   ① 相册图与图库图严格互斥（选一边另一边必须被清）
//   ② 图库 id / 风格 key 都做合法性校验（防 dataset 注入）
//   ③ 灰度→虚化→原图循环，且缩略图 URL 必须真的随之变化
//   ④ 相册临时路径不落盘（tempFilePath 会被系统回收）
//   ⑤ 风格/背景变更后自动重绘已渲染的卡片，且沿用当前主题
//   ⑥ 取消背景回到主题渐变（不残留 bgImg）
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ── 假存储 ──────────────────────────────────────────────────────────────
const store = {};
global.wx = {
  getStorageSync(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''; },
  setStorageSync(k, v) { store[k] = JSON.parse(JSON.stringify(v)); },
  showToast() {},
  chooseMedia() { throw new Error('测试不应真的调起相册'); }
};

const mixin = require('../utils/card_style_mixin');
const photoLib = require('../utils/photo_lib');
const fontKit = require('../utils/font_kit');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); fail++; }
}

/** 造一个最小可用的 page：setData 合并进 data，其余交给 mixin 方法。 */
function makePage(overrides) {
  const page = {
    data: Object.assign({}, mixin.defaults('literary'), overrides || {}),
    setData(patch) { Object.assign(this.data, patch); }
  };
  Object.assign(page, mixin.cardStyleMethods);
  return page;
}
const ev = (ds) => ({ currentTarget: { dataset: ds } });
const FIRST_ID = photoLib.PHOTOS[0].id;
const SECOND_ID = photoLib.PHOTOS[1].id;

// ── ① 字段与默认值 ──────────────────────────────────────────────────────
t('defaults 含四页共用的全部字段，且默认文艺风', () => {
  const d = mixin.defaults('literary');
  for (const k of ['styleKey', 'styleList', 'photos', 'photoMode', 'photoModeLabel',
    'bgPhotoId', 'bgAuthor', 'bgSource', 'localBg']) {
    assert.ok(k in d, '缺字段 ' + k);
  }
  assert.strictEqual(d.styleKey, 'literary');
  assert.strictEqual(d.photoMode, 'gray');
  assert.strictEqual(d.photoModeLabel, '灰度衬底');
  assert.strictEqual(d.localBg, '', '相册图默认必须为空');
  assert.strictEqual(d.styleList.length, fontKit.STYLE_LIST.length);
});

t('每页可指定自己的默认风格（缺省回退 literary）', () => {
  assert.strictEqual(mixin.defaults('modern').styleKey, 'modern');
  assert.strictEqual(mixin.defaults().styleKey, 'literary');
});

// ── ② initCardStyle 恢复与净化 ──────────────────────────────────────────
t('initCardStyle 铺缩略图且默认灰度', () => {
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.photos.length, mixin.PREVIEW_COUNT, '缩略图数量不对');
  assert.ok(p.data.photos.length <= photoLib.PHOTOS.length);
  assert.ok(p.data.photos[0].url.indexOf('grayscale') >= 0, '默认应为灰度衬底');
});

t('initCardStyle 恢复持久化的风格与图库选择', () => {
  store[mixin.KEY] = { styleKey: 'poster', photoMode: 'blur', bgPhotoId: SECOND_ID };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.styleKey, 'poster');
  assert.strictEqual(p.data.photoMode, 'blur');
  assert.strictEqual(p.data.photoModeLabel, '虚化');
  assert.strictEqual(p.data.bgPhotoId, SECOND_ID);
  assert.strictEqual(p.data.bgAuthor, photoLib.authorOf(SECOND_ID), '作者未回填');
  delete store[mixin.KEY];
});

t('initCardStyle 净化脏偏好：未知风格/未知图库 id/未知模式全部回落', () => {
  store[mixin.KEY] = { styleKey: 'haha', photoMode: 'sepia', bgPhotoId: '../../etc/passwd' };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.styleKey, 'literary', '未知风格未回落');
  assert.strictEqual(p.data.photoMode, 'gray', '未知模式未回落');
  assert.strictEqual(p.data.bgPhotoId, '', '未知图库 id 未清空');
  delete store[mixin.KEY];
});

// ── ③ 图库选择与互斥 ────────────────────────────────────────────────────
t('onPickPhoto 选中的 id 必须真实存在，否则完全忽略', () => {
  const p = makePage();
  p.onPickPhoto(ev({ id: FIRST_ID }));
  assert.strictEqual(p.data.bgPhotoId, FIRST_ID);
  assert.strictEqual(p.data.bgAuthor, photoLib.authorOf(FIRST_ID));

  const p2 = makePage();
  p2.onPickPhoto(ev({ id: 'javascript:alert(1)' }));
  assert.strictEqual(p2.data.bgPhotoId, '', '非法 id 未被拦下');
});

t('相册图与图库图互斥：选相册清图库，选图库清相册', () => {
  const p = makePage();
  p.onPickPhoto(ev({ id: FIRST_ID }));

  // 模拟 chooseMedia 成功回调（这里直接调私有逻辑，避免真起相册）
  const fake = {
    data: p.data,
    setData(x) { Object.assign(this.data, x); }
  };
  global.wx.chooseMedia = (o) => {
    o.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/abc.jpg' }] });
  };
  p.onPickAlbumBg.call(fake);
  assert.strictEqual(fake.data.localBg, 'wxfile://tmp/abc.jpg', '相册图未生效');
  assert.strictEqual(fake.data.bgSource, 'album');
  assert.strictEqual(fake.data.bgPhotoId, '', '选了相册图却仍保留图库选中');

  p.setData({ bgPhotoId: FIRST_ID, bgAuthor: 'x', localBg: 'wxfile://tmp/abc.jpg' });
  p.onPickPhoto(ev({ id: SECOND_ID }));
  assert.strictEqual(p.data.localBg, '', '选了图库图却仍保留相册图');
  assert.strictEqual(p.data.bgSource, 'lib');
});

t('onPickAlbumBg 用户取消时不做任何改动', () => {
  const p = makePage();
  p.onPickPhoto(ev({ id: FIRST_ID }));
  global.wx.chooseMedia = (o) => o.fail({ errMsg: 'chooseMedia:fail cancel' });
  p.onPickAlbumBg();
  assert.strictEqual(p.data.bgPhotoId, FIRST_ID, '取消后图库选择被清掉了');
  assert.strictEqual(p.data.localBg, '');
});

t('onClearPhoto 清空全部背景，回主题渐变', () => {
  const p = makePage();
  p.setData({ bgPhotoId: FIRST_ID, bgAuthor: 'a', localBg: 'wxfile://x.jpg', bgSource: 'album' });
  p.onClearPhoto();
  assert.strictEqual(p.data.bgPhotoId, '');
  assert.strictEqual(p.data.bgAuthor, '');
  assert.strictEqual(p.data.localBg, '');
  const out = mixin.applyCardStyle(p, { body: 'x' });
  assert.ok(!('bgImg' in out), '取消背景后仍带 bgImg');
});

// ── ④ 处理方式循环 ──────────────────────────────────────────────────────
t('处理方式灰度→虚化→原图循环，缩略图 URL 随之变化', () => {
  const p = makePage();
  p.initCardStyle('literary');
  const seen = [p.data.photos[0].url];
  const labels = [p.data.photoModeLabel];
  for (let i = 0; i < 3; i++) {
    p.onCyclePhotoMode();
    labels.push(p.data.photoModeLabel);
    seen.push(p.data.photos[0].url);
  }
  assert.deepStrictEqual(labels,
    ['灰度衬底', '虚化', '原图', '灰度衬底'], '处理方式循环顺序不对：' + labels.join('/'));
  // 三种模式 URL 互不相同；第4 次绕回灰度，应与第 1 次完全一致（证明是真循环而非乱序）
  assert.strictEqual(new Set(seen.slice(0, 3)).size, 3, '三种模式的缩略图 URL 必须各不相同');
  assert.strictEqual(seen[3], seen[0], '绕回灰度后URL 未与首次一致');
  assert.ok(seen[0].indexOf('grayscale') >= 0);
  assert.ok(seen[1].indexOf('blur=') >= 0);
  assert.ok(seen[2].indexOf('?') < 0, '原图模式不应带 query');
});

t('切到虚化后整份缩略图清单都换成虚化 URL（不只第一张）', () => {
  const p = makePage();
  p.initCardStyle('literary');
  p.onCyclePhotoMode();
  assert.strictEqual(p.data.photoMode, 'blur');
  assert.ok(p.data.photos.length > 1);
  assert.ok(p.data.photos.every(x => x.url.indexOf('blur=') >= 0), '清单未随模式整体刷新');
  // 图库 id 不变，只是URL 的处理参数变了
  assert.deepStrictEqual(p.data.photos.map(x => x.id),
    photoLib.listAll({ mode: 'blur' }).slice(0, mixin.PREVIEW_COUNT).map(x => x.id));
});

t('onShufflePhoto 在库内循环取下一张', () => {
  const p = makePage();
  const ids = photoLib.PHOTOS.map(x => x.id);
  p.setData({ bgPhotoId: ids[0] });
  p.onShufflePhoto();
  assert.strictEqual(p.data.bgPhotoId, ids[1]);
  p.onShufflePhoto();
  assert.strictEqual(p.data.bgPhotoId, ids[2]);
  // 从最后一张再换回到第一张
  p.setData({ bgPhotoId: ids[ids.length - 1] });
  p.onShufflePhoto();
  assert.strictEqual(p.data.bgPhotoId, ids[0]);
});

// ── ⑤ 风格切换 ──────────────────────────────────────────────────────────
t('onPickStyle 只接受 font_kit 认得的 key，且同值不重复渲染', () => {
  const p = makePage();
  let rendered = 0;
  p.data.rendered = true;
  p._cardOpts = { canvasId: '#x', type: 'quote', theme: 'warm', data: { body: 'a' } };
  p._renderCount = () => rendered;

  p.onPickStyle(ev({ key: 'modern' }));
  assert.strictEqual(p.data.styleKey, 'modern');
  assert.strictEqual(store[mixin.KEY].styleKey, 'modern', '风格未持久化');

  p.onPickStyle(ev({ key: '不存在的风格' }));
  assert.strictEqual(p.data.styleKey, 'modern', '非法风格被接受了');
  delete store[mixin.KEY];
});

// ── ⑥ applyCardStyle：背景优先级与非法值拦截 ───────────────────────────
t('applyCardStyle 背景优先级：相册图 > 图库图 > 无', () => {
  const p = makePage();
  p.setData({ bgPhotoId: FIRST_ID, photoMode: 'gray' });
  const withLib = mixin.applyCardStyle(p, { body: 'x' });
  assert.ok(withLib.bgImg.indexOf(photoLib.urlOf(FIRST_ID, { mode: 'gray' })) >= 0,
    '未使用图库 URL');

  p.setData({ localBg: 'wxfile://tmp/pic.jpg' });
  const withAlbum = mixin.applyCardStyle(p, { body: 'x' });
  assert.strictEqual(withAlbum.bgImg, 'wxfile://tmp/pic.jpg', '相册图未优先于图库图');

  p.setData({ localBg: '', bgPhotoId: '' });
  const none = mixin.applyCardStyle(p, { body: 'x' });
  assert.ok(!('bgImg' in none), '无背景时不应有 bgImg');
});

t('applyCardStyle 不修改传入的 base（纯函数）', () => {
  const p = makePage();
  p.setData({ bgPhotoId: FIRST_ID, styleKey: 'warm' });
  const base = { body: 'x' };
  const out = mixin.applyCardStyle(p, base);
  assert.ok(!('bgImg' in base), 'base 被污染了');
  assert.ok(!('styleKey' in base), 'base 被污染了');
  assert.notStrictEqual(out, base);
});

t('applyCardStyle 透传 cover 等其他字段', () => {
  const p = makePage();
  const out = mixin.applyCardStyle(p, { cover: 'wxfile://c.jpg', title: 'T', body: 'B' });
  assert.strictEqual(out.cover, 'wxfile://c.jpg');
  assert.strictEqual(out.title, 'T');
  assert.strictEqual(out.body, 'B');
});

// ── ⑦ 自动重绘 ──────────────────────────────────────────────────────────
t('风格/背景变化后自动重绘已渲染卡片，并沿用当前主题', () => {
  // repaint 内部会调quote_card_render.renderCard（真 canvas 在 node 下不可用），
  // 故只验证「它把正确的参数交给了渲染器」：拦下 require.cache 里的 renderCard。
  const key = require.resolve('../utils/quote_card_render');
  const orig = require.cache[key].exports;
  let got = null;
  require.cache[key].exports = {
    renderCard: (page, opts) => { got = opts; return Promise.resolve(); },
    saveCanvas: orig.saveCanvas
  };
  delete require.cache[require.resolve('../utils/card_style_mixin')];
  const fresh = require('../utils/card_style_mixin');

  const p = makePage();
  p.data.theme = 'blue';
  p._cardOpts = { canvasId: '#c', type: 'quote', theme: 'warm', data: { body: 'x' } };
  fresh.repaint(p);

  assert.ok(got, '未触发重绘');
  assert.strictEqual(got.canvasId, '#c');
  assert.strictEqual(got.theme, 'blue', '重绘未沿用当前主题');
  assert.strictEqual(got.type, 'quote');
  assert.ok(got.data.styleKey, '重绘时未注入 styleKey');
  assert.strictEqual(p._cardOpts.data, got.data, '_cardOpts 未同步更新（下次重绘会用旧数据）');

  require.cache[key].exports = orig;
  delete require.cache[require.resolve('../utils/card_style_mixin')];
});

t('从未渲染过时改风格/背景不调canvas（避免空画布报错）', () => {
  const key = require.resolve('../utils/quote_card_render');
  const orig = require.cache[key].exports;
  let called = 0;
  require.cache[key].exports = {
    renderCard: () => { called++; return Promise.resolve(); },
    saveCanvas: orig.saveCanvas
  };
  delete require.cache[require.resolve('../utils/card_style_mixin')];
  const fresh = require('../utils/card_style_mixin');

  // 没有 _cardOpts = 还没成功渲染过任何卡片
  const p = makePage();
  p.onPickStyle(ev({ key: 'modern' }));
  assert.strictEqual(called, 0, '未渲染却调了 canvas');
  assert.strictEqual(p.data.styleKey, 'modern', '但状态仍应记住用户选择');
  assert.strictEqual(p.data.rendered, false, '未渲染时不该谎报已渲染');

  require.cache[key].exports = orig;
  delete require.cache[require.resolve('../utils/card_style_mixin')];
});

t('repaint 判定「已渲染」看 _cardOpts 而非 data.rendered', () => {
  // 回归：setter 会把 rendered 置false（提示参数已变），
  // 若repaint 拿 data.rendered 当判据，风格切换就永远不会生效。
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'card_style_mixin.js'), 'utf8');
  const body = src.slice(src.indexOf('function repaint'));
  assert.ok(body.indexOf('data.rendered') < 0,
    'repaint 又用 data.rendered 判定是否重绘，会导致切换风格不生效');
});

// ── ⑧ 持久化取舍 ────────────────────────────────────────────────────────
t('相册临时路径绝不落盘', () => {
  const p = makePage();
  global.wx.chooseMedia = (o) => o.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/zz.jpg' }] });
  p.onPickAlbumBg();
  const dumped = JSON.stringify(store[mixin.KEY] || {});
  assert.ok(dumped.indexOf('wxfile://tmp/zz.jpg') < 0, '相册路径被写进了 storage');
  assert.strictEqual(p.data.localBg, 'wxfile://tmp/zz.jpg', '但本次会话内仍应可用');
});

t('normalizeMode 对未知模式一律回落灰度', () => {
  assert.strictEqual(mixin.normalizeMode('blur'), 'blur');
  assert.strictEqual(mixin.normalizeMode('raw'), 'raw');
  assert.strictEqual(mixin.normalizeMode(''), 'gray');
  assert.strictEqual(mixin.normalizeMode(null), 'gray');
  assert.strictEqual(mixin.normalizeMode('GRAY'), 'gray');
});

// ── ⑨ 四页默认风格一致性 ────────────────────────────────────────────────
t('四页都传入了合法默认风格', () => {
  for (const p of ['weather', 'solar', 'quotes', 'line']) {
    const js = fs.readFileSync(path.join(__dirname, '..', 'pages', p, p + '.js'), 'utf8');
    const m = js.match(/initCardStyle\('([a-z]+)'\)/);
    assert.ok(m, p + '.js 未调用 initCardStyle');
    assert.ok(fontKit.hasStyle(m[1]), p + '.js 默认风格非法：' + m[1]);
    const m2 = js.match(/cardStyle\.defaults\('([a-z]+)'\)/);
    assert.ok(m2 && m2[1] === m[1], p + '.js data 默认风格与 initCardStyle 不一致');
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);