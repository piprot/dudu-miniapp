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
const fontKit = require('../font_kit.js');

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

// 节日/日签卡的「日期·星期」标题字号（2026-10-07 用户拍板：金句才是主体，日期退为元信息）。
// 15px：与正文 20px 拉开明显层次，又不会小到看不清。
const DATE_LABEL_SIZE = 15;
// 节日/日签卡金句正文字号（同上口径，比日期大5px 撑起主体感）。
const DATE_BODY_SIZE = 20;

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

  // ── 排版风格（2026-10-06）：字体族 × 字重 × 字距 × 对齐 × 装饰符号 ──
  // data.styleKey 可传 'literary' | 'modern' | 'warm' | 'poster'。
  // 不传则按type 取默认风格：日签/金句走文艺（居中+引号，承袭原日签气质），
  // 其余保持原样（现代左对齐），确保向后兼容既有单测的排版断言。
  const DEFAULT_STYLE = {
    dailysign: 'literary',
    quote: 'literary',
    notice: 'modern',
    recommend: 'modern',
    checklist: 'modern',
    imagetext: 'modern'
  };
  const styleId = d.styleKey || DEFAULT_STYLE[type] || 'literary';
  const S = fontKit.styleOf(styleId);
  // dailysign 的居中排版是它的识别特征，故只有它无条件走风格对齐；
  // 其他类型仅当显式传了 styleKey 才应用风格（避免改变历史卡片观感）。
  const styleOn = !!d.styleKey || type === 'dailysign';
  const titleFont = styleOn ? fontKit.familyOf(S.titleFont) : font;
  const bodyFont = styleOn ? fontKit.familyOf(S.bodyFont) : font;
  const decoFont = styleOn ? fontKit.familyForRole('deco') : font;
  const titleAlign = styleOn ? S.titleAlign : (type === 'dailysign' ? 'center' : 'left');
  const bodyAlign = styleOn ? S.bodyAlign : 'left';

  // 照片背景：文字靠**投影**保证可读，而不是把整卡蒙版压暗（旧版压到0.68，整张图发闷）。
