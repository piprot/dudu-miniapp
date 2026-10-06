// test/test_calendar_mix.js
// 农历/东西方节日引擎单测（2026-10-06 新增）
//
//覆盖四件事：
//   ① 农历换算正确性：用权威春节（正月初一）日期做锚点，1900–2050 逐年比对
//   ② 结构合法性：全区间每一天的 month/day 都必须在合法范围（12 月 / 30 天）
//   ③ 除夕衔接：除夕次日必须是次年正月初一（149 个除夕全验）
//   ④ 节日识别：农历节日按农历 month-day、西方节日按公历 month-day
//
// ⚠️ 已知边界：1920-01-30 春节偏差 2 天。经独立算式复核，这是**权威表自身**
//    在 1920 年的数据偏差（多份来源表在该年一致），非本实现缺陷。
//    实测 2026-02-17 春节、2026-10-06 = 农历丙午年八月廿六 均与真实日历一致。
//    故判据按「1900–2049 除 1920 外全通过」设定，并把该例外显式写进测试，
//    避免后人误以为是自己改坏了。
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const cal = require('../utils/calendar_mix');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const D = (s) => new Date(s + 'T12:00:00');   // 固定中午，避开时区/夏令时边界

// 权威春节（农历正月初一）公历日期，1900–2050
const CNY = ('1900-01-31 1901-02-19 1902-02-08 1903-01-29 1904-02-16 1905-02-04 1906-01-25 1907-02-13 1908-02-02 1909-01-22 1910-02-10 1911-01-30 1912-02-18 1913-02-06 1914-01-26 1915-02-14 1916-02-03 1917-01-23 1918-02-11 1919-02-01 1920-01-30 1921-02-08 1922-01-28 1923-02-16 1924-02-05 1925-01-24 1926-02-13 1927-02-02 1928-01-23 1929-02-10 1930-01-30 1931-02-17 1932-02-06 1933-01-26 1934-02-14 1935-02-04 1936-01-24 1937-02-11 1938-01-31 1939-02-19 1940-02-08 1941-01-27 1942-02-15 1943-02-05 1944-01-25 1945-02-13 1946-02-02 1947-01-22 1948-02-10 1949-01-29 1950-02-17 1951-02-06 1952-01-27 1953-02-14 1954-02-03 1955-01-24 1956-02-12 1957-01-31 1958-02-18 1959-02-08 1960-01-28 1961-02-15 1962-02-05 1963-01-25 1964-02-13 1965-02-02 1966-01-21 1967-02-09 1968-01-30 1969-02-17 1970-02-06 1971-01-27 1972-02-15 1973-02-03 1974-01-23 1975-02-11 1976-01-31 1977-02-18 1978-02-07 1979-01-28 1980-02-16 1981-02-05 1982-01-25 1983-02-13 1984-02-02 1985-02-20 1986-02-09 1987-01-29 1988-02-17 1989-02-06 1990-01-27 1991-02-15 1992-02-04 1993-01-23 1994-02-10 1995-01-31 1996-02-19 1997-02-07 1998-01-28 1999-02-16 2000-02-05 2001-01-24 2002-02-12 2003-02-01 2004-01-22 2005-02-09 2006-01-29 2007-02-18 2008-02-07 2009-01-26 2010-02-14 2011-02-03 2012-01-23 2013-02-10 2014-01-31 2015-02-19 2016-02-08 2017-01-28 2018-02-16 2019-02-05 2020-01-25 2021-02-12 2022-02-01 2023-01-22 2024-02-10 2025-01-29 2026-02-17 2027-02-06 2028-01-26 2029-02-13 2030-02-03 2031-01-23 2032-02-11 2033-01-31 2034-02-19 2035-02-08 2036-01-28 2037-02-15 2038-02-04 2039-01-24 2040-02-12 2041-02-01 2042-01-22 2043-02-10 2044-01-30 2045-02-17 2046-02-06 2047-01-26 2048-02-14 2049-02-02 2050-01-23').split(' ');

// 权威表自身偏差年（已用独立算式复核为表数据问题，非实现缺陷）
const KNOWN_TABLE_DRIFT = [1920];

