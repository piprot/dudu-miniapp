// ai_gen 云函数本地单测（零依赖 · 纯 Node 断言）
// 做法：Stub 掉 wx-server-sdk（云数据库/云存储）与 https/http（Ark API、文章抓取），
//      然后直接调用 exports.main，验证「积分服务端记账 + 多模态输入」的真实行为。
//
// 运行：
//   node test/test_ai_gen_units.js
// 期望：全部 PASS，退出码 0。
const assert = require('assert');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

// ───────────────────────── 1. 云数据库 / 云存储 Stub ─────────────────────────
const store = {};       // openid -> { points, coupons, unlockedAll }
let downloadFileCalls = [];
let lastDownloadFileID = '';

function applyInc(doc, data) {
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (v && typeof v === 'object' && typeof v.$inc === 'number') {
      doc[k] = (typeof doc[k] === 'number' ? doc[k] : 0) + v.$inc;
    } else {
      doc[k] = v;
    }
  });
}

function makeCollection(name) {
  return {
    doc(id) {
      return {
        get: async () => {
          if (!store[id]) throw new Error('document does not exist');
          return { data: Object.assign({}, store[id]) };
        },
        set: async ({ data }) => { store[id] = Object.assign({}, data); return { stats: {} }; },
        update: async ({ data }) => {
          if (!store[id]) throw new Error('document does not exist');
          applyInc(store[id], data);
          return { stats: { updated: 1 } };
        }
      };
    },
    where(cond) {
      return {
        update: async ({ data }) => {
          const id = cond._id;
          const min = cond.points && typeof cond.points.$gte === 'number' ? cond.points.$gte : -Infinity;
          if (store[id] && typeof store[id].points === 'number' && store[id].points >= min) {
            applyInc(store[id], data);
            return { stats: { updated: 1 } };
          }
          return { stats: { updated: 0 } };
        }
      };
    }
  };
}

// H5 通道（HTTP 访问服务）的用例需要「没有 openid」的上下文 —— 云函数正是靠这一点
// 与小程序调用区分开。做成可切换变量，默认仍是小程序身份，不影响既有用例。
let currentOpenid = 'openid-test';

const cloudStub = {
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  init: () => {},
  getWXContext: () => ({ OPENID: currentOpenid }),
  database: () => ({
    collection: makeCollection,
    command: {
      inc: (n) => ({ $inc: n }),
      gte: (n) => ({ $gte: n })
    },
    serverDate: () => new Date().toISOString()
  }),
  downloadFile: async ({ fileID }) => {
    downloadFileCalls.push(fileID);
    lastDownloadFileID = fileID;
    // 伪造一个 PNG 头，验证 mime 嗅探
    const buf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    return { fileContent: buf };
  }
};

// ───────────────────────── 2. https / http Stub ─────────────────────────
let capturedPosts = [];   // { path, body }
let lastGetUrl = '';
let getResponder = null;  // (url) => { statusCode, body, headers }

function makeRes(statusCode, body, headers) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = headers || {};
  res.setEncoding = () => {};
  res.resume = () => {};
  res.destroy = () => {};
  process.nextTick(() => {
    if (body) res.emit('data', body);
    res.emit('end');
    res.emit('close');
  });
  return res;
}

function makeRequest(getResponder) {
  return function request(opts, cb) {
    const req = new EventEmitter();
    let written = '';
    req.write = (c) => { written += c; };
    req.destroy = (e) => { if (e) req.emit('error', e); };
    req.setTimeout = () => {};
    req.end = () => {
      const p = opts.path || '';
      if (opts.method === 'POST') {
        capturedPosts.push({ path: p, body: written });
        const payload = JSON.parse(written || '{}');
        const isResponses = /\/responses$/.test(p);
        const content = 'MOCK_OUTPUT_FOR_' + (payload.model || '');
        if (isResponses) {
          cb(makeRes(200, JSON.stringify({ output_text: content })));
        } else {
          cb(makeRes(200, JSON.stringify({ choices: [{ message: { content } }] })));
        }
      } else {
        lastGetUrl = (opts.hostname || '') + p;
        const r = getResponder ? getResponder('https://' + lastGetUrl) : { statusCode: 200, body: '' };
        cb(makeRes(r.statusCode, r.body, r.headers));
      }
    };
    return req;
  };
}

const fakeHttps = { request: makeRequest(() => getResponder()) };
const fakeHttp = { request: makeRequest(() => getResponder()) };

// ───────────────────────── 3. 注入 Stub（必须在 require ai_gen 之前）──────────
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloudStub;
  if (request === 'https') return fakeHttps;
  if (request === 'http') return fakeHttp;
  return origLoad.apply(this, arguments);
};

process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'ep-test';
process.env.LLM_BASE_URL = 'https://ark.example.com/api/v3';

