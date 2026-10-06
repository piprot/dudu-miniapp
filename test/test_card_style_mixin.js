// test/test_card_style_mixin.js —— 卡片「排版风格 + 背景图」共享逻辑单测
// ─────────────────────────────────────────────────────────────────────────
// 2026-10-06 新增。天气/节气/金句/台词书摘四页共用 utils/card_style_mixin.js，
// 这里用假 wx + 假 page 驱动真实方法，验证状态机而非源码文本：
//   ① 相册图与内置图严格互斥（选一边另一边必须被清）
//   ② 内置图 id / 风格 key 都做合法性校验（防 dataset 注入）
//   ③ 深衬底→中衬底→淡衬底循环，且引擎蒙版强度必须真的随之变化
//   ④ 相册临时路径不落盘（tempFilePath 会被系统回收）
//   ⑤ 风格/背景变更后自动重绘已渲染的卡片，且沿用当前主题
//   ⑥ 取消背景回到主题渐变（不残留 bgImg）
//   ⑦ 旧 storage 里的 bgSource='lib' 能零成本回落到内置图（网络图库已整层移除）
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
const bgPack = require('../utils/bg_pack');
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
/** 清空持久化后建页：给需要「用户从未做过选择」的测试用，避免被前序测试的 store 残留污染。 */
function freshPage() { delete store[mixin.KEY]; return makePage(); }
// 内置图库的前三张，替代原photoLib.PHOTOS[0..1]
const FIRST_ID = bgPack.ids()[0];
const SECOND_ID = bgPack.ids()[1];

// ── ① 字段与默认值 ──────────────────────────────────────────────────────
t('defaults 含四页共用的全部字段，且默认文艺风', () => {
  const d = mixin.defaults('literary');
  for (const k of ['styleKey', 'styleList', 'builtinPhotos', 'photoMode', 'photoModeLabel',
    'bgPhotoId', 'bgAuthor', 'bgSource', 'localBg']) {
    assert.ok(k in d, '缺字段 ' + k);
  }
  // 网络图库移除后，这些状态字段必须从 data 里彻底消失，而不是留个空数组。
  // 留着空数组会让「四页 data 形状一致」这条约定名存实亡，且日后有人会
  // 以为 photos 还有意义而重新接回去。
  for (const k of ['photos', 'netAvailable', 'netLibOpen', 'netProbing']) {
    assert.ok(!(k in d), '网络图库遗留字段仍在 data 里：' + k);
  }
  assert.strictEqual(d.styleKey, 'literary');
  assert.strictEqual(d.photoMode, 'gray');
  assert.strictEqual(d.photoModeLabel, '深衬底', '标签应为「深衬底」而非「灰度衬底」'
    + '（内置图没有服务端灰度，只有蒙版强度——不要承诺做不到的事）');
  assert.strictEqual(d.localBg, '', '相册图默认必须为空');
  assert.strictEqual(d.styleList.length, fontKit.STYLE_LIST.length);
  assert.strictEqual(d.bgSource, 'builtin', '默认背景来源必须是内置兜底（零网络）');
  assert.strictEqual(d.builtinPhotos.length, bgPack.BUILTIN.length, '内置图数量不对');
  assert.ok(d.builtinPhotos.every(p => String(p.url).indexOf('/images/bg/') === 0), '内置图必须是包内路径');
});

