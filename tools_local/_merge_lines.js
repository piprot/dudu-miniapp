// tools_local/_merge_lines.js
// 把 lines_terms / lines_lunar / lines_western 的扩容素材合并进正式库并全量重写文件
// 用法：node tools_local/_merge_lines.js lines_terms [--check]
//   --check 只校验不落盘（用来先挑出不合格的句子）
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../test/_paths.js');

const lib = process.argv[2];
const CHECK = process.argv.indexOf('--check') >= 0;
if (!lib) throw new Error('请指定库名：lines_terms | lines_lunar | lines_western');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'pkgTools', 'utils', lib + '.js');
const old = require(P.utilPath(lib + '.js'));
const add = require(path.join(__dirname, '_add_' + lib.replace('lines_', 'lines_') + '.js'));

const keys = Object.keys(old);
const keysAdd = Object.keys(add);
const err = [];

// ① key 必须完全对齐（新增素材不得引入库里没有的条目，也不得漏条目）
keys.forEach(k => { if (!add[k]) err.push('素材缺少条目：' + k); });
keysAdd.forEach(k => { if (!old[k]) err.push('素材多出条目（库里没有）：' + k); });

// ② 每条文案：纯中文、18–48 字、无英文数字乱码
const all = [];
keysAdd.forEach(k => {
  const arr = add[k];
  if (!Array.isArray(arr)) { err.push(k + ' 不是数组'); return; }
  arr.forEach((s, i) => {
    const label = k + '[' + i + ']';
    if (typeof s !== 'string' || !s.trim()) err.push(label + ' 空文案');
    if (/[A-Za-z0-9]/.test(s)) err.push(label + ' 含英文/数字: ' + s);
    if (s.indexOf('\ufffd') >= 0) err.push(label + ' 含乱码: ' + s);
    if (s.length < 18) err.push(label + ' 过短(' + s.length + '): ' + s);
    if (s.length > 48) err.push(label + ' 过长(' + s.length + '): ' + s);
    all.push(s);
  });
});

// ③ 全库唯一（含存量）：撞车会让「换一条」换不出新句
const seen = new Set();
keys.forEach(k => old[k].forEach(s => seen.add(s)));
all.forEach(s => {
  if (seen.has(s)) err.push('与存量或自身重复: ' + s);
  seen.add(s);
});

if (err.length) {
  console.error('✗ ' + lib + ' 校验未通过（' + err.length + ' 项）：');
  err.forEach(e => console.error('   ' + e));
  process.exit(1);
}
console.log('✓ ' + lib + ' 校验通过：新增 ' + all.length + ' 条，'
  + keysAdd.length + ' 个条目，全库去重后 ' + seen.size + ' 条');

if (CHECK) process.exit(0);

// ④ 全量重写（保持 key 顺序与原文案，追加新文案）
const src = fs.readFileSync(TARGET, 'utf8');
const EOL = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
// ⚠️ 必须按 /\r?\n/ 切：CRLF 文件里 split('\n') 会留下尾部 \r，
//    拼进注释后 \r 会折断注释行，导致整个文件语法错误（本次就是这么踩的）
const HEAD = (src.split(/\r?\n/)[1] || '').replace(/^\/\/ ?/, '').replace(/\r$/, ''); // 原标题行
const title = HEAD.replace(/每节 \d+ 条/, '每节 ' + (old[keys[0]].length + add[keys[0]].length) + ' 条')
  + '；2026-10-25 翻倍扩容';

function q(s) { return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
const body = keys.map(k => {
  const arr = old[k].concat(add[k]);
  return '  ' + (/^[A-Za-z_$]/.test(k) ? k : k) + ': [' + EOL
    + arr.map(s => '    ' + q(s) + ',').join(EOL) + EOL
    + '  ]';
}).join(',' + EOL);

const out = '// utils/' + lib + '.js' + EOL
  + '// ' + title + EOL
  + "'use strict';" + EOL
  + 'module.exports = {' + EOL + body + EOL + '};' + EOL;
fs.writeFileSync(TARGET, out, 'utf8');

// ⑤ 读回验证
delete require.cache[require.resolve(P.utilPath(lib + '.js'))];
const after = require(P.utilPath(lib + '.js'));
const tot = Object.values(after).flat();
const perKey = Object.keys(after).map(k => after[k].length);
console.log('落盘完成：' + Object.keys(after).length + ' 个条目，每条目 ' + perKey[0]
  + ' 条，合计 ' + tot.length + ' 条，文件 ' + (fs.statSync(TARGET).size / 1024).toFixed(1) + ' KB');
if (new Set(tot).size !== tot.length) throw new Error('读回后存在重复');
if (tot.some(s => s.length < 18 || s.length > 48 || /[A-Za-z0-9]/.test(s))) throw new Error('读回后存在不合规文案');
