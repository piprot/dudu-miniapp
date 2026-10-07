// test/test_solar_layers.js
// 节气页分层收起 + 每日一句并入应景文案（2026-10-06 新增 / 2026-10-06 修订）
//
// 用户需求：
//   ① 「把每个节气的文案，按层次收起来」→ 两级折叠：分组头 → 条目 → 文案
//   ② 「把东西方的节气都放进去」→ 24 节气 + 农历传统节日 + 西方节日
//   ③ 「阳历阴历都需要自动识别」→ 页头显示公历 + 农历 + 干支生肖
//   ④ 「今日文案优化到每日一句板块里去」→ 节气/节日应景并入 spark 页
//   ⑤ 「每个内置库至少 100 条」→ 节气×5=120 / 农历×5=105 / 西方×5=130 条文案
//
// 守卫重点（修订后）：
//   - buildGroups 委托纯函数 utils/solar_browse，每组 ≥100 条文案、uid 唯一、纯中文
//   - calendar_mix 必须导出 lunarMonthName/lunarDayName（否则 solar.js 调用抛错 → 整页 0 条）
//   - 农历/西方节日表已扩充到可支撑 100+ 条的规模
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const rd = (...a) => fs.readFileSync(path.join(...a), 'utf8');
const has = (s, sub) => s.indexOf(sub) >= 0;

// 剥注释，避免「注释里写了 xxx」让判据假绿（card-config 守卫踩过这个坑）
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
// 提取函数**定义**的函数体（花括号配对）。
function funcBody(src, name) {
  const re = new RegExp('(?:^|[\\s,;{])' + name + '\\s*\\([^)]*\\)\\s*\\{', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(open + 1, i); }
  }
  return null;
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}

