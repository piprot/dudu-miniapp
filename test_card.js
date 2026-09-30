// test_card.js —— 卡片渲染器纯函数单测（Node 环境，无需小程序运行时）。
// 运行：node test_card.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  CARD_TEMPLATES, computeCardLayout, drawCard, roundRectPath, wrapText
} = require('./utils/card_render');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// 仿真 measure：CJK 字符按字号宽，ASCII 按半宽（足够验证布局与折行）。
function mkMeasure(fontPx) {
  return (t) => {
    let w = 0;
    for (const ch of String(t)) {
      w += /[\x00-\xff]/.test(ch) ? fontPx * 0.5 : fontPx;
    }
    return w;
  };
}
const FONT = 16; // 近似正文字号用于估算
const measure = mkMeasure(FONT);

console.log('— 模板元信息 —');
ok('6 类模板齐全（含每日日签）', Object.keys(CARD_TEMPLATES).length === 6 && !!CARD_TEMPLATES.dailysign);
ok('quote 无 cover', CARD_TEMPLATES.quote.hasCover === false);
ok('recommend 需 cover', CARD_TEMPLATES.recommend.hasCover === true);
ok('checklist 字段含 items', CARD_TEMPLATES.checklist.fields.indexOf('items') >= 0);

console.log('— 布局：金句卡 —');
const q = computeCardLayout({ type: 'quote', body: '把复杂的事，讲简单；把简单的事，做扎实。', author: '—— dudu' }, { width: 340 }, measure);
ok('金句卡返回布局', q && q.type === 'quote');
ok('金句卡含 pill 块', q.blocks.some(b => b.kind === 'pill'));
ok('金句卡含 body 块(quote)', q.blocks.some(b => b.kind === 'body' && b.quote === true));
ok('金句卡含 footer 块', q.blocks.some(b => b.kind === 'footer'));
ok('金句卡无 cover', q.cover === null);
ok('金句卡高度 > 0', q.height > 0);
ok('金句卡宽 = 340', q.width === 340);

console.log('— 布局：种草卡（含 cover 占位）—');
const rec = computeCardLayout({ type: 'recommend', title: '好物', body: '用了就回不去', tag: '¥39', cover: 'local://x.jpg' }, { width: 340 }, measure);
ok('种草卡含 cover 区域', rec.cover && rec.cover.w > 0 && rec.cover.h > 0);
ok('种草卡含 tag 块', rec.blocks.some(b => b.kind === 'tag'));

console.log('— 布局：公告卡 —');
const nt = computeCardLayout({ type: 'notice', title: '公告', body: '本周六晚 8 点分享会', author: 'dudu 9月' }, { width: 340 }, measure);
ok('公告卡含 title 块', nt.blocks.some(b => b.kind === 'title'));

console.log('— 布局：清单卡（逐条条目）—');
const cl = computeCardLayout({ type: 'checklist', title: '待办', items: ['梳理三件要事', '写一条朋友圈', '读 10 页书'] }, { width: 340 }, measure);
const itemBlocks = cl.blocks.filter(b => b.kind === 'item');
ok('清单卡条目数 = 3', itemBlocks.length === 3);
ok('清单卡 item idx 连续', itemBlocks[0].idx === 0 && itemBlocks[2].idx === 2);

console.log('— 布局：图文卡（含 cover）—');
const it = computeCardLayout({ type: 'imagetext', title: '一张图', body: '记录此刻', cover: 'local://y.jpg' }, { width: 340 }, measure);
ok('图文卡含 cover 区域', it.cover && it.cover.h > 0);

console.log('— 容错：未知类型回退 quote —');
const fb = computeCardLayout({ type: 'unknown_x', body: 'hello' }, { width: 340 }, measure);
ok('未知类型回退为 quote', fb.type === 'quote');

console.log('— 容错：空内容也返回合法高度 —');
const empty = computeCardLayout({}, { width: 340 }, measure);
ok('空模型高度合法', empty.height > 0 && empty.width === 340);

