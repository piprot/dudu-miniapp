// H5 页面链路验证（jsdom 跑真实脚本，不是"看源码猜行为"）
// 运行：NODE_PATH="<node workspace>/node_modules" node tools_local/_h5_dom_test.js
// 为什么值得单独写：截图只能证明"画出来了"，证明不了"点了有没有反应"。
// 这里真的点按钮、真的输入、真的拦 fetch，检查发出去的 payload 与渲染出来的 DOM。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const H5 = path.join(ROOT, 'h5');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP  jsdom 未安装（本机 node workspace 应已自带）'); process.exit(0); }

let pass = 0, fail = 0;
const QUEUE = [];
function t(name, fn) { QUEUE.push([name, fn]); }
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(msg + '（实际 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b) + '）');
}

(async function () {
  const html = fs.readFileSync(path.join(H5, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;

  // jsdom 没实现 scrollIntoView；app.js 生成成功后会调用它
  w.Element.prototype.scrollIntoView = function () {};

  // 拦 fetch：记录每次请求，返回可编排的结果
  const calls = [];
  let nextResult = { ok: true, options: ['一', '二', '三'], quota: { used: 1, limit: 5, left: 4 } };
  w.fetch = function (url, init) {
    calls.push({ url: url, payload: JSON.parse(init.body) });
    return Promise.resolve({ text: function () { return Promise.resolve(JSON.stringify(nextResult)); } });
  };

  // 拦剪贴板（navigator 上的属性是 getter，用 defineProperty 才盖得住）
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: function (s) { copied.push(s); return Promise.resolve(); },
      readText: function () { return Promise.resolve('https://mp.weixin.qq.com/s/abc'); }
    }
  });

  // 等 DOM ready 再手动注入页面脚本（不开 resources，避免外部脚本的异步时序不可控）
  await new Promise(function (r) { setTimeout(r, 30); });
  w.eval(fs.readFileSync(path.join(H5, 'assets', 'kinds.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(H5, 'assets', 'app.js'), 'utf8'));
  await new Promise(function (r) { setTimeout(r, 30); });

  const d = w.document;
  const $ = function (s) { return d.querySelector(s); };
  const $$ = function (s) { return Array.prototype.slice.call(d.querySelectorAll(s)); };
  const tick = function () { return new Promise(function (r) { setTimeout(r, 30); }); };
  const fire = function (elm, type) { elm.dispatchEvent(new w.Event(type, { bubbles: true })); };
  const setInput = function (sel, val) { var e = $(sel); e.value = val; fire(e, 'input'); };
  const setResult = function (r) { nextResult = r; };

  // ══ 1) 初始渲染 ══
  t('初始渲染：5 个类型 chip + 1 个「粘贴文章链接」入口', function () {
    eq($$('.kind-chip').length, 6, 'kind-chip 数量不对');
    eq($$('.kind-chip.link').length, 1, '缺少链接入口');
  });

  t('初始渲染：默认选中「价值型」，字段为 value 的 4 项', function () {
    ok($$('.kind-chip')[0].className.indexOf('on') >= 0, '第一个 chip 没有选中态');
    eq($$('#fields .field').length, 4, 'value 类型应有 4 个字段');
    eq($('#selKind').textContent, '价值型', '已选横幅文案不对');
  });

  t('初始渲染：素材为空时生成按钮为禁用态', function () {
    ok($('#btnGen').disabled === true, '空素材时按钮不该可点');
    eq($('#writeArea').hidden, false, 'writeArea 应可见');
    eq($('#urlArea').hidden, true, 'urlArea 初始应隐藏');
  });

  // ══ 2) 输入 → 按钮点亮 + 字数联动 ══
  t('输入字段后：按钮点亮、字数与预计输出同步更新', function () {
    setInput('#fld_identity', '做知识付费的独立创作者');
    eq($('#lenNum').textContent, '11', '已填字数未跟随输入');
    ok($('#btnGen').disabled === false, '有素材后按钮仍禁用');
    eq($('#outLen').textContent, '100-250', '预计输出字数应按类型定长');
  });

  // ══ 3) 切类型 → 字段结构跟着换 + 旧表单清空 ══
  t('切换到「成交型」：字段换成 5 项且旧输入被清空（防止串味）', function () {
    $$('.kind-chip')[2].click();
    eq($$('#fields .field').length, 5, 'deal 类型应有 5 个字段');
    eq($('#selKind').textContent, '成交型', '已选横幅没跟着换');
    eq($('#fld_identity').value, '', '切类型后旧表单值应清空');
    ok($('#btnGen').disabled === true, '清空后按钮应回到禁用态');
    eq($('#outLen').textContent, '150-320', 'deal 的固定区间应为 150-320');
  });

  // ══ 4) 切到「粘贴文章链接」模式 ══
  t('点「粘贴文章链接」：切到 url 模式，写素材区收起', function () {
    $('.kind-chip.link').click();
    eq($('#writeArea').hidden, true, 'url 模式下应隐藏写素材区');
    eq($('#urlArea').hidden, false, 'url 模式下应显示链接区');
    eq($$('.tone-chip').length, 5, '调性 chip 应有 5 个');
  });

  // ══ 5) 生成：payload 契约 ══
  t('生成请求：payload 带 channel=h5 / deviceId / kind / url', async function () {
    setInput('#urlInput', 'https://mp.weixin.qq.com/s/abc');
    ok($('#btnGen').disabled === false, '填了链接后按钮应可点');
    $('#btnGen').click();
    await tick();
    eq(calls.length, 1, '应发出 1 次请求');
    const p = calls[0].payload;
    eq(p.channel, 'h5', 'channel 必须是 h5（服务端据此走额度而非积分）');
    eq(p.kind, 'deal', 'kind 应与所选调性一致');
    eq(p.url, 'https://mp.weixin.qq.com/s/abc', 'url 未带上');
    ok(typeof p.deviceId === 'string' && p.deviceId.length > 5, '缺少 deviceId');
    ok(p.feedback === undefined, '首次生成不该带 feedback');
  });

  // ══ 6) 结果渲染 + 额度回填 ══
  t('生成成功：渲染 3 条、结果区展开、额度按服务端回传更新', async function () {
    await tick();
    eq($('#resultCard').hidden, false, '结果区应展开');
    eq($$('#moments .moment').length, 3, '应有 3 条结果');
    ok($$('#moments .moment')[0].className.indexOf('on') >= 0, '第一条应默认选中');
    eq($('#quotaNum').textContent, '4 / 5', '额度未按服务端回传更新');
  });

  // ══ 7) 选中切换 ══
  t('点第 2 条：选中态转移，且只有一条处于选中', function () {
    $$('#moments .moment')[1].click();
    eq($$('#moments .moment.on').length, 1, '选中态应唯一');
    ok($$('#moments .moment')[1].className.indexOf('on') >= 0, '第 2 条未选中');
  });

  // ══ 8) 复制走的是选中那条 ══
  t('复制选中的文案：写进剪贴板的是第 2 条', async function () {
    await tick();
    $('#btnCopyOne').click();
    await tick();
    eq(copied.length, 1, '应调用一次剪贴板');
    eq(copied[0], '二', '复制的不是当前选中的那条');
  });

  // ══ 9) 换一批：payload 带 feedback + previous ══
  t('换一批：payload 带 feedback 与上一版 3 条', async function () {
    setInput('#feedbackInput', '再来三个不同的角度');
    $('#btnRevise').click();
    await tick();
    eq(calls.length, 2, '应发出第 2 次请求');
    const p = calls[1].payload;
    eq(p.feedback, '再来三个不同的角度', 'feedback 未带上');
    eq(p.previous.length, 3, 'previous 应为上一版 3 条');
    eq(p.channel, 'h5', 'channel 丢失');
  });

  // ══ 10) 安全：模型输出必须按纯文本渲染 ══
  t('安全：模型返回的 HTML 片段被当纯文本渲染（无标签注入）', async function () {
    await tick();
    setResult({ ok: true, options: ['<img src=x onerror=alert(1)>', '正常文案', '<b>粗体</b>'], quota: { used: 2, limit: 5, left: 3 } });
    $('#btnGen').click();
    await tick(); await tick();
    eq($$('#moments img').length, 0, '文案里的 <img> 被解析成了真实元素 —— 存在注入风险');
    eq($$('#moments b').length, 0, '文案里的 <b> 被解析成了真实元素');
    eq($$('#moments .moment-text')[0].textContent, '<img src=x onerror=alert(1)>', '文案未按原文纯文本显示');
    eq($('#quotaNum').textContent, '3 / 5', '额度未更新');
  });

  // ══ 11) 额度耗尽 ══
  t('额度用尽：显示服务端错误文案，不静默失败', async function () {
    setResult({ ok: false, channel: 'h5', err: '今天的免费次数已用完（5 次/天）。想要更多，请到小程序里用积分继续生成。', quota: { used: 5, limit: 5, left: 0 } });
    $('#btnGen').click();
    await tick(); await tick();
    eq($('#errBox').hidden, false, '错误框应显示');
    ok($('#errBox').textContent.indexOf('免费次数已用完') >= 0, '错误文案未透出');
    eq($('#quotaNum').textContent, '0 / 5', '额度应显示 0');
  });

  // ══ 12) 防折叠零宽空格原样保留 ══
  t('防折叠：文案里的 U+200B 原样保留到剪贴板', async function () {
    setResult({ ok: true, options: ['朋\u200b友\u200b圈', 'B', 'C'], quota: { used: 3, limit: 5, left: 2 } });
    $('#btnGen').click();
    await tick(); await tick();
    copied.length = 0;
    $$('#moments .moment')[0].click();
    $('#btnCopyOne').click();
    await tick();
    eq(copied[0], '朋\u200b友\u200b圈', '零宽空格被丢掉了 —— 复制到朋友圈会立刻出现「全文」折叠');
  });

  // ══ 13) 合规区块 ══
  t('合规：页面有 AI 标识、免责令牌与第三方处理披露', function () {
    eq($('.ai-badge').textContent, 'AI 生成', '缺少 AI 标识徽标');
    ok(/第三方/.test(d.body.textContent), '缺少第三方 AI 处理披露');
    ok($('details.notice') !== null, '缺少使用说明折叠区');
  });

  // ══ 14) 深链参数（公众号不同入口给不同默认值）══
  t('深链：?k=story 预选类型、?mode=url 预置模式', async function () {
    const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/?k=story&mode=url&note=%E5%86%99%E9%95%BF%E7%82%B9' });
    dom2.window.Element.prototype.scrollIntoView = function () {};
    await new Promise(function (r) { setTimeout(r, 30); });
    dom2.window.eval(fs.readFileSync(path.join(H5, 'assets', 'kinds.js'), 'utf8'));
    dom2.window.eval(fs.readFileSync(path.join(H5, 'assets', 'app.js'), 'utf8'));
    await new Promise(function (r) { setTimeout(r, 30); });
    const d2 = dom2.window.document;
    eq(d2.querySelector('#urlArea').hidden, false, '?mode=url 未生效');
    eq(d2.querySelector('#selKind').textContent, '我的故事', '?k=story 未生效');
    eq(d2.querySelector('#noteInput').value, '写长点', '?note 未回填');
    dom2.window.close();
  });

  // ══ 顺序执行（测试之间有状态依赖，必须串行）══
  for (const [name, fn] of QUEUE) {
    try { await fn(); console.log('PASS  ' + name); pass++; }
    catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
  }

  console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
  w.close();
  process.exitCode = fail ? 1 : 0;
})().catch(function (e) {
  console.log('BOOT FAIL: ' + ((e && e.stack) || e));
  process.exitCode = 1;
});
