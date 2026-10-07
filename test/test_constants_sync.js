// 跨文件常量一致性守卫（零依赖）
// 背景：微信云函数**每个函数独立打包**，不能可靠地 require 前端 config，所以同一份"道具目录/积分单价"
// 被迫在多处各存一份。这是结构性缺点，人工同步迟早漏改，漏了就是"线上少发/多发积分、发错货"。
// 本测试把这类事故挡在提交前。覆盖：
//   【道具目录】utils/config.js → POINTS.packs / VIRTUAL_PAY / COMMISSION
//              ↔ cloudfunctions/vp_create_order → PRODUCTS（下单定价，服务端权威）
//              ↔ cloudfunctions/vp_deliver      → PRODUCTS（发货推送）
//              ↔ cloudfunctions/vp_query        → PRODUCTS（兜底查单补发货）
//   【积分规则】utils/config.js → POINTS.daily ↔ cloudfunctions/points/index.js → DAILY
//              utils/config.js → POINTS.cost  ↔ ../h5_backend/ai_gen/index.js（2026-09-30 移出仓库）  → POINTS_COST
//              utils/config.js → POINTS.earn  ↔ ../h5_backend/ai_gen/index.js（2026-09-30 移出仓库）  → POINTS_EARN
//                （第 15 条：earn 的每一项都必须真有云函数发放，防"空头赚分承诺"）
// 改价格/加档位后**必须跑**：node test/test_constants_sync.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'utils', 'config.js'));

// ── h5_backend 定位（2026-10-06 加固）──
// 背景：ai_gen 源码 2026-09-30 移出本仓库，独立成 h5_backend 仓。原先 6 处硬编码
//   path.join(ROOT, '../h5_backend/...')，本仓 clone 位置一变就全线 ENOENT 假红。
//   实测：本仓在 %TEMP%\dudu-miniapp，而 h5_backend 在
//   C:\Users\Administrator\WorkBuddy\2026-09-11-21-15-54\h5_backend → 8 项假红。
// 策略：统一走 test/h5_backend_path.js（支持 H5_BACKEND_DIR + 多候选目录）；
//   找到 → 照常严格校验；找不到 → 显式 SKIP 并说明原因（不静默假红，也不假绿）。
// ⚠️ 只读**源码文本**，绝不 require 它。
//   ai_gen/index.js 顶层 require('wx-server-sdk')，那是云函数运行时依赖、
//   本仓没装 —— 一 require 就 MODULE_NOT_FOUND（2026-10-06 踩过）。
//   这几用例只需要源码里的常量字面量，fs.readFileSync 足够。
const { AI_GEN_PATH, warnIfMissing } = require('./h5_backend_path');
warnIfMissing('test_constants_sync');

function readAiGen() {
  if (!AI_GEN_PATH) {
    const e = new Error(
      '找不到 h5_backend/ai_gen/index.js，无法校验「前端 config ↔ ai_gen 云函数」常量同步。\n'
      + '  解决办法：设环境变量 H5_BACKEND_DIR，或把 h5_backend 放到本仓兄弟目录。'
    );
    e.code = 'H5_BACKEND_NOT_FOUND';
    throw e;
  }
  return fs.readFileSync(AI_GEN_PATH, 'utf8');
}

// 从云函数源码里抠出 `const <NAME> = { ... };` 字面量并求值
// 两个坑都在这里踩过：
//   ① 字面量常带行内注释（`base: 5,  // 每日基础积分`），拼 `}` 时会被注释吞掉 → 先剥行注释
//   ② 声明可能写成单行（`const X = { a: 1 };  // 注释`），若正则要求 `\n};` 会一路吞到文件后面
//      的下一个 `};`，拼出语法垃圾 → 结尾只匹配 `};`，不限定换行
function extractObject(file, constName) {
  // 绝对路径（h5_backend 经 findAiGen 解析）优先；否则按仓库相对路径解析
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const src = fs.readFileSync(full, 'utf8');
  const re = new RegExp('const\\s+' + constName + '\\s*=\\s*\\{([\\s\\S]*?)\\};');
  const m = re.exec(src);
  if (!m) throw new Error('在 ' + file + ' 中找不到 `const ' + constName + ' = { ... };`（改名了就要同步改本测试）');
  const inner = m[1].replace(/\/\/[^\n]*/g, '');   // 剥行注释
  return new Function('return {' + inner + '\n}')();
}

// ai_gen 侧常量读取统一入口（内部自动用解析到的绝对路径）
function aiObj(constName) { return extractObject(AI_GEN_PATH || '../h5_backend/ai_gen/index.js', constName); }

const FILES = {
  create_order: extractObject('cloudfunctions/vp_create_order/index.js', 'PRODUCTS'),
  deliver: extractObject('cloudfunctions/vp_deliver/index.js', 'PRODUCTS'),
  query: extractObject('cloudfunctions/vp_query/index.js', 'PRODUCTS')
};

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
}

// 1) 三个云函数的 PRODUCTS 必须完全相同
t('三处 PRODUCTS 完全一致（vp_create_order = vp_deliver = vp_query）', () => {
  assert.deepStrictEqual(FILES.deliver, FILES.create_order,
    'vp_deliver 与 vp_create_order 的 PRODUCTS 不一致:\n' + JSON.stringify(FILES.deliver) + '\nvs\n' + JSON.stringify(FILES.create_order));
  assert.deepStrictEqual(FILES.query, FILES.create_order,
    'vp_query 与 vp_create_order 的 PRODUCTS 不一致:\n' + JSON.stringify(FILES.query) + '\nvs\n' + JSON.stringify(FILES.create_order));
});

