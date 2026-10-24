// test/_paths.js —— 测试用路径解析助手（2026-10-24 分包改造）
//
// ── 为什么需要它 ───────────────────────────────────────────────────────
// 2026-10-24 做了分包改造：9 个工具页 + 34 个工具侧 utils 从
//   pages/{gen,card,poster,comic,quotes,spark,weather,solar,line}/
//   utils/{内容库与渲染引擎}/
// 移到了
//   pkgTools/pages/{...}/  pkgTools/utils/{...}/
//
// 测试里到处写着 `rd(ROOT, 'pages', p, p + '.wxml')`，改造后这些路径全部失效。
// 若逐个测试改死路径，下次再分包又要全改一遍——**这正是要避免的**。
//
// 本模块提供**按页面名解析实际位置**的能力：
//   pagePath('weather')  → 'pkgTools/pages/weather'
//   pageFile('weather','weather.wxml') → 绝对路径
//   utilPath('card_style_mixin.js')   → 绝对路径（主包或分包都能找到）
//
// 用法：
//   const P = require('./_paths.js');
//   const wxml = fs.readFileSync(P.pageFile('weather', 'weather.wxml'), 'utf8');
//   const mixin = fs.readFileSync(P.utilFile('card_style_mixin.js'), 'utf8');
//
// 兼容旧写法：如果你只想少改几行，也可以在测试里直接
//   const rd = (...a) => fs.readFileSync(P.resolve(...a), 'utf8');
// 其中 resolve 会把 ('pages', p, ...) 这类旧路径自动重定向到实际位置。
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

// 分包 root 列表（app.json 里声明的）
const SUB_ROOTS = (APP.subPackages || APP.subpackages || [])
  .map(sp => String(sp.root || '').replace(/\/$/, ''))
  .filter(Boolean);

// 主包页面名单
const MAIN_PAGES = (APP.pages || []).map(p => String(p).replace(/\/$/, ''));

// 分包页面名单（完整路径，形如 pkgTools/pages/weather/weather）
const SUB_PAGES = [];
(APP.subPackages || APP.subpackages || []).forEach(sp => {
  const root = String(sp.root || '').replace(/\/$/, '');
  (sp.pages || []).forEach(p => SUB_PAGES.push(root + '/' + String(p).replace(/\/$/, '')));
});

/** 页面名（末段，如 'weather'）→ 相对仓库根的页面目录 */
function pageDir(name) {
  const key = String(name || '').replace(/\/$/, '');
  // ① 主包页面：pages/xxx/xxx → 目录是 pages/xxx
  //    匹配规则：路径末段 == key（pages/index/index 的末段是 index ✓）
  for (const p of MAIN_PAGES) {
    const parts = p.split('/');
    if (parts[parts.length - 1] === key) return path.dirname(p);
  }
  // ② 分包页面：pkgTools/pages/xxx/xxx → 目录是 pkgTools/pages/xxx
  for (const p of SUB_PAGES) {
    const parts = p.split('/');
    if (parts[parts.length - 1] === key) return path.dirname(p);
  }
  // ③ 兜底：按目录名找（页面目录名与页面名一致的情形）
  for (const root of SUB_ROOTS) {
    const cand = path.join(root, 'pages', key);
    if (exists(path.join(ROOT, cand))) return cand;
  }
  const cand = path.join('pages', key);
  if (exists(path.join(ROOT, cand))) return cand;
  return null;
}

/** 页面目录（绝对路径） */
function pageDirAbs(name) {
  const d = pageDir(name);
  return d ? path.join(ROOT, d) : null;
}

/** 页面某个文件的绝对路径，如 pageFile('weather','weather.wxml') */
function pageFile(name, file) {
  const d = pageDirAbs(name);
  if (!d) return null;
  return path.join(d, file);
}

// ── 递归保护 ────────────────────────────────────────────────────────────
// utilFile 内部要用 fs.existsSync 探测，而 fs.existsSync 被重定向 → 无限递归。
// 做法：把**原始**的 fs 方法先存一份，探测时一律用原始版本。
// （不要用 _inRedirect 计数来提前 return——那会让 resolveVirtual 在
//   utilFile 探测期间自我否定，直接返回 null，重定向形同虚设。）
const rawFs = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync
};
function exists(p) {
  try { return rawFs.existsSync(p); } catch (e) { return false; }
}

/**
 * utils 模块的绝对路径。分包后 utils 被拆成两处：
 *   utils/（主包：config/points/charge 相关的少量共享模块）
 *   pkgTools/utils/（工具侧：内容库、渲染引擎、mixin…）
 * 这个函数在两处都找，返回第一个存在的。
 * 支持嵌套相对路径（'core/render_engine.js'、'templates/index.js'）。
 */
