// test/test_card_config_wiring.js
// card-config 组件化接线守卫（2026-10-06 新增）
//
// 背景：本轮把四页（天气/金句/节气/台词）各自的出图设置区抽成 components/card-config。
// 组件化本身没改业务逻辑，但引入了一类**静默失效**的 bug——
// 事件从「页面 WXML 直绑」变成「组件 triggerEvent 上抛」后，参数来源从
//   e.currentTarget.dataset.id
// 变成
//   e.detail.id
// 若handler 只读前者，点主题/风格会**没有任何反应也不报错**（详见
// skills/html-to-wechat-mp 把它列为小程序移植最高频断点）。
//
// 本文件锁三件事：
//   ① 四页都注册了 card-config，且 WXML 真的引用了它（防「注册了但没用」/「用了但没注册」）
//   ② 组件上抛的每个事件，页面都接了对应 handler，且 handler 真存在于页面 js
//   ③ 所有吃事件参数的 handler 都兼容 e.detail（不能只读 currentTarget.dataset）
//   ④ 渐进披露没被回退：配置区默认收起，且折叠头在页面主流程（预览/生成）之后
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PAGES = ['weather', 'quotes', 'solar', 'line'];
const CC_DIR = path.join(ROOT, 'components', 'card-config');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const rd = (...a) => fs.readFileSync(path.join(...a), 'utf8');
const has = (s, sub) => s.indexOf(sub) >= 0;

// 组件上抛的事件名 → 必须兼容 e.detail 的页面 handler 名（多数同名）
const EVENTS = {
  style: 'onPickStyle',
  builtin: 'onPickBuiltinBg',
  album: 'onPickAlbumBg',
  clearphoto: 'onClearPhoto',
  shufflephoto: 'onShufflePhoto',
  cyclemode: 'onCyclePhotoMode',
  theme: 'onPickTheme'
};

t('card-config 组件四件齐全', () => {
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok(fs.existsSync(path.join(CC_DIR, 'index.' + ext)), '缺 index.' + ext);
  }
  assert.ok(has(rd(CC_DIR, 'index.json'), '"component": true'),
    'index.json 未声明 component: true');
});

t('组件必须 addGlobalClass，否则页面 app.wxss 的类进不来', () => {
  // 不加这个，组件内view 的默认样式（字号/颜色）会被隔离，视觉上整块字号突变
  assert.ok(/addGlobalClass\s*:\s*true/.test(rd(CC_DIR, 'index.js')),
    '未开 addGlobalClass，组件样式会被隔离');
});

