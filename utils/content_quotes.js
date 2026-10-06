// utils/content_quotes.js
// ─────────────────────────────────────────────────────────────────────────
// 金句 / 台词 / 书摘 · 种子静态库（2026-10-06 新增）
//
// 用途：金句收藏馆（quotes）和台词书摘卡（line）首次打开是空的，
//   新用户没东西可看 → 流失。这批种子文案让 App 一进来就有内容可读、可一键成卡。
//
// 设计约束（重要）：
//   ① **不写具体影视/书籍出处**。个人主体小程序若标注真实作品名+台词，
//      存在著作权/侵权投诉风险（这是「零 AI 纯本地」工具的合规红线之一）。
//      所以全部为**原创/公有领域泛化文案**，只标 category，不标 source。
//   ② 幂等：seed 用固定 id（q_seed_xxx），addQuote 按 text 去重，
//      重复调用不会产生重复条目（见 quotes_store.addQuote 的 exist 分支）。
//   ③ 可运营：运营想加内容，只往 SEED_QUOTES 里追加即可，无需改页面代码。
//
// 每条字段：{ id, text, category, tags }
// ─────────────────────────────────────────────────────────────────────────
'use strict';

// category: 'life' 人生感悟 | 'love' 情感 | 'work' 职场 | 'time' 时间 | 'growth' 成长 | 'calm' 心境
const SEED_QUOTES = [
  // ── 人生感悟 ──
  { id: 'q_seed_life_01', text: '生活不会因为你想得太多，就给你答案；它只会在你动起来之后，才慢慢显形。', category: 'life', tags: ['生活', '行动'] },
  { id: 'q_seed_life_02', text: '大多数事情并不难，难的是在没把握的时候仍然愿意开始。', category: 'life', tags: ['开始', '勇气'] },
  { id: 'q_seed_life_03', text: '你不需要成为谁才值得被喜欢，你先是你自己就够了。', category: 'life', tags: ['自我', '接纳'] },
  { id: 'q_seed_life_04', text: '所谓成熟，是开始能接受事情不像预期那样发生。', category: 'life', tags: ['成熟', '接纳'] },
  { id: 'q_seed_life_05', text: '人生就像天气，不可能每天都是晴天，但雨后总会有光。', category: 'life', tags: ['生活', '希望'] },
  { id: 'q_seed_life_06', text: '别把人生的每一个低潮都当成结论，它只是过程里的一个逗号。', category: 'life', tags: ['低谷', '希望'] },
  { id: 'q_seed_life_07', text: '你今天的选择，构成了你明天的处境。', category: 'life', tags: ['选择'] },
  { id: 'q_seed_life_08', text: '人生的意义不在于长度，而在于你认真活过的那些片段。', category: 'life', tags: ['意义'] },

  // ── 情感 ──
  { id: 'q_seed_love_01', text: '喜欢一个人，不必卑微到尘埃里，你本来就值得被好好对待。', category: 'love', tags: ['爱情', '自爱'] },
  { id: 'q_seed_love_02', text: '所有的相遇都不是意外，认真的人终会遇见认真的人。', category: 'love', tags: ['爱情', '缘分'] },
  { id: 'q_seed_love_03', text: '爱不是控制，是彼此都成为更好的自己。', category: 'love', tags: ['爱情', '成长'] },
  { id: 'q_seed_love_04', text: '一个人也可以过得很好，那是另一种自由。', category: 'love', tags: ['独处', '自由'] },
  { id: 'q_seed_love_05', text: '想念一个人时，不必压抑，让情绪流过去就好。', category: 'love', tags: ['思念'] },
  { id: 'q_seed_love_06', text: '真心换真心，若换不到，也请记得爱自己。', category: 'love', tags: ['爱情', '自爱'] },
  { id: 'q_seed_love_07', text: '好的关系，是两个人一起变好，而不是一个人不断委屈。', category: 'love', tags: ['关系'] },
  { id: 'q_seed_love_08', text: '遗憾也是爱情的形状，它让你更懂得珍惜。', category: 'love', tags: ['遗憾'] },

  // ── 职场 ──
  { id: 'q_seed_work_01', text: '工作做不完是因为你没排优先级，而不是因为你不够努力。', category: 'work', tags: ['效率', '职场'] },
  { id: 'q_seed_work_02', text: '职场最大的内耗，是把所有人的期待都当成自己的责任。', category: 'work', tags: ['职场', '内耗'] },
  { id: 'q_seed_work_03', text: '你的价值不由领导的脸色决定，由你解决过的问题决定。', category: 'work', tags: ['职场', '自我价值'] },
  { id: 'q_seed_work_04', text: '努力要有方向，否则只是在感动自己。', category: 'work', tags: ['努力', '方向'] },
  { id: 'q_seed_work_05', text: '学会拒绝，是职场必修课，不是人际关系的失败。', category: 'work', tags: ['职场', '边界'] },
  { id: 'q_seed_work_06', text: '不要用战术上的勤奋，掩盖战略上的懒惰。', category: 'work', tags: ['职场', '思考'] },
  { id: 'q_seed_work_07', text: '把时间花在对的事情上，比把事情做快更重要。', category: 'work', tags: ['效率'] },
  { id: 'q_seed_work_08', text: '被否定不可怕，可怕的是因此否定自己。', category: 'work', tags: ['职场', '自信'] },

  // ── 时间 ──
  { id: 'q_seed_time_01', text: '时间不会辜负努力，也不会奖励空想。', category: 'time', tags: ['时间', '努力'] },
  { id: 'q_seed_time_02', text: '你的一天不是被浪费的，就是被用来靠近想成为的人。', category: 'time', tags: ['时间', '目标'] },
  { id: 'q_seed_time_03', text: '把今天过好，是对未来最实在的负责。', category: 'time', tags: ['时间', '当下'] },
  { id: 'q_seed_time_04', text: '时间最公平，它给每个人的都是二十四小时；差别在于用法。', category: 'time', tags: ['时间', '自律'] },
  { id: 'q_seed_time_05', text: '与其怀念过去，不如把现在这件事做完。', category: 'time', tags: ['时间', '当下'] },
  { id: 'q_seed_time_06', text: '所谓自由，就是能选择自己的时间花在哪里。', category: 'time', tags: ['时间', '自由'] },
  { id: 'q_seed_time_07', text: '你三年后的样子，取决于今天这几个小时。', category: 'time', tags: ['时间', '未来'] },
  { id: 'q_seed_time_08', text: '慢一点没关系，只要方向对，时间都会站在你这边。', category: 'time', tags: ['时间', '耐心'] },

  // ── 成长 ──
  { id: 'q_seed_growth_01', text: '成为更好的自己，不是变成别人，是把自己的优点都活出来。', category: 'growth', tags: ['成长', '自我'] },
  { id: 'q_seed_growth_02', text: '你羡慕的生活背后，都有你没吃过的苦。', category: 'growth', tags: ['成长', '奋斗'] },
  { id: 'q_seed_growth_03', text: '每一步难走的路，都在让你有能力走更远的路。', category: 'growth', tags: ['成长', '坚持'] },
  { id: 'q_seed_growth_04', text: '不要害怕重来，你比上次更有经验。', category: 'growth', tags: ['成长', '勇气'] },
  { id: 'q_seed_growth_05', text: '真正的自信，来自你说到做到的那几次。', category: 'growth', tags: ['成长', '自信'] },
  { id: 'q_seed_growth_06', text: '你的舒适区里，住着你想成为的那个人。', category: 'growth', tags: ['成长', '突破'] },
  { id: 'q_seed_growth_07', text: '成长不是变得完美，是变得完整——接受自己不完美。', category: 'growth', tags: ['成长', '接纳'] },
  { id: 'q_seed_growth_08', text: '每天进步一点点，一年后就是另一个你。', category: 'growth', tags: ['成长', '积累'] },

  // ── 心境 ──
  { id: 'q_seed_calm_01', text: '心静了，外界再怎么吵，都吵不到你。', category: 'calm', tags: ['心境', '平静'] },
  { id: 'q_seed_calm_02', text: '不生气，不是因为软弱，而是不想把能量浪费在不值得的人身上。', category: 'calm', tags: ['心境', '情绪'] },
  { id: 'q_seed_calm_03', text: '允许一切发生，是一生都修不完的功课。', category: 'calm', tags: ['心境', '接纳'] },
  { id: 'q_seed_calm_04', text: '很多烦恼，是想得太远太少做。', category: 'calm', tags: ['心境', '行动'] },
  { id: 'q_seed_calm_05', text: '你今天感觉到的平静，是值得珍惜的。', category: 'calm', tags: ['心境', '当下'] },
  { id: 'q_seed_calm_06', text: '不比较，你才活得轻松；不评判，你才活得真实。', category: 'calm', tags: ['心境', '自在'] },
  { id: 'q_seed_calm_07', text: '所有的内耗，都可以通过行动来终止。', category: 'calm', tags: ['心境', '行动'] },
  { id: 'q_seed_calm_08', text: '慢慢来，稳一点，才是长期主义者的智慧。', category: 'calm', tags: ['心境', '耐心'] }
];

// category → 中文名（UI 展示用）
const CATEGORY_NAMES = {
  life: '人生',
  love: '情感',
  work: '职场',
  time: '时间',
  growth: '成长',
  calm: '心境'
};

module.exports = { SEED_QUOTES, CATEGORY_NAMES };