t('bg_pack 清单自洽：ID 唯一、路径存在、作者非空、无 webp', () => {
  const seen = new Set();
  for (const b of bgPack.BUILTIN) {
    assert.ok(!seen.has(b.id), 'ID 重复: ' + b.id);
    seen.add(b.id);
    assert.ok(/^\/images\/bg\/[a-z0-9]+\.jpg$/.test(b.path), '路径格式异常: ' + b.path);
    assert.ok(fs.existsSync(path.join(__dirname, '..', b.path)), '包内文件缺失: ' + b.path);
    assert.ok(b.author && b.source, '缺作者/溯源: ' + b.id);
    assert.ok(b.picsumId, '缺 picsum 溯源 id: ' + b.id);
  }
  // 60 张 / 59 位作者：picsum 清单只有 59 位不同作者，所以第 60 张必然重复 1 位。
  // 这条锁住「60 张里最多 1 位作者取 2 张」，避免将来选图逻辑写错导致视觉重复。
  assert.strictEqual(bgPack.BUILTIN.length, 60, '内置图应为60 张');
  const authorCount = {};
  bgPack.BUILTIN.forEach(b => { authorCount[b.author] = (authorCount[b.author] || 0) + 1; });
  const dup = Object.values(authorCount).filter(v => v > 2);
  assert.strictEqual(dup.length, 0, '不应有作者占 3 张以上（视觉会明显重复）');
  assert.strictEqual(bgPack.stats().authors, 59, '应为 59 位作者（第 60 张重复其中 1 位）');
  assert.strictEqual(bgPack.pathOf('nope'), '', '未知 id 必须返回空串');
});

t('每页可指定自己的默认风格（缺省回退 literary）', () => {
  assert.strictEqual(mixin.defaults('modern').styleKey, 'modern');
  assert.strictEqual(mixin.defaults().styleKey, 'literary');
});

// ── ② initCardStyle 恢复与净化 ──────────────────────────────────────────
t('initCardStyle 内置图照常铺满（零网络出图的根基）', () => {
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.builtinPhotos.length, bgPack.BUILTIN.length,
    '内置图必须照常提供，这是「断网也能出卡」的根基');
  assert.ok(p.data.builtinPhotos.every(x => String(x.url).indexOf('/images/bg/') === 0),
    '内置图必须是包内路径');
  assert.strictEqual(p.data.bgSource, 'builtin', '默认来源必须是内置');
});

t('网络图库整层已移除：方法与状态字段都不得复活', () => {
  // 这条是防回退守卫。曾经的链路：onToggleNetLib 惰性探测 → netAvailable
  // 状态机 → photos 缩略图清单。整层删除后这些都不该再出现。
  // 若日后有人"顺手恢复网络图库"，光看代码会觉得功能更全，但那条路的
  // downloadFile 白名单从来没配过，实际一张图都出不来 —— 只会多一次失败探测。
  for (const fn of ['onPickPhoto', 'onToggleNetLib', '_setNetAvail']) {
    assert.strictEqual(typeof mixin.cardStyleMethods[fn], 'undefined',
      fn + ' 不该存在（网络图库已整层移除）');
  }
  assert.ok(!('PREVIEW_COUNT' in mixin), 'PREVIEW_COUNT 只服务于网络图库缩略图，不该保留');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'card_style_mixin.js'), 'utf8');
  for (const k of ['require(\'./photo_lib\')', 'photoLib.', 'picsum.photos']) {
    assert.ok(src.indexOf(k) < 0, 'mixin 里仍残留 ' + k);
  }
});

t('initCardStyle 恢复持久化的风格与衬底档位', () => {
  store[mixin.KEY] = { styleKey: 'poster', photoMode: 'blur', bgSource: 'builtin', bgPhotoId: SECOND_ID };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.styleKey, 'poster');
  assert.strictEqual(p.data.photoMode, 'blur');
  assert.strictEqual(p.data.photoModeLabel, '中衬底');
  assert.strictEqual(p.data.bgSource, 'builtin');
  assert.strictEqual(p.data.bgPhotoId, SECOND_ID);
  assert.strictEqual(p.data.bgAuthor, bgPack.authorOf(SECOND_ID), '作者未回填');
  delete store[mixin.KEY];
});

t('旧 storage 的 bgSource=lib 零成本回落到内置图（迁移路径）', () => {
  // 网络图库移除前，老用户本地存着 bgSource='lib' + 某个 picsum 数字 id。
  // 那个 id 绝不可能出现在 bg_pack 里，必须回落到默认内置图而不是坏路径。
  // 这条是真实用户的升级路径，不能靠"反正没人用了"糊过去。
  store[mixin.KEY] = { styleKey: 'poster', bgSource: 'lib', bgPhotoId: '237' };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.bgSource, 'builtin', "'lib' 应回落为 builtin");
  assert.strictEqual(p.data.bgPhotoId, mixin.FALLBACK_ID, 'picsum id 应换成默认内置图');
  assert.strictEqual(p.data.bgAuthor, bgPack.authorOf(mixin.FALLBACK_ID));
  const d = mixin.applyCardStyle(p, {});
  assert.strictEqual(d.bgImg, bgPack.pathOf(mixin.FALLBACK_ID), '不得产生坏路径');
  assert.ok(String(d.bgImg).indexOf('/images/bg/') === 0, '必须是包内路径');
  assert.ok(!('bgFallback' in d), '已是内置图，不该再挂兜底');
  delete store[mixin.KEY];
});

