// tools/build_card_preview.js
// 生成自包含的可视化冒烟预览 tools/card_preview.html：
// 内联「真实的」渲染引擎 / 主题 / 模板 / 文案库源码，在浏览器 canvas 上画出
// 6 类卡片 × 6 套主题（36 张）+ 照片背景模式演示 + 今日推荐文案，
// 让你在真机/开发者工具之前，直接用浏览器确认本次 UI 优化的真实效果。
// 运行：node tools/build_card_preview.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const engine = read('utils/core/render_engine.js');
const themes = read('utils/themes/index.js');
const templates = read('utils/templates/index.js');
const daily = read('utils/templates/daily.js');
const posterTpl = read('utils/templates/poster.js');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dudu 画面感 · 卡片渲染可视化冒烟预览（真实引擎代码）</title>
<style>
  body { margin: 0; padding: 24px; background: #17181c; color: #e8e4da;
         font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .sub { font-size: 13px; color: #9a958a; margin-bottom: 18px; line-height: 1.7; }
  .sub b { color: #e8c06a; }
  .grid { display: flex; flex-wrap: wrap; gap: 18px; }
  .cell { width: 240px; }
  .cell .tag { font-size: 12px; color: #9a958a; margin-bottom: 6px; }
  .cell canvas { width: 224px; box-shadow: 0 6px 24px rgba(0,0,0,.45); border-radius: 10px; }
  .demo { margin-top: 28px; padding-top: 18px; border-top: 1px dashed #3a3b40; }
</style>
</head>
<body>
<h1>dudu 画面感 · 卡片渲染可视化冒烟预览</h1>
<div class="sub" id="info"></div>
<div class="grid" id="grid"></div>
<div class="demo">
  <h1>照片背景模式演示（铺满 + 暗色蒙版 + 白字）</h1>
  <div class="grid" id="grid2"></div>
</div>
<div class="demo">
  <h1>海报长图（6 主题 + 照片背景 · 头像首字占位 + 昵称 + 专属码）</h1>
  <div class="grid" id="grid3"></div>
</div>

<script>
const __mods = {};
function __def(name, fn) { const m = { exports: {} }; fn(m, m.exports, __req); __mods[name] = m; }
const __MAP = { '../themes': 'themes', '../core/render_engine': 'render_engine' };
function __req(p) { const m = __mods[__MAP[p] || p]; if (!m) throw new Error('module not found: ' + p); return m.exports; }
</script>
<script>__def('render_engine', function (module, exports, require) {
${engine}
});</script>
<script>__def('themes', function (module, exports, require) {
${themes}
});</script>
<script>__def('templates', function (module, exports, require) {
${templates}
});</script>
<script>__def('daily', function (module, exports, require) {
${daily}
});</script>
<script>__def('poster', function (module, exports, require) {
${posterTpl}
});</script>
<script>
const { computeLayout, draw } = __req('render_engine');
const { THEME_LIST } = __req('themes');
const { CARD_TYPES, buildCardModel } = __req('templates');
const { buildPosterModel } = __req('poster');
const daily = __req('daily');

// ── 演示资产：假二维码 + 假照片（canvas 可直接当 image 用） ──
function makeQrAsset() {
  const c = document.createElement('canvas'); c.width = 100; c.height = 100;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 100, 100);
  g.fillStyle = '#111';
  [[4, 4], [72, 4], [4, 72]].forEach(([x, y]) => {
    g.fillRect(x, y, 24, 24); g.fillStyle = '#fff'; g.fillRect(x + 4, y + 4, 16, 16);
    g.fillStyle = '#111'; g.fillRect(x + 8, y + 8, 8, 8);
  });
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < 100; y += 8) for (let x = 0; x < 100; x += 8) {
    const inCorner = (x < 32 && y < 32) || (x > 68 && y < 32) || (x < 32 && y > 68);
    if (rnd() > 0.55 && !inCorner) g.fillRect(x, y, 7, 7);
  }
  return c;
}
function makePhotoAsset() {
  const c = document.createElement('canvas'); c.width = 640; c.height = 420;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 420);
  grad.addColorStop(0, '#2b5876'); grad.addColorStop(1, '#4e4376');
  g.fillStyle = grad; g.fillRect(0, 0, 640, 420);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.arc(520, 80, 34, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.moveTo(0, 340); g.lineTo(180, 220); g.lineTo(340, 340); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(240, 360); g.lineTo(430, 190); g.lineTo(640, 360); g.closePath(); g.fill();
  return c;
}
const qrAsset = makeQrAsset();
const photoAsset = makePhotoAsset();

// ── 样例内容（与页面种子同源，直接来自文案库） ──
const today = daily.todayQuote();
const SAMPLE = {
  dailysign: { title: today.date.replace(/-/, '月').replace(/-/, '日') + ' · 今日', body: today.text, qr: true },
  quote: { body: daily.todayQuote(1).text, author: '—— dudu 画面感', qr: true },
  recommend: daily.seedForType('recommend'),
  notice: daily.seedForType('notice'),
  checklist: daily.seedForType('checklist'),
  imagetext: daily.seedForType('imagetext')
};

function renderCard(canvas, type, themeId, data) {
  const model = buildCardModel(type, themeId, Object.assign({}, data, { qr: true }));
  const q = model.children.find(c => c.type === 'qrcode');
  if (q) q.asset = qrAsset;
  const ctx = canvas.getContext('2d');
  const layout = computeLayout(model, {}, (t, px) => {
    ctx.font = px + 'px sans-serif';
    return ctx.measureText(t).width;
  });
  const scale = 224 / 340;
  canvas.width = 340; canvas.height = layout.height;
  canvas.style.height = Math.round(layout.height * scale) + 'px';
  draw(ctx, layout);
}

function addCard(grid, label, canvas) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  const tag = document.createElement('div');
  tag.className = 'tag'; tag.textContent = label;
  cell.appendChild(tag); cell.appendChild(canvas);
  grid.appendChild(cell);
}

const grid = document.getElementById('grid');
for (const th of THEME_LIST) {
  for (const tp of Object.keys(CARD_TYPES)) {
    const canvas = document.createElement('canvas');
    try {
      renderCard(canvas, tp, th.id, SAMPLE[tp]);
      addCard(grid, th.name + ' · ' + CARD_TYPES[tp].name, canvas);
    } catch (e) {
      addCard(grid, '❌ ' + th.name + ' · ' + CARD_TYPES[tp].name + '：' + e.message, canvas);
    }
  }
}

// ── 照片背景模式：quote + imagetext 两张演示 ──
const grid2 = document.getElementById('grid2');
[['quote', '金句卡'], ['imagetext', '图文卡']].forEach(([tp, name]) => {
  const canvas = document.createElement('canvas');
  const model = buildCardModel(tp, 'warm', Object.assign({}, SAMPLE[tp], { bgImg: 'demo://photo.jpg', qr: true }));
  const q = model.children.find(c => c.type === 'qrcode');
  if (q) q.asset = qrAsset;
  model.backgroundImageAsset = photoAsset;
  const ctx = canvas.getContext('2d');
  const layout = computeLayout(model, {}, (t, px) => { ctx.font = px + 'px sans-serif'; return ctx.measureText(t).width; });
  canvas.width = 340; canvas.height = layout.height;
  canvas.style.height = Math.round(layout.height * (224 / 340)) + 'px';
  draw(ctx, layout);
  addCard(grid2, '照片背景 · ' + name, canvas);
});

// ── 海报长图：6 主题 × 1 样例（头像用首字占位，展示模板兜底） ──
const grid3 = document.getElementById('grid3');
const POSTER_SAMPLE = {
  title: '把日子过成海报',
  quote: daily.todayQuote(2).text,
  body: (daily.seedForType('imagetext') || {}).body || '记录此刻，分享给在意的人。',
  author: 'dudu',
  nickname: '春英',
  dateLabel: today.date.replace(/-/g, '月') + '日'
};
for (const th of THEME_LIST) {
  const canvas = document.createElement('canvas');
  try {
    const model = buildPosterModel(th.id, Object.assign({}, POSTER_SAMPLE, { qr: 'demo://qr' }));
    const q = model.children.find(c => c.type === 'qrcode');
    if (q) q.asset = qrAsset;
    const ctx = canvas.getContext('2d');
    const layout = computeLayout(model, {}, (t, px) => { ctx.font = px + 'px sans-serif'; return ctx.measureText(t).width; });
    canvas.width = 375; canvas.height = layout.height;
    const scale = 224 / 375;
    canvas.style.height = Math.round(layout.height * scale) + 'px';
    draw(ctx, layout);
    addCard(grid3, th.name + ' · 海报长图', canvas);
  } catch (e) {
    addCard(grid3, '❌ ' + th.name + ' · 海报：' + e.message, canvas);
  }
}

// ── 照片背景海报：白字 + 暗色蒙版演示 ──
const canvasP = document.createElement('canvas');
const modelP = buildPosterModel('warm', Object.assign({}, POSTER_SAMPLE, { bgImg: 'demo://photo.jpg', qr: 'demo://qr' }));
const qp = modelP.children.find(c => c.type === 'qrcode');
if (qp) qp.asset = qrAsset;
modelP.backgroundImageAsset = photoAsset;
const ctxP = canvasP.getContext('2d');
const layoutP = computeLayout(modelP, {}, (t, px) => { ctxP.font = px + 'px sans-serif'; return ctxP.measureText(t).width; });
canvasP.width = 375; canvasP.height = layoutP.height;
canvasP.style.height = Math.round(layoutP.height * (224 / 375)) + 'px';
draw(ctxP, layoutP);
addCard(grid3, '照片背景 · 海报长图', canvasP);

document.getElementById('info').innerHTML =
  '构建时间：' + new Date().toLocaleString() +
  ' ｜ 今日推荐（' + daily.dateStrOf() + '）：' + today.text +
  '<br>储备量：金句库 <b>' + daily.poolSize() + '</b> 条；种草/公告/清单/图文各 <b>' +
  daily.poolSizeFor('recommend') + '</b> 条 ｜ 本页由真实引擎源码驱动（render_engine × themes × templates × poster × daily）';
</script>
</body>
</html>
`;

const out = path.join(__dirname, 'card_preview.html');
fs.writeFileSync(out, html, 'utf8');
console.log('written: tools/card_preview.html (' + html.length + ' chars)');
