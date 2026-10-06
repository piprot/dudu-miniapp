// test/test_cat_picker.js —— 分层选择器（大类→小类+ 常用前置）
// 2026-10-06 · 回应用户「一次性把所有类目铺开，观感不好，要先大类再小类，常用的排前面」
//
//这个组件治的是「选项墙」：标签/类目一多，平铺会让用户找不到起点。
// 测试重点在三件事：① 常用区确实前置且能联动大类 ② 同时只展开一个大类 ③ 回调能驱动页面。
'use strict';
const assert = require('assert');
const catPicker = require('../utils/cat_picker_mixin.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + ((e && e.message) || e)); failed++; }
}

// 造一个假的 Page 对象：mixin 的方法只依赖 setData 与 this.data
function makePage() {
  const page = {
    data: {},
    changed: null,
    setData(patch) { Object.assign(this.data, patch); this.changed = patch; }
  };
  return page;
}

const GROUPS = [
  { key: 'growth', name: '成长', items: [{ key: '__all__', name: '全部' }, { key: '耐心', name: '耐心' }] },
  { key: 'life', name: '人生', items: [{ key: '__all__', name: '全部' }, { key: '心境', name: '心境' }] },
  { key: 'work', name: '职场', items: [{ key: '__all__', name: '全部' }] }
];

// ── 数据结构 ──
t('常用区前置：只取 hotKeys 里的，且按 hotKeys 顺序', () => {
  const p = catPicker.build({ groups: GROUPS, hotKeys: ['life:__all__', 'growth:__all__'], activeGroup: 'growth' });
  assert.deepStrictEqual(p.data.pgHot.map(h => h.groupKey), ['life', 'growth'], '常用顺序应跟随 hotKeys');
});

t('常用项带 groupKey：点它要能联动切大类，否则小类区不同步', () => {
  const p = catPicker.build({ groups: GROUPS, hotKeys: ['work:__all__'], activeGroup: 'growth' });
  assert.strictEqual(p.data.pgHot[0].groupKey, 'work');
  assert.strictEqual(p.data.pgHot[0].key, '__all__');
});

t('hotKeys 指向不存在的大类/小类时要被丢弃，不得生成空壳 chip', () => {
  const p = catPicker.build({ groups: GROUPS, hotKeys: ['nope:__all__', 'growth:不存在的标签'], activeGroup: 'growth' });
  assert.strictEqual(p.data.pgHot.length, 0, '无效 hotKey 应被过滤掉');
});

t('大类带 hot 标记：有大类常用项的才打点，UI 才能提示「里面有你常用的」', () => {
  const p = catPicker.build({ groups: GROUPS, hotKeys: ['growth:__all__'], activeGroup: 'growth' });
  const g = p.data.pgGroups;
  assert.strictEqual(g.find(x => x.key === 'growth').hot, true);
  assert.strictEqual(g.find(x => x.key === 'life').hot, false);
});

t('小类区只展示当前大类下的项，绝不一次性全铺开（这是本次要治的病）', () => {
  const p = catPicker.build({ groups: GROUPS, activeGroup: 'growth', activeItem: '__all__' });
  assert.strictEqual(p.data.pgGroup, 'growth');
  assert.deepStrictEqual(p.data.pgItems.map(i => i.key), ['__all__', '耐心']);
  assert.ok(!p.data.pgItems.some(i => i.key === '心境'), '别的类下的小类不得出现');
});

t('默认展开第一个大类：省掉一次点击', () => {
  const p = catPicker.build({ groups: GROUPS, activeGroup: 'growth' });
  assert.strictEqual(p.data.pgGroupOpen, true);
});

// ── 交互：同时只展开一个大类 ──
t('切换大类时替换小类区，并落回该类第一项', () => {
  const page = makePage();
  Object.assign(page.data, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).data);
  Object.assign(page, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).methods);
  page.onPickGroup({ currentTarget: { dataset: { group: 'life' } } });
  assert.strictEqual(page.data.pgGroup, 'life');
  assert.deepStrictEqual(page.data.pgItems.map(i => i.key), ['__all__', '心境']);
  assert.strictEqual(page.data.pgItem, '__all__');
});

t('点同一个大类 = 收起/展开小类区（不能全铺开）', () => {
  const page = makePage();
  Object.assign(page.data, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).data);
  Object.assign(page, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).methods);
  page.onPickGroup({ currentTarget: { dataset: { group: 'growth' } } });
  assert.strictEqual(page.data.pgGroupOpen, false, '再点一次应收起');
  page.onPickGroup({ currentTarget: { dataset: { group: 'growth' } } });
  assert.strictEqual(page.data.pgGroupOpen, true, '第三次应重新展开');
});

t('选小类：只改 pgItem，且回调拿到该项', () => {
  const page = makePage();
  Object.assign(page.data, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).data);
  Object.assign(page, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).methods);
  let got = null;
  page._pickerOnChange = (it) => { got = it; };
  page.onPickGroupItem({ currentTarget: { dataset: { group: 'growth', item: '耐心' } } });
  assert.strictEqual(page.data.pgItem, '耐心');
  assert.strictEqual(got && got.key, '耐心');
});

t('点常用项：同时把大类切过去，小类区跟着联动', () => {
  const page = makePage();
  Object.assign(page.data, catPicker.build({ groups: GROUPS, hotKeys: ['work:__all__'], activeGroup: 'growth' }).data);
  Object.assign(page, catPicker.build({ groups: GROUPS, hotKeys: ['work:__all__'], activeGroup: 'growth' }).methods);
  let got = null;
  page._pickerOnChange = (it) => { got = it; };
  page.onPickHot({ currentTarget: { dataset: { group: 'work', item: '__all__' } } });
  assert.strictEqual(page.data.pgGroup, 'work', '大类应切到 work');
  assert.strictEqual(page.data.pgItem, '__all__');
  assert.strictEqual(page.data.pgGroupOpen, true);
  assert.strictEqual(got && got.key, '__all__');
});

// ── 反向同步 ──
t('syncPicker：别处改了选中值要能反向高亮，且大类不同才动大类', () => {
  const page = makePage();
  Object.assign(page.data, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).data);
  Object.assign(page, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).methods);
  // 同大类内改值：不该收起小类区
  page.syncPicker({ groupKey: 'growth', key: '耐心' });
  assert.strictEqual(page.data.pgItem, '耐心');
  assert.strictEqual(page.data.pgGroupOpen, true);
  assert.strictEqual(page.data.pgGroup, 'growth', '同大类不应切大类');
  // 跨大类：应切过去并展开
  page.syncPicker({ groupKey: 'life', key: '心境' });
  assert.strictEqual(page.data.pgGroup, 'life');
  assert.strictEqual(page.data.pgItem, '心境');
  assert.strictEqual(page.data.pgGroupOpen, true);
});

t('syncPicker 传 null / 缺 key 时不崩、不误改状态', () => {
  const page = makePage();
  Object.assign(page.data, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).data);
  Object.assign(page, catPicker.build({ groups: GROUPS, activeGroup: 'growth' }).methods);
  page.syncPicker(null);
  page.syncPicker({ groupKey: 'growth' });
  assert.strictEqual(page.data.pgGroup, 'growth');
  assert.strictEqual(page.data.pgItem, '__all__');
});

t('空 groups 也不崩（页面在 onLoad 前注入方法壳的场景）', () => {
  const p = catPicker.build({ groups: [] });
  assert.deepStrictEqual(p.data.pgGroups, []);
  assert.deepStrictEqual(p.data.pgItems, []);
  assert.strictEqual(p.data.pgGroup, '');
  assert.strictEqual(typeof p.methods.onPickGroup, 'function');
});

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
if (failed) process.exit(1);