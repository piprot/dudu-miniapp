// utils/solar_browse.js
// ─────────────────────────────────────────────────────────────────────────
// 节气 / 节日浏览库（2026-10-06 重构 · 纯本地静态库，零 AI）
//
// 用户需求：每个内置库「至少 100 条」。
//   24 节气（封闭集，固定 24）无法再扩数量，但每个节气可挂 5 条文案 → 120 条；
//   农历传统节日扩充到 20 个固定日期 + 除夕 → 21 × 5 = 105 条；
//   西方/公历节日扩充到 26 个 → 26 × 5 = 130 条。
//
// 设计：把「节气/节日 + 它的 N 条文案」扁平化为「文案级条目」——
//   一条文案 = 一个可点条目（uid 唯一，name 可重复），展开即看全文、可成卡。
//   分组头仍只有 3 个，默认收起（渐进披露），点开看到 100+ 条文案。
//
// 纯函数模块：供 pages/solar/solar.js 的 buildGroups() 直接调用，
// 守卫测试也能直接 require 后断言每组 ≥100 条，无需重复实现扁平化逻辑。
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const L = require('./calendar_mix');
const { SOLAR_TERMS } = require('./solar_terms');
const LINES_TERM = require('./lines_terms');
const LINES_LUNAR = require('./lines_lunar');
const LINES_WESTERN = require('./lines_western');

// 文案序号标签（最多 8 条，本库每组 5 条，足够）
const TAGS = ['其一', '其二', '其三', '其四', '其五', '其六', '其七', '其八'];

// 每组默认只渲染 48 条（数据仍是 100+ 条），点「展开更多」再看全部。
// 为什么：100+ 条一次性平铺，滚动成本太高；先给 48 条足够挑，想看全库再展开。
const DEFAULT_LIMIT = 48;

/**
 * 把一个来源列表（节气或节日）+ 它的 N 条文案，展开成 N 个文案级条目。
 * @param {Array} list        来源数组，元素含 name 字段
 * @param {Function} dateOf   取展示用日期标签，如 t => t.month + '/' + t.day
 * @param {Object} linesMap   名称 → 文案数组（lines_terms / lines_lunar / lines_western）
 * @param {string} kind       'term' | 'lunar' | 'western'（成卡与样式依赖它）
 */
function expand(list, dateOf, linesMap, kind) {
  const items = [];
  for (const x of list) {
    const name = x.name;
    const lines = linesMap[name] || [];
    const date = dateOf(x);
    lines.forEach((text, i) => {
      const uid = kind + '|' + name + '|' + i;
      const preview = text.length > 18 ? text.slice(0, 18) + '…' : text;
      items.push({
        uid,
        name,
        date,
        kind,
        tag: TAGS[i] || ('其' + (i + 1)),
        text,
        preview,
        open: false
      });
    });
  }
  return items;
}

/**
 * 构建 3 个分组，每组都是扁平后的文案级条目。
 * 返回：[{ key, name, icon, desc, open, items:[...] }, ...]
 */
function buildGroups() {
  // ① 二十四节气：名称/日期来自 solar_terms，文案来自 lines_terms（每节 5 条）
  const termItems = expand(
    SOLAR_TERMS,
    t => t.month + '/' + t.day,
    LINES_TERM,
    'term'
  );

  // ② 农历传统节日：20 个固定农历日期 + 除夕（腊月最后一天，无固定 m/d）
  const lunarBase = L.LUNAR_FESTIVALS.map(f => ({ name: f.name, m: f.m, d: f.d }));
  lunarBase.push({ name: '除夕', m: 0, d: 0 });
  const lunarItems = expand(
    lunarBase,
    f => (f.name === '除夕'
      ? '农历腊月最后一天'
      : '农历' + L.lunarMonthName(f.m, false) + L.lunarDayName(f.d)),
    LINES_LUNAR,
    'lunar'
  );

  // ③ 西方/公历节日：26 个固定公历日期，文案来自 lines_western（每节 5 条）
  const westernItems = expand(
    L.WESTERN_FESTIVALS,
    f => f.m + '/' + f.d,
    LINES_WESTERN,
    'western'
  );

  return [
    { key: 'term', name: '二十四节气', icon: '🌾', desc: '东方节气 · 物候与时令', open: false, items: termItems, limit: DEFAULT_LIMIT },
    { key: 'lunar', name: '农历传统节日', icon: '🏮', desc: '按真实农历日期推算', open: false, items: lunarItems, limit: DEFAULT_LIMIT },
    { key: 'western', name: '西方节日', icon: '🎄', desc: '公历固定日期', open: false, items: westernItems, limit: DEFAULT_LIMIT }
  ];
}

module.exports = { buildGroups, expand, TAGS, DEFAULT_LIMIT };
