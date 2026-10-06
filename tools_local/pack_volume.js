// tools_local/pack_volume.js —— 包体核算（一次性，tools_local 不进包）
// 复现 project.config.json 的 packOptions.ignore（folder/file/suffix 三类），
// 得到贴近开发者工具真实打包的体积，用于判断还能塞多少内置资源。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
const ignore = ((cfg.packOptions || {}).ignore) || [];

const skipFolders = new Set();
const skipFiles = new Set();
const skipSuffix = [];
for (const r of ignore) {
  if (r.type === 'folder') skipFolders.add(r.value);
  else if (r.type === 'file') skipFiles.add(r.value);
  else if (r.type === 'suffix') skipSuffix.push(r.value);
}

const LIMIT = 2 * 1024 * 1024;   // 主包上限 2MB
let total = 0;
const byDir = {};

(function walk(rel) {
  const abs = path.join(ROOT, rel);
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith('.') && rel === '') continue;      // 顶层点目录
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (skipFolders.has(e.name)) continue;
      walk(r);
    } else {
      if (skipFiles.has(e.name)) continue;
      if (skipSuffix.some(s => e.name.toLowerCase().endsWith(String(s).toLowerCase()))) continue;
      const size = fs.statSync(path.join(ROOT, r)).size;
      total += size;
      const top = r.split('/').slice(0, 2).join('/');
      byDir[top] = (byDir[top] || 0) + size;
    }
  }
})('');

const kb = n => Math.round(n / 1024);
console.log('打包总体积 ' + kb(total) + 'KB / 2048KB   剩余 ' + kb(LIMIT - total) + 'KB');
console.log('占用率 ' + (total / LIMIT * 100).toFixed(1) + '%');
console.log('--- 大项 top10 ---');
Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([k, v]) => console.log('  ' + String(kb(v)).padStart(5) + 'KB  ' + k));