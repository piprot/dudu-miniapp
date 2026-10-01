// test/test_charge_units.js
// 单元测试 utils/charge.js 的扣费流程（纯本地、用 mock 的 wx 与 points，不依赖云函数 / 微信基础库）。
//
// 覆盖场景：
//   ① 余额不足 → charge 拒绝 + 弹「积分不足」引导去积分页，且不调用 spend；
//   ② 余额充足 → charge resolve(true) 且 spend(reason, cost) 被调用一次；
//   ③ spend 失败 → charge 拒绝 + 弹「积分扣除失败」toast；
//   ④ 成本为 0 的 action → 直接放行，不读余额、不扣费；
//   ⑤ costOf 正确读回 config.POINTS.cost 的单价。
//
// 用 require.cache 注入假的 points 模块，让 charge.js 的 require('./points') 命中假模块，
// 从而把「读余额 / 扣费」这两步云函数交互完全可控。
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── wx 全局 mock（charge 在调用时才读 global.wx）──
const captured = { modal: null, toast: null, nav: null };
global.wx = {
  showModal(o) { captured.modal = o; if (o && typeof o.success === 'function') o.success({ confirm: false }); },
  showToast(o) { captured.toast = o; },
  navigateTo(o) { captured.nav = o; }
};

// ── 假 points 模块（可配置余额 / 扣费是否失败）──
let balanceToReturn = 0;
let spendShouldFail = false;
const spendCalls = [];
const fakePoints = {
  getBalance() { return Promise.resolve({ points: balanceToReturn, coupons: [] }); },
  spend(reason, delta) {
    spendCalls.push({ reason, delta });
    if (spendShouldFail) return Promise.reject(new Error('spend fail'));
    return Promise.resolve({ ok: true, points: (balanceToReturn - delta) });
  }
};
const pointsPath = path.join(ROOT, 'utils', 'points.js');
require.cache[require.resolve(pointsPath)] = {
  id: pointsPath, filename: pointsPath, loaded: true, exports: fakePoints
};

const { charge, costOf } = require(path.join(ROOT, 'utils', 'charge.js'));
const { POINTS } = require(path.join(ROOT, 'utils', 'config.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(() => { pass++; console.log('  PASS  ' + name); })
    .catch(e => { fail++; console.log('  FAIL  ' + name + '  -> ' + (e && e.message)); });
}

async function run() {
  // ⑤ 单价读回
  await t('costOf 正确读回 config.POINTS.cost', () => {
    assert.strictEqual(costOf('momentsGen'), POINTS.cost.momentsGen, 'momentsGen 单价不一致');
    assert.strictEqual(costOf('optFormat'), POINTS.cost.optFormat, 'optFormat 单价不一致');
    assert.strictEqual(costOf('comicGen'), POINTS.cost.comicGen, 'comicGen 单价不一致');
    assert.strictEqual(costOf('cardGen'), POINTS.cost.cardGen, 'cardGen 单价不一致');
    assert.strictEqual(costOf('nonexistent'), 0, '未知 action 应为 0（免费）');
  });

  // ④ 零成本 action 直接放行
  await t('成本为 0 的 action 直接放行，不读余额 / 不扣费', () => {
    spendCalls.length = 0;
    balanceToReturn = 0; // 即使余额不足，零成本也不应拦
    return charge('nonexistent', { label: '测试' }).then(ok => {
      assert.strictEqual(ok, true, '零成本应 resolve(true)');
      assert.strictEqual(spendCalls.length, 0, '零成本不应调用 spend');
    });
  });

  // ① 余额不足
  await t('余额不足 → 拒绝 + 弹「积分不足」引导，不扣费', () => {
    spendCalls.length = 0;
    captured.modal = null; captured.toast = null; captured.nav = null;
    balanceToReturn = 5; // momentsGen 单价 20，不足
    return charge('momentsGen', { label: '套模板出文案', reason: '套模板出文案' }).then(
      () => { throw new Error('应当 reject，却 resolve 了'); },
      (err) => {
        assert.strictEqual(err.message, 'insufficient', '应 reject insufficient');
        assert.ok(captured.modal, '应弹出「积分不足」modal');
        assert.ok(/套模板出文案/.test(captured.modal.content), 'modal 文案应含工具名');
        assert.ok(/20/.test(captured.modal.content), 'modal 文案应含单价 20');
        assert.strictEqual(captured.modal.confirmText, '去积分', '确认按钮应为「去积分」');
        assert.strictEqual(spendCalls.length, 0, '余额不足不应调用 spend');
      }
    );
  });

  // ② 余额充足 → 真正扣费
  await t('余额充足 → resolve(true) 且 spend(reason, cost) 调用一次', () => {
    spendCalls.length = 0;
    captured.modal = null; captured.toast = null;
    balanceToReturn = 100;
    return charge('comicGen', { label: '生成分镜', reason: '生成分镜' }).then(ok => {
      assert.strictEqual(ok, true, '应 resolve(true)');
      assert.strictEqual(spendCalls.length, 1, '应恰好调用一次 spend');
      assert.strictEqual(spendCalls[0].reason, '生成分镜', 'spend 的 reason 应为传入值');
      assert.strictEqual(spendCalls[0].delta, POINTS.cost.comicGen, 'spend 的 delta 应等于单价');
      assert.strictEqual(captured.modal, null, '成功不应弹「积分不足」modal');
    });
  });

  // ③ spend 失败 → 拒绝 + toast
  await t('spend 失败 → 拒绝 + 弹「积分扣除失败」toast', () => {
    spendCalls.length = 0;
    captured.modal = null; captured.toast = null;
    balanceToReturn = 100;
    spendShouldFail = true;
    return charge('cardGen', { label: '生成卡片', reason: '生成卡片' }).then(
      () => { spendShouldFail = false; throw new Error('应当 reject，却 resolve 了'); },
      (err) => {
        spendShouldFail = false;
        assert.strictEqual(err.message, 'spend fail', '应 reject spend fail');
        assert.ok(captured.toast, '应弹出 toast');
        assert.ok(/扣除失败/.test(captured.toast.title), 'toast 文案应提示扣除失败');
      }
    );
  });

  console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
  if (fail > 0) process.exit(1);
}

run().catch(e => { console.error('测试运行异常：', e); process.exit(2); });