console.log('— 每日日签场景（quote 模板 + 标题写日期）—');
const sign = computeCardLayout({
  type: 'quote', title: '9月30日 · 星期三', body: '把复杂的事，讲简单；把简单的事，做扎实。', author: 'dudu 画面感 · 每日日签'
}, { width: 340 }, measure);
const signTitle = sign.blocks.find(b => b.kind === 'title');
const signBody = sign.blocks.find(b => b.kind === 'body');
const signFooter = sign.blocks.find(b => b.kind === 'footer');
ok('日签：quote 模板含标题块（日期可独立成行）', !!signTitle && signTitle.text.length === 1);
ok('日签：含金句正文与落款', !!signBody && !!signFooter);
ok('日签：卡片高度合理（不溢出）', sign.height > 0 && sign.height < 400);

console.log('— 每日日签：自动小程序码（右下角，全自动）—');
ok('日签：包内二维码图片存在（images/qrcode_miniapp.png）',
  fs.existsSync(path.join(__dirname, 'images', 'qrcode_miniapp.png')),
  '二维码图丢失 → 日签右下角只画占位框；重新把小程序码放进 images/qrcode_miniapp.png');
const signQr = computeCardLayout({
  type: 'dailysign', title: '', body: '把日子过成自己喜欢的样子。', qr: '/images/qrcode_miniapp.png'
}, { width: 340 }, measure);
ok('日签：类型识别为 dailysign、角标为「每日日签」', signQr.type === 'dailysign' && signQr.pill === '每日日签');
ok('日签：右下角二维码区块（56×56，右对齐）',
  signQr.qr && signQr.qr.w === 56 && signQr.qr.h === 56 && Math.abs(signQr.qr.x + signQr.qr.w - (340 - 22)) < 1);
ok('日签：标题留空时不产生标题块（运行时由 card.js 自动填今天日期）', !signQr.blocks.some(b => b.kind === 'title'));
ok('日签：无文字落款（author 为空即无 footer）', !signQr.blocks.some(b => b.kind === 'footer'));
try {
  drawCard(fakeCtx(), signQr, { model: signQr, coverImg: null, qrImg: { width: 430, height: 429 } });
  ok('日签：drawCard 带二维码图不抛错', true);
} catch (e) {
  ok('日签：drawCard 带二维码图不抛错 -> ' + e.message, false);
}

console.log('— 金句截断：超过 maxQuoteLines 只取前 N 行 —');
const longBody = Array.from({ length: 12 }, (_, i) => '金句行' + i).join('');
const ql = computeCardLayout({ type: 'quote', body: longBody }, { width: 340 }, measure);
const qb = ql.blocks.find(b => b.kind === 'body');
ok('金句不超过 6 行', qb.text.length <= 6);

console.log('— drawCard 不抛错（用 fake ctx）—');
function fakeCtx() {
  const noop = () => {};
  return {
    font: '', textBaseline: '', textAlign: '',
    clearRect: noop, fillRect: noop, fillText: noop, beginPath: noop,
    moveTo: noop, arcTo: noop, closePath: noop, fill: noop, stroke: noop,
    save: noop, restore: noop, clip: noop, scale: noop,
    drawImage: noop, measureText: (t) => ({ width: String(t).length * 8 }),
    roundRect: noop
  };
}
try {
  const layoutAll = computeCardLayout({ type: 'recommend', title: 'T', body: 'B', tag: '¥1', cover: 'local://z.jpg' }, { width: 340 }, measure);
  drawCard(fakeCtx(), layoutAll, { model: { type: 'recommend' }, coverImg: null });
  drawCard(fakeCtx(), q, { model: { type: 'quote' } });
  ok('drawCard 渲染各类型不抛错', true);
} catch (e) {
  ok('drawCard 渲染各类型不抛错 -> ' + e.message, false);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
