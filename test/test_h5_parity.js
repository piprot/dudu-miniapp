// H5（公众号版）与小程序端 / 服务端的**同规则守卫**（零依赖）
// ─────────────────────────────────────────────────────────────
// 背景：同一套「类型 / 字段 / 素材模板 / 字数策略」现在有三份副本 ——
//   · pages/gen/gen.js                 （小程序端展示 + 组装 prompt）
//   · cloudfunctions/ai_gen/index.js   （服务端权威，真正约束模型）
//   · h5/assets/kinds.js               （H5 端展示 + 组装 prompt）
// 微信云函数每个函数独立打包、不能可靠 require 前端代码，所以这三份注定是"被迫复制"。
// 人工同步迟早漏改，漏了的表现是**用户看得见的不一致**：
//   小程序显示"此类型篇幅参考 100-250 字"，网页端却给出 350 字，或者字段换了一套。
// 本测试把这类漂移挡在提交前。改任何一处后**必须跑**：node test/test_h5_parity.js
//
// 覆盖：
//   1-6  KINDS / KIND_STRUCT / FIELDS / DEFAULT_KIND / KIND_LEN_FIXED / OUT_LEN_TIERS
//   7    BUILD 素材模板 —— 用同一组输入实际执行两边，比对**输出字符串**（不是比源码文本）
//   8    ai_gen 的类型白名单与标签
//   9-10 H5 通道的服务端实现（日额度 / CORS / 不扣积分）
//   11-12 工程与合规守卫（h5 不进小程序包 / 页面上必须有 AI 标识）
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── 从源码里抠出 `const|var|let NAME = <字面量>;` 并求值 ──
// 括号平衡扫描而不是贪心正则：这些常量里有对象、数组、模板字符串（BUILD 的箭头函数），
// 用 `[\s\S]*?};` 这类正则会一路吞到文件里下一个 `};`，拼出语法垃圾。
function extractConst(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = new RegExp('(?:const|var|let)\\s+' + name + '\\s*=\\s*').exec(src);
  if (!m) throw new Error('在 ' + file + ' 中找不到 `' + name + ' = ...`（改名了就要同步改本测试）');
  const i = m.index + m[0].length;
  const pairs = { '{': '}', '[': ']' };
  const first = src[i];
  if (!pairs[first]) {
    // 基本字面量（字符串/数字）：读到行尾，剥掉注释与分号。
    // ⚠️ 必须先去掉行尾的 \r —— 本仓库是 CRLF，`$` 在非 multiline 下不认 \r，
    //    留着它会让下面的 `/\/\/.*$/` 整条不匹配，注释原样留在表达式里 → "Unexpected token ;"。
    const end = src.indexOf('\n', i);
    const line = src.slice(i, end < 0 ? src.length : end).replace(/[\r\n]+$/, '');
    const raw = line.replace(/\/\/.*$/, '').replace(/;\s*$/, '');
    return new Function('return (' + raw + ')')();
  }
  const close = pairs[first];
  let depth = 0, j = i, str = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (str) {
      if (c === '\\') { j++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '/' && src[j + 1] === '/') { const e = src.indexOf('\n', j); j = e < 0 ? src.length : e; continue; }
    if (c === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j); j = e < 0 ? src.length : e + 1; continue; }
    if (c === first) depth++;
    else if (c === close) { depth--; if (depth === 0) { j++; break; } }
  }
  return new Function('return (' + src.slice(i, j) + ')')();
}

const GEN = 'pages/gen/gen.js';
const AG = 'cloudfunctions/ai_gen/index.js';
const H5 = 'h5/assets/kinds.js';

const H5C = require(path.join(ROOT, H5));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
}

const GEN_KINDS = extractConst(GEN, 'KINDS');
const H5_KINDS = extractConst(H5, 'KINDS');

