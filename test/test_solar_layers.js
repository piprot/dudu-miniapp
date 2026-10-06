// test/test_solar_layers.js
// 节气页分层收起 + 每日一句并入应景文案（2026-10-06 新增）
//
// 用户需求：
//   ① 「把每个节气的文案，按层次收起来」→ 两级折叠：分组头 → 条目 → 文案
//   ② 「把东西方的节气都放进去」→ 24 节气 + 农历传统节日 + 西方节日
//   ③ 「阳历阴历都需要自动识别」→ 页头显示公历 + 农历 + 干支生肖
//   ④ 「今日文案优化到每日一句板块里去」→ 节气/节日应景并入 spark 页
//
// 本守卫锁四件事：分层默认收起、三组齐全、历法字段真的接上、应景已并入 spark。
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
// ⚠️ 必须排除调用处：`indexOf(name + '(')` 会先命中 `this.refreshToday()`，
//    导致提取到别的函数体（实测踩过：拿到的是 buildGroups 的内容）。
//    判据：形如 `name(args) {`（右括号后紧跟 {，允许换行）。
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
  // data 块以「}, cardStyle.defaults」收尾，缩进随文件而定，这里用宽松匹配
  const data = (js.match(/data:\s*Object\.assign\(\{([\s\S]*?)\n\s*\}, cardStyle\.defaults/) || ['', ''])[1];
  assert.ok(data.length > 0, '未能定位 solar.js 的 data 块（格式变了？）');
  assert.ok(/groups:\s*\[/.test(data), 'data 里没有 groups 字段');
  // 三个分组 key 必须都在 data 的初始值里声明（而不是只在 buildGroups 里）
  ['term', 'lunar', 'western'].forEach(k => {
    assert.ok(new RegExp("key:\\s*'" + k + "'").test(data), 'data.groups 缺分组 ' + k);
  });
  // 默认收起：初始值里每个 open 都得是 false
  const initOpen = (data.match(/key:\s*'\w+',\s*name:[^\n]*open:\s*(\w+)/g) || []);
  assert.ok(initOpen.length === 3, 'data 里应恰好 3 个分组，实际 ' + initOpen.length);
  initOpen.forEach(s => {
    assert.ok(/open:\s*false/.test(s), '分组默认必须是收起（渐进披露）：' + s);
  });
});

t('buildGroups 真实产出三组，且条目都带 kind 与日期标签', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  const body = funcBody(js, 'buildGroups');
  assert.ok(body, '找不到 buildGroups');
  const code = strip(body);
  ['term', 'lunar', 'western'].forEach(k => {
    assert.ok(new RegExp("key:\\s*'" + k + "'").test(code), 'buildGroups 缺分组 ' + k);
  });
  // 每组都必须 map 出 items，且条目带 kind（成卡与样式都依赖它）
  assert.ok(/items:\s*L\.LUNAR_FESTIVALS\.map/.test(code), '农历组未用 LUNAR_FESTIVALS');
  assert.ok(/items:\s*L\.WESTERN_FESTIVALS\.map/.test(code), '西方组未用 WESTERN_FESTIVALS');
  assert.ok(/items:\s*SOLAR_TERMS\.map/.test(code), '节气组未用 SOLAR_TERMS');
  // 农历组要显示真实农历日期（不是公历 month/day）
  assert.ok(/农历/.test(code), '农历组未标注「农历」字样，用户分不清阴阳历');
  // 除夕没有固定日期，必须显式补一条（它靠「腊月最后一天」判定，不在表里）
  assert.ok(/name:\s*'除夕'/.test(code), '农历组漏了除夕（腊月最后一天，非固定日期）');
});

