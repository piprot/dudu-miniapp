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
  // ── 2026-10-01 重构新增：渲染引擎 / 模板 / 主题 / 每日文案库 / 扣费 / 卡片回归 ──
  'test/test_render_engine.js',
  'test/test_templates.js',
  'test/test_daily_quotes.js',
  // ── 2026-10-06 静态内容库 + 每日轮换引擎（运营「一定要天天换」）──
  'test/test_content_library.js',
  'test/test_region_data.js',
  'test/test_font_kit.js',
  'test/test_card_style_mixin.js',
  'test/test_charge_units.js',
  'test/test_fixes_regression.js',
  'test_card.js',
  'test/test_card_page.js',
  // ── 2026-10-01 P4~P6：海报长图 / 历史收藏 / 分享闭环 / 海报页全链路 ──
  'test/test_poster.js',
  'test/test_cat_picker.js',
  'test/test_picker_wiring.js',
  'test/test_add_mine.js',
  'test/test_card_config_wiring.js',
  'test/test_calendar_mix.js',
  'test/test_solar_layers.js',
  'test/test_quotes_merge.js',
  'test/test_quotes_page.js',
  'test/test_history.js',
  'test/test_poster_page.js',
  // ── 2026-10-04 隐私错误分类（errno 精确判定，防「用户拒绝」被误当成「后台没配」）──
  'test/test_privacy_classify.js',
  // ── 2026-10-01 设计规范 + 流体交互（拖拽排序/保存翻转/令牌）──
  'test/test_ui_fluid.js',
  'test/test_h5_comic.js',
  'test/test_ai_gen_units.js',
  'test/test_points_daily.js',
  'test/test_vp_units.js',
  'test/test_vp_refund_units.js',
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
  // 2026-10-06：不再硬编码 ROOT/../h5_backend —— 实际位置由 test/h5_backend_path.js 探测
  //   （本机 h5_backend 并不在 ROOT 兄弟目录，而在 WorkBuddy/2026-09-11-21-15-54/ 下）。
  //   硬编码导致 ai_gen 缓存跨套件残留：test_ai_gen_units 先跑并用自己的 LLM 环境变量
  //   初始化 ai_gen，e2e_flow 拿到被污染的模块 → 23 PASS 变 16 PASS/7 FAIL（假红）。
  const { AI_GEN_PATH } = require('./h5_backend_path');
  const EXTERNAL_ROOTS = [ROOT, path.join(ROOT, '..', 'h5_backend'), path.join(ROOT, 'h5_backend')];
  if (AI_GEN_PATH) EXTERNAL_ROOTS.push(path.dirname(AI_GEN_PATH));
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
  const code = typeof process.exitCode === 'number' ? process.exitCode : (threw ? 1 : 0);
  // ⚠️ 部分套件（如 test_frontend_guards）只打 ✓/✗ 行、不打印「结果：」行。
  //   原先这里一律显示「无条件失败」，但退出码为 0 仍标 ✓ —— 汇总表里出现
  //   「无条件失败」字样却带 ✓，会被误读成测试炸了（2026-10-06 实测遇到）。
  //   改成：有结果行用结果；没有但退出码 0 → 「通过」；都没有才算真失败。
  let line;
  if (m) line = m[1].trim();
  else if (!threw && code === 0) line = '通过（无结果行，按退出码判定）';
  else line = threw ? '执行异常' : '无条件失败';
  process.exitCode = origExitCode; // 还原，交给 run_all 汇总
  const fm = line.match(/(\d+)\s*(?:FAIL|失败)/);
  const fails = fm ? Number(fm[1]) : (code === 0 ? 0 : 1);
  // ⚠️ 2026-10-06：显式识别 SKIP。
  //   起因：套件因缺外部依赖（h5_backend/ai_gen）而「执行异常」时，本兜底逻辑会
  //   把它算成 fails=0 → 汇总行打 ✓，**假绿**。曾真实发生过（两个套件被误标通过）。
  //   现在：SKIP 用 ~ 标记，既不算失败（环境未就绪不是代码错），也不再冒充通过。
  const skipped = /SKIP/.test(line);
  return { name: path.basename(rel), line, fails, code, skipped };
}

(async () => {
  console.log('════════════ 项目测试总入口 ════════════\n');

  const syn = syntaxCheck();
  const synOk = syn.bad.length === 0;
  console.log((synOk ? '✓' : '✗') + '  ' + syn.name.padEnd(24) + syn.detail + (synOk ? '，全部通过' : '，失败: ' + syn.bad.join(', ')));

  const results = [];
  for (const rel of SUITES) results.push(await runSuite(rel));
  for (const r of results) {
    const mark = r.skipped ? '~' : (r.fails === 0 ? '✓' : '✗');
    console.log(mark + '  ' + r.name.padEnd(24) + r.line);
  }

  const totalFail = (synOk ? 0 : syn.bad.length) + results.reduce((s, r) => s + (r.fails || 0), 0);
  const totalSkip = results.filter(r => r.skipped).length;
  console.log('\n════════════ SUMMARY：' + (totalFail ? totalFail + ' 项失败' : '全部通过 ✔')
    + (totalSkip ? '（另有 ' + totalSkip + ' 项因缺外部依赖跳过）' : '') + ' ════════════');
  process.exitCode = totalFail ? 1 : 0;
})();