// ── 1) 类型清单：id 顺序必须一致（顺序会决定默认选中项与结果区引导）──
t('KINDS 的类型 id 与顺序三处一致', () => {
  const genIds = GEN_KINDS.map(k => k.id);
  const h5Ids = H5_KINDS.map(k => k.id);
  assert.deepStrictEqual(h5Ids, genIds,
    'h5/assets/kinds.js 的 KINDS 与 pages/gen/gen.js 不一致:\n  gen: ' + genIds.join(',') + '\n  h5 : ' + h5Ids.join(','));
  const agKinds = extractConst(AG, 'MOMENTS_KINDS');
  assert.deepStrictEqual(agKinds.slice(), genIds,
    'cloudfunctions/ai_gen 的 MOMENTS_KINDS 与前端类型清单不一致:\n  ai_gen: ' + agKinds.join(',') + '\n  gen   : ' + genIds.join(','));
  assert.strictEqual(agKinds.length, genIds.length, '类型数量不一致');
});

// ── 2) 类型展示文案（label 会出现在结果与引导里，两端措辞不同会显得像两个产品）──
t('KINDS 的 label / icon / desc 三处一致', () => {
  const h5 = H5C.KINDS.map(k => ({ id: k.id, icon: k.icon, label: k.label, desc: k.desc }));
  const gen = GEN_KINDS.map(k => ({ id: k.id, icon: k.icon, label: k.label, desc: k.desc }));
  assert.deepStrictEqual(h5, gen, 'KINDS 的展示字段不一致（h5 vs gen）');
});

// ── 3) 结构暗示文案 ──
t('KIND_STRUCT 五类结构提示一致', () => {
  assert.deepStrictEqual(extractConst(H5, 'KIND_STRUCT'), extractConst(GEN, 'KIND_STRUCT'));
});

// ── 4) 引导字段：key / type / required 必须完全一致 ──
//     漏改的后果最直接：网页端问的问题和小程序不一样，同一段素材两边生成的结构对不上。
t('FIELDS 的字段定义一致（key / type / required / 顺序）', () => {
  const gen = extractConst(GEN, 'FIELDS');
  const h5 = extractConst(H5, 'FIELDS');
  assert.deepStrictEqual(Object.keys(h5).sort(), Object.keys(gen).sort(), 'FIELDS 的类型集合不一致');
  Object.keys(gen).forEach(k => {
    const strip = list => (list || []).map(f => ({ key: f.key, type: f.type, required: !!f.required }));
    assert.deepStrictEqual(strip(h5[k]), strip(gen[k]),
      '类型 "' + k + '" 的字段定义不一致（h5 vs gen）:\n  h5 : ' + JSON.stringify(strip(h5[k])) + '\n  gen: ' + JSON.stringify(strip(gen[k])));
  });
});

// ── 5) 默认类型 ──
t('DEFAULT_KIND 一致且存在于类型清单', () => {
  const gen = extractConst(GEN, 'DEFAULT_KIND');
  const h5 = extractConst(H5, 'DEFAULT_KIND');
  assert.strictEqual(h5, gen, 'DEFAULT_KIND 不一致: h5=' + h5 + ' gen=' + gen);
  assert.ok(GEN_KINDS.some(k => k.id === gen), 'DEFAULT_KIND "' + gen + '" 不在 KINDS 里');
});

// ── 6) 字数策略：固定区间 + story 档位 + 下限 ──
//     这是最容易被"顺手调一下"改漂的地方：三处不一致会直接表现为
//     「界面提示 100-250 字，模型实际写 400 字」。
t('KIND_LEN_FIXED / OUT_LEN_TIERS / OUT_LEN_FLOOR 三处一致', () => {
  assert.deepStrictEqual(extractConst(H5, 'KIND_LEN_FIXED'), extractConst(GEN, 'KIND_LEN_FIXED'), 'KIND_LEN_FIXED 不一致（h5 vs gen）');
  assert.deepStrictEqual(extractConst(H5, 'KIND_LEN_FIXED'), extractConst(AG, 'KIND_LEN_FIXED'), 'KIND_LEN_FIXED 不一致（h5 vs ai_gen）');
  assert.deepStrictEqual(extractConst(H5, 'OUT_LEN_TIERS'), extractConst(GEN, 'OUT_LEN_TIERS'), 'OUT_LEN_TIERS 不一致（h5 vs gen）');
  assert.deepStrictEqual(extractConst(H5, 'OUT_LEN_TIERS'), extractConst(AG, 'OUT_LEN_TIERS'), 'OUT_LEN_TIERS 不一致（h5 vs ai_gen）');
  assert.strictEqual(extractConst(H5, 'OUT_LEN_FLOOR'), extractConst(GEN, 'OUT_LEN_FLOOR'), 'OUT_LEN_FLOOR 不一致（h5 vs gen）');
  assert.strictEqual(extractConst(H5, 'OUT_LEN_FLOOR'), extractConst(AG, 'OUT_LEN_FLOOR'), 'OUT_LEN_FLOOR 不一致（h5 vs ai_gen）');
  // 服务端"用户要求更长"的加长区间也必须 > 基准上限，否则"更长"反而变短
  const long = extractConst(AG, 'KIND_LEN_FIXED_LONG');
  const base = extractConst(AG, 'KIND_LEN_FIXED');
  Object.keys(base).forEach(k => {
    if (!long[k]) return;
    assert.ok(long[k][1] > base[k][1], '类型 "' + k + '" 的加长上限 ' + long[k][1] + ' 未大于基准上限 ' + base[k][1] + '，"更长"会写出更短的结果');
  });
});