// 2) config.POINTS.packs ↔ PRODUCTS（productId / priceFen / 积分数量）
t('config.POINTS.packs 与 PRODUCTS 逐档对齐', () => {
  const packs = (config.POINTS && config.POINTS.packs) || [];
  assert.ok(packs.length > 0, 'POINTS.packs 为空');
  packs.forEach(p => {
    const item = FILES.create_order[p.productId];
    assert.ok(item, 'PRODUCTS 缺少档位 ' + p.productId);
    assert.strictEqual(item.kind, 'points', p.productId + ' 的 kind 应为 points');
    assert.strictEqual(item.priceFen, p.priceFen, p.productId + ' 价格不一致: 云函数 ' + item.priceFen + ' vs config ' + p.priceFen);
    assert.strictEqual(item.points, p.amount, p.productId + ' 积分数不一致: 云函数 ' + item.points + ' vs config ' + p.amount);
  });
});

// 3) 反向：PRODUCTS 里的 points 档位不能有 config 里没登记的（漏配 → 用户看不到也买不到）
t('PRODUCTS 的 points 档位都在 config 中登记（无隐藏档位）', () => {
  const cfgIds = ((config.POINTS && config.POINTS.packs) || []).map(p => p.productId).sort();
  const fnIds = Object.keys(FILES.create_order).filter(k => FILES.create_order[k].kind === 'points').sort();
  assert.deepStrictEqual(fnIds, cfgIds, '档位集合不一致: 云函数 ' + JSON.stringify(fnIds) + ' vs config ' + JSON.stringify(cfgIds));
});

// 4) 整本解锁道具 ↔ config.VIRTUAL_PAY / COMMISSION（2026-09-18：COMMISSION 改为 tiers 定制档位）
t('comic_full（整本）与 VIRTUAL_PAY 价格一致；COMMISSION.tiers 与云函数 custom 档位一致', () => {
  const vp = config.VIRTUAL_PAY;
  const item = FILES.create_order[vp.productId];
  assert.ok(item, 'PRODUCTS 缺少 VIRTUAL_PAY.productId = ' + vp.productId);
  assert.strictEqual(item.kind, 'unlock', vp.productId + ' 应为 unlock 类型');
  assert.strictEqual(item.priceFen, vp.priceFen, '整本价格不一致: 云函数 ' + item.priceFen + ' vs config ' + vp.priceFen);
  // 定制档位：COMMISSION.tiers（前端）↔ PRODUCTS（云函数）逐档核对
  const tiers = (config.COMMISSION && config.COMMISSION.tiers) || [];
  assert.ok(tiers.length >= 2, 'COMMISSION.tiers 应包含 comic_pdf/comic_web 两档');
  tiers.forEach(tr => {
    const p = FILES.create_order[tr.productId];
    assert.ok(p, 'PRODUCTS 缺少定制档位 ' + tr.productId);
    assert.strictEqual(p.kind, 'custom', tr.productId + ' 应为 custom 类型');
    assert.strictEqual(p.priceFen, tr.priceFen, tr.productId + ' 价格不一致: 云函数 ' + p.priceFen + ' vs config ' + tr.priceFen);
    assert.strictEqual(tr.priceText, '¥' + (tr.priceFen / 100), tr.productId + ' 的 priceText 与 priceFen 不符');
  });
});

// 5) 前端展示用的 priceText 必须与 priceFen 对得上（避免界面写 ¥6 实际扣 ¥60）
t('packs.priceText 与 priceFen 一致（界面金额不写错）', () => {
  ((config.POINTS && config.POINTS.packs) || []).forEach(p => {
    assert.strictEqual(p.priceText, '¥' + (p.priceFen / 100), p.productId + ' 的 priceText(' + p.priceText + ') 与 priceFen(' + p.priceFen + ') 不符');
  });
});

// 6) 积分规则：config.POINTS.daily ↔ points 云函数 DAILY
t('config.POINTS.daily 与 points 云函数 DAILY 一致', () => {
  const fnDaily = extractObject('cloudfunctions/points/index.js', 'DAILY');
  const cfg = config.POINTS.daily;
  ['enabled', 'base', 'streakCap', 'milestoneEvery', 'milestoneBonus'].forEach(k => {
    assert.strictEqual(fnDaily[k], cfg[k], 'DAILY.' + k + ' 不一致: 云函数 ' + fnDaily[k] + ' vs config ' + cfg[k]);
  });
});

