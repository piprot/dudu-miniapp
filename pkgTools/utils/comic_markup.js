// utils/comic_markup.js
// ─────────────────────────────────────────────────────────────────────────
// 「画面感分镜编辑器」脚本解析器（纯 JS，零网络 / 零 wx 依赖，Node 可测）。
//
// 设计目标：用户用极简的「文字脚本」描述分镜，解析成结构化数据，
//           再由 comic_render.js 在本地 canvas 上确定性渲染成多格分镜图。
//           整个过程不调用任何大模型 / 不生成内容，不构成深度合成。
// ─────────────────────────────────────────────────────────────────────────

// 情绪 → 色调映射（仅影响边框/底色，给用户一个「氛围感」，非 AI）。
const MOOD_MAP = {
  '忧伤': { tint: '#e8eef7', border: '#7c93b8', name: '忧伤' },
  '伤感': { tint: '#e8eef7', border: '#7c93b8', name: '忧伤' },
  '欢乐': { tint: '#fff6e0', border: '#e0a93b', name: '欢乐' },
  '开心': { tint: '#fff6e0', border: '#e0a93b', name: '欢乐' },
  '温馨': { tint: '#fdeef0', border: '#d98aa0', name: '温馨' },
  '温暖': { tint: '#fdeef0', border: '#d98aa0', name: '温馨' },
  '紧张': { tint: '#f7e8e8', border: '#c0504d', name: '紧张' },
  '悬疑': { tint: '#f7e8e8', border: '#c0504d', name: '紧张' },
  '默认': { tint: '#f3f1ec', border: '#b9b2a6', name: '' }
};

const NARRATION_KEYS = ['旁白', 'narration', 'caption', '说明', '独白', '内心'];
const MOOD_KEYS = ['情绪', 'mood', '气氛', '氛围'];
const SCENE_KEYS = ['场景', 'scene', '背景', '地点'];

// 把用户输入的情绪词归一到已知情绪（支持「有点忧伤」这类包含式）。
function resolveMood(text) {
  const t = String(text || '').trim();
  if (!t) return MOOD_MAP['默认'];
  if (MOOD_MAP[t]) return MOOD_MAP[t];
  const keys = Object.keys(MOOD_MAP);
  for (let i = 0; i < keys.length; i++) {
    if (t.indexOf(keys[i]) >= 0) return MOOD_MAP[keys[i]];
  }
  return MOOD_MAP['默认'];
}

function isKeyword(left, keys) {
  const l = String(left || '').trim();
  if (!l) return false;
  for (let i = 0; i < keys.length; i++) {
    if (l === keys[i] || l.toLowerCase() === keys[i].toLowerCase()) return true;
  }
  return false;
}

// 单行分类：旁白 / 情绪 / 场景 / 对白 / 普通叙述。
function classify(line) {
  const t = String(line || '').trim();
  if (!t) return null;
  const ci = t.search(/[：:]/);
  if (ci < 0) {
    // 无冒号：作为普通叙述（旁白风格）。
    return { type: 'narration', who: '', text: t };
  }
  const left = t.slice(0, ci);
  const right = t.slice(ci + 1).trim();
  if (isKeyword(left, NARRATION_KEYS)) return { type: 'narration', who: '', text: right };
  if (isKeyword(left, MOOD_KEYS)) return { type: 'mood', who: '', text: right };
  if (isKeyword(left, SCENE_KEYS)) return { type: 'scene', who: '', text: right };
  // 其余带冒号 → 视为「角色：对白」。
  return { type: 'speech', who: left.trim(), text: right };
}

// 主解析：text → { title, panels:[ {label,scene,mood,lines:[{type,who,text}]} ] }
function parseScript(text) {
  const lines = String(text || '').split(/\r?\n/);
  let title = '';
  let titleSet = false;
  const panels = [];
  let cur = null;

  function newPanel(label) {
    cur = { label: String(label || '').trim(), scene: '', mood: MOOD_MAP['默认'], lines: [] };
    panels.push(cur);
  }

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue; // 空行忽略

    // 标题：整篇第一个「# 文本」作为标题。
    if (!titleSet && /^#\s+/.test(t)) {
      title = t.replace(/^#\s+/, '').trim();
      titleSet = true;
      continue;
    }

    // 分镜分隔：①【标签】  ② 三个及以上连字符 ---
    if (/^\s*【[^】]*】\s*$/.test(t)) {
      newPanel(t.replace(/^\s*【|】\s*$/g, ''));
      continue;
    }
    if (/^-{3,}\s*$/.test(t)) {
      newPanel('');
      continue;
    }

    // 内容行：若还没开分镜，自动开第一个。
    if (!cur) newPanel('');

    const c = classify(t);
    if (!c) continue;
    if (c.type === 'mood') {
      cur.mood = resolveMood(c.text);
    } else if (c.type === 'scene') {
      cur.scene = c.text;
    } else {
      cur.lines.push({ type: c.type, who: c.who || '', text: c.text });
    }
  }

  return { title, panels };
}

module.exports = { MOOD_MAP, resolveMood, classify, parseScript };