t('节气页数据里三组齐全（节气 / 农历节日 / 西方节日），且默认全部收起', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  const data = (js.match(/data:\s*Object\.assign\(\{([\s\S]*?)\n\s*\}, cardStyle\.defaults/) || ['', ''])[1];
  assert.ok(data.length > 0, '未能定位 solar.js 的 data 块（格式变了？）');
  assert.ok(/groups:\s*\[/.test(data), 'data 里没有 groups 字段');
  ['term', 'lunar', 'western'].forEach(k => {
    assert.ok(new RegExp("key:\\s*'" + k + "'").test(data), 'data.groups 缺分组 ' + k);
  });
  const initOpen = (data.match(/key:\s*'\w+',\s*name:[^\n]*open:\s*(\w+)/g) || []);
  assert.ok(initOpen.length === 3, 'data 里应恰好 3 个分组，实际 ' + initOpen.length);
  initOpen.forEach(s => {
    assert.ok(/open:\s*false/.test(s), '分组默认必须是收起（渐进披露）：' + s);
  });
});

t('buildGroups 委托 solar_browse，每组 ≥100 条文案（纯中文、uid 唯一）', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  // solar.js 必须委托给纯函数模块，避免守卫测试重复实现扁平化逻辑
  assert.ok(/utils\/solar_browse'/.test(js), 'buildGroups 未委托 utils/solar_browse（扁平化逻辑应抽到纯函数）');
  assert.ok(/buildGroups\(\)/.test(js), 'solar.js 未调用 solar_browse.buildGroups()');

  // 运行时直接验证产物（不重复实现扁平化）
  const { buildGroups } = require(path.join(ROOT, 'utils', 'solar_browse.js'));
  const groups = buildGroups();
  assert.strictEqual(groups.length, 3, '应恰好 3 个分组');
  const need = { term: 100, lunar: 100, western: 100 };
  const seenUid = new Set();
  for (const g of groups) {
    assert.ok(g.items.length >= need[g.key],
      `分组 ${g.key} 仅 ${g.items.length} 条，未达 100+（需求：每个内置至少 100 条）`);
    for (const it of g.items) {
      assert.ok(it.uid && it.name && it.text && it.preview && it.tag && it.kind,
        '条目缺字段: ' + JSON.stringify(it));
      assert.ok(!seenUid.has(it.uid), 'uid 重复: ' + it.uid);
      seenUid.add(it.uid);
      assert.ok(it.text.length >= 18 && it.text.length <= 48, `文案长度越界(${it.text.length}): ${it.text}`);
      assert.ok(/[一-鿿]/.test(it.text), '文案非中文: ' + it.text);
      assert.ok(!/[A-Za-z0-9]/.test(it.text), '文案含英文/数字: ' + it.text);
    }
  }
});

t('每组默认只渲染 48 条（库里仍是 100+ 条），并带「展开更多」看全部', () => {
  const { buildGroups, DEFAULT_LIMIT } = require(path.join(ROOT, 'utils', 'solar_browse.js'));
  assert.strictEqual(DEFAULT_LIMIT, 48, 'DEFAULT_LIMIT 应为 48（用户要求每组显示 48 条）');
  const groups = buildGroups();
  for (const g of groups) {
    assert.strictEqual(g.limit, 48, `分组 ${g.key} 默认 limit 应为 48，实际 ${g.limit}`);
    assert.ok(g.items.length > g.limit,
      `分组 ${g.key} 数据仅 ${g.items.length} 条，未超过 48，「展开更多」就没有意义`);
  }
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  assert.ok(/onShowMore/.test(js), '缺少 onShowMore（点「展开更多」应放开渲染上限）');
  const wxml = rd(ROOT, 'pages', 'solar', 'solar.wxml');
  assert.ok(/wx:for-index="idx"/.test(wxml), '条目循环未用 wx:for-index="idx"（无法按 limit 截断）');
  assert.ok(/wx:if="\{\{idx < item\.limit\}\}"/.test(wxml),
    '条目未按 limit 截断渲染（会一次性铺开 100+ 条，滚动成本过高）');
  assert.ok(/onShowMore/.test(wxml), 'wxml 缺「展开更多」入口');
});

t('今日概览接上真实历法：公历 + 农历 + 干支生肖 + 今日节日', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  const body = funcBody(js, 'refreshToday');
  assert.ok(body, '找不到 refreshToday');
  const code = strip(body);
  assert.ok(/L\.lunarFull\(/.test(code), '未调用 lunarFull 取农历');
  assert.ok(/L\.pickFestival\(/.test(code), '未调用 pickFestival 识别今日节日');
  assert.ok(/dateLabelOf\(/.test(code), '未接公历日期标签');
  ['todayLabel', 'lunarText', 'ganzhi', 'zodiac', 'festivalName'].forEach(f => {
    assert.ok(new RegExp('\\b' + f + ':').test(code), 'refreshToday 未 setData ' + f);
  });
  const data = (js.match(/data:\s*Object\.assign\(\{([\s\S]*?)\n\s*\}, cardStyle\.defaults/) || ['', ''])[1];
  ['todayLabel', 'lunarText', 'ganzhi', 'zodiac', 'festivalName'].forEach(f => {
    assert.ok(new RegExp('\\b' + f + ':').test(data), 'data 未声明 ' + f);
  });
});

t('分层折叠的两个 handler 存在，条目用 uid 唯一定位', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  const g = funcBody(js, 'onToggleGroup');
  const i = funcBody(js, 'onToggleItem');
  assert.ok(g, '缺少 onToggleGroup（展开/收起分组）');
  assert.ok(i, '缺少 onToggleItem（展开/收起条目文案）');
  assert.ok(/!g\.open/.test(strip(g)), 'onToggleGroup 未取反 open');
  assert.ok(/this\.setData\(\{\s*groups/.test(strip(g)), 'onToggleGroup 未整体 setData groups');
  // 条目切换必须靠 uid 唯一定位（同一节日挂 5 条文案，name 会重复）
  assert.ok(/dataset\.uid/.test(strip(i)), 'onToggleItem 未用 dataset.uid 唯一定位（name 重复会误触多条）');
  const wxml = rd(ROOT, 'pages', 'solar', 'solar.wxml');
  assert.ok(/wx:for-item="it"/.test(wxml), '条目循环未用 wx:for-item="it" 别名');
  assert.ok(/data-key="\{\{item\.key\}\}".*data-uid="\{\{it\.uid\}\}"/.test(wxml),
    'onToggleItem 的 dataset 应为 data-uid（item.key 外层、it.uid 内层，不能混用 name）');
});

t('节气页 WXML：条目文案与「成卡」按钮都在折叠体内（默认不展开）', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  const wxml = rd(ROOT, 'pages', 'solar', 'solar.wxml');
  const detail = wxml.match(/<view class="item-detail" wx:if="\{\{it\.open\}\}">([\s\S]*?)<\/view>\s*<\/view>/);
  assert.ok(detail, '找不到 item-detail 折叠体（条目文案未做二级收起）');
  assert.ok(has(detail[1], 'item-text'), '折叠体内缺文案');
  assert.ok(has(detail[1], 'onPickItem'), '折叠体内缺成卡按钮');
  // 折叠态应展示 preview（前 18 字）+ tag，避免一屏塞满全文
  assert.ok(/\{\{it\.preview\}\}/.test(wxml), '条目折叠态未展示 preview（应预览前 18 字）');
  assert.ok(/wx:key="uid"/.test(wxml), '条目循环 wx:key 未改为 uid（name 重复会导致 wx:key 冲突告警）');
  // 分组体也必须受 open 控制
  assert.ok(/<view class="group-body" wx:if="\{\{item\.open\}\}">/.test(wxml),
    '分组体未受 open 控制（第一层收起失效）');
  // 旧的两段式 tab + 平铺列表必须已移除
  assert.ok(!has(wxml, 'switchTab'), '仍保留旧 tab 切换（应改为分组折叠）');
  assert.ok(!has(wxml, 'termList'), '仍保留旧 termList 平铺（应改为 groups 分层）');
  // 成卡按钮要明示扣费，避免用户误以为免费。
  // 2026-10-07：改为动态取价 {{cardCost}}（与 card/poster 页一致），改价只需改 config，
  // 断言也从写死「-8」改为「成卡按钮必须引用 cardCost」。
  assert.ok(/成卡（{{cardCost}} 积分）/.test(wxml), '成卡按钮未标明扣费（应引用 cardCost 动态显示单价）');
  assert.ok(/cardCost:\s*0/.test(js), 'data 未声明 cardCost（按钮取不到单价会显示空白）');
});

t('历法模块异常不得拖垮节气页（try/catch 兜底）', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  const body = funcBody(js, 'refreshToday');
  assert.ok(/try\s*\{/.test(strip(body)),
    'refreshToday 未 try/catch —— 历法模块一旦异常整页白屏');
});

t('历法模块已导出 lunarMonthName/lunarDayName（修复「0 条」崩溃根因）', () => {
  const L = require(path.join(ROOT, 'utils', 'calendar_mix.js'));
  assert.strictEqual(typeof L.lunarMonthName, 'function',
    'calendar_mix 未导出 lunarMonthName（solar.js 调用会抛「is not a function」→ 整页 0 条）');
  assert.strictEqual(typeof L.lunarDayName, 'function',
    'calendar_mix 未导出 lunarDayName（农历日期标签会崩）');
  assert.strictEqual(L.lunarMonthName(1, false), '正月', 'lunarMonthName(1,false) 应为「正月」');
  assert.strictEqual(L.lunarDayName(1), '初一', 'lunarDayName(1) 应为「初一」');
});

t('农历/西方节日表已扩充到可支撑 100+ 条的规模', () => {
  const L = require(path.join(ROOT, 'utils', 'calendar_mix.js'));
  assert.ok(L.LUNAR_FESTIVALS.length >= 20,
    'LUNAR_FESTIVALS 仅 ' + L.LUNAR_FESTIVALS.length + ' 条（需 ≥20 才能 ×5 ≥100）');
  assert.ok(L.WESTERN_FESTIVALS.length >= 26,
    'WESTERN_FESTIVALS 仅 ' + L.WESTERN_FESTIVALS.length + ' 条（需 ≥26 才能 ×5 ≥130）');
  // 每个节日都要能取到 5 条纯中文文案
  const LINES_LUNAR = require(path.join(ROOT, 'utils', 'lines_lunar.js'));
  const LINES_WESTERN = require(path.join(ROOT, 'utils', 'lines_western.js'));
  for (const f of L.LUNAR_FESTIVALS) {
    assert.ok(LINES_LUNAR[f.name] && LINES_LUNAR[f.name].length === 5, '农历节日缺 5 条文案：' + f.name);
  }
  for (const f of L.WESTERN_FESTIVALS) {
    assert.ok(LINES_WESTERN[f.name] && LINES_WESTERN[f.name].length === 5, '西方节日缺 5 条文案：' + f.name);
  }
});

t('三个文案库内容合规：纯中文、18-48字、无重复、无英文/数字', () => {
  const libs = ['lines_terms', 'lines_lunar', 'lines_western'];
  for (const lib of libs) {
    const m = require(path.join(ROOT, 'utils', lib + '.js'));
    const all = Object.values(m).flat();
    const seen = new Set();
    for (const line of all) {
      assert.ok(line.length >= 18 && line.length <= 48, `${lib} 长度越界(${line.length}): ${line}`);
      assert.ok(/[一-鿿]/.test(line), `${lib} 非中文: ${line}`);
      assert.ok(!/[A-Za-z0-9]/.test(line), `${lib} 含英文/数字: ${line}`);
      assert.ok(!seen.has(line), `${lib} 重复: ${line}`);
      seen.add(line);
    }
  }
});

t('每日一句已并入今日应景（农历 + 干支 + 节气/节日文案）', () => {
  const js = rd(ROOT, 'pages', 'spark', 'spark.js');
  const wxml = rd(ROOT, 'pages', 'spark', 'spark.wxml');
  const data = (js.match(/data:\s*\{([\s\S]*?)\n {2}\},/) || ['', ''])[1];
  ['almanacText', 'ganzhiZodiac', 'todayName', 'todayText'].forEach(f => {
    assert.ok(new RegExp('\\b' + f + ':').test(data), 'spark data 未声明 ' + f);
  });
  const body = funcBody(js, 'loadAlmanac');
  assert.ok(body, 'spark 缺少 loadAlmanac（应景文案未并入）');
  const code = strip(body);
  assert.ok(/lunarFull\(/.test(code), 'loadAlmanac 未取农历');
  assert.ok(/pickFestival\(/.test(code), 'loadAlmanac 未识别节日');
  assert.ok(/pickForToday\(/.test(code), 'loadAlmanac 未取节气文案');
  assert.ok(/try\s*\{/.test(code), 'loadAlmanac 未 try/catch —— 每日一句主功能会被历法异常拖垮');
  const onLoad = funcBody(js, 'onLoad');
  assert.ok(/loadAlmanac\(\)/.test(strip(onLoad)), 'spark onLoad 未调用 loadAlmanac');
  ['almanacText', 'ganzhiZodiac', 'todayName', 'todayText'].forEach(f => {
    assert.ok(has(wxml, '{{' + f + '}}'), 'spark.wxml 未渲染 ' + f);
  });
});

t('每日一句主金句仍是唯一焦点（应景区不得抢戏）', () => {
  const wxml = rd(ROOT, 'pages', 'spark', 'spark.wxml');
  const at = wxml.indexOf('class="almanac"');
  const qAt = wxml.indexOf('class="quote-card"');
  assert.ok(qAt >= 0 && at > qAt, '应景区应排在主金句卡片之后');
  const css = rd(ROOT, 'pages', 'spark', 'spark.wxss');
  const qSize = (css.match(/\.q-text\s*\{[^}]*font-size:\s*(\d+)rpx/) || [])[1];
  const fSize = (css.match(/\.fest-text\s*\{[^}]*font-size:\s*(\d+)rpx/) || [])[1];
  assert.ok(qSize && fSize, '取不到字号（q-text/fest-text 样式缺失）');
  assert.ok(Number(fSize) < Number(qSize),
    '应景文案字号(' + fSize + ')必须小于主金句(' + qSize + ')，否则喧宾夺主');
});

t('新样式里的 CSS 变量都必须在 app.wxss 有定义', () => {
  const app = rd(ROOT, 'app.wxss');
  ['solar', 'spark'].forEach(p => {
    const css = rd(ROOT, 'pages', p, p + '.wxss');
    const used = new Set();
    let m; const re = /var\(\s*(--[a-z0-9-]+)/gi;
    while ((m = re.exec(css))) used.add(m[1]);
    assert.ok(used.size > 0, p + '.wxss 没用到任何变量（判据可能失效）');
    const missing = [...used].filter(v => !has(app, v + ':'));
    assert.strictEqual(missing.length, 0, p + '.wxss 用了未定义变量：' + missing.join(' '));
  });
});

t('WXSS 不得用小程序不支持的选择器', () => {
  ['solar', 'spark'].forEach(p => {
    const css = rd(ROOT, 'pages', p, p + '.wxss');
    assert.ok(!/@media/.test(css), p + '.wxss 出现 @media，小程序不支持');
    assert.ok(!/:not\(/.test(css), p + '.wxss 出现 :not()，小程序不支持');
    assert.ok(!/:nth-child/.test(css), p + '.wxss 出现 :nth-child，小程序不支持');
  });
});

console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