// ── 7) 素材模板：不看源码文本，**实际执行**两边再比输出 ──
//     两边写法不同（gen 用箭头函数 + 模板字符串、h5 用 function + 拼接），
//     比源码必然误报；比"同一组输入产出的字符串"才反映用户真实拿到的差异。
t('BUILD 素材模板：同输入产出同文本（5 类 × 2 组样例）', () => {
  const genBuild = extractConst(GEN, 'BUILD');
  const h5Build = extractConst(H5, 'BUILD');
  const samples = [
    { identity: 'A', audience: 'B', scene: 'C', point: 'D', choice: 'E', reason: 'F', cost: 'G',
      product: 'H', signal: 'I', evidence: 'J', action: 'K', moment: 'L', feeling: 'M', meaning: 'N',
      timePlace: 'O', person: 'P', turn: 'Q', lookback: 'R' },
    { identity: '做知识付费的独立创作者', audience: '想做个人品牌的新手', scene: '最近很多人问我怎么开始',
      point: '开始比完美重要', choice: '辞掉稳定工作', reason: '不想再等', cost: '收入不稳',
      product: '21 天简历精修陪跑', signal: '秋招马上开始', evidence: '8 人拿到面试', action: '回复「陪跑」',
      moment: '江边散步', feeling: '风很轻', meaning: '给自己一点喘息',
      timePlace: '高三那年冬天', person: '我和外婆', turn: '她记不起我的名字', lookback: '那是最慢的告别' }
  ];
  GEN_KINDS.forEach(k => {
    samples.forEach((f, i) => {
      const a = String((genBuild[k.id] || function () { return ''; })(f) || '');
      const b = String((h5Build[k.id] || function () { return ''; })(f) || '');
      assert.strictEqual(b, a,
        '类型 "' + k.id + '" 第 ' + (i + 1) + ' 组样例的素材文本不一致（h5 vs gen）:\n  h5 : ' + JSON.stringify(b) + '\n  gen: ' + JSON.stringify(a));
    });
  });
});

// ── 8) 服务端类型标签：白名单键集合必须与标签一一对应 ──
t('ai_gen 的 MOMENTS_KIND_LABEL 覆盖全部类型且无多余项', () => {
  const label = extractConst(AG, 'MOMENTS_KIND_LABEL');
  const kinds = extractConst(AG, 'MOMENTS_KINDS');
  assert.deepStrictEqual(Object.keys(label).sort(), kinds.slice().sort(),
    'MOMENTS_KIND_LABEL 的键与 MOMENTS_KINDS 不匹配（新增类型忘了补标签 → 模型收到 undefined）');
});