function utilFile(file) {
  const rel = String(file || '').replace(/^\/+/, '');
  // require 允许省略扩展名（require('../utils/text_tools')），
  // 故按「原样 → .js → .json → /index.js」的顺序依次探测。
  const variants = [rel];
  if (!/\.[a-z]+$/i.test(rel)) variants.push(rel + '.js', rel + '.json', rel + '/index.js');
  for (const v of variants) {
    const cands = [];
    for (const root of SUB_ROOTS) cands.push(path.join(ROOT, root, 'utils', v));
    cands.push(path.join(ROOT, 'utils', v));
    for (const c of cands) {
      if (exists(c)) return c;
    }
  }
  return null;
}

/** 读 utils 模块的绝对路径（找不到抛错，报错信息明确） */
function utilPath(file) {
  const p = utilFile(file);
  if (!p) throw new Error('utilFile 找不到：' + file + '（主包 utils/ 与各分包 utils/ 都没有）');
  return p;
}

/**
 * 旧式路径重定向：resolve('pages', 'weather', 'weather.wxml')
 *   → 自动找到实际位置（主包 pages/ 或 pkgTools/pages/）
 * resolve('utils', 'card_style_mixin.js')
 *   → 自动找到实际位置
 *
 * 这样测试里原有的 rd(ROOT, 'pages', p, p+'.wxml') 只需把 ROOT 换成 resolve 即可，
 * 不必逐条改路径——下次再分包也不用动测试。
 */
function resolve(...parts) {
  const seg = parts.map(String);
  if (seg[0] === 'pages') {
    // pages/<name>/<file...>
    const dir = pageDirAbs(seg[1]);
    if (dir) return path.join(dir, ...seg.slice(2));
    return path.join(ROOT, ...seg);
  }
  if (seg[0] === 'utils') {
    const f = utilFile(seg[1]);
    if (f) return path.join(path.dirname(f), ...seg.slice(2));
    return path.join(ROOT, ...seg);
  }
  return path.join(ROOT, ...seg);
}

module.exports = {
  ROOT, APP, SUB_ROOTS, MAIN_PAGES, SUB_PAGES,
  pageDir, pageDirAbs, pageFile, utilFile, utilPath, resolve
};

// ─────────────────────────────────────────────────────────────────────────
// 「零侵入」方案：安装 require 钩子 + fs 路径重定向。
//
// 为什么需要：测试里有几百处 path.join(ROOT, 'pages', p, p+'.wxml') 这种写法，
// 逐处改既啰嗦又易错（我第一版正则就改崩了 11 个文件）。这里的做法是：
//   · 把 ROOT 下的 'pages' / 'utils' 登记为**虚拟目录**；
//   · 任何 fs.readFileSync / existsSync / require 走到这些虚拟路径时，
//     自动重定向到真实位置（主包 or 分包）。
//
// 这样测试代码**一行都不用改**，下次再分包也不用动测试。
//
// 实现要点：
//   ① 只重定向「看起来像页面目录」的第一段（pages/<name>），utils 同理；
//   ② 真实文件存在就直接用，不存在才走虚拟目录查找；
//   ③ 只挂 fs 的读取类 API，不动写操作（测试不该写产品目录）。
// ─────────────────────────────────────────────────────────────────────────

const REAL = [];   // 真实目录缓存：虚拟前缀 → 真实绝对路径

function resolveVirtual(absPath) {
  const norm = path.resolve(absPath);
  const root = path.resolve(ROOT);
  if (norm.indexOf(root) !== 0) return null;
  const rel = path.relative(root, norm).split(path.sep).join('/');

  // ⚠️ 路径**本身就是真实存在的目录** → 不重定向。
  //   例：'pages/index' 是真实目录（主包页面目录），'pages/index/index.js' 才需要重定向到
  //   pkgTools/pages/xxx/。若把目录也重定向，readFileSync 目录会 EISDIR。
  if (exists(norm)) return null;

  // pages/<name>/... 或 utils/<file[/nested]>
  //   ⚠️ 正则要能吃下嵌套路径（utils/core/render_engine.js），
  //     否则 core/xxx.js 匹配不上 → 重定向漏掉。
  const m = rel.match(/^(pages|utils)\/(.+)$/);
  if (!m) return null;
  const [, kind, rest] = m;

  if (kind === 'pages') {
    // pages/<name>/<file> → 页面目录 pages/<name> 或 pkgTools/pages/<name>
    //   第一段是页面名，其余是页面内的相对路径
    const seg = rest.split('/');
    const pageName = seg[0];
    const inside = seg.slice(1).join('/');
    const dir = pageDir(pageName);
    if (!dir) return null;
    return path.join(path.resolve(ROOT, dir), inside);
  }
  // utils/<file[/nested]> → 主包 utils/ 或分包 pkgTools/utils/
  //   用**完整相对路径**查（不能只取第一段）：utilFile 返回完整文件路径，
  //   再套 dirname 会把文件名丢掉 → require 拿到目录 → 挂起。
  const f = utilFile(rest);
  if (!f) return null;
  return f;
}

