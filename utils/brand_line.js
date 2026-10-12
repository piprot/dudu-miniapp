// utils/brand_line.js —— 成图版式的「底部品牌两行」文案源（2026-10-12）
// ─────────────────────────────────────────────────────────────────────────────
// 背景：band / signature / minimal / masthead / headline 这 5 种风格是照着
// 5 张社群成图做的，参考图的底部都有一条**固定的品牌两行**：
//     行1  兴趣标签链（签名版式）／组织名 ❄ 栏目 ｜ slogan（刊头版式）
//     行2  年份 ｜ 品牌原文 @署名                      （小一点、淡一点）
// 这两行不属于「这一张卡的内容」，属于「发图人的身份」，所以单独抽一个模块：
//   · 默认值集中一处，改文案不用翻 5 个版式分支；
//   · 将来做「品牌行设置」（出图设置里让用户填社群名/标签/口号）时，
//     只需要把这里改成读本地配置，5 个版式的调用点一行都不用动。
//
// ⚠️ 现在先用默认值自动填（用户 2026-10-12 拍板：零配置先能用）。
//    页面/版式可用 data.brandTags / data.brandSlogan / data.brandName 覆盖单张图。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const BRAND = 'dudu 画面感';
const BRAND_EN = 'dudu';
// 标签链：两端装饰线 + ❄ 分隔（照参考图「— 瑜伽 ❄ 读书 ❄ 生活美学 —」的写法）。
// 长度受行宽限制——成图行宽只有 300px（11px 字约 27 个中文字），别再加标签。
const DEFAULT_TAGS = '— 生活记录 ❄ 日常美学 —';
const DEFAULT_SLOGAN = '记录生活的一帧 · 分享眼前的暖';
// 大字版式中间那列竖排小字（参考图 5「早(美/學)餐」）。dudu 品牌是「画面感」，取「畫面」。
const DEFAULT_INSET = '畫面';

/** 年份（四位）。每次出图都取当下，不做缓存——跨年那天不会写错。 */
function year() {
  return String(new Date().getFullYear());
}

/**
 * 逐字插空格 —— 引擎不消费 letterSpacing（render_engine 只把 letterSpacing 存进 block，
 * draw 时不用），所以「超大字距」在成图版式里靠插空格实现：'2026' → '2 0 2 6'。
 */
function spaced(s) {
  return Array.from(String(s == null ? '' : s)).join(' ');
}

/**
 * 签名版式的行1：纯兴趣标签链（组织名与署名留在行2，行1 再放品牌就重复了）。
 * 刊头版式的行1 另有写法（组织名 ❄ 栏目 ｜ slogan），在模板层单独拼。
 */
function tagLine(tags) {
  return (tags == null || tags === '') ? DEFAULT_TAGS : tags;
}

/** 行2：{年份} ｜ {品牌} @{署名}（无署名就不带 @）。 */
function signLine(author, brand) {
  const b = (brand == null || brand === '') ? BRAND : brand;
  return year() + ' ｜ ' + b + (author ? ' @' + String(author) : '');
}

/** 大字版式的底部第一行：{年份} ｜ dudu（逐字空格，超大字距）。 */
function yearLine() {
  return spaced(year()) + '  ｜  ' + spaced(BRAND_EN);
}

/** 极简版式的左下角第一行：{年份} ｜ 画面感（逐字空格）。 */
function watermarkLine() {
  return spaced(year()) + ' ｜ ' + spaced('画面感');
}

module.exports = {
  BRAND, BRAND_EN, DEFAULT_TAGS, DEFAULT_SLOGAN, DEFAULT_INSET,
  year, spaced, tagLine, signLine, yearLine, watermarkLine
};