t('今日概览接上真实历法：公历 + 农历 + 干支生肖 + 今日节日', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  const body = funcBody(js, 'refreshToday');
  assert.ok(body, '找不到 refreshToday');
  const code = strip(body);
  assert.ok(/L\.lunarFull\(/.test(code), '未调用 lunarFull 取农历');
  assert.ok(/L\.pickFestival\(/.test(code), '未调用 pickFestival 识别今日节日');
  assert.ok(/dateLabelOf\(/.test(code), '未接公历日期标签');
  // 四个字段都必须 setData，否则模板渲染空白且不报错
  ['todayLabel', 'lunarText', 'ganzhi', 'zodiac', 'festivalName'].forEach(f => {
    assert.ok(new RegExp('\\b' + f + ':').test(code), 'refreshToday 未 setData ' + f);
  });
  // data 里也得声明这四个字段
  const data = (js.match(/data:\s*Object\.assign\(\{([\s\S]*?)\n\s*\}, cardStyle\.defaults/) || ['', ''])[1];
  ['todayLabel', 'lunarText', 'ganzhi', 'zodiac', 'festivalName'].forEach(f => {
    assert.ok(new RegExp('\\b' + f + ':').test(data), 'data 未声明 ' + f);
  });
});

t('分层折叠的两个 handler 存在且只切换自身状态', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  const g = funcBody(js, 'onToggleGroup');
  const i = funcBody(js, 'onToggleItem');
  assert.ok(g, '缺少 onToggleGroup（展开/收起分组）');
  assert.ok(i, '缺少 onToggleItem（展开/收起条目文案）');
  // 分组切换：只翻自己的 open，用 map 生成新数组（不能直接改 this.data）
  assert.ok(/!g\.open/.test(strip(g)), 'onToggleGroup 未取反 open');
  assert.ok(/this\.setData\(\{\s*groups/.test(strip(g)), 'onToggleGroup 未整体 setData groups');
  // 条目切换：必须用 wx:for-item别名传key/name，不能依赖外层 item
  const wxml = rd(ROOT, 'pages', 'solar', 'solar.wxml');
  assert.ok(/wx:for-item="it"/.test(wxml), '条目循环未用 wx:for-item="it" 别名');
  assert.ok(/data-key="\{\{item\.key\}\}".*data-name="\{\{it\.name\}\}"/.test(wxml),
    'onToggleItem 的 dataset 传错：外层是 item、内层是 it，不能混用');
});

t('节气页 WXML：条目文案与「成卡」按钮都在折叠体内（默认不展开）', () => {
  const wxml = rd(ROOT, 'pages', 'solar', 'solar.wxml');
  // 文案与成卡按钮必须挂在 wx:if="{{it.open}}" 下，否则「收起」形同虚设
  const detail = wxml.match(/<view class="item-detail" wx:if="\{\{it\.open\}\}">([\s\S]*?)<\/view>\s*<\/view>/);
  assert.ok(detail, '找不到 item-detail 折叠体（条目文案未做二级收起）');
  assert.ok(has(detail[1], 'item-text'), '折叠体内缺文案');
  assert.ok(has(detail[1], 'onPickItem'), '折叠体内缺成卡按钮');
  // 分组体也必须受 open 控制
  assert.ok(/<view class="group-body" wx:if="\{\{item\.open\}\}">/.test(wxml),
    '分组体未受 open 控制（第一层收起失效）');
  // 旧的两段式 tab + 平铺列表必须已移除
  assert.ok(!has(wxml, 'switchTab'), '仍保留旧 tab 切换（应改为分组折叠）');
  assert.ok(!has(wxml, 'termList'), '仍保留旧 termList 平铺（应改为 groups 分层）');
  // 成卡按钮要明示扣费，避免用户误以为免费
  assert.ok(/-5 积分/.test(wxml), '成卡按钮未标明扣 5 积分');
});

t('历法模块异常不得拖垮节气页（try/catch 兜底）', () => {
  const js = rd(ROOT, 'pages', 'solar', 'solar.js');
  const body = funcBody(js, 'refreshToday');
  assert.ok(/try\s*\{/.test(strip(body)),
    'refreshToday 未 try/catch —— 历法模块一旦异常整页白屏');
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
  // onLoad 必须调用它，否则并入的文案不会显示
  const onLoad = funcBody(js, 'onLoad');
  assert.ok(/loadAlmanac\(\)/.test(strip(onLoad)), 'spark onLoad 未调用 loadAlmanac');
  // 模板要真的渲染出来
  ['almanacText', 'ganzhiZodiac', 'todayName', 'todayText'].forEach(f => {
    assert.ok(has(wxml, '{{' + f + '}}'), 'spark.wxml 未渲染 ' + f);
  });
});

t('每日一句主金句仍是唯一焦点（应景区不得抢戏）', () => {
  // 认知负荷里的「单一焦点」：一屏只有一个主角。
  // 判据：应景区在 DOM/样式上必须弱于主金句——用更小字号 + 浅底。
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
  // 白名单只有 .class/#id/element/分组/::after/::before。
  // @media / :not() / :nth-child 都会让整份编译挂掉（2026-09-22 踩过）。
  ['solar', 'spark'].forEach(p => {
    const css = rd(ROOT, 'pages', p, p + '.wxss');
    assert.ok(!/@media/.test(css), p + '.wxss 出现 @media，小程序不支持');
    assert.ok(!/:not\(/.test(css), p + '.wxss 出现 :not()，小程序不支持');
    assert.ok(!/:nth-child/.test(css), p + '.wxss 出现 :nth-child，小程序不支持');
  });
});

console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;