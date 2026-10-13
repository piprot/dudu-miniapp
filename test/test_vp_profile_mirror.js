// test/test_vp_profile_mirror.js
// 源码级守卫：vp_users 必须同时承载「昵称/头像」（管理员在云开发控制台看 vp_users 即可读到可读用户），
// 且写入时**绝不能整体覆盖积分等资产**。
//
// 背景（2026-10-13）：用户问「管理员能不能看到现在有哪些用户」，原回答是「云开发控制台看 vp_users（openid 列表）」，
// 但 vp_users 此前只存 openid + 积分，没有任何可读标识。昵称/头像本来由 vp_get_profile 的 updateProfile
// 写在 app_users（前端 loadProfile 读这里），vp_users 里全是一串 openid。本守卫确保：updateProfile 在写
// app_users 的同时，把昵称/头像镜像进 vp_users，且 syncVpProfile 用「先 get 再 update 单字段」而非 set 整体覆盖，
// 否则会把 points/coupons 等资产清零（严重线上事故）。
//
// 纯静态分析，不依赖云环境 / 微信基础库。
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'vp_get_profile', 'index.js'), 'utf8');
const POINTS_SRC = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'points', 'index.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + name + '  -> ' + (e && e.message));
  }
}

// 剥注释，便于精确匹配（注释里也会出现 vp_users / update 等字样）
function strip(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const code = strip(SRC);
const pointsCode = strip(POINTS_SRC);

t('vp_get_profile 定义 syncVpProfile 助手', () => {
  assert.ok(/function\s+syncVpProfile\s*\(/.test(code),
    '应定义 syncVpProfile 用于镜像昵称/头像到 vp_users');
});

t('updateProfile 在写 app_users 的同时调用 syncVpProfile 镜像到 vp_users', () => {
  const m = code.match(/if\s*\(\s*action\s*===\s*'updateProfile'\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(m, '未定位到 updateProfile 分支');
  const block = m[0];
  assert.ok(/app_users'\)\.doc\(OPENID\)\.update/.test(block),
    'updateProfile 仍应写入 app_users（前端 loadProfile 读这里）');
  assert.ok(/syncVpProfile\(db,\s*OPENID,\s*nickname,\s*avatar\)/.test(block),
    'updateProfile 必须镜像到 vp_users —— 否则管理员在 vp_users 看不到可读用户名');
});

t('syncVpProfile 写入的是 vp_users 集合', () => {
  assert.ok(/db\.collection\('vp_users'\)\.doc\(openid\)/.test(code),
    '镜像目标必须是 vp_users（积分/权益总表，管理员默认看它）');
});

t('syncVpProfile 先 get 再 update 单字段，绝不整体 set 覆盖资产', () => {
  const m = code.match(/async\s+function\s+syncVpProfile[\s\S]*?\n\}/);
  assert.ok(m, '未定位到 syncVpProfile 函数体');
  const body = m[0];
  assert.ok(/const\s+r\s*=\s*await\s*ref\.get\(\)/.test(body),
    '必须先 get 判断文档是否存在');
  assert.ok(/ref\.update\(\{\s*data:\s*patch\s*\}\)/.test(body),
    '文档存在时应仅 update 两个字段（nickname/avatar），不动 points');
  // ⚠️ 关键红线：绝不能在「文档存在」分支用 set 整体覆盖（会清空积分）。
  const existsBranch = body.replace(/const\s+r\s*=\s*await\s*ref\.get\(\)[\s\S]*?if\s*\(\s*r\s*&&\s*r\.data\s*\)\s*\{/, '')
    .replace(/\}\s*else\s*\{[\s\S]*$/, '');
  assert.ok(!/\.set\(\{\s*data:/.test(existsBranch),
    '文档已存在分支不得调用 set —— 否则 points/coupons 被整体覆盖清零');
});

t('syncVpProfile 仅在文档缺失时 set 最小安全默认值（含积分 0），且合并 patch', () => {
  const m = code.match(/async\s+function\s+syncVpProfile[\s\S]*?\n\}/);
  const body = m[0];
  const elseBranch = body.replace(/[\s\S]*?\}\s*else\s*\{/, '').replace(/\}\s*$/, '');
  assert.ok(/points:\s*0/.test(elseBranch),
    '缺失分支的最小默认值应显式带 points:0（明确而非遗漏）');
  assert.ok(/Object\.assign\(/.test(elseBranch),
    '缺失分支 set 时应 Object.assign 默认 + patch，避免丢掉 nickname/avatar');
});

t('points 云函数头部注释声明 vp_users 含 nickname/avatar', () => {
  // 注：这条是查「注释本身」，必须用原始源码（pointsCode 已被剥注释），故读 POINTS_SRC（未剥）。
  assert.ok(/nickname\(String\)\s*\/\s*avatar\(String/.test(POINTS_SRC) ||
    /nickname\/avatar/.test(POINTS_SRC),
    'points/index.js 的 vp_users 字段注释应补 nickname/avatar，保持 schema 文档同步');
});

t('前端采集入口已就绪（积分页「我的资料」卡片：选择头像 + 微信昵称输入）', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages', 'points', 'points.wxml'), 'utf8');
  assert.ok(/open-type="chooseAvatar"/.test(wxml), '应提供 chooseAvatar 选微信头像入口');
  assert.ok(/type="nickname"/.test(wxml), '应提供 type=nickname 微信昵称输入');
  const js = fs.readFileSync(path.join(ROOT, 'pages', 'points', 'points.js'), 'utf8');
  assert.ok(/vp_get_profile/.test(js) && /updateProfile/.test(js),
    'pages/points 应调用 vp_get_profile 的 updateProfile 落库');
});

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
if (fail > 0) process.exit(1);
