/* ─────────────────────────────────────────────────────────────
 * h5/assets/text_tools.js —— 纯本地文本处理工具集
 * ─────────────────────────────────────────────────────────────
 * 与小程序 utils/text_tools.js 同源同规则（2026-09-30 移植）：改一处必须两处同改。
 * 零网络调用、零大模型、零随机性 —— 防折叠 / 自动分段 / 关键词加 emoji / 字数统计
 * 全部是确定性规则运算，不构成任何生成式 AI / 深度合成。
 * emoji 映射是人工维护的规则字典，不是 AI 推断。
 * 双端可加载：浏览器挂 window.H5_TOOLS，Node（测试用）走 module.exports。
 * ───────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // 关键词 → emoji 映射表（人工维护的规则字典）。逐句先到先得，每句最多补 1 个。
  var EMOJI_MAP = [
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
    var t = String(text || '');
    if (!t) return [];
    var lines = t.split(/\n+/);
    var out = [];
    lines.forEach(function (seg) {
      var parts = seg.match(/[^。！？\.!?\n]*[。！？\.!?]?/g) || [];
      parts.forEach(function (p) { if (p.trim().length) out.push(p.trim()); });
    });
    return out;
  }

  // 把一个长行按词/字边界折成 ≤ maxLen 字的短行（防折叠的二次折行）。
  function wrapLine(line, maxLen) {
    var MAX = maxLen || 20;
    var hasSpace = /\s/.test(line);
    var chunks;
    if (hasSpace) {
      chunks = line.split(/\s+/).filter(Boolean);
    } else {
      chunks = [];
      var cur = '';
      for (var i = 0; i < line.length; i++) {
        cur += line.charAt(i);
        if (cur.length >= MAX) { chunks.push(cur); cur = ''; }
      }
      if (cur) chunks.push(cur);
    }
    var rows = [];
    var row = '';
    chunks.forEach(function (c) {
      if ((row + (row ? ' ' : '') + c).length <= MAX || !row) {
        row = row ? row + (hasSpace ? ' ' : '') + c : c;
      } else {
        rows.push(row); row = c;
      }
    });
    if (row) rows.push(row);
    return rows;
  }

  // ① 自动分段：整段文本按标点拆成「一句一行」，纯标点行丢弃。
  function autoSplit(text) {
    var sents = splitSentences(text);
    var out = [];
    sents.forEach(function (s) {
      if (/^[\s，。、,.\s]*$/.test(s)) return;
      out.push(s);
    });
    return out.join('\n');
  }

  // ② 防折叠：先 autoSplit，再把超过 maxLine 字的行二次折行（maxLine 默认 20）。
  function antiFold(text, maxLine) {
    var MAX = maxLine || 20;
    var split = autoSplit(text);
    if (!split) return '';
    var rows = split.split('\n');
    var out = [];
    rows.forEach(function (r) {
      if (r.length <= MAX) { out.push(r); return; }
      wrapLine(r, MAX).forEach(function (w) { out.push(w); });
    });
    return out.join('\n');
  }

  // ③ 关键词加 emoji：逐句在句尾补一个 emoji（先到先得，句尾已有 emoji 则不堆叠）。
  function insertEmoji(text) {
    var sents = splitSentences(text);
    if (!sents.length) return String(text || '');
    var EMOJI_RE = (typeof /\p{Extended_Pictographic}/u.test === 'function') ? /\p{Extended_Pictographic}/u : null;
    return sents.map(function (s) {
      var hit = '';
      for (var i = 0; i < EMOJI_MAP.length; i++) {
        var item = EMOJI_MAP[i];
        for (var j = 0; j < item.kw.length; j++) {
          if (s.indexOf(item.kw[j]) >= 0) { hit = item.e; break; }
        }
        if (hit) break;
      }
      var tail = s.slice(-2);
      if (hit && !(EMOJI_RE ? EMOJI_RE.test(tail) : /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(tail))) return s + hit;
      return s;
    }).join('\n');
  }

  // ④ 字数 / 行数 / emoji 统计（不含空白）。
  function countStats(text) {
    var t = String(text || '');
    var chars = t.replace(/\s/g, '').length;
    var lines = t.split('\n').filter(function (l) { return l.trim().length > 0; }).length;
    var emojiRE = /\p{Extended_Pictographic}/gu;
    var emojiCount = (t.match(emojiRE) || []).length;
    return { chars: chars, lines: lines, emojiCount: emojiCount };
  }

  var api = {
    EMOJI_MAP: EMOJI_MAP,
    splitSentences: splitSentences,
    wrapLine: wrapLine,
    autoSplit: autoSplit,
    antiFold: antiFold,
    insertEmoji: insertEmoji,
    countStats: countStats
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.H5_TOOLS = api;
})(typeof window !== 'undefined' ? window : globalThis);