// ── 9) H5 通道的服务端实现（源码级，防被"顺手删掉"）──
t('ai_gen 保留 H5 通道：日额度 / 独立集合 / 失败退还', () => {
  const src = fs.readFileSync(path.join(ROOT, AG), 'utf8');
  assert.ok(/const\s+H5_FREE_DAILY\s*=\s*\d+/.test(src), '缺少 H5_FREE_DAILY 日额度常量');
  assert.ok(/H5_COLLECTION\s*=\s*'h5_usage'/.test(src), '缺少 h5_usage 集合名');
  assert.ok(/function\s+parseH5Event/.test(src), '缺少 parseH5Event（HTTP 事件归一化）');
  assert.ok(/function\s+takeH5Quota/.test(src), '缺少 takeH5Quota（额度扣减）');
  assert.ok(/function\s+releaseH5Quota/.test(src), '缺少 releaseH5Quota（生成失败应退还额度）');
  assert.ok(/Access-Control-Allow-Origin/.test(src), '缺少 CORS 头（H5 跨域读不到响应体）');
  // H5 通道走额度、小程序走积分：两条分支都要在
  assert.ok(/if\s*\(isH5\)\s*\{[\s\S]{0,400}?takeH5Quota/.test(src), 'H5 通道没有接上额度扣减');
  assert.ok(/else\s*\{[\s\S]{0,200}?chargePoints/.test(src), '小程序通道的积分扣减被破坏');
});

// ── 10) H5 通道不能碰积分：额度扣减分支里不得出现 chargePoints ──
t('H5 通道不扣积分（不误伤 vp_users.points）', () => {
  const src = fs.readFileSync(path.join(ROOT, AG), 'utf8');
  const m = /if\s*\(isH5\)\s*\{([\s\S]*?)\n  \} else \{/.exec(src);
  assert.ok(m, '找不到 H5 / 小程序两条计费分支（结构变了就要同步改本测试）');
  assert.ok(!/chargePoints/.test(m[1]), 'H5 分支里出现了 chargePoints —— 网页端不该扣用户积分');
  assert.ok(!/awardPoints/.test(m[1]), 'H5 分支里出现了 awardPoints —— 网页端不该发放积分');
});

// ── 11) 工程守卫：h5 目录必须被排除在小程序上传包之外 ──
//     漏配的后果：assets/*.js 随包上传，白撑包体（小程序主包上限 2MB）。
t('project.config.json 把 h5 排除出小程序包', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
  const ig = (cfg.packOptions && cfg.packOptions.ignore) || [];
  assert.ok(ig.some(x => x && x.value === 'h5'),
    'packOptions.ignore 里没有 h5 规则 —— h5/assets/*.js 会被打进小程序上传包。请补 { value: "h5", type: "folder" }');
});

// ── 12) 合规守卫：H5 页面必须有 AI 生成标识 + 第三方处理披露 ──
//     依据《人工智能生成合成内容标识办法》（2025-09-01 施行）：提供文本生成合成服务的，
//     应当在生成合成内容的适当位置添加提示标识。页面换载体不豁免这项义务。
t('h5/index.html 含 AI 标识与第三方处理披露', () => {
  const html = fs.readFileSync(path.join(ROOT, 'h5', 'index.html'), 'utf8');
  assert.ok(/AI\s*生成/.test(html), '页面上找不到「AI 生成」提示标识（法定要求，不可删）');
  assert.ok(/第三方/.test(html) && /AI\s*模型|模型服务/.test(html), '缺少「输入会转交第三方 AI 服务」的披露');
  assert.ok(/免责|自行核实|核对/.test(html), '缺少免责与核实提示');
  assert.ok(/隐私|设备标识|匿名/.test(html), '缺少数据使用说明（设备标识仅用于次数限制）');
});

// ── 13) 前端额度展示以服务端为准：前端不得自行计算剩余次数 ──
//     前端若能自行加减额度，改一行 JS 就能绕过限制；真正的判定必须在服务端。
t('h5 前端只展示服务端回传的 quota，不自行计算', () => {
  const js = fs.readFileSync(path.join(ROOT, 'h5', 'assets', 'app.js'), 'utf8');
  assert.ok(/res\.quota/.test(js) || /typeof\s+res\.quota/.test(js), '前端没有读取服务端回传的 quota');
  assert.ok(!/H5_FREE_DAILY/.test(js), '前端里出现了 H5_FREE_DAILY —— 额度规则只能有一份（服务端），前端碰不到才改不动');
});

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
process.exitCode = fail ? 1 : 0;
