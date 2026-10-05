// test/test_poster.js
// 海报长图模板单测：6 主题引擎消费不抛错、落款钉底、单一信息源、
// 提示不折行、照片背景白字、流式高度、合规（无头像/署名占位）。
'use strict';
const assert = require('assert');
const { buildPosterModel, W } = require('../utils/templates/poster');
const { computeLayout, draw } = require('../utils/core/render_engine');
const { THEME_LIST } = require('../utils/themes/index.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

function fakeCtx() {
  const noop = () => {};
  return {
    font: '', textBaseline: '', textAlign: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
    clearRect: noop, fillRect: noop, fillText: noop, beginPath: noop,
    moveTo: noop, arcTo: noop, arc: noop, closePath: noop, fill: noop, stroke: noop,
    save: noop, restore: noop, clip: noop, scale: noop, rect: noop,
    drawImage: noop, measureText: (t) => ({ width: String(t).length * 8 }),
    createLinearGradient: () => ({ addColorStop: noop })
  };
}

const SAMPLE = {
  title: '把日子过成海报',
  quote: '把复杂的事，讲简单；把简单的事，做扎实。',
  body: '这是补充正文，写一段今天想说的话。',
  author: 'dudu',
  nickname: '春英',
  dateLabel: '2026年10月1日',
  qr: '/images/qrcode_miniapp.png'
};

t('6 套主题全部被引擎消费不抛错，竖版 375 宽', () => {
  for (const th of THEME_LIST) {
    const model = buildPosterModel(th.id, SAMPLE);
    assert.strictEqual(model.width, W);
    assert.ok(model.height >= 480, '海报应为长图高度');
    const layout = computeLayout(model, {}, null);
    draw(fakeCtx(), layout, {});
  }
  assert.ok(true);
});

t('落款三件套：品牌名/昵称 + 长按提示 + 专属二维码', () => {
  const model = buildPosterModel('warm', SAMPLE);
  assert.ok(model.children.find(c => c.type === 'qrcode'), '应有小程序码');
  assert.ok(model.children.find(c => c.type === 'text' && c.content === SAMPLE.nickname), '昵称作为落款品牌名');
  assert.ok(model.children.find(c => c.type === 'text' && c.content === '长按识别小程序码'), '应有长按提示');
});

t('落款钉底：内容短时落款贴住底边，不留死白', () => {
  const model = buildPosterModel('warm', { quote: '短句。' });
  const line = model.children.find(c => c.type === 'line');
  assert.ok(line, '应有落款分隔线');
  assert.ok(Math.abs((line.top + 102) - model.height) <= 2, '分隔线+落款区(102) 应正好到画布底');
});

t('单一信息源：品牌与日期全图各只出现一次（旧版顶部/底部重复）', () => {
  const model = buildPosterModel('warm', { quote: '短句。', dateLabel: '10月5日 · 星期一' });
  const brands = model.children.filter(c => c.type === 'text' && c.content === 'dudu 画面感');
  assert.strictEqual(brands.length, 1, '品牌只出现一次（底部落款）');
  const dates = model.children.filter(c => c.type === 'text' && c.content === '10月5日 · 星期一');
  assert.strictEqual(dates.length, 1, '日期只出现一次（顶部信息行）');
});

t('长按提示不折行：提示宽度足够一行放下（旧版挤在码宽里折两行）', () => {
  const model = buildPosterModel('warm', { quote: '短句。' });
  const hint = model.children.find(c => c.type === 'text' && c.content === '长按识别小程序码');
  assert.ok(hint, '应有长按提示');
  assert.ok(hint.width >= 90, '提示宽度应≥一行文字宽（8字×10px≈80px）');
});

t('合规：不渲染头像/首字圆形占位（署名已随整改移除，旧版圆占位与文字叠加出橙点 bug）', () => {
  const model = buildPosterModel('warm', SAMPLE);
  assert.ok(!model.children.find(c => c.type === 'circle'), '不应再有首字圆形占位');
  assert.ok(!model.children.find(c => c.type === 'image'), '不应再渲染头像');
});

t('照片背景模式：quote/正文转白字', () => {
  const model = buildPosterModel('warm', Object.assign({}, SAMPLE, { bgImg: 'local://bg.jpg' }));
  const quote = model.children.find(c => c.type === 'text' && c.content === SAMPLE.quote);
  assert.strictEqual(quote.color, '#ffffff');
});

t('流式高度：内容变长海报变高（不是固定高度裁切）', () => {
  const short = buildPosterModel('warm', { quote: '短句。' });
  const long = buildPosterModel('warm', { quote: '长句。'.repeat(60) });
  assert.ok(long.height > short.height, '长内容应更高');
});

t('金句与标题同时存在时都有落位', () => {
  const model = buildPosterModel('zen', SAMPLE);
  assert.ok(model.children.find(c => c.type === 'text' && c.content === SAMPLE.title));
  assert.ok(model.children.find(c => c.type === 'text' && c.content === SAMPLE.quote));
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
