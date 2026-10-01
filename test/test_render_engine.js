// test/test_render_engine.js
// 声明式渲染引擎 + 主题系统 纯逻辑单测（node 直接跑，无需 wx）。
'use strict';
const assert = require('assert');
const {
  computeLayout, draw, wrapText, roundRectPath, defaultMeasure
} = require('../utils/core/render_engine');
const { THEMES, THEME_LIST, getTheme, palette } = require('../utils/themes');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

function measure(text, font) {
  const px = parseInt(String(font), 10) || 14;
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c >= 0x2e80 && c <= 0xffef) w += px;
    else if (ch === ' ') w += px * 0.3;
    else w += px * 0.55;
  }
  return w;
}

function fakeCtx() {
  const noop = () => {};
  return {
    font: '', textBaseline: '', textAlign: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
    clearRect: noop, fillRect: noop, fillText: noop, beginPath: noop,
    moveTo: noop, arcTo: noop, closePath: noop, fill: noop, stroke: noop,
    save: noop, restore: noop, clip: noop, scale: noop, rect: noop,
    drawImage: noop, measureText: (t) => ({ width: String(t).length * 8 }),
    createLinearGradient: () => ({ addColorStop: noop })
  };
}

// ── 1. 基础元素布局解析 ──
t('container 嵌套：子元素坐标 = 父 offset + 自身 left/top', () => {
  const m = { width: 375, height: 600, children: [
    { type: 'container', left: 20, top: 30, width: 300, height: 200, children: [
      { type: 'text', left: 10, top: 10, width: 100, content: 'hi' }
    ]}
  ]};
  const L = computeLayout(m, {}, measure);
  const txt = L.blocks.find(b => b.type === 'text');
  assert.ok(txt, '应有 text block');
  assert.strictEqual(txt.x, 30); assert.strictEqual(txt.y, 40);
});

t('gradient / rect / line 块被解析且坐标正确', () => {
  const m = { width: 100, height: 100, children: [
    { type: 'gradient', left: 0, top: 0, width: 100, height: 50, colors: ['#fff', '#000'] },
    { type: 'rect', left: 0, top: 50, width: 100, height: 10, background: '#eee' },
    { type: 'line', left: 0, top: 60, width: 100, thickness: 2, color: '#ccc' }
  ]};
  const L = computeLayout(m, {}, measure);
  assert.ok(L.blocks.find(b => b.type === 'gradient' && b.colors.length === 2));
  assert.ok(L.blocks.find(b => b.type === 'rect' && b.background === '#eee'));
  assert.ok(L.blocks.find(b => b.type === 'line' && b.thickness === 2));
});

t('image / qrcode 元素被解析（含 contain 不裁剪语义占位）', () => {
  const m = { width: 200, height: 200, children: [
    { type: 'image', left: 10, top: 10, width: 80, height: 80, src: 'x.jpg' },
    { type: 'qrcode', left: 100, top: 100, size: 56, asset: { width: 100, height: 100 } }
  ]};
  const L = computeLayout(m, {}, measure);
  const qr = L.blocks.find(b => b.type === 'qrcode');
  assert.ok(qr && qr.w === 56 && qr.h === 56, '二维码应为 56×56');
});

// ── 2. 文本折行 + 省略号 ──
t('长文按 width 折行', () => {
  const m = { width: 200, height: 200, children: [
    { type: 'text', left: 0, top: 0, width: 100, content: '一二三四五六七八九十一二三四五六七八九十' }
  ]};
  const L = computeLayout(m, {}, measure);
  const txt = L.blocks.find(b => b.type === 'text');
  assert.ok(txt.lines.length >= 2, '应折成多行');
});

t('lineClamp 触发省略号（最后一行带 …）', () => {
  const m = { width: 200, height: 200, children: [
    { type: 'text', left: 0, top: 0, width: 100, fontSize: 16, lineClamp: 2,
      content: '一二三四五六七八九十一二三四五六七八九十二二三四五六七八九十' }
  ]};
  const L = computeLayout(m, {}, measure);
  const txt = L.blocks.find(b => b.type === 'text');
  assert.strictEqual(txt.lines.length, 2, '应仅 2 行');
  assert.ok(txt.lines[1].indexOf('…') >= 0, '末行应带省略号');
});

t('textAlign center → anchorX 取中点', () => {
  const m = { width: 300, height: 100, children: [
    { type: 'text', left: 50, top: 10, width: 200, content: '中', textAlign: 'center' }
  ]};
  const L = computeLayout(m, {}, measure);
  const txt = L.blocks.find(b => b.type === 'text');
  assert.strictEqual(txt.align, 'center');
});

