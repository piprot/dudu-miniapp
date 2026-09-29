// points 云函数 · 每日登录奖励 + 新人礼单测（零依赖 · 纯 Node 断言）
// 做法：Stub 掉 wx-server-sdk（内存版云数据库，支持「乐观锁 CAS」条件更新），并 mock Date.now()
//      控制"当前时间"，从而真实驱动「跨天 / 连签 / 断签 / 里程碑 / 新人礼只发一次」等分支。
//
// 当前参数（用户拍板，2026-09-23 调整）：base=30，连签每日 +1，封顶 +10（第 11 天起恒 40/天），
//                      里程碑：每连签 7 天额外 +15。
//                      新人礼（2026-09-23 由 100 降为 80）：每个用户首次登录一次性 +80。
// 运行：node test/test_points_daily.js
// 期望：全部 PASS，退出码 0。
const assert = require('assert');
const path = require('path');
const Module = require('module');

// ───────────────────────── 1. 内存版云数据库 Stub ─────────────────────────
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
      // 乐观锁（CAS）：条件里除 _id 外的**每个**字段都必须与文档现值严格相等才允许写入。
      // 现在有两个 CAS 共用这条路：每日签到（lastDailyDate）与新人礼（signupBonusAt），
      // 所以不能再只比 lastDailyDate —— 否则新人礼的 CAS 会被误判为"成功"而假绿。
      where: (cond) => ({
        update: async ({ data }) => {
          const keys = Object.keys(cond).filter(k => k !== '_id');
          if (casForceFail && (!casFailKey || keys.indexOf(casFailKey) >= 0)) {
            casForceFail = false; casFailKey = null;
            return { stats: { updated: 0 } };
          }
          const id = cond._id;
          if (!store[id]) return { stats: { updated: 0 } };
          // 字段缺失（undefined）≠ 条件值 —— 与真实云数据库 where({f: 0}) 不匹配缺失字段的语义一致
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
let nowTs = Date.parse('2026-09-17T02:00:00Z');   // = 北京 2026-09-17 10:00
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
  // 默认把用例都当成「已领过新人礼」的老用户（signupBonusAt: 1），
  // 这样既有的签到用例仍然只测签到逻辑、余额断言不被 80 分干扰；
  // 新人礼专属用例显式传 signupBonusAt: 0。
  store.u1 = Object.assign({ openid: 'u1', signupBonusAt: 1 }, doc || {});
  casForceFail = false;
  casFailKey = null;
}
const daily = () => pointsFn.main({ action: 'daily' });

(async () => {
  // 基础：首次领取（base=30）
  await t('首次签到：+30，streak=1，落库正确', async () => {
    reset({ openid: 'u1', points: 0 });
    setNow(atBeijingISO(2026, 9, 17, 10));
    const r = await daily();
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.awarded, 30, '首次应 +30，实际 ' + r.awarded);
    assert.strictEqual(r.streak, 1);
    assert.strictEqual(r.points, 30);
    assert.strictEqual(store.u1.points, 30, 'DB 余额应为 30');
    assert.strictEqual(store.u1.lastDailyDate, '2026-09-17');
    assert.strictEqual(store.u1.dailyStreak, 1);
  });

  // 幂等：同日重复调用
  await t('同日重复调用：awarded=0 / already=true，余额与 streak 不变', async () => {
    const r = await daily();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.awarded, 0, '同日不应再发，实际 ' + r.awarded);
    assert.strictEqual(r.already, true);
    assert.strictEqual(store.u1.points, 30, '余额不应变，实际 ' + store.u1.points);
    assert.strictEqual(store.u1.dailyStreak, 1);
  });

  // 连签：次日 +31（base 30 + 连签加成 1）
  await t('次日连签：streak=2，+31（余额 30→61）', async () => {
    setNow(atBeijingISO(2026, 9, 18, 9));
    const r = await daily();
    assert.strictEqual(r.awarded, 31, '连签第2天应 +31，实际 ' + r.awarded);
    assert.strictEqual(r.streak, 2);
    assert.strictEqual(store.u1.points, 61, '余额应为 61，实际 ' + store.u1.points);
  });

  // 连签第 6 天：尚未封顶 = 30 + min(5,10) = 35
  await t('连签第 6 天：+35（未封顶）', async () => {
    reset({ openid: 'u1', points: 0, lastDailyDate: '2026-09-21', dailyStreak: 5 });
    setNow(atBeijingISO(2026, 9, 22, 9));   // 昨天=09-21 → 连签 6
    const r = await daily();
    assert.strictEqual(r.streak, 6);
    assert.strictEqual(r.awarded, 35, '第 6 天应为 35，实际 ' + r.awarded);
  });

  // 连签加成封顶：第 11 天 = 30 + min(10,10) = 40
  await t('连签第 11 天：奖励封顶 +40', async () => {
    reset({ openid: 'u1', points: 0, lastDailyDate: '2026-09-30', dailyStreak: 10 });
    setNow(atBeijingISO(2026, 10, 1, 9));   // 昨天=09-30 → 连签 11
    const r = await daily();
    assert.strictEqual(r.streak, 11);
    assert.strictEqual(r.awarded, 40, '封顶应为 40，实际 ' + r.awarded);
  });

  // 里程碑：连签第 7 天 = 30 + 6 + 15 = 51，且标记 milestone
  await t('连签第 7 天（里程碑）：+51 且 milestone=true', async () => {
    reset({ openid: 'u1', points: 0, lastDailyDate: '2026-09-22', dailyStreak: 6 });
    setNow(atBeijingISO(2026, 9, 23, 9));   // 昨天=09-22 → 连签 7
    const r = await daily();
    assert.strictEqual(r.streak, 7);
    assert.strictEqual(r.awarded, 51, '里程碑应为 30+6+15=51，实际 ' + r.awarded);
    assert.strictEqual(r.milestone, true);
  });

  // 断签：隔两天 → 重置为 1（重新 +30）
  await t('断签（隔两天）：streak 重置 1，+30', async () => {
    reset({ openid: 'u1', points: 100, lastDailyDate: '2026-09-20', dailyStreak: 9 });
    setNow(atBeijingISO(2026, 9, 23, 9));   // 昨天=09-22 ≠ 09-20 → 断签
    const r = await daily();
    assert.strictEqual(r.streak, 1, '断签应重置为 1，实际 ' + r.streak);
    assert.strictEqual(r.awarded, 30);
    assert.strictEqual(store.u1.points, 130);
  });

  // 并发：CAS 失败 → 不重复发放
  await t('并发 CAS 失败 → already=true 且不重复发放', async () => {
    reset({ openid: 'u1', points: 50, lastDailyDate: '2026-09-16', dailyStreak: 3 });
    setNow(atBeijingISO(2026, 9, 17, 10));
    casForceFail = true;
    const r = await daily();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.awarded, 0, 'CAS 失败不应发放，实际 ' + r.awarded);
    assert.strictEqual(r.already, true);
    assert.strictEqual(store.u1.points, 50, '余额不应变，实际 ' + store.u1.points);
  });

  // 北京时间日界：UTC 15:59:59Z vs 16:00:00Z 相差 1 秒，但分属北京 09-17 / 09-18
  await t('北京时间日界：UTC 16:00 = 北京次日 00:00，算新的一天', async () => {
    reset({ openid: 'u1', points: 0 });
    setNow('2026-09-17T15:59:59Z');          // 北京 09-17 23:59:59
    const r1 = await daily();
    assert.strictEqual(r1.today, '2026-09-17', '应为北京 09-17，实际 ' + r1.today);
    assert.strictEqual(r1.streak, 1);

    setNow('2026-09-17T16:00:00Z');          // 北京 09-18 00:00:00（比上一步只晚 1 秒）
    const r2 = await daily();
    assert.strictEqual(r2.today, '2026-09-18', '应为北京 09-18，实际 ' + r2.today);
    assert.strictEqual(r2.awarded, 31, '应算新的一天并连签（streak 2 → 31），实际 ' + r2.awarded);
    assert.strictEqual(r2.streak, 2);
  });

  // 老用户文档缺字段 → 自动补齐并可正常领取
  await t('缺 lastDailyDate/dailyStreak 的老文档：自动补齐后可领取', async () => {
    reset({ openid: 'u1', points: 300, coupons: [] });   // 无每日字段
    setNow(atBeijingISO(2026, 9, 17, 10));
    const r = await daily();
    assert.strictEqual(r.awarded, 30, '应正常发放，实际 ' + r.awarded);
    assert.strictEqual(typeof store.u1.lastDailyDate, 'string');
    assert.strictEqual(store.u1.dailyStreak, 1);
    assert.strictEqual(store.u1.points, 330);
  });

  // 回归：balance / spend 未被破坏
  await t('回归 balance：返回余额与优惠券', async () => {
    const r = await pointsFn.main({ action: 'balance' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.points, 330);
    assert.ok(Array.isArray(r.coupons));
  });
  await t('回归 spend：扣减 + 落地 grant；余额不足被拒', async () => {
    const ok = await pointsFn.main({ action: 'spend', reason: 'comic_discount', delta: 200, grant: { type: 'comic_discount', value: 0.9 } });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    assert.strictEqual(ok.points, 130);
    assert.strictEqual(store.u1.coupons.length, 1);
    // 余额不足：用**登记过且成本正确**的 reason + delta（否则会先被「未知兑换项」/「成本不符」拦下，
    // 就测不到余额这条了）。此时 u1 余额 130 < 200，先于去重命中「积分不足」。
    const bad = await pointsFn.main({ action: 'spend', reason: 'comic_discount', delta: 200 });
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.err, '积分不足');
  });

  // 服务端成本校验（2026-09-23 新增）：防被篡改的客户端低价兑换（此前服务端不校验成本）。
  await t('成本校验：未知兑换项 → 拒绝、不扣分', async () => {
    reset({ openid: 'u1', points: 300, coupons: [] });
    const r = await pointsFn.main({ action: 'spend', reason: 'not_registered', delta: 200, grant: { type: 'not_registered', value: 0.9 } });
    assert.strictEqual(r.ok, false, '未登记兑换项必须被拒：' + JSON.stringify(r));
    assert.ok(/未知兑换项/.test(r.err), '应提示未知兑换项，实际 ' + r.err);
    assert.strictEqual(store.u1.points, 300, '被拒时不得扣分');
  });
  await t('成本校验：delta 与登记成本不符 → 拒绝、不扣分、不发券（低价/高价都拒）', async () => {
    reset({ openid: 'u1', points: 300, coupons: [] });
    const low = await pointsFn.main({ action: 'spend', reason: 'comic_discount', delta: 1, grant: { type: 'comic_discount', value: 0.9 } });
    assert.strictEqual(low.ok, false, '低于成本的 delta 必须被拒（否则 1 积分换走 200 分券）：' + JSON.stringify(low));
    assert.ok(/兑换成本不符/.test(low.err), '应提示成本不符，实际 ' + low.err);
    const high = await pointsFn.main({ action: 'spend', reason: 'comic_discount', delta: 999, grant: { type: 'comic_discount', value: 0.9 } });
    assert.strictEqual(high.ok, false, '高于成本的 delta 也应被拒：' + JSON.stringify(high));
    assert.strictEqual(store.u1.points, 300, '被拒时余额不得变动');
    assert.strictEqual((store.u1.coupons || []).length, 0, '被拒时不得发券');
  });

  // 防重复兑换（2026-09-20 新增）：同一权益只允许持有一张。
  // 前端会把已拥有的兑换项置灰，但前端可绕过（直接调云函数 = 白扣两次分），
  // 所以真正的约束必须在服务端 —— 这条用例就是守它。
  await t('防重复兑换：已持有同类型权益时拒绝，不扣分、不重复入账', async () => {
    reset({ openid: 'u1', points: 300, coupons: [] });
    const first = await pointsFn.main({ action: 'spend', reason: 'comic_discount', delta: 200, grant: { type: 'comic_discount', value: 0.9 } });
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    assert.strictEqual(first.points, 100, '首次兑换后应为 100');
    const again = await pointsFn.main({ action: 'spend', reason: 'comic_discount', delta: 200, grant: { type: 'comic_discount', value: 0.9 } });
    assert.strictEqual(again.ok, false, '重复兑换应被拒，实际 ' + JSON.stringify(again));
    assert.strictEqual(again.points, 100, '被拒时余额不得变动');
    assert.strictEqual(store.u1.points, 100, 'DB 余额不得变动');
    assert.strictEqual(store.u1.coupons.length, 1, '券不得重复入账，实际 ' + store.u1.coupons.length);
  });

  // ═════════════════════ 新人礼（每个用户首次登录一次性 +80）═════════════════════

  // 首次登录：新人礼与当日签到同一次调用里一起到账
  await t('新人礼｜首次登录：signupBonus=80 且签到 +30（余额 110）', async () => {
    reset({ openid: 'u1', points: 0, signupBonusAt: 0 });
    setNow(atBeijingISO(2026, 9, 17, 10));
    const r = await daily();
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.signupBonus, 80, '首次应发新人礼 80，实际 ' + r.signupBonus);
    assert.strictEqual(r.awarded, 30, '签到应 +30，实际 ' + r.awarded);
    assert.strictEqual(r.points, 110, '余额应为 110（80+30），实际 ' + r.points);
    assert.strictEqual(store.u1.points, 110, 'DB 余额应为 110');
    assert.ok(store.u1.signupBonusAt > 0, 'signupBonusAt 应写入领取时间戳，实际 ' + store.u1.signupBonusAt);
  });

  // 幂等：同一次调用再打一遍，新人礼绝不重发
  await t('新人礼｜重复调用：signupBonus=0，余额不变（不重复赠分）', async () => {
    const r = await daily();
    assert.strictEqual(r.signupBonus, 0, '不应重复发新人礼，实际 ' + r.signupBonus);
    assert.strictEqual(r.awarded, 0, '同日签到也应幂等');
    assert.strictEqual(store.u1.points, 110, '余额不应变，实际 ' + store.u1.points);
  });

  // 跨天：新人礼只发一次，后续只发签到
  await t('新人礼｜次日：signupBonus 仍为 0，只发连签奖励', async () => {
    setNow(atBeijingISO(2026, 9, 18, 9));
    const r = await daily();
    assert.strictEqual(r.signupBonus, 0, '跨天也不应再发新人礼');
    assert.strictEqual(r.awarded, 31, '连签第 2 天应 +31');
    assert.strictEqual(store.u1.points, 141, '余额应为 110+31=141，实际 ' + store.u1.points);
  });

  // 并发：新人礼 CAS 被抢 → 不发放，且不影响同一次的签到
  await t('新人礼｜并发 CAS 被抢：signupBonus=0 且不重复赠分（签到不受影响）', async () => {
    reset({ openid: 'u1', points: 0, signupBonusAt: 0 });
    setNow(atBeijingISO(2026, 9, 17, 10));
    casForceFail = true;
    casFailKey = 'signupBonusAt';        // 只让新人礼那一次 CAS 失败
    const r = await daily();
    assert.strictEqual(r.signupBonus, 0, 'CAS 被抢不应发新人礼，实际 ' + r.signupBonus);
    assert.strictEqual(r.awarded, 30, '签到不应受新人礼 CAS 失败影响，实际 ' + r.awarded);
    assert.strictEqual(store.u1.points, 30, '只应有签到那 30，实际 ' + store.u1.points);
    assert.strictEqual(store.u1.signupBonusAt, 0, 'signupBonusAt 应仍为 0（未领，留待下次）');
  });

  // 老用户文档缺 signupBonusAt 字段 → 补齐后可领（并行于 lastDailyDate 的补齐逻辑）
  await t('新人礼｜无 signupBonusAt 字段的老文档：补齐后正常领取', async () => {
    reset({ openid: 'u1', points: 500 });
    delete store.u1.signupBonusAt;       // 模拟"该字段上线前就存在的文档"
    setNow(atBeijingISO(2026, 9, 17, 10));
    const r = await daily();
    assert.strictEqual(typeof store.u1.signupBonusAt, 'number', 'ensureUser 应补齐 signupBonusAt');
    assert.strictEqual(r.signupBonus, 80, '老用户也享有一次新人礼（"每个用户"的字面实现）');
    assert.strictEqual(store.u1.points, 610, '500+80+30=610，实际 ' + store.u1.points);
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
