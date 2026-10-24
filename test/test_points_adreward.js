// points 云函数 · 看激励视频赚积分（adReward）单测（零依赖 · 纯 Node 断言）
// 做法：Stub 掉 wx-server-sdk（内存版云数据库，支持 CAS 条件更新），mock Date.now() 控制
//      「当前时间」，真实驱动「首次发放 / 达当日上限 / 跨天重置 / 未知 slot / 并发 CAS」分支。
// 背景（2026-10-25 接入流量主）：客户端只上报「完整看完哪个 slot」，发不发、发多少、
//      今日上限全在服务端裁决——这些用例就是钉这套裁决的。
// 运行：node test/test_points_adreward.js   期望：全部 PASS，退出码 0。
//
// 2026-10-24 分包改造：安装路径重定向钩子（pages/ 与 utils/ 的虚拟路径 → 真实位置）。
require('./_paths.js');
const assert = require('assert');
const path = require('path');
const Module = require('module');

// ───────────────────────── 1. 内存版云数据库 Stub（与 test_points_daily 同款） ─────────────────────────
const store = {};                 // openid -> doc
let casForceFail = false;         // 置 true 时下一次条件更新返回 updated:0（模拟并发被抢）
let casFailKey = null;            // 限定只让「条件里含该字段」的那一次 CAS 失败（null = 任意一次）

function applyData(doc, data) {
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (v && typeof v === 'object' && typeof v.$inc === 'number') {
      doc[k] = (typeof doc[k] === 'number' ? doc[k] : 0) + v.$inc;
    } else {
      doc[k] = v;
    }
  });
}

const cloudStub = {
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  init() {},
  getWXContext: () => ({ OPENID: 'u1' }),
  database: () => ({
    collection: () => ({
      doc: (id) => ({
        get: async () => { if (!store[id]) throw new Error('document does not exist'); return { data: Object.assign({}, store[id]) }; },
        set: async ({ data }) => { store[id] = Object.assign({}, data); return { stats: {} }; },
        update: async ({ data }) => {
          if (!store[id]) throw new Error('document does not exist');
          applyData(store[id], data);
          return { stats: { updated: 1 } };
        }
      }),
      // 乐观锁（CAS）：条件里除 _id 外的每个字段都必须与文档现值严格相等才允许写入。
      // adReward 的 CAS 条件用的是扁平字段 ad_<slot>_count，与 daily 的 lastDailyDate 同套路。
      where: (cond) => ({
        update: async ({ data }) => {
          const keys = Object.keys(cond).filter(k => k !== '_id');
          if (casForceFail && (!casFailKey || keys.indexOf(casFailKey) >= 0)) {
            casForceFail = false; casFailKey = null;
            return { stats: { updated: 0 } };
          }
          const id = cond._id;
          if (!store[id]) return { stats: { updated: 0 } };
          // 字段缺失（undefined）≠ 条件值 —— 与真实云数据库语义一致
          if (keys.some(k => store[id][k] !== cond[k])) return { stats: { updated: 0 } };
          applyData(store[id], data);
          return { stats: { updated: 1 } };
        }
      })
    }),
    command: { inc: (n) => ({ $inc: n }), gte: (n) => ({ $gte: n }) },
    serverDate: () => new Date().toISOString()
  })
};

// ───────────────────────── 2. 时间 mock（北京时间 UTC+8）─────────────────────────
const DAY = 86400000;
let nowTs = Date.parse('2026-10-25T02:00:00Z');   // = 北京 2026-10-25 10:00
const realNow = Date.now;
Date.now = () => nowTs;
function setNow(iso) { nowTs = Date.parse(iso); }

// ───────────────────────── 3. 注入 Stub 后加载被测模块 ─────────────────────────
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return cloudStub;
  if (request === 'https' || request === 'http') return { request: () => ({ on() {}, write() {}, end() {}, destroy() {}, setTimeout() {} }), get: () => ({ on() {} }) };
  return origLoad.apply(this, arguments);
};
const pointsFn = require(path.join(__dirname, '..', 'cloudfunctions', 'points', 'index.js'));

// ───────────────────────── 4. 用例 ─────────────────────────
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
}
function reset(doc) {
  Object.keys(store).forEach(k => delete store[k]);
  // 默认当「已领过新人礼」的老用户，避免 80 分新人礼干扰余额断言
  store.u1 = Object.assign({ openid: 'u1', signupBonusAt: 1 }, doc || {});
  casForceFail = false;
  casFailKey = null;
}
const adReward = (slot) => pointsFn.main({ action: 'adReward', slot: slot });

