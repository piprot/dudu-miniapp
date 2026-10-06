// test/test_region_data.js —— 省市静态数据 + 城市记忆守卫
// 纯数据模块无 wx 依赖，可直接 require；region_store 需要注入 wx storage stub。
const path = require('path');
const assert = require('assert');

const region = require(path.join(__dirname, '..', 'utils', 'region_data.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}

// ---------- 数据结构 ----------
t('31 个省级行政区（不含港澳台），数量与名称不重复', () => {
  assert.strictEqual(region.PROVINCES.length, 31, '省级数量应为 31，实际 ' + region.PROVINCES.length);
  const names = region.PROVINCES.map(p => p.name);
  assert.strictEqual(new Set(names).size, names.length, '存在重名省级');
  // 个人主体涉及港澳台另有表述要求，本工具明确不收录，防止日后误加
  for (const ex of ['香港', '澳门', '台湾']) {
    assert.ok(names.indexOf(ex) < 0, ex + ' 不应收录在本工具的省市表里');
  }
});

t('4 个直辖市均标记正确', () => {
  assert.strictEqual(region.MUNICIPALITIES.length, 4);
  for (const m of ['北京', '天津', '上海', '重庆']) {
    assert.ok(region.isMunicipality(m), m + ' 未被标记为直辖市');
    assert.ok(region.PROVINCE_NAMES.indexOf(m) >= 0, m + ' 不在省级列表中');
  }
  assert.ok(!region.isMunicipality('江苏'), '江苏不应是直辖市');
});

t('每个省都有非空市级列表，且省内不重名', () => {
  for (const p of region.PROVINCES) {
    assert.ok(Array.isArray(p.cities) && p.cities.length > 0, p.name + ' 市级列表为空');
    assert.strictEqual(new Set(p.cities).size, p.cities.length, p.name + ' 市内有重名: ' + p.cities.join('/'));
  }
});

t('统计口径自洽（省/市总数）', () => {
  const s = region.stats();
  assert.strictEqual(s.provinces, region.PROVINCES.length);
  assert.strictEqual(s.cities, region.PROVINCES.reduce((n, p) => n + p.cities.length, 0));
  assert.ok(s.cities > 300, '市级条目过少（' + s.cities + '），覆盖面可能不足');
});

t('citiesOf 返回副本，外部改动不污染源数据', () => {
  const a = region.citiesOf('江苏');
  a.push('__tamper__');
  const b = region.citiesOf('江苏');
  assert.ok(b.indexOf('__tamper__') < 0, 'citiesOf 泄漏了内部数组引用');
});

t('citiesOf 对未知省名安全回退，不返回空数组', () => {
  const r = region.citiesOf('不存在省');
  assert.ok(Array.isArray(r) && r.length > 0, '未知省应回退到默认列表而非空数组');
});

t('isValid 精确到「省+市」配对，防跨省脏配', () => {
  assert.ok(region.isValid('江苏', '南京'), '江苏/南京 应合法');
  assert.ok(!region.isValid('江苏', '北京'), '跨省配对（江苏/北京）应判非法');
  assert.ok(!region.isValid('不存在省', '南京'), '未知省应判非法');
  assert.ok(!region.isValid('江苏', ''), '空市名应判非法');
  assert.ok(!region.isValid('江苏', null), 'null 市名应判非法');
  assert.ok(!region.isValid('江苏', '南京 '), '尾部空格应判非法');
});

t('hasCity 可跨省检索', () => {
  assert.ok(region.hasCity('南京'), '南京应在库中');
  assert.ok(region.hasCity('浦东新区'), '上海浦东新区应在库中');
  assert.ok(!region.hasCity('不存在市'), '不存在市不应命中');
});

t('fullName 拼接成「省+市」，缺任一半时不产出裸名', () => {
  assert.strictEqual(region.fullName('江苏', '南京'), '江苏南京');
  assert.strictEqual(region.fullName('上海', '浦东新区'), '上海浦东新区');
  assert.strictEqual(region.fullName('北京', ''), '北京', '缺市名应只返回省');
  assert.strictEqual(region.fullName('', '南京'), '', '缺省名不应拼出裸市名');
  assert.strictEqual(region.fullName('', ''), '');
});

// ---------- 数据纯净度（用户可见文案，不能有脏字符） ----------
t('省市名称无乱码/空串/首尾空格', () => {
  for (const p of region.PROVINCES) {
    assert.ok(!/�/.test(p.name), '省级含乱码: ' + p.name);
    assert.strictEqual(p.name, p.name.trim(), '省级名称首尾有空格: ' + p.name);
    for (const c of p.cities) {
      assert.ok(!/�/.test(c), p.name + ' 市级含乱码: ' + c);
      assert.ok(c.length > 0, p.name + ' 存在空市级名');
      assert.strictEqual(c, c.trim(), p.name + ' 市级名称首尾有空格: ' + c);
    }
  }
});

t('直辖市市级列表为「区」而非重复市名', () => {
  // 直辖市第二级展示区名，若混入「北京」这类重复项会导致 picker 里出现同名项
  for (const m of region.MUNICIPALITIES) {
    const cities = region.citiesOf(m);
    assert.ok(cities.every(c => c.indexOf(m) < 0), m + ' 的市级列表含重复省级名: ' + cities.join('/'));
  }
});

t('shortName 去掉行政后缀，供窄空间标题用', () => {
  assert.strictEqual(region.shortName('江苏', '南京'), '江苏南京');
  assert.strictEqual(region.shortName('广西', '南宁'), '广西南宁', '自治区后缀应剥掉');
  assert.strictEqual(region.shortName('内蒙古', '呼和浩特'), '内蒙古呼和浩特');
  assert.strictEqual(region.shortName('北京', '朝阳区'), '北京朝阳区', '直辖市不重复加「市」');
  // 关键：不能出现「市市」「市省」这类后缀叠加
  for (const p of region.PROVINCES) {
    for (const c of p.cities) {
      const s = region.shortName(p.name, c);
      assert.ok(s.indexOf('市市') < 0 && s.indexOf('省市') < 0 && s.indexOf('省省') < 0,
        '短标签出现后缀叠加: ' + p.name + '/' + c + ' → ' + s);
      assert.ok(!/�/.test(s), '短标签含乱码: ' + s);
    }
  }
});

t('shortName/fullName 缺参时均不产出脏标签', () => {
  assert.strictEqual(region.shortName('', '南京'), '南京', '缺省名只返回市名');
  assert.strictEqual(region.shortName('江苏', ''), '江苏', '缺市名只返回省名');
  assert.strictEqual(region.shortName('', ''), '');
  assert.strictEqual(region.fullName('', ''), '');
});

// ---------- region_store（注入 wx storage stub） ----------
function withWx(fn) {
  const mem = {};
  global.wx = {
    getStorageSync: k => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
    removeStorageSync: k => { delete mem[k]; }
  };
  try { fn(); } finally { delete global.wx; }
}

t('store：setCity 落盘、getCity 读回一致', () => {
  withWx(() => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'region_store.js'))];
    const store = require(path.join(__dirname, '..', 'utils', 'region_store.js'));
    assert.strictEqual(store.getCity(), null, '初始应为空');
    assert.strictEqual(store.setCity('江苏', '南京'), true);
    const got = store.getCity();
    assert.deepStrictEqual(got, { province: '江苏', city: '南京' });
  });
});

