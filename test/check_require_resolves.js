// 上传前守卫：校验所有**会上传**的 JS 文件里，每个 require 都能解析到真实文件。
// 为什么需要：微信真机 require 不解析目录（只认文件），写 require('.../xxx') 而 xxx 是目录时，
//   真机直接报 "module 'xxx.js' is not defined" → 页面模块加载失败 → 整页白屏。
//   Node 会自动把目录解析成 index.js，所以 Node 侧的语法检查/单测**测不出来**（2026-10-03 踩过两次）。
// 本守卫在上传前把这类错误拦在本地。
//
// 运行：node test/check_require_resolves.js   期望：全部解析成功，退出码 0
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 与 project.config.json packOptions.ignore 保持一致：这些目录不会打进包，无需校验。
const IGNORE_DIRS = new Set([
  'server', 'samples', 'cloudfunctions_deprecated', 'test', '__pycache__',
  '.workbuddy', '_backup', 'tools', 'tools_local', 'h5',
  'packageReader', 'packageSample', 'node_modules', '.git'
]);
const IGNORE_FILE_RE = /\.(md|py)$/;

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) { walk(full, out); continue; }
    if (!name.endsWith('.js') || IGNORE_FILE_RE.test(name)) continue;
    // 根目录独立测试脚本（test_*.js）不在小程序 require 图里，无需校验。
    if (dir === ROOT && /^test_.*\.js$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

// 微信真机 require 相对路径的解析规则（与 Node 的关键差异）：
//   ① 省略扩展名可以：require('./charge') → charge.js ✅（Node 同此行为）
//   ② **不解析目录**：require('./themes') 而 themes 是目录 → 只去找 themes.js，
//      找不到就报 "module 'themes.js' is not defined" → 页面模块加载失败 → 整页白屏。
//      （Node 会自动回退 themes/index.js，故 Node 侧的单测/语法检查测不出此错，2026-10-03 踩过两次）
// 因此：base 是文件、或 base+'.js' 是文件 → 通过；base 是目录且 base.js 不存在 → 失败。
function resolvesToFile(fromFile, req) {
  const base = path.resolve(path.dirname(fromFile), req);
  const asFile = base + '.js';
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return { ok: true };
  if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) return { ok: true };
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    return { ok: false, reason: `指向目录「${path.relative(ROOT, base)}」（微信真机不解析目录→index.js）` };
  }
  return { ok: false, reason: `文件不存在（解析到 ${path.relative(ROOT, base)} 或 ${path.relative(ROOT, asFile)}）` };
}

const files = walk(ROOT, []);
let checked = 0;
let failed = 0;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const req = m[1];
    if (!req.startsWith('.')) continue; // 只校验相对路径
    checked++;
    const r = resolvesToFile(f, req);
    if (!r.ok) {
      failed++;
      const line = src.slice(0, m.index).split('\n').length;
      console.log(`  ✗ ${path.relative(ROOT, f)}:${line}  require('${req}')  → ${r.reason}`);
    }
  }
}

console.log(`\n共校验 ${checked} 条相对 require（${files.length} 个 JS 文件）`);
if (failed) {
  console.log(`❌ ${failed} 条 require 无法在微信真机解析——真机将报 module not defined 并白屏`);
  process.exit(1);
} else {
  console.log('✅ 全部 require 均可解析到真实文件（微信真机安全）');
}