t('组件不得 setData 父级传入的 property（状态来源会互相打架）', () => {
  // 与 add-mine 同一个坑：组件把父级的 prop 写回，两边都以为自己是真相源。
  // 正则要匹配对象内**任意位置**的键，只匹配第一个键会假绿（add-mine 踩过）。
  const src = rd(CC_DIR, 'index.js');
  const bad = src.match(/setData\(\{[^}]*\b(styleKey|theme|bgSource|bgPhotoId|localBg)\s*:/g);
  assert.ok(!bad, '组件 setData 了父级 property：' + (bad || []).join(' / '));
});

t('折叠状态只存组件内部 open，不反射到 properties', () => {
  const src = rd(CC_DIR, 'index.js');
  // open 是布尔量，data 里写作 `open: false`；properties 里不能有它。
  const propsBlock = (src.match(/properties:\s*\{([\s\S]*?)\n {2}\},/) || ['', ''])[1];
  assert.ok(!/\bopen\s*:/.test(propsBlock),
    'open 被声明成 property，展开态就有两个来源（组件 + 父页面）');
  const dataBlock = (src.match(/data:\s*\{([\s\S]*?)\n {2}\},/) || ['', ''])[1];
  assert.ok(/\bopen\s*:\s*(false|true|\{\s*value)/.test(dataBlock),
    'data 里找不到内部展开态 open（判据可能随实现漂移失效）');
  // defaultOpen 决定首屏；四页都是「先出图」，所以默认必须 false（收起）
  assert.ok(/defaultOpen\s*:\s*\{\s*type\s*:\s*Boolean,\s*value\s*:\s*false\s*\}/.test(src),
    'defaultOpen 默认应为 false（渐进披露：先出图，调样式次要）');
});

t('组件 WXSS 不得用小程序不支持的选择器', () => {
  // WXSS 选择器白名单只有 .class / #id / element / 分组 / ::after / ::before。
  // @media / :not() / :nth-child 都会让整份编译挂掉（2026-09-22 踩过）。
  const css = rd(CC_DIR, 'index.wxss');
  assert.ok(!/@media/.test(css), 'WXSS 里出现 @media，小程序不支持');
  assert.ok(!/:not\(/.test(css), 'WXSS 里出现 :not()，小程序不支持');
  assert.ok(!/:nth-child/.test(css), 'WXSS 里出现 :nth-child，小程序不支持');
});

t('组件用到的 CSS 变量必须在 app.wxss 里有定义', () => {
  // 变量未定义 → 该属性静默失效（颜色继承父级或透明），不报错。
  const css = rd(CC_DIR, 'index.wxss');
  const app = rd(ROOT, 'app.wxss');
  const used = new Set();
  let m;
  const re = /var\(\s*(--[a-z0-9-]+)/gi;
  while ((m = re.exec(css))) used.add(m[1]);
  assert.ok(used.size > 0, '组件没用到任何 CSS 变量（判据可能失效）');
  const missing = [...used].filter(v => app.indexOf(v + ':') < 0);
  assert.strictEqual(missing.length, 0,
    'app.wxss 未定义：' + missing.join(' / '));
});

t('组件上抛的事件都能在页面找到对应 handler', () => {
  const ccjs = rd(CC_DIR, 'index.js');
  const fired = [...ccjs.matchAll(/triggerEvent\(\s*'([a-z]+)'/g)].map(x => x[1]);
  assert.ok(fired.length >= 7, '组件只上抛了 ' + fired.length + ' 个事件（应 ≥7）');
  // 多数 handler 由 card_style_mixin 注入，页面 js 里本来就没有；
  // 所以「handler 存在」必须在 mixin ∪ 页面 里查，不能只看页面。
  const mixin = rd(ROOT, 'utils', 'card_style_mixin.js');
  for (const p of PAGES) {
    const wxml = rd(ROOT, 'pages', p, p + '.wxml');
    const js = rd(ROOT, 'pages', p, p + '.js');
    assert.ok(/card_style_mixin/.test(js), p + '.js 未引入 card_style_mixin');
    assert.ok(/cardStyle\.cardStyleMethods/.test(js), p + '.js 未注入 mixin 方法');
    for (const ev of fired) {
      if (ev === 'toggle') continue; // 纯 UI 状态，无业务动作
      const h = EVENTS[ev];
      assert.ok(h, '组件上抛了未知事件 ' + ev + '，请在 EVENTS 里补映射');
      assert.ok(new RegExp('bind:' + ev + '="' + h + '"').test(wxml),
        p + '.wxml 未绑定 bind:' + ev + '="' + h + '"');
      const inPage = js.indexOf(h + '(') >= 0;
      const inMixin = mixin.indexOf(h + '(') >= 0;
      assert.ok(inPage || inMixin, h + ' 在页面与 mixin 里都不存在，事件会打空');
    }
  }
});

// 剥掉注释再判断代码。
// 踩过的坑（负向验证抓出来的）：守卫原本直接对函数体 grep 'e.detail'，结果
// handler 里只要留一句「兼容 e.detail.id」的注释就能过关——把真代码改回只读
// currentTarget 也照样绿灯。注释不是代码，判据必须先把 // 与 /* */ 剥干净。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// 提取 `name(...) { ... }` 的函数体（按花括号配对，不用固定字数窗口——
// 注释一长窗口就飘了，这正是本轮调试踩的坑）。
function funcBody(src, name) {
  const at = src.indexOf(name + '(');
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

t('吃事件参数的 handler 必须兼容 e.detail，不能只读 currentTarget', () => {
  // 核心守卫。组件上抛的参数在 e.detail；只读 e.currentTarget.dataset 会静默拿到
  // undefined，点主题/风格毫无反应且控制台无报错。
  for (const p of PAGES) {
    const js = rd(ROOT, 'pages', p, p + '.js');
    const mixin = rd(ROOT, 'utils', 'card_style_mixin.js');
    // 页面自己写的 onPickTheme 必须兼容（判据只看代码，不看注释）
    const body = funcBody(js, 'onPickTheme');
    assert.ok(body !== null, p + '.js 找不到 onPickTheme 函数体');
    const code = stripComments(body);
    assert.ok(/e\.detail/.test(code),
      p + '.js onPickTheme 只读 currentTarget，主题点击会静默失效');
    // 有detail 兜底还不够——若同时留着裸 dataset 直读，说明主路径仍可能取空
    assert.ok(!/=\s*e\.currentTarget\.dataset\.id\s*;/.test(code),
      p + '.js onPickTheme 仍有裸 dataset 直读，未做 detail 兼容');
    // mixin 里的 onPickStyle / onPickBuiltinBg 必须走 pickVal
    for (const h of ['onPickStyle', 'onPickBuiltinBg']) {
      const b = funcBody(mixin, h);
      assert.ok(b !== null, 'card_style_mixin 找不到 ' + h);
      assert.ok(/pickVal\(/.test(stripComments(b)),
        'mixin ' + h + ' 未走 pickVal，风格/背景点击会静默失效');
    }
  }
});

t('mixin 的 pickVal 必须 detail 优先、dataset 兜底', () => {
  const src = rd(ROOT, 'utils', 'card_style_mixin.js');
  const m = src.match(/function pickVal\(([^)]*)\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, '找不到 pickVal 定义');
  const body = m[2];
  const dAt = body.indexOf('e.detail');
  const tAt = body.indexOf('e.currentTarget');
  assert.ok(dAt >= 0, 'pickVal 未读 e.detail');
  assert.ok(tAt >= 0, 'pickVal 未做 currentTarget 兜底（页面直绑会失效）');
  assert.ok(dAt < tAt, 'pickVal 必须 detail 优先于 currentTarget');
});

t('四页都注册了 card-config 且 WXML 真的引用了', () => {
  for (const p of PAGES) {
    const json = rd(ROOT, 'pages', p, p + '.json');
    assert.ok(/card-config/.test(json), p + '.json 未注册 card-config');
    const wxml = rd(ROOT, 'pages', p, p + '.wxml');
    assert.ok(/<card-config\b/.test(wxml), p + '.wxml 未引用 <card-config>');
  }
});

t('渐进披露：配置区默认收起，且排在主流程（预览/生成）之后', () => {
  // 认知负荷 8 项里「渐进披露」和「单一焦点」是本轮要修的两项。
  // 判据：card-config 出现位置必须在「生成」按钮和预览块之后，否则用户改完配置
  // 还要往上翻才见提交键——这正是天气页原来的问题。
  for (const p of PAGES) {
    const wxml = rd(ROOT, 'pages', p, p + '.wxml');
    const ccAt = wxml.indexOf('<card-config');
    assert.ok(ccAt > 0, p + '.wxml 未引用 card-config');
    assert.ok(!/default-open/.test(wxml),
      p + '.wxml 显式开了 default-open，首屏会展开一整块配置，违背渐进披露');
    // 主流程锚点：各页按钮文案/handler 不同（onGen / onMakeCard / onMakeTodayCard），
    // 预览容器统一是 canvas-wrap。只认onGen 会让另外三页假红。
    const anchors = ['bindtap="onGen"', 'bindtap="onMakeCard"',
      'bindtap="onMakeTodayCard"', 'class="canvas-wrap"', 'class="card-preview"'];
    const genAt = Math.max.apply(null, anchors.map(a => wxml.indexOf(a)));
    assert.ok(genAt >= 0, p + '.wxml 找不到生成按钮或预览容器（判据可能漂移）');
    assert.ok(genAt < ccAt,
      p + '.wxml 把出图设置排在主流程之前，用户要翻回底部才见预览/生成');
  }
});

t('四页不再各自抄一份背景图控件（重复实现已收敛到组件）', () => {
  // 组件化的核心收益是消重。组件里必须有控件，页面里必须没有——两头都要查，
  // 只查一头会出现「控件在组件里，页面还留着一份死代码」。
  const cc = rd(CC_DIR, 'index.wxml');
  assert.ok(has(cc, 'class="bg-scroll"'), 'card-config 里没有背景图横向滚动区');
  for (const p of PAGES) {
    const wxml = rd(ROOT, 'pages', p, p + '.wxml');
    assert.ok(!has(wxml, 'class="bg-scroll"'),
      p + '.wxml 仍留有背景图控件副本，应删掉只留 <card-config>');
    assert.ok(!/bindtap="onPickBuiltinBg"/.test(wxml),
      p + '.wxml 仍直绑背景图控件（与组件重复）');
  }
});

console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;