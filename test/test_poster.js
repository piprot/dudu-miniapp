// test/test_poster.js
// 海报长图模板单测：6 主题引擎消费不抛错、落款钉底、单一信息源、
// 提示不折行、照片背景白字、流式高度、合规（无头像/署名占位）。
'use strict';
const assert = require('assert');
const { buildPosterModel, W, PAD } = require('../utils/templates/poster');
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

t('落款三件套：品牌名/昵称 + 专属二维码（不再写「长按识别」引导语）', () => {
  const model = buildPosterModel('warm', SAMPLE);
  assert.ok(model.children.find(c => c.type === 'qrcode'), '应有小程序码');
  assert.ok(model.children.find(c => c.type === 'text' && c.content === SAMPLE.nickname), '昵称作为落款品牌名');
  // 卡面不写引导文案——海报是分享到站外的成品，写「长按识别」像广告
  assert.ok(!model.children.find(c => c.type === 'text' && /长按识别/.test(String(c.content))),
    '落款不应出现「长按识别小程序码」引导文案');
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

t('落款不重复画署名：中段已有 `—— 作者`，落款不得再画一遍', () => {
  const m = buildPosterModel('warm', { quote: '短句。', author: '鲁迅' });
  // 同一条署名只能出现一次（旧版落款重复渲染，且中段叠成 `—— —— 鲁迅`）
  const named = m.children.filter(c => c.type === 'text' && /鲁迅/.test(String(c.content)));
  assert.strictEqual(named.length, 1, `署名应只出现一次，实际${named.length}次`);
  assert.ok(/^—— /.test(named[0].content), '署名格式应为 `—— 作者`，不能出现双破折号');
  assert.ok(!/—— —— /.test(named[0].content), '破折号不得叠加');

  // 只有 source、没有 author 时，落款才用 source 兜底
  const m2 = buildPosterModel('warm', { quote: '短句。', source: '《朝花夕拾》' });
  assert.ok(m2.children.find(c => c.type === 'text' && /朝花夕拾/.test(String(c.content))), '无 author 时落款应用 source 兜底');

  // 两者都没有 → 不留空文本占位
  const m3 = buildPosterModel('warm', { quote: '短句。' });
  assert.strictEqual(m3.children.filter(c => c.type === 'text' && !String(c.content || '').trim()).length, 0,
    '无来源时不应渲染空文本占位');
});

t('署名「—— 作者」不折行：容器给足整行宽 + 右对齐（2026-10-13 真机折行修复）', () => {
  // 用户反馈：海报里「—— dudu」的 dudu 掉到了第二行。
  // 根因是这里以前把容器宽度卡成 `Math.ceil(measure(text, 13))`——正好等于测量值。
  // measure 走 canvas 的 sans-serif，渲染走主题的 PingFang/雅黑，差一两个 px 就被
  // wrapText 判成「装不下」而折行；而且署名区高度只按一行(20px)累加，折行会压住
  // 下方正文。修法：容器给整行 innerW、靠 textAlign 右对齐，不再依赖测量精度。
  const m = buildPosterModel('warm', { quote: '短句。', author: 'dudu' });
  const sign = m.children.find(c => c.type === 'text' && /^—— /.test(String(c.content)));
  assert.ok(sign, '应有 `—— 作者` 署名节点');
  const innerW = W - PAD * 2;                     // 别硬编码 PAD，跟着模板走
  assert.strictEqual(sign.width, innerW,
    '署名容器应是整行宽（' + innerW + '），实际 ' + sign.width + '——宽度卡太窄就会折行');
  assert.strictEqual(sign.textAlign, 'right', '署名应靠右对齐');
  assert.strictEqual(sign.left, PAD, '署名容器左边界应是 PAD');
  assert.strictEqual(sign.lineClamp, 1, '署名应限制单行（超长截断，不能撑破版心）');

  // 任何长度的作者名都只占一行：容器宽度不随内容变化，这是防折行的关键
  for (const a of ['dudu', '鲁迅', '欧内斯特·米勒尔·海明威', '一个特别特别长的署名名字测试']) {
    const mm = buildPosterModel('warm', { quote: '短句。', author: a });
    const s = mm.children.find(c => c.type === 'text' && /^—— /.test(String(c.content)));
    assert.strictEqual(s.width, innerW, '作者「' + a + '」的署名容器宽度不该随内容变');
  }
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
