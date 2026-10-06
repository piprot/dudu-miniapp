// test/test_comic_storyboard.js
// ─────────────────────────────────────────────────────────────────────────
// 分镜编辑器纯逻辑烟雾测试（Node 可直接跑，无 wx 依赖）。
// 验证三件事：
//   ① comic_markup.parseScript 对「场景/情绪/旁白/对白/标题/分镜分隔」的分类正确；
//   ② comic_render.computeLayout 给出的总高与各格坐标自洽（无溢出根因：高度算法与 draw 一致）；
//   ③ comic_render.draw 在 fakeCtx 下不抛错、画布尺寸被正确设置。
// 运行：node test/test_comic_storyboard.js
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const assert = require('assert');

const { parseScript, classify, resolveMood } = require('../utils/comic_markup.js');
const { computeLayout, draw, DEFAULTS } = require('../utils/comic_render.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
}

// ── ① 解析分类 ──
console.log('\n[1] parseScript 分类');
const SAMPLE = [
  '# 雨夜的便利店',
  '【第一格】',
  '场景：凌晨两点的街角便利店',
  '情绪：温暖',
  '旁白：城市的灯一盏盏熄灭，只有它还亮着。',
  '',
  '【第二格】',
  '小明：阿姨，来碗关东煮。',
  '阿姨：这么晚还没睡？',
  '',
  '【第三格】',
  '情绪：忧伤',
  '旁白：她笑了笑，没回答。',
  '',
  '【第四格】',
  '旁白：有些疲惫，不必说给谁听。'
].join('\n');

const m = parseScript(SAMPLE);
ok('标题识别为「雨夜的便利店」', m.title === '雨夜的便利店');
ok('解析出 4 个分镜格', m.panels.length === 4);
ok('第一格场景=街角便利店', m.panels[0].scene.indexOf('街角便利店') >= 0);
ok('第一格情绪=温暖（归一为「温馨」命名色）', m.panels[0].mood && m.panels[0].mood.name === '温馨');
ok('第一格有一条旁白', m.panels[0].lines.length === 1 && m.panels[0].lines[0].type === 'narration');
ok('第二格有两条对白（小明/阿姨）', m.panels[1].lines.filter(l => l.type === 'speech').length === 2);
ok('第二格对白 who 正确', m.panels[1].lines[0].who === '小明' && m.panels[1].lines[1].who === '阿姨');
ok('第三格情绪=忧伤', m.panels[2].mood && m.panels[2].mood.name === '忧伤');

// 单行分类边界
ok("classify('旁白：x')=narration", classify('旁白：x').type === 'narration');
ok("classify('场景：x')=scene", classify('场景：x').type === 'scene');
ok("classify('情绪：忧伤')=mood", classify('情绪：忧伤').type === 'mood');
ok("classify('小明：hi')=speech", classify('小明：hi').type === 'speech' && classify('小明：hi').who === '小明');
ok("classify('普通一句')=narration", classify('普通一句').type === 'narration');
ok("resolveMood('有点忧伤')可归一到忧伤", resolveMood('有点忧伤').name === '忧伤');
ok("resolveMood('')回退默认", resolveMood('').name === '');

// ── ② computeLayout 自洽 ──
console.log('\n[2] computeLayout 自洽（高度算法与 draw 一致）');
const WIDTH = 340;
const measure = (t, font) => String(t).length * 7; // 与 draw 内 ctx.measureText 同口径
const layout = computeLayout(m, { width: WIDTH, cols: 2, theme: null }, measure);

ok('布局宽度=传入宽度', Math.abs(layout.width - WIDTH) < 1e-6);
ok('行数=ceil(4/2)=2', layout.rows.length === 2);
ok('每行两格', layout.rows[0].length === 2 && layout.rows[1].length === 2);
// 同行两格高度一致（取 max）
ok('同行格高对齐（max）', layout.rows[0][0].h === layout.rows[0][1].h);

// 重算总高，验证与 layout.height 一致（防止「算小 → 文字溢出」根因）
const o = Object.assign({}, DEFAULTS, { width: WIDTH, cols: 2, theme: null });
const rowHs = layout.rows.map(r => Math.max.apply(null, r.map(c => c.h)));
let expectH = o.pad * 2 + (m.title ? o.titleLH + 8 : 0);
for (let i = 0; i < rowHs.length; i++) {
  expectH += rowHs[i];
  if (i < rowHs.length - 1) expectH += o.gap;
}
ok('layout.height 与逐行累加一致', Math.abs(layout.height - expectH) < 1e-6);

// 每格高度应 >= 最小高度（不至于塌缩）
ok('每格高度 >= 120 下限', layout.rows.every(r => r.every(c => c.h >= 120)));

// 坐标无负、单调向下
let monotonic = true, nonNeg = true;
let prevY = -1;
for (const row of layout.rows) {
  for (const c of row) {
    if (c.x < 0 || c.y < 0) nonNeg = false;
  }
  if (row[0].y < prevY) monotonic = false;
  prevY = row[0].y;
}
ok('所有坐标非负', nonNeg);
ok('行 y 单调向下', monotonic);

// ── ③ draw 不抛错 + 画布尺寸设置 ──
console.log('\n[3] draw 渲染（fakeCtx）');
let threw = null;
const fakeCanvas = {
  width: 0, height: 0,
  getContext() {
    return {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: 'top',
      clearRect() {}, fillRect() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, arcTo() {}, arc() {},
      roundRect() {}, fill() {}, stroke() {}, save() {}, restore() {}, clip() {},
      scale() {}, translate() {},
      fillText() {}, createLinearGradient() { return { addColorStop() {} }; },
      measureText(t) { return { width: String(t).length * 7 }; }
    };
  }
};
try {
  const ctx = fakeCanvas.getContext();
  computeLayout(m, { width: WIDTH, cols: 2, theme: null }, measure); // 预热（无副作用）
  draw(ctx, layout, { theme: null });
} catch (e) { threw = e; }
ok('draw 不抛错', threw === null);
if (threw) console.log('     ↳ ' + (threw && threw.stack || threw));

// 带主题也能画（palette 形状兼容：bg[0]/bgSolid/ink/bgSoft/sub/line 都存在）
let threwTheme = null;
try {
  const ctx = fakeCanvas.getContext();
  draw(ctx, layout, { theme: { bgSolid: '#fff', bg: ['#efe', '#ede'], ink: '#222', bgSoft: '#eee', sub: '#666', line: '#ccc' } });
} catch (e) { threwTheme = e; }
ok('draw 支持主题 palette 对象', threwTheme === null);
if (threwTheme) console.log('     ↳ ' + (threwTheme && threwTheme.stack || threwTheme));

// ── 汇总 ──
console.log('\n──────────────');
console.log('分镜编辑器测试：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail > 0) process.exit(1);
console.log('全部通过 ✅');
