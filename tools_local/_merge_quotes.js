// tools_local/_merge_quotes.js
// 把扩容素材合并进 pkgTools/utils/content_quotes.js
// ⚠️ 分包改造后 utils/ 已迁到 pkgTools/utils/，必须用 test/_paths.js 重定向，否则 MODULE_NOT_FOUND
'use strict';
const fs = require('fs');
const path = require('path');
require('../test/_paths.js');
const P = require('../test/_paths.js');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'pkgTools', 'utils', 'content_quotes.js');
const { SEED_QUOTES } = require(P.utilPath('content_quotes.js'));
const main = require(path.join(__dirname, '_out_quotes_main.json'));
const extra = require(path.join(__dirname, '_quotes_solar_extra.js'));

const BEFORE = SEED_QUOTES.length;
console.log('存量 ' + BEFORE + ' 条');

// ── 1. 组装新条目 ──
const add = [];
main.forEach(q => add.push({ id: q.id, text: q.text, tags: q.tags }));

// 节气：24 × 6 = 144（带节名前缀）+ 通用 36
let n = 120;
extra.SOLAR_EXTRA.forEach(([name, body, tag]) => {
  n++;
  add.push({
    id: 'q_seed_time_solar_' + String(n).padStart(3, '0'),
    text: name + '：' + body,
    tags: '节气,time_solar_' + name + ',' + tag
  });
});
extra.SOLAR_GENERAL_EXTRA.forEach(([body, tags]) => {
  n++;
  add.push({ id: 'q_seed_time_solar_' + String(n).padStart(3, '0'), text: body, tags: tags });
});

// 节日：24 × 6 = 144（带节名前缀）+ 通用 36
let m = 120;
extra.FEST_EXTRA.forEach(([name, body, tag]) => {
  m++;
  add.push({
    id: 'q_seed_time_festival_' + String(m).padStart(3, '0'),
    text: name + '：' + body,
    tags: '节日,time_festival_' + name + ',' + tag
  });
});
extra.FEST_GENERAL_EXTRA.forEach(([body, tags]) => {
  m++;
  add.push({ id: 'q_seed_time_festival_' + String(m).padStart(3, '0'), text: body, tags: tags });
});

console.log('新增 ' + add.length + ' 条（主体 ' + main.length
  + ' / 节气 ' + (extra.SOLAR_EXTRA.length + extra.SOLAR_GENERAL_EXTRA.length)
  + ' / 节日 ' + (extra.FEST_EXTRA.length + extra.FEST_GENERAL_EXTRA.length) + '）');

// ── 2. 四道校验 ──
const err = [];
const ids = new Set(SEED_QUOTES.map(q => q.id));
const texts = new Set(SEED_QUOTES.map(q => q.text));
add.forEach(q => {
  if (ids.has(q.id)) err.push('id 撞车: ' + q.id);
  ids.add(q.id);
  if (texts.has(q.text)) err.push('文本与存量重复: ' + q.text);
  texts.add(q.text);
  if (!q.text || !q.text.trim()) err.push('空文案: ' + q.id);
  if (/[a-zA-Z]/.test(q.text)) err.push('含英文: ' + q.text);
  if (q.text.indexOf('\ufffd') >= 0) err.push('含乱码: ' + q.text);
  if (q.text.length > 60) err.push('超 60 字(' + q.text.length + '): ' + q.text);
  if (!q.tags || !q.tags.trim()) err.push('缺 tags: ' + q.id);
});
if (err.length) { err.slice(0, 20).forEach(e => console.error('  ✗ ' + e)); throw new Error('校验未通过 ' + err.length + ' 项'); }
console.log('四道校验通过：id 唯一 / 文本全局唯一 / ≤60 字 / 无英文乱码');

// ── 3. 落盘：插到 SEED_QUOTES 数组闭合括号之前 ──
function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
const src = fs.readFileSync(TARGET, 'utf8');
// ⚠️ 该文件是 CRLF：写死 '\n];' 会匹配不上，必须容忍 \r\n 并沿用原换行符
const re = /(\r?\n)\];(\r?\n)(module\.exports = \{ SEED_QUOTES, CATEGORY_NAMES \};)/;
const hit = src.match(re);
if (!hit) throw new Error('未找到 SEED_QUOTES 数组结尾标记');
const EOL = hit[1];
const block = add.map(q =>
  '  {id:\'' + q.id + '\',text:"' + esc(q.text) + '",tags:\'' + esc(q.tags) + '\'},'
).join(EOL);
const out = src.replace(re, EOL + block + hit[1] + '];' + hit[2] + hit[3]);
fs.writeFileSync(TARGET, out, 'utf8');

// ── 4. 读回验证 ──
delete require.cache[require.resolve(P.utilPath('content_quotes.js'))];
const after = require(P.utilPath('content_quotes.js'));
const total = after.SEED_QUOTES.length;
console.log('合并后 ' + total + ' 条（' + BEFORE + ' → ' + total + '）');
if (total !== BEFORE + add.length) throw new Error('条数不符');
const t2 = new Set(after.SEED_QUOTES.map(q => q.text));
const i2 = new Set(after.SEED_QUOTES.map(q => q.id));
if (t2.size !== total) throw new Error('读回后存在重复文案');
if (i2.size !== total) throw new Error('读回后存在重复 id');
const byKind = {};
after.SEED_QUOTES.forEach(q => {
  const k = q.id.split('_')[3];
  byKind[k] = (byKind[k] || 0) + 1;
});
console.log('各来源类型：' + JSON.stringify(byKind));
const cats = new Set(after.SEED_QUOTES.map(q => q.id.split('_')[2]));
console.log('分类数 ' + cats.size);
console.log('文件大小 ' + (fs.statSync(TARGET).size / 1024).toFixed(1) + ' KB');
