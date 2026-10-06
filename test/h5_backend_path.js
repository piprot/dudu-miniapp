// test/h5_backend_path.js
// ─────────────────────────────────────────────────────────────────────────
// h5_backend / ai_gen 定位器（2026-10-06 新增）
//
// 背景：ai_gen 源码 2026-09-30 从本小程序仓库移出，独立成 h5_backend 仓。
//   移出后，多个测试仍硬编码相对路径 require('../../h5_backend/ai_gen/index.js')，
//   只要本仓 clone 位置变了（或与 h5_backend 不再是固定层级），就 MODULE_NOT_FOUND。
//
// 本模块职责：**按优先级探测 ai_gen 真实位置**，供各测试文件统一使用。
// 探测顺序（先近后远）：
//   1. process.env.H5_BACKEND_DIR —— 显式覆盖，永远优先（CI 推荐）
//   2. test/local-paths.json      —— 本机私有配置（已 gitignore，不进仓库）
//   3. <repo>/../h5_backend        —— 标准兄弟目录
//   4. <repo>/h5_backend          —— monorepo 同目录布局
//
// ⚠️ 刻意不把绝对路径写死在本文件里：
//   test/ 虽被 packOptions.ignore 排除、不进小程序包，但仍会进 git 仓库。
//   写死 C:/Users/<用户名>/... 会把本机用户名与目录结构公开到远端，
//   且对任何其他人都不成立——纯属负收益。
//
//   本机一次性配置（两种任选）：
//     ① 新建 test/local-paths.json：{ "h5BackendDir": "D:/path/to/h5_backend" }
//     ② 设环境变量：H5_BACKEND_DIR=D:/path/to/h5_backend
//   两者都无→ 相关套件显式 SKIP 并打印已尝试位置（见下方 warnIfMissing）。
//
// ⚠️ 设计原则：**找到就真校验，找不到就显式 SKIP 并说明原因，绝不静默假红，
//    也不静默假绿**（曾出现「执行异常」被 run_all 标成 ✓ 的情况）。
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCAL_CFG = path.join(__dirname, 'local-paths.json');

/** 读本机私有配置；文件不存在或损坏都当作没配（不能因配置问题让测试崩）。 */
function readLocalCfg() {
  try {
    if (!fs.existsSync(LOCAL_CFG)) return {};
    return JSON.parse(fs.readFileSync(LOCAL_CFG, 'utf8')) || {};
  } catch (e) { return {}; }
}

function candidateBases() {
  const list = [];
  if (process.env.H5_BACKEND_DIR) list.push(process.env.H5_BACKEND_DIR);
  const local = readLocalCfg().h5BackendDir;
  if (local) list.push(local);
  list.push(path.join(ROOT, '..', 'h5_backend'));
  list.push(path.join(ROOT, 'h5_backend'));
  return list;
}

// 返回 ai_gen/index.js 的绝对路径；找不到返回 null
function findAiGen() {
  for (const base of candidateBases()) {
    const p = path.join(base, 'ai_gen', 'index.js');
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 忽略 */ }
  }
  return null;
}

const AI_GEN_PATH = findAiGen();

// 供测试文件做「跳过还是失败」决策
function requireAiGen() {
  if (!AI_GEN_PATH) {
    const e = new Error(
      '找不到 h5_backend/ai_gen/index.js。\n'
      + '  已尝试：\n' + candidateBases().map(b => '    · ' + b).join('\n') + '\n'
      + '  解决办法（二选一）：\n'
      + '    ① 设环境变量 H5_BACKEND_DIR 指向 h5_backend 仓根目录\n'
      + '    ② 把 h5_backend 放到 dudu-miniapp 的兄弟目录'
    );
    e.code = 'H5_BACKEND_NOT_FOUND';
    throw e;
  }
  return require(AI_GEN_PATH);
}

// 没找到时打印一次醒目提示（各套件开头调用，避免"静默跳过"）
let warned = false;
function warnIfMissing(who) {
  if (AI_GEN_PATH || warned) return false;
  warned = true;
  console.log('⚠️  [' + who + '] 未找到 h5_backend/ai_gen/index.js —— 本套件将 SKIP。\n'
    + '    已尝试：\n' + candidateBases().map(b => '      · ' + b).join('\n') + '\n'
    + '    设 H5_BACKEND_DIR 或把 h5_backend 放在兄弟目录即可恢复守护。\n');
  return true;
}

module.exports = { ROOT, LOCAL_CFG, AI_GEN_PATH, findAiGen, requireAiGen, warnIfMissing, candidateBases, readLocalCfg };
