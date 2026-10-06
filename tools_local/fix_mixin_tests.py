#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 test_card_style_mixin.js 从「三级来源」改写为「两级来源」。

每块替换都断言唯一命中 —— 匹配到0 处或 >1 处立刻失败并报出锚点，
避免 re.sub 静默改错地方（这正是深色调阶段踩过的坑：批改吞掉 module.exports）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'test', 'test_card_style_mixin.js')

BLOCKS = []

# ── 1. 文件头注释 + require ──────────────────────────────────────────────
BLOCKS.append(("""// 2026-10-06 新增。天气/节气/金句/台词书摘四页共用 utils/card_style_mixin.js，
// 这里用假 wx + 假 page 驱动真实方法，验证状态机而非源码文本：
//   ① 相册图与图库图严格互斥（选一边另一边必须被清）
//   ② 图库 id / 风格 key 都做合法性校验（防 dataset 注入）
//   ③ 灰度→虚化→原图循环，且缩略图 URL 必须真的随之变化
//   ④ 相册临时路径不落盘（tempFilePath 会被系统回收）
//   ⑤ 风格/背景变更后自动重绘已渲染的卡片，且沿用当前主题
//   ⑥ 取消背景回到主题渐变（不残留 bgImg）""",
"""// 2026-10-06 新增。天气/节气/金句/台词书摘四页共用 utils/card_style_mixin.js，
// 这里用假 wx + 假 page 驱动真实方法，验证状态机而非源码文本：
//   ① 相册图与内置图严格互斥（选一边另一边必须被清）
//   ② 内置图 id / 风格 key 都做合法性校验（防 dataset 注入）
//   ③ 深衬底→中衬底→淡衬底循环，且引擎蒙版强度必须真的随之变化
//   ④ 相册临时路径不落盘（tempFilePath 会被系统回收）
//   ⑤ 风格/背景变更后自动重绘已渲染的卡片，且沿用当前主题
//   ⑥ 取消背景回到主题渐变（不残留 bgImg）
//   ⑦ 旧 storage 里的 bgSource='lib' 能零成本回落到内置图（网络图库已整层移除）"""))

BLOCKS.append(("""const mixin = require('../utils/card_style_mixin');
const photoLib = require('../utils/photo_lib');
const bgPack = require('../utils/bg_pack');""",
"""const mixin = require('../utils/card_style_mixin');
const bgPack = require('../utils/bg_pack');"""))

BLOCKS.append(("""const FIRST_ID = photoLib.PHOTOS[0].id;
const SECOND_ID = photoLib.PHOTOS[1].id;""",
"""// 内置图库的前三张，替代原photoLib.PHOTOS[0..1]
const FIRST_ID = bgPack.ids()[0];
const SECOND_ID = bgPack.ids()[1];"""))

# ── 2. defaults 字段断言 ────────────────────────────────────────────────
BLOCKS.append(("""  for (const k of ['styleKey', 'styleList', 'photos', 'builtinPhotos', 'photoMode', 'photoModeLabel',
    'bgPhotoId', 'bgAuthor', 'bgSource', 'localBg']) {
    assert.ok(k in d, '缺字段 ' + k);
  }
  assert.strictEqual(d.styleKey, 'literary');
  assert.strictEqual(d.photoMode, 'gray');
  assert.strictEqual(d.photoModeLabel, '灰度衬底');""",
"""  for (const k of ['styleKey', 'styleList', 'builtinPhotos', 'photoMode', 'photoModeLabel',
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
    + '（内置图没有服务端灰度，只有蒙版强度——不要承诺做不到的事）');"""))

