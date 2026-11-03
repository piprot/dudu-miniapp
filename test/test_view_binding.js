// test/test_view_binding.js —— 「数据能否真的到达视图层」+「换一句不许扣费」守卫
// 2026-11-03
//
// 为什么必须单独守：
//   1) 小程序里 `Object.assign(this.data, patch)` **只改 JS 侧**，不会把数据推给视图层。
//      setData 才是唯一的渲染通道。天气页/金句页曾用这个写法注入分层选择器的
//      pgGroups/pgHot/pgItems —— 运行时 WXML 里这些字段恒为 undefined，
//      整个选择器渲染成空，用户看到的就是「选不了天气」「按钮全没了」。
//      这种 bug 不会被任何「逻辑单测」抓到（JS 侧数据是对的），只能静态守住写法。
//   2) 用户拍板的计费口径：**换一句/换一条免费，只有「成卡/预览成卡」扣 8 分**。
//      旧版 solar.onShuffleToday 直接调了成卡入口 preview()，等于换一句也扣 8 分。
'use strict';

require('./_paths.js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + ((e && e.message) || e)); failed++; }
}

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 收集所有页面 / 工具侧 utils 的源码
function jsFiles(dir) {
  const out = [];
  (function w(d) {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, f.name);
      if (f.isDirectory()) w(fp);
      else if (f.name.endsWith('.js')) out.push(fp);
    }
  })(dir);
  return out;
}
const PAGE_FILES = jsFiles(path.join(ROOT, 'pkgTools', 'pages'));
const ALL_SRC = PAGE_FILES.concat(jsFiles(path.join(ROOT, 'pkgTools', 'utils')));

// ── 1. 禁止 `Object.assign(this.data, ...)` ─────────────────────────────
t('没有页面用 Object.assign(this.data, ...) 注入数据（必须 setData）', () => {
  const bad = [];
  for (const f of ALL_SRC) {
    const src = fs.readFileSync(f, 'utf8');
    // 去掉注释再判断，避免「注释里提到这个反模式」被误判
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/Object\.assign\(\s*this\.data\s*,/.test(code)) bad.push(path.relative(ROOT, f));
  }
  assert.deepStrictEqual(bad, [], '以下文件直接改了 this.data（视图层收不到）: ' + bad.join(', '));
});

// ── 2. 分层选择器必须经 setData 落地 ──────────────────────────────────
const PICKER_PAGES = [
  { name: '天气', js: 'pkgTools/pages/weather/weather.js' },
  { name: '金句', js: 'pkgTools/pages/quotes/quotes.js' }
];
PICKER_PAGES.forEach(p => {
  t(p.name + '页：initPicker 用 this.setData(picker.data) 落地选择器字段', () => {
    const src = read(p.js);
    assert.ok(/this\.setData\(\s*picker\.data\s*\)/.test(src),
      '未找到 this.setData(picker.data)：选择器数据到不了视图层');
    assert.ok(!/Object\.assign\(\s*this\.data\s*,\s*picker\.data/.test(src),
      '仍在使用 Object.assign(this.data, picker.data)');
  });
});

// ── 3. 换一句 / 换一条 不得扣费 ───────────────────────────────────────
// 取某个**方法定义**的方法体（不是调用点）。
// ⚠️ 不能用 src.indexOf('renderQuote(') —— 它会先命中其它方法里的 `this.renderQuote(` 调用点，
//    把后面的对象字面量当成方法体（2026-11-03 实测踩到，误判成「成卡变免费」）。
//    这里用行首缩进 + `名(` 的形式锁定定义行，再从该行的 `{` 做括号配平。
function methodBody(src, name) {
  const re = new RegExp('^[ \\t]{0,4}' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) return '';
  const i = m.index;
  const start = src.indexOf('{', i);
  if (start < 0) return '';
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return '';
}

const FREE_SHUFFLE = [
  { name: '每日一句', js: 'pkgTools/pages/spark/spark.js', fn: 'onShuffle' },
  { name: '天气心情卡', js: 'pkgTools/pages/weather/weather.js', fn: 'onShuffle' },
  { name: '节气文案', js: 'pkgTools/pages/solar/solar.js', fn: 'onShuffleToday' },
  { name: '卡片制作', js: 'pkgTools/pages/card/card.js', fn: 'onShuffleQuote' },
  { name: '海报长图', js: 'pkgTools/pages/poster/poster.js', fn: 'onShuffleQuote' }
];

FREE_SHUFFLE.forEach(p => {
  t(p.name + '：' + p.fn + ' 内不得调用 charge / 成卡入口（换一句免费）', () => {
    const body = methodBody(read(p.js), p.fn);
    assert.ok(body, '找不到方法 ' + p.fn);
    assert.ok(!/\bcharge\s*\(/.test(body), p.fn + ' 内出现了 charge(...)，换一句会扣费');
    // solar 的成卡入口叫 preview()，它第一步就是 charge —— 换一条不能走它
    assert.ok(!/\bthis\.preview\s*\(/.test(body), p.fn + ' 直接调了成卡入口 preview(...)（内部会扣费）');
    assert.ok(!/\bthis\.onGen\s*\(/.test(body), p.fn + ' 直接调了 onGen(...)（内部会扣费）');
    assert.ok(!/\brenderQuote\s*\(/.test(body), p.fn + ' 直接调了 renderQuote(...)（内部会扣费）');
  });
});

// ── 4. 五个合规模块的成卡单价统一 8 分 ────────────────────────────────
t('五个合规模块成卡单价统一为 8 分（quote/spark/weather/solar/line）', () => {
  const cfg = require(path.join(ROOT, 'utils', 'config.js'));
  const cost = (cfg.POINTS && cfg.POINTS.cost) || {};
  ['quoteCard', 'sparkCard', 'weatherCard', 'solarCard', 'lineCard'].forEach(k => {
    assert.strictEqual(cost[k], 8, k + ' 应为 8，实际 ' + cost[k]);
  });
});

// ── 5. 成卡入口确实扣费（反向校验，防止改过头变成全免费）─────────────
const PAID_ENTRY = [
  { name: '金句', js: 'pkgTools/pages/quotes/quotes.js', fn: 'renderQuote' },
  { name: '每日一句', js: 'pkgTools/pages/spark/spark.js', fn: 'onPreview' },
  { name: '天气', js: 'pkgTools/pages/weather/weather.js', fn: 'onGen' },
  { name: '节气', js: 'pkgTools/pages/solar/solar.js', fn: 'preview' }
];
PAID_ENTRY.forEach(p => {
  t(p.name + '：成卡入口 ' + p.fn + ' 仍会 charge（不能改过头变免费）', () => {
    const body = methodBody(read(p.js), p.fn);
    assert.ok(/\bcharge\s*\(/.test(body), p.fn + ' 内没有 charge(...)，成卡变免费了');
  });
});

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exitCode = failed ? 1 : 0;
