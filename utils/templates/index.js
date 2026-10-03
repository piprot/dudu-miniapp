// utils/templates/index.js
// ─────────────────────────────────────────────────────────────────────────────
// 内容模板库（2026-10-01 v2：排版精修，借鉴小红书设计规范 + gzh-design-skill）
//
// 三层解耦不变：模板(templates) × 主题(themes) × 引擎(render_engine)。
//
// v2 排版策略（有出处）：
//   ① 流式布局 + 真实测量：每段文字先量出真实行数再落位（v1 拍脑袋估行数 → 空隙难看）。
//   ② 三段式结构（小红书卡片公式）：左上小标签 → 中部主体 → 底部信息行。
//   ③ 行距 1.7+（小红书规范 1.5–2 倍）：标题 20/28、金句 17/30、正文 14/24、小字 10–12/18。
//   ④ 清单用圆形数字徽章（规范：列表别用冷冰冰的 1.2.3. 硬怼）。
//   ⑤ 公告标题用主色左竖条（gzh：小标签/左竖条 > 虚线框）。
//   ⑥ 配图统一 16:10 比例、统一圆角 12、底部渐晕 + 1px 内描边（细节感）。
//   ⑦ 落款与小程序码同行（节省纵向空间，右下角不空旷）。
//   ⑧ 字体走主题 cjkFont（≤2 种：标题粗体 + 正文常规）；主色只做锚点（≤5 处）。
//
// buildCardModel(type, themeId, data, opts) → 渲染引擎的 model（children[]）
//   type: dailysign | quote | recommend | notice | checklist | imagetext
//   data: { title, body, author, tag, items[], cover, qr, bgImg }
//   opts: { measure } 可选（页面传 canvas measureText 提升折行精度；缺省用内置估算）
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const { getTheme, palette } = require('../themes/index.js');
const { wrapText, defaultMeasure } = require('../core/render_engine');

const CARD_TYPES = {
  dailysign: { id: 'dailysign', name: '每日日签', scene: '早安/晚安心语', hasCover: false },
  quote:     { id: 'quote',     name: '金句卡',   scene: '一句话观点',   hasCover: false },
  recommend: { id: 'recommend', name: '种草卡',   scene: '好物推荐',     hasCover: true },
  notice:    { id: 'notice',    name: '公告卡',   scene: '通知/声明',    hasCover: false },
  checklist: { id: 'checklist', name: '清单卡',   scene: '待办/步骤',    hasCover: false },
  imagetext: { id: 'imagetext', name: '图文卡',   scene: '配图短文',     hasCover: true }
};

const W = 340;   // 卡片逻辑宽
const PAD = 20;  // 内边距

function countLines(text, width, fontPx, measure, clamp) {
  return Math.min(wrapText(String(text || ''), width, measure, fontPx).length, clamp);
}

