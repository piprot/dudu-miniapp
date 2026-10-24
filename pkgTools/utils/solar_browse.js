// utils/solar_browse.js
// ─────────────────────────────────────────────────────────────────────────
// 节气 / 节日浏览库（2026-10-06 重构 · 2026-10-24 重构为两级手风琴 · 纯本地静态库，零 AI）
//
// ── 2026-10-24 重构说明（用户反馈「24 节气显示不全，比如霜降就没有」）──
//
// 【旧结构的问题】
//   旧版把「节气 + 它的 N 条文案」**扁平化**成一行一文案的列表：
//     24 节气 × 5 条 = 120 行 → 扩到 15 条后变成 360 行。
//   再叠加两层限制，导致后面的节气**根本看不见**：
//     ① WXML 的 `wx:if="{{idx < item.limit}}"`（limit=48）把渲染硬截在 48 行
//        → 霜降排在第 85 行（立春1-15、雨水16-30…霜降第 18 个节气 = 第 256 行起），
//          永远进不了 DOM；点「查看全部」也无效，因为截断在 WXML 层，不受 show 影响。
//     ② 即使不截断，360 行平铺也让用户为了找「霜降」要滚 85 行。
//        扁平化把「节气」这个用户真正在找的层级给消灭了。
//
// 【新结构】
//   改成**两级手风琴**，节气的层级被保留下来：
//     第一级：分组（二十四节气 / 农历传统节日 / 西方节日）——3 个，默认收起
//     第二级：条目（立春 / 雨水 / … / 霜降 / … / 大寒）——**全部渲染，不截断**
//             24 个节气一屏内就能看完，霜降必然可见
//     第三级：文案（点某个节气 → 展开它的 15 条文案，每条可成卡）
//
//   这样「找霜降」是找第 18 个节气（一眼扫过 24 个名字），
//   而不是在 360 行文字里翻找。渲染量也从 360 行降到 24 行。
//
// 【为什么不用「窗口切片」】
//   试过「只渲染 offset..offset+limit 的窗口，翻页时移动窗口」，
//   但窗口移动会**跳过中段**——用户点「查看全部」时窗口跳到末尾 48 条，
//   中间 48..312 那 264 条从未被渲染过（霜降正好在这段里）。
//   验证脚本 tools_local/verify_solar_fix.js 实测复现了该问题，已废弃该方案。
//
// 纯函数模块：供 pages/solar/solar.js 的 buildGroups() 直接调用，
// 守卫测试也能直接 require 后断言结构，无需重复实现。
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const L = require('./calendar_mix');
const { SOLAR_TERMS } = require('./solar_terms');
const LINES_TERM = require('./lines_terms');
const LINES_LUNAR = require('./lines_lunar');
const LINES_WESTERN = require('./lines_western');

// 文案序号标签（每个条目最多 16 条，15 条足够，留 1 条余量）
const TAGS = ['其一', '其二', '其三', '其四', '其五', '其六', '其七', '其八',
  '其九', '其十', '其十一', '其十二', '其十三', '其十四', '其十五', '其十六'];

/**
 * 把一个来源列表（节气或节日）展开成「条目级」列表。
 *
 * 每个条目 = 一个节气/节日，里面带它的全部文案。
 * 不再把文案平铺到外层——那样会丢掉「节气」这一层级（用户找霜降找的正是它）。
 *
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
    items.push({
      // uid 只需在组内唯一：条目名本身唯一（24 个节气名不重名）
      uid: kind + '|' + name,
      name,
      date,
      kind,
      count: lines.length,
      // 文案挂在这个条目下，点开展开时才渲染
      texts: lines.map((text, i) => {
        const t = String(text || '').trim();
        return {
          idx: i,
          tag: TAGS[i] || ('其' + (i + 1)),
          text: t,
          preview: t.length > 18 ? t.slice(0, 18) + '…' : t
        };
      }),
      open: false
    });
  }
  return items;
}

/**
 * 构建 3 个分组，每组都是条目级（节气/节日）列表。
 * 返回：[{ key, name, icon, desc, open, items:[...] }, ...]
 *
 * ⚠️ items 是**全量**条目（节气组 24 个 / 农历 21 个 / 西方 26 个），
 *    一条都不截断——霜降等靠后的节气必须直接可见。
 */
function buildGroups() {
  // ① 二十四节气：名称/日期来自 solar_terms，文案来自 lines_terms（每节 15 条）
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

  // ③ 西方/公历节日：26 个固定公历日期，文案来自 lines_western（每节 15 条）
  const westernItems = expand(
    L.WESTERN_FESTIVALS,
    f => f.m + '/' + f.d,
    LINES_WESTERN,
    'western'
  );

  return [
    { key: 'term', name: '二十四节气', icon: '🌾', desc: '东方节气 · 物候与时令', open: false, items: termItems },
    { key: 'lunar', name: '农历传统节日', icon: '🏮', desc: '按真实农历日期推算', open: false, items: lunarItems },
    { key: 'western', name: '西方节日', icon: '🎄', desc: '公历固定日期', open: false, items: westernItems }
  ];
}

/**
 * 统计某个分组的文案总条数（用于分组头显示「N 条文案」）。
 */
function totalTexts(group) {
  return (group.items || []).reduce((n, it) => n + ((it.texts && it.texts.length) || 0), 0);
}

module.exports = { buildGroups, expand, TAGS, totalTexts };
