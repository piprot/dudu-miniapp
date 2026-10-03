// utils/templates/poster.js
// ─────────────────────────────────────────────────────────────────────────
// 海报长图模板（2026-10-01 · P4 新增内容类型）
// 竖版 375 逻辑宽、高度随内容流式计算；借鉴 Superljf poster 的个性化海报思路：
//   头像（圆形裁剪）+ 昵称 + 专属小程序码，可发朋友圈/群后扫码回流。
// 排版沿用卡片 v2 规范：三段式、行距 1.7+、流式测量、主题化配色、照片背景白字。
//
// buildPosterModel(themeId, data, opts) → 引擎 model
//   data: { title, quote, body, author, nickname, dateLabel, avatar, qr, bgImg }
//   opts: { measure }（页面传 canvas measureText；缺省内置估算）
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const { getTheme, palette } = require('../themes/index.js');
const { wrapText, defaultMeasure } = require('../core/render_engine');

const W = 375;
const PAD = 24;

// 行数计算：长图为不裁切格式，quote/body 不设上限（clamp 传 0 = 不限）；
// 只有 title 保留 clamp 3（标题天然短，防异常超长输入）。
function countLines(text, width, fontPx, measure, clamp) {
  const lines = wrapText(String(text || ''), width, measure, fontPx).length;
  return clamp > 0 ? Math.min(lines, clamp) : lines;
}

function buildPosterModel(themeId, data, opts) {
  const p = palette(themeId);
  const d = data || {};
  const measure = (opts && opts.measure) || defaultMeasure;
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

  // ── 顶部主色细条 + 品牌行（左：品牌；右：日期）──
  rect({ left: 0, top: 0, width: W, height: 4, background: p.primary });
  y = 24;
  txt('dudu 画面感', { left: PAD, top: y, width: 120, color: sub, fontSize: 11, lineHeight: 14 });
  if (d.dateLabel) {
    const dw = Math.ceil(measure(d.dateLabel, 11));
    txt(d.dateLabel, { left: W - PAD - dw, top: y, width: dw, color: sub, fontSize: 11, lineHeight: 14 });
  }
  y += 14 + 26;

  // ── 主标题（24/34，clamp 3）+ 主色短横条 ──
  if (d.title) {
    const tLines = countLines(d.title, innerW, 24, measure, 3);
    txt(d.title, { left: PAD, top: y, width: innerW, color: ink, fontSize: 24, fontWeight: 'bold', lineHeight: 34, lineClamp: 3 });
    y += tLines * 34 + 12;
    rect({ left: PAD, top: y, width: 36, height: 4, background: p.primary, radius: 2 });
    y += 4 + 18;
  }

  // ── 金句主体（19/34 = 1.79 行距，❝ 引导符）──
  if (d.quote) {
    txt('❝', { left: PAD, top: y, width: 40, color: p.primary, fontSize: 28, fontWeight: 'bold', lineHeight: 32 });
    y += 30;
    txt(d.quote, { left: PAD, top: y, width: innerW, color: ink, fontSize: 19, lineHeight: 34 });
    y += countLines(d.quote, innerW, 19, measure, 0) * 34 + 10;
    if (d.author) {
      const aw = Math.ceil(measure('—— ' + d.author, 13));
      txt('—— ' + d.author, { left: W - PAD - aw, top: y, width: aw, color: sub, fontSize: 13, lineHeight: 18 });
      y += 18 + 16;
    }
  }

  // ── 正文补充（14/24，clamp 12）──
  if (d.body) {
    children.push({ type: 'line', left: PAD, top: y, width: innerW, thickness: 1, color: p.line });
    y += 14;
    txt(d.body, { left: PAD, top: y, width: innerW, color: ink, fontSize: 14, lineHeight: 24 });
    y += countLines(d.body, innerW, 14, measure, 0) * 24 + 20;
  }

  // ── 底部信息行：头像+昵称（左） | 小程序码（右）──
  y += 2;
  children.push({ type: 'line', left: PAD, top: y, width: innerW, thickness: 1, color: p.line });
  y += 14;
  const BLOCK = 56;
  if (d.avatar) {
    children.push({ type: 'image', left: PAD, top: y, width: BLOCK, height: BLOCK, radius: BLOCK / 2,
      src: d.avatar, objectFit: 'cover', asset: d.avatarAsset });
  } else {
    children.push({ type: 'circle', left: PAD, top: y, d: BLOCK, background: p.bgSoft });
    txt((d.nickname || 'dudu').slice(0, 1), { left: PAD, top: y + 18, width: BLOCK, color: p.primary,
      fontSize: 20, fontWeight: 'bold', lineHeight: 22, textAlign: 'center' });
  }
  if (d.qr) {
    children.push({ type: 'qrcode', left: W - PAD - BLOCK, top: y, size: BLOCK, asset: d.qrAsset });
  }
  const nameX = d.avatar ? PAD + BLOCK + 12 : PAD;
  txt(d.nickname || 'dudu 画面感', { left: nameX, top: y + 8, width: (W - PAD * 2) - BLOCK * 2 - 12, color: ink, fontSize: 15, fontWeight: 'bold', lineHeight: 20, lineClamp: 1 });
  txt(d.dateLabel || '', { left: nameX, top: y + 30, width: (W - PAD * 2) - BLOCK * 2 - 12, color: sub, fontSize: 11, lineHeight: 14, lineClamp: 1 });
  y += BLOCK + 22;

  const height = Math.max(y, 480);
  const model = { width: W, height, gradient: p.bg, radius: p.radius, children };
  if (d.bgImg) model.backgroundImage = d.bgImg;
  return model;
}

module.exports = { buildPosterModel, W, PAD };
