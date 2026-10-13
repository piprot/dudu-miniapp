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
const brand = require('../brand_line.js');

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

// ── 成图版式（2026-10-12）──────────────────────────────────────────────────
// band / signature / minimal / masthead / headline 这 5 种是**成图**，不是卡片：
// 固定 3:4 竖幅（340×453）、文字压在全出血照片上、底部只有两行品牌信息，
// **不带**类型胶囊 / 右上品牌水印 / 外框 / 分隔线（参考图上都没有）。
// 走独立的 buildFrameModel：卡片版式的流式高度 + 控件锚点，与成图的「比例感」天生冲突，
// 硬塞进同一条流水线只会两头都不像。
const FRAME_H = Math.round(W * 4 / 3);   // 340 × 453，3:4 竖幅
const QR_S = 44;                          // 成图模式的码：比卡片版的 56 小一档，让位给版式
const FRAME_LAYOUTS = { band: 1, signature: 1, minimal: 1, masthead: 1, headline: 1 };

function countLines(text, width, fontPx, measure, clamp) {
  return Math.min(wrapText(String(text || ''), width, measure, fontPx).length, clamp);
}

/**
 * 成图版式构建器（3:4 竖幅，底部两行品牌行 + 右下角小程序码）。
 *
 * 坐标系：整幅 340×453；底部锚点自下往上算——
 *   小程序码 bottom=PAD、两行品牌行紧贴码的上方（行2 在下、行1 在上），
 *   主体内容（色带/正文/大字）放在中上部。这样无论文字长短，底部的「署名区」
 *   永远在同一位置，一组图连发时不会跳。
 */
function buildFrameModel(type, themeId, data, opts, S, L) {
  const p = palette(themeId);
  const d = data || {};
  const measure = (opts && opts.measure) || defaultMeasure;
  const onPhoto = !!d.bgImg;
  const ink = onPhoto ? '#ffffff' : p.ink;
  const sub = onPhoto ? 'rgba(255,255,255,0.88)' : p.sub;
  const faint = onPhoto ? 'rgba(255,255,255,0.62)' : fontKit.alpha(p.sub, 0.85);
  const font = p.cjkFont;
  const serif = fontKit.familyOf(S.titleFont);
  const kai = fontKit.familyOf('kai');
  const H = FRAME_H;
  const innerW = W - PAD * 2;
  const typeName = CARD_TYPES[type].name;
  const children = [];

  // 文字节点助手：照片背景下自动挂投影（照参考图：白字直接压图，靠投影保可读）。
  // 例外——压在**浅色带**里的文字（色带版式）必须 noShadow，浅底上挂黑影会糊成一团。
  const txt = (content, o) => {
    const node = Object.assign({ type: 'text', content: String(content == null ? '' : content), fontFamily: font }, o);
    if (onPhoto && !node.shadow && !node.noShadow) {
      node.shadow = { color: 'rgba(0,0,0,0.55)', blur: Math.max(3, Math.round((node.fontSize || 14) * 0.35)), y: 1 };
    }
    delete node.noShadow;
    children.push(node);
  };
  const rect = (o) => children.push(Object.assign({ type: 'rect' }, o));

  // ── 底部锚点（所有成图版式共用，保证一组图的署名区永远在同一位置）──
  const qrTop = H - PAD - QR_S;        // 389
  const l2Top = qrTop - 6 - 14;        // 369  行2：年份｜品牌 @人名
  const l1Top = l2Top - 16;            // 353  行1：标签链 / 栏脚
  const author = d.author || d.source || '';

  // ① 色带：整宽出血的浅色磨砂带 + 带内深色字（照参考图的「提亮带 + 黑字」，
  //    关键差异：**不是**暗色蒙版 + 白字——带子是提亮的，字必须转深色才清楚）。
  if (L === 'band') {
    const bodyFs = S.bodySize, bodyLh = S.bodyLineHeight;
    const bodyLines = d.body ? countLines(d.body, innerW - 8, bodyFs, measure, 4) : 0;
    const subLines = d.subtitle ? countLines(d.subtitle, innerW - 8, 12, measure, 2) : 0;
    let innerH = 0;
    if (d.title) innerH += 12 + 6;
    if (bodyLines) innerH += bodyLines * bodyLh;
    if (subLines) innerH += 6 + subLines * 18;
    if (author) innerH += 10 + 15;
    const bandH = innerH + 44;
    const bandTop = Math.round(H * 0.30);                  // 参考图带子在中部偏下
    // 带色：照片上必须用白（0.55 叠深色照片会成中灰，像压暗带；参考图是明显提亮的
    // 浅白带，所以拉到 0.75）。**没有照片**时底本身就是浅米色，再叠白等于没画——
    // 改用主题主色的 10% 淡染，带子才看得见，深色字照样清楚。
    const bandBg = onPhoto ? 'rgba(255,255,255,0.75)' : fontKit.alpha(p.primary, 0.10);
    rect({ left: 0, top: bandTop, width: W, height: bandH, background: bandBg });
    let by = bandTop + 22;
    if (d.title) {
      txt(d.title, { left: PAD, top: by, width: innerW, color: '#3d3d3d', fontSize: 12, lineHeight: 12, lineClamp: 1, textAlign: 'center', noShadow: true });
      by += 18;
    }
    if (d.body) {
      txt(d.body, { left: PAD + 4, top: by, width: innerW - 8, color: '#1f1f1f', fontSize: bodyFs,
        lineHeight: bodyLh, lineClamp: 4, textAlign: 'center', noShadow: true });
      by += bodyLines * bodyLh;
    }
    if (subLines) {
      txt(d.subtitle, { left: PAD + 4, top: by + 6, width: innerW - 8, color: '#3d3d3d', fontSize: 12,
        lineHeight: 18, lineClamp: 2, textAlign: 'center', noShadow: true });
      by += 6 + subLines * 18;
    }
    if (author) {
      txt('—— ' + author, { left: PAD + 4, top: by + 10, width: innerW - 8, color: '#4a4a4a',
        fontSize: 11, lineHeight: 15, lineClamp: 1, textAlign: 'right', noShadow: true });
    }
    // 底部：参考图是「英文小字行 + 品牌 logo」两行栏脚。
    // 行1 用逐字空格的年份英译行（补之前缺的英文行），行2 是居中品牌名。
    txt(brand.yearLine(), { left: PAD, top: l1Top, width: innerW, color: faint,
      fontSize: 10, lineHeight: 14, lineClamp: 1, textAlign: 'center' });
    txt(d.brandName || brand.BRAND, { left: PAD, top: l2Top, width: innerW, color: ink,
      fontSize: 11, lineHeight: 15, lineClamp: 1, textAlign: 'center', fontFamily: serif });
  }

  // ② 签名：右上角手写署名（楷体）+ 一条短装饰线；底部标签链 + 品牌行
  if (L === 'signature') {
    const sign = author || brand.BRAND;
    const sw = Math.ceil(measure(sign, 15) * 1.3) + 6;
    txt(sign, { left: W - PAD - sw, top: 14, width: sw, color: ink, fontSize: 15,
      fontWeight: 'bold', lineHeight: 20, fontFamily: kai, textAlign: 'right' });
    rect({ left: W - PAD - 34, top: 38, width: 34, height: 1,
      background: onPhoto ? 'rgba(255,255,255,0.7)' : fontKit.alpha(p.primary, 0.7) });
    if (d.title) {
      txt(d.title, { left: PAD, top: Math.round(H * 0.28), width: innerW, color: sub,
        fontSize: 12, lineHeight: 16, lineClamp: 1, textAlign: 'center' });
    }
    if (d.body) {
      txt(d.body, { left: PAD, top: Math.round(H * 0.36), width: innerW, color: ink,
        fontSize: S.bodySize, lineHeight: S.bodyLineHeight, lineClamp: 5, textAlign: 'center' });
    }
    txt(brand.tagLine(d.brandTags), { left: PAD, top: l1Top, width: innerW, color: sub,
      fontSize: 11, lineHeight: 15, lineClamp: 1, textAlign: 'center' });
    txt(brand.signLine(author, d.brandName), { left: PAD, top: l2Top, width: innerW, color: faint,
      fontSize: 10, lineHeight: 14, lineClamp: 1, textAlign: 'center' });
  }

  // ③ 极简：什么都不加，只有正文 + 左下角两行极小水印（照参考图 3）
  if (L === 'minimal') {
    if (d.title) {
      txt(d.title, { left: PAD, top: Math.round(H * 0.34), width: innerW, color: sub,
        fontSize: 12, lineHeight: 16, lineClamp: 1, textAlign: 'left' });
    }
    if (d.body) {
      txt(d.body, { left: PAD, top: Math.round(H * 0.42), width: innerW - 40, color: ink,
        fontSize: S.bodySize, lineHeight: S.bodyLineHeight, lineClamp: 6, textAlign: 'left' });
    }
    txt(brand.watermarkLine(), { left: PAD, top: H - PAD - 27, width: innerW - 56, color: faint,
      fontSize: 10, lineHeight: 14, lineClamp: 1, textAlign: 'left' });
    txt(d.brandSlogan || brand.DEFAULT_SLOGAN, { left: PAD, top: H - PAD - 13, width: innerW - 56,
      color: onPhoto ? 'rgba(255,255,255,0.5)' : fontKit.alpha(p.sub, 0.7), fontSize: 10, lineHeight: 13, lineClamp: 1 });
  }

  // ④ 刊头：贴顶的极淡栏目字链（照参考图 4 顶部「M E W O R L D T E A M」——小、淡、字距大）
  //    + 正文居中 + 底部两行栏脚
  if (L === 'masthead') {
    const chain = brand.spaced(typeName);
    const cw = Math.ceil(measure(chain, 10) * 1.2);
    txt(chain, { left: (W - cw) / 2, top: 10, width: cw,
      color: onPhoto ? 'rgba(255,255,255,0.5)' : fontKit.alpha(p.primary, 0.45),
      fontSize: 10, lineHeight: 14, lineClamp: 1, textAlign: 'center' });
    if (d.title) {
      txt(d.title, { left: PAD, top: Math.round(H * 0.34), width: innerW, color: sub,
        fontSize: 12, lineHeight: 16, lineClamp: 1, textAlign: 'center' });
    }
    if (d.body) {
      txt(d.body, { left: PAD, top: Math.round(H * 0.42), width: innerW, color: ink,
        fontSize: S.bodySize, lineHeight: S.bodyLineHeight, lineClamp: 5, textAlign: 'center' });
    }
    txt(brand.BRAND + ' ❄ ' + typeName + ' ｜ 记录生活·分享美好', { left: PAD, top: l1Top, width: innerW,
      color: sub, fontSize: 11, lineHeight: 15, lineClamp: 1, textAlign: 'center' });
    // 行2 带年份 + 品牌（与其余成图版式同构，一组图扫下来署名区才齐整）
    txt(brand.signLine(author, d.brandName), { left: PAD, top: l2Top, width: innerW,
      color: faint, fontSize: 10, lineHeight: 14, lineClamp: 1, textAlign: 'center' });
  }

  // ⑤ 大字：底部衬线大字压阵，两字之间嵌一列竖排小字（照参考图 5「早(美/學)餐」）
  if (L === 'headline') {
    // 大字主体取「标题」优先（标题是主题词，如「早餐」）；没有标题（金句卡）时才退而用正文。
    const heroIsTitle = !!(d.title && Array.from(String(d.title)).length <= 6);
    const heroText = heroIsTitle ? String(d.title) : String(d.body || '');
    const heroChars = Array.from(heroText);
    // 竖排嵌字只在「2–4 个字的主题词」时启用——长句子中间插字会变成排版事故
    const useInset = heroIsTitle && heroChars.length >= 2 && heroChars.length <= 4;
    if (heroIsTitle && d.body) {
      txt(d.body, { left: PAD, top: Math.round(H * 0.30), width: innerW, color: sub,
        fontSize: 15, lineHeight: 26, lineClamp: 4, textAlign: 'center' });
    }
    if (!heroIsTitle && d.title) {
      // 标题没被当成大字（如日签卡的「10月7日 · 星期二」这种元信息），退成顶部一行小字，
      // 不能直接丢掉——日期/来源这类信息用户是需要的。
      txt(d.title, { left: PAD, top: Math.round(H * 0.30), width: innerW, color: sub,
        fontSize: 12, lineHeight: 16, lineClamp: 1, textAlign: 'center' });
    }
    if (useInset) {
      const heroFs = heroChars.length <= 2 ? 74 : (heroChars.length === 3 ? 58 : 46);
      const insetFs = Math.round(heroFs * 0.34);
      const insetChars = Array.from(String(d.inset || brand.DEFAULT_INSET)).slice(0, 2);
      const insetW = insetFs + 6;
      const heroW = heroChars.length * heroFs + insetW;
      const heroBlockH = heroFs + 8;
      const heroTop = l1Top - 16 - heroBlockH;
      let hx = Math.round((W - heroW) / 2);
      heroChars.forEach((c, i) => {
        txt(c, { left: hx, top: heroTop, width: heroFs, color: ink, fontSize: heroFs,
          fontWeight: 'normal', lineHeight: heroBlockH, lineClamp: 1,
          fontFamily: serif, textAlign: 'center' });
        hx += heroFs;
        if (i === 0) {
          // 竖排：两个字各占一行，整体在大字块里居中
          const iTop = heroTop + Math.round((heroBlockH - insetChars.length * (insetFs + 4)) / 2);
          insetChars.forEach((ic, k) => {
            txt(ic, { left: hx, top: iTop + k * (insetFs + 4), width: insetW, color: faint,
              fontSize: insetFs, lineHeight: insetFs + 4, lineClamp: 1,
              fontFamily: serif, textAlign: 'center' });
          });
          hx += insetW;
        }
      });
    } else {
      // 长句大字：按字数自适应字号，衬线居中，最多 3 行
      const n = heroChars.length;
      const fs2 = n <= 6 ? 40 : (n <= 10 ? 30 : (n <= 16 ? 24 : 20));
      const lh = Math.round(fs2 * 1.28);
      const lines = countLines(heroText, innerW, fs2, measure, 3);
      txt(heroText, { left: PAD, top: l1Top - 16 - lines * lh, width: innerW, color: ink,
        fontSize: fs2, lineHeight: lh, lineClamp: 3, fontFamily: serif, textAlign: 'center' });
    }
    txt(brand.yearLine(), { left: PAD, top: l1Top, width: innerW,
      color: onPhoto ? 'rgba(255,255,255,0.9)' : sub, fontSize: 10, lineHeight: 15, lineClamp: 1, textAlign: 'center' });
    txt(brand.BRAND + ' ❄ ' + typeName + (author ? ' @' + author : ''), { left: PAD, top: l2Top, width: innerW,
      color: faint, fontSize: 10, lineHeight: 14, lineClamp: 1, textAlign: 'center' });
  }

  // ⑥ 小程序码：右下角 44px（成图版式也不摘码——回流入口是产品硬需求）
  children.push({ type: 'qrcode', left: W - PAD - QR_S, top: qrTop, size: QR_S, asset: d.qrAsset });

  const model = {
    width: W,
    height: H,               // 固定 3:4，不随内容变高——成图的"比例感"就是它
    gradient: p.bg,
    radius: p.radius,
    children
  };
  if (d.bgImg) model.backgroundImage = d.bgImg;
  if (d.bgVeil) model.bgVeil = d.bgVeil;
  return model;
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

  // ── 排版风格（2026-10-06 新增，2026-10-12 扩到 9 种）：字体族 × 字重 × 字距 × 对齐 × 装饰符号 ──
  // data.styleKey 可传 'literary' | 'modern' | 'warm' | 'poster'
  //   | 'band' | 'signature' | 'minimal' | 'masthead' | 'headline'（见 utils/font_kit.js）。
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
  // 排版风格现在不仅换字体，还换**结构**（顶部锚点 / 标题处理 / 装饰位置 / 外框）。
  // L 决定用哪套构图骨架：editorial(文艺) / swiss(现代) / memo(温暖) / poster(海报) /
  // band(色带) / signature(签名) / minimal(极简) / masthead(刊头) / headline(大字)。
  // plain 仅用于「未显式开风格」的历史卡片，保持旧观感（向后兼容单测）。
  const L = styleOn ? (S.layout || 'editorial') : 'plain';
  // ── 成图版式分流（2026-10-12）──
  // band/signature/minimal/masthead/headline 是「3:4 成图」：固定画幅 + 底部品牌行 +
  // 无控件元素，结构与卡片版式完全不同，走独立构建器。
  // 仍然从 buildCardModel 出去，调用方（5 个页面 / 海报 / 预览工具）无需改一行。
  if (styleOn && FRAME_LAYOUTS[L]) {
    return buildFrameModel(type, themeId, data, opts, S, L);
  }
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

  // ── 顶部锚点（按风格分结构）──
  // poster：整宽主色 header 带（类型名反白居中），海报识别度最高。
  // masthead(刊头)：居中「字链」栏目名 + 1px 细线（参照社群物料的顶部刊头）。
  // minimal(极简) / signature(签名)：**完全不做顶部装饰**——这两套的版式就是做减法，
  //   一条 4px 顶带会把画面从顶部切断（参考图 3 静默氛围图 / 图 2 生活打卡图的处理）。
  // memo(温暖)：不做顶部装饰（v2 做减法——旧版胶带条与便签/外框叠三层显乱），
  //   温暖的识别交给「浅底便签 + 居中楷体」，其余沿用 4px 主色细条。
  const BRAND = 'dudu 画面感';
  if (styleOn && L === 'poster') {
    rect({ left: 0, top: 0, width: W, height: 34, background: p.primary, radius: p.radius });
    const bandName = CARD_TYPES[type].name;
    const bw = measure(bandName, 13);
    txt(bandName, { left: (W - bw) / 2, top: 11, width: bw, color: '#ffffff', fontSize: 13, fontWeight: 'bold', lineHeight: 16, textAlign: 'center' });
    y = 34 + 14;
  } else if (styleOn && L === 'masthead') {
    // 字链：字符之间手动插空格（引擎不消费 letterSpacing，插空格才真的看得见字距）。
    // 宽度留 25% 余量：measure 用 sans-serif 量，渲染却走主题字体（衬线/楷体更宽），
    // 不留余量就会折行（右上角品牌字折行就是这么来的）。
    const headName = CARD_TYPES[type].name.split('').join(' ');
    const hw = Math.ceil(measure(headName, 13) * 1.25);
    txt(headName, { left: (W - hw) / 2, top: 14, width: hw, color: ink, fontSize: 13,
      fontWeight: 'bold', lineHeight: 18, textAlign: 'center' });
    rect({ left: 0, top: 36, width: W, height: 1, background: fontKit.alpha(p.primary, 0.45) });
    y = 50;
  } else if (styleOn && (L === 'minimal' || L === 'signature')) {
    y = 16;
  } else {
    rect({ left: 0, top: 0, width: W, height: 4, background: p.primary });
    y = 18;
  }

  // ── 头部：类型小标签 + 品牌水印 ──
  // poster 的类型名已进 header 带，这里只留品牌水印（右下弱色）。
  // memo(温暖) 把类型 pill 改成居中胶囊，强化手账感。
  // masthead(刊头) / minimal(极简) 都不画 pill：前者类型名已在顶部刊头，
  //   后者整套版式不留任何控件感元素。
  // signature(签名) 用「右上角手写署名」替代 pill —— 署名是「我在场」的痕迹，
  //   比一个胶囊标签更有温度（参考图 2 右上角的手写 logo）。
  if (styleOn && L === 'poster') {
    const brandW = Math.ceil(measure(BRAND, 10) * 1.2) + 4;
    txt(BRAND, { left: W - PAD - brandW, top: y - 2, width: brandW, color: sub, fontSize: 10, lineHeight: 12 });
    y += 14;
  } else if (styleOn && L === 'masthead') {
    y += 2;
  } else if (styleOn && L === 'minimal') {
    y += 2;
  } else if (styleOn && L === 'signature') {
    const sign = d.author || BRAND;
    // 宽度留 30% 余量：署名用楷体渲染但用 sans-serif 测量，楷体更宽，不留余量会折行
    const sw = Math.ceil(measure(sign, 13) * 1.3) + 4;
    txt(sign, { left: W - PAD - sw, top: y - 4, width: sw, color: onPhoto ? '#ffffff' : p.primary,
      fontSize: 13, fontWeight: 'bold', lineHeight: 18,
      fontFamily: fontKit.familyOf('kai'), textAlign: 'right' });
    y += 28;
  } else {
    const pillText = CARD_TYPES[type].name;
    const pillW = Math.ceil(measure(pillText, 11)) + 20;
    if (styleOn && L === 'memo') {
      const px = (W - pillW) / 2;
      rect({ left: px, top: y, width: pillW, height: 22, background: p.bgSoft, radius: 11 });
      txt(pillText, { left: px + 10, top: y + 4, width: pillW - 20, color: p.primary, fontSize: 11, fontWeight: 'bold', lineHeight: 14, noShadow: true, textAlign: 'center' });
    } else {
      rect({ left: PAD, top: y, width: pillW, height: 22, background: p.bgSoft, radius: 11 });
      // noShadow：pill 有实色底块，投影只会让 11px 小字发糊（2026-10-07 整改）
      txt(pillText, { left: PAD + 10, top: y + 4, width: pillW - 20, color: p.primary, fontSize: 11, fontWeight: 'bold', lineHeight: 14, noShadow: true });
    }
    // 品牌水印宽度留 20% 余量（同上：measure 用 sans-serif，渲染走主题字体，余量不足会折行）
    const brandW = Math.ceil(measure(BRAND, 10) * 1.2) + 4;
    txt(BRAND, { left: W - PAD - brandW, top: y + 5, width: brandW, color: sub, fontSize: 10, lineHeight: 12 });
    y += 22 + 16;
  }

  // ── 日历信息区（公历/农历/干支生肖）──
  // 2026-10-07 用户要求：这些信息**左对齐、放在图片左下角**。
  // 故不在此处流式绘制，改为配图绘制完后在图上叠印（见下方 hasCover 分支）。
  // 无配图时退化为标题上方的居中小字，保证信息不丢。

  // ── kicker：小字元信息行（城市/天气/日期等），**必须比正文小**──
  // 用途：天气卡这类「金句是主体、天气只是场景」的卡，把场景信息从20px 粗体标题槽
  // 降到 12px 灰字，让金句真正成为视觉主体。旧版把「北京·晴·好心情」塞进标题槽，
  // 结果天气信息比金句还抢眼，喧宾夺主。
  if (d.kicker) {
    const kFs = 12, kLh = 17;
    const kLines = countLines(d.kicker, innerW, kFs, measure, 2);
    // swiss(现代) 元信息走等宽，强化瑞士网格的克制数字感
    txt(d.kicker, { left: PAD, top: y, width: innerW, color: sub, fontSize: kFs, lineHeight: kLh,
      lineClamp: 2, fontFamily: (styleOn && L === 'swiss') ? fontKit.familyForRole('date') : font,
      textAlign: (styleOn ? S.bodyAlign : (type === 'dailysign' ? 'center' : 'left')) });
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
    // ── 标题下方分隔（按风格分结构）──
    // swiss(现代)：2px 主色粗基线，瑞士国际主义的强网格语言。
    // editorial(文艺)：1px 主色发丝线，编辑式细分割，书卷克制。
    // memo(温暖)：24px 居中小短线（半透明主色），便签卡的轻点缀——参照「模块标题配同色短横线」。
    // masthead(刊头)：1px 发丝线，与顶部刊头细线呼应，刊物内页的层级感。
    // headline(大字)：3px 主色厚分隔，撑得住 24px 大标题的量感（细线会被大字压没）。
    // band(色带) / minimal(极简)：不画——色带本身已是分界，极简则什么都不加。
    const titleBlockH = tLines * tLh;
    if (styleOn && L === 'swiss') {
      rect({ left: PAD, top: y + titleBlockH + 4, width: innerW, height: 2, background: p.primary });
      y += titleBlockH + 10 + 6;
    } else if (styleOn && L === 'editorial') {
      rect({ left: PAD, top: y + titleBlockH + 4, width: innerW, height: 1, background: fontKit.alpha(p.primary, 0.5) });
      y += titleBlockH + 10 + 4;
    } else if (styleOn && L === 'masthead') {
      rect({ left: PAD, top: y + titleBlockH + 4, width: innerW, height: 1, background: fontKit.alpha(p.primary, 0.4) });
      y += titleBlockH + 10 + 4;
    } else if (styleOn && L === 'headline') {
      rect({ left: PAD, top: y + titleBlockH + 5, width: innerW, height: 3, background: p.primary });
      y += titleBlockH + 10 + 8;
    } else if (styleOn && L === 'memo') {
      rect({ left: (W - 24) / 2, top: y + titleBlockH + 5, width: 24, height: 3, radius: 2,
        background: fontKit.alpha(p.primary, 0.75) });
      y += titleBlockH + 10 + 8;
    } else {
      y += titleBlockH + 10;
    }
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

  // ── 日历信息区：公历/农历/干支生肖 ──
  // 2026-10-07 用户要求：两行小字、**左对齐、放在图片的左下角**。
  // 「图片」= 卡片背景图（bgImg，铺满整卡），故左下角 = 卡片底部左侧。
  // 绘制时机放在**底部信息行阶段**（见下方 foot 逻辑），此处只取值不落位。

  // ── 金句引导符（quote / dailysign 专属装饰）──
  // 注意：风格声明 showDeco:false 时**不生成装饰节点**（否则会留一个 0px 的空块白占纵向空间）。
  const isQuote = (type === 'quote' || type === 'dailysign');
  const wantDeco = isQuote && !!d.body && !(styleOn && !S.showDeco);
  if (wantDeco) {
    const mark = styleOn ? S.deco : '❝';
    // 装饰符**不能比金句本体还大**（旧版26px 引号压过 17px 金句，喧宾夺主还显闷）。
    // 现在封顶到 20px：hero 卡（金句 20px）用 18，小金句（17px）配 20 刚好成对。
    let dSize = styleOn ? S.decoSize : (d.hero ? 18 : 20);
    let dLeft = PAD;
    let dAlign = (type === 'dailysign') ? 'center' : 'left';
    let dWidth = type === 'dailysign' ? innerW : 40;
    // editorial(文艺) 金句卡：左栏大引号 drop-cap（34px，左对齐），强化书卷编辑式。
    // memo(温暖)：装饰居中（便签卡是全居中构图，❀ 偏左会破坏对称）。
    // 日签保持居中（它的识别特征），不改。
    if (styleOn && L === 'editorial' && type === 'quote') {
      dSize = 34; dLeft = PAD; dAlign = 'left'; dWidth = 60;
    } else if (styleOn && L === 'memo') {
      dAlign = 'center'; dWidth = innerW;
    } else if (styleOn && L === 'masthead') {
      // 刊头风：装饰符居中（顶部刊头 + 居中分隔已是中轴构图，偏左会破坏对称）
      dAlign = 'center'; dWidth = innerW;
    }
    const dLh = Math.round(dSize * 1.2);
    txt(mark, { left: dLeft, top: y, width: dWidth, color: p.primary,
      fontSize: dSize, fontWeight: 'bold', lineHeight: dLh,
      fontFamily: decoFont,
      textAlign: dAlign });
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
    const bodyLines = countLines(d.body, innerW, fs, measure, clamp);
    // ⚠️ memo(温暖) 这里曾有 v2「奶油便签」——一块 p.bgSoft 浅橙大圆角块托住正文。
    //    2026-10-13 用户反馈「中间的色块去一下，一点都不好看」，已撤除。
    //    实际观感：卡片本身就浅底、构图居中，再垫一块和正文差不多大的浅色方块，
    //    效果是"糊了一块"而不是"托住了"。现在正文直接坐在卡面上，靠居中 + 上下引号
    //    保持温柔感。**别再因为"想加点设计感"把它加回来，用户明确否过一次。**
    if (styleOn && L === 'band') {
      // band(色带)：正文上下各留 14px 呼吸，用一条**整宽**半透明主色带把文字从底图里
      // 托出来，带子的上下边缘各 1px 发丝线定界（否则色带边界在照片上会糊掉）。
      // 参照图 1「磨砂色带引言卡」：图再花，色带也隔出一块安静的阅读区。
      // 色带必须 push 在正文文本之前，否则会盖住文字（引擎按 blocks 顺序绘制）。
      const bandTop = y - 14;
      const bandH = bodyLines * lh + 28;
      rect({ left: 0, top: bandTop, width: W, height: bandH, background: fontKit.alpha(p.primary, 0.08) });
      rect({ left: 0, top: bandTop, width: W, height: 1, background: fontKit.alpha(p.primary, 0.22) });
      rect({ left: 0, top: bandTop + bandH - 1, width: W, height: 1, background: fontKit.alpha(p.primary, 0.22) });
    }
    txt(d.body, { left: PAD, top: y, width: innerW, color: ink,
      fontSize: fs, lineHeight: lh, lineClamp: clamp,
      fontWeight: (hero && !styleOn) || type === 'dailysign' ? 'bold' : undefined,
      fontFamily: bodyFont, letterSpacing: styleOn ? S.bodySpacing : 0,
      textAlign: type === 'dailysign' && !styleOn ? 'center' : bodyAlign });
    y += bodyLines * lh + 12;

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
  // minimal(极简)：**连分隔线都不画**（整套版式不留任何线条，文字直接坐在图上）。
  // headline(大字)：3px 主色厚分隔线，与上方 24px 大标题配成一套「封面感」。
  // ⚠️ 2026-10-13 用户反馈「文艺/现代/温暖/海报怎么中间有一条横线，这是不对的」——
  //    卡片版式的这条底部分隔线已整段撤除。它其实一直都在，只是旧版渲染引擎把
  //    line 元素判成了**竖线**（1px 宽、贯穿卡高、颜色是极淡的 p.line），在浅色卡面上
  //    几乎不可见；后来修好 line 的水平线语义，它才变成横贯卡面的一条横线被用户看到。
  //    所以"改回原有的版式"= 去掉这条线，而不是把它改细改淡。
  //    ⚠️ 别再往卡片版式里加分隔线——正文与落款之间用留白分就够了。
  y += 12;   // 间距与原「有线时」保持一致，落款位置不变，只是不画线
  const hasQr = !!d.qr;
  const QS = hasQr ? 56 : 0;
  if (hasQr) {
    children.push({ type: 'qrcode', left: W - PAD - QS, top: y, size: QS, asset: d.qrAsset });
  }
  // ⚠️ 落款只认用户真实署名（author / source）。**不再兜底「长按识别小程序码」这类引导文案**——
  //    二维码自己会说话，卡面写「长按识别…」属于噪声，且在小红书/朋友圈场景里显得像广告。
  //    没有 author 就让这一行空着（下面 foot 为空则不push text节点，不占纵向空间）。
  //
  // 落款对齐/字号按风格分结构：
  //   band(色带)  → 右对齐（与色带引言卡的出处行一致）
  //   masthead / signature → 居中（刊头风的栏脚、签名风的署名行都是居中收尾）
  //   minimal(极简) → 11px 极小字，退成「痕迹」
  //   signature(签名) → **底部不重复署名**：名字已经写在右上角了
  const foot = d.author || d.source || '';
  const footCentered = !!(styleOn && (L === 'masthead' || L === 'signature'));
  const skipFoot = !!(styleOn && L === 'signature');
  if (foot && !skipFoot) {
    // swiss(现代) 落款也走等宽，与上方元信息呼应
    txt(foot, { left: PAD, top: hasQr ? y + Math.round((QS - 18) / 2) : y,
      width: hasQr ? innerW - QS - 12 : innerW,
      color: sub, fontSize: (styleOn && L === 'minimal') ? 11 : 12, lineHeight: 18, lineClamp: 2,
      fontFamily: (styleOn && L === 'swiss') ? fontKit.familyForRole('date') : font,
      textAlign: footCentered ? 'center' : ((styleOn && L === 'band') ? 'right' : 'left') });
  }
  // 极简风没有署名时补一行极小水印：否则整卡下半部全空，看不出这张图出自哪里
  // （参考图 3 的处理——文字退成痕迹，但不能没有）。
  if (styleOn && L === 'minimal' && !foot) {
    txt(BRAND, { left: PAD, top: hasQr ? y + Math.round((QS - 15) / 2) : y,
      width: hasQr ? innerW - QS - 12 : innerW,
      color: sub, fontSize: 11, lineHeight: 15, textAlign: 'left' });
  }
  // ── 日历信息（公历/农历/干支生肖）画在**左下角** ──
  // 2026-10-07 用户要求：两行小字、左对齐、放在图片左下角。「图片」指卡片背景图
  // （bgImg 铺满整卡），所以左下角= 底部信息行左侧——正是取消落款后空出来的那块。
  // 与小程序码同行、垂直居中；有二维码时只占左侧，避免被码压住。
  const solarLs = (d.solarLines || []).filter(Boolean);
  if (solarLs.length) {
    const cFs = 11, cLh = 15;
    // 有码时右侧留出码宽；无码则占满内侧宽度。
    const cW = hasQr ? innerW - QS - 12 : innerW;
    // 垂直居中于二维码行；无码时直接贴顶。
    const blockH = solarLs.length * cLh;
    const baseTop = hasQr ? y + Math.max(0, Math.round((QS - blockH) / 2)) : y;
    // 照片背景（bgImg）下用白字 + 投影才看得清；否则用弱色。
    const onBg = !!d.bgImg;
    solarLs.forEach((ln, i) => {
      txt(String(ln), { left: PAD, top: baseTop + i * cLh, width: cW,
        color: onBg ? '#ffffff' : sub, fontSize: cFs, lineHeight: cLh,
        lineClamp: 1, textAlign: 'left',
        ...(onBg ? { shadow: { color: 'rgba(0,0,0,0.55)', blur: 4, y: 1 } } : {}) });
    });
  }
  // ── 栏脚行（signature / masthead 专属）：底部第二行品牌信息 ──
  // 参照图 2「2026｜INNER FREE @ 泡芙」与图 4 底部的「社群名｜口号」两行结构：
  // 第一行是署名/落款，第二行才是「年份｜品牌」这类归属信息。
  // 有二维码时压到码行下方，避免与右侧的码抢位；无码时紧跟落款行。
  const footLines = (styleOn && (L === 'signature' || L === 'masthead')) ? 1 : 0;
  if (footLines) {
    const year = new Date().getFullYear();
    const line2 = (L === 'signature') ? (year + '｜' + BRAND) : BRAND;
    const l2Top = hasQr ? (y + QS + 6) : (y + (foot && !skipFoot ? 20 : 0));
    txt(line2, { left: PAD, top: l2Top, width: innerW,
      color: sub, fontSize: 11, lineHeight: 16, textAlign: 'center',
      fontFamily: fontKit.familyForRole('date') });
  }
  y += (hasQr ? QS : 18) + 18 + (footLines ? 22 : 0);

  const height = Math.max(y, 200);

  // ── 整卡外框（按风格分结构，仅描边不填色）──
  // swiss(现代)：1px 主色实线框，几何包裹感。
  // poster(海报)：1px 主色实线框，收束整宽色带。
  // memo(温暖)：v2 不画外框（v1 的柔框+胶带+高亮块叠三层是「不好看」的主因），
  //   温暖感全交给那块浅底便签，卡面只有一层盒子。
  // editorial / plain：不画外框，保持留白。
  if (styleOn && (L === 'swiss' || L === 'poster')) {
    rect({ left: 1, top: 1, width: W - 2, height: height - 2, border: 1, borderColor: p.primary, radius: p.radius });
  }

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