function buildCardModel(type, themeId, data, opts) {
  const th = getTheme(themeId);
  const p = palette(themeId);
  const d = data || {};
  const measure = (opts && opts.measure) || defaultMeasure;
  // 照片背景模式：文字自动转白（引擎叠暗色蒙版保证可读）
  const onPhoto = !!d.bgImg;
  const ink = onPhoto ? '#ffffff' : p.ink;
  const sub = onPhoto ? 'rgba(255,255,255,0.92)' : p.sub;
  const font = p.cjkFont;
  const innerW = W - PAD * 2;
  const children = [];
  let y = 0;

  const txt = (content, o) => children.push(Object.assign(
    { type: 'text', content: String(content == null ? '' : content), fontFamily: font }, o));
  const rect = (o) => children.push(Object.assign({ type: 'rect' }, o));

  // ── 顶部主色细条（锚点 ①）──
  rect({ left: 0, top: 0, width: W, height: 4, background: p.primary });
  y = 18;

  // ── 头部：类型小标签（左） + 品牌水印（右）──
  const pillText = CARD_TYPES[type].name;
  const pillW = Math.ceil(measure(pillText, 11)) + 20;
  rect({ left: PAD, top: y, width: pillW, height: 22, background: p.bgSoft, radius: 11 });
  txt(pillText, { left: PAD + 10, top: y + 4, width: pillW - 20, color: p.primary, fontSize: 11, fontWeight: 'bold', lineHeight: 14 });
  const brand = 'dudu 画面感';
  const brandW = Math.ceil(measure(brand, 10));
  txt(brand, { left: W - PAD - brandW, top: y + 5, width: brandW, color: sub, fontSize: 10, lineHeight: 12 });
  y += 22 + 16;

  // ── 标题（公告卡带主色左竖条）──
  if (d.title) {
    const tw = type === 'notice' ? innerW - 14 : innerW;
    const tLines = countLines(d.title, tw, 20, measure, 2);
    if (type === 'notice') {
      rect({ left: PAD, top: y + 3, width: 4, height: Math.min(tLines * 28 - 6, 50), background: p.primary });
      txt(d.title, { left: PAD + 14, top: y, width: tw, color: ink, fontSize: 20, fontWeight: 'bold', lineHeight: 28, lineClamp: 2 });
    } else {
      txt(d.title, { left: PAD, top: y, width: tw, color: ink, fontSize: 20, fontWeight: 'bold', lineHeight: 28, lineClamp: 2,
        textAlign: type === 'dailysign' ? 'center' : 'left' });
    }
    y += tLines * 28 + 10;
  }

  // ── 配图（统一 16:10 比例、圆角 12、底部渐晕、1px 内描边）──
  if (CARD_TYPES[type].hasCover && d.cover) {
    const ch = Math.round(innerW * 0.62);
    children.push({ type: 'image', left: PAD, top: y, width: innerW, height: ch, src: d.cover, radius: 12, objectFit: 'cover' });
    children.push({ type: 'gradient', left: PAD, top: y + ch - 46, width: innerW, height: 46, radius: 12,
      colors: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.18)'] });
    rect({ left: PAD, top: y, width: innerW, height: ch, radius: 12, border: 1, borderColor: 'rgba(0,0,0,0.06)' });
    y += ch + 12;
  }

  // ── 金句引导符（quote / dailysign 专属装饰）──
  const isQuote = (type === 'quote' || type === 'dailysign');
  if (isQuote && d.body) {
    txt('❝', { left: PAD, top: y, width: type === 'dailysign' ? innerW : 40, color: p.primary,
      fontSize: 26, fontWeight: 'bold', lineHeight: 30, textAlign: type === 'dailysign' ? 'center' : 'left' });
    y += 26;
  }

  // ── 正文（行距 1.7+）──
  if (d.body) {
    const fs = isQuote ? 17 : (type === 'recommend' ? 15 : 14);
    const lh = isQuote ? 30 : (type === 'recommend' ? 26 : 24);
    const clamp = isQuote ? 6 : 8;
    txt(d.body, { left: PAD, top: y, width: innerW, color: ink, fontSize: fs, lineHeight: lh, lineClamp: clamp,
      textAlign: type === 'dailysign' ? 'center' : 'left' });
    y += countLines(d.body, innerW, fs, measure, clamp) * lh + 12;
  }

  // ── 种草卡：价签色块高亮（规范：价格用色块）──
  if (type === 'recommend' && d.tag) {
    const tw2 = Math.ceil(measure(d.tag, 13)) + 24;
    rect({ left: PAD, top: y, width: tw2, height: 26, background: p.primary, radius: 13 });
    txt(d.tag, { left: PAD + 12, top: y + 6, width: tw2 - 24, color: '#ffffff', fontSize: 13, fontWeight: 'bold', lineHeight: 15 });
    y += 26 + 14;
  }

  // ── 清单：圆形数字徽章 + 条目（规范：不用冷冰冰的 1.2.3.）──
  if (type === 'checklist' && Array.isArray(d.items)) {
    d.items.forEach((it, i) => {
      const itText = String(it);
      const itLines = countLines(itText, innerW - 30, 14, measure, 2);
      const rowH = Math.max(20, itLines * 22);
      children.push({ type: 'circle', left: PAD, top: y + 1, d: 20, background: p.primary });
      txt(String(i + 1), { left: PAD, top: y + 4, width: 20, color: '#ffffff', fontSize: 11, fontWeight: 'bold', lineHeight: 14, textAlign: 'center' });
      txt(itText, { left: PAD + 30, top: y, width: innerW - 30, color: ink, fontSize: 14, lineHeight: 22, lineClamp: 2 });
      y += rowH + 10;
    });
    y += 4;
  }

  // ── 底部信息行：分割线 + 落款（左）与小程序码（右）同行 ──
  y += 4;
  children.push({ type: 'line', left: PAD, top: y, width: innerW, thickness: 1, color: p.line });
  y += 12;
  const hasQr = !!d.qr;
  const QS = hasQr ? 56 : 0;
  if (hasQr) {
    children.push({ type: 'qrcode', left: W - PAD - QS, top: y, size: QS, asset: d.qrAsset });
  }
  const foot = d.author || (hasQr ? '扫码做同款卡片' : '');
  if (foot) {
    txt(foot, { left: PAD, top: y + Math.round((QS - 18) / 2), width: hasQr ? innerW - QS - 12 : innerW,
      color: sub, fontSize: 12, lineHeight: 18, lineClamp: 2,
      textAlign: (type === 'dailysign' && !d.author) ? 'center' : 'left' });
  }
  y += QS + 18;

  const height = Math.max(y, 200);
  const model = {
    width: W, height,
    gradient: p.bg,
    radius: p.radius,
    children
  };
  if (d.bgImg) model.backgroundImage = d.bgImg; // 页面加载图片后注入 backgroundImageAsset
  return model;
}

module.exports = { CARD_TYPES, buildCardModel, W, PAD };
