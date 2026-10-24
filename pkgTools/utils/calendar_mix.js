// utils/calendar_mix.js
// ─────────────────────────────────────────────────────────────────────────
// 农历 + 东西方节日历法引擎（2026-10-06 新增）
//
// 解决的问题：原solar_terms.js 只有 24 节气（公历近似），用户要求
//   ① 阳历阴历自动识别 → 需要真实农历换算（不能只按公历硬编码）
//   ② 东西方节气都放进去 → 东方 24 节气 + 农历传统节日 + 西方公历节日
//
// 农历算法：1900–2100 标准 lunarInfo 表（每年用 1 个 16/20 位整数压缩闰月与大小月）。
//   位布局：第 0–3 位闰月月份（0=无闰月），第 4–15 位 12 个月的大小（1=大30天/0=小29天），
//   第 16 位闰月大小，最高位标记年份是否可用（超出表范围返回 null）。
//   已知 1900-01-31 为庚子年正月初一（春节），以此为锚点逐日推算。
//
// 合规：纯静态本地计算，零 AI、零网络（个人主体要求）。
//
// ⚠️ 精度边界：这是**民用农历**（1900–2100）。真太阳历/天文级节气（如精确到秒的
//    交节日���）不做，卡片文案场景不需要。文案用途足够。
// ─────────────────────────────────────────────────────────────────────────
'use strict';

// 农历信息表 1900–2100，每项一个整数。0=平年无闰月。
// 编码：低 4 位=闰月月份(0无)，接着 12 位=12 个月大小(1=30天)，第 16 位=闰月大小
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520 // 2100
];

// 农历月名（闰月前加「闰」）
const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
// 农历日名
const LUNAR_DAY_1 = ['初', '十', '廿', '卅'];
const LUNAR_DAY_2 = ['十', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

// 干支
const TIANGAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const DIZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

/** 某农历年的闰月月份，0=无闰月 */
function leapMonthOf(y) {
  return LUNAR_INFO[y - 1900] & 0xf;
}
/** 某农历年某月（1-12）的天数，闰月用 isLeap=true */
function leapDaysOf(y) {
  if (!leapMonthOf(y)) return 0;
  return (LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29;
}
/** 农历某年第 month（1-12，普通月）的总天数 */
function monthDaysOf(y, month) {
  return (LUNAR_INFO[y - 1900] & (0x10000 >> month)) ? 30 : 29;
}

/** 农历某年第 month（1-12）的总天数 */
function yearDaysOf(y) {
  let sum = 348;// 12 * 29
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0;
  return sum + leapDaysOf(y);
}

// 公历 1900-01-31（庚子年正月初一）距 1900-01-01 的天数
const BASE_YEAR = 1900, BASE_DATE = 31; // 1900-01-31

function toOrdinal(y, m, d) {
  // 该年之前所有完整年的天数 + 今年到该月的天数 + d-1；用 Date.UTC 避免时区干扰
  let ordinal = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return ordinal;
}

/** 公历 → 农历 {year, month, day, isLeap}，year 为农历年 */
function toLunar(date) {
  const gy = date.getFullYear(), gm = date.getMonth() + 1, gd = date.getDate();
  // 计算与 1900-01-31 的天数差
  let offset = Math.floor(Date.UTC(gy, gm - 1, gd) / 86400000) - Math.floor(Date.UTC(BASE_YEAR, 0, BASE_DATE) / 86400000);
  if (offset < 0) return null;
  let y = BASE_YEAR;
  let temp = 0;
  while (y < 2101) {
    temp = yearDaysOf(y);
    if (offset < temp) break;
    offset -= temp;
    y++;
  }
  if (y > 2100) return null;
  const leap = leapMonthOf(y);
  // ── 单次顺序走完，不做「循环上界」判断 ──
  // 逐月推进 + 上界判断的写法有两类越界坑（都已实测踩过）：
  //   ① 闰月借位（m === leap + 1）在闰 12 月会输出「13 月」
  //   ② 上界写 m < 12 会漏掉腊月；写 m > 12 早退则在闰年最后几天被判死
  // 本写法只向下累加、m 恒在 1..12，越界在数学上不可能发生。
  let m = 1, isLeap = false, rest = offset;
  for (let guard = 0; guard < 24; guard++) {   // 24 = 12 月 + 最多 1 个闰月，足够
    const dm = isLeap ? leapDaysOf(y) : monthDaysOf(y, m);
    if (rest < dm) break;                                // 命中本月
    rest -= dm;
    if (isLeap) { isLeap = false; m++; }                // 闰月走完 → 同数字普通月
    else if (leap === m) { isLeap = true; }              // 下一步进入闰 m 月
    else { m++; }
  }
  if (m > 12 || isLeap === undefined) return null;
  if (rest < 0 || rest >= 30) return null;
  return { year: y, month: m, day: rest + 1, isLeap };
}

/** 农历日 → 中文日名（初一/十五/廿三） */
function lunarDayName(d) {
  if (d === 10) return '初十';
  if (d === 20) return '二十';
  if (d === 30) return '三十';
  const tens = Math.floor(d / 10);
  const ones = d % 10;
  return LUNAR_DAY_1[tens === 0 ? 0 : tens] + LUNAR_DAY_2[ones];
}

/** 农历月 → 中文月名（正月/闰四月/腊月） */
function lunarMonthName(m, isLeap) {
  return (isLeap ? '闰' : '') + LUNAR_MONTHS[m - 1] + '月';
}

/** 干支年（以立春前后近似用农历年，1970=庚戌） */
function ganzhiYear(ly) {
  const idx = (ly - 1900 + 36) % 60;
  return TIANGAN[idx % 10] + DIZHI[idx % 12];
}
function zodiacOf(ly) {
  return ZODIAC[(ly - 4) % 12];
}

/** 完整格式化：2026-02-17 → {lunarText:'农历丙午年正月初一', ganzhi:'丙午', zodiac:'马'} */
function lunarFull(date) {
  const l = toLunar(date);
  if (!l) return null;
  return {
    ...l,
    ganzhi: ganzhiYear(l.year),
    zodiac: zodiacOf(l.year),
    monthName: lunarMonthName(l.month, l.isLeap),
    dayName: lunarDayName(l.day),
    lunarText: '农历' + ganzhiYear(l.year) + '年' + lunarMonthName(l.month, l.isLeap) + lunarDayName(l.day)
  };
}

// ── 传统农历节日（按农历 month-day 匹配）──
// kind: 'lunar'（农历）
const LUNAR_FESTIVALS = [
  { m: 1, d: 1, name: '春节' },
  { m: 1, d: 5, name: '破五' },
  { m: 1, d: 7, name: '人日' },
  { m: 1, d: 15, name: '元宵' },
  { m: 2, d: 2, name: '龙抬头' },
  { m: 2, d: 15, name: '花朝' },
  { m: 3, d: 3, name: '上巳' },
  { m: 4, d: 8, name: '浴佛' },
  { m: 5, d: 5, name: '端午' },
  { m: 6, d: 6, name: '天贶' },
  { m: 6, d: 24, name: '火把节' },
  { m: 7, d: 7, name: '七夕' },
  { m: 7, d: 15, name: '中元' },
  { m: 8, d: 15, name: '中秋' },
  { m: 9, d: 9, name: '重阳' },
  { m: 10, d: 1, name: '寒衣' },
  { m: 10, d: 15, name: '下元' },
  { m: 12, d: 8, name: '腊八' },
  { m: 12, d: 16, name: '尾牙' },
  { m: 12, d: 23, name: '小年' }
  // 除夕单独处理（腊月最后一天，日期不固定）
];

// ── 西方公历节日（按公历 month-day 匹配）──
const WESTERN_FESTIVALS = [
  { m: 1, d: 1, name: '元旦' },
  { m: 2, d: 14, name: '情人节' },
  { m: 3, d: 8, name: '妇女节' },
  { m: 3, d: 12, name: '植树节' },
  { m: 3, d: 15, name: '消费者权益日' },
  { m: 3, d: 22, name: '世界水日' },
  { m: 3, d: 23, name: '世界气象日' },
  { m: 4, d: 1, name: '愚人节' },
  { m: 4, d: 7, name: '世界卫生日' },
  { m: 4, d: 22, name: '世界地球日' },
  { m: 4, d: 23, name: '世界读书日' },
  { m: 5, d: 1, name: '劳动节' },
  { m: 5, d: 4, name: '青年节' },
  { m: 5, d: 12, name: '护士节' },
  { m: 5, d: 15, name: '国际家庭日' },
  { m: 5, d: 31, name: '世界无烟日' },
  { m: 6, d: 1, name: '儿童节' },
  { m: 6, d: 5, name: '世界环境日' },
  { m: 6, d: 26, name: '国际禁毒日' },
  { m: 9, d: 10, name: '教师节' },
  { m: 10, d: 1, name: '国庆节' },
  { m: 10, d: 31, name: '万圣节' },
  { m: 11, d: 8, name: '记者节' },
  { m: 11, d: 11, name: '双十一' },
  { m: 12, d: 24, name: '平安夜' },
  { m: 12, d: 25, name: '圣诞节' }
];

// ── 文案回填：从纯中文文案库取首条作为「今日节日」展示文案 ──
// 节日表只存农历/公历日期与名称；文案（每节 5 条）集中在 lines_* 库，
// 这里回填第一条，保证「今日应景」展示的是纯中文、已审校的文案。
const LINES_LUNAR = require('./lines_lunar');
const LINES_WESTERN = require('./lines_western');
LUNAR_FESTIVALS.forEach(f => { const l = LINES_LUNAR[f.name]; if (l && l[0]) f.text = l[0]; });
WESTERN_FESTIVALS.forEach(f => { const l = LINES_WESTERN[f.name]; if (l && l[0]) f.text = l[0]; });

/** 某天是否为除夕（腊月最后一天）——真实判断，不硬编码 */
function isChineseNewYearEve(lunar) {
  if (!lunar) return false;
  const leap = leapMonthOf(lunar.year);
  // 除夕 = 腊月最后一天（若闰月导致腊月有闰腊，需逐日判断）
  const lastMonth = 12;
  const days = monthDaysOf(lunar.year, lastMonth);
  return lunar.month === lastMonth && !lunar.isLeap && lunar.day === days;
}

/**
 * 今日节日识别（按优先级：农历节日 > 西方公历节日 > 普通日）
 * 返回 { name, text, kind } 或null
 */
function pickFestival(date) {
  const lunar = toLunar(date);
  if (lunar) {
    // 除夕优先（腊月最后一天）
    if (isChineseNewYearEve(lunar)) {
      return { name: '除夕', kind: 'lunar', text: '岁除更始，灯火可亲。除夕愿你团团圆圆，岁岁平安。' };
    }
    for (const f of LUNAR_FESTIVALS) {
      if (f.m === lunar.month && f.d === lunar.day && !lunar.isLeap) {
        return { name: f.name, kind: 'lunar', text: f.text };
      }
    }
  }
  const gm = date.getMonth() + 1, gd = date.getDate();
  for (const f of WESTERN_FESTIVALS) {
    if (f.m === gm && f.d === gd) {
      return { name: f.name, kind: 'western', text: f.text };
    }
  }
  return null;
}

module.exports = {
  toLunar, toLunarText: (d) => { const f = lunarFull(d); return f && f.lunarText; },
  lunarFull, pickFestival,
  // 顶层导出：solar 页 buildGroups 直接用来渲染「农历节日」条目的日期标签。
  // ⚠️ 之前漏导出这两个，导致真机报 `L.lunarMonthName is not a function`（2026-10-07 修复）。
  lunarMonthName, lunarDayName,
  LUNAR_FESTIVALS, WESTERN_FESTIVALS,
  isChineseNewYearEve,
  _internals: { LUNAR_INFO, leapMonthOf, monthDaysOf, yearDaysOf, ganzhiYear, zodiacOf }
};