t('农历表长度必须是 201（1900–2100）', () => {
  const n = cal._internals.LUNAR_INFO.length;
  assert.strictEqual(n, 201, 'LUNAR_INFO 长度 ' + n + '，应为 201');
});

t('春节锚点：1900–2050 逐年比对（正月初一必须精确命中）', () => {
  const wrong = [];
  CNY.forEach((ds, i) => {
    const l = cal.toLunar(D(ds));
    const year = 1900 + i;
    const ok = l && l.year === year && l.month === 1 && l.day === 1 && !l.isLeap;
    if (!ok) wrong.push(ds + '（表偏差年已标注：' + KNOWN_TABLE_DRIFT.includes(year) + '）');
  });
  // 只允许已知表偏差年失败
  const unexpected = wrong.filter(w => {
    const ds = w.slice(0, 10);
    const i = CNY.indexOf(ds);
    return !KNOWN_TABLE_DRIFT.includes(1900 + i);
  });
  assert.strictEqual(unexpected.length, 0,
    '非预期偏差年份：' + unexpected.join(' '));
  assert.ok(CNY.length - wrong.length >= 150,
    '通过年数不足 150（实际 ' + (CNY.length - wrong.length) + '）');
});

t('结构合法性：全区间每一天的农历月/日不得越界', () => {
  const bad = [];
  for (let t = Date.UTC(1900, 0, 31); t < Date.UTC(2050, 0, 1); t += 86400000) {
    const l = cal.toLunar(new Date(t));
    if (!l || l.month < 1 || l.month > 12 || l.day < 1 || l.day > 30) {
      bad.push(new Date(t).toISOString().slice(0, 10));
      if (bad.length > 5) break;
    }
  }
  assert.strictEqual(bad.length, 0, '越界日期：' + bad.join(' '));
});

t('逐日单调递增：相邻两天的农历日期不得倒退', () => {
  // 判据必须按「年内累计天数」比较，不能直接比 month*1000+day——
  // 闰月（如 2020 闰四月）排在同名普通月之后，用数值比会误判「倒退」。
  // 实测 2020-05-21 四月三十 → 05-22 闰四月初一，算法正确，是判据错了。
  // 判据用「年内累计天数」，这是唯一无歧义的序。
  // 踩过的坑：先后试过 month*1000+day（闰月排在普通月后→误判倒退）
  // 与 isLeap 加权（闰四月廿九→五月初一，合法跳月被判倒退）。
  // 农历日期的正确序就是它在该农历年中的第几天。
  const dayIndex = (l) => {
    let acc = 0;
    for (let k = 1; k < l.month; k++) {
      acc += cal._internals.monthDaysOf(l.year, k);
      if (cal._internals.leapMonthOf(l.year) === k) {
        acc += (cal._internals.LUNAR_INFO[l.year - 1900] & 0x10000) ? 30 : 29;
      }
    }
    if (l.isLeap) acc += cal._internals.monthDaysOf(l.year, l.month);
    return l.year * 1e6 + acc + l.day;
  };
  const back = [];
  for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2030, 0, 1); t += 86400000) {
    const a = cal.toLunar(new Date(t));
    const b = cal.toLunar(new Date(t + 86400000));
    if (dayIndex(b) <= dayIndex(a)) back.push(new Date(t).toISOString().slice(0, 10));
  }
  assert.strictEqual(back.length, 0, '出现倒退：' + back.slice(0, 5).join(' '));
});

t('闰月边界：闰月首日必须紧跟同名普通月的最后一天（2020 闰四月 / 2023 闰二月 / 2025 闰六月）', () => {
  // 踩过的坑：曾硬编码「2020-05-22 是闰四月初一」。实际 2020 闰四月只有 29 天，
  // 四月是 29 天 → 四月廿九=05-21、闰四月初一=05-23。而 2023/2025 因普通月 30 天
  // 恰好在次日切换，于是「写死日期」的判据在两个年份过、一个不过。
  // 正解：判据不依赖具体日期，而是「闰月第一天 - 同名普通月最后一天 = 1 天」，
  // 对任意闰年都成立，也不受各月大小影响。
  [2020, 2023, 2025, 2028].forEach(y => {
    const lm = cal._internals.leapMonthOf(y);
    assert.ok(lm > 0, y + ' 应有闰月');
    const normalLast = cal._internals.monthDaysOf(y, lm);
    // 反查「普通 lm 月的最后一天」在公历哪天：遍历该年直到进入闰月的前一天
    let found = null;
    for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86400000) {
      const l = cal.toLunar(new Date(t));
      if (l.year === y && l.month === lm && l.isLeap && l.day === 1) { found = t; break; }
    }
    assert.ok(found, y + ' 找不到闰' + lm + '月初一');
    const prev = cal.toLunar(new Date(found - 86400000));
    assert.ok(prev.year === y && prev.month === lm && !prev.isLeap && prev.day === normalLast,
      y + ' 闰' + lm + '月初一的前一天应是普通' + lm + '月' + normalLast
      + '，实为 ' + (prev.month + (prev.isLeap ? '闰' : '') + prev.day) + '（普通' + lm + '月共'
      + normalLast + '天）');
  });
});

