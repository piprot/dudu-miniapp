/* ─────────────────────────────────────────────────────────────
 * h5/assets/kinds.js —— H5（公众号版）与小程序共用的「类型 / 字段 / 字数策略」
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 本文件是 pages/gen/gen.js 的**同规则副本**，不是"另一个版本"。
 *    改任何一处（KINDS / KIND_STRUCT / FIELDS / BUILD / KIND_LEN_FIXED /
 *    OUT_LEN_TIERS / OUT_LEN_FLOOR）都必须三处同改，缺一处就会出现
 *    「小程序说 100-250 字、网页给 350 字」这类对不上的体感：
 *      · pages/gen/gen.js                      （小程序端展示 + 组装 prompt）
 *      · cloudfunctions/ai_gen/index.js        （服务端权威，真正约束模型）
 *      · h5/assets/kinds.js                    （本文件，H5 端展示 + 组装 prompt）
 *    test/test_constants_sync.js 会做源码级比对守卫，漏改会直接测试失败。
 *
 * 双端可加载：浏览器挂 window.H5KINDS，Node（测试用）走 module.exports。
 * ───────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // ── 类型（顶部 Tab + 选择内容目标列表）──
  // icon/label/tagline(一句话主张)/desc(副标)/ratio(发布节奏 chip，仅展示)
  var KINDS = [
    { id: 'value',   icon: '💡', label: '价值型',   tagline: '建立专业壁垒', desc: '讲干货与方法论，让用户觉得你靠谱', ratio: '每周 2' },
    { id: 'persona', icon: '🧭', label: '人设型',   tagline: '让人信任你',   desc: '用选择与代价，露出真实的你',       ratio: '每周 1' },
    { id: 'deal',    icon: '🤝', label: '成交型',   tagline: '把信任变订单', desc: '给信号、证据与动作，不像广告',     ratio: '每月 2-4' },
    { id: 'life',    icon: '🌿', label: '生活型',   tagline: '保持真实温度', desc: '分享日常片段，关系更有温度',       ratio: '随时' },
    { id: 'story',   icon: '📖', label: '我的故事', tagline: '把故事变作品', desc: '往事 / 小说 / 随笔，可做成画面感内容', ratio: '不定时' }
  ];

  // 每个类型的「结构暗示」：在已选横幅下提示会怎么写（与 BUILD / 云函数结构 cue 一致）
  var KIND_STRUCT = {
    value:   '开头切入 → 中间展开「为什么」→ 结尾给收获感',
    persona: '选择 → 代价 → 为什么不后悔 → 给犹豫的人一句话',
    deal:    '时机（信号）→ 信任（证据）→ 动作（引导）',
    life:    '片段 → 感受细节 → 轻轻收住，留生活气',
    story:   '时间地点 → 人物 → 转折 → 回望，克制收尾'
  };

  // 发布配比（解释「为什么有这几类」）
  var MIX = [
    { name: '价值型', icon: '💡', pct: '40%', rhythm: '每周 2 条 · 立专业' },
    { name: '人设型', icon: '🧭', pct: '30%', rhythm: '每周 1 条 · 露真实' },
    { name: '成交型', icon: '🤝', pct: '20%', rhythm: '每月 2-4 条 · 促信任' },
    { name: '生活型', icon: '🌿', pct: '10%', rhythm: '随时 · 有温度' }
  ];

  // ── 每个类型的引导字段（按类型动态渲染）──
  var FIELDS = {
    value: [
      { key: 'identity', label: '我是一个（身份 / 领域）', placeholder: '例如：做知识付费的独立创作者', type: 'input',    required: true },
      { key: 'audience', label: '核心用户是谁',             placeholder: '例如：想做个人品牌的新手',     type: 'input',    required: true },
      { key: 'scene',    label: '想借哪个现象 / 故事讲',     placeholder: '例如：最近很多人问我怎么开始', type: 'textarea', required: true },
      { key: 'point',    label: '你想传递的核心观点',       placeholder: '例如：开始比完美重要',         type: 'textarea', required: true }
    ],
    persona: [
      { key: 'identity', label: '我是一个（身份 / 领域）',   placeholder: '例如：裸辞创业的设计师',           type: 'input',    required: true },
      { key: 'choice',   label: '你最近做的一个选择',         placeholder: '例如：辞掉稳定工作去接自由单',     type: 'textarea', required: true },
      { key: 'reason',   label: '为什么做这个选择',           placeholder: '例如：不想再等「合适的时机」',     type: 'textarea', required: true },
      { key: 'cost',     label: '代价是什么',                 placeholder: '例如：收入不稳、要重新证明自己',   type: 'textarea', required: true }
    ],
    deal: [
      { key: 'identity', label: '我是一个（身份 / 领域）',   placeholder: '例如：做职场陪跑教练',       type: 'input',    required: true },
      { key: 'product',  label: '产品 / 服务叫什么',          placeholder: '例如：21 天简历精修陪跑',    type: 'input',    required: true },
      { key: 'signal',   label: '现在是什么时机（信号）',     placeholder: '例如：秋招马上开始',         type: 'textarea', required: true },
      { key: 'evidence', label: '真实证据（变化 / 结果）',    placeholder: '例如：上批学员 8 人拿到面试', type: 'textarea', required: true },
      { key: 'action',   label: '希望对方做的动作',           placeholder: '例如：回复「陪跑」看方案',    type: 'textarea', required: true }
    ],
    life: [
      { key: 'identity', label: '我是一个（身份 / 日常状态）', placeholder: '例如：下班后的普通打工人',                 type: 'input',    required: false },
      { key: 'moment',   label: '今天想分享的生活片段',       placeholder: '例如：下班后去江边散步，看到一位老人练书法', type: 'textarea', required: true },
      { key: 'feeling',  label: '当下的感受 / 细节',          placeholder: '例如：风很轻，突然觉得慢下来也不是浪费时间', type: 'textarea', required: true },
      { key: 'meaning',  label: '想留下的温度',               placeholder: '例如：忙碌之外，也要给自己一点喘息',       type: 'textarea', required: true }
    ],
    story: [
      { key: 'timePlace', label: '时间 / 地点', placeholder: '例如：高三那年冬天，老家巷口',             type: 'input',    required: true },
      { key: 'person',    label: '人物',         placeholder: '例如：我和总在路口等我的外婆',             type: 'input',    required: true },
      { key: 'turn',      label: '转折',         placeholder: '例如：她突然记不起我的名字了',             type: 'textarea', required: true },
      { key: 'lookback',  label: '回望',         placeholder: '例如：后来我才懂，那是最慢也最暖的告别',   type: 'textarea', required: true }
    ]
  };

  // ── 字段 → 素材文本（只拼「素材 + 轻结构引导」；字数区间交给服务端）──
  var BUILD = {
    value: function (f) { return '我是一个专注' + f.identity + '的知识型IP，核心用户是' + f.audience + '。\n背景：' + f.scene + '。\n我想传递的核心观点是：' + f.point + '。\n请写一条价值型朋友圈：开头用"我最近发现／今天跟朋友聊天／一个现象"自然切入；中间用"为什么／其实是／只不过"展开解释；结尾给出收获感。用我的视角，不说教、不硬广、不堆表情，像一个真实正在思考的人。'; },
    persona: function (f) { return '我是一个' + f.identity + '。\n请写一条人设型朋友圈，围绕"选择与代价"：我最近的选择是' + f.choice + '，原因是' + f.reason + '，代价是' + f.cost + '。\n四段：选择、代价、为什么不后悔、给正在犹豫的人一句话。真实大于完美，像和老朋友聊天，不发宣言、不卖惨、不说教；结尾用"也许／如果你也..."的邀请式语气，可加一个[爱心]。'; },
    deal: function (f) { return '我是' + f.identity + '，有一款产品/服务叫"' + f.product + '"。\n请写一条成交型朋友圈，包含三要素：信号（' + f.signal + '）、证据（' + f.evidence + '）、引导（' + f.action + '）。\n三段自然衔接：先告知时机，再用真实具体的变化建立信任，最后只给一个清晰动作；先帮再卖，不刷屏、不连续感叹号、不夸大承诺，像真人分享而不是广告。结尾轻松一点。'; },
    life: function (f) { return '我是' + f.identity + '。\n请写一条生活型朋友圈，分享这个片段：' + f.moment + '。\n当下的感受和细节是：' + f.feeling + '。\n想留下的温度是：' + f.meaning + '。\n像真实记录而不是鸡汤；用具体感官细节带出情绪，可以有一点轻松口语；不硬带产品、不刻意升华、不堆表情；结尾自然留白或轻轻收住，让人感到真实、松弛、有生活气。'; },
    story: function (f) { return '请写一条叙事型（我的故事）朋友圈。\n时间地点：' + f.timePlace + '。人物：' + f.person + '。转折：' + f.turn + '。回望：' + f.lookback + '。\n像在讲自己的往事，克制、有画面感、不煽情过度；结尾轻轻收住，让人心里一动。'; }
  };

  var DEFAULT_KIND = 'value';   // 移除「智能判断(auto)」后，默认落到第一个类型

  // ── 字数策略分叉（4 类固定区间 / story 跟随原文，下限 80）──
  var KIND_LEN_FIXED = {
    value:   [100, 250],
    persona: [150, 280],
    deal:    [150, 320],
    life:    [80, 200]
  };
  var OUT_LEN_TIERS = [[50, 80, 150], [200, 150, 300], [500, 250, 450], [null, 350, 700]];
  var OUT_LEN_FLOOR = 80;

  // 预计输出字数区间（界面提示，必须与服务端逻辑同规则）
  function outLenOf(kind, n) {
    if (KIND_LEN_FIXED[kind]) {
      var r = KIND_LEN_FIXED[kind];
      return r[0] + '-' + r[1];
    }
    var len = n > 0 ? n : 0;
    for (var i = 0; i < OUT_LEN_TIERS.length; i++) {
      var t = OUT_LEN_TIERS[i];
      if (t[0] === null || len < t[0]) return t[1] + '-' + t[2];
    }
    return OUT_LEN_FLOOR + '-700';
  }

  // 长度说明文案（与上面分叉一致，避免「提示语撒谎」）
  function lenTipOf(kind) {
    var TIP_LONGER = '想更长，在补充说明或换一批时写「再长一点」即可。';
    if (KIND_LEN_FIXED[kind]) {
      var r = KIND_LEN_FIXED[kind];
      return '💡 此类型篇幅参考 ' + r[0] + '-' + r[1] + ' 字（按类型定长）。越具体越像你，真实的细节比完美的表达更有说服力。' + TIP_LONGER;
    }
    return '💡 文案长度跟着你填的内容走：你写得多，就给得更长；只填一句话也至少 ' + OUT_LEN_FLOOR + ' 字（靠展开细节，不编造事实）。真实的细节，比完美的表达更有说服力。' + TIP_LONGER;
  }

  // 给引导字段编号（1)/2)/3)…），让用户一眼看清这一步要填几项
  function withNo(list) {
    return (list || []).map(function (f, i) {
      return Object.assign({}, f, { no: i + 1 });
    });
  }

  // 已填字段数：非空即算（不强制 required，鼓励先写）
  function countFilled(fields, form) {
    var f0 = form || {};
    return (fields || []).filter(function (f) {
      return String(f0[f.key] || '').trim().length > 0;
    }).length;
  }

  // 组装发给服务端的素材文本（不含链接，链接走独立字段）
  function buildPrompt(kind, form, note) {
    var k = BUILD[kind] ? kind : DEFAULT_KIND;
    var text = ((BUILD[k] || BUILD[DEFAULT_KIND])(form || {}) || '').trim();
    var n = String(note || '').trim();
    if (n) text += (text ? '\n\n' : '') + '（补充：' + n + '）';
    return text.trim();
  }

  var api = {
    KINDS: KINDS, KIND_STRUCT: KIND_STRUCT, MIX: MIX, FIELDS: FIELDS, BUILD: BUILD,
    DEFAULT_KIND: DEFAULT_KIND,
    KIND_LEN_FIXED: KIND_LEN_FIXED, OUT_LEN_TIERS: OUT_LEN_TIERS, OUT_LEN_FLOOR: OUT_LEN_FLOOR,
    outLenOf: outLenOf, lenTipOf: lenTipOf, withNo: withNo,
    countFilled: countFilled, buildPrompt: buildPrompt
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.H5KINDS = api;
})(typeof window !== 'undefined' ? window : globalThis);
