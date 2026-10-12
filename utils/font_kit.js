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
// 而非某一款字形。本库把这套组合抽象成 9 种可直接切换的排版风格
// （2026-10-12 由 4 种扩到 9 种：新增 色带 / 签名 / 极简 / 刊头 / 大字，
//  版式取自 5 张参考图——磨砂色带引言、签名打卡、静默水印、社群栏头栏脚、大字标题封面）。

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

// ── 透明度助手 ──────────────────────────────────────────────────────────
// 风格结构层（胶带条/高亮块/外框）需要主色的半透明版本，但主题 primary 多为
// #rrggbb 十六进制。canvas 只认 rgba()，故此助手把 hex 转 rgba（三部校验：
// 去 # → 3位扩6位 → 非 hex 原样返回，兼容 rgba 已带透明度的情况）。
function alpha(hex, a) {
  if (typeof hex !== 'string') return hex;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const al = Math.max(0, Math.min(1, a));
  return `rgba(${r},${g},${b},${al})`;
}

// ── 排版风格 ──────────────────────────────────────────────────────────
// 9 种风格，每种是一组完整的排版参数（字体 × 字号 × 字距 × 对齐 × 装饰 × 构图骨架）。
// 卡片按风格切换即可整体换气质，无需引入字体文件。
//
// 两个字段容易被忽略，但它们是「风格不只是换字体」的关键：
//   layout —— 构图骨架 id，由 utils/templates/index.js 消费（顶部锚点 / 标题处理 /
//             装饰位置 / 正文容器 / 落款对齐 / 外框），决定卡面的结构而不只是字形。
//   desc   —— 出图设置里显示给用户的一句话说明（组件 card-config 渲染）。
//
// ⚠️ 新增风格时必守的硬约束（test/test_font_kit.js 有断言，别绕）：
//   ① 必填字段齐全（id/name/titleFont/titleSize/titleWeight/titleAlign/bodyFont/
//      bodySize/bodyLineHeight/bodyAlign/decoSize/radius）；
//   ② titleFont/bodyFont 必须是 FAMILIES 里已有的族名；
//   ③ titleSize > bodySize，bodyLineHeight > bodySize；
//   ④ 风格签名 [titleFont|titleSize|titleAlign|bodySize|deco] 全局唯一——
//      光换颜色不算新风格，字号/对齐/装饰至少有一处真不同。
const STYLES = {
  // 文艺书卷：衬线标题 + 居中 + 主色引号（参照原日签模板的气质）
  literary: {
    id: 'literary',
    name: '文艺',
    desc: '衬线标题 + 居中金句，左上大引号压角，书卷气最重（默认）',
    layout: 'editorial',   // 编辑式：左对齐衬线标题 + 标题下细发丝线 + 左栏大引号 drop-cap
    titleFont: 'serif',
    // 2026-10-07：标题缩到 19（原 21）。节气卡标题是「10月7日·星期二」这类日期，
    // 原来 21 比正文 17 大出一截，喧宾夺主，压到 19 只比正文大 2px，层次在但不抢戏。
    titleSize: 19,
    titleWeight: 'bold',
    titleSpacing: 1.5,
    titleAlign: 'center',
    bodyFont: 'sans',
    bodySize: 17,
    bodyLineHeight: 31,
    bodyAlign: 'center',
    bodySpacing: 0.5,
    // 成对引号：上「」+ 下「」，单引号会显得头重脚轻（2026-10-07 用户反馈只有上引号）
    deco: '❝',           // 引导符（装饰在正文上方，见 buildCardModel 的 decoTop）
    decoClose: '❞',      // 收尾符（画在正文下方）
    decoColor: 'primary',
    decoSize: 22,
    showDeco: true,
    radius: 20
  },
  // 现代简洁：黑体标题 + 左对齐 + 竖线（公告卡气质）
  modern: {
    id: 'modern',
    name: '现代',
    desc: '黑体左对齐 + 几何外框，元信息走等宽，干净克制的公告感',
    layout: 'swiss',       // 瑞士网格：左对齐 + 整卡几何外框 + 标题基线粗分隔 + 等宽元信息
    titleFont: 'sans',
    titleSize: 17,       // 2026-10-07：20→17，与正文 15 差 2px
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
    showBar: true,        // 标题左侧主色竖条（2026-10-07 起所有卡片都不再画，见 buildCardModel）
    radius: 12
  },
  // 温暖手写：楷体 + 居中 + 圆点
  warm: {
    id: 'warm',
    name: '温暖',
    desc: '楷体标题 + 奶油便签托住金句，四周留白均匀，最柔和',
    layout: 'memo',        // 奶油便签（v2 重做）：整卡做减法（无胶带/无外框），标题下居中小短线，
                           // 一块浅底大圆角便签托住金句、四周留白均匀——参照小红书高赞「温柔便签卡」版式
    titleFont: 'kai',
    titleSize: 19,       // 2026-10-07：22→19，与正文 17 差 2px
    titleWeight: 'bold',
    titleSpacing: 2,
    titleAlign: 'center',
    bodyFont: 'sans',
    bodySize: 17,
    bodyLineHeight: 32,
    bodyAlign: 'center',
    bodySpacing: 1,
    deco: '❀',
    decoClose: '',       // ❀ 本身是完整花纹，无需收尾符
    decoColor: 'primary',
    decoSize: 20,
    showDeco: true,
    radius: 24
  },
  // 醒目海报：圆体大字 + 居中（标题党气质，适合分享图）
  poster: {
    id: 'poster',
    name: '海报',
    desc: '整宽主色顶带 + 圆体大字，分享图身份感最强',
    layout: 'poster',      // 醒目海报：整宽主色 header 带（类型名反白居中）+ 大字号居中 + 厚分隔
    titleFont: 'round',
    titleSize: 20,       // 2026-10-07：26→20。原来比正文 16 大 10px，标题压过金句本体；
                        // 仍需大于 literary 的 19（海报风靠大标题立身份，test_font_kit 有断言）。
    titleWeight: 'bold',
    titleSpacing: 3,
    titleAlign: 'center',
    bodyFont: 'sans',
    bodySize: 16,
    bodyLineHeight: 30,
    bodyAlign: 'center',
    bodySpacing: 0.5,
    deco: '◆',
    decoClose: '',       // ◆ 本身是完整菱形，无需收尾符
    decoColor: 'primary',
    decoSize: 14,
    showDeco: true,
    radius: 16
  },

  // ── 2026-10-12 新增 5 种「成图」风格（照 5 张社群成图做的）────────────────
  // 这一组与上面 4 种**不是同一类东西**：它们是**成图版式**——固定 3:4 竖幅、
  // 文字压在照片上、底部只有两行品牌信息，**不带类型胶囊 / 右上品牌水印 / 外框 / 分隔线**
  // （参考图上都没有）。小程序码保留，缩到 44px 放右下角（回流入口是产品硬需求）。
  // 标记字段 frame: '3:4' 由 utils/templates/index.js 识别并走独立构建器 buildFrameModel。
  //
  // 色带：正文压在一条横向浅色磨砂带里（整宽出血、占画幅约 1/3），带内**深色字**，
  // 出处行右对齐——照「磨砂色带引言卡」。图再花，色带也隔出一块安静的阅读区。
  band: {
    id: 'band',
    name: '色带',
    desc: '3:4 成图 · 文字压在半透明浅色带里（黑字），出处右对齐',
    layout: 'band',
    frame: '3:4',
    titleFont: 'serif',
    titleSize: 18,
    titleWeight: 'bold',
    titleSpacing: 1,
    titleAlign: 'center',
    bodyFont: 'sans',
    bodySize: 17,
    bodyLineHeight: 32,
    bodyAlign: 'center',
    bodySpacing: 0.5,
    deco: '',
    decoClose: '',
    decoColor: 'primary',
    decoSize: 0,
    showDeco: false,
    radius: 16
  },
  // 签名：右上角手写署名 + 底部两行（标签链 / 年份｜品牌 @人名）——照「生活打卡图」。
  // 署名是「我在场」的痕迹，比一个 logo 更有温度。
  signature: {
    id: 'signature',
    name: '签名',
    desc: '3:4 成图 · 右上角手写署名 + 底部标签链与品牌行',
    layout: 'signature',
    frame: '3:4',
    titleFont: 'kai',
    titleSize: 18,
    titleWeight: 'bold',
    titleSpacing: 1.5,
    titleAlign: 'left',
    bodyFont: 'sans',
    bodySize: 16,
    bodyLineHeight: 30,
    bodyAlign: 'center',
    bodySpacing: 0.5,
    deco: '',
    decoClose: '',
    decoColor: 'primary',
    decoSize: 0,
    showDeco: false,
    radius: 18
  },
  // 极简：什么都不加，左下角两行极小水印（年份｜画面感 + slogan）——照「静默氛围图」。
  minimal: {
    id: 'minimal',
    name: '极简',
    desc: '3:4 成图 · 无任何装饰，左下角两行极小水印，画面是主角',
    layout: 'minimal',
    frame: '3:4',
    titleFont: 'sans',
    titleSize: 16,
    titleWeight: 'normal',
    titleSpacing: 0.5,
    titleAlign: 'left',
    bodyFont: 'sans',
    bodySize: 15,
    bodyLineHeight: 27,
    bodyAlign: 'left',
    bodySpacing: 0,
    deco: '',
    decoClose: '',
    decoColor: 'primary',
    decoSize: 0,
    showDeco: false,
    radius: 10
  },
  // 刊头：顶部一行「若隐若现」的栏目字链（贴顶、极小、大字距、低对比）+ 底部两行栏脚
  // ——照「社群打卡物料」。像一本刊物的内页，栏目归属一眼可辨。
  masthead: {
    id: 'masthead',
    name: '刊头',
    desc: '3:4 成图 · 顶部极淡字链刊头 + 底部两行栏脚',
    layout: 'masthead',
    frame: '3:4',
    titleFont: 'serif',
    titleSize: 20,
    titleWeight: 'bold',
    titleSpacing: 2,
    titleAlign: 'center',
    bodyFont: 'sans',
    bodySize: 16,
    bodyLineHeight: 30,
    bodyAlign: 'center',
    bodySpacing: 0.5,
    deco: '',
    decoClose: '',
    decoColor: 'primary',
    decoSize: 0,
    showDeco: false,
    radius: 20
  },
  // 大字：衬线大字压在底部，两字之间嵌一列竖排小字（照「早(美/學)餐」），下方两行小字
  // ——照「大字标题封面」。缩略图里也能一眼读出来。
  headline: {
    id: 'headline',
    name: '大字',
    desc: '3:4 成图 · 底部衬线大字 + 字间竖排嵌字，封面感最强',
    layout: 'headline',
    frame: '3:4',
    titleFont: 'serif',
    titleSize: 24,
    titleWeight: 'bold',
    titleSpacing: 3,
    titleAlign: 'center',
    bodyFont: 'sans',
    bodySize: 17,
    bodyLineHeight: 32,
    bodyAlign: 'center',
    bodySpacing: 1,
    deco: '',
    decoClose: '',
    decoColor: 'primary',
    decoSize: 0,
    showDeco: false,
    radius: 18
  }
};

const STYLE_LIST = Object.keys(STYLES).map(k => ({
  id: k, name: STYLES[k].name, titleFont: STYLES[k].titleFont, desc: STYLES[k].desc || ''
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

/** 风格的一句话说明（出图设置里显示给用户，帮他在 9 个选项里选）。
 *  未知 id 回退文艺的说明，不返回空串——空串会让组件那一行塌成 0 高。 */
function styleDesc(id) {
  return hasStyle(id) ? (STYLES[id].desc || '') : (STYLES.literary.desc || '');
}

function stats() {
  return { families: Object.keys(FAMILIES).length, styles: Object.keys(STYLES).length, list: STYLE_LIST.map(s => s.name).join('/') };
}

module.exports = {
  FAMILIES, ROLE_FAMILY, STYLES, STYLE_LIST,
  familyOf, familyForRole, alpha, styleOf, hasStyle, styleName, styleDesc, stats
};