(async () => {
  // 首次看广告：+10，落库 count=1，left=2
  await t('首次看视频：+10，count=1，left=2，余额入账', async () => {
    reset({ openid: 'u1', points: 100 });
    setNow(atBeijingISO(2026, 10, 25, 10));
    const r = await adReward('points_main');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.awarded, 10, '首次应 +10，实际 ' + r.awarded);
    assert.strictEqual(r.left, 2, '剩余应为 2，实际 ' + r.left);
    assert.strictEqual(r.capped, undefined, '未达上限不该标记 capped');
    assert.strictEqual(store.u1.points, 110, 'DB 余额应为 110');
    assert.strictEqual(store.u1.ad_points_main_date, '2026-10-25');
    assert.strictEqual(store.u1.ad_points_main_count, 1);
  });

  // 第 2、3 次：继续 +10，left 递减
  await t('第 2、3 次：+10 / +10，left=1 / 0（上限内逐次发放）', async () => {
    const r2 = await adReward('points_main');
    assert.strictEqual(r2.awarded, 10);
    assert.strictEqual(r2.left, 1, '第 2 次后剩余应为 1，实际 ' + r2.left);
    const r3 = await adReward('points_main');
    assert.strictEqual(r3.awarded, 10);
    assert.strictEqual(r3.left, 0, '第 3 次后剩余应为 0，实际 ' + r3.left);
    assert.strictEqual(store.u1.points, 130, '100+30=130，实际 ' + store.u1.points);
    assert.strictEqual(store.u1.ad_points_main_count, 3);
  });

  // 第 4 次：达当日上限 → capped，不发不扣
  await t('第 4 次（达当日上限 3）：capped=true，awarded=0，余额不动', async () => {
    const r = await adReward('points_main');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.capped, true, '达上限应标记 capped');
    assert.strictEqual(r.awarded, 0, '达上限不得再发，实际 ' + r.awarded);
    assert.strictEqual(r.left, 0);
    assert.strictEqual(store.u1.points, 130, '余额不得变动，实际 ' + store.u1.points);
    assert.strictEqual(store.u1.ad_points_main_count, 3, '计数不得增加');
  });

  // 两个 slot 独立计数：main 看满了，second 还能看
  await t('两个 slot 独立计数：main 看满不影响 second（各 3 次/天）', async () => {
    const r = await adReward('points_second');
    assert.strictEqual(r.awarded, 10, 'second 应还能发，实际 ' + JSON.stringify(r));
    assert.strictEqual(r.left, 2);
    assert.strictEqual(store.u1.points, 140);
    assert.strictEqual(store.u1.ad_points_second_count, 1);
  });

  // 跨天：日期变了 → count 重置，可再发
  await t('跨天（北京 10-26）：当日计数重置，可再次发放', async () => {
    setNow(atBeijingISO(2026, 10, 26, 9));
    const r = await adReward('points_main');
    assert.strictEqual(r.awarded, 10, '新的一天应能再发，实际 ' + JSON.stringify(r));
    assert.strictEqual(r.left, 2);
    assert.strictEqual(store.u1.ad_points_main_date, '2026-10-26');
    assert.strictEqual(store.u1.ad_points_main_count, 1);
    assert.strictEqual(store.u1.points, 150);
  });

  // 北京时间日界：UTC 16:00 前后差 1 秒，分属北京两天
  await t('北京时间日界：UTC 15:59:59Z（北京 10-26）看完第 3 次后，UTC 16:00:00Z（北京 10-27）重置', async () => {
    reset({ openid: 'u1', points: 0 });
    setNow('2026-10-26T15:59:59Z');   // 北京 10-26 23:59:59
    for (let i = 0; i < 3; i++) await adReward('points_main');
    assert.strictEqual(store.u1.ad_points_main_count, 3);
    const capped = await adReward('points_main');
    assert.strictEqual(capped.capped, true, '北京 10-26 应已看满');
    setNow('2026-10-26T16:00:00Z');   // 北京 10-27 00:00:00
    const r = await adReward('points_main');
    assert.strictEqual(r.awarded, 10, '北京 10-27 应重置可看，实际 ' + JSON.stringify(r));
    assert.strictEqual(store.u1.ad_points_main_date, '2026-10-27');
  });

  // 未知 slot：白名单外一律拒绝（防伪造 slot 白嫖）
  await t('未知 slot → ok:false 拒绝，不发放', async () => {
    reset({ openid: 'u1', points: 100 });
    const r = await adReward('not_a_slot');
    assert.strictEqual(r.ok, false, '未登记 slot 必须被拒：' + JSON.stringify(r));
    assert.ok(/未知广告位/.test(r.err), '应提示未知广告位，实际 ' + r.err);
    assert.strictEqual(store.u1.points, 100, '被拒时不得变动');
  });

  // 空 slot：同样拒绝（前端漏传/篡改）
  await t('空 slot → ok:false 拒绝', async () => {
    const r = await adReward('');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(store.u1.points, 100);
  });

  // 并发 CAS 被抢 → 不重复发放（连点/双端同时回调）
  await t('并发 CAS 被抢 → awarded=0 且不重复入账', async () => {
    reset({ openid: 'u1', points: 100 });
    casForceFail = true;
    casFailKey = 'ad_points_main_count';   // 只让 adReward 的 CAS 失败
    const r = await adReward('points_main');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.awarded, 0, 'CAS 被抢不得发放，实际 ' + r.awarded);
    assert.strictEqual(r.capped, true);
    assert.strictEqual(store.u1.points, 100, '余额不得变动，实际 ' + store.u1.points);
  });

  // 老文档无 ad 字段 → ensureUser 自动补齐后可正常发放
  await t('老文档（无 ad 字段）：自动补齐后正常发放 +10', async () => {
    reset({ openid: 'u1', points: 500 });   // 无任何 ad_* 字段
    const r = await adReward('points_second');
    assert.strictEqual(r.awarded, 10, '老文档应能正常发放，实际 ' + JSON.stringify(r));
    assert.strictEqual(store.u1.points, 510);
    assert.strictEqual(store.u1.ad_points_second_count, 1, '补齐后计数应落库');
  });

  // balance 返回 adLeft：看完 1 次 main → main left=2、second left=3
  await t('balance 返回 adLeft（看完 1 次 main：main=2 / second=3）', async () => {
    reset({ openid: 'u1', points: 0 });
    setNow(atBeijingISO(2026, 10, 25, 10));
    await adReward('points_main');
    const b = await pointsFn.main({ action: 'balance' });
    assert.strictEqual(b.ok, true, JSON.stringify(b));
    assert.strictEqual(b.adLeft.points_main, 2, 'main 剩余应为 2，实际 ' + b.adLeft.points_main);
    assert.strictEqual(b.adLeft.points_second, 3, 'second 剩余应为 3，实际 ' + b.adLeft.points_second);
  });

  // balance 对没有文档的用户：adLeft 满额（不抛错）
  await t('balance 无文档用户：adLeft 满额、points=0', async () => {
    Object.keys(store).forEach(k => delete store[k]);
    const b = await pointsFn.main({ action: 'balance' });
    assert.strictEqual(b.ok, true);
    assert.strictEqual(b.points, 0);
    assert.strictEqual(b.adLeft.points_main, 3);
    assert.strictEqual(b.adLeft.points_second, 3);
  });

  // 回归：daily / spend 未被广告改动破坏
  await t('回归 daily：签到照常 +30 且幂等', async () => {
    reset({ openid: 'u1', points: 0 });
    setNow(atBeijingISO(2026, 10, 25, 10));
    const r1 = await pointsFn.main({ action: 'daily' });
    assert.strictEqual(r1.awarded, 30, '签到应 +30，实际 ' + r1.awarded);
    const r2 = await pointsFn.main({ action: 'daily' });
    assert.strictEqual(r2.awarded, 0, '同日应幂等');
    assert.strictEqual(store.u1.points, 30);
  });
  await t('回归 spend：兑换照常扣 200 且服务端校验成本', async () => {
    reset({ openid: 'u1', points: 300, coupons: [] });
    const ok = await pointsFn.main({ action: 'spend', reason: 'comic_discount', delta: 200, grant: { type: 'comic_discount', value: 0.9 } });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    assert.strictEqual(ok.points, 100);
    const bad = await pointsFn.main({ action: 'spend', reason: 'comic_discount', delta: 1, grant: { type: 'comic_discount', value: 0.9 } });
    assert.strictEqual(bad.ok, false, '低成本必须被拒');
  });

  console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
  Date.now = realNow;
  process.exitCode = fail ? 1 : 0;
})();

// 构造"北京时间某时刻"的 ISO 字符串（带 +08:00 偏移）
function atBeijingISO(y, m, d, hh) {
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return y + '-' + pad(m) + '-' + pad(d) + 'T' + pad(hh) + ':00:00+08:00';
}