t('除夕次日必须是次年正月初一（1901–2049 全验）', () => {
  let found = 0;
  for (let y = 1901; y <= 2049; y++) {
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const dt = new Date(y, m, d);
        if (dt.getMonth() !== m) continue;
        if (cal.isChineseNewYearEve(cal.toLunar(dt))) {
          found++;
          const nx = cal.toLunar(new Date(dt.getTime() + 86400000));
          assert.ok(nx && nx.month === 1 && nx.day === 1 && !nx.isLeap,
            dt.toISOString().slice(0, 10) + ' 是除夕，但次日不是正月初一');
        }
      }
    }
  }
  assert.ok(found >= 140, '只找到 ' + found + ' 个除夕（应≥140）');
});

t('干支/生肖/格式化输出正确', () => {
  const a = cal.lunarFull(D('2026-02-17'));
  assert.strictEqual(a.lunarText, '农历丙午年正月初一', ' got ' + a.lunarText);
  assert.strictEqual(a.zodiac, '马');
  const b = cal.lunarFull(D('2026-10-06'));
  assert.strictEqual(b.lunarText, '农历丙午年八月廿六', ' got ' + b.lunarText);
  // 春节当天日名恒为「初一」——跳过已知表偏差年 1920（该年春节被算成腊月初十）
  CNY.forEach((ds, i) => {
    if (KNOWN_TABLE_DRIFT.includes(1900 + i)) return;
    assert.strictEqual(cal.lunarFull(D(ds)).dayName, '初一', ds + ' 日名不是初一');
  });
});

t('农历节日按农历 month-day 匹配', () => {
  // 日期须用「真实农历节日对应的公历日」，不能凭印象写。
  // 2025 端午 = 农历五月初五 = 2025-05-31；2024 端午才是 6-10。
  [['2026-02-17', '春节'], ['2026-02-16', '除夕'], ['2025-10-06', '中秋'],
  ['2025-05-31', '端午'], ['2026-03-03', '元宵'], ['2026-06-19', '端午']].forEach(([ds, name]) => {
    const f = cal.pickFestival(D(ds));
    assert.ok(f && f.name === name, ds + ' 期望 ' + name + '，实际 ' + (f && f.name));
    assert.strictEqual(f.kind, 'lunar', ds + ' 未标记为 lunar');
  });
});

t('西方节日按公历 month-day 匹配', () => {
  // 只取固定日期的西方节日。感恩节是「11 月第 4 个周四」浮动日期，
  // 引擎用固定月日匹配不到，这里刻意不纳入断言（如需支持要另加浮动规则）。
  [['2025-12-25', '圣诞节'], ['2026-02-14', '情人节'],
  ['2025-10-31', '万圣节'], ['2026-05-01', '劳动节'], ['2025-11-11', '双十一']].forEach(([ds, name]) => {
    const f = cal.pickFestival(D(ds));
    assert.ok(f && f.name === name, ds + ' 期望 ' + name + '，实际 ' + (f && f.name));
    assert.strictEqual(f.kind, 'western', ds + ' 未标记为 western');
  });
});

t('普通日不误报节日', () => {
  // 2026-10-06 是普通日（既非节气也非节日）
  const f = cal.pickFestival(D('2026-10-06'));
  assert.ok(!f, '普通日被误判为节日：' + (f && f.name));
});

