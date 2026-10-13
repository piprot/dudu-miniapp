// test/test_templates.js
// 模板库 × 渲染引擎 集成单测：6 类卡片 build 出的 model 必须能被引擎无错消费。
'use strict';
const assert = require('assert');
const { CARD_TYPES, buildCardModel, W } = require('../utils/templates/index');
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

t('底部信息行：落款与二维码同行（右下角不空旷），且**不再画分割线**', () => {
  const model = buildCardModel('notice', 'zen', SAMPLE.notice);
  const qr = model.children.find(c => c.type === 'qrcode');
  const foot = model.children.find(c => c.type === 'text' && c.content === SAMPLE.notice.author);
  assert.ok(qr && foot, '应有二维码与落款');
  // 2026-10-13 用户反馈「文艺/现代/温暖/海报怎么中间有一条横线，这是不对的」。
  // 那条线是底部分隔线，旧版渲染引擎把它画成竖线（淡色、几乎看不见），修好 line
  // 语义后才变成横贯卡面的横线被看到。用户要的是没有线的那版——所以现在**断言不存在**，
  // 别让它再回来。正文与落款之间靠留白分。
  assert.ok(!model.children.some(c => c.type === 'line'),
    '卡片版式不应再有分隔线（' + (model.children.find(c => c.type === 'line') || {}).top + '）');
  const footCenter = foot.top + 9, qrCenter = qr.top + 28;
  assert.ok(Math.abs(footCenter - qrCenter) < 6, '落款应与二维码垂直居中对齐');
});

t('温暖(warm)：正文不垫色块（2026-10-13 用户否掉「奶油便签」）', () => {
  // warm 风格曾给正文垫一块 p.bgSoft 浅底大圆角块。卡片本来就浅底、构图居中，
  // 再垫一块和正文差不多大的浅色方块，观感是"糊了一块"。已撤除，断言防回归。
  const m = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'warm' }, SAMPLE.quote));
  const body = m.children.find(c => c.type === 'text' && c.content === SAMPLE.quote.body);
  const behind = m.children.filter(c => c.type === 'rect' && c !== body &&
    c.width >= 300 && c.height >= 40);
  assert.strictEqual(behind.length, 0,
    'warm 正文区不应有垫块，实际 ' + JSON.stringify(behind.map(c => c.width + 'x' + c.height)));
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
  const { getTheme } = require('../utils/themes/index.js');
  const a = buildCardModel('quote', 'warm', SAMPLE.quote);                       // 无背景图 → 主题 ink
  const b = buildCardModel('quote', 'warm', Object.assign({}, SAMPLE.quote, { bgImg: 'local://bg.jpg' }));
  const ta = a.children.find(c => c.type === 'text' && c.content === SAMPLE.quote.body);
  const tb = b.children.find(c => c.type === 'text' && c.content === SAMPLE.quote.body);
  assert.strictEqual(ta.color, getTheme('warm').colors.ink); // 无背景图 → 主题正文色
  assert.strictEqual(tb.color, '#ffffff', '背景图模式下正文应转白');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