// 7) 积分单价：config.POINTS.cost ↔ ai_gen 云函数 POINTS_COST / POINTS_EARN
//    漏改的后果：前端显示"消耗 20"但服务端只扣 15（或反之），用户直接看到余额对不上。
t('config.POINTS.cost / earn 与 ai_gen 云函数 POINTS_COST / POINTS_EARN 一致', () => {
  const fnCost = aiObj('POINTS_COST');
  const fnEarn = aiObj('POINTS_EARN');
  const cfgCost = config.POINTS.cost || {};
  const cfgEarn = config.POINTS.earn || {};

  // config.cost.momentsGen ≈ 云函数 moments；config.cost.momentsRevise ≈ 云函数 momentsRevise
  assert.strictEqual(fnCost.moments, cfgCost.momentsGen,
    '朋友圈文案「首次」价格不一致: 云函数 ' + fnCost.moments + ' vs config.cost.momentsGen ' + cfgCost.momentsGen);
  assert.strictEqual(fnCost.momentsRevise, cfgCost.momentsRevise,
    '朋友圈文案「换一批」价格不一致: 云函数 ' + fnCost.momentsRevise + ' vs config.cost.momentsRevise ' + cfgCost.momentsRevise);
  assert.deepStrictEqual(fnEarn, cfgEarn,
    'POINTS_EARN 应与 config.POINTS.earn 一致（当前均为空对象：生成一律扣分）');
  // 2026-09-19：画面感内容「脚本」档整体下线（画面感内容只能走**付费定制**，脚本是履约内部工作稿）
  // ⇒ 两侧都不该再出现该档位。
  // ⚠️ 这里**不能**写成 strictEqual(fnCost.comic, cfgCost.comicPolish)：两处都是 undefined 时
  //    恒为真，等于**空转断言**（本轮就是靠反向验证才发现它已失去保护力）。必须显式断言"不存在"。
  assert.ok(!('comic' in fnCost),
    'ai_gen 的 POINTS_COST 里仍有 comic 档 —— 免费脚本路径已从产品逻辑中移除，画面感内容只允许付费定制');
  assert.ok(!('comicPolish' in cfgCost),
    'config.POINTS.cost 里仍有 comicPolish 档 —— 免费脚本路径已从产品逻辑中移除，画面感内容只允许付费定制');
  // 云函数不该有 config 里没登记的收费档（隐藏扣费）
  const COST_MAP = { moments: 'momentsGen', momentsRevise: 'momentsRevise' };
  Object.keys(fnCost).forEach(k => {
    const known = COST_MAP[k];
    assert.ok(known && cfgCost[known] != null, 'POINTS_COST 里的 ' + k + ' 在 config.POINTS.cost 中没有对应项');
  });
});

