// utils/templates/poster.js
// ─────────────────────────────────────────────────────────────────────────
// 海报长图模板（2026-10-01 新增；2026-10-05 二次重构：编辑式排印 + 钉底落款）
// 竖版 375 逻辑宽、高度随内容流式计算。
//
// 版式规则（参考 editorial poster / canvas-design 成熟做法，修复四类硬伤）：
//   · 单一信息源 —— 品牌与日期全图各只出现一次：日期在顶部信息行，品牌在底部落款。
//     （旧版顶部/底部各一遍，视觉重复）
//   · 光学中心 —— 标题/金句块在头部与落款之间的剩余空间里偏上(40%)就位；
//     旧版 height=max(y,480) 让落款吊在半空、下面一整块死白。
//   · 落款钉底 —— 分隔线 + 品牌名 + 长按提示（左）｜小程序码（右），永远贴住底边。
//   · 提示不折行 —— 「长按识别小程序码」给足一行宽度（旧版挤在 56px 码宽里折成两行）。
//   · 强字体对比 —— 金句衬线大字（Songti/SimSun）+ 左侧主色竖条；标题粗无衬线；
//     正文无衬线 1.8 行距；单一左对齐（仅作者署名靠右）。
//   · 合规 —— 头像/首字圆形占位已随「社交-笔记」整改移除（旧版圆形占位与落款
//     文字同位叠加，是截图里日期上的橙点 bug 来源）；落款固定品牌名。
//
// buildPosterModel(themeId, data, opts) → 引擎 model
//   data: { title, quote, body, author, dateLabel, qr, bgImg }
//   opts: { measure }（页面传 canvas measureText；缺省内置估算）
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const { palette } = require('../themes/index.js');
const { wrapText, defaultMeasure } = require('../core/render_engine');

const W = 375;
const PAD = 32;
const SERIF = "'Songti SC', 'SimSun', serif";   // 衬线 = 高级感/编辑感的核心
const BRAND = 'dudu 画面感';
const QR_HINT = '长按识别小程序码';
const QR_SIZE = 56;
const MIN_H = 600;        // 375:600 ≈ 5:8，金句海报的编辑式比例（旧 480 太方）
const HEADER_H = 88;      // 顶带4 + 日期行(top40,h16) + 呼吸
const FOOTER_H = 102;     // 分隔线 + 落款内容72 + 底部留白30（落款钉底几何）

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

  const text = (arr, content, o) => arr.push(Object.assign(
    { type: 'text', content: String(content == null ? '' : content), fontFamily: font }, o));
  const serif = (arr, content, o) => arr.push(Object.assign(
    { type: 'text', content: String(content == null ? '' : content), fontFamily: SERIF }, o));

  // ── 中段（标题/金句/作者/正文）先在本地坐标系排完，再整体垂直就位 ──
  const mid = [];
  let h = 0;

  // 主标题（粗壮无衬线 eyebrow；下方短主色横条收口）
  if (d.title) {
    const tLines = countLines(d.title, innerW, 27, measure, 3);
    text(mid, d.title, { left: PAD, top: h, width: innerW, color: ink, fontSize: 27, fontWeight: 'bold', lineHeight: 38, lineClamp: 3 });
    h += tLines * 38 + 16;
    mid.push({ type: 'rect', left: PAD, top: h, width: 48, height: 4, background: p.primary, radius: 2 });
    h += 4 + 30;
  }

  // 金句主体（衬线大字，左侧主色竖条 = 编辑式引用块）
  if (d.quote) {
    const qW = innerW - 20;
    const qLines = countLines(d.quote, qW, 23, measure, 0);
    const barH = qLines * 40;
    mid.push({ type: 'rect', left: PAD, top: h, width: 4, height: barH, background: p.primary, radius: 2 });
    serif(mid, d.quote, { left: PAD + 20, top: h, width: qW, color: ink, fontSize: 23, lineHeight: 40, lineClamp: 0 });
    h += barH;
    if (d.author) {
      h += 14;
      const aw = Math.ceil(measure('—— ' + d.author, 13));
      text(mid, '—— ' + d.author, { left: W - PAD - aw, top: h, width: aw, color: sub, fontSize: 13, lineHeight: 20 });
      h += 20;
    }
  }

  // 正文补充（无衬线，1.8 行距呼吸；与上文之间细分隔线）
  if (d.body) {
    if (h > 0) {
      h += 26;
      mid.push({ type: 'line', left: PAD, top: h, width: innerW, thickness: 1, color: p.line });
      h += 18;
    }
    const bLines = countLines(d.body, innerW, 15, measure, 0);
    text(mid, d.body, { left: PAD, top: h, width: innerW, color: ink, fontSize: 15, lineHeight: 27 });
    h += bLines * 27;
  }

  // ── 整页几何：头部固定、中段偏上就位、落款钉底 ──
  const total = Math.max(MIN_H, HEADER_H + h + 32 + FOOTER_H);
  const footerTop = total - FOOTER_H;                       // 落款永远贴底
  const free = footerTop - 32 - HEADER_H - h;               // 中段可用富余
  const midTop = HEADER_H + Math.max(16, free * 0.4);       // 光学中心：偏上 40%

  const children = [];

  // 顶部品牌细带（主色仅在此锚点出现一次）
  children.push({ type: 'rect', left: 0, top: 0, width: W, height: 4, background: p.primary });
  // 顶部信息行：日期（全图唯一一次；品牌留给底部落款）
  if (d.dateLabel) {
    text(children, d.dateLabel, { left: PAD, top: 40, width: 220, color: sub, fontSize: 11, lineHeight: 16 });
  }

  // 中段整体就位
  mid.forEach(c => children.push(Object.assign({}, c, { top: (c.top || 0) + midTop })));

  // ── 落款（钉底）：分隔线 + 品牌名 + 长按提示（左）｜小程序码（右）──
  children.push({ type: 'line', left: PAD, top: footerTop, width: innerW, thickness: 1, color: p.line });
  const hasQr = !!d.qr;
  text(children, d.nickname || BRAND, {
    left: PAD, top: footerTop + 16, width: innerW - (hasQr ? QR_SIZE + 20 : 0),
    color: ink, fontSize: 15, fontWeight: 'bold', lineHeight: 20, lineClamp: 1
  });
  text(children, QR_HINT, { left: PAD, top: footerTop + 40, width: 180, color: sub, fontSize: 10, lineHeight: 14 });
  if (hasQr) {
    children.push({ type: 'qrcode', left: W - PAD - QR_SIZE, top: footerTop + 16, size: QR_SIZE, asset: d.qrAsset });
  }

  const model = { width: W, height: total, gradient: p.bg, radius: p.radius, children };
  if (d.bgImg) model.backgroundImage = d.bgImg;
  return model;
}

module.exports = { buildPosterModel, W, PAD };
