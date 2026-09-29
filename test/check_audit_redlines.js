// 审核红线 + 分包闸门（零依赖）
//
// 为什么需要它：DEPLOY_CHECKLIST.md §0 给个人主体定了硬红线，但"包内不得有 XXX"
// 这类约束靠人工 grep 无法长期保证——注释里的一句说明、被废弃但没排除的目录，
// 都会让扫描结果失真。本脚本按「真实会被打进上传包的集合」判定，并把
// 「活代码命中（必须修）」与「仅注释命中（可选清理）」分开报。
//
// 2026-09-17 扩展：reader 页 + panels 拆入分包后，新增
//   · 按 主包 / 各分包 分别统计体积并与官方上限比对（主包 2MB / 单个分包 2MB / 合计 20MB）
//   · R5 主包不得引用分包资源（主包先于分包加载，引用分包资源会取不到文件）
//   · R6 app.json 声明的页面必须四件套齐全，且代码里的跳转目标必须是已声明页面
//     （把页面搬进分包时最容易漏改的正是这两处）
//
// 检查项：
//   R1 AppID 不能是 touristappid（否则无法真实调用任何能力）
//   R2 包内不得出现个体户专属能力的活代码调用
//   R3 rewardEnabled 必须为 false（个人主体不得放个人收款码）
//   R4 包内不得残留真实密钥字面量
//   R5 主包不得引用分包资源
//   R6 页面声明/四件套/跳转目标一致
//   R7 体积与预下载声明
//   R8 云函数部署完整性（每个函数必有 index.js + package.json，且依赖声明齐全）
//   R9 包内不得出现 webp 图片/引用（真机 <image> 不支持 webp → 整片空白；模拟器看不出）
//   R10 preloadRule 预下载「合计」体积 ≤ 2MB（逐包合规 ≠ 合计合规，超标时上传被拒 code 20058）
//
// 运行：node test/check_audit_redlines.js      期望：全部通过，退出码 0
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const IGNORE = (cfg.packOptions && cfg.packOptions.ignore) || [];
const CLOUD_ROOT = (cfg.cloudfunctionRoot || '').replace(/\/$/, '');
const SUBPACKAGES = app.subPackages || app.subpackages || [];
const MAIN_LIMIT = 2 * 1024 * 1024;
const SUB_LIMIT = 2 * 1024 * 1024;
const TOTAL_LIMIT = 20 * 1024 * 1024;

// ───────── 1. 按 packOptions.ignore 计算真实打包文件集合 ─────────
function ignoredBy(rel) {
  const lower = rel.toLowerCase();
  return IGNORE.some(rule => {
    const v = String(rule.value || '').toLowerCase();
    if (!v) return false;
    switch (rule.type) {
      case 'folder': return lower === v || lower.indexOf(v + '/') === 0;
      case 'file': return lower === v;
      case 'suffix': return lower.endsWith(v);
      case 'prefix': return path.posix.basename(lower).indexOf(v) === 0;
      case 'glob': {
        const rx = new RegExp('^' + v.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
        return rx.test(lower);
      }
      case 'regexp': return new RegExp(v).test(lower);
      default: return false;
    }
  });
}

function walk(dir, out) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name === '.git') continue;
    const abs = path.join(dir, f.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (f.isDirectory()) walk(abs, out);
    else out.push({ rel, abs, size: fs.statSync(abs).size });
  }
  return out;
}

const all = walk(ROOT, []);
const packed = all.filter(f => !ignoredBy(f.rel));
const excluded = all.filter(f => ignoredBy(f.rel));
const cloudFns = packed.filter(f => f.rel.indexOf(CLOUD_ROOT + '/') === 0);
const codePkg = packed.filter(f => f.rel.indexOf(CLOUD_ROOT + '/') !== 0);

