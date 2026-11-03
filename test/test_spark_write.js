// test/test_spark_write.js —— 每日一句「用户自己写」功能守卫（2026-11-03 新增）
// 用户需求：每日一句板块要支持用户自己写一句，写了就用用户写的，清空回到库里今日句；
//          且不扣积分，只有「预览成卡」才扣 8 分。
//
// 守卫点：
//   ① spark.js 的 data 声明了 userText（输入框受控字段）
//   ② 页面定义了 onUserText（textarea 输入出口）与 effectiveText（用户自写优先于库里句）
//   ③ WXML 的 textarea 受控绑定 onUserText 且引用 userText（清空能回落）
//   ④ effectiveText 逻辑：userText 非空优先返回（已 trim），否则回落库里 quote.text
//   ⑤ 成卡（onPreview）走 charge('sparkCard')；换一句（onShuffle）在用户自写时提示、不覆盖
'use strict';
require('./_paths.js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rd = (...a) => fs.readFileSync(path.join(...a), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + ((e && e.message) || e)); failed++; }
}

// 提取函数体（花括号配对），用于在无 Page/wx 环境里直接验证逻辑
function funcBody(src, name) {
  const re = new RegExp('(?:^|[\\s,;{])' + name + '\\s*\\([^)]*\\)\\s*\\{', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(open + 1, i); }
  }
  return null;
}

t('每日一句页：data 声明了 userText（用户自写输入框的字段）', () => {
  const js = rd(ROOT, 'pages', 'spark', 'spark.js');
  const dataBlock = (js.match(/data:\s*(?:Object\.assign\(\s*)?\{[\s\S]*?\n\s*\},\s*cardStyle\.defaults/) || [''])[0];
  assert.ok(/userText:\s*''/.test(dataBlock), 'userText 未出现在 spark data 块内（输入框无受控字段）');
});

t('每日一句页：定义了 onUserText 与 effectiveText（用户自写出口 + 优先级逻辑）', () => {
  const js = rd(ROOT, 'pages', 'spark', 'spark.js');
  assert.ok(/onUserText\s*\(/.test(js), '未定义 onUserText（textarea 输入无出口）');
  assert.ok(/effectiveText\s*\(/.test(js), '未定义 effectiveText（无法判定用户自写优先）');
  assert.ok(/refreshPreview\s*\(/.test(js), '未定义 refreshPreview（免费重绘预览）');
});

t('每日一句 WXML：textarea 受控绑定 onUserText 且引用 userText', () => {
  const wxml = rd(ROOT, 'pages', 'spark', 'spark.wxml');
  assert.ok(/bindinput="onUserText"/.test(wxml), 'textarea 未绑定 onUserText（用户输入无出口）');
  assert.ok(/value="\{\{userText\}\}"/.test(wxml), 'textarea 未用 value={{userText}} 受控（清空无法回落）');
});

t('effectiveText 逻辑：用户自写优先（已 trim），清空回落库里今日句', () => {
  const js = rd(ROOT, 'pages', 'spark', 'spark.js');
  const body = funcBody(js, 'effectiveText');
  assert.ok(body, '找不到 effectiveText 函数体');
  const fn = new Function('return (function(){' + body + '}).apply(this);');
  // 用户写了 → 返回用户句（trim 前后空格）
  const a = { data: { userText: '  今天也想好好吃饭  ', quote: { text: '库里的句子', c: 'x' } } };
  assert.strictEqual(fn.call(a), '今天也想好好吃饭', 'userText 非空却没优先返回（应已 trim）');
  // 用户清空 → 回落库里
  const b = { data: { userText: '   ', quote: { text: '库里的句子', c: 'x' } } };
  assert.strictEqual(fn.call(b), '库里的句子', 'userText 为空却没回落到 quote.text');
  // 两者皆空 → 空串而非 undefined
  const c = { data: { userText: '', quote: { text: '', c: '' } } };
  assert.strictEqual(fn.call(c), '', '两者皆空应返回空串而非 undefined');
});

t('每日一句：成卡（onPreview）使用 effectiveText 且仅走 charge 扣费出口', () => {
  const js = rd(ROOT, 'pages', 'spark', 'spark.js');
  const ob = funcBody(js, 'onPreview');
  assert.ok(/effectiveText\(\)/.test(ob), 'onPreview 未用 effectiveText（用户自写句不会进卡）');
  assert.ok(/charge\('sparkCard'/.test(ob), 'onPreview 未走 charge 扣费（成卡口缺失）');
});

t('每日一句：换一句（onShuffle）在用户自写时提示、不覆盖', () => {
  const js = rd(ROOT, 'pages', 'spark', 'spark.js');
  const ob = funcBody(js, 'onShuffle');
  assert.ok(/你写了自己的句子，清空后才会换/.test(js), 'onShuffle 未提示「清空后才会换」（会覆盖用户句）');
  assert.ok(/userText/.test(ob), 'onShuffle 未读取 userText（不会拦截自写覆盖）');
});

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
if (failed) process.exit(1);
