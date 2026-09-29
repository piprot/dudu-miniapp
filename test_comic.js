// test_comic.js —— 画面感分镜编辑器：解析器 + 布局单测（Node 直接跑，零依赖）
const { parseScript, resolveMood, classify } = require('./utils/comic_markup');
const { computeLayout } = require('./utils/comic_render');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// 伪 measure：按字符数估算宽度（font 形如 '14px sans-serif'）。
function measure(t, font) {
  const m = /(\d+)px/.exec(font || '14px');
  const fs = m ? parseInt(m[1], 10) : 14;
  return String(t).length * fs * 0.6;
}
function layoutOf(model, cols) {
  return computeLayout(model, { width: 340, cols: cols || 2 }, measure);
}

console.log('— 解析器 —');
const story = `# 江边的告别
【分镜1】
场景：江边傍晚
旁白：那天下班，风很轻
小明：你真的要走了吗
小红：嗯，车票已经买好了
情绪：忧伤

【分镜2】
旁白：很多年后，我还记得那个背影
情绪：温馨`;

const m1 = parseScript(story);
ok('解析出标题', m1.title === '江边的告别');
ok('解析出 2 个分镜', m1.panels.length === 2);
ok('分镜1 场景正确', m1.panels[0].scene === '江边傍晚');
ok('分镜1 情绪归一到 忧伤', m1.panels[0].mood.name === '忧伤');
ok('分镜1 含旁白行', m1.panels[0].lines.some(l => l.type === 'narration' && l.text.indexOf('风很轻') >= 0));
ok('分镜1 含两条对白', m1.panels[0].lines.filter(l => l.type === 'speech').length === 2);
ok('分镜1 对白角色正确', m1.panels[0].lines.find(l => l.who === '小明').text === '你真的要走了吗');
ok('分镜2 情绪归一到 温馨', m1.panels[1].mood.name === '温馨');
ok('分镜2 标签取自【】内文字', m1.panels[1].label === '分镜2');

console.log('— 分隔符 --- —');
const dash = `旁白：开头
---
旁白：结尾`;
const m2 = parseScript(dash);
ok('--- 分隔出 2 个分镜', m2.panels.length === 2);

console.log('— 无显式分镜标记（自动首个）—');
const auto = `旁白：只有一段
小明：一句对白`;
const m3 = parseScript(auto);
ok('无标记时自动生成 1 个分镜', m3.panels.length === 1);
ok('自动分镜含对白', m3.panels[0].lines.some(l => l.type === 'speech' && l.who === '小明'));

console.log('— 空输入 —');
const m4 = parseScript('');
ok('空输入产出 0 分镜', m4.panels.length === 0 && m4.title === '');

console.log('— 情绪归一（包含式）—');
ok('「有点忧伤」→ 忧伤', resolveMood('有点忧伤').name === '忧伤');
ok('未知情绪 → 默认', resolveMood('莫名其妙').name === '');

console.log('— 单行分类 —');
ok('「旁白：x」→ narration', classify('旁白：x').type === 'narration');
ok('「情绪：忧伤」→ mood', classify('情绪：忧伤').type === 'mood');
ok('「场景：教室」→ scene', classify('场景：教室').type === 'scene');
ok('「小明：你好」→ speech', classify('小明：你好').type === 'speech' && classify('小明：你好').who === '小明');
ok('无冒号纯文本 → narration', classify('一段叙述').type === 'narration');

console.log('— 布局计算 —');
const L1 = layoutOf(m1, 2);
ok('双列时 2 个分镜排成 1 行', L1.rows.length === 1 && L1.rows[0].length === 2);
ok('布局总高 > 0', L1.height > 0);
const L2 = layoutOf(m1, 1);
ok('单列时 2 个分镜排成 2 行', L2.rows.length === 2);
const L3 = layoutOf(m4, 2);
ok('空模型也能算出正高度', L3.height > 0);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