// 主包 = 不属于任何分包 root 的文件；分包 = 落在该 root 下的文件
const subRoots = SUBPACKAGES.map(sp => String(sp.root || '').replace(/\/$/, '')).filter(Boolean);
function pkgOf(rel) {
  for (const r of subRoots) if (rel === r || rel.indexOf(r + '/') === 0) return r;
  return '__main__';
}
const groups = { __main__: [] };
subRoots.forEach(r => { groups[r] = []; });
codePkg.forEach(f => groups[pkgOf(f.rel)].push(f));
const sizeOf = (arr) => arr.reduce((s, f) => s + f.size, 0);

// ───────── 2. 去注释（区分活代码 / 注释）─────────
function stripJsComments(src) {
  let out = '', i = 0, n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n) { if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; } out += src[i]; if (src[i] === q) { i++; break; } i++; }
      continue;
    }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
const stripMarkupComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const stripComments = (rel, src) => (rel.endsWith('.js') ? stripJsComments(src) : stripMarkupComments(src));

// ───────── 3. 红线规则 ─────────
const BANNED = [
  { token: 'wx.requestPayment', why: '标准微信支付(JSAPI) 仅限个体户/企业主体，个人主体调用会被拒审' },
  { token: 'getPhoneNumber', why: '手机号快速验证组件仅限个体户/企业主体；个人主体用 openid 标识用户即可' }
];

const problems = [];
const notes = [];
const norm = (s) => s.toLowerCase();

// ── R1 AppID ──
const appid = String(cfg.appid || '');
if (!appid || norm(appid) === 'touristappid') problems.push('R1 AppID 非法或为 touristappid（当前: ' + (appid || '空') + '）');
else notes.push('R1 AppID 正常：' + appid);

// ── R2 禁用能力（主包 + 分包全扫；云函数不进代码包）──
let liveHits = 0, commentHits = 0;
for (const f of codePkg) {
  if (!/\.(js|wxml|wxss|json)$/i.test(f.rel)) continue;
  const raw = fs.readFileSync(f.abs, 'utf8');
  const live = stripComments(f.rel, raw);
  for (const b of BANNED) {
    if (live.indexOf(b.token) >= 0) { problems.push('R2 [活代码] ' + f.rel + ' 调用了 ' + b.token + ' —— ' + b.why); liveHits++; }
    else if (raw.indexOf(b.token) >= 0) { notes.push('R2 [仅注释] ' + f.rel + ' 注释中提到 ' + b.token + '（无调用，但会让 grep 闸门失真）'); commentHits++; }
  }
}
notes.push('R2 禁用能力扫描：' + codePkg.length + ' 个包内文件，活代码命中 ' + liveHits + ' 处、仅注释 ' + commentHits + ' 处');

// ── R2b 虚拟支付入口健在 ──
const payFile = codePkg.find(f => f.rel === 'utils/pay.js');
const paySrc = payFile ? fs.readFileSync(payFile.abs, 'utf8') : '';
if (paySrc.indexOf('wx.requestVirtualPayment') < 0) notes.push('R2b 提示：utils/pay.js 未见 wx.requestVirtualPayment，请确认支付入口是否仍在');
else notes.push('R2b 个人虚拟支付入口健在：wx.requestVirtualPayment');

// ── R3 rewardEnabled ──
let PAY_CONFIG = null;
try { PAY_CONFIG = require(path.join(ROOT, 'utils', 'config.js')).PAY_CONFIG; } catch (e) { problems.push('R3 无法加载 utils/config.js 读取 PAY_CONFIG：' + e.message); }
if (PAY_CONFIG) {
  if (PAY_CONFIG.rewardEnabled !== false) problems.push('R3 rewardEnabled 必须为 false（当前: ' + JSON.stringify(PAY_CONFIG.rewardEnabled) + '），个人主体不得展示个人收款码');
  else notes.push('R3 rewardEnabled = false（合规）');
  const qr = String(PAY_CONFIG.rewardQr || '');
  if (qr) notes.push('R3 提示：rewardQr 仍配了 ' + qr + '，虽未启用但建议清空以免误用');
}

