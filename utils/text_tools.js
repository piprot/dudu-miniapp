// utils/text_tools.js
// ─────────────────────────────────────────────────────────────────────────
// 纯前端文本处理工具集 —— 零网络调用、零大模型、零随机性。
// 用于「文案排版优化器」：防折叠 / 自动分段 / 关键词加 emoji / 字数统计。
// 这些功能都是确定性的规则运算，不构成任何生成式 AI / 深度合成，
// 个人主体小程序可安全使用，不影响审核。
// ─────────────────────────────────────────────────────────────────────────

// 关键词 → emoji 映射表（人工维护的规则字典，不是 AI 推断）。
// 命中策略：对每一「句」（以句末标点或换行切分），在句尾补一个 emoji；
// 同一句只补第一个命中项，避免刷屏。匹配按数组顺序，先到先得。
const EMOJI_MAP = [
  { kw: ['成长', '学习', '进步', '提升'], e: '🌱' },
  { kw: ['努力', '坚持', '拼搏', '奋斗', '自律'], e: '💪' },
  { kw: ['开心', '快乐', '幸福', '喜悦', '高兴'], e: '😊' },
  { kw: ['爱', '喜欢', '心动', '心动了'], e: '❤️' },
  { kw: ['赚钱', '收入', '成交', '订单', '变现', '搞钱'], e: '💰' },
  { kw: ['健康', '运动', '锻炼', '健身'], e: '🏃' },
  { kw: ['旅行', '出发', '远方', '出发吧', '路上'], e: '✈️' },
  { kw: ['家', '家人', '妈妈', '爸爸', '父亲', '母亲', '外婆', '爷爷', '奶奶'], e: '🏠' },
  { kw: ['安静', '慢', '放松', '独处', '发呆'], e: '🌿' },
  { kw: ['目标', '梦想', '希望', '未来', '理想'], e: '✨' },
  { kw: ['谢谢', '感谢', '感恩', '多谢'], e: '🙏' },
  { kw: ['注意', '提醒', '重要', '当心'], e: '⚠️' },
  { kw: ['美食', '好吃', '晚餐', '吃饭', '夜宵', '咖啡'], e: '🍜' },
  { kw: ['读书', '阅读', '看书', '书'], e: '📚' },
  { kw: ['工作', '职场', '项目', '同事', '老板'], e: '💼' },
  { kw: ['睡觉', '晚安', '熬夜', '困'], e: '🌙' },
  { kw: ['雨', '雪', '风', '天气', '晴天'], e: '🌤️' },
  { kw: ['猫', '狗', '宠物', '毛孩子'], e: '🐾' }
];

// 句子切分：以中文/英文句末标点或换行断句，保留标点。
function splitSentences(text) {
  const t = String(text || '');
  if (!t) return [];
  // 先按换行拆，再对每段内部按句末标点拆
  const lines = t.split(/\n+/);
  const out = [];
  lines.forEach(seg => {
    // 用正则把「句子+句末标点」切成块（标点可能是 。！？. ! ? 及其后可选引号）
    const parts = seg.match(/[^。！？\.!?\n]*[。！？\.!?]?/g) || [];
    parts.forEach(p => { if (p.trim().length) out.push(p.trim()); });
  });
  return out;
}

// 把一个长句按词边界折成 ≤ maxLen 字的短行（用于防折叠的二次折行）。
// 中文按字、英文/数字按空格或连续段切，尽量不切断词语。
function wrapLine(line, maxLen) {
  const MAX = maxLen || 20;
  // 若行内本身含空格（中英文混排），优先按空格切
  const hasSpace = /\s/.test(line);
  let chunks;
  if (hasSpace) {
    chunks = line.split(/\s+/).filter(Boolean);
  } else {
    // 中文：逐字累计，超长即断（保留标点跟随）
    chunks = [];
    let cur = '';
    for (const ch of line) {
      cur += ch;
      if (cur.length >= MAX) { chunks.push(cur); cur = ''; }
    }
    if (cur) chunks.push(cur);
  }
  const rows = [];
  let cur = '';
  chunks.forEach(c => {
    if ((cur + (cur ? ' ' : '') + c).length <= MAX || !cur) {
      cur = cur ? cur + (hasSpace ? ' ' : '') + c : c;
    } else {
      rows.push(cur); cur = c;
    }
  });
  if (cur) rows.push(cur);
  return rows;
}

// ① 自动分段：把整段文本按标点拆成「一句一行」，连续标点/空行清理。
function autoSplit(text) {
  const sents = splitSentences(text);
  const out = [];
  sents.forEach(s => {
    if (/^[\s，。、,.\s]*$/.test(s)) return; // 纯标点行丢弃
    out.push(s);
  });
  return out.join('\n');
}

// ② 防折叠：先 autoSplit，再把超过 maxLine 字的行二次折行，
//    使每条「行」都较短，关键内容更容易落在前几行（降低整段被折叠的概率）。
//    maxLine 默认 20（中文经验值，可按需调），不引入任何随机。
function antiFold(text, maxLine) {
  const MAX = maxLine || 20;
  const split = autoSplit(text);
  if (!split) return '';
  const rows = split.split('\n');
  const out = [];
  rows.forEach(r => {
    if (r.length <= MAX) { out.push(r); return; }
    // 已经是短行拼起来的，按句末保留换行；超长行再折
    wrapLine(r, MAX).forEach(w => out.push(w));
  });
  return out.join('\n');
}

// ③ 关键词加 emoji：逐句在句尾补一个 emoji（先到先得，每句最多 1 个）。
function insertEmoji(text) {
  const sents = splitSentences(text);
  if (!sents.length) return String(text || '');
  return sents.map(s => {
    let hit = '';
    for (const item of EMOJI_MAP) {
      if (item.kw.some(k => s.indexOf(k) >= 0)) { hit = item.e; break; }
    }
    // 句尾若已有 emoji，避免重复堆叠
    if (hit && !tailIsEmoji(s)) return s + hit;
    return s;
  }).join('\n');
}

// ⚠️ 不用 \p{Extended_Pictographic}：部分微信基础库 / 老版本 JSCore 不支持该 Unicode
// 属性转义，解析正则时直接抛 SyntaxError —— 而 countStats / insertEmoji 在 applyOpt 里被调用，
// 一旦抛错整个 applyOpt 在 setData 前崩溃，表现就是「排版优化三个按钮点了没反应」。
// 改用码点区间判断 emoji，全平台稳妥。
function isEmojiCodepoint(c) {
  return (
    (c >= 0x1F300 && c <= 0x1FAFF) || // 符号与象形（🌱💪😊✈️ 等）
    (c >= 0x2600 && c <= 0x27BF) ||   // 杂项符号与印刷符号（☀★⚠🏠 等）
    (c >= 0x1F000 && c <= 0x1F02F) || // 麻将 / 扑克等
    (c >= 0x2300 && c <= 0x23FF) ||   // 技术符号
    (c >= 0x2B00 && c <= 0x2BFF) ||   // 杂项符号和箭头
    (c >= 0xFE00 && c <= 0xFE0F) ||   // 变体选择符
    (c >= 0x1F1E6 && c <= 0x1F1FF)    // 区域指示符（国旗）
  );
}

// 统计文本里 emoji 个数（按码点，正确计入代理对）。
function countEmoji(text) {
  let n = 0;
  for (const ch of String(text || '')) {
    if (isEmojiCodepoint(ch.codePointAt(0))) n++;
  }
  return n;
}

// 句尾是否已经是 emoji（避免重复堆叠）。
function tailIsEmoji(text) {
  const chars = Array.from(String(text || ''));
  if (!chars.length) return false;
  return isEmojiCodepoint(chars[chars.length - 1].codePointAt(0));
}

// ④ 字数 / 行数统计（不含空白；emoji 计为 1 个符号）。
function countStats(text) {
  const t = String(text || '');
  const chars = t.replace(/\s/g, '').length;
  const lines = t.split('\n').filter(l => l.trim().length > 0).length;
  const emojiCount = countEmoji(t);
  return { chars, lines, emojiCount };
}

module.exports = {
  EMOJI_MAP,
  splitSentences,
  wrapLine,
  autoSplit,
  antiFold,
  insertEmoji,
  countStats
};
