// utils/templates.js
// ─────────────────────────────────────────────────────────────────────────
// 人工撰写的结构模板库（静态资产）。按 gen 页的 5 个内容类型分组，
// 每个类型 3 套结构，用户填字段后做「占位符替换」即得到可直接发的文案。
//
// ⚠️ 这不是 AI 生成：模板是作者提前写好的成品骨架，运行时只做字符串替换，
//   没有任何大模型 / 深度合成。个人主体小程序可安全使用。
//
// 占位符：{{key}}，key 对应 gen 页 FIELDS 中各类型的字段 key。
// 渲染后会清理「因字段留空而变空的整行」，避免成品出现空白句。
// ─────────────────────────────────────────────────────────────────────────

const TEMPLATES = {
  value: [
    '我是一个专注{{identity}}的人。\n最近不少{{audience}}来问我怎么起步，我的答案其实很朴素。\n关于{{scene}}，我越来越确定一件事——{{point}}。\n想明白这点，比做一百件"看起来对"的事更重要。',
    '做了这么久{{identity}}，常被问：到底怎么看{{scene}}？\n我的体会是：{{point}}。\n如果你也是{{audience}}，希望这句话能帮你少走点弯路。',
    '今天认真说一个观点：{{point}}。\n这来自我做{{identity}}时踩过的坑，也来自我眼里的{{audience}}。\n就拿{{scene}}来说——真正拉开差距的，往往不是努力，而是想法的精度。'
  ],
  persona: [
    '最近我做了一件事：{{choice}}。\n身边有人不理解，毕竟代价是{{cost}}。\n但{{reason}}，所以我不后悔。\n如果你也在犹豫，我想说：有些选择，做了才看见意义。',
    '我是{{identity}}。今年最大的决定是{{choice}}。\n很多人问我后不后悔，毕竟{{cost}}。\n可我知道{{reason}}——有些路，不走永远不知道值不值。',
    '想聊聊{{cost}}这件事。\n我做了{{choice}}，原因很简单：{{reason}}。\n后来明白，真正的代价从来不是失去，而是没敢选。'
  ],
  deal: [
    '最近{{signal}}，身边不少人来问要不要趁这波做点什么。\n说个真事：{{evidence}}。\n如果你也在看，我的建议是先动起来——回复"想了解"我发你具体方案。',
    '我是{{identity}}，做{{product}}有一阵子了。\n为什么现在说？因为{{signal}}。\n看得见的改变：{{evidence}}。\n想要这套打法，直接私我，我陪你跑一遍。',
    '一个信号：{{signal}}。\n一句实在话：{{evidence}}。\n所以我把{{product}}重新理了一遍，想帮真正需要的人。\n想要的，评论区扣"1"，我挨个回。'
  ],
  life: [
    '{{moment}}。\n那一刻{{feeling}}。\n好像生活不必一直赶路，{{meaning}}。',
    '今天{{moment}}。\n风吹在脸上，{{feeling}}。\n原来{{meaning}}。',
    '记录一下：{{moment}}。\n心里忽然软了一下——{{feeling}}。\n往后想把日子过成这样：{{meaning}}。'
  ],
  story: [
    '{{timePlace}}，有个人总在路口等我，是{{person}}。\n后来{{turn}}。\n直到很多年后{{lookback}}。',
    '说件旧事。{{timePlace}}，{{person}}。\n变故发生在那天：{{turn}}。\n如今想起，{{lookback}}。',
    '有些画面这辈子忘不掉：{{timePlace}}，{{person}}。\n那天{{turn}}。\n后来我才懂，{{lookback}}。'
  ]
};

// 占位符替换：把 {{key}} 换成 form[key]，缺失则置空。
function fillOne(tpl, form) {
  const f = form || {};
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (f[key] != null ? String(f[key]) : ''));
}

// 渲染某个类型下的全部模板；清理「因为字段留空而变空的整行」。
function render(kind, form) {
  const list = TEMPLATES[kind] || [];
  return list.map(tpl => {
    const filled = fillOne(tpl, form);
    // 删除只含标点/空白或顶部只剩"我是。"这类空壳行
    const lines = filled.split('\n').filter(line => {
      const s = line.trim();
      if (!s) return false;
      // 去掉纯标点行，以及形如「我是。」「我是」的空壳
      if (/^[^一-龥A-Za-z0-9]*$/.test(s)) return false;
      if (/^我是[。.]*$/.test(s)) return false;
      return true;
    });
    return lines.join('\n').trim();
  });
}

module.exports = { TEMPLATES, fillOne, render };