/** 让 fs 的读操作走虚拟目录重定向 */
function installFsRedirect() {
  // ⚠️ 只重定向**文件**读取类 API，不重定向 readdirSync / statSync / lstatSync / realpathSync：
  //   那几个是对**目录**求值的，而 'pages/<name>' 是虚拟路径（真实目录在 pkgTools 下），
  //   重定向它们会把「遍历 pages/ 目录」的调用解析到一个页面目录上 → ENOENT。
  //   目录遍历的用例（check_structure.js / run_all.js 的语法检查）需要看到**真实目录树**，
  //   而真实目录树本来就在磁盘上，不经虚拟路径，无需重定向。
  const fsTargets = ['readFileSync', 'existsSync'];
  const orig = {};
  fsTargets.forEach(k => { orig[k] = fs[k]; });
  fsTargets.forEach(k => {
    fs[k] = function (p, ...rest) {
      if (typeof p === 'string') {
        const hit = resolveVirtual(p);
        if (hit) return orig[k].call(fs, hit, ...rest);
      }
      return orig[k].call(fs, p, ...rest);
    };
  });
  return () => { fsTargets.forEach(k => { fs[k] = orig[k]; }); };
}

/** 让 require 也能找到虚拟路径下的文件（require 用的是绝对路径解析） */
function installRequireRedirect() {
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    try {
      return origResolve.call(this, request, parent, isMain, options);
    } catch (e) {
      // 把请求当成仓库内的虚拟路径再试一次。
      // ⚠️ 必须处理**相对请求**（'../utils/xxx.js'）——测试里大量用这种写法，
      //    而 Module._resolveFilename 内部已经把相对路径按 parent 解析成绝对路径再失败，
      //    所以这里要**自己**按 parent 的目录重新拼一次，再过虚拟目录解析。
      if (typeof request === 'string' && request.indexOf('.') >= 0 && parent && parent.filename) {
        const base = path.dirname(parent.filename);
        const abs = path.resolve(base, request);
        // ① 直接命中真实文件（原路径本来就对）
        try { return origResolve.call(this, abs, parent, isMain, options); } catch (e2) { /* 继续 */ }
        // ② 命中虚拟目录（pages/ 或 utils/）
        const hit = resolveVirtual(abs);
        if (hit) {
          try { return origResolve.call(this, hit, parent, isMain, options); } catch (e3) { /* 继续 */ }
          // ③ 命中目录 → 补默认扩展名（require('xxx') 形式）
          for (const ext of ['', '.js', '.json', '/index.js']) {
            const cand = hit + ext;
            try { return origResolve.call(this, cand, parent, isMain, options); } catch (e4) { /* 继续 */ }
          }
        }
      }
      throw e;
    }
  };
  return () => { Module._resolveFilename = origResolve; };
}

const root = path.resolve(ROOT);
let _restore = null;
/** 装上重定向（幂等） */
function install() {
  if (_restore) return;
  const r1 = installFsRedirect();
  const r2 = installRequireRedirect();
  _restore = () => { r1(); r2(); _restore = null; };
}
/** 卸掉重定向 */
function uninstall() {
  if (_restore) _restore();
}

module.exports.install = install;
module.exports.uninstall = uninstall;
module.exports.resolveVirtual = resolveVirtual;

// ─────────────────────────────────────────────────────────────────────────
// 自动安装（默认开）
//
// 为什么自动：这些测试既可能被 run_all.js 统一跑，也可能被单独跑
// （`node test/test_solar_layers.js`）、也可能被 CI 逐个调用。
// 若只在 run_all.js 里装钩子，单独跑就会全部 ENOENT ——
// 实测「run_all 全绿但单跑全红」是最难查的一类不一致。
//
// 故：本模块被 require 时就装上钩子。需要纯净环境时调 uninstall()。
// ─────────────────────────────────────────────────────────────────────────
install();