// 投影强度按字号给：大字需要更多糊边才压得住背景，小字反之（糊太多会糊成一团）。
const PHOTO_SHADOW = (fontPx) => ({
  color: 'rgba(0,0,0,0.5)',
  blur: Math.max(3, Math.round(fontPx * 0.35)),
  y: 1
});
  // onPhoto 时自动给所有文字挂投影；显式传了 shadow 的以传入为准
  const txt = (content, o) => {
    const node = Object.assign(
      { type: 'text', content: String(content == null ? '' : content), fontFamily: font }, o);
    // 照片背景模式：文字靠投影保证可读。但**自带实色底块**的小标签（如左上角「每日日签」pill）
    // 不需要投影——底块本身已提供对比，投影反而把 11px 小字糊成一团（2026-10-07 用户反馈「看不清」）。
    // 故支持 noShadow:true 显式豁免。
    if (onPhoto && !node.shadow && !node.noShadow) node.shadow = PHOTO_SHADOW(node.fontSize || 14);
    delete node.noShadow;   // 不让内部标记漏进渲染引擎
    children.push(node);
  };
  const rect = (o) => children.push(Object.assign({ type: 'rect' }, o));

  // ── 顶部主色细条（锚点 ①）──
  rect({ left: 0, top: 0, width: W, height: 4, background: p.primary });
  y = 18;

  // ── 头部：类型小标签（左） + 品牌水印（右）──
  const pillText = CARD_TYPES[type].name;
  const pillW = Math.ceil(measure(pillText, 11)) + 20;
  rect({ left: PAD, top: y, width: pillW, height: 22, background: p.bgSoft, radius: 11 });
  // noShadow：pill 有实色底块，投影只会让 11px 小字发糊（2026-10-07 整改）
  txt(pillText, { left: PAD + 10, top: y + 4, width: pillW - 20, color: p.primary, fontSize: 11, fontWeight: 'bold', lineHeight: 14, noShadow: true });
  const brand = 'dudu 画面感';
  const brandW = Math.ceil(measure(brand, 10));
  txt(brand, { left: W - PAD - brandW, top: y + 5, width: brandW, color: sub, fontSize: 10, lineHeight: 12 });
  y += 22 + 16;

  // ── kicker：小字元信息行（城市/天气/日期等），**必须比正文小**──
  // 用途：天气卡这类「金句是主体、天气只是场景」的卡，把场景信息从20px 粗体标题槽
  // 降到 12px 灰字，让金句真正成为视觉主体。旧版把「北京·晴·好心情」塞进标题槽，
  // 结果天气信息比金句还抢眼，喧宾夺主。
  if (d.kicker) {
    const kFs = 12, kLh = 17;
    const kLines = countLines(d.kicker, innerW, kFs, measure, 2);
    txt(d.kicker, { left: PAD, top: y, width: innerW, color: sub, fontSize: kFs, lineHeight: kLh,
      lineClamp: 2, textAlign: (styleOn ? S.bodyAlign : (type === 'dailysign' ? 'center' : 'left')) });
    y += kLines * kLh + 6;
  }

  // ── 标题（公告卡带主色左竖条）──
  if (d.title) {
    const tw = type === 'notice' ? innerW - 14 : innerW;
    // 2026-10-07 用户反馈「正文（金句）字号要大于日期星期」→ dailysign 特判：
    // 节日/日签卡的标题是「10月7日·星期二」这类**元信息**，金句才是主体，
    // 故标题降为小号元信息（DATE_SIZE），正文升为 hero 大字号（见下方 body 分支）。
    // 其他类型标题仍是主体，沿用风格 titleSize。
    const isDateLabel = (type === 'dailysign');
    const tFs = isDateLabel ? DATE_LABEL_SIZE : (styleOn ? S.titleSize : 20);
    const tLh = Math.round(tFs * 1.4);
    const tLines = countLines(d.title, tw, tFs, measure, 2);
    // 2026-10-07 用户反馈「所有卡片左下角竖线都去掉」→ 标题左竖条**全类型**取消。
    // 旧逻辑：type==='notice' || (styleOn && S.showBar) 会给 notice / 现代风卡片加一根
    // 主色竖条。竖条是「公告/条目列表」的视觉语言，套到卡片上显冗余，且与居中金句气质冲突。
    // 竖条改由需要「条目感」的模板自行处理，卡片层不再统一画。
    if (d.showTitleBar === true) {
      rect({ left: PAD, top: y + 3, width: 4, height: Math.min(tLines * tLh - 6, 50), background: p.primary });
      txt(d.title, { left: PAD + 14, top: y, width: tw, color: ink, fontSize: tFs, fontWeight: 'bold',
        lineHeight: tLh, lineClamp: 2, fontFamily: titleFont,
        letterSpacing: styleOn ? S.titleSpacing : 0, textAlign: 'left' });
    } else {
      // 日期元信息用弱色（sub），避免与金句主体抢眼；weight 也降一档。
      txt(d.title, { left: PAD, top: y, width: tw, color: isDateLabel ? sub : ink,
        fontSize: tFs, fontWeight: isDateLabel ? 'normal' : 'bold',
        lineHeight: tLh, lineClamp: 2, fontFamily: titleFont,
        letterSpacing: styleOn ? S.titleSpacing : 0,
        textAlign: type === 'dailysign' && !styleOn ? 'center' : titleAlign });
    }
    y += tLines * tLh + 10;
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
  // 注意：风格声明 showDeco:false 时**不生成装饰节点**（否则会留一个 0px 的空块白占纵向空间）。
  const isQuote = (type === 'quote' || type === 'dailysign');
  const wantDeco = isQuote && !!d.body && !(styleOn && !S.showDeco);
  if (wantDeco) {
    const mark = styleOn ? S.deco : '❝';
    // 装饰符**不能比金句本体还大**（旧版26px 引号压过 17px 金句，喧宾夺主还显闷）。
    // 现在封顶到 20px：hero 卡（金句 20px）用 18，小金句（17px）配 20 刚好成对。
    const dSize = styleOn ? S.decoSize : (d.hero ? 18 : 20);
    const dLh = Math.round(dSize * 1.2);
    txt(mark, { left: PAD, top: y, width: type === 'dailysign' ? innerW : 40, color: p.primary,
      fontSize: dSize, fontWeight: 'bold', lineHeight: dLh,
      fontFamily: decoFont,
      textAlign: type === 'dailysign' ? 'center' : 'left' });
    y += dLh;
  }

  // ── 正文（行距 1.7+）──
  // d.hero=true 时正文升格为**真正的主体**：字号/行距都往上抬一档。
  // 天气卡用它——场景信息降到 12px kicker 后，金句必须明显放大才撑得住「主视觉」，
  // 否则卡面会变成「一堆小字+ 一句平铺的正文」，看着没有重点。
  if (d.body) {
    const hero = !!d.hero;
    // dailysign（金句卡/节日卡）：金句是主体，字号恒为 DATE_BODY_SIZE(20)，
    // 必须大于上面的日期标题（DATE_LABEL_SIZE 15）——2026-10-07 用户拍板。
    // 其余类型沿用风格 bodySize / hero 抬升档。
    const fs = (type === 'dailysign') ? DATE_BODY_SIZE
      : (styleOn ? (hero ? S.bodySize + 3 : S.bodySize)
        : (hero ? 20 : (isQuote ? 17 : (type === 'recommend' ? 15 : 14))));
    const lh = (type === 'dailysign') ? Math.round(DATE_BODY_SIZE * 1.75)
      : (styleOn ? (hero ? S.bodyLineHeight + 4 : S.bodyLineHeight)
        : (hero ? 34 : (isQuote ? 30 : (type === 'recommend' ? 26 : 24))));
    const clamp = isQuote ? 6 : 8;
    txt(d.body, { left: PAD, top: y, width: innerW, color: ink,
      fontSize: fs, lineHeight: lh, lineClamp: clamp,
      fontWeight: (hero && !styleOn) || type === 'dailysign' ? 'bold' : undefined,
      fontFamily: bodyFont, letterSpacing: styleOn ? S.bodySpacing : 0,
      textAlign: type === 'dailysign' && !styleOn ? 'center' : bodyAlign });
    y += countLines(d.body, innerW, fs, measure, clamp) * lh + 12;

    // ── 收尾引号（下引号）──
    // 2026-10-07 用户反馈「只有上引号没有下引号」：单上引号头重脚轻。
    // literary 风格给decoClose（❞）画一个下引号，与上方 ❝ 成对；
    // ❀ / ◆ 本身是完整花纹、warm/poster 的 decoClose 为空，故不画。
    const closeMark = styleOn ? (S.decoClose || '') : '';
    if (wantDeco && closeMark) {
      const cSize = styleOn ? Math.round(S.decoSize * 0.9) : 18;
      const cLh = Math.round(cSize * 1.2);
      txt(closeMark, { left: PAD, top: y, width: type === 'dailysign' ? innerW : 40, color: p.primary,
        fontSize: cSize, fontWeight: 'bold', lineHeight: cLh,
        fontFamily: decoFont,
        textAlign: type === 'dailysign' ? 'center' : 'left' });
      y += cLh + 4;
    }
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
  // ⚠️ 落款只认用户真实署名（author / source）。**不再兜底「长按识别小程序码」这类引导文案**——
  //    二维码自己会说话，卡面写「长按识别…」属于噪声，且在小红书/朋友圈场景里显得像广告。
  //    没有 author 就让这一行空着（下面 foot 为空则不push text节点，不占纵向空间）。
  const foot = d.author || d.source || '';
  if (foot) {
    txt(foot, { left: PAD, top: hasQr ? y + Math.round((QS - 18) / 2) : y,
      width: hasQr ? innerW - QS - 12 : innerW,
      color: sub, fontSize: 12, lineHeight: 18, lineClamp: 2, textAlign: 'left' });
  }
  y += (hasQr ? QS : 18) + 18;

  const height = Math.max(y, 200);
  const model = {
    width: W, height,
    gradient: p.bg,
    radius: p.radius,
    children
  };
  if (d.bgImg) model.backgroundImage = d.bgImg; // 页面加载图片后注入 backgroundImageAsset
  // 内置包内背景图靠蒙版强度近似灰度/虚化/原图三档（网络图由picsum 服务端做，见 utils/bg_pack.js）
  if (d.bgVeil) model.bgVeil = d.bgVeil;
  return model;
}

module.exports = { CARD_TYPES, buildCardModel, W, PAD };