// ── R4 密钥泄漏 ──
const SECRET_PATTERNS = [
  { rx: /\bsk-[A-Za-z0-9_-]{16,}/g, why: '形似大模型 API Key' },
  { rx: /\b[0-9a-f]{32}\b/g, why: '形似 32 位 hex 密钥（AppSecret / AppKey）' }
];
for (const f of codePkg) {
  if (!/\.(js|json|wxml)$/i.test(f.rel)) continue;
  const live = stripComments(f.rel, fs.readFileSync(f.abs, 'utf8'));
  for (const p of SECRET_PATTERNS) {
    const m = live.match(p.rx);
    if (m) problems.push('R4 [活代码] ' + f.rel + ' 疑似硬编码密钥（' + p.why + '）：' + m.slice(0, 2).join(', '));
  }
}

// ── R5 主包不得引用分包资源 ──
// 主包在启动时就加载，分包按需下载；主包页面若引用分包里的**资源**（图片/字体/模块），
// 分包未下载时会取不到。
// ⚠️ 但「跳转到分包页面」是官方支持的正规用法（navigateTo 分包页面会触发分包下载），
//    所以必须先把 `url: '...'` 里的跳转目标排除掉，否则会把 pages/index 跳 reader 误判为违规。
if (!subRoots.length) {
  notes.push('R5 未配置分包，跳过');
} else {
  let r5 = 0, navExcluded = 0;
  for (const f of groups.__main__) {
    if (!/\.(js|wxml|wxss|json)$/i.test(f.rel)) continue;
    const raw = fs.readFileSync(f.abs, 'utf8');
    let live = stripComments(f.rel, raw);
    // 去掉跳转目标的字符串字面量（含模板拼接的前半段）
    const before = live;
    live = live.replace(/url\s*:\s*'(?:[^'\\]|\\.)*'/g, "url:''").replace(/url\s*:\s*"(?:[^"\\]|\\.)*"/g, 'url:""');
    if (before !== live) navExcluded++;
    for (const r of subRoots) {
      const re = new RegExp('[\'"(]\\/?' + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/', 'g');
      const hits = live.match(re);
      if (hits) {
        problems.push('R5 主包文件 ' + f.rel + ' 引用了分包 ' + r + ' 的资源（出现 ' + hits.length + ' 次）—— 分包未下载时会取不到文件。'
          + '请改为主包自有资源，或把该页面一并移入分包。（跳转到分包页面是允许的，本项只查资源引用）');
        r5++;
      }
    }
  }
  if (!r5) notes.push('R5 主包未引用任何分包资源（跳转目标已排除，' + navExcluded + ' 个文件含跳转写法）');
}

// ── R6 页面声明 / 四件套 / 跳转目标 ──
const declared = [];
(app.pages || []).forEach(p => declared.push({ path: p, pkg: '__main__' }));
SUBPACKAGES.forEach(sp => (sp.pages || []).forEach(p => declared.push({ path: String(sp.root).replace(/\/$/, '') + '/' + p, pkg: sp.root })));
const declaredSet = new Set(declared.map(d => d.path));

let r6miss = 0;
for (const d of declared) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!fs.existsSync(path.join(ROOT, d.path + ext))) {
      problems.push('R6 页面 ' + d.path + ' 缺文件 ' + ext + '（' + (d.pkg === '__main__' ? '主包' : '分包 ' + d.pkg) + '）');
      r6miss++;
    }
  }
}
if (!r6miss) notes.push('R6 页面四件套齐全：主包 ' + (app.pages || []).length + ' 页 + 分包 ' + SUBPACKAGES.reduce((s, sp) => s + (sp.pages || []).length, 0) + ' 页');

