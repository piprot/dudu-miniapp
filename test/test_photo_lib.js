// test/test_photo_lib.js —— 背景图库清单守卫
// 关键考量：photoId 来自 wxml 的 data-id（外部可控），必须验证 has/urlOf 对
//   未知 id 返回空串而不是拼出任意 URL；同时验证 URL 构造与作者溯源完整。
const path = require('path');
const assert = require('assert');
const lib = require(path.join(__dirname, '..', 'utils', 'photo_lib.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}

t('清单非空且规模够用（≥24 张供横向滚动）', () => {
  assert.ok(lib.PHOTOS.length >= 24, '图库过少: ' + lib.PHOTOS.length);
  const s = lib.stats();
  assert.strictEqual(s.total, lib.PHOTOS.length);
  assert.strictEqual(s.w, 750, '背景宽应为 750');
  assert.ok(s.h > s.w, '卡片为竖版，高应大于宽，实际 ' + s.h);
});

t('图 id 唯一、不重复', () => {
  const ids = lib.PHOTOS.map(p => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, '存在重复 id');
});

t('每张都有作者与来源（版权溯源，缺一不可）', () => {
  for (const p of lib.PHOTOS) {
    assert.ok(p.author && p.author.length > 0, 'id=' + p.id + ' 缺作者');
    assert.ok(p.source && p.source.indexOf('unsplash.com') >= 0,
      'id=' + p.id + ' 来源非 Unsplash: ' + p.source);
  }
});

t('urlOf 构造正确，默认灰度', () => {
  const id = lib.PHOTOS[0].id;
  assert.strictEqual(lib.urlOf(id), 'https://picsum.photos/id/' + id + '/750/1000?grayscale');
});

t('urlOf 三种模式对应正确 query', () => {
  const id = lib.PHOTOS[1].id;
  assert.ok(lib.urlOf(id, { mode: 'gray' }).indexOf('?grayscale') > 0, 'gray 应带 grayscale');
  assert.ok(lib.urlOf(id, { mode: 'blur' }).indexOf('?blur=') > 0, 'blur 应带 blur');
  assert.strictEqual(lib.urlOf(id, { mode: 'raw' }).indexOf('?'), -1, 'raw 不应带 query');
});

t('urlOf 全库唯一（不同图不会拼出同一 URL）', () => {
  const urls = lib.PHOTOS.map(p => lib.urlOf(p.id));
  assert.strictEqual(new Set(urls).size, urls.length, '存在重复 URL');
});

t('未知 id 返回空串而非拼出任意 URL（防注入）', () => {
  // photoId 来自 dataset，是外部可控输入；拼进 URL 前必须挡住
  assert.strictEqual(lib.urlOf('999999'), '');
  assert.strictEqual(lib.urlOf(''), '');
  assert.strictEqual(lib.urlOf('../admin'), '');
  assert.strictEqual(lib.urlOf('0/../../evil'), '');
  assert.strictEqual(lib.urlOf(undefined), '');
  assert.ok(lib.has('999999') === false, 'has 应判false');
});

t('authorOf / sourceOf 未知 id 返回空串', () => {
  assert.strictEqual(lib.authorOf('999999'), '');
  assert.strictEqual(lib.sourceOf('999999'), '');
  assert.ok(lib.authorOf(lib.PHOTOS[0].id).length > 0, '合法 id 应能查到作者');
});

t('listAll 输出含 id/author/url，且 url 与 urlOf 一致', () => {
  const all = lib.listAll({ mode: 'gray' });
  assert.strictEqual(all.length, lib.PHOTOS.length);
  const first = all[0];
  assert.strictEqual(first.url, lib.urlOf(first.id, { mode: 'gray' }));
  assert.ok(first.author, 'listAll 项缺作者');
});

t('listAll 切模式时 URL 真的变（grayscale ≠ raw）', () => {
  const g = lib.listAll({ mode: 'gray' })[0].url;
  const r = lib.listAll({ mode: 'raw' })[0].url;
  assert.notStrictEqual(g, r, '两种模式 URL 相同，模式切换会失效');
});

t('数据纯净度：无空 id、无乱码', () => {
  for (const p of lib.PHOTOS) {
    assert.ok(p.id && String(p.id).length > 0, '存在空 id');
    assert.ok(!/�/.test(p.author), '作者含乱码: ' + p.author);
  }
});

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
if (fail > 0) process.exitCode = 1;