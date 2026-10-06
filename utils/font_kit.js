// utils/font_kit.js —— 字体族库 + 排版风格库（零体积 · 零网络 · 零闪烁）
//
// ── 为什么不用自定义字体文件 ──────────────────────────────────────────
// 小程序三条硬墙（2026-10-06 核实）：
//   ① 主包上限 2MB，完整中文字体 10MB+（base64 后再涨三成）；
//   ② wx.loadFontFace 的 source 只接受 https URL 或 base64，**不读包内路径**；
//   ③ canvas 等原生组件**不支持** loadFontFace 添加的字体——而卡片正是 canvas 画的。
//   unicode-range 分片（如 lxgw-wenkai-webfont 的 97 片 woff2）只对 UI 文字生效，
//   canvas 需要全字符集，故此路在卡片场景不通。
//
// ── 结论：用系统字体族 + 排版差异化 ───────────────────────────────────
// iOS 有 PingFang SC / Songti SC / Hiragino Sans GB，Android 有
// Noto Sans CJK / Noto Serif CJK / Droid Sans Fallback，
// canvas 的 ctx.font 会逐个回退，无需下载任何字体文件。
//
// ── 为什么不单调 ─────────────────────────────────────────────────────
// 真正的视觉层次来自「字体族 × 字重 × 字距 × 对齐 × 装饰符号」的组合，
// 而非某一款字形。本库把这套组合抽象成 4 种可直接切换的排版风格。

// ── 字体族 ────────────────────────────────────────────────────────────
// 每族给一串回退链，ctx.font 取第一个系统可用的。
// 注意：不能给字体族名加空格外的特殊字符；canvas 对未加引号的多词族名解析脆弱，
// 故统一用引号包裹。
const FAMILIES = {
  // 黑体：现代、清晰，正文首选
  sans: '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  // 衬线：文艺、有书卷气，标题首选
  serif: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", "SimSun", serif',
  // 圆体：柔和、可爱，装饰与短标题
  round: '"Hiragino Maru Gothic ProN", "Yuanti SC", "Noto Sans CJK SC", "PingFang SC", sans-serif',
  // 楷体：手写感，古风与生活感
  kai: '"Kaiti SC", "STKaiti", "Baoli SC", "Noto Serif CJK SC", "Songti SC", serif',
  // 等宽：数字与日期，气质克制
  mono: '"SF Mono", "Menlo", "Consolas", "Noto Sans Mono CJK SC", monospace'
};

// 语义别名：模板层按用途引用，不直接暴露字体名
const ROLE_FAMILY = {
  title: 'serif',      // 标题走衬线，拉开与正文的层次
  body: 'sans',        // 正文走黑体，可读性优先
  deco: 'round',       // 装饰符号走圆体
  date: 'mono'// 日期数字走等宽
};

function familyOf(name) {
  return FAMILIES[name] || FAMILIES.sans;
}

/** 按语义角色取字体族字符串：roleOf('title') → serif 族的回退链。 */
function familyForRole(role) {
  return familyOf(ROLE_FAMILY[role] || role);
}

// ── 排版风格 ──────────────────────────────────────────────────────────
// 4 种风格，每种是一组完整的排版参数。卡片按风格切换即可整体换气质，
// 无需引入字体文件。
const STYLES = {
  // 文艺书卷：衬线标题 + 居中 + 主色引号（参照原日签模板的气质）
  literary: {
    id: 'literary',
    name: '文艺',
    titleFont: 'serif',
    titleSize: 21,
    titleWeight: 'bold',
    titleSpacing: 1.5,
    titleAlign: 'center',
    bodyFont: 'sans',
    bodySize: 17,
    bodyLineHeight: 31,
    bodyAlign: 'center',
    bodySpacing: 0.5,
    deco: '❝',           // 引号装饰
    decoColor: 'primary',
    decoSize: 26,
    showDeco: true,
    radius: 20
  },
  // 现代简洁：黑体标题 + 左对齐 + 竖线（公告卡气质）
  modern: {
    id: 'modern',
    name: '现代',
    titleFont: 'sans',
    titleSize: 20,
    titleWeight: 'bold',
    titleSpacing: 0.5,
    titleAlign: 'left',
    bodyFont: 'sans',
    bodySize: 15,
    bodyLineHeight: 26,
    bodyAlign: 'left',
    bodySpacing: 0,
    deco: '',// 不用引号，靠主色竖条
    decoColor: 'primary',
    decoSize: 0,
    showDeco: false,
    showBar: true,        // 标题左侧主色竖条
    radius: 12
  },
  // 温暖手写：楷体 + 居中 + 圆点
  warm: {
    id: 'warm',
    name: '温暖',
    titleFont: 'kai',
    titleSize: 22,
    titleWeight: 'bold',
    titleSpacing: 2,
    titleAlign: 'center',
    bodyFont: 'sans',
    bodySize: 17,
    bodyLineHeight: 32,
    bodyAlign: 'center',
    bodySpacing: 1,
    deco: '❀',
    decoColor: 'primary',
    decoSize: 20,
    showDeco: true,
    radius: 24
  },
  // 醒目海报：圆体大字 + 居中（标题党气质，适合分享图）
  poster: {
    id: 'poster',
    name: '海报',
    titleFont: 'round',
    titleSize: 26,
    titleWeight: 'bold',
    titleSpacing: 3,
    titleAlign: 'center',
    bodyFont: 'sans',
    bodySize: 16,
    bodyLineHeight: 30,
    bodyAlign: 'center',
    bodySpacing: 0.5,
    deco: '◆',
    decoColor: 'primary',
    decoSize: 14,
    showDeco: true,
    radius: 16
  }
};

const STYLE_LIST = Object.keys(STYLES).map(k => ({
  id: k, name: STYLES[k].name, titleFont: STYLES[k].titleFont
}));

function styleOf(id) {
  return STYLES[id] || STYLES.literary;
}

function hasStyle(id) {
  return !!STYLES[id];
}

function styleName(id) {
  return hasStyle(id) ? STYLES[id].name : STYLES.literary.name;
}

function stats() {
  return { families: Object.keys(FAMILIES).length, styles: Object.keys(STYLES).length, list: STYLE_LIST.map(s => s.name).join('/') };
}

module.exports = {
  FAMILIES, ROLE_FAMILY, STYLES, STYLE_LIST,
  familyOf, familyForRole, styleOf, hasStyle, styleName, stats
};