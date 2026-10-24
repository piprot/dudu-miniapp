// tools_local/_fix_western3.js
// 第三轮：第二轮替换后仍 <18 字的 7 条再补
'use strict';
const fs = require('fs');
const path = require('path');
const F = path.join(__dirname, '_add_lines_western.js');
let src = fs.readFileSync(F, 'utf8');

const MAP = [
  ['山河这样辽阔，值得你亲眼去看一看。', '山河这样辽阔，真值得你亲眼去看一看。'],
  ['走得再远，回来的时候心总是满满的。', '走得再远，回来的时候心里总是满满的。'],
  ['灯灭了以后，南瓜还在门口咧着嘴笑。', '灯灭了以后，南瓜还在门口咧着嘴笑呢。'],
  ['一杯热饮捧在手心，暖意就在指尖上。', '一杯热饮捧在手心里，暖意就在指尖上。'],
  ['这一天，整座城市都比平时亮了一些。', '这一天，整座城市都要比平时亮了一些。'],
  ['一顿大餐做好，一家人围着慢慢地吃。', '一顿大餐做好，一家人围坐着慢慢地吃。'],
  ['拆开礼物的那一刻，眼睛总是亮亮的。', '拆开礼物的那一刻，人的眼睛总是亮亮的。']
];

const bad = [];
let done = 0;
MAP.forEach(pair => {
  const [o, n] = pair;
  const cnt = src.split(o).length - 1;
  if (cnt === 1) { src = src.replace(o, n); done++; }
  else if (cnt > 1) bad.push('多命中(' + cnt + '): ' + o);
  else bad.push('未命中: ' + o);
  if (n.length < 18) bad.push('替换后仍不足18字(' + n.length + '): ' + n);
  if (n.length > 48) bad.push('替换后超48字(' + n.length + '): ' + n);
});
fs.writeFileSync(F, src, 'utf8');
console.log('第三轮已补齐 ' + done + ' 条 → ' + path.basename(F));
if (bad.length) { console.error('✗ 存在问题（' + bad.length + '）：'); bad.forEach(b => console.error('   ' + b)); process.exit(1); }
console.log('✓ 全部命中且替换后长度合规');
