// 把新增文案合并进 utils/content_weather.js（每组合 4 → 8 条，256 → 512）。
// 不做「原地字符串替换」——那样容易改坏；改为读现有 MATRIX + 新增数据，
// 整体重新生成文件，再跑校验。原文件先备份成 .bak。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const cur = require(path.join(ROOT, 'utils/content_weather.js'));
const addA = require(path.join(__dirname, '_weather_add_a.js'));
const addB = require(path.join(__dirname, '_weather_add_b.js'));
const ADD = Object.assign({}, addA, addB);

const WEATHER = ['sunny', 'cloudy', 'rain', 'snow', 'wind', 'fog', 'thunder', 'night'];
const WEATHER_CN = { sunny: '晴', cloudy: '多云', rain: '雨', snow: '雪', wind: '风', fog: '雾', thunder: '雷', night: '夜' };
const MOODS = ['happy', 'calm', 'tired', 'sad', 'excited', 'anxious', 'grateful', 'lonely'];

// ── 校验一：新增的 key 必须全都对得上现有库（拼错就静默丢失，必须拦）──
const problems = [];
const curKeys = Object.keys(cur.MATRIX);
Object.keys(ADD).forEach(k => {
  if (curKeys.indexOf(k) < 0) problems.push('新增文案的 key 不存在于现有库：' + k);
});
// ── 校验二：新增条数必须是每组合 4 条 ──
Object.keys(ADD).forEach(k => {
  if (ADD[k].length !== 4) problems.push(k + ' 新增条数应为 4，实际 ' + ADD[k].length);
});
// ── 校验三：组合数必须完整 64 ──
if (curKeys.length !== 64) problems.push('现有组合数不是 64：' + curKeys.length);
if (problems.length) {
  console.error('✗ 合并前校验未通过：\n  ' + problems.join('\n  '));
  process.exit(1);
}

// ── 合并 + 同组合内去重（重复文案会让用户觉得「怎么又是这句」）──
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

// ── 校验四：合并后每组合 8 条、总数 512、全库无完全重复 ──
let total = 0;
const allSeen = new Map();
for (const k of Object.keys(merged)) {
  if (merged[k].length !== 8) problems.push(k + ' 合并后应为 8 条，实际 ' + merged[k].length);
  total += merged[k].length;
  merged[k].forEach(t => {
    if (allSeen.has(t)) problems.push('全库重复文案「' + t + '」出现在 ' + allSeen.get(t) + ' 与 ' + k);
    allSeen.set(t, k);
  });
}
if (total !== 512) problems.push('合并后总数应为 512，实际 ' + total);
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
    // 只有整个 MATRIX 的最后一项才不加逗号——天气组之间也要逗号，
    // 否则上一组的结尾直接接下一组的 key → SyntaxError。
    const isLast = (w === LAST_W && i === MOODS.length - 1);
    body += '  ' + q(k) + ': [\n';
    body += merged[k].map(t => '    ' + q(t)).join(',\n');
    body += '\n  ]' + (isLast ? '\n' : ',\n');
  });
}

const out = `// utils/content_weather.js
// ─────────────────────────────────────────────────────────────────────────
// 天气心情卡 · 静态文案库（2026-10-06 新增 · 2026-10-13 扩容至 512 条）
//
// 为什么是矩阵而不是一张表：天气卡是「天气 × 心情」两个维度组合出来的，
// 8 种天气 × 8 种心情 = 64 个组合。运营要求「一定要天天换」，
// 所以每个组合准备 8 条变体 → 512 条文案，配合 daily_rotate 一年多不重样。
//
// 扩容说明（2026-10-13）：原来每组合只有 4 条，选定「晴+开心」后跨天 4 天就
// 转回同一句、点「换一条」也只有 4 个可选，体感是「储备太少」。现在每组合 8 条，
// 循环周期从 4 天拉到 8 天。新增 256 条由 tools_local/_weather_add_a|b.js
// 经 _merge_weather_copy.js 合并生成，源文件保留在 tools_local 便于二次编辑。
//
// key 规则：'weatherKey|moodKey'，两个 key 必须与 pages/weather/weather.js 里的
//   WEATHER / MOODS 数组 key 完全一致（错一个字符就匹配不到，退回默认文案）。
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

const target = path.join(ROOT, 'utils/content_weather.js');
fs.copyFileSync(target, target + '.bak');
fs.writeFileSync(target, out, 'utf8');
console.log('✓ 已合并写入 utils/content_weather.js');
console.log('  备份：utils/content_weather.js.bak');
console.log('  组合数：' + Object.keys(merged).length + ' ｜ 总条数：' + total +
  '（每组合 8 条）｜ 同组合内重复被丢弃：' + dupInCombo + ' 条');
