// 云函数加载冒烟测试（零依赖）
// 用 Module._load 注入云 SDK / HTTP 的极简 Stub，确认 cloudfunctions/ 下每个云函数
// 在 require 阶段都不抛错（即顶层 require('wx-server-sdk'/'https'/'http') 与模块初始化逻辑无错）。
// 目标函数自动发现（见下方 targets），不维护手写清单。
// 仅验证"能加载"，深入逻辑见 test_ai_gen_units.js。运行：node test/smoke_cloudfunctions.js
const Module = require('module');
const origLoad = Module._load;

const cloudStub = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  getWXContext: () => ({ OPENID: 'x' }),
  database: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ data: null }),
        set: async () => ({ stats: {} }),
        update: async () => ({ stats: { updated: 1 } })
      }),
      where: () => ({ update: async () => ({ stats: { updated: 1 } }) })
    }),
    command: { inc: (n) => ({ $inc: n }), gte: (n) => ({ $gte: n }) },
    serverDate: () => new Date().toISOString()
  }),
  downloadFile: async () => ({ fileContent: Buffer.alloc(1) })
};

Module._load = function (request) {
  if (request === 'wx-server-sdk') return cloudStub;
  if (request === 'https' || request === 'http') return { request: () => ({ on() {}, write() {}, end() {}, destroy() {}, setTimeout() {} }), get: () => ({ on() {} }) };
  return origLoad.apply(this, arguments);
};

// 目标函数从 cloudfunctions/ 目录**自动发现**，不再手写清单：
// 硬编码清单在「新增/删除云函数」时会静默失真（删了 send_email 却忘了删这里 → require 抛错，
// 看起来像故障；新增函数忘了加 → 少测一个也看不出来）。目录即真相源。
const CLOUD_DIR = require('path').join(__dirname, '..', 'cloudfunctions');
const targets = require('fs').readdirSync(CLOUD_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== 'node_modules')
  .map(d => 'cloudfunctions/' + d.name + '/index.js')
  .sort();

let pass = 0, fail = 0;
for (const t of targets) {
  try {
    require(require('path').join(__dirname, '..', t));
    console.log('OK   加载成功  ' + t);
    pass++;
  } catch (e) {
    console.log('FAIL 加载抛错  ' + t + '  →  ' + (e && e.message));
    fail++;
  }
}
// ── 已移出仓库的云函数仍纳入冒烟（2026-09-30 ai_gen → ../../h5_backend/ai_gen，H5 专用后端）──
// 移出 ≠ 移出保护：加载失败照样算 FAIL，防止「搬个家就没人管」。
const movedAiGen = require('path').join(__dirname, '..', '..', 'h5_backend', 'ai_gen', 'index.js');
if (require('fs').existsSync(movedAiGen)) {
  try {
    require(movedAiGen);
    console.log('OK   加载成功  ../h5_backend/ai_gen/index.js（已移出仓库的 H5 专用后端）');
    pass++;
  } catch (e) {
    console.log('FAIL 加载抛错  ../h5_backend/ai_gen/index.js  →  ' + (e && e.message));
    fail++;
  } finally {
    // 用后即弃：本套件的 Stub 是哑实现，绝不能让被 Stub 过的 ai_gen 留在 require 缓存里
    // 污染后续套件（run_all 进程内执行，缓存跨套件共享；run_all 已按 EXTERNAL_ROOTS 兜底清理，这里双保险）。
    delete require.cache[movedAiGen];
  }
}

console.log('\n冒烟结果：' + pass + ' OK / ' + fail + ' FAIL');
process.exitCode = fail ? 1 : 0;
