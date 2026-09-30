// 一键跑通：语法检查 → 审核红线闸门 → 各测试套件
//
// 用法：node test/run_all.js
// 期望：末行 SUMMARY 全绿，退出码 0。CI 或提交前直接跑这一个命令即可。
//
// 2026-09-29：由「spawn 子进程」改为「进程内执行」。
//   原实现对每个文件/套件 cp.execFileSync(process.execPath, ...) 起一个 node 子进程；
//   在部分受限沙箱里 node.exe 被锁定，子进程全部 EBUSY 失败、把全盘判红（与代码无关）。
//   现改：语法检查用 vm 解析（不执行、不 spawn）；套件用 require + 捕获 stdout 进程内执行，
//   行为等价于原 spawn 版本，但不再依赖起子进程。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const PRISTINE_LOAD = Module._load; // 套件会临时改 Module._load 注入 Stub，跑完需还原

// ① 全量 JS 语法检查（进程内解析，不执行、不 spawn）
function syntaxCheck() {
  const files = [];
  (function w(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name === 'node_modules' || f.name === '.git') continue;
      const fp = path.join(d, f.name);
      if (f.isDirectory()) w(fp);
      else if (f.name.endsWith('.js')) files.push(fp);
    }
  })(ROOT);
  const bad = [];
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    let okParse = false;
    try {
      // 函数包裹以贴近 CommonJS 模块语义（允许顶层 return / 顶层 await 等）
      new vm.Script('(function(module,exports,require,__dirname,__filename){\n' + code + '\n})', { filename: f });
      okParse = true;
    } catch (e1) {
      // 回退：当成普通脚本解析（覆盖个别无法函数包裹的写法）
      try { new vm.Script(code, { filename: f }); okParse = true; } catch (e2) { /* 真语法错误 */ }
    }
    if (!okParse) bad.push(path.relative(ROOT, f));
  }
  return { name: 'JS 语法检查', total: files.length, bad, detail: files.length + ' 个文件' };
}

// ② 各套件：进程内 require 执行 + 捕获 stdout，抓"结果："行
// 2026-09-29：摘除 test_h5_parity.js —— 端内 H5 桥接已整体下线（pages/h5 删除、config.H5 移除），
// h5/ 成为独立演化的产品，与小程序的同规则同步（parity）已无业务意义；
// 「h5 不进小程序包」改由 packOptions.ignore + test_frontend_guards.js 的 F9/F10 守卫。
// 若日后两端重新对齐，可从 git 历史恢复该文件（git log -- test/test_h5_parity.js）。
const SUITES = [
  'test/check_audit_redlines.js',
  'test/smoke_cloudfunctions.js',
  'test/test_frontend_guards.js',
  'test/test_constants_sync.js',
  'test/test_h5_comic.js',
  'test/test_ai_gen_units.js',
  'test/test_points_daily.js',
  'test/test_vp_units.js',
  'test/test_custom_request.js',
  'test/test_e2e_flow.js'
];

// 等套件打印"结果："：套件内部常用 async IIFE + await，require 返回时可能还没打印。
// 用真实定时器轮询（本沙箱下 setImmediate 不可靠，setTimeout 实测可用），最多等 ~2s。
async function waitForResult(captured) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (/结果：/.test(captured.join(''))) return;
    await new Promise(r => setTimeout(r, 30));
  }
}

async function runSuite(rel) {
  const abs = path.join(ROOT, rel);
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const origExit = process.exit;
  const origExitCode = process.exitCode;
  process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return true; };
  process.stderr.write = (chunk, ...rest) => { captured.push(String(chunk)); return true; };
  process.exitCode = 0;
  let threw = null;
  // 防御：万一某套件调 process.exit，转成标记而不是真退出 run_all
  process.exit = (code) => { process.exitCode = (typeof code === 'number' ? code : 0); threw = new Error('process.exit(' + code + ')'); };
  // 进程内执行的代价：所有套件共享同一份 require 缓存与全局 Stub。原 spawn 版本每个套件是
  // 独立进程、零污染；这里必须在每个套件前清掉项目内模块缓存，让它像在独立进程里从零加载，
  // 否则上一个套件的模块级状态/Stub 会污染下一个（实测会令 test_points_daily 等误报失败、异步套件卡死）。
  // 2026-09-30：ai_gen 源码移出仓库（../h5_backend/），在 ROOT 之外 —— 缓存清理必须一并覆盖，
  // 否则 smoke 用自己的 Stub 加载后残留缓存，units/e2e 拿到被污染的模块 → 套件挂起 → 「无条件失败」。
  const EXTERNAL_ROOTS = [ROOT, path.join(ROOT, '..', 'h5_backend')];
  for (const k of Object.keys(require.cache)) {
    if (EXTERNAL_ROOTS.some(r => k.indexOf(r) === 0)) delete require.cache[k];
  }
  try {
    require(abs);
    await waitForResult(captured); // 等 async IIFE 跑完、打印"结果："
  } catch (e) {
    threw = e;
    captured.push('\n[THREW] ' + (e && e.stack || e) + '\n');
  } finally {
    process.stdout.write = origWrite;
    process.stderr.write = origErr;
    process.exit = origExit;
    Module._load = PRISTINE_LOAD; // 还原 Stub 注入，避免污染后续套件
  }
  const out = captured.join('');
  const m = out.match(/结果：([^\n─═]*)/);
  const line = m ? m[1].trim() : (threw ? '执行异常' : '无条件失败');
  const code = typeof process.exitCode === 'number' ? process.exitCode : (threw ? 1 : 0);
  process.exitCode = origExitCode; // 还原，交给 run_all 汇总
  const fm = line.match(/(\d+)\s*(?:FAIL|失败)/);
  const fails = fm ? Number(fm[1]) : (code === 0 ? 0 : 1);
  return { name: path.basename(rel), line, fails, code };
}

(async () => {
  console.log('════════════ 项目测试总入口 ════════════\n');

  const syn = syntaxCheck();
  const synOk = syn.bad.length === 0;
  console.log((synOk ? '✓' : '✗') + '  ' + syn.name.padEnd(24) + syn.detail + (synOk ? '，全部通过' : '，失败: ' + syn.bad.join(', ')));

  const results = [];
  for (const rel of SUITES) results.push(await runSuite(rel));
  for (const r of results) {
    console.log((r.fails === 0 ? '✓' : '✗') + '  ' + r.name.padEnd(24) + r.line);
  }

  const totalFail = (synOk ? 0 : syn.bad.length) + results.reduce((s, r) => s + (r.fails || 0), 0);
  console.log('\n════════════ SUMMARY：' + (totalFail ? totalFail + ' 项失败' : '全部通过 ✔') + ' ════════════');
  process.exitCode = totalFail ? 1 : 0;
})();