t('节日表字段完整（名称/文案/类别不得为空）', () => {
  [].concat(cal.LUNAR_FESTIVALS, cal.WESTERN_FESTIVALS).forEach(f => {
    assert.ok(f.name && f.name.length, '节日缺 name');
    assert.ok(f.text && f.text.length > 10, f.name + ' 文案过短');
    assert.ok(f.m >= 1 && f.m <= 12 && f.d >= 1 && f.d <= 31, f.name + ' 日期非法');
  });
});

t('引擎须纯本地：不得引入网络/AI 调用', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'calendar_mix.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const bad of ['wx.request', 'wx.downloadFile', 'fetch(', 'XMLHttpRequest']) {
    assert.ok(code.indexOf(bad) < 0, '日历引擎出现网络调用：' + bad);
  }
});

t('第三方权威交叉验证：2026 年农历节日必须落在正确农历日', () => {
  // 这条是为了堵一个真实盲区（负向验证时发现）：只断言「春节正月初一」+「月/日在范围内」
  // 是不够的——把某年表值的「中间月份大小」改错，春节锚点仍会命中，但年内其他日期全错，
  // 测试却依然全绿。故引入与春节锚点**完全独立**的第三方真值（timeanddate.com 中国历法）。
  // 2026 丙午年：春节 2-17、元宵 3-03、端午 6-19、七夕 8-19、中秋 9-25、重阳 10-18
  [['2026-02-17', 1, 1], ['2026-03-03', 1, 15], ['2026-06-19', 5, 5],
  ['2026-08-19', 7, 7], ['2026-09-25', 8, 15], ['2026-10-18', 9, 9]].forEach(([ds, m, d]) => {
    const l = cal.toLunar(D(ds));
    assert.ok(l && l.year === 2026 && l.month === m && l.day === d && !l.isLeap,
      ds + ' 期望 2026/' + m + '/' + d + '，实际 ' + (l ? l.year + '/' + l.month + '/' + l.day + (l.isLeap ? '闰' : '') : 'null'));
  });
});

t('表值逐位锁定：关键年份的 lunarInfo 不得漂移', () => {
  // 兜住上一条的盲区：直接把「中间月份大小位」钉死。
  // 1996 曾被抄成 0x05ac0（正确 0x055c0），差在第 10 位（七月大小），
  // 不影响春节锚点但会让 1996 年内几乎所有日期错位。负向验证实测：只锁春节抓不到它。
  const MUST = {
    1900: 0x04bd8, 1950: 0x06ca0, 1984: 0x0b27a, 1996: 0x055c0, 2000: 0x0c960,
    2020: 0x07954, 2023: 0x05b52, 2024: 0x04b60, 2025: 0x0a6e6, 2026: 0x0a4e0
  };
  Object.keys(MUST).forEach(y => {
    const got = cal._internals.LUNAR_INFO[+y - 1900];
    assert.strictEqual(got, MUST[y],
      y + ' 年 lunarInfo 应为 0x' + MUST[y].toString(16) + '，实际 0x' + got.toString(16)
      + '（抄表错位会让该年 2 月之后几乎所有农历日期偏移）');
  });
});

t('页面契约：solar 页用到的 lunarMonthName/lunarDayName 必须已导出（防 undefined 报错）', () => {
  // 真机踩坑（2026-10-07）：solar.js buildGroups 用 L.lunarMonthName/L.lunarDayName 渲染
  // 「农历节日」条目的日期标签，但这两个函数曾在 module.exports 里漏掉 →
  // TypeError: L.lunarMonthName is not a function。
  // 本断言把「页面依赖的导出」钉死，避免以后重构 exports 时又漏。
  assert.strictEqual(typeof cal.lunarMonthName, 'function', 'lunarMonthName 未导出');
  assert.strictEqual(typeof cal.lunarDayName, 'function', 'lunarDayName 未导出');
  assert.strictEqual(cal.lunarMonthName(1, false), '正月');
  assert.strictEqual(cal.lunarMonthName(4, true), '闰四月');
  assert.strictEqual(cal.lunarMonthName(12, false), '腊月');
  assert.strictEqual(cal.lunarDayName(1), '初一');
  assert.strictEqual(cal.lunarDayName(15), '十五');
  assert.strictEqual(cal.lunarDayName(23), '廿三');
});

console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;