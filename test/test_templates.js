// test/test_templates.js
// 模板库 × 渲染引擎 集成单测：6 类卡片 build 出的 model 必须能被引擎无错消费。
'use strict';
const assert = require('assert');
const { CARD_TYPES, buildCardModel, W } = require('../utils/templates/index');
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
  dailysign: { title: '10月1日 · 星期四', body: '把日子过成自己喜欢的样子。', qr: true },
  quote: { body: '把复杂的事，讲简单；把简单的事，做扎实。', author: '—— dudu', qr: true },
  recommend: { title: '好物', body: '用了就回不去', tag: '¥39', cover: 'local://x.jpg', qr: true },
  notice: { title: '公告', body: '本周六晚 8 点分享会', author: 'dudu', qr: true },
  checklist: { title: '待办', items: ['梳理三件要事', '写一条朋友圈', '读 10 页书'], qr: true },
  imagetext: { title: '一张图', body: '记录此刻', cover: 'local://y.jpg', qr: true }
};

t('CARD_TYPES 六类齐全', () => {
  assert.strictEqual(Object.keys(CARD_TYPES).length, 6);
});

t('6 类卡片 × 6 套主题：build 出的 model 全部被引擎消费不抛错', () => {
  for (const type of Object.keys(CARD_TYPES)) {
    for (const th of THEME_LIST) {
      const model = buildCardModel(type, th.id, SAMPLE[type]);
      assert.strictEqual(model.width, W, '统一卡片宽度 340');
      assert.ok(Array.isArray(model.gradient) && model.gradient.length === 2, type + '/' + th.id + ' 渐变两色');
      const layout = computeLayout(model, {}, null);
      assert.ok(layout.height > 0);
      draw(fakeCtx(), layout, {}); // 不抛错即通过
    }
  }
});

t('带 qr 时 model 含 qrcode 子元素，且靠右下（x + size ≈ W - pad）', () => {
  const model = buildCardModel('dailysign', 'warm', SAMPLE.dailysign);
  const qr = model.children.find(c => c.type === 'qrcode');
  assert.ok(qr, '应有 qrcode 子元素');
  assert.ok(qr.left + qr.size <= W && qr.left > W / 2, '二维码应靠右');
});

t('checklist：圆形徽章 + 条目进 children（告别 1.2.3. 硬怼）', () => {
  const model = buildCardModel('checklist', 'fresh', SAMPLE.checklist);
  const circles = model.children.filter(c => c.type === 'circle');
  const nums = model.children.filter(c => c.type === 'text' && ['1', '2', '3'].indexOf(c.content) >= 0);
  const itemTexts = model.children.filter(c => c.type === 'text' && SAMPLE.checklist.items.indexOf(c.content) >= 0);
  assert.strictEqual(circles.length, 3, '应有 3 个圆形徽章');
  assert.strictEqual(nums.length, 3, '应有 3 个徽章数字');
  assert.strictEqual(itemTexts.length, 3, '应有 3 条条目文本');
});

t('配图格式：统一 16:10 比例、圆角 12、底部渐晕与内描边', () => {
  const model = buildCardModel('recommend', 'warm', SAMPLE.recommend);
  const cover = model.children.find(c => c.type === 'image');
  assert.ok(cover, '应有配图块');
  assert.strictEqual(cover.height, Math.round((340 - 40) * 0.62), '配图应为 16:10 比例');
  assert.strictEqual(cover.radius, 12, '配图应统一圆角');
  const scrim = model.children.find(c => c.type === 'gradient' && c.colors[1] === 'rgba(0,0,0,0.18)');
  const stroke = model.children.find(c => c.type === 'rect' && c.border === 1);
  assert.ok(scrim && stroke, '应有底部渐晕与内描边');
});

t('底部信息行：分割线 + 落款与二维码同行（右下角不空旷）', () => {
  const model = buildCardModel('notice', 'zen', SAMPLE.notice);
  const line = model.children.find(c => c.type === 'line');
  const qr = model.children.find(c => c.type === 'qrcode');
  const foot = model.children.find(c => c.type === 'text' && c.content === SAMPLE.notice.author);
  assert.ok(line && qr && foot, '应有分割线/二维码/落款');
  const footCenter = foot.top + 9, qrCenter = qr.top + 28;
  assert.ok(Math.abs(footCenter - qrCenter) < 6, '落款应与二维码垂直居中对齐');
});

t('主题字体生效：文本 fontFamily 使用主题 cjkFont', () => {
  const model = buildCardModel('quote', 'zen', SAMPLE.quote);
  const body = model.children.find(c => c.type === 'text' && c.content === SAMPLE.quote.body);
  assert.ok(/serif/.test(body.fontFamily), 'zen 主题应为衬线字体栈');
});

t('日签正文居中（textAlign center），其余类型左对齐', () => {
  const sign = buildCardModel('dailysign', 'zen', SAMPLE.dailysign);
  const body = sign.children.find(c => c.type === 'text' && c.content === SAMPLE.dailysign.body);
  assert.ok(body && body.textAlign === 'center');
  const quote = buildCardModel('quote', 'zen', SAMPLE.quote);
  const qbody = quote.children.find(c => c.type === 'text' && c.content === SAMPLE.quote.body);
  assert.ok(qbody && (qbody.textAlign || 'left') === 'left');
});

t('主题切换生效：warm 与 olive 的背景渐变不同', () => {
  const a = buildCardModel('quote', 'warm', SAMPLE.quote);
  const b = buildCardModel('quote', 'olive', SAMPLE.quote);
  assert.notDeepStrictEqual(a.gradient, b.gradient);
});

t('带 bgImg 时 model 记录 backgroundImage（供页面加载 asset 后注入）', () => {
  const model = buildCardModel('imagetext', 'warm', Object.assign({}, SAMPLE.imagetext, { bgImg: 'local://bg.jpg' }));
  assert.strictEqual(model.backgroundImage, 'local://bg.jpg');
});

t('照片背景模式：正文/标题自动转白字（引擎叠暗色蒙版后可读）', () => {
  const { getTheme } = require('../utils/themes');
  const a = buildCardModel('quote', 'warm', SAMPLE.quote);                       // 无背景图 → 主题 ink
  const b = buildCardModel('quote', 'warm', Object.assign({}, SAMPLE.quote, { bgImg: 'local://bg.jpg' }));
  const ta = a.children.find(c => c.type === 'text' && c.content === SAMPLE.quote.body);
  const tb = b.children.find(c => c.type === 'text' && c.content === SAMPLE.quote.body);
  assert.strictEqual(ta.color, getTheme('warm').colors.ink); // 无背景图 → 主题正文色
  assert.strictEqual(tb.color, '#ffffff', '背景图模式下正文应转白');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