let r6nav = 0;
const NAV_RE = /url\s*:\s*(['"])([^'"]+)\1/g;
for (const f of codePkg) {
  if (!f.rel.endsWith('.js')) continue;
  const live = stripComments(f.rel, fs.readFileSync(f.abs, 'utf8'));
  let m;
  while ((m = NAV_RE.exec(live))) {
    const target = m[2].split('?')[0].replace(/^\//, '');
    if (!target || target.indexOf('/') < 0) continue;             // 非页面路径（如 tabBar 之外的相对 URL）跳过
    if (target === 'pages/index/index') continue;                 // 首页可达
    if (!declaredSet.has(target)) {
      problems.push('R6 跳转目标 ' + f.rel + ' → "/' + target + '" 不在 app.json 声明的页面里'
        + '（页面被搬进分包后必须同步改这里，否则运行时报页面不存在）');
      r6nav++;
    }
  }
}
if (!r6nav) notes.push('R6 代码内跳转目标全部指向已声明页面');

// ── R7 体积 + 预下载声明 ──
const mainSize = sizeOf(groups.__main__);
if (mainSize > MAIN_LIMIT) problems.push('R7 主包 ' + (mainSize / 1048576).toFixed(2) + ' MB 超过 2MB 上限，无法上传');
subRoots.forEach(r => {
  const s = sizeOf(groups[r]);
  if (s > SUB_LIMIT) problems.push('R7 分包 ' + r + ' ' + (s / 1048576).toFixed(2) + ' MB 超过单个分包 2MB 上限');
});
const totalSize = mainSize + subRoots.reduce((s, r) => s + sizeOf(groups[r]), 0);
if (totalSize > TOTAL_LIMIT) problems.push('R7 代码包合计 ' + (totalSize / 1048576).toFixed(2) + ' MB 超过 20MB 上限');

const preload = app.preloadRule || {};
const subNames = new Set();
SUBPACKAGES.forEach(sp => { if (sp.name) subNames.add(sp.name); if (sp.root) subNames.add(String(sp.root).replace(/\/$/, '')); });
Object.keys(preload).forEach(page => {
  if (!declaredSet.has(page.replace(/^\//, ''))) problems.push('R7 preloadRule 的触发页面 ' + page + ' 不是已声明页面');
  const rule = preload[page] || {};
  (rule.packages || []).forEach(p => {
    if (!subNames.has(p)) problems.push('R7 preloadRule 引用了不存在的分包 "' + p + '"（可用: ' + [...subNames].join(', ') + '）');
  });
  if ((rule.packages || []).length) notes.push('R7 预下载：' + page + ' → ' + rule.packages.join(', ') + '（network=' + (rule.network || 'all') + '）');
});

// ── R10 preloadRule 预下载「合计」体积 ──
// 踩过（2026-09-18）：reader 1.65MB + sample 1.60MB 各自都 < 2MB，R7 全绿，
// 但上传被平台拒：code 20058「preloadRule [pages/index/index] source size 3320KB exceed max limit 2MB」。
// 平台口径 = 同一 preloadRule 下**所有被预下载分包体积之和** ≤ 2MB —— 逐包合规 ≠ 合计合规。
const PRELOAD_LIMIT = 2 * 1024 * 1024;
const nameToRoot = {};
SUBPACKAGES.forEach(sp => {
  const root = sp.root ? String(sp.root).replace(/\/$/, '') : '';
  if (sp.name) nameToRoot[sp.name] = root;
  if (root) nameToRoot[root] = root;
});
let r10 = 0;
Object.keys(preload).forEach(page => {
  const roots = ((preload[page] || {}).packages || []).map(p => nameToRoot[p]).filter(Boolean);
  if (!roots.length) return;
  const sum = roots.reduce((s, r) => s + sizeOf(groups[r]), 0);
  if (sum > PRELOAD_LIMIT) {
    problems.push('R10 preloadRule[' + page + '] 预下载分包合计 ' + (sum / 1048576).toFixed(2) + ' MB（'
      + roots.join(' + ') + '）超过平台 2MB 上限 —— 上传会被拒（code 20058）。'
      + '修法：从 packages 里减掉一个分包（改按需下载）或压缩图片');
    r10++;
  } else {
    notes.push('R10 预下载合计 ' + roots.join(' + ') + ' = ' + (sum / 1048576).toFixed(2) + ' MB（≤2MB，可上传）');
  }
});
if (!r10 && !Object.keys(preload).length) notes.push('R10 未声明 preloadRule，无预下载体积风险');

// ── R8 云函数部署完整性 ──
// 云函数虽不进小程序代码包，但「上传并部署：云端安装依赖」要求每个函数目录**必须有 package.json**，
// 且其中声明 index.js 里 require 的每一个三方模块。缺 package.json 时上传会失败/运行时找不到模块，
// 而这在本地 `node --check` 语法校验里**完全看不出来**（真踩过：points 函数只有 index.js）。
const { builtinModules } = require('module');
const BUILTINS = new Set(builtinModules.concat(builtinModules.map(m => 'node:' + m)));
const REQ_RE = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

const fnDirs = fs.existsSync(path.join(ROOT, CLOUD_ROOT))
  ? fs.readdirSync(path.join(ROOT, CLOUD_ROOT), { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'node_modules')
      .map(d => d.name).sort()
  : [];

let r8 = 0, r8deps = 0;
for (const fn of fnDirs) {
  const dir = path.join(ROOT, CLOUD_ROOT, fn);
  const entry = path.join(dir, 'index.js');
  const pkgFile = path.join(dir, 'package.json');

  if (!fs.existsSync(entry)) { problems.push('R8 云函数 ' + fn + ' 缺 index.js（入口文件）'); r8++; continue; }
  if (!fs.existsSync(pkgFile)) {
    problems.push('R8 云函数 ' + fn + ' 缺 package.json —— 「上传并部署：云端安装依赖」会失败/运行时找不到模块。'
      + '请补一个含 dependencies 的 package.json。');
    r8++; continue;
  }

  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')); }
  catch (e) { problems.push('R8 云函数 ' + fn + '/package.json 不是合法 JSON：' + e.message); r8++; continue; }

  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  const declaredDeps = Object.keys(deps).sort();
  if (!declaredDeps.length) { problems.push('R8 云函数 ' + fn + '/package.json 未声明任何依赖'); r8++; }

  // 提取 index.js（去注释后）里的三方模块引用，逐个核对是否已声明
  const live = stripJsComments(fs.readFileSync(entry, 'utf8'));
  const need = new Set();
  let m;
  REQ_RE.lastIndex = 0;
  while ((m = REQ_RE.exec(live))) {
    const spec = m[2];
    if (spec[0] === '.' || spec[0] === '/') continue;      // 相对/绝对路径（含跨文件）
    if (BUILTINS.has(spec)) continue;                       // Node 内置
    const parts = spec.split('/');
    need.add(spec[0] === '@' ? parts.slice(0, 2).join('/') : parts[0]);
  }
  for (const mod of need) {
    if (!declaredDeps.includes(mod)) {
      problems.push('R8 云函数 ' + fn + ' 的 index.js require 了 "' + mod + '"，但 package.json 未声明该依赖'
        + '（云端安装依赖不会装上它 → 运行时 MODULE_NOT_FOUND）。已声明: ' + (declaredDeps.join(', ') || '无'));
      r8deps++;
    }
  }
}
if (!r8 && !r8deps) notes.push('R8 云函数部署完整性：' + fnDirs.length + ' 个函数均有 index.js + package.json，依赖声明齐全（' + fnDirs.join(', ') + '）');

// ── R9 包内禁止 webp（真机 <image> 不支持，会整片空白）──
// 真踩过（2026-09-18）：所有画格/缩略图都用 webp，开发者工具模拟器**全部正常**
// （模拟器用 webview 渲染，webview 支持 webp），真机则整片空白——
// reader 报「部分画面加载失败（4 张）」、定制页样例图 3 个白块，同一根因。
// 这个坑静态检查不出来、真机才暴露，所以固化为闸门。
const WEBP_WHY = '小程序 <image> 的 webp 在真机上不可用：iOS < 14 完全不支持，iOS >= 14 还需'
  + '基础库 >= 2.9 且给 <image> 加 webp="true"；Android 亦有大量实测失败案例。'
  + '开发者工具用 webview 渲染所以本地看不出问题，真机表现为图片区域整片空白。'
  + '进包图片一律用 JPEG/PNG（转换工具 tools/webp_to_jpg.py）';
const webpFiles = codePkg.filter(f => f.rel.toLowerCase().endsWith('.webp'));
webpFiles.forEach(f => problems.push('R9 包内存在 webp 图片 ' + f.rel + ' —— ' + WEBP_WHY));
let r9refs = 0;
for (const f of codePkg) {
  if (!/\.(js|wxml|wxss|json)$/i.test(f.rel)) continue;
  const text = fs.readFileSync(path.join(ROOT, f.rel), 'utf8');
  if (/\.webp\b/i.test(stripComments(f.rel, text))) {
    problems.push('R9 [活代码] ' + f.rel + ' 引用了 .webp 路径 —— ' + WEBP_WHY);
    r9refs++;
  } else if (/\.webp\b/i.test(text)) {
    notes.push('R9 [仅注释] ' + f.rel + ' 注释里提到 .webp（无实际引用，但会让 grep 闸门失真）');
  }
}
if (!webpFiles.length && !r9refs) notes.push('R9 包内无 webp：图片均为 JPEG/PNG，真机可正常渲染');

// ───────── 4. 输出 ─────────
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log('=== 审核红线 + 分包闸门 ===\n');
console.log('[打包集合]');
console.log('  项目文件总数        : ' + all.length);
console.log('  会被打进代码包      : ' + codePkg.length + ' 个');
console.log('  已被 ignore 排除    : ' + excluded.length + ' 个');
console.log('  云函数目录(单独传)  : ' + cloudFns.length + ' 个');
console.log('\n[各包体积]');
console.log('  主包            ' + String(groups.__main__.length).padStart(4) + ' 个文件  ' + mb(mainSize).padStart(10) + '  / 2.00 MB 上限  (' + ((mainSize / MAIN_LIMIT) * 100).toFixed(1) + '%)');
subRoots.forEach(r => {
  const s = sizeOf(groups[r]);
  console.log('  分包 ' + r.padEnd(12) + String(groups[r].length).padStart(4) + ' 个文件  ' + mb(s).padStart(10) + '  / 2.00 MB 上限  (' + ((s / SUB_LIMIT) * 100).toFixed(1) + '%)');
});
console.log('  合计            ' + String(codePkg.length).padStart(4) + ' 个文件  ' + mb(totalSize).padStart(10) + '  / 20.00 MB 上限');
console.log('\n[排除规则命中]');
const byRule = {};
for (const f of excluded) {
  const lower = f.rel.toLowerCase();
  const r = IGNORE.find(rule => {
    const v = String(rule.value).toLowerCase();
    if (rule.type === 'folder') return lower === v || lower.indexOf(v + '/') === 0;
    if (rule.type === 'file') return lower === v;
    if (rule.type === 'suffix') return lower.endsWith(v);
    return false;
  });
  const k = r ? (r.type + ':' + r.value) : '?';
  byRule[k] = (byRule[k] || 0) + 1;
}
Object.keys(byRule).sort().forEach(k => console.log('  ' + k.padEnd(34) + byRule[k] + ' 个'));

console.log('\n[检查项]');
notes.forEach(n => console.log('  · ' + n));

if (problems.length) {
  console.log('\n[阻断项]');
  problems.forEach(p => console.log('  ✗ ' + p));
  console.log('\n──────── 结果：' + problems.length + ' 项未通过，不可提交审核 ────────');
  process.exitCode = 1;
} else {
  console.log('\n──────── 结果：审核红线 + 分包检查全部通过 ────────');
  process.exitCode = 0;
}