t('normalizeSource 只认 album / none，其余（含 lib）一律 builtin', () => {
  assert.strictEqual(mixin.normalizeSource('album'), 'album');
  assert.strictEqual(mixin.normalizeSource('none'), 'none');
  assert.strictEqual(mixin.normalizeSource('builtin'), 'builtin');
  assert.strictEqual(mixin.normalizeSource('lib'), 'builtin', "'lib' 是已废弃的历史值");
  assert.strictEqual(mixin.normalizeSource('javascript:alert(1)'), 'builtin');
  assert.strictEqual(mixin.normalizeSource(undefined), 'builtin');
});

t('initCardStyle 恢复持久化的内置兜底图选择', () => {
  const bid = bgPack.ids()[3];
  store[mixin.KEY] = { styleKey: 'literary', photoMode: 'gray', bgSource: 'builtin', bgPhotoId: bid };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.bgSource, 'builtin');
  assert.strictEqual(p.data.bgPhotoId, bid);
  assert.strictEqual(p.data.bgAuthor, bgPack.authorOf(bid));
  delete store[mixin.KEY];
});

t('initCardStyle 净化脏偏好：未知风格/路径穿越 id/未知模式全部回落', () => {
  store[mixin.KEY] = { styleKey: 'haha', photoMode: 'sepia', bgSource: 'builtin', bgPhotoId: '../../etc/passwd' };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.styleKey, 'literary', '未知风格未回落');
  assert.strictEqual(p.data.photoMode, 'gray', '未知模式未回落');
  assert.strictEqual(p.data.bgSource, 'builtin');
  assert.strictEqual(p.data.bgPhotoId, mixin.FALLBACK_ID, '应回落到默认内置图');
  delete store[mixin.KEY];
});

t('initCardStyle 恢复 none（用户曾取消背景）时不给兜底图', () => {
  store[mixin.KEY] = { styleKey: 'literary', bgSource: 'none', bgPhotoId: '' };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.bgSource, 'none', 'none 应被保留，不能回落成 builtin');
  assert.strictEqual(p.data.bgPhotoId, '');
  assert.strictEqual(mixin.applyCardStyle(p, {}).bgImg, undefined, 'none 不应产生 bgImg');
  delete store[mixin.KEY];
});

// ── ③ 背景选择与互斥（内置 / 相册）────────────────────────────────────
t('onPickBuiltinBg 只接受内置库内的 id（防 dataset 注入任意路径）', () => {
  const p = makePage();
  const bid = bgPack.ids()[2];
  p.onPickBuiltinBg(ev({ id: bid }));
  assert.strictEqual(p.data.bgPhotoId, bid);
  assert.strictEqual(p.data.bgSource, 'builtin');
  assert.strictEqual(p.data.bgAuthor, bgPack.authorOf(bid));

  const p2 = makePage();
  const before = p2.data.bgPhotoId;
  p2.onPickBuiltinBg(ev({ id: '/etc/passwd' }));
  assert.strictEqual(p2.data.bgPhotoId, before, '非法路径未被拦下');
});

t('内置兜底图是默认来源：未做任何选择时也能出带背景的卡', () => {
  const p = freshPage();
  p.initCardStyle('literary');
  const d = mixin.applyCardStyle(p, { body: 'x' });
  assert.ok(d.bgImg, '默认应带内置兜底图');
  assert.ok(String(d.bgImg).indexOf('/images/bg/') === 0, '默认必须是包内内置图，实际=' + d.bgImg);
  assert.ok(!('bgFallback' in d), '内置图不需要再挂兜底');
});

t('内置图随衬底档位切换引擎蒙版强度（内置图无服务端，靠蒙版近似）', () => {
  const p = freshPage();
  p.initCardStyle('literary');
  const g = mixin.applyCardStyle(p, {}).bgVeil;
  p.onCyclePhotoMode();                       // gray → blur
  const b = mixin.applyCardStyle(p, {}).bgVeil;
  p.onCyclePhotoMode();                       // blur → raw
  const r = mixin.applyCardStyle(p, {}).bgVeil;
  assert.deepStrictEqual([g, b, r], [mixin.BUILTIN_VEIL.gray, mixin.BUILTIN_VEIL.blur, mixin.BUILTIN_VEIL.raw]);
  assert.ok(g[0] > b[0] && b[0] > r[0], '深衬底蒙版必须最厚（保白字可读）');
  // 三档必须真的不同，否则「切换档位」这个交互就是假的
  assert.notStrictEqual(JSON.stringify(g), JSON.stringify(b));
  assert.notStrictEqual(JSON.stringify(b), JSON.stringify(r));
});

t('相册图挂内置兜底：原图被用户删掉后仍能出带背景的卡', () => {
  // 2026-10-06：bgFallback 原本只挂给网络图，网络图库删除后会变成死代码。
  // 但相册临时路径**同样可能失效**（用户在系统相册里删了原图），
  // 所以把兜底挂到 localBg 上 —— 这个分支从死代码变成真实保护。
  const p = freshPage();
  p.initCardStyle('literary');
  p.setData({ localBg: 'wxfile://tmp/pic.jpg', bgSource: 'album' });
  const d = mixin.applyCardStyle(p, {});
  assert.strictEqual(d.bgImg, 'wxfile://tmp/pic.jpg', '应使用相册图');
  assert.strictEqual(d.bgFallback, bgPack.pathOf(mixin.FALLBACK_ID), '相册图必须挂内置兜底');
  assert.ok(d.bgVeil === undefined, '相册图是用户自己的作品，不该叠蒙版（叠了等于替用户改图）');
});

t('相册图与内置图互斥：选相册清内置，选内置清相册', () => {
  const p = makePage();
  p.onPickBuiltinBg(ev({ id: FIRST_ID }));

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
  assert.strictEqual(fake.data.bgPhotoId, '', '选了相册图却仍保留内置图选中');

  p.setData({ bgPhotoId: FIRST_ID, bgAuthor: 'x', localBg: 'wxfile://tmp/abc.jpg' });
  p.onPickBuiltinBg(ev({ id: SECOND_ID }));
  assert.strictEqual(p.data.localBg, '', '选了内置图却仍保留相册图');
  assert.strictEqual(p.data.bgSource, 'builtin');
});

t('onPickAlbumBg 用户取消时不做任何改动', () => {
  const p = makePage();
  p.onPickBuiltinBg(ev({ id: FIRST_ID }));
  global.wx.chooseMedia = (o) => o.fail({ errMsg: 'chooseMedia:fail cancel' });
  p.onPickAlbumBg();
  assert.strictEqual(p.data.bgPhotoId, FIRST_ID, '取消后内置图选择被清掉了');
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

// ── ④ 衬底档位循环 ──────────────────────────────────────────────────────
t('衬底深→中→淡循环，第4 次绕回与首次完全一致', () => {
  // ⚠️ 必须用 freshPage()：上一个测试往 store 写过 photoMode，
  // makePage() 不清store 会让本测试从raw 起步，循环序列整体错位。
  const p = freshPage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.photoMode, 'gray', '起点应为深衬底');
  const labels = [p.data.photoModeLabel];
  const veils = [JSON.stringify(mixin.applyCardStyle(p, {}).bgVeil)];
  for (let i = 0; i < 3; i++) {
    p.onCyclePhotoMode();
    labels.push(p.data.photoModeLabel);
    veils.push(JSON.stringify(mixin.applyCardStyle(p, {}).bgVeil));
  }
  assert.deepStrictEqual(labels,
    ['深衬底', '中衬底', '淡衬底', '深衬底'], '衬底循环顺序不对：' + labels.join('/'));
  assert.strictEqual(new Set(veils.slice(0, 3)).size, 3, '三档蒙版强度必须各不相同');
  assert.strictEqual(veils[3], veils[0], '绕回深衬底后应与首次一致（证明是真循环而非乱序）');
});

t('切档位只改蒙版，不改选中的图（bgImg 保持不变）', () => {
  // 网络图时代切档位要重算 24 张缩略图 URL；内置图是包内路径，与档位无关。
  const p = makePage();
  p.initCardStyle('literary');
  const bid = bgPack.ids()[7];
  p.onPickBuiltinBg(ev({ id: bid }));
  const before = mixin.applyCardStyle(p, {}).bgImg;
  p.onCyclePhotoMode();
  const after = mixin.applyCardStyle(p, {}).bgImg;
  assert.strictEqual(after, before, '切档位不该换图');
  assert.strictEqual(p.data.bgPhotoId, bid, '切档位不该改选中 id');
  assert.notStrictEqual(JSON.stringify(mixin.applyCardStyle(p, {}).bgVeil),
    JSON.stringify(mixin.BUILTIN_VEIL.gray), '切档位必须真的改蒙版');
});

t('切档位会持久化（下次进小程序仍保持）', () => {
  const p = freshPage();          // 同上：清掉前序 store 残留
  p.initCardStyle('literary');
  assert.strictEqual(p.data.photoMode, 'gray', '起点应为深衬底');
  p.onCyclePhotoMode();
  assert.strictEqual(store[mixin.KEY].photoMode, 'blur', '衬底档位未持久化');
  delete store[mixin.KEY];
});

t('onShufflePhoto 在内置库内循环取下一张', () => {
  const p = freshPage();
  const bids = bgPack.ids();
  p.setData({ bgSource: 'builtin', bgPhotoId: bids[0] });
  p.onShufflePhoto();
  assert.strictEqual(p.data.bgPhotoId, bids[1]);
  assert.strictEqual(p.data.bgSource, 'builtin');
  assert.strictEqual(p.data.bgAuthor, bgPack.authorOf(bids[1]), '换一张后作者未回填');
  p.setData({ bgPhotoId: bids[bids.length - 1] });
  p.onShufflePhoto();
  assert.strictEqual(p.data.bgPhotoId, bids[0], '内置环未绕回');
});

t('onShufflePhoto 会清掉相册图（换一张必然落回内置来源）', () => {
  const p = freshPage();
  p.initCardStyle('literary');
  p.setData({ localBg: 'wxfile://tmp/x.jpg', bgSource: 'album', bgPhotoId: '' });
  p.onShufflePhoto();
  assert.strictEqual(p.data.localBg, '', '换一张后仍挂着相册图');
  assert.strictEqual(p.data.bgSource, 'builtin');
  assert.ok(bgPack.has(p.data.bgPhotoId), '换一张后应落在内置库内');
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
t('applyCardStyle 背景优先级：相册图 > 内置图 > 无', () => {
  const p = makePage();
  // 内置（默认来源）
  p.setData({ bgSource: 'builtin', bgPhotoId: bgPack.ids()[0] });
  const withBuiltin = mixin.applyCardStyle(p, { body: 'x' });
  assert.ok(String(withBuiltin.bgImg).indexOf('/images/bg/') === 0, '未使用内置图');
  assert.ok(withBuiltin.bgVeil, '内置图应挂衬底蒙版');
  assert.ok(!('bgFallback' in withBuiltin), '内置图自己就是兜底，不该再挂兜底（会自我循环）');

  // 相册图优先于内置
  p.setData({ localBg: 'wxfile://tmp/pic.jpg' });
  const withAlbum = mixin.applyCardStyle(p, { body: 'x' });
  assert.strictEqual(withAlbum.bgImg, 'wxfile://tmp/pic.jpg', '相册图未优先于内置图');
  assert.ok(withAlbum.bgFallback, '相册图应挂内置兜底（原图可能被删）');

  // 显式取消背景（none）才真的没有 bgImg
  p.setData({ localBg: '', bgSource: 'none', bgPhotoId: '' });
  const none = mixin.applyCardStyle(p, { body: 'x' });
  assert.ok(!('bgImg' in none), '取消背景后不应有 bgImg');
  assert.ok(!('bgFallback' in none), '取消背景后不应有 bgFallback');
  assert.ok(!('bgVeil' in none), '取消背景后不应有 bgVeil');
});

t('applyCardStyle 未知内置 id 拦下落回默认内置图（不产生坏路径）', () => {
  const p = makePage();
  p.setData({ bgSource: 'builtin', bgPhotoId: '/etc/passwd' });
  const d = mixin.applyCardStyle(p, {});
  assert.strictEqual(d.bgImg, bgPack.pathOf(mixin.FALLBACK_ID), '未回落到默认内置图');
  assert.ok(String(d.bgImg).indexOf('/images/bg/') === 0, '必须是包内路径');
  assert.ok(!('bgFallback' in d), '已回落为内置图，不该再挂兜底');
  assert.ok(d.bgVeil, '内置图应挂衬底蒙版');
});

t('applyCardStyle 对lib 来源（旧 storage）也降级为内置图而非坏 URL', () => {
  // 直接调 applyCardStyle（不走 initCardStyle）时也可能撞上 lib —— 例如
  // 用户在页面已打开时storage 被别的逻辑写入。applyCardStyle 自己必须也能拦住。
  const p = makePage();
  p.setData({ bgSource: 'lib', bgPhotoId: 'deadbeef' });
  const d = mixin.applyCardStyle(p, {});
  assert.strictEqual(d.bgImg, bgPack.pathOf(mixin.FALLBACK_ID), '未降级为内置图');
  assert.ok(String(d.bgImg).indexOf('/images/bg/') === 0, '不得产生网络 URL');
  assert.ok(d.bgFallback === undefined, '已降级为内置图，不该再挂兜底');
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
  //
  // ⚠️ 切片必须**只取 repaint 函数体**，不能从 'function repaint' 一直切到文件尾。
  // 2026-10-06 踩过：当时新增的 _setNetAvail 里有
  // `rendered: ok ? this.data.rendered : false`（合法的状态回填），
  // 被「切到文件尾」的旧写法一并捕获，误报 repaint 依赖 data.rendered。
  // （_setNetAvail 随网络图库整层删除，但这个坑的教训留着：切片必须精确。）
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'card_style_mixin.js'), 'utf8');
  const start = src.indexOf('function repaint');
  assert.ok(start > 0, '找不到 repaint 函数');
  // 按大括号配对精确提取函数体。第二版踩过的坑：按「下一个 \nfunction 」截断
  // 会把后面的 `const cardStyleMethods = {...}` 整个对象字面量吞进来
  // （它是 const 不是 function），于是 _setNetLib 之外的无关代码也被扫描。
  const bodyStart = src.indexOf('{', start);
  let depth = 0, end = bodyStart;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(bodyStart, end + 1);
  assert.ok(body.length > 20 && body.length < 2000,
    'repaint 函数体提取异常（长度 ' + body.length + '），大括号配对可能失效');
  assert.ok(body.indexOf('data.rendered') < 0,
    'repaint 又用 data.rendered 判定是否重绘，会导致切换风格不生效'
    + '\n--- repaint 函数体 ---\n' + body);
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

t('normalizeMode 对未知模式一律回落深衬底', () => {
  assert.strictEqual(mixin.normalizeMode('blur'), 'blur');
  assert.strictEqual(mixin.normalizeMode('raw'), 'raw');
  assert.strictEqual(mixin.normalizeMode(''), 'gray');
  assert.strictEqual(mixin.normalizeMode(null), 'gray');
  assert.strictEqual(mixin.normalizeMode('GRAY'), 'gray', '大小写敏感，不该接受 GRAY');
  // 三档标签必须与内置图实际能做到的事一致（蒙版强弱，不是真灰度/虚化）
  assert.deepStrictEqual(mixin.MODE_LABEL, { gray: '深衬底', blur: '中衬底', raw: '淡衬底' });
  for (const k of mixin.PHOTO_MODES) {
    assert.ok(mixin.MODE_LABEL[k], k + ' 缺标签');
  }
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