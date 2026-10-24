// utils/daily_rotate.js
// ─────────────────────────────────────────────────────────────────────────
// 「天天换」每日轮换引擎（2026-10-06 新增）
//
// 解决的问题：几个模板（天气心情卡 / 节气 / 金句 / 台词书摘）如果文案写死，
//   用户每天打开看到的是同一张卡，留存会塌。运营侧要求「一定要天天换」，
//   但本项目是纯本地零 AI 小程序（个人主体合规），不能靠生成，只能靠**静态库 + 轮换**。
//
// 设计要点（三条铁律）：
//   ① 同一天内必须稳定 —— 不能每次 onLoad 都换，否则用户保存的卡和预览对不上、
//      截图分享出去的内容也会飘。所以用「日期」做种子，而不是 Math.random()。
//   ② 跨天必须变 —— 种子带 dayIndex（一年中的第几天），天天不同。
//   ③ 同一天不同「频道」要能错开 —— 用 salt 区分（天气 / 节气 / 金句 / 台词），
//      否则四个模块会同时蹦出同一句话，看起来像复制粘贴。
//
// 全部为纯函数，不依赖 wx，可被 Node 直接 require 做单元测试。
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const MS_PER_DAY = 86400000;

// 一年中的第几天（0-based）：1月1日 = 0。用作「天天换」的日期种子。
function dayIndex(date) {
  const d = date ? new Date(date) : new Date();
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((today - startOfYear) / MS_PER_DAY);
}

// FNV-1a 32 位字符串哈希：把 salt 字符串稳定地变成一个整数。
function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s == null ? '' : s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// 稳定伪随机种子：同一天 + 同一 salt 恒定，跨天必变。
function seedOf(date, salt) {
  const di = dayIndex(date);
  // 乘一个大质数把 dayIndex 混进哈希空间，避免相邻日期落到相邻下标（否则天天「挨着」换）
  return (hashStr(salt) + Math.imul(di + 1, 2654435761)) >>> 0;
}

// 按种子取下标
function pickIndex(len, date, salt) {
  if (!len || len <= 0) return -1;
  return seedOf(date, salt) % len;
}

// 从静态库里取「今日一条」。返回元素本身（通常是 { text, ... } 或字符串）。
function pickDaily(list, date, salt) {
  if (!list || !list.length) return null;
  return list[pickIndex(list.length, date, salt)];
}

// 从静态库里取「今日 n 条互不重复」，顺序稳定。
// 两轮策略：先按 stride 跳跃取（打散，避免挨着取），取不满再顺序兜底
//（防 stride 与 len 不互质导致覆盖不全）。
function pickDailyMulti(list, date, salt, n) {
  if (!list || !list.length) return [];
  const len = list.length;
  const want = Math.max(1, Math.min(n || 1, len));
  const base = seedOf(date, salt);
  const used = {};
  const out = [];

  const stride = 1 + (base % Math.max(1, len - 1));
  for (let i = 0; i < len && out.length < want; i++) {
    const idx = (base + i * stride) % len;
    if (used[idx]) continue;
    used[idx] = true;
    out.push(list[idx]);
  }
  for (let i = 0; i < len && out.length < want; i++) {
    const idx = (base + i) % len;
    if (used[idx]) continue;
    used[idx] = true;
    out.push(list[idx]);
  }
  return out;
}

// 「换一个」：在当前库内按 tap 次数稳定轮转，tap 0..len-1 恰好覆盖全库一遍。
// ⚠️ 不要写成 1 + tap % (len-1) 再 % len —— 那样步长取不到 0，会漏掉一项
//    （单测「转 len 次覆盖全库」就是专门守这个坑的）。
function rotate(list, tap) {
  if (!list || !list.length) return null;
  const len = list.length;
  return list[((Number(tap) || 0) % len + len) % len];
}

// 展示用日期标签：10月6日 · 星期一
function dateLabelOf(date) {
  const d = date ? new Date(date) : new Date();
  const wk = '日一二三四五六'.charAt(d.getDay());
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + wk;
}

// 粗季节（用于季节限定文案）：'春'|'夏'|'秋'|'冬'
function seasonOf(date) {
  const m = (date ? new Date(date) : new Date()).getMonth() + 1;
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

module.exports = {
  MS_PER_DAY,
  dayIndex,
  hashStr,
  seedOf,
  pickIndex,
  pickDaily,
  pickDailyMulti,
  rotate,
  dateLabelOf,
  seasonOf
};
