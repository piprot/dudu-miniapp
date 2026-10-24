// tools_local/pack_volume_split.js —— 分包版包体核算（一次性工具，tools_local 不进包）
//
// 为什么要新写一个：老的 tools_local/pack_volume.js 只算「总体积」，
// 不知道 app.json 的 subPackages，无法回答「主包多少 / 各分包多少 / 预下载会不会超 2MB」。
//
// 判定口径与 test/check_audit_redlines.js 的 R7/R10 完全一致（同一套 packOptions.ignore 匹配规则），
// 所以这里的数字可以和闸门脚本互相印证。
//
// 用法：node tools_local/pack_volume_split.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const IGNORE = (cfg.packOptions && cfg.packOptions.ignore) || [];

const MAIN_LIMIT = 2 * 1024 * 1024;
const SUB_LIMIT = 2 * 1024 * 1024;
const TOTAL_LIMIT = 20 * 1024 * 1024;
const PRELOAD_LIMIT = 2 * 1024 * 1024;   // 平台口径：同一 preloadRule 下预下载分包体积之和 ≤ 2MB（code 20058）

function ignoredBy(rel) {
  const lower = rel.toLowerCase();
  return IGNORE.some(rule => {
    const v = String(rule.value || '').toLowerCase();
    if (!v) return false;
    switch (rule.type) {
      case 'folder': return lower === v || lower.indexOf(v + '/') === 0;
      case 'file':   return lower === v;
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

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name === '.git') continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const CLOUD_ROOT = (cfg.cloudfunctionRoot || '').replace(/\/$/, '');
const all = walk(ROOT);
const packed = all.filter(f => !ignoredBy(path.relative(ROOT, f).split(path.sep).join('/')));
const codePkg = packed.filter(f => {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  return !(CLOUD_ROOT && rel.indexOf(CLOUD_ROOT + '/') === 0);
});

const SUBPACKAGES = app.subPackages || app.subpackages || [];
const subRoots = SUBPACKAGES.map(sp => String(sp.root || '').replace(/\/$/, '')).filter(Boolean);
const pkgOf = rel => {
  for (const r of subRoots) if (rel === r || rel.indexOf(r + '/') === 0) return r;
  return '__main__';
};

const groups = { __main__: [] };
subRoots.forEach(r => { groups[r] = []; });
codePkg.forEach(f => {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  groups[pkgOf(rel)].push({ rel, size: fs.statSync(f).size });
});

const sizeOf = arr => arr.reduce((s, f) => s + f.size, 0);
const kb = n => (n / 1024).toFixed(1);
const mb = n => (n / 1048576).toFixed(2);

console.log('=== 分包包体核算 ===\n');
console.log('  主包  ' + String(groups.__main__.length).padStart(4) + ' 文件  '
  + mb(sizeOf(groups.__main__)).padStart(6) + ' MB / 2.00 MB  '
  + ((sizeOf(groups.__main__) / MAIN_LIMIT) * 100).toFixed(1).padStart(5) + '%  '
  + (sizeOf(groups.__main__) <= MAIN_LIMIT ? '✓' : '✗ 超限')
  + '   余 ' + kb(MAIN_LIMIT - sizeOf(groups.__main__)) + ' KB');
subRoots.forEach(r => {
  const s = sizeOf(groups[r]);
  console.log('  分包 ' + r.padEnd(11) + String(groups[r].length).padStart(4) + ' 文件  '
    + mb(s).padStart(6) + ' MB / 2.00 MB  ' + ((s / SUB_LIMIT) * 100).toFixed(1).padStart(5) + '%  '
    + (s <= SUB_LIMIT ? '✓' : '✗ 超限') + '   余 ' + kb(SUB_LIMIT - s) + ' KB');
});
const total = sizeOf(groups.__main__) + subRoots.reduce((s, r) => s + sizeOf(groups[r]), 0);
console.log('  合计  ' + String(codePkg.length).padStart(4) + ' 文件  ' + mb(total).padStart(6) + ' MB / 20.00 MB  '
  + (total <= TOTAL_LIMIT ? '✓' : '✗ 超限'));

// ── 预下载核算（R10 同口径）──
const nameToRoot = {};
SUBPACKAGES.forEach(sp => {
  const root = sp.root ? String(sp.root).replace(/\/$/, '') : '';
  if (sp.name) nameToRoot[sp.name] = root;
  if (root) nameToRoot[root] = root;
});
const preload = app.preloadRule || {};
const preloadLines = [];
Object.keys(preload).forEach(page => {
  const rule = preload[page] || {};
  const roots = (rule.packages || []).map(p => nameToRoot[p]).filter(Boolean);
  const sum = roots.reduce((s, r) => s + sizeOf(groups[r]), 0);
  preloadLines.push({ page, packages: rule.packages || [], network: rule.network || 'all', sum });
  console.log('  预下载 ' + page.padEnd(20) + ' → ' + (rule.packages || []).join(',')
    + '  (' + (rule.network || 'all') + ')  合计 ' + mb(sum) + ' MB / 2.00 MB  '
    + (sum <= PRELOAD_LIMIT ? '✓' : '✗ 超限(code 20058)'));
});
if (!preloadLines.length) console.log('  预下载  未声明 preloadRule（无预下载体积风险）');

// ── 各包 top10 大项 ──
console.log('\n--- 各包大项 top8 ---');
for (const k of Object.keys(groups)) {
  if (!groups[k].length) continue;
  console.log('  [' + k + ']');
  groups[k].slice().sort((a, b) => b.size - a.size).slice(0, 8)
    .forEach(f => console.log('    ' + kb(f.size).padStart(7) + ' KB  ' + f.rel));
}

// ── 结论 ──
const mainSize = sizeOf(groups.__main__);
const over = [];
if (mainSize > MAIN_LIMIT) over.push('主包超限');
subRoots.forEach(r => { if (sizeOf(groups[r]) > SUB_LIMIT) over.push('分包 ' + r + ' 超限'); });
if (total > TOTAL_LIMIT) over.push('合计超 20MB');
preloadLines.forEach(p => { if (p.sum > PRELOAD_LIMIT) over.push('预下载 ' + p.page + ' 超 2MB'); });

console.log('\n=== 结论 ===');
console.log(over.length ? '  ✗ ' + over.join('；') + '（不可提交）' : '  ✓ 全部包体合规，可提交审核');
process.exitCode = over.length ? 1 : 0;