# ── 3. initCardStyle 网络缩略图测试 → 反向守卫 ──────────────────────────
BLOCKS.append(("""t('initCardStyle 默认不铺网络缩略图（首屏零远程请求，/optimize）', () => {
  // 2026-10-06 /optimize：改前 init 就 listAll().slice(0,24) 铺满，
  // 未配 downloadFile 白名单时首屏直接发起 24 个 doomed 请求。
  // 改后折叠为默认态，photos 必须是空数组。
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.photos.length, 0,
    'init 不应预铺网络缩略图（实测 ' + p.data.photos.length + ' 张）');
  assert.strictEqual(p.data.netLibOpen, false, '网络图库区块应默认折叠');
  assert.strictEqual(p.data.netAvailable, null, '初始应为「未探测」，不是 false');
  // 内置兜底图不受影响 —— 这是「零网络出图」的根基
  assert.ok(p.data.builtinPhotos.length > 0, '内置兜底图必须照常提供');
  assert.strictEqual(p.data.bgSource, 'builtin', '默认来源必须是内置兜底');
});

t('展开网络图库才惰性探测并铺缩略图；探测失败回退内置', () => {
  const p = makePage();
  p.initCardStyle('literary');
  // 先给一个可控的探测结果
  let probeResult = 'ok';
  global.wx.getImageInfo = (o) => (probeResult === 'ok' ? o.success({}) : o.fail({}));

  p.onToggleNetLib();
  assert.strictEqual(p.data.netLibOpen, true, '点开应展开');
  assert.strictEqual(p.data.netAvailable, true, '探测成功应标记可用');
  assert.strictEqual(p.data.photos.length, mixin.PREVIEW_COUNT,
    '探测成功后才铺满 ' + mixin.PREVIEW_COUNT + ' 张缩略图');
  assert.ok(p.data.photos[0].url.indexOf('grayscale') >= 0, '默认应为灰度衬底');
  assert.ok(p.data.photos.length <= photoLib.PHOTOS.length);

  // 再来一页模拟探测失败：必须摘掉网络图并回退内置
  const q = makePage();
  q.initCardStyle('literary');
  probeResult = 'fail';
  q.onToggleNetLib();
  assert.strictEqual(q.data.netAvailable, false, '探测失败应标记不可用');
  assert.strictEqual(q.data.photos.length, 0, '不可用时不应渲染任何网络缩略图');
  assert.strictEqual(q.data.bgSource, 'builtin', '应回退到内置兜底');
  assert.strictEqual(q.data.bgPhotoId, mixin.FALLBACK_ID, '应回退到默认内置图');
});

t('initCardStyle 恢复持久化的风格与背景选择（网络图库来源）', () => {
  store[mixin.KEY] = { styleKey: 'poster', photoMode: 'blur', bgSource: 'lib', bgPhotoId: SECOND_ID };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.styleKey, 'poster');
  assert.strictEqual(p.data.photoMode, 'blur');
  assert.strictEqual(p.data.photoModeLabel, '虚化');
  assert.strictEqual(p.data.bgSource, 'lib', '网络图库来源未恢复');
  assert.strictEqual(p.data.bgPhotoId, SECOND_ID);
  assert.strictEqual(p.data.bgAuthor, photoLib.authorOf(SECOND_ID), '作者未回填');
  delete store[mixin.KEY];
});""",
"""t('initCardStyle 内置图照常铺满（零网络出图的根基）', () => {
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
  for (const k of ['require(\\'./photo_lib\\')', 'photoLib.', 'picsum.photos']) {
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
});"""))

# ── 4. 脏偏好净化测试（原用 lib 作脏值）────────────────────────────────
BLOCKS.append(("""t('initCardStyle 净化脏偏好：未知风格/未知图库 id/未知模式全部回落', () => {
  store[mixin.KEY] = { styleKey: 'haha', photoMode: 'sepia', bgSource: 'lib', bgPhotoId: '../../etc/passwd' };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.styleKey, 'literary', '未知风格未回落');
  assert.strictEqual(p.data.photoMode, 'gray', '未知模式未回落');
  assert.strictEqual(p.data.bgSource, 'builtin', '非法网络 id 应降级为内置兜底');
  assert.strictEqual(p.data.bgPhotoId, mixin.FALLBACK_ID, '应回落到默认内置图');
  delete store[mixin.KEY];
});""",
"""t('initCardStyle 净化脏偏好：未知风格/路径穿越 id/未知模式全部回落', () => {
  store[mixin.KEY] = { styleKey: 'haha', photoMode: 'sepia', bgSource: 'builtin', bgPhotoId: '../../etc/passwd' };
  const p = makePage();
  p.initCardStyle('literary');
  assert.strictEqual(p.data.styleKey, 'literary', '未知风格未回落');
  assert.strictEqual(p.data.photoMode, 'gray', '未知模式未回落');
  assert.strictEqual(p.data.bgSource, 'builtin');
  assert.strictEqual(p.data.bgPhotoId, mixin.FALLBACK_ID, '应回落到默认内置图');
  delete store[mixin.KEY];
});"""))

