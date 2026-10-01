// test/test_poster.js
// 海报长图模板单测：6 主题引擎消费不抛错、头像圆框、二维码、照片背景白字、流式高度。
'use strict';
const assert = require('assert');
const { buildPosterModel, W } = require('../utils/templates/poster');
const { computeLayout, draw } = require('../utils/core/render_engine');
const { THEME_LIST } = require('../utils/themes');

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
  avatar: 'local://avatar.jpg',
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

t('个性化三件套：头像圆框 + 昵称 + 专属二维码', () => {
  const model = buildPosterModel('warm', SAMPLE);
  const avatar = model.children.find(c => c.type === 'image' && c.src === SAMPLE.avatar);
  assert.ok(avatar && avatar.radius === avatar.width / 2, '头像应为圆形裁剪');
  assert.ok(model.children.find(c => c.type === 'qrcode'), '应有小程序码');
  assert.ok(model.children.find(c => c.type === 'text' && c.content === SAMPLE.nickname), '应有昵称');
});

t('无头像时回退主色首字圆形占位（不空缺）', () => {
  const model = buildPosterModel('warm', Object.assign({}, SAMPLE, { avatar: '' }));
  const circle = model.children.find(c => c.type === 'circle');
  assert.ok(circle, '应有首字圆形占位');
  assert.ok(model.children.find(c => c.type === 'text' && c.content === '春'), '应取昵称首字');
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
