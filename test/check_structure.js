// 提审前全盘体检：页面四件套 / 跳转路径 / 图片引用 / require 图完整性（零依赖，只读）
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let bad = [];
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

// 1) 页面 4 件套完整性
for (const p of app.pages) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!fs.existsSync(path.join(ROOT, p + ext))) bad.push('缺文件: ' + p + ext);
  }
}

function walk(dir, exts, out) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) { if (f !== 'node_modules' && f !== '_backup') walk(fp, exts, out); }
    else if (exts.some(e => f.endsWith(e))) out.push(fp);
  }
}

// 2) 跳转路径有效性（页面相对路径按所在目录解析）
const valid = new Set(app.pages);
const navFiles = [];
walk(path.join(ROOT, 'pages'), ['.js', '.wxml'], navFiles);
navFiles.push(path.join(ROOT, 'app.js'));
const urlRe = /url:\s*['"`]([^'"`]+)['"`]/g;
for (const fp of navFiles) {
  const s = fs.readFileSync(fp, 'utf8');
  let u;
  while ((u = urlRe.exec(s))) {
    let p = u[1].split('?')[0];
    if (!p.startsWith('/')) p = '/' + path.relative(ROOT, path.resolve(path.dirname(fp), p)).replace(/\\/g, '/');
    if (p.startsWith('/pages/') && !valid.has(p.slice(1))) bad.push(path.relative(ROOT, fp) + ' → 无效页面: ' + u[1]);
  }
}

// 3) 本地图片引用存在性
const allFiles = [];
walk(path.join(ROOT, 'pages'), ['.wxml', '.js'], allFiles);
allFiles.push(path.join(ROOT, 'app.json'), path.join(ROOT, 'app.wxss'));
const imgRe = /['"](\/?images\/[^'"{}]+)['"]/g;
for (const fp of allFiles) {
  if (!fs.existsSync(fp)) continue;
  const s = fs.readFileSync(fp, 'utf8');
  let m;
  while ((m = imgRe.exec(s))) {
    if (!fs.existsSync(path.join(ROOT, m[1].replace(/^\//, '')))) bad.push(path.relative(ROOT, fp) + ' → 缺图片: ' + m[1]);
  }
}

// 4) require 图完整性：utils/pages 相对 require 目标存在
const reqRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const jsFiles = [];
walk(path.join(ROOT, 'pages'), ['.js'], jsFiles);
walk(path.join(ROOT, 'utils'), ['.js'], jsFiles);
for (const fp of jsFiles) {
  const s = fs.readFileSync(fp, 'utf8');
  let m;
  while ((m = reqRe.exec(s))) {
    const target = path.resolve(path.dirname(fp), m[1]);
    if (!fs.existsSync(target) && !fs.existsSync(target + '.js')) bad.push(path.relative(ROOT, fp) + ' → require 缺失: ' + m[1]);
  }
}

console.log(bad.length ? '✗ 发现问题:\n' + bad.join('\n') : '✓ 页面四件套 / 跳转路径 / 图片引用 / require 图 全部有效');
process.exitCode = bad.length ? 1 : 0;