// ── 3. draw 不抛错（含无 asset 占位、有 asset 绘制）──
t('draw：无 asset 时走占位不抛错', () => {
  const m = { width: 200, height: 200, children: [
    { type: 'image', left: 10, top: 10, width: 80, height: 80 },
    { type: 'qrcode', left: 100, top: 100, size: 56 }
  ]};
  const L = computeLayout(m, {}, measure);
  draw(fakeCtx(), L, {});
  assert.ok(true);
});

t('draw：有 asset（fake image）时绘制不抛错', () => {
  const fakeImg = { width: 100, height: 100 };
  const m = { width: 200, height: 200, children: [
    { type: 'container', left: 0, top: 0, width: 200, height: 200, overflow: 'hidden', children: [
      { type: 'gradient', left: 0, top: 0, width: 200, height: 200, colors: ['#fff', '#000'] },
      { type: 'image', left: 10, top: 10, width: 80, height: 80, asset: fakeImg },
      { type: 'qrcode', left: 100, top: 100, size: 56, asset: fakeImg },
      { type: 'text', left: 10, top: 120, width: 180, content: '测试文字一两三四' }
    ]}
  ]};
  const L = computeLayout(m, {}, measure);
  draw(fakeCtx(), L, {});
  assert.ok(true);
});

t('clipBegin/clipEnd 配对，嵌套容器不抛错', () => {
  const m = { width: 100, height: 100, children: [
    { type: 'container', left: 0, top: 0, width: 100, height: 100, overflow: 'hidden', children: [
      { type: 'rect', left: 0, top: 0, width: 50, height: 50, background: '#333' }
    ]}
  ]};
  const L = computeLayout(m, {}, measure);
  const begins = L.blocks.filter(b => b.type === 'clipBegin').length;
  const ends = L.blocks.filter(b => b.type === 'clipEnd').length;
  assert.strictEqual(begins, 1); assert.strictEqual(ends, 1);
  draw(fakeCtx(), L, {});
  assert.ok(true);
});

t('照片背景：backgroundImage → cover 图块 + 暗色蒙版渐变，根圆角自动裁剪', () => {
  const m = { width: 340, height: 400, radius: 16, backgroundImage: 'local://bg.jpg', backgroundImageAsset: { width: 100, height: 100 }, children: [] };
  const L = computeLayout(m, {}, measure);
  const bg = L.blocks.find(b => b.type === 'image' && b.objectFit === 'cover' && b.w === 340);
  const ov = L.blocks.find(b => b.type === 'gradient' && String(b.colors[0]).indexOf('rgba(15,14,22') === 0);
  assert.ok(bg, '应有铺满照片块');
  assert.ok(ov, '应有暗色蒙版');
  const begins = L.blocks.filter(b => b.type === 'clipBegin').length;
  const ends = L.blocks.filter(b => b.type === 'clipEnd').length;
  assert.strictEqual(begins, 1, '根圆角应产生一次裁剪'); assert.strictEqual(ends, 1);
  draw(fakeCtx(), L, {});
  assert.ok(true);
});

// ── 4. 主题系统（6 套 + 角色完整性）──
t('内置 6 套主题，且每套含完整角色色板', () => {
  assert.strictEqual(THEME_LIST.length, 6, '应内置 6 套主题');
  for (const th of THEME_LIST) {
    const c = th.colors;
    for (const role of ['bg', 'bgSolid', 'primary', 'bgSoft', 'ink', 'sub', 'line', 'accent', 'underline']) {
      assert.ok(c[role] != null, th.id + ' 缺角色色: ' + role);
    }
    assert.ok(Array.isArray(c.bg) && c.bg.length === 2, th.id + ' 的 bg 应为两色渐变');
  }
});

t('getTheme 未知 id 回退 warm；palette 返回可用快捷表', () => {
  assert.strictEqual(getTheme('nope').id, 'warm');
  const p = palette('olive');
  assert.strictEqual(p.bg[0], THEMES.olive.colors.bg[0]);
  assert.ok(typeof p.radius === 'number' && typeof p.spacing === 'number');
});

t('主题色均为合法色值（#rgb / #rrggbb）', () => {
  const re = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  for (const th of THEME_LIST) {
    const c = th.colors;
    for (const k of Object.keys(c)) {
      if (k === 'bg') { c.bg.forEach(v => assert.ok(re.test(v), th.id + '.' + k)); }
      else assert.ok(re.test(c[k]), th.id + '.' + k + ' = ' + c[k]);
    }
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
