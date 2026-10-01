// test/test_fixes_regression.js
// 针对本次修复的纯逻辑单测（node 直接跑，无需 wx 环境）。
// 覆盖：① 排版优化三按钮不再因 \p 正则崩；② 分镜高度不再溢出；③ 卡片标题/落款行距加宽。
'use strict';
const assert = require('assert');

const TOOLS = require('../utils/text_tools');
const { computeLayout, wrapText } = require('../utils/comic_render');
const { parseScript } = require('../utils/comic_markup');
const { computeCardLayout, drawCard, DEFAULTS: CARD } = require('../utils/card_render');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

// ── 文本宽度 mock（与 wrapText 使用同一 measure，保证可比性）──
function measure(text, font) {
  const px = parseInt(String(font), 10) || 14;
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c >= 0x2e80 && c <= 0xffef) w += px;       // CJK / 全角
    else if (ch === ' ') w += px * 0.3;
    else w += px * 0.55;
  }
  return w;
}

// 用于 drawCard 渲染单测的假 ctx（无需真实 canvas；createLinearGradient 等返回 noop）。
function fakeCtxForBg() {
  const noop = () => {};
  return {
    font: '', textBaseline: '', textAlign: '', lineWidth: 0, fillStyle: '', strokeStyle: '',
    clearRect: noop, fillRect: noop, fillText: noop, beginPath: noop,
    moveTo: noop, arcTo: noop, closePath: noop, fill: noop, stroke: noop,
    save: noop, restore: noop, clip: noop, scale: noop,
    drawImage: noop, measureText: (t) => ({ width: String(t).length * 8 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    roundRect: noop
  };
}

console.log('\n[1] 排版优化：三种工具都能产出变化且不抛错（修复 \\p 正则崩溃）');
t('antiFold 长文无标点 -> 有换行变化', () => {
  const raw = '今天天气很好我和朋友去江边散步风很轻我们聊了很久关于未来的打算';
  const out = TOOLS.antiFold(raw, 20);
  assert.ok(out && out.length > 0, '输出不应为空');
  assert.notStrictEqual(out, raw, '防折叠应产生折行/变化');
});
t('antiFold 带标点 -> 按句分段', () => {
  const raw = '第一句说点什么。第二句再说点别的！第三句收个尾？';
  const out = TOOLS.antiFold(raw, 20);
  assert.ok(out.split('\n').length >= 3, '应至少拆成 3 行');
});
t('insertEmoji 命中关键词补 emoji', () => {
  const out = TOOLS.insertEmoji('今天天气很好，我很开心');
  assert.ok(out.indexOf('😊') >= 0, '输出应含 emoji😊: ' + out);
});
t('insertEmoji 句尾已有 emoji 不重复堆叠', () => {
  const out = TOOLS.insertEmoji('今天天气很好，我很开心😊');
  assert.strictEqual(out.split('😊').length - 1, 1, '不应重复堆叠: ' + out);
});
t('autoSplit 多句 -> 一句一行', () => {
  const out = TOOLS.autoSplit('成长需要时间。学习让人进步。');
  assert.ok(out.split('\n').length >= 2);
});
t('countStats 统计 emoji 数量（无 \\p 依赖）', () => {
  const s = TOOLS.countStats('开心😊 努力💪');
  assert.strictEqual(s.emojiCount, 2, '应统计到 2 个 emoji');
  // 字数按 UTF-16 码元计（emoji 代理对计 2），与既有行为一致；此处仅校验为有效数字
  assert.ok(s.chars >= 6 && s.chars <= 8, '字数不含空白，应在 6~8 之间: ' + s.chars);
});
t('applyOpt 等价流程：任意文本三种操作均不抛错且产出非空', () => {
  const raw = '我们一直在努力成长，学习新东西让人开心。';
  ['antiFold', 'emoji', 'split'].forEach(type => {
    let out;
    if (type === 'antiFold') out = TOOLS.antiFold(raw, 20);
    else if (type === 'emoji') out = TOOLS.insertEmoji(raw);
    else out = TOOLS.autoSplit(raw);
    const stats = TOOLS.countStats(out);
    assert.ok(out && out.length > 0, type + ' 应输出非空');
    assert.ok(typeof stats.emojiCount === 'number');
  });
});

console.log('\n[2] 分镜渲染：画布高度足以容纳文字（修复溢出）');
// 复刻 draw 的真实内容高度（与 computeLayout 现在用的公式一致）
function drawContentHeight(panel, o) {
  const panelW = (o.width - o.pad * 2 - o.gap * (o.cols - 1)) / o.cols;
  const textW = panelW - o.panelPad * 2 - o.balloonPad * 2;
  let h = o.panelPad;
  const header = panel.label || panel.scene || '';
  if (header) h += o.headerLH;
  for (const ln of panel.lines) {
    const txt = (ln.type === 'speech' && ln.who ? ln.who + '：' : '') + ln.text;
    const wrapped = wrapText(txt, textW, measure);
    const bh = wrapped.length * o.lineHeight + o.balloonPad * 2;
    h += bh + (ln.type === 'speech' ? 8 : 6);
  }
  if (panel.lines.length === 0) h += o.lineHeight + o.balloonPad * 2;
  h += o.panelPad;
  return h;
}
// 旧公式（修复前）：漏算旁白内边距 + 气泡间距 → 高度偏小
function oldHeight(panel, o) {
  const panelW = (o.width - o.pad * 2 - o.gap * (o.cols - 1)) / o.cols;
  const textW = panelW - o.panelPad * 2 - o.balloonPad * 2;
  let h = o.panelPad * 2 + o.headerLH;
  if (panel.scene) h += o.headerLH;
  for (const ln of panel.lines) {
    const txt = (ln.type === 'speech' && ln.who ? ln.who + '：' : '') + ln.text;
    const wrapped = wrapText(txt, textW, measure);
    h += wrapped.length * o.lineHeight + (ln.type === 'speech' ? o.balloonPad * 2 : o.balloonPad);
  }
  if (panel.lines.length === 0) h += o.lineHeight;
  return Math.max(h, 120);
}

const STORY_HEAVY = `# 长旁白测试
【分镜1】
旁白：这是第一句很长的旁白用来验证多行文字是否会在渲染时溢出面板框外面造成重叠的问题确实存在需要修复
旁白：这是第二句同样很长的旁白继续叠加高度看看会不会超出
旁白：这是第三句旁白再次叠加确认高度算法是否正确`;

t('旧公式对多行旁白面板确实会算小（证明 bug 存在）', () => {
  const model = parseScript(STORY_HEAVY);
  const p = model.panels[0];
  const o = Object.assign({}, require('../utils/comic_render').DEFAULTS, { width: 340, cols: 2 });
  assert.ok(oldHeight(p, o) < drawContentHeight(p, o), '旧高度应小于真实内容高度（即会溢出）');
});
t('修复后 computeLayout 高度 >= 真实内容高度（不再溢出）', () => {
  const model = parseScript(STORY_HEAVY);
  const o = Object.assign({}, require('../utils/comic_render').DEFAULTS, { width: 340, cols: 2 });
  const layout = computeLayout(model, { width: 340, cols: 2 }, measure);
  // 每个 cell 的预留高度都应 >= 该面板真实绘制内容高度
  layout.rows.forEach(row => row.forEach(cell => {
    const dh = drawContentHeight(cell.panel, o);
    assert.ok(cell.h + 0.5 >= dh, 'cell.h(' + cell.h + ') 应 >= 内容高度(' + dh.toFixed(1) + ')');
  }));
});
t('官方示例（story/sell）渲染不溢出', () => {
  const samples = [
    `# 江边的告别\n【分镜1】\n场景：江边傍晚\n旁白：那天下班，风很轻\n小明：你真的要走了吗\n小红：嗯，车票已经买好了\n情绪：忧伤\n\n【分镜2】\n旁白：很多年后，我还记得那个背影\n情绪：温馨`,
    `# 一本让我开窍的书\n【分镜1】\n旁白：以前写文案像挤牙膏\n我：到底差在哪\n情绪：紧张\n\n【分镜2】\n旁白：直到用了「结构模板」\n我：原来不是文笔，是骨架\n情绪：欢乐`
  ];
  const o = Object.assign({}, require('../utils/comic_render').DEFAULTS, { width: 340, cols: 2 });
  samples.forEach((s, i) => {
    const model = parseScript(s);
    const layout = computeLayout(model, { width: 340, cols: 2 }, measure);
    layout.rows.forEach(row => row.forEach(cell => {
      assert.ok(cell.h + 0.5 >= drawContentHeight(cell.panel, o), 'sample#' + i + ' 溢出');
    }));
  });
});

console.log('\n[3] 卡片：标题 / 落款 / 出处行距加宽');
t('titleLH 已加宽到 >=40', () => { assert.ok(CARD.titleLH >= 40, 'titleLH=' + CARD.titleLH); });
t('smallLH（落款/出处）已加宽到 >=22', () => { assert.ok(CARD.smallLH >= 22, 'smallLH=' + CARD.smallLH); });
t('两行标题 -> 高度 = 行数 * titleLH', () => {
  const title = '这是一行标题这是一行标题这是一行标题这是一行标题'; // 24 字必超宽 -> 多行
  const layout = computeCardLayout({ type: 'notice', title: title, body: '正文', author: '' }, { width: 340 }, measure);
  const titleBlock = layout.blocks.find(b => b.kind === 'title');
  assert.ok(titleBlock, '应有标题块');
  const expLines = wrapText(title, 340 - CARD.pad * 2, measure).length;
  assert.ok(expLines >= 2, '测试标题应折成 >=2 行');
  assert.ok(Math.abs(titleBlock.h - expLines * CARD.titleLH) < 1, '标题块高度应为 行数*titleLH');
});
t('两行落款/出处 -> 高度 = 2 * smallLH 且底部间距加宽', () => {
  const layout = computeCardLayout({ type: 'notice', title: '', body: '正文', author: '落款出处第一行占位占位\n落款出处第二行占位占位' }, { width: 340 }, measure);
  const footer = layout.blocks.find(b => b.kind === 'footer');
  assert.ok(footer, '应有落款块');
  assert.ok(Math.abs(footer.h - 2 * CARD.smallLH) < 1, '落款块高度应为 2*smallLH');
});

console.log('\n[4] 卡片：所有卡片类型都带小程序码，且码在卡片内、不重叠');
const QR_TYPES = ['dailysign', 'quote', 'recommend', 'notice', 'checklist', 'imagetext'];
const QR_SAMPLE = {
  dailysign: { type: 'dailysign', title: '9月30日 星期三', body: '把日子过成自己喜欢的样子。' },
  quote:     { type: 'quote', title: '', body: '把复杂的事，讲简单；把简单的事，做扎实。', author: 'dudu 画面感' },
  recommend: { type: 'recommend', title: '推荐一件好物', body: '用了就回不去的小确幸。', tag: '¥ 39 起', cover: '/cover.png' },
  notice:    { type: 'notice', title: '活动公告', body: '本周六晚 8 点，社群分享会准时开始。', author: 'dudu 画面感' },
  checklist: { type: 'checklist', title: '今日待办', items: ['梳理今天的三件要事', '写下一条朋友圈文案', '读 10 页书'] },
  imagetext: { type: 'imagetext', title: '一张图，一段话', body: '记录此刻，分享给在意的人。', cover: '/cover.png' }
};
QR_TYPES.forEach(tp => {
  t('[' + tp + '] 带 qr 时布局含小程序码且码在卡片内', () => {
    const m = Object.assign({ qr: '/images/qrcode_miniapp.png' }, QR_SAMPLE[tp]);
    const layout = computeCardLayout(m, { width: 340 }, measure);
    assert.ok(layout.qr, tp + ' 应带小程序码');
    const q = layout.qr;
    assert.ok(q.x >= 0 && q.y >= 0, tp + ' 码坐标应在画布内');
    assert.ok(q.x + q.w <= layout.width + 0.5, tp + ' 码右缘不应超出卡片宽度');
    assert.ok(q.y + q.h <= layout.height + 0.5, tp + ' 码底缘不应超出卡片高度');
  });
});
t('无 qr 字段时布局不带小程序码（不污染普通渲染）', () => {
  const layout = computeCardLayout({ type: 'notice', title: '标题', body: '正文', author: '' }, { width: 340 }, measure);
  assert.ok(!layout.qr, '不带 qr 时不应出现小程序码块');
});

console.log('\n[5] 卡片：类型主题背景 + 每日日签居中');
const BG_TYPES = ['dailysign', 'quote', 'recommend', 'notice', 'checklist', 'imagetext'];
BG_TYPES.forEach(tp => {
  t('[' + tp + '] 布局含类型主题渐变背景（两色，合法色值）', () => {
    const layout = computeCardLayout({ type: tp, title: 'T', body: 'B' }, { width: 340 }, measure);
    assert.ok(layout.bg && Array.isArray(layout.bg.grad) && layout.bg.grad.length === 2, tp + ' 应有两色渐变背景');
    assert.ok(/^#/.test(layout.bg.grad[0]) && /^#/.test(layout.bg.grad[1]), tp + ' 渐变色应为合法色值');
  });
});
t('仅每日日签居中（center=true），其余类型左对齐', () => {
  const sign = computeCardLayout({ type: 'dailysign', title: '9月30日', body: '今天也要加油' }, { width: 340 }, measure);
  const quote = computeCardLayout({ type: 'quote', body: '一句话' }, { width: 340 }, measure);
  assert.strictEqual(sign.center, true, '日签应居中');
  assert.strictEqual(quote.center, false, '金句卡不应居中');
});
t('drawCard：渐变背景与照片背景均不抛错', () => {
  const grad = computeCardLayout({ type: 'quote', body: '一句话' }, { width: 340 }, measure);
  drawCard(fakeCtxForBg(), grad, { model: { type: 'quote' }, coverImg: null, qrImg: null });
  const photo = computeCardLayout({ type: 'quote', body: '一句话' }, { width: 340 }, measure);
  drawCard(fakeCtxForBg(), photo, { model: { type: 'quote' }, coverImg: null, qrImg: null, bgImg: { width: 800, height: 600 } });
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