// 2026-09-30：ai_gen 源码已移出小程序仓库 → h5_backend/ai_gen（H5 专用后端）。
// 2026-10-06：不再硬编码 ../../h5_backend（clone 位置一变就 MODULE_NOT_FOUND 假红），
//   改用 test/h5_backend_path.js 统一探测（支持 H5_BACKEND_DIR 环境变量 + 多候选目录）。
const { requireAiGen, warnIfMissing } = require('./h5_backend_path');
const SKIP = warnIfMissing('test_ai_gen_units');
const aiGen = SKIP ? null : requireAiGen();

// ───────────────────────── 4. 用例 ─────────────────────────
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
}
function reset(openid, points) {
  Object.keys(store).forEach(k => delete store[k]);
  if (openid) store[openid] = { openid, points, coupons: [], unlockedAll: false };
  currentOpenid = 'openid-test';   // 默认回到小程序身份；H5 用例自己显式置空
  capturedPosts = [];
  downloadFileCalls = [];
}

(async () => {
  // 1) mode 契约：**只支持 moments**。
  //    2026-09-19 用户拍板：「生成画面感内容脚本」这一步整体移除 —— 画面感内容只能走付费定制
  //    （pages/commission → ¥66/¥88 下单 → 人工绘制），脚本是履约时的内部工作稿。
  //    因此显式传 comic 必须**明确报错**，且绝不能扣分或调模型：
  //    若静默降级成 moments，调用方会以为拿到了脚本、实际拿到朋友圈文案 —— 比报错危险得多。
  reset('openid-test', 50);
  await t('mode=comic → 明确报错（该路径已移除），不扣分、不调模型', async () => {
    const r = await aiGen.main({ mode: 'comic', prompt: '一只猫在窗台上晒太阳' });
    assert.strictEqual(r.ok, false, 'ok 应为 false，实际: ' + JSON.stringify(r));
    assert.ok(/不支持的 mode: comic/.test(r.err), '应明确提示 mode 不支持，实际: ' + r.err);
    assert.strictEqual(store['openid-test'].points, 50, '被拒时绝不能扣分，实际 ' + store['openid-test'].points);
    assert.strictEqual(capturedPosts.length, 0, '被拒时不应调用模型');
  });
  await t('不传 mode（缺省）→ 按 moments 处理（唯一产出，缺省取最宽容）', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ prompt: '今天爬山' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.mode, 'moments');
    assert.strictEqual(r.cost, 8);
    assert.strictEqual(store['openid-test'].points, 42, '应扣 8（50→42），实际 ' + store['openid-test'].points);
  });

  // 2) moments 余额不足：扣费失败，返回 积分不足 且不加分
  reset('openid-test', 5);
  await t('moments 余额不足 → ok:false 积分不足（余额保持 5，不调模型）', async () => {
    const r = await aiGen.main({ mode: 'moments', prompt: '今天爬山' });
    assert.strictEqual(r.ok, false, '应失败');
    assert.strictEqual(r.err, '积分不足');
    assert.strictEqual(r.points, 5, '应返回当前余额 5，实际 ' + r.points);
    assert.strictEqual(r.need, 8);
    assert.strictEqual(store['openid-test'].points, 5, 'DB 余额不应变');
    assert.strictEqual(capturedPosts.length, 0, '余额不足不应调用模型');
  });

  // 3) moments 余额充足：扣 20，返回余额
  reset('openid-test', 50);
  await t('moments 余额充足 → 扣 20（50→30）且返回扣后余额', async () => {
    const r = await aiGen.main({ mode: 'moments', prompt: '今天爬山' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.cost, 8);
    assert.strictEqual(r.points, 42, '应返回扣后余额 42，实际 ' + r.points);
    assert.strictEqual(store['openid-test'].points, 42, 'DB 余额应为 42');
    assert.ok(Array.isArray(r.options) && r.options.length >= 1, 'options 应为数组');
  });

  // 4) moments 模型失败 → 退回积分（余额不变）
  reset('openid-test', 50);
  await t('moments 模型两次都失败 → 自动退回积分（余额仍 50）', async () => {
    const orig = fakeHttps.request;
    fakeHttps.request = makeRequestFailing();
    try {
      const r = await aiGen.main({ mode: 'moments', prompt: '测试失败退回' });
      assert.strictEqual(r.ok, false, '应失败');
      assert.strictEqual(store['openid-test'].points, 50, '失败后余额应退回为 50，实际 ' + store['openid-test'].points);
    } finally { fakeHttps.request = orig; }
  });

  // 4b) 2026-09-20：单次请求**超时** → 不再降级重试。
  //     原因：两次叠加会把总耗时顶到云函数 60s 上限被强杀 ⇒ refund() 来不及执行 ⇒ 用户丢分。
  reset('openid-test', 50);
  await t('模型首次请求超时 → 不重试（只调 1 次）且退回积分', async () => {
    const orig = fakeHttps.request;
    fakeHttps.request = makeRequestTimeout();
    try {
      const r = await aiGen.main({ mode: 'moments', prompt: '测试超时' });
      assert.strictEqual(r.ok, false, '应失败');
      assert.strictEqual(timeoutAttempts, 1, '超时不应再重试第 2 次，实际调用 ' + timeoutAttempts + ' 次');
      assert.strictEqual(store['openid-test'].points, 50, '超时后余额应退回为 50，实际 ' + store['openid-test'].points);
    } finally { fakeHttps.request = orig; }
  });

  // 4c) 反向守卫：非超时的失败（500 / 返回为空）**仍要**降级重试一次，
  //     否则等于把「Responses 端点不可用 → 回退 chat/completions」这条可用性通道一起关掉了。
  reset('openid-test', 50);
  await t('非超时失败 → 仍降级重试（共 2 次）且退回积分', async () => {
    const orig = fakeHttps.request;
    let attempts = 0;
    fakeHttps.request = function (opts, cb) {
      const req = new EventEmitter();
      req.write = () => {};
      req.destroy = e => { if (e) req.emit('error', e); };
      req.setTimeout = () => {};
      req.end = () => { attempts++; cb(makeRes(500, JSON.stringify({ error: 'boom' }))); };
      return req;
    };
    try {
      const r = await aiGen.main({ mode: 'moments', prompt: '测试失败重试' });
      assert.strictEqual(r.ok, false, '应失败');
      assert.strictEqual(attempts, 2, '非超时失败应降级重试，实际调用 ' + attempts + ' 次');
      assert.strictEqual(store['openid-test'].points, 50, '余额应退回为 50，实际 ' + store['openid-test'].points);
    } finally { fakeHttps.request = orig; }
  });

  // 5) 文章链接：抓正文（js_content）并拼进 prompt（moments 扣 20，余额给足）
  reset('openid-test', 50);
  await t('url 输入 → 抓取 js_content 正文并注入模型输入', async () => {
    getResponder = () => ({
      statusCode: 200,
      headers: {},
      body: '<html><head><title>测试标题</title></head><body><div class="rich_media"><div id="js_content"><p>第一段内容</p><p>第二段&nbsp;内容</p></div></div><div id="js_pc_qr_code">扫码关注广告</div></body></html>'
    });
    const r = await aiGen.main({ mode: 'moments', prompt: '我的补充', url: 'https://mp.weixin.qq.com/s/abc' });
    getResponder = null;
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const sent = JSON.parse(capturedPosts[0].body);
    const userMsg = sent.input[1].content;
    assert.ok(userMsg.indexOf('第一段内容') >= 0, '应含抓到的正文，实际: ' + userMsg.slice(0, 200));
    assert.ok(userMsg.indexOf('测试标题') >= 0, '应含来源标题');
    assert.ok(userMsg.indexOf('我的补充') >= 0, '应含用户补充文字');
    assert.ok(userMsg.indexOf('扫码关注广告') < 0, 'js_content 之后的页面噪声不应混入，实际: ' + userMsg.slice(0, 200));
  });

  // 6) 非法链接：内网地址被拦
  await t('url 内网地址 → 被 SSRF 守卫拦截', async () => {
    const r = await aiGen.main({ mode: 'moments', url: 'http://127.0.0.1/admin' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.err, '该链接不可访问');
  });

  // 7) 图片输入：多模态 content 结构正确（moments 扣 20，余额给足）
  reset('openid-test', 50);
  await t('imageFileId → 下载图片并构造多模态 input_image', async () => {
    const r = await aiGen.main({ mode: 'moments', prompt: '看图写故事', imageFileId: 'cloud://env.test/a.jpg' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(downloadFileCalls, ['cloud://env.test/a.jpg']);
    const sent = JSON.parse(capturedPosts[0].body);
    const parts = sent.input[1].content;
    assert.ok(Array.isArray(parts), '带图应使用数组 content');
    assert.strictEqual(parts[0].type, 'input_text');
    assert.strictEqual(parts[1].type, 'input_image');
    assert.ok(/^data:image\/png;base64,/.test(parts[1].image_url), 'mime 嗅探应为 png，实际 ' + String(parts[1].image_url).slice(0, 30));
  });

  // 8) 纯图无文字 → 补默认指令；三者全空 → 报错（moments 扣 20，余额给足）
  reset('openid-test', 50);
  await t('纯图片（无文字）→ 补默认指令，不报错', async () => {
    const r = await aiGen.main({ mode: 'moments', imageFileId: 'cloud://env.test/b.png' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const parts = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(parts[0].text && parts[0].text.length > 0, '应有默认指令文字');
  });
  await t('三者全空 → 明确报错', async () => {
    const r = await aiGen.main({ mode: 'moments' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.err, '请输入文字、上传图片或粘贴文章链接');
  });

  // 9) Responses 不可用 → 自动回退 chat/completions（moments 扣 20，余额给足）
  reset('openid-test', 50);
  await t('Responses 报错 → 自动回退 chat/completions 并成功', async () => {
    const orig = fakeHttps.request;
    let n = 0;
    fakeHttps.request = function (opts, cb) {
      const req = new EventEmitter();
      let written = '';
      req.write = c => { written += c; };
      req.destroy = e => { if (e) req.emit('error', e); };
      req.setTimeout = () => {};
      req.end = () => {
        n++;
        if (/\/responses$/.test(opts.path)) {
          cb(makeRes(404, JSON.stringify({ error: 'not found' })));
        } else {
          capturedPosts.push({ path: opts.path, body: written });
          cb(makeRes(200, JSON.stringify({ choices: [{ message: { content: 'FALLBACK_OK' } }] })));
        }
      };
      return req;
    };
    try {
      const r = await aiGen.main({ mode: 'moments', prompt: '回退测试' });
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      // 回退路径拿到的是裸文本（无【N】分隔），parseMoments 会把它整条作为唯一一条
      assert.strictEqual(r.options[0], 'FALLBACK_OK');
      assert.strictEqual(n, 2, '应请求两次（responses 失败 + chat 成功）');
    } finally { fakeHttps.request = orig; }
  });

  // 10) 超长输入拦截（服务端硬上限 6000 字；前端 textarea 自身限 2000）
  await t('超长文本（>6000）→ 明确报错', async () => {
    const r = await aiGen.main({ mode: 'moments', prompt: 'x'.repeat(6001) });
    assert.strictEqual(r.ok, false);
    assert.ok(/内容过长/.test(r.err), '应提示内容过长，实际: ' + r.err);
  });

  // ── 换一批（带修改意见重生成 3 条，15 积分）──
  await t('moments + feedback → 只扣 15（非 20），revised=true', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ mode: 'moments', prompt: '今天爬了山', feedback: '太文艺了，要更口语' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.cost, 6, '换一批应扣 6，实际 ' + r.cost);
    assert.strictEqual(r.revised, true);
    assert.strictEqual(r.points, 44, '余额应 50-6=44，实际 ' + r.points);
    assert.strictEqual(store['openid-test'].points, 44);
  });

  await t('moments 无 feedback → 仍按首次档扣 20，revised=false', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ mode: 'moments', prompt: '今天爬了山' });
    assert.strictEqual(r.cost, 8, '首次应扣 8，实际 ' + r.cost);
    assert.strictEqual(r.revised, false);
    assert.strictEqual(store['openid-test'].points, 42);
  });

  await t('feedback 为空白串 → 视为首次（不可用它把价格压到 15）', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ mode: 'moments', prompt: 'x', feedback: '   ' });
    assert.strictEqual(r.cost, 8, '空白 feedback 不应走 6 档，实际 ' + r.cost);
  });

  await t('换一批：修改意见与上一版文案都注入模型输入', async () => {
    reset('openid-test', 50);
    await aiGen.main({
      mode: 'moments', prompt: '今天爬了山',
      feedback: '要有具体场景，别像广告',
      previous: ['上一版A', '上一版B', '上一版C']
    });
    const sent = JSON.parse(capturedPosts[0].body);
    const userMsg = sent.input[1].content;
    assert.ok(userMsg.indexOf('要有具体场景，别像广告') >= 0, '应含修改意见');
    assert.ok(userMsg.indexOf('上一版A') >= 0 && userMsg.indexOf('上一版C') >= 0, '应含上一版文案');
    assert.ok(userMsg.indexOf('明显不同') >= 0, '应要求与上一版不同');
    assert.ok(sent.input[0].content === undefined || typeof sent.input[0].content === 'string',
      '系统提示词应保持字符串（缓存前缀稳定）');
  });

  await t('换一批余额不足（5 < 6）→ 明确返回 need:6 且不扣分', async () => {
    reset('openid-test', 5);
    const r = await aiGen.main({ mode: 'moments', prompt: 'x', feedback: '改一下' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.err, '积分不足');
    assert.strictEqual(r.need, 6, '应提示需要 6，实际 ' + r.need);
    assert.strictEqual(store['openid-test'].points, 5, '不应扣分');
    assert.strictEqual(capturedPosts.length, 0, '余额不足不应调模型');
  });

  await t('换一批模型失败 → 退回 6（余额不变）', async () => {
    reset('openid-test', 40);
    const orig = fakeHttps.request;
    fakeHttps.request = makeRequestFailing();
    try {
      const r = await aiGen.main({ mode: 'moments', prompt: 'x', feedback: '改一下' });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(store['openid-test'].points, 40, '失败应退回 6，实际 ' + store['openid-test'].points);
    } finally { fakeHttps.request = orig; }
  });

  await t('换一批：纯 feedback（无正文/图片）也放行，不再报"请输入内容"', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ mode: 'moments', feedback: '换个轻松点的说法', previous: ['a'] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.cost, 6);
  });

  await t('超长 feedback 被截断到 300 字（避免把请求撑爆）', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: 'x', feedback: '★'.repeat(500) });
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    const count = (userMsg.match(/★/g) || []).length;
    assert.strictEqual(count, 300, '修改意见应被截断到 300 字，实际 ' + count);
  });

  // ── 类型路由（2026-09-18 晚升级：五类型框架）──
  // 契约：kind 打进**用户消息**（不打进系统提示词，以保显式前缀缓存命中）；
  //       系统提示词必须逐字节固定 —— 用两次不同 kind 请求的字节比对来钉死这一点。
  await t('kind=story → 用户消息带「叙事型」声明，且返回 kind=story', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ mode: 'moments', prompt: '那年我在老屋的院子里', kind: 'story' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.kind, 'story', '应原样回传 kind，实际 ' + r.kind);
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('【本次类型】') === 0, '类型声明应在用户消息最前面，实际: ' + userMsg.slice(0, 60));
    assert.ok(userMsg.indexOf('叙事型') >= 0, '应指明叙事型');
    assert.ok(userMsg.indexOf('不要再改判') >= 0, '应禁止模型改判类型');
  });

  await t('kind=deal → 用户消息带「成交型」', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ mode: 'moments', prompt: '我的课程开放报名', kind: 'deal' });
    assert.strictEqual(r.kind, 'deal');
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('【本次类型】成交型') >= 0, '实际: ' + userMsg.slice(0, 80));
  });

  await t('kind 非法值（hack）→ 归一化为 value，不透传脏值', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ mode: 'moments', prompt: 'x', kind: '../../etc/passwd' });
    assert.strictEqual(r.kind, 'value', '非法 kind 应退化为 value，实际 ' + r.kind);
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('passwd') < 0, '脏值不得出现在模型输入里');
    assert.ok(userMsg.indexOf('【本次类型】价值型') >= 0, '退化后应显式声明类型');
  });

  await t('缺省 kind → value（老版本前端不带 kind 字段也兼容）', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ mode: 'moments', prompt: 'x' });
    assert.strictEqual(r.kind, 'value', '无 kind 应为 value，实际 ' + r.kind);
  });

  await t('返回体只有 options（不再有 comic 的 text 字段）—— 防该路径被加回来', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ mode: 'moments', prompt: '一只猫' });
    assert.ok(Array.isArray(r.options), 'moments 应返回 options 数组');
    assert.strictEqual(r.text, undefined, 'comic 的 text 字段不应再出现在返回体里');
    assert.strictEqual(r.mode, 'moments', 'mode 应恒为 moments');
  });

  await t('★ 系统提示词跨 kind 逐字节一致（前缀缓存不被打散）', async () => {
    reset('openid-test', 50);
    const others = ['value', 'persona', 'deal', 'life'];
    const sysOf = (kind) => JSON.parse(capturedPosts[capturedPosts.length - 1].body).input[0].content;
    const collect = async (kind) => { await aiGen.main({ mode: 'moments', prompt: 'x', kind }); return sysOf(kind); };
    const base = await collect('value');
    for (const k of others.concat(['story'])) {
      const s = await collect(k);
      assert.strictEqual(s, base, 'kind=' + k + ' 的系统提示词与 value 不一致 → 前缀缓存会失效');
    }
  });

  await t('★ 系统提示词含类型定义 + 长度规则（但不含硬性类型字数）', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: 'x', kind: 'value' });
    const sys = JSON.parse(capturedPosts[0].body).input[0].content;
    ['价值型', '人设型', '成交型', '生活型', '叙事型'].forEach(t2 =>
      assert.ok(sys.indexOf(t2) >= 0, '系统提示词缺类型定义：' + t2));
    assert.ok(/固定区间/.test(sys) && sys.indexOf('【本次长度】') >= 0, '系统提示词应含类型固定字数区间说明（长度规则仍在）');
    assert.ok(sys.indexOf('不低于 80 字') >= 0, '应写明 80 字硬下限');
    assert.ok(/不足[\s\S]{0,24}展开用户已有细节补足/.test(sys), '下限靠展开细节补足');
    assert.ok(/绝不[\s\S]{0,20}编造/.test(sys), '应明确禁止为凑字数编造事实');
    assert.ok(/禁止[\s\S]{0,40}(产品|引导|促销)/.test(sys), '叙事型应显式禁止营销引导');
    // 类型不再绑定字数：不应出现「价值型（100-200 字）」这类硬编码
    assert.ok(!/价值型（\d+-\d+ 字）/.test(sys), '类型不应再绑定死字数：' + (sys.match(/价值型（[^）]*）/) || [''])[0]);
  });

  // ── 长度跟随用户原文（2026-09-19 用户拍板）──
  await t('★ 长度跟随输入：一句话 → 80-150 字', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: '今天很开心', kind: 'story' });   // 5 字
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(/【本次长度】[\s\S]{0,40}80-150 字/.test(userMsg), '短输入应给 80-150，实际: ' + userMsg.slice(0, 200));
    assert.ok(userMsg.indexOf('用户原文约 5 字') >= 0, '应带上实际字数，实际: ' + userMsg.slice(0, 200));
  });

  await t('★ 长度跟随输入：中等长度 → 150-300 字', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: 'x'.repeat(120), kind: 'story' });
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('150-300 字') >= 0, '实际: ' + userMsg.slice(0, 200));
  });

  await t('★ 长度跟随输入：长文 → 350-700 字', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: 'x'.repeat(800), kind: 'story' });
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('350-700 字') >= 0, '实际: ' + userMsg.slice(0, 200));
  });

  // ── 字数策略分叉（2026-09-19 拍板；2026-09-20 放宽区间））：4 类固定区间，story 跟随原文 ──
  await t('★ 字数分叉：价值型固定 100-250 字（与输入长短无关）', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: 'x'.repeat(800), kind: 'value' });  // 长输入也不应超上限
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('100-250 字') >= 0, '价值型应固定 100-250，实际: ' + userMsg.slice(0, 120));
    assert.ok(userMsg.indexOf('固定字数区间') >= 0, '应声明是固定区间（非跟随输入）');
  });
  await t('★ 字数分叉：人设型 150-280 / 成交型 150-320 / 生活型 80-200', async () => {
    const check = async (kind, range) => {
      reset('openid-test', 50);
      await aiGen.main({ mode: 'moments', prompt: 'x'.repeat(800), kind });
      const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
      assert.ok(userMsg.indexOf(range + ' 字') >= 0, kind + ' 应固定 ' + range + '，实际: ' + userMsg.slice(0, 120));
    };
    await check('persona', '150-280');
    await check('deal', '150-320');
    await check('life', '80-200');
  });
  // ── 「更长」关键词升档（③ 2026-09-20 用户拍板）──
  await t('★ 「更长」升档：价值型 100-250 → 加长 200-400', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: '帮我写长一点', kind: 'value' });
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('200-400 字') >= 0, '命中「更长」应升到加长区间 200-400，实际: ' + userMsg.slice(0, 160));
  });
  await t('★ 「更长」升档：story 短输入 80-150 → 上移一档 150-300', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: '今天很开心，再长一点', kind: 'story' });   // 11 字 → 首档，升档后一档
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('150-300 字') >= 0, 'story 命中「更长」应上移一档到 150-300，实际: ' + userMsg.slice(0, 160));
  });
  await t('★ 字数分叉：叙事型 story 仍跟随原文（长输入 → 350-700）', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: 'x'.repeat(800), kind: 'story' });
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('350-700 字') >= 0, 'story 应跟随原文给 350-700，实际: ' + userMsg.slice(0, 120));
    assert.ok(userMsg.indexOf('用户原文约 800 字') >= 0, '应带实际字数');
  });

  await t('★ 硬下限 80 字：极短/空输入也带下限约束', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: '雨', kind: 'story' });   // 1 字
    let userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('不得低于 80 字') >= 0, '应写明不得低于 80 字');
    // 纯图（无文字）：没有用户原文，也必须有下限，不能放开成"随便写"
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', imageFileId: 'cloud://env.test/a.jpg', kind: 'story' });
    userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    const textPart = Array.isArray(userMsg) ? userMsg[0].text : userMsg;
    assert.ok(textPart.indexOf('用户没有给文字') >= 0, '纯图应说明无自有文字，实际: ' + textPart.slice(0, 160));
    assert.ok(textPart.indexOf('不得低于 80 字') >= 0, '纯图也要有 80 字下限');
  });

  await t('★ 长度仍受"用户明确要求"覆盖（要长则不设上限）', async () => {
    reset('openid-test', 50);
    await aiGen.main({ mode: 'moments', prompt: '那年的夏天很短', feedback: '再长一点，写详细些' });
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('要长则不设上限') >= 0, '应声明用户要求优先且不设上限');
    assert.ok(userMsg.indexOf('以用户要求为准') >= 0);
    // 类型/长度声明仍须在最前（不被 previous 块挤掉）
    assert.ok(userMsg.indexOf('【本次类型】') === 0, '类型声明仍应在最前');
  });

  await t('换一批（feedback）时类型与长度声明都在最前，且保留上一版', async () => {
    reset('openid-test', 50);
    await aiGen.main({
      mode: 'moments', prompt: '那年夏天', kind: 'story',
      feedback: '再慢一点', previous: ['上一版A', '上一版B', '上一版C']
    });
    const userMsg = JSON.parse(capturedPosts[0].body).input[1].content;
    assert.ok(userMsg.indexOf('【本次类型】') === 0, '类型声明仍应在最前');
    assert.ok(userMsg.indexOf('【本次长度】') >= 0, '长度声明也应在');
    assert.ok(userMsg.indexOf('【本次长度】') < userMsg.indexOf('上一版A'), '长度声明应排在 previous 块之前');
    assert.ok(userMsg.indexOf('叙事型') >= 0);
    assert.ok(userMsg.indexOf('上一版A') >= 0 && userMsg.indexOf('上一版C') >= 0, '上一版仍应带上');
    assert.ok(userMsg.indexOf('明显不同') >= 0, '应要求与上一版不同');
  });

  // ── 输出上限必须跟着长度档位走（否则长输入时第 2、3 组会被截断成半截话）──
  await t('★ max_output_tokens 随输入长度单调递增且不退化（防长文被截断）', async () => {
    const maxOutOf = async (prompt) => {
      reset('openid-test', 50);
      await aiGen.main({ mode: 'moments', prompt, kind: 'story' });
      const body = JSON.parse(capturedPosts[0].body);
      return body.max_output_tokens;
    };
    const short = await maxOutOf('今天很开心');                          // 5 字 → 80-150/组
    const mid = await maxOutOf('x'.repeat(120));                        // 150-300/组
    const long = await maxOutOf('x'.repeat(800));                       // 350-700/组
    assert.ok(short >= 1500, '短输入不应低于旧下限 1500，实际 ' + short);
    assert.ok(mid >= short, '中等输入不应比短输入小：' + mid + ' < ' + short);
    assert.ok(long > mid, '长文必须给更大额度：' + long + ' 应 > ' + mid);
    // 3 组 × 700 字 + 分隔开销：至少 2100 字的空间，按 ≤1 token/字 换算需 ≥2100
    assert.ok(long >= 2100, '长文档位额度不足，第 2、3 组会被截断，实际 ' + long);
    assert.ok(long <= 4000, '不应超过 4000 上限，实际 ' + long);
  });

  // （原「comic 模式的 max_output_tokens 保持 1500」用例随 comic 路径一并移除：
  //   现在 maxOut 只有一条按长度档位浮动的算法，上一条用例已覆盖。）

  // ═══════════════ H5 通道（公众号版 · 2026-09-23 新增）═══════════════
  // 云函数靠「无 openid + 显式 channel:'h5'」识别网页端，改走「设备+IP」日额度而非积分。
  // 下面把这条分支的真实行为钉死：不碰积分、额度落 h5_usage、超限拒绝、失败退还、
  // 返回集成响应（带 CORS）；同时钉住它**不得**影响小程序既有路径。
  function httpEvent(body, method, headers) {
    return {
      path: '/h5api',
      httpMethod: method || 'POST',
      headers: headers || { 'x-forwarded-for': '203.0.113.9' },
      queryStringParameters: {},
      body: typeof body === 'string' ? body : JSON.stringify(body)
    };
  }
  function parseOut(r) {
    assert.ok(r && typeof r.statusCode === 'number',
      'HTTP 通道必须返回集成响应（statusCode/headers/body），实际: ' + JSON.stringify(r));
    return JSON.parse(r.body);
  }
  function h5reset() { reset(''); currentOpenid = ''; }

  await t('H5：无 openid + channel=h5 → 走额度路径，成功、不产生积分账户', async () => {
    h5reset();
    const out = parseOut(await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-aaa', kind: 'life', prompt: '下班后在江边散步' })));
    assert.strictEqual(out.ok, true, JSON.stringify(out));
    assert.strictEqual(out.channel, 'h5');
    assert.strictEqual(out.kind, 'life');
    assert.ok(Array.isArray(out.options) && out.options.length >= 1, '应返回文案');
    assert.strictEqual(out.points, undefined, 'H5 不该返回积分余额');
    assert.deepStrictEqual(out.quota, { used: 1, limit: 5, left: 4 });
    const keys = Object.keys(store);
    assert.ok(keys.every(k => /^\d{4}-\d{2}-\d{2}_[di]_/.test(k)),
      'H5 通道只应写 h5_usage 计数文档，实际写了: ' + keys.join(','));
    assert.strictEqual(keys.length, 2, '设备桶 + IP 桶应各一条，实际: ' + keys.join(','));
  });

  await t('H5：IP 只以哈希入桶（不落原始 IP），设备桶与 IP 桶都计数', async () => {
    h5reset();
    await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-hash', prompt: 'x' }));
    const raw = JSON.stringify(store);
    assert.ok(raw.indexOf('203.0.113.9') < 0, 'h5_usage 里落了原始 IP —— 限流不需要这个粒度，徒增个人信息留存');
    assert.ok(raw.indexOf('dev-hash') < 0, 'h5_usage 里落了原始设备标识，应存哈希');
  });

  await t('H5：第 6 次超限即拒，且不再调用模型', async () => {
    h5reset();
    for (let i = 0; i < 5; i++) {
      const o = parseOut(await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-limit', prompt: 'x' + i })));
      assert.strictEqual(o.ok, true, '第 ' + (i + 1) + ' 次应成功，实际 ' + JSON.stringify(o));
    }
    capturedPosts = [];
    const o6 = parseOut(await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-limit', prompt: 'over' })));
    assert.strictEqual(o6.ok, false, '第 6 次应当被拒');
    assert.ok(/免费次数已用完/.test(o6.err), '应给出可读的超限提示，实际: ' + o6.err);
    assert.strictEqual(o6.quota.left, 0);
    assert.strictEqual(capturedPosts.length, 0, '被拒时绝不能调用模型（那是真金白银）');
  });

  await t('H5：集成响应带 CORS 头，否则跨域页面读不到响应体', async () => {
    h5reset();
    const r = await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-cors', prompt: 'x' }));
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.headers['Access-Control-Allow-Origin'], '*');
    assert.ok(/application\/json/.test(String(r.headers['Content-Type'])), 'Content-Type 应为 json: ' + r.headers['Content-Type']);
  });

  await t('H5：OPTIONS 预检直接放行，不计额度、不调模型', async () => {
    h5reset();
    const r = await aiGen.main({ path: '/h5api', httpMethod: 'OPTIONS', headers: {}, queryStringParameters: {}, body: null });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(JSON.parse(r.body).ok, true);
    assert.strictEqual(Object.keys(store).length, 0, '预检不该产生任何计数');
    assert.strictEqual(capturedPosts.length, 0);
  });

  await t('H5：传入 imageFileIds 被忽略（网页端拿不到合法 fileID，硬下载只会报错）', async () => {
    h5reset();
    downloadFileCalls = [];
    const out = parseOut(await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-img', prompt: 'x', imageFileIds: ['cloud://fake.png'] })));
    assert.strictEqual(out.ok, true, JSON.stringify(out));
    assert.strictEqual(downloadFileCalls.length, 0, 'H5 通道不该去下载云存储图片');
  });

  await t('H5：上游失败 → 额度自动退还，用户不白花次数', async () => {
    h5reset();
    await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-refund', prompt: 'a' }));
    await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-refund', prompt: 'b' }));
    const orig = fakeHttps.request;
    fakeHttps.request = makeRequestFailing();
    try {
      const bad = parseOut(await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-refund', prompt: 'c' })));
      assert.strictEqual(bad.ok, false, '上游失败应返回 ok:false');
    } finally { fakeHttps.request = orig; }
    const good = parseOut(await aiGen.main(httpEvent({ channel: 'h5', deviceId: 'dev-refund', prompt: 'd' })));
    assert.strictEqual(good.ok, true, JSON.stringify(good));
    assert.strictEqual(good.quota.used, 3,
      '第 3 次成功后 used 应为 3（说明失败那次已退还），实际 ' + good.quota.used);
  });

  await t('小程序侧不受影响：即便伪造 channel=h5，只要拿到 openid 就仍走积分', async () => {
    reset('openid-test', 50);
    const r = await aiGen.main({ channel: 'h5', prompt: '今天爬山' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.channel, 'mp', '有 openid 时必须走小程序通道');
    assert.strictEqual(store['openid-test'].points, 42, '应扣 20 积分，实际 ' + store['openid-test'].points);
    assert.strictEqual(r.points, 42, '应返回扣费后余额');
  });

  await t('H5：不声明 channel 就明确报错（绝不靠推断放行免费额度）', async () => {
    h5reset();
    const out = parseOut(await aiGen.main(httpEvent({ prompt: 'x', deviceId: 'dev-x' })));
    assert.strictEqual(out.ok, false, '未声明 channel 应被拒，实际 ' + JSON.stringify(out));
    assert.ok(/openid/.test(out.err), '应明确提示未获取到身份，实际: ' + out.err);
    assert.strictEqual(Object.keys(store).length, 0, '被拒时不该消耗额度');
  });

  // 2026-10-06：h5_backend 缺失时显式 SKIP 并给出 exitCode=0（视作"环境未就绪"，
  //   而非"测试通过"）；run_all 会读到 SKIP 字样，不再误标成 ✓。
  if (SKIP) {
    console.log('\n──────── 结果：SKIP（未找到 h5_backend/ai_gen/index.js）────────');
    process.exitCode = 0;
    return;
  }

  console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
  // 用 exitCode 而非 process.exit()，避免异步 stdout 未 flush 被截断
  process.exitCode = fail ? 1 : 0;
})();

// 模型固定失败的 request 工厂（用例 4 用）
function makeRequestFailing() {
  return function (opts, cb) {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = e => { if (e) req.emit('error', e); };
    req.setTimeout = () => {};
    req.end = () => { cb(makeRes(500, JSON.stringify({ error: 'boom' }))); };
    return req;
  };
}

// 2026-09-20：模拟「单次请求超时」（真实场景 = https socket 超时 → destroy(new Error('请求超时'))）。
// 与非超时的失败区分开：超时必须**跳过降级重试**，否则两次叠加会逼近云函数 60s 被强杀 ⇒ 退分来不及执行。
let timeoutAttempts = 0;
function makeRequestTimeout() {
  timeoutAttempts = 0;
  return function (opts, cb) {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = e => { if (e) req.emit('error', e); };
    req.setTimeout = () => {};
    req.end = () => { timeoutAttempts++; process.nextTick(() => req.emit('error', new Error('请求超时'))); };
    return req;
  };
}