# ── 5. onPickPhoto 测试 → 内置图 id 校验（原已被下一条覆盖）────────────
BLOCKS.append(("""// ── ③ 背景选择与互斥（内置兜底 / 网络图库 / 相册）──────────────────────
t('onPickPhoto 选中的 id 必须真实存在，否则完全忽略', () => {
  const p = makePage();
  p.onPickPhoto(ev({ id: FIRST_ID }));
  assert.strictEqual(p.data.bgPhotoId, FIRST_ID);
  assert.strictEqual(p.data.bgSource, 'lib');
  assert.strictEqual(p.data.bgAuthor, photoLib.authorOf(FIRST_ID));

  const p2 = makePage();
  const before = p2.data.bgPhotoId;
  p2.onPickPhoto(ev({ id: 'javascript:alert(1)' }));
  assert.strictEqual(p2.data.bgPhotoId, before, '非法 id 未被拦下，状态被改动了');
  assert.strictEqual(p2.data.bgSource, 'builtin', '非法 id 不得切到网络来源');
});

t('onPickBuiltinBg 只接受内置库内的 id（防 dataset 注入任意路径）', () => {""",
"""// ── ③ 背景选择与互斥（内置 / 相册）────────────────────────────────────
t('onPickBuiltinBg 只接受内置库内的 id（防 dataset 注入任意路径）', () => {"""))

# ── 6. 内置图蒙版测试的措辞 ────────────────────────────────────────────
BLOCKS.append(("""t('内置图随处理方式切换引擎蒙版强度（本地无服务端做灰度/虚化）', () => {
  const p = freshPage();
  p.initCardStyle('literary');
  const g = mixin.applyCardStyle(p, {}).bgVeil;
  p.onCyclePhotoMode();                       // gray → blur
  const b = mixin.applyCardStyle(p, {}).bgVeil;
  p.onCyclePhotoMode();                       // blur → raw
  const r = mixin.applyCardStyle(p, {}).bgVeil;
  assert.deepStrictEqual([g, b, r], [mixin.BUILTIN_VEIL.gray, mixin.BUILTIN_VEIL.blur, mixin.BUILTIN_VEIL.raw]);
  assert.ok(g[0] > b[0] && b[0] > r[0], 'gray 蒙版必须最厚（保白字可读）');
});""",
"""t('内置图随衬底档位切换引擎蒙版强度（内置图无服务端，靠蒙版近似）', () => {
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
});"""))

# ── 7. 网络图挂兜底 → 相册图挂兜底 ─────────────────────────────────────
BLOCKS.append(("""t('网络图挂内置兜底，失败可回落（白名单没配也不白卡）', () => {
  const p = freshPage();
  p.initCardStyle('literary');
  p.onPickPhoto(ev({ id: FIRST_ID }));
  const d = mixin.applyCardStyle(p, {});
  assert.ok(String(d.bgImg).indexOf('picsum.photos') >= 0, '应使用网络图');
  assert.strictEqual(d.bgFallback, bgPack.pathOf(mixin.FALLBACK_ID), '网络图必须挂内置兜底');
  assert.ok(d.bgVeil === undefined, '网络图由服务端做灰度/虚化，不该叠内置图 veil');
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
});""",
"""t('相册图挂内置兜底：原图被用户删掉后仍能出带背景的卡', () => {
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
});"""))

# ── 8. 三档循环测试（原依赖网络缩略图 URL）─────────────────────────────
BLOCKS.append(("""// ── ④ 处理方式循环 ──────────────────────────────────────────────────────
t('处理方式灰度→虚化→原图循环，缩略图 URL 随之变化', () => {
  const p = makePage();
  p.initCardStyle('literary');
  // /optimize 后缩略图默认不铺，需先展开图库（探测成功）才有清单可比
  global.wx.getImageInfo = (o) => o.success({});
  p.onToggleNetLib();
  assert.ok(p.data.photos.length > 0, '展开图库后应铺出缩略图');
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
  // /optimize：先展开图库，否则循环不会重算 URL（未展开时保持空数组是对的）
  global.wx.getImageInfo = (o) => o.success({});
  p.onToggleNetLib();
  p.onCyclePhotoMode();
  assert.strictEqual(p.data.photoMode, 'blur');
  assert.ok(p.data.photos.length > 1);
  assert.ok(p.data.photos.every(x => x.url.indexOf('blur=') >= 0), '清单未随模式整体刷新');
  // 图库 id 不变，只是URL 的处理参数变了
  assert.deepStrictEqual(p.data.photos.map(x => x.id),
    photoLib.listAll({ mode: 'blur' }).slice(0, mixin.PREVIEW_COUNT).map(x => x.id));
});""",
"""// ── ④ 衬底档位循环 ──────────────────────────────────────────────────────
t('衬底深→中→淡循环，第4 次绕回与首次完全一致', () => {
  const p = makePage();
  p.initCardStyle('literary');
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
  const p = makePage();
  p.initCardStyle('literary');
  p.onCyclePhotoMode();
  assert.strictEqual(store[mixin.KEY].photoMode, 'blur', '衬底档位未持久化');
  delete store[mixin.KEY];
});"""))

# ── 9. onShufflePhoto 去掉网络环 ────────────────────────────────────────
BLOCKS.append(("""t('onShufflePhoto 在当前来源内循环取下一张（内置/网络各自成环）', () => {
  // 内置环
  const p = freshPage();
  const bids = bgPack.ids();
  p.setData({ bgSource: 'builtin', bgPhotoId: bids[0] });
  p.onShufflePhoto();
  assert.strictEqual(p.data.bgPhotoId, bids[1]);
  assert.strictEqual(p.data.bgSource, 'builtin', '换一张不得跨来源');
  p.setData({ bgPhotoId: bids[bids.length - 1] });
  p.onShufflePhoto();
  assert.strictEqual(p.data.bgPhotoId, bids[0], '内置环未绕回');

  // 网络环
  const p2 = makePage();
  const ids = photoLib.PHOTOS.map(x => x.id);
  p2.setData({ bgSource: 'lib', bgPhotoId: ids[0] });
  p2.onShufflePhoto();
  assert.strictEqual(p2.data.bgPhotoId, ids[1]);
  assert.strictEqual(p2.data.bgSource, 'lib');
  p2.setData({ bgPhotoId: ids[ids.length - 1] });
  p2.onShufflePhoto();
  assert.strictEqual(p2.data.bgPhotoId, ids[0], '网络环未绕回');
});""",
"""t('onShufflePhoto 在内置库内循环取下一张', () => {
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
});"""))

# ── 10. applyCardStyle 优先级 ───────────────────────────────────────────
BLOCKS.append(("""t('applyCardStyle 背景优先级：相册图 > 网络图库 > 内置兜底 > 无', () => {
  const p = makePage();
  // 内置（默认来源）
  p.setData({ bgSource: 'builtin', bgPhotoId: bgPack.ids()[0] });
  const withBuiltin = mixin.applyCardStyle(p, { body: 'x' });
  assert.ok(String(withBuiltin.bgImg).indexOf('/images/bg/') === 0, '未使用内置兜底图');

  // 网络图库
  p.setData({ bgSource: 'lib', bgPhotoId: FIRST_ID, photoMode: 'gray' });
  const withLib = mixin.applyCardStyle(p, { body: 'x' });
  assert.ok(withLib.bgImg.indexOf(photoLib.urlOf(FIRST_ID, { mode: 'gray' })) >= 0,
    '未使用图库 URL');

  // 相册图优先于两者
  p.setData({ localBg: 'wxfile://tmp/pic.jpg' });
  const withAlbum = mixin.applyCardStyle(p, { body: 'x' });
  assert.strictEqual(withAlbum.bgImg, 'wxfile://tmp/pic.jpg', '相册图未优先于图库图');

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
});

t('applyCardStyle 网络来源 id 失效时降级为内置图而非坏URL', () => {
  const p = makePage();
  p.setData({ bgSource: 'lib', bgPhotoId: 'deadbeef' });
  const d = mixin.applyCardStyle(p, {});
  assert.strictEqual(d.bgImg, bgPack.pathOf(mixin.FALLBACK_ID), '未降级为内置图');
  assert.ok(d.bgFallback === undefined, '已降级为内置图，不该再挂兜底');
});""",
"""t('applyCardStyle 背景优先级：相册图 > 内置图 > 无', () => {
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
});"""))

# ── 11. repaint 守卫注释里的历史引用 ────────────────────────────────────
BLOCKS.append(("""  // ⚠️ 切片必须**只取 repaint 函数体**，不能从 'function repaint' 一直切到文件尾。
  // 2026-10-06 踩过：/optimize 新增的 _setNetAvail 里有
  // `rendered: ok ? this.data.rendered : false`（合法的状态回填），
  // 被「切到文件尾」的旧写法一并捕获，误报 repaint 依赖 data.rendered。
  // 改为匹配到下一个顶层 `function ` 为止。""",
"""  // ⚠️ 切片必须**只取 repaint 函数体**，不能从 'function repaint' 一直切到文件尾。
  // 2026-10-06 踩过：当时新增的 _setNetAvail 里有
  // `rendered: ok ? this.data.rendered : false`（合法的状态回填），
  // 被「切到文件尾」的旧写法一并捕获，误报 repaint 依赖 data.rendered。
  // （_setNetAvail 随网络图库整层删除，但这个坑的教训留着：切片必须精确。）"""))

# ── 12. normalizeMode 断言补齐新标签 ───────────────────────────────────
BLOCKS.append(("""t('normalizeMode 对未知模式一律回落灰度', () => {
  assert.strictEqual(mixin.normalizeMode('blur'), 'blur');
  assert.strictEqual(mixin.normalizeMode('raw'), 'raw');
  assert.strictEqual(mixin.normalizeMode(''), 'gray');
  assert.strictEqual(mixin.normalizeMode(null), 'gray');
  assert.strictEqual(mixin.normalizeMode('GRAY'), 'gray');
});""",
"""t('normalizeMode 对未知模式一律回落深衬底', () => {
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
});"""))


def main():
    src = io.open(PATH, encoding='utf-8').read()
    ok = 0
    for i, (old, new) in enumerate(BLOCKS, 1):
        n = src.count(old)
        if n != 1:
            print('[FAIL] 块 #%d 命中 %d 次（应为 1）锚点: %s' % (i, n, old.split(chr(10))[0][:60]))
            return 1
        src = src.replace(old, new)
        ok += 1
    io.open(PATH, 'w', encoding='utf-8').write(src)
    print('[OK] %d 个块全部唯一命中并替换' % ok)

    left = [k for k in ['photoLib', 'photo_lib', 'PREVIEW_COUNT', 'onPickPhoto',
                        'onToggleNetLib', '_setNetAvail', '灰度衬底', "'lib'"]
            if k in src]
    # 'lib' 只应出现在迁移测试与normalizeSource 注释里
    real_left = [k for k in left if k != "'lib'"]
    print('残留: %s' % (real_left if real_left else '无'))
    if real_left:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