t('store：拒绝非法城市写入（不污染 storage）', () => {
  withWx(() => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'region_store.js'))];
    const store = require(path.join(__dirname, '..', 'utils', 'region_store.js'));
    assert.strictEqual(store.setCity('江苏', '北京'), false, '跨省配对应被拒');
    assert.strictEqual(store.setCity('不存在省', '南京'), false, '未知省应被拒');
    assert.strictEqual(store.getCity(), null, '被拒后不应留下数据');
  });
});

t('store：最近使用去重 + LRU 上限 6', () => {
  withWx(() => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'region_store.js'))];
    const store = require(path.join(__dirname, '..', 'utils', 'region_store.js'));
    const seq = ['南京', '苏州', '无锡', '常州', '南通', '扬州', '镇江', '徐州'];
    for (const c of seq) store.setCity('江苏', c);
    const recent = store.getRecent();
    assert.ok(recent.length <= store.MAX_RECENT, '最近使用超上限: ' + recent.length);
    assert.ok(recent.length >= 6, '最近使用条数偏少: ' + recent.length);
    assert.strictEqual(new Set(recent.map(x => x.city)).size, recent.length, '最近使用有重复项');
    // LRU：最后选的应在最前
    assert.strictEqual(recent[0].city, '徐州', 'LRU 顺序不对，首项应为最后选择的');
    // 超出上限的旧项应被淘汰
    assert.ok(recent.every(x => x.city !== '南京'), '最早的南京应已被淘汰');
  });
});

t('store：重复选同一城市只推进位置不重复入列', () => {
  withWx(() => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'region_store.js'))];
    const store = require(path.join(__dirname, '..', 'utils', 'region_store.js'));
    store.setCity('上海', '浦东新区');
    store.setCity('江苏', '南京');
    store.setCity('上海', '浦东新区');
    const recent = store.getRecent();
    assert.strictEqual(recent[0].city, '浦东新区', '重复选择应提到最前');
    assert.strictEqual(recent.length, 2, '重复选择不应增加条数，实际 ' + recent.length);
  });
});

t('store：脏数据自动过滤，不让 picker 索引错位', () => {
  withWx(() => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'region_store.js'))];
    const store = require(path.join(__dirname, '..', 'utils', 'region_store.js'));
    // 模拟旧版本残留 / 手工改 storage
    store.setCity('江苏', '南京');
    store.pushRecent('不存在省', '火星市');
    store.pushRecent('江苏', '不存在的市');
    assert.strictEqual(store.getCity().city, '南京', '脏数据不应污染当前选择');
    assert.ok(store.getRecent().every(x => region.isValid(x.province, x.city)), '脏数据未被过滤');
  });
});

t('store：最近使用每项都带唯一 key（供 wx:key）', () => {
  withWx(() => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'region_store.js'))];
    const store = require(path.join(__dirname, '..', 'utils', 'region_store.js'));
    store.setCity('江苏', '南京');
    store.setCity('山东', '南京');   // 同名市，观察是否被合并
    const recent = store.getRecent();
    assert.ok(recent.every(x => typeof x.key === 'string' && x.key.indexOf('/') > 0),
      '存在缺失 key 的项');
    assert.strictEqual(new Set(recent.map(x => x.key)).size, recent.length, 'key 有重复');
  });
});

t('store：clearCity 只清当前选择，保留最近使用', () => {
  withWx(() => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'region_store.js'))];
    const store = require(path.join(__dirname, '..', 'utils', 'region_store.js'));
    store.setCity('江苏', '南京');
    store.clearCity();
    assert.strictEqual(store.getCity(), null, '清除后仍应有选择');
    assert.ok(store.getRecent().length >= 1, '清除不应影响最近使用');
  });
});

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
if (fail > 0) process.exitCode = 1;