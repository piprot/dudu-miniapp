// 把 120 组合扩容文案合并进 utils/content_weather.js（64×24=1536 → 120×40=4800）。
// 与 _merge_weather_copy.js 同一套做法：不做「原地字符串替换」（容易改坏），
// 而是读现有 MATRIX + 新增数据整体重新生成文件，再跑四道校验。原文件先备份 .bak。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ⚠️ 2026-10-24 分包改造后，内容库从 utils/ 搬到了 pkgTools/utils/。
//    这里必须装 _paths.js 的虚拟路径重定向，否则 require('utils/content_weather.js')
//    直接 MODULE_NOT_FOUND（老的 _merge_weather_copy.js 就是改造前写的，现已失效）。
const P = require('../test/_paths.js');

const TARGET = P.utilPath('content_weather.js');
const cur = require(TARGET);
const { ADD, WEATHER, MOODS, PER_COMBO } = require(path.join(__dirname, '_weather_gen_120.js'));

const WEATHER_CN = {
  sunny: '晴', cloudy: '多云', overcast: '阴', rain: '雨', snow: '雪', wind: '风',
  fog: '雾', haze: '霾', thunder: '雷', heat: '酷暑', cold: '严寒', night: '夜'
};
const MOOD_CN = {
  happy: '开心', calm: '平静', tired: '疲惫', sad: '低落', excited: '兴奋',
  anxious: '焦虑', grateful: '感恩', lonely: '孤独', missing: '想念', relaxed: '放松'
};

const problems = [];

// ── 校验一：新增 key 必须对得上（拼错就静默丢失，必须拦）──
const curKeys = Object.keys(cur.MATRIX);
Object.keys(ADD).forEach(k => {
  if (k.indexOf('|') < 0) problems.push('新增文案 key 缺分隔符：' + k);
});
// ── 校验二：补齐后每个组合都必须正好 40 条 ──
for (const w of WEATHER) for (const m of MOODS) {
  const k = w + '|' + m;
  const have = (cur.MATRIX[k] || []).length;
  const add = (ADD[k] || []).length;
  if (have + add !== PER_COMBO) {
    problems.push(k + ' 补齐后应为 ' + PER_COMBO + ' 条，实际 ' + (have + add) + '（原 ' + have + ' + 新增 ' + add + '）');
  }
}
if (problems.length) {
  console.error('✗ 合并前校验未通过：\n  ' + problems.join('\n  '));
  process.exit(1);
}

// ── 合并 + 去重 ──
const merged = {};
let dupInCombo = 0;
for (const w of WEATHER) for (const m of MOODS) {
  const k = w + '|' + m;
  const base = (cur.MATRIX[k] || []).slice();
  const seen = new Set(base);
  const added = [];
  (ADD[k] || []).forEach(t => {
    if (seen.has(t)) { dupInCombo++; return; }
    seen.add(t); added.push(t);
  });
  merged[k] = base.concat(added);
}

// ── 校验三：组合数 120、每组合 40、全库无完全重复 ──
let total = 0;
const allSeen = new Map();
for (const k of Object.keys(merged)) {
  if (merged[k].length !== PER_COMBO) {
    problems.push(k + ' 合并后应为 ' + PER_COMBO + ' 条，实际 ' + merged[k].length);
  }
  total += merged[k].length;
  merged[k].forEach(t => {
    if (allSeen.has(t)) problems.push('全库重复文案「' + t + '」出现在 ' + allSeen.get(t) + ' 与 ' + k);
    allSeen.set(t, k);
  });
}
if (Object.keys(merged).length !== 120) problems.push('组合数应为 120，实际 ' + Object.keys(merged).length);
if (total !== 120 * PER_COMBO) problems.push('总数应为 ' + 120 * PER_COMBO + '，实际 ' + total);

// ── 校验四：语法硬伤扫描（生成器最容易出的三类，落盘前再拦一次）──
//
// ⚠️ 只扫**新增**部分，不扫存量手写文案：存量里有「下过雨的世界颜色特别饱和，
//    红更红，绿更绿，蓝也更蓝。」这种连用三四个逗号的排比句——那是**手写的好句子**，
//    机器模板写不出、也不该被机器规则判死。把存量一起扫会把好文案误杀（实测误伤 4 条）。
//    规则只用来约束机器的产出。
const bad = [];
Object.keys(ADD).forEach(k => (ADD[k] || []).forEach(t => {
  if (/的的/.test(t)) bad.push(k + ' 叠字「的」：' + t);
  if ((t.match(/，/g) || []).length > 2) bad.push(k + ' 逗号超过两处（三截句）：' + t);
  if (t.length < 8) bad.push(k + ' 过短：' + t);
  if (t.length > 60) bad.push(k + ' 过长：' + t);
}));
if (bad.length) problems.push('新增文案语法/长度问题 ' + bad.length + ' 处，例：' + bad.slice(0, 3).join(' | '));

if (problems.length) {
  console.error('✗ 合并后校验未通过：\n  ' + problems.join('\n  '));
  process.exit(1);
}

// ── 生成文件 ──
const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
let body = '';
const LAST_W = WEATHER[WEATHER.length - 1];
for (const w of WEATHER) {
  body += '\n  // ───────────── ' + WEATHER_CN[w] + ' ─────────────\n';
  MOODS.forEach((m, i) => {
    const k = w + '|' + m;
    const isLast = (w === LAST_W && i === MOODS.length - 1);
    body += '  ' + q(k) + ': [\n';
    body += merged[k].map(t => '    ' + q(t)).join(',\n');
    body += '\n  ]' + (isLast ? '\n' : ',\n');
  });
}

const out = `// utils/content_weather.js
// ─────────────────────────────────────────────────────────────────────────
// 天气心情卡 · 静态文案库（2026-10-06 新增 · 2026-10-13 扩至 512 · 2026-10-25 扩至 4800）
//
// 为什么是矩阵而不是一张表：天气卡是「天气 × 心情」两个维度组合出来的，
// 12 种天气 × 10 种心情 = 120 个组合。运营要求「一定要天天换」，
// 所以每个组合准备 40 条变体 → 4800 条文案，配合 daily_rotate 一年多不重样。
//
// 扩容说明（2026-10-13）：原来每组合只有 4 条，选定「晴+开心」后跨天 4 天就
// 转回同一句、点「换一条」也只有 4 个可选，体感是「储备太少」。每组合 4 → 24 条。
//
// 扩容说明（2026-10-25）：用户拍板「维度优先 · 文案 3 倍」——
//   · 天气 8 → 12 种（新增 阴 / 霾 / 酷暑 / 严寒）
//   · 心情 8 → 10 种（新增 想念 / 放松）
//   · 组合 64 → 120，每组合 24 → 40 条，总量 1536 → 4800。
//   选这 4 种天气是因为它们都是「日常会遇到、原来只能硬塞进相邻天气」的真实场景：
//   阴≠多云（没有阳光块）、霾≠雾（有异味/口罩/限行）、酷暑≠晴（体感不是天象）、
//   严寒≠雪（可能干冷无雪）。
//   新增 3264 条由 tools_local/_weather_gen_120.js 生成、本文件合并落盘，
//   生成器保留在 tools_local 便于二次编辑与重跑。
//
// key 规则：'weatherKey|moodKey'，两个 key 必须与 pages/weather/weather.js 里的
//   WEATHER / MOODS 数组 key 完全一致（错一个字符就匹配不到，退回默认文案）。
//   这条由 test_content_library.js 的「接线守卫」钉死，改任一侧都会红。
//
// 纯静态数据，零 AI、零网络（个人主体合规）。
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const MATRIX = {${body}};

// 安全取文案：组合不存在时返回 null（由调用方决定兜底）
function textFor(weatherKey, moodKey, variant) {
  const arr = MATRIX[weatherKey + '|' + moodKey];
  if (!arr || !arr.length) return null;
  const i = ((Number(variant) || 0) % arr.length + arr.length) % arr.length;
  return arr[i];
}

// 该组合的文案条数（供测试与调试）
function variantCount(weatherKey, moodKey) {
  const arr = MATRIX[weatherKey + '|' + moodKey];
  return arr ? arr.length : 0;
}

// 全库统计：组合数 / 文案总条数
function stats() {
  const combos = Object.keys(MATRIX).length;
  let total = 0;
  Object.keys(MATRIX).forEach(k => { total += MATRIX[k].length; });
  return { combos, total };
}

module.exports = { MATRIX, textFor, variantCount, stats };
`;

const target = TARGET;
fs.copyFileSync(target, target + '.bak');
fs.writeFileSync(target, out, 'utf8');
console.log('✓ 已合并写入 ' + path.relative(ROOT, target));
console.log('  备份：' + path.relative(ROOT, target) + '.bak');
console.log('  组合数：' + Object.keys(merged).length + ' ｜ 总条数：' + total +
  '（每组合 ' + PER_COMBO + ' 条）｜ 同组合内重复被丢弃：' + dupInCombo + ' 条');