// 8) gen 页计费模型（2026-10-01 重做：所有产出型工具都真实扣积分）
//    新事实：gen 页的「套模板出文案」走 momentsGen、「排版优化 / 公众号文章」走 optFormat，
//    单价全部来自 config.POINTS.cost，扣费统一走 utils/charge.js 的 charge()（单一扣费入口）。
//    —— 仍守住两条红线：① gen 页零 AI 调用（ai_gen 不得出现，个人主体过审）；
//                         ② 不得再出现写死的 MOMENTS_COST/REVISE_COST 旧常量（价格必须只来自 config）。
//    本断言既拦「悄悄免费」（动作没接 charge），也拦「静默写死价」（绕开 config）。
t('gen 页产出型动作全部经 charge() 扣费，且 action 与 config.POINTS.cost 对齐', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages', 'gen', 'gen.js'), 'utf8');
  const cfgCost = (config.POINTS && config.POINTS.cost) || {};
  // 8a) 两个产出动作必须真的调用 charge(action)
  assert.ok(/charge\(\s*['"]momentsGen['"]/.test(src),
    'gen.js 未对「套模板出文案」调用 charge(\'momentsGen\') —— 该动作必须扣费');
  assert.ok(/charge\(\s*['"]optFormat['"]/.test(src),
    'gen.js 未对「排版优化 / 公众号文章」调用 charge(\'optFormat\') —— 该动作必须扣费');
  // 8b) action 必须在 config.POINTS.cost 中存在且为 > 0 的数值（否则 charge 会当免费放行）
  ['momentsGen', 'optFormat'].forEach(a => {
    assert.ok(typeof cfgCost[a] === 'number' && cfgCost[a] > 0,
      'config.POINTS.cost.' + a + ' 缺失或 <= 0 —— gen 的扣费 action 必须有真实单价');
  });
  // 8c) 红线：不得写死旧扣分常量 / 不得直接调 spend（保持单一入口）/ 不得调 ai_gen
  assert.ok(!/MOMENTS_COST|REVISE_COST/.test(src),
    'gen.js 又出现了 MOMENTS_COST/REVISE_COST 旧扣分常量 —— 价格必须只来自 config.POINTS.cost');
  assert.ok(!/points\.spend\s*\(|\.spend\s*\(/.test(src),
    'gen.js 出现了 spend( 直接调用 —— 扣费必须统一走 utils/charge.js 的 charge()，不要散落手写');
  assert.ok(!/ai_gen/.test(src),
    'gen.js 出现了 ai_gen 调用 —— gen 页零 AI 调用是个人主体过审红线，恢复前必须重新过合规评估');
});

// 8.1) 卡片制作属产出型工具，必须接 charge() 且其 action 在 config 中有真实单价
//      （原「分镜编辑器」因去生成化重构已整体移除，相关断言同步摘除）
t('卡片制作经 charge() 扣费，action 与 config 对齐', () => {
  const cfgCost = (config.POINTS && config.POINTS.cost) || {};
  const cardSrc = fs.readFileSync(path.join(ROOT, 'pages', 'card', 'card.js'), 'utf8');
  assert.ok(/charge\(\s*['"]cardGen['"]/.test(cardSrc),
    'card.js 未对「制作卡片」调用 charge(\'cardGen\') —— 该动作必须扣费');
  assert.ok(typeof cfgCost.cardGen === 'number' && cfgCost.cardGen > 0,
    'config.POINTS.cost.cardGen 缺失或 <= 0');
});

// 8.5) 5 个合规模块的积分档位：前后端必须同值，且五页都真的调 charge
//真踩过（2026-10-02）：云函数 spend 校验 delta !== GEN_COST[reason] 会直接拒单，
//     前端只表现为「积分扣除失败，请重试」，极难定位——因为前端 charge 本身没报错。
//     所以这 5 个档位必须**同时**出现在前端 config 与云函数 GEN_COST，且值相同。
t('5 个合规模块档位：前后端同名同值，且五页都经 charge() 扣费', () => {
  const cfgCost = (config.POINTS && config.POINTS.cost) || {};
  const cfSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'points', 'index.js'), 'utf8');
  // 只读源码文本、不 require：云函数顶层依赖 wx-server-sdk，本仓没装
  const genBlock = (cfSrc.match(/const GEN_COST = \{([\s\S]*?)\n\};/) || ['', ''])[1];

  const MAP = {
    quotes: 'quoteCard',
    spark: 'sparkCard',
    weather: 'weatherCard',
    solar: 'solarCard',
    line: 'lineCard'
  };
  Object.keys(MAP).forEach(page => {
    const action = MAP[page];
    // ① 前端 config 有该档位且 = 5
    assert.strictEqual(cfgCost[action], 8,
      'config.POINTS.cost.' + action + ' 应为 8，实际 ' + cfgCost[action]);
    // ② 云函数 GEN_COST 有同名同值（缺一即 spend拒单）
    const m = genBlock.match(new RegExp(action + '\\s*:\\s*(\\d+)'));
    assert.ok(m, '云函数 GEN_COST 缺 ' + action + ' —— spend 会以「扣费成本不符」拒单');
    assert.strictEqual(Number(m[1]), 8,
      '云函数 GEN_COST.' + action + ' 应为 8，实际 ' + m[1] + '（与前端不一致）');
    // ③ 页面真的调了 charge
    const js = fs.readFileSync(path.join(ROOT, 'pages', page, page + '.js'), 'utf8');
    assert.ok(new RegExp("charge\\(\\s*'" + action + "'").test(js),
      page + '.js 未调用 charge(\'' + action + '\')');
  });
  // ④ 反向：云函数有、前端 config **完全没有**的档位（防灰档位白送积分）。
  //    注意不能要求「全部相等」——GEN_COST 里还有 momentsGen/cardGen 等 20 分档位，
  //    它们在前端 config 里当然存在，只是值不是 5。
  const serverEntries = (genBlock.match(/(\w+)\s*:\s*(\d+)/g) || [])
    .map(s => { const p = s.split(':'); return { name: p[0].trim(), cost: Number(p[1]) }; });
  assert.ok(serverEntries.length >= 10, 'GEN_COST 只解析到 ' + serverEntries.length + ' 档（应 ≥10）');
  serverEntries.forEach(e => {
    assert.ok(typeof cfgCost[e.name] === 'number' && cfgCost[e.name] > 0,
      '云函数 GEN_COST 有 ' + e.name + '（' + e.cost + ' 分）但前端 config.POINTS.cost 缺失该 action'
      + ' —— 前端算不出正确 delta，spend 必拒');
    assert.strictEqual(cfgCost[e.name], e.cost,
      e.name + ' 前后端不一致：前端 ' + cfgCost[e.name] + ' / 云函数 ' + e.cost);
  });
});

t('5 个合规模块页面注释不得再声称「不调用 charge」（防与实现脱钩）', () => {
  // 2026-10-06：这 5 页原本注释写「不调用 utils/charge（个人主体合规）」，
  // 启用积分后若忘改，注释会与实现矛盾，误导后来人以为没扣费。
  ['quotes', 'spark', 'weather', 'solar', 'line'].forEach(page => {
    const js = fs.readFileSync(path.join(ROOT, 'pages', page, page + '.js'), 'utf8');
    const head = js.split('\n').slice(0, 12).join('\n');
    assert.ok(!/不调用\s*utils\/charge/.test(head),
      page + '.js 头部注释仍写「不调用 utils/charge」，与实际扣费矛盾');
  });
});

// 9) productId 的数字后缀必须等于到账积分数
//    真踩过：档位从"¥50→2000 积分"改成"¥50→2500 积分"时，若只改 amount 不改 ID，
//    就会留下 `points_2000` 实发 2500 的档位 —— 云函数与 config 完全一致、价格也对，
//    所有既有测试都绿，但后来的人一定会看错档位。所以必须把"ID 即语义"钉死。
t('productId 的数字后缀 = 到账积分（防止 ID 与数量脱钩）', () => {
  ((config.POINTS && config.POINTS.packs) || []).forEach(p => {
    const m = /^points_(\d+)$/.exec(p.productId);
    assert.ok(m, p.productId + ' 不符合 points_<数量> 命名约定');
    assert.strictEqual(Number(m[1]), p.amount,
      p.productId + ' 的 ID 后缀(' + m[1] + ') 与到账积分(' + p.amount + ') 不符 —— ID 与语义脱钩会误导后来的人');
  });
});

// 10) 积分单价必须随金额递增（"大包更划算"）——这是用户拍板的商业规则，不是巧合
//     真跨过坑：曾出现 ¥18=44.4/元 高于 ¥50=40/元 的倒挂，大包反而更贵，用户明确要求修正。
//     把规则写成断言，以后调价若又调倒挂会立刻失败，而不是等用户发现。
t('积分单价随金额单调递增（大包必须更划算）', () => {
  const packs = ((config.POINTS && config.POINTS.packs) || []).slice().sort((a, b) => a.priceFen - b.priceFen);
  assert.ok(packs.length >= 2, '档位少于 2 个，无法比较单价');
  let prev = -1, prevId = '';
  packs.forEach(p => {
    const rate = p.amount / (p.priceFen / 100);      // 积分/元
    assert.ok(rate > prev,
      '单价未递增：' + p.productId + ' 为 ' + rate.toFixed(1) + ' 积分/元，不高于上一档 ' + prevId + ' 的 ' + prev.toFixed(1) + ' 积分/元'
      + '（大包反而更贵，用户已明确要求"大包更划算"）');
    prev = rate; prevId = p.productId;
  });
});

// 11) 「最超值」角标必须打在真正的最高单价档上（否则是在误导用户）
t('tag「最超值」指向单价最高的档位', () => {
  const packs = ((config.POINTS && config.POINTS.packs) || []);
  const tagged = packs.filter(p => p.tag);
  const best = packs.slice().sort((a, b) => (b.amount / b.priceFen) - (a.amount / a.priceFen))[0];
  tagged.forEach(p => {
    assert.strictEqual(p.productId, best.productId,
      '「最超值」打在了 ' + p.productId + '，但单价最高的是 ' + best.productId);
  });
});

// 12) 「换一批」必须比「首次」便宜 —— 这是用户拍板的有意设计（复购优惠），不是笔误
//     目的：用户对结果不满意时降低"再试一次"的门槛，鼓励多改几次直到满意，而不是放弃。
//     这条断言的作用是**防止被"修正"**：日后有人看到 15 < 20 直觉上觉得不合理而调高/调平，
//     测试会立刻失败并把理由摆出来，而不是悄悄让商业设计失效（用户会以为是 bug）。
t('「换一批」必须比「首次」便宜（有意设计的复购优惠，勿"修正"）', () => {
  const c = config.POINTS.cost || {};
  assert.ok(typeof c.momentsGen === 'number' && typeof c.momentsRevise === 'number',
    'config.POINTS.cost 缺 momentsGen / momentsRevise');
  assert.ok(c.momentsRevise < c.momentsGen,
    '「换一批」(' + c.momentsRevise + ') 不再比「首次」(' + c.momentsGen + ') 便宜。'
    + '这**是有意设计的复购优惠**（用户 2026-09-17 确认）：让用户不满意时更愿意再试一次。'
    + '若确实要取消该优惠，请先确认产品意图，再同步注释与本文档。');
  // 云函数侧同样守住（云函数是权威扣费点，前端只是展示）
  const fnCost = aiObj('POINTS_COST');
  assert.ok(fnCost.momentsRevise < fnCost.moments,
    '云函数 POINTS_COST 的换一批价(' + fnCost.momentsRevise + ') 不再低于首次价(' + fnCost.moments + ')，复购优惠设计已被破坏');
});

// 13) 「复购优惠」承诺必须与产品现实同步（2026-09-29 改为反向守卫）
//     「换一批更便宜」的复购优惠随 AI 生成一起下线了（gen 页已纯本地免费，不存在换一批扣分）。
//     反向锁死：用户可见文案**不得**再出现「复购优惠/换一批更便宜」承诺 ——
//     承诺一个不存在的优惠 = 界面撒谎（真踩过同款：earn 清空后文案仍写「生成 +30」）。
t('用户可见文案不得承诺已下线的「复购优惠」（界面不得与现实脱钩）', () => {
  ['pages/gen/gen.wxml', 'pages/points/points.wxml'].forEach(f => {
    const wxml = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(wxml.indexOf('复购优惠') < 0 && wxml.indexOf('换一批更便宜') < 0,
      f + ' 仍承诺「复购优惠/换一批更便宜」—— 换一批扣分已随 AI 生成下线（gen 页纯本地免费），'
      + '承诺不存在的优惠等于界面撒谎。若产品上真恢复了该优惠，请同步第 7/8 条的成本校验并更新本断言。');
  });
});

// 14) config.PRODUCT.chapters 声明的面板文件必须真实存在
//     2026-09-17 把 panels/ 拆进分包 packageReader 后新增：少一张面板 = 阅读页那一格白屏，
//     而 WXML 的 <image> 加载失败是静默的（没有报错、没有红屏），只能靠断言兜住。
//     同时反向检查"磁盘上有、config 里没声明"的多余面板（复制粘贴新章节时最容易留下）。
t('章节声明与实际面板文件一致（无缺失、无多余）', () => {
  const panelDir = path.join(ROOT, 'packageReader', 'panels');
  assert.ok(fs.existsSync(panelDir),
    '找不到 packageReader/panels/ —— 面板已拆入分包，若再次搬家请同步本测试与 reader.js 的 PANEL_BASE');
  const declared = new Set();
  let total = 0;
  (config.PRODUCT.chapters || []).forEach(ch => {
    (ch.panels || []).forEach(name => {
      total++;
      declared.add(name);
      const f = path.join(panelDir, name + '.jpg');
      assert.ok(fs.existsSync(f),
        '章节 ' + ch.id + '（' + ch.name + '）声明的面板 ' + name + '.jpg 不存在于 packageReader/panels/');
    });
  });
  assert.ok(total > 0, 'PRODUCT.chapters 未声明任何面板');
  const onDisk = fs.readdirSync(panelDir).filter(f => f.endsWith('.jpg')).map(f => f.replace(/\.jpg$/, ''));
  const orphan = onDisk.filter(n => !declared.has(n));
  assert.strictEqual(orphan.length, 0,
    '磁盘上有未被任何章节引用的面板：' + orphan.join(', ') + '（要么补进 config.chapters，要么删掉）');
});

// 15) config.POINTS.earn 的每一项都必须真有云函数发放 —— 不许"空头赚分承诺"
//     真踩过：config.POINTS.earn 曾有 emailSend: 10，points 页据此显示「发到邮箱 +10」；
//     后来邮件功能取消（send_email 云函数删掉），若只删云函数不删这一项，
//     界面就会继续承诺一个用户**永远赚不到**的积分 —— 用户会当成 bug，而所有既有测试仍全绿。
//     本断言把"承诺"与"发放"钉在一起：config 新增任何 earn 键，必须同步进 MAP 并真有云函数发放。
t('config.POINTS.earn 每项都有云函数实际发放（无空头赚分承诺）', () => {
  const fnEarn = aiObj('POINTS_EARN');
  // config 键名 → 云函数键名（两处命名不同，显式映射；新增赚分行为时两处都要加）
  // 当前 config.POINTS.earn 为空（生成一律扣分，不存在任何"赚分"行为）⇒ 映射表也应为空。
  // 保留映射机制：将来若真的加回赚分项，必须在此登记，否则下面断言会以"空头承诺"直接 FAIL。
  const MAP = {};
  const cfgEarn = config.POINTS.earn || {};
  Object.keys(cfgEarn).forEach(k => {
    const fnKey = MAP[k];
    assert.ok(fnKey,
      'config.POINTS.earn 的 "' + k + '" 没有对应到任何云函数的发放常量（MAP 里查无此项）—— '
      + '界面会据此承诺"赚 +' + cfgEarn[k] + ' 积分"，但没有任何云函数真的发这笔分，用户永远赚不到。'
      + '请补上云函数发放逻辑并登记进 MAP，或从 earn 中删除该项。');
    assert.strictEqual(fnEarn[fnKey], cfgEarn[k],
      'config 承诺的 ' + k + '=' + cfgEarn[k] + ' 与云函数发放的 ' + fnKey + '=' + fnEarn[fnKey] + ' 不一致');
  });
});

// 16) OUT_LEN_TIERS（输出长度档位）服务端基准自洽（2026-09-29 更新）
//     前端 gen 页已重写为纯本地工具箱，「预计输出 X-Y 字」提示随 AI 生成一起下线 ——
//     gen.js **不得**再含 OUT_LEN_TIERS（留着必是死代码或过时提示）。
//     ai_gen 云函数尚未从云端下架（手动待办），只要它还部署着，其内部档位就应与拍板基准一致
//     （万一被调用，字数仍按拍板规则工作）。待 ai_gen 真正停用/删除后，本条与第 17/22 条一起退役。
t('OUT_LEN_TIERS：ai_gen 服务端基准自洽；前端 gen.js 不得再有字数档位', () => {
  const CANON = '[[50,80,150],[200,150,300],[500,250,450],[null,350,700]]';
  const aiSrc = readAiGen().replace(/\s/g, '');
  assert.ok(aiSrc.indexOf('OUT_LEN_TIERS=' + CANON) >= 0,
    '../h5_backend/ai_gen/index.js 的 OUT_LEN_TIERS 与拍板基准不一致。\n'
    + '基准（归一化空白后）：OUT_LEN_TIERS=' + CANON);
  const genSrc = fs.readFileSync(path.join(ROOT, 'pages/gen/gen.js'), 'utf8');
  assert.ok(!/OUT_LEN_TIERS/.test(genSrc),
    'pages/gen/gen.js 仍含 OUT_LEN_TIERS —— 前端字数档位提示已随 AI 生成下线，'
    + '留着必是死代码或与实际行为不符的过时提示，请删除');
});

// 17) 80 字硬下限：ai_gen 侧保留；前端不得再声明（同第 16 条的新事实）
t('OUT_LEN_FLOOR = 80：ai_gen 侧一致且 ≥ 下限；前端 gen.js 不得再声明', () => {
  const aiSrc = readAiGen();
  assert.ok(/OUT_LEN_FLOOR\s*=\s*80\s*;/.test(aiSrc),
    'ai_gen 未声明 OUT_LEN_FLOOR = 80；用户拍板"至少 80 字"，不可下调或删除');
  // 每个档位的下限都不得低于 80（防止有人只改末档忘了首档）
  const m = /OUT_LEN_TIERS\s*=\s*(\[[\s\S]*?\]);/.exec(aiSrc);
  assert.ok(m, '未找到 OUT_LEN_TIERS 字面量');
  const tiers = eval(m[1]);   // 受控来源（本仓库源码），仅用于断言
  tiers.forEach(tr => {
    assert.ok(tr[1] >= 80, '档位 ' + JSON.stringify(tr) + ' 的下限低于 80 字，违反"至少 80 字"的硬规则');
  });
  const genSrc = fs.readFileSync(path.join(ROOT, 'pages/gen/gen.js'), 'utf8');
  assert.ok(!/OUT_LEN_FLOOR/.test(genSrc),
    'pages/gen/gen.js 仍含 OUT_LEN_FLOOR —— 前端字数硬规则已随 AI 生成下线，请删除');
});

// 22) KIND_LEN_FIXED（4 类固定字数区间）：ai_gen 侧基准自洽；前端不得再声明（同第 16 条）
t('KIND_LEN_FIXED：ai_gen 侧基准自洽；前端 gen.js 不得再声明', () => {
  const CANON = { value: [100, 250], persona: [150, 280], deal: [150, 320], life: [80, 200] };
  const svr = aiObj('KIND_LEN_FIXED');
  assert.deepStrictEqual(svr, CANON,
    '服务端 ai_gen 的 KIND_LEN_FIXED 与基准不一致:\n' + JSON.stringify(svr) + '\n应等于 ' + JSON.stringify(CANON));
  // 固定区间的下限必须 ≥ 80（与 OUT_LEN_FLOOR 一致，否则破坏"至少 80 字"硬规则）
  Object.keys(CANON).forEach(k => assert.ok(CANON[k][0] >= 80,
    'KIND_LEN_FIXED.' + k + ' 的下限(' + CANON[k][0] + ')低于 80 字，违反"至少 80 字"硬规则'));
  const genSrc = fs.readFileSync(path.join(ROOT, 'pages/gen/gen.js'), 'utf8');
  assert.ok(!/KIND_LEN_FIXED/.test(genSrc),
    'pages/gen/gen.js 仍含 KIND_LEN_FIXED —— 前端固定字数区间已随 AI 生成下线，请删除');
});

// 23) 「更长」关键词升档（③ 2026-09-20 用户拍板）：加长区间必须真的更长，关键词不得误触发
//     漏改后果有两头：① 用户说「再长一点」却拿不到更长的文案（功能形同虚设）；
//     ② 关键词过宽（例如把「具体」也算上）会命中生活型指令里的"具体感官细节"，篇幅被无故拉长。
t('「更长」关键词升档：加长区间更长、关键词不误触发', () => {
  const base = aiObj('KIND_LEN_FIXED');
  const long = aiObj('KIND_LEN_FIXED_LONG');
  Object.keys(base).forEach(k => {
    assert.ok(long[k], 'KIND_LEN_FIXED_LONG 缺类型 ' + k + '（该类型无法因"更长"而加长）');
    assert.ok(long[k][0] >= 80, 'KIND_LEN_FIXED_LONG.' + k + ' 下限(' + long[k][0] + ')低于 80，违反"至少 80 字"');
    assert.ok(long[k][1] > base[k][1],
      'KIND_LEN_FIXED_LONG.' + k + ' 上限(' + long[k][1] + ')未大于基准上限(' + base[k][1] + ')：升档后并没有更长');
    assert.ok(long[k][0] >= base[k][0], 'KIND_LEN_FIXED_LONG.' + k + ' 下限小于基准下限，升档后反而可能更短');
  });
  // 关键词正则：从源码抠出后**实测**（不能只断言"存在"，否则又是空转断言）
  const src = readAiGen();
  const m = /LEN_UP_RE\s*=\s*(\/[\s\S]*?\/[a-z]*)\s*;/.exec(src);
  assert.ok(m, 'ai_gen 未声明 LEN_UP_RE（「更长」升档的识别器）');
  const re = eval(m[1]);
  ['再长一点', '能不能写长点', '详细些', '字数多一点'].forEach(s => {
    assert.ok(re.test(s), '「' + s + '」应被识别为"要求更长"，实际未命中（用户诉求被静默忽略）');
  });
  ['今天去长辈家吃饭', '这篇讲长期主义', '生活型要写具体感官细节'].forEach(s => {
    assert.ok(!re.test(s), '「' + s + '」被误判为"要求更长"（关键词过宽 → 篇幅会被无故拉长）');
  });
});

// 18) 前端类型 Tab 的 id 必须都在服务端白名单内
//      以下为 2026-09-19 字数策略分叉新增的跨文件守卫
//     静默失败场景：前端加了一个新类型（比如 "vlog"），但忘了同步服务端 MOMENTS_KINDS，
//     服务端 normalizeKind() 会把它**安静地**退化成 value —— 用户选了"某类型"，实际拿到"自动判断"，
//     没有任何报错，用户只会觉得"这个类型没用"。这条把它挡在提交前。
t('前端 KINDS 的 id 全部在服务端 MOMENTS_KINDS 白名单内', () => {
  const genSrc = fs.readFileSync(path.join(ROOT, 'pages', 'gen', 'gen.js'), 'utf8');
  // 抠出 KINDS 数组里的 id（用引号形式做锚，避免误匹配 desc 等字段）
  const block = /const\s+KINDS\s*=\s*\[([\s\S]*?)\n\];/.exec(genSrc);
  assert.ok(block, '未能在 pages/gen/gen.js 找到 const KINDS = [ ... ];');
  const ids = (block[1].match(/id:\s*'([^']+)'/g) || []).map(s => /'([^']+)'/.exec(s)[1]);
  assert.ok(ids.length >= 5, 'KINDS 至少应有 5 个类型，实际 ' + ids.length);
  const aiSrc = readAiGen();
  const wl = /MOMENTS_KINDS\s*=\s*\[([\s\S]*?)\];/.exec(aiSrc);
  assert.ok(wl, '未能在 ai_gen 找到 MOMENTS_KINDS 白名单');
  const allow = (wl[1].match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, ''));
  ids.forEach(id => assert.ok(allow.indexOf(id) >= 0,
    '前端类型 id "' + id + '" 不在服务端 MOMENTS_KINDS 白名单 [' + allow.join(', ') + '] 内 —— '
    + '服务端会把它静默退化为 value，用户选了该类型却拿到"自动判断"且无任何提示。请两处同改。'));
  // 反向：白名单里的类型也应当都能在前端选到（免得有"永远选不到"的死类型）
  allow.forEach(a => assert.ok(ids.indexOf(a) >= 0,
    '服务端白名单里的 "' + a + '" 在前端没有对应入口 —— 该类型永远无法被用户选中'));
});

// 19) 新人礼数值：config.POINTS.signupBonus ↔ points 云函数 SIGNUP
//     漏改的后果很直接：界面承诺"新人礼 +100"、服务端只发 50（或反之），
//     用户会看到到账数字与提示不符，直接当成"骗人"。而这类漏改没有任何运行时报错。
t('config.POINTS.signupBonus 与 points 云函数 SIGNUP 一致', () => {
  const fn = extractObject('cloudfunctions/points/index.js', 'SIGNUP');
  const cfg = config.POINTS.signupBonus || {};
  assert.strictEqual(fn.enabled, cfg.enabled,
    'SIGNUP.enabled 不一致: 云函数 ' + fn.enabled + ' vs config ' + cfg.enabled);
  assert.strictEqual(fn.amount, cfg.amount,
    '新人礼金额不一致: 云函数 ' + fn.amount + ' vs config ' + cfg.amount
    + '（界面按 config 承诺、服务端按 SIGNUP 发放，不一致用户立刻能看出来）');
  assert.ok(typeof cfg.amount === 'number' && cfg.amount > 0, 'signupBonus.amount 必须是正整数');
});

// 20) 新人礼必须与「每日奖励开关」解耦 —— 关掉签到不能连带吞掉新人礼
//     新人礼搭在 daily 这个 action 上发放（省一次云函数调用），因此极易被下面两种改法悄悄弄丢：
//       ① 服务端把 `if (!DAILY.enabled) return` 挪到 claimSignup 之前；
//       ② 前端按 dailyOn 提前 return，压根不发起这次调用。
//     两种情况的症状完全一样：**签到一关，新人礼就静默消失** —— 没有报错、没有日志，
//     用户只是拿不到那 100 分，而所有既有测试仍全绿（各自内部自洽）。所以把顺序写成断言。
t('新人礼与签到开关解耦（关掉签到也不能吞掉新人礼）', () => {
  // 服务端：发放必须在「每日奖励关闭」守卫之前
  // ⚠️ 锚点必须用**调用点**（`const gift = await claimSignup(`），不能用 `claimSignup(db, openid, doc)`——
  //    后者同时出现在上面的**函数定义行**里，indexOf 会取到定义处的位置，
  //    于是无论调用点被挪到哪，断言都恒为真（反向验证时实测到这条是空转的）。
  const fnSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'points', 'index.js'), 'utf8');
  const iCall = fnSrc.indexOf('const gift = await claimSignup(');
  const iGuard = fnSrc.indexOf('if (!DAILY.enabled)');
  assert.ok(iCall >= 0, 'points 云函数里找不到新人礼发放调用（`const gift = await claimSignup(` 改名了就要同步改本测试）');
  assert.ok(iGuard >= 0, 'points 云函数里找不到 `if (!DAILY.enabled)` 守卫');
  assert.ok(iCall < iGuard,
    '新人礼的发放(claimSignup)排在了「每日奖励关闭」守卫之后 —— daily.enabled 一旦设为 false，'
    + '新人礼会静默消失（无报错、用户只是拿不到分）。必须把 claimSignup 放在该守卫之前。');
  // 前端：两处「进页面自动检查」都不能按 dailyOn 提前 return
  ['pages/index/index.js', 'pages/points/points.js'].forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(src.indexOf('maybeDailyCheckin') >= 0, f + ' 未找到 maybeDailyCheckin 调用（实现改了请同步本测试）');
    assert.ok(!/if\s*\(\s*!this\.data\.dailyOn\s*\)\s*return/.test(src),
      f + ' 里存在 `if (!this.data.dailyOn) return` —— 这会在「每日奖励关闭」时连新人礼一起跳过。'
      + '新人礼与签到共用这一个 action，本调用不得按 dailyOn 提前返回（服务端自己认 DAILY.enabled）。'
      + '（手动签到按钮 onClaimDaily 按 dailyOn 拦截是对的，本条只针对自动检查。）');
  });
});

// 21) 积分说明不得承诺「已下线或已反向」的加分项
//     真踩过：画面感内容脚本功能曾从「赚 30」改成「扣 30」，points 页仍显示「生成画面感内容脚本 +30」——
//     用户看到的是"做这个能赚 30"，实际做这件事要扣 30，**方向完全反了**。根因是文案写的是
//     `POINTS.earn.comicScript || 30`，而 earn 已清空，`|| 30` 永远兜住那个旧值。既有测试全绿，
//     因为没人检查文案与 earn 目录的一致性。（2026-09-19 起该路径整体下线，文案连"扣"也不该再提。）
t('积分说明不得承诺已下线的赚分项（文案不得与 earn 目录脱钩）', () => {
  // ⚠️ 必须先剥掉行注释再扫：解释这条 bug 的注释里会原样引用那句错误文案
  //    （"此前这里写死了「生成画面感内容脚本 +30」"），不剥注释会被自己的说明误伤。
  const raw = fs.readFileSync(path.join(ROOT, 'pages', 'points', 'points.js'), 'utf8');
  const src = raw.replace(/\/\/[^\n]*/g, '');
  assert.ok(src.indexOf('生成画面感内容脚本 +') < 0,
    'points 页的积分说明里仍有「生成画面感内容脚本 +N」——该功能已下线，且现在是**扣**分，'
    + '这句话方向反了，会误导用户。文案必须只写当前真实存在的增减项。');
});

// 22) 去生成化重构（2026-10-05）：付费定制画面感内容及其「9 折券」已全部移出小程序包
//     （pages/commission 删除、points 页「画面感内容定制」入口与「去使用」链接下线），
//     因此端内 config.POINTS.redeem 现在**刻意留空**——包内不再提供任何券的兑换入口。
//     守卫改为：端内 redeem 必须为空（防有人把「定制券」又加回包内，重新露出「付费定制」门面，
//     触发个人主体深度合成复审）。云函数 REDEEM 仍保留 comic_discount 等项，服务「H5 外迁」付费路径
//     与历史已发券用户，不强制与端内目录对齐（那部分权益走外部履约，不在包内闭环，由 test_points_daily 覆盖）。
t('去生成化后：端内 config.POINTS.redeem 刻意留空（不提供包内券兑换入口）', () => {
  const list = (config.POINTS && config.POINTS.redeem) || [];
  assert.strictEqual(list.length, 0,
    'config.POINTS.redeem 不为空 —— 去生成化重构后包内不应再提供任何券兑换入口（含「画面感内容 9 折券」），' +
    '否则会重新露出「付费定制内容」门面，触发个人主体深度合成复审。若确要恢复某券，请先重新过合规评估。');
});

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
process.exitCode = fail ? 1 : 0;
