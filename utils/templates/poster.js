// utils/templates/poster.js
// ─────────────────────────────────────────────────────────────────────────
// 海报长图模板（2026-10-01 · P4 新增内容类型；2026-10-05 排版重构）
// 竖版 375 逻辑宽、高度随内容流式计算。
//
// 排版方向（2026-10-05 按 editorial / minimalist 原则重构，解决「太丑」）：
//   · 强字体对比 —— 金句用衬线大字（Songti/SimSun）作视觉主角；标题/正文用无衬线作配角。
//   · 编辑式引用 —— 金句左侧一道主色竖条，替代原来 hacky 的大 ❝ 字符。
//   · 大量留白 —— 页边距 24→32，块间呼吸感拉开，内容占版约 6 成。
//   · 单一左对齐 —— 仅署名行右对齐（惯例），其余一律左对齐，杜绝杂乱。
//   · 中性近黑 —— ink 沿用主题近黑色（非纯黑 #000），次级信息用 muted 灰。
//
// buildPosterModel(themeId, data, opts) → 引擎 model
//   data: { title, quote, body, author, nickname, dateLabel, avatar, qr, bgImg }
//   opts: { measure }（页面传 canvas measureText；缺省内置估算）
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const { getTheme, palette } = require('../themes/index.js');
const { wrapText, defaultMeasure } = require('../core/render_engine');

const W = 375;
const PAD = 32;
const SERIF = "'Songti SC', 'SimSun', serif";   // 衬线 = 高级感/编辑感的核心

// 行数计算：长图为不裁切格式，quote/body 不设上限（clamp 传 0 = 不限）；
// 只有 title 保留 clamp 3（标题天然短，防异常超长输入撑爆版心）。
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
  const sub = onPhoto ? 'rgba(255,255,255,0.9)' : p.sub;
  const font = p.cjkFont;
  const innerW = W - PAD * 2;
  const children = [];
  let y = 0;

  const sans = (content, o) => children.push(Object.assign(
    { type: 'text', content: String(content == null ? '' : content), fontFamily: font }, o));
  const serif = (content, o) => children.push(Object.assign(
    { type: 'text', content: String(content == null ? '' : content), fontFamily: SERIF }, o));
  const rect = (o) => children.push(Object.assign({ type: 'rect' }, o));

  // ── 顶部品牌细带（主色仅在此锚点出现一次）──
  rect({ left: 0, top: 0, width: W, height: 4, background: p.primary });
  y = PAD + 6;
  // ── 顶部信息行：品牌（左）· 日期（右）──
  sans('dudu 画面感', { left: PAD, top: y, width: 160, color: sub, fontSize: 11, lineHeight: 16 });
  if (d.dateLabel) {
    const dw = Math.ceil(measure(d.dateLabel, 11));
    sans(d.dateLabel, { left: W - PAD - dw, top: y, width: dw, color: sub, fontSize: 11, lineHeight: 16 });
  }
  y += 16 + 32;

  // ── 主标题（粗壮无衬线，作 eyebrow headline；下方短主色横条收口）──
  if (d.title) {
    const tLines = countLines(d.title, innerW, 27, measure, 3);
    sans(d.title, { left: PAD, top: y, width: innerW, color: ink, fontSize: 27, fontWeight: 'bold', lineHeight: 38, lineClamp: 3 });
    y += tLines * 38 + 16;
    rect({ left: PAD, top: y, width: 48, height: 4, background: p.primary, radius: 2 });
    y += 4 + 28;
  }

  // ── 金句主体（衬线大字，左侧主色竖条 = 编辑式引用块）──
  if (d.quote) {
    const qW = innerW - 20;
    const qLines = countLines(d.quote, qW, 23, measure, 0);
    const barH = qLines * 40;
    rect({ left: PAD, top: y, width: 4, height: barH, background: p.primary, radius: 2 });
    serif(d.quote, { left: PAD + 20, top: y, width: qW, color: ink, fontSize: 23, lineHeight: 40, lineClamp: 0 });
    y += barH + 14;
    if (d.author) {
      const aw = Math.ceil(measure('—— ' + d.author, 13));
      sans('—— ' + d.author, { left: W - PAD - aw, top: y, width: aw, color: sub, fontSize: 13, lineHeight: 20, textAlign: 'right' });
      y += 20 + 18;
    }
  }

  // ── 正文补充（无衬线，1.8 行距呼吸）──
  if (d.body) {
    children.push({ type: 'line', left: PAD, top: y, width: innerW, thickness: 1, color: p.line });
    y += 16;
    const bLines = countLines(d.body, innerW, 15, measure, 0);
    sans(d.body, { left: PAD, top: y, width: innerW, color: ink, fontSize: 15, lineHeight: 27 });
    y += bLines * 27 + 28;
  }

  // ── 底部信息行：头像/首字（左）| 小程序码 + 提示（右）──
  y += 4;
  children.push({ type: 'line', left: PAD, top: y, width: innerW, thickness: 1, color: p.line });
  y += 16;
  const BLOCK = 56;
  const name = d.nickname || 'dudu 画面感';
  if (d.avatar) {
    children.push({ type: 'image', left: PAD, top: y, width: BLOCK, height: BLOCK, radius: BLOCK / 2,
      src: d.avatar, objectFit: 'cover', asset: d.avatarAsset });
  } else {
    children.push({ type: 'circle', left: PAD, top: y, d: BLOCK, background: p.bgSoft });
    sans((d.nickname || 'dudu').slice(0, 1), { left: PAD, top: y + 18, width: BLOCK, color: p.primary,
      fontSize: 20, fontWeight: 'bold', lineHeight: 22, textAlign: 'center' });
  }
  if (d.qr) {
    children.push({ type: 'qrcode', left: W - PAD - BLOCK, top: y, size: BLOCK, asset: d.qrAsset });
    sans('长按识别小程序码', { left: W - PAD - BLOCK, top: y + BLOCK + 6, width: BLOCK, color: sub, fontSize: 10, lineHeight: 13, textAlign: 'center' });
  }
  const nameX = d.avatar ? PAD + BLOCK + 14 : PAD;
  sans(name, { left: nameX, top: y + 6, width: (W - PAD * 2) - BLOCK - 14, color: ink, fontSize: 15, fontWeight: 'bold', lineHeight: 20, lineClamp: 1 });
  sans(d.dateLabel || '', { left: nameX, top: y + 28, width: (W - PAD * 2) - BLOCK - 14, color: sub, fontSize: 11, lineHeight: 14, lineClamp: 1 });
  y += BLOCK + (d.qr ? 24 : 0) + 26;

  const height = Math.max(y, 480);
  const model = { width: W, height, gradient: p.bg, radius: p.radius, children };
  if (d.bgImg) model.backgroundImage = d.bgImg;
  return model;
}

module.exports = { buildPosterModel, W, PAD };
