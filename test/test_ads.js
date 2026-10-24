// utils/ads.js 广告管理器单测（零依赖 · mock 全局 wx）
// 覆盖码小序铁律：同 adUnitId 单例 / onClose 只认 isEnded / 连点只开一个 /
//                 show 失败自动 load 重试 / 插屏冷却 / 低版本静默降级。
// 运行：node test/test_ads.js   期望：全部 PASS，退出码 0。
//
// 2026-10-24 分包改造：安装路径重定向钩子（utils/ 虚拟路径 → 真实位置）。
require('./_paths.js');
const assert = require('assert');
const path = require('path');

const ADS_PATH = path.join(__dirname, '..', 'utils', 'ads.js');

// ───────────────────────── wx mock ─────────────────────────
const created = [];        // 本次测试周期内建过的所有广告实例
const store = {};          // storage mock（插屏冷却时间戳）
let showFailTimes = 0;     // show 前 N 次调用失败（测重试链路）

function makeAd(kind, adUnitId) {
  return {
    kind: kind,
    adUnitId: adUnitId,
    showCalls: 0,
    loadCalls: 0,
    _cbs: {},
    onLoad(cb) { this._cbs.load = cb; },
    onError(cb) { this._cbs.error = cb; },
    onClose(cb) { this._cbs.close = cb; },
    show() {
      this.showCalls++;
      if (showFailTimes > 0) { showFailTimes--; return Promise.reject(new Error('show fail')); }
      return Promise.resolve();
    },
    load() { this.loadCalls++; return Promise.resolve(); },
    // 测试辅助：手动触发广告回调
    fireClose(res) { if (this._cbs.close) this._cbs.close(res); },
    fireError(err) { if (this._cbs.error) this._cbs.error(err); }
  };
}

global.wx = {
  // 默认「低版本」：两个工厂都是 null，用例里按需打开
  createRewardedVideoAd: null,
  createInterstitialAd: null,
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; }
};

function supportRewarded() {
  global.wx.createRewardedVideoAd = (o) => { const ad = makeAd('rewarded', o.adUnitId); created.push(ad); return ad; };
}
function supportInterstitial() {
  global.wx.createInterstitialAd = (o) => { const ad = makeAd('interstitial', o.adUnitId); created.push(ad); return ad; };
}

// 每个用例一套全新模块实例（ads.js 的实例缓存是模块级状态，必须清干净，
// 否则上一个用例的 onClose 回调/单例会串到下一个 —— 这正是「单例」要防的问题）。
function freshAds() {
  delete require.cache[require.resolve(ADS_PATH)];
  created.length = 0;
  Object.keys(store).forEach(k => delete store[k]);
  showFailTimes = 0;
  return require(ADS_PATH);
}

// 冲刷微任务/定时器：ads.js 里 ad.show().then(markShown) 是异步落时间戳的
async function flush() { await new Promise(r => setTimeout(r, 0)); }

async function errOf(p) { try { await p; return null; } catch (e) { return e; } }

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
}

(async () => {
  // ── 激励视频 ──
  await t('单例：同 adUnitId 两次 showRewarded，createRewardedVideoAd 只调 1 次', async () => {
    const ads = freshAds(); supportRewarded();
    const p1 = ads.showRewarded('adunit-x');
    ads.showRewarded('adunit-x');
    assert.strictEqual(created.length, 1, '同 adUnitId 只应建一个实例，实际 ' + created.length);
    created[0].fireClose({ isEnded: true });
    await p1;
  });

  await t('看完（isEnded=true）→ resolve { isEnded: true }（页面据此发奖）', async () => {
    const ads = freshAds(); supportRewarded();
    const p = ads.showRewarded('adunit-x');
    created[0].fireClose({ isEnded: true });
    const r = await p;
    assert.deepStrictEqual(r, { isEnded: true });
  });

  await t('中途关闭（isEnded=false）→ resolve { isEnded: false }（页面不发奖）', async () => {
    const ads = freshAds(); supportRewarded();
    const p = ads.showRewarded('adunit-x');
    created[0].fireClose({ isEnded: false });
    const r = await p;
    assert.deepStrictEqual(r, { isEnded: false }, '未看完必须显式 false，不能糊弄');
  });

  await t('连点：show 进行中再调 showRewarded → 同一个 Promise 且不再 show', async () => {
    const ads = freshAds(); supportRewarded();
    const p1 = ads.showRewarded('adunit-x');
    const p2 = ads.showRewarded('adunit-x');
    assert.strictEqual(p1, p2, '连点应复用同一个 Promise');
    created[0].fireClose({ isEnded: true });
    await p1; await p2;
    assert.strictEqual(created[0].showCalls, 1, 'show 只应调 1 次，实际 ' + created[0].showCalls);
  });

  await t('show 失败一次 → 自动 load 后重试成功，正常 resolve', async () => {
    const ads = freshAds(); supportRewarded();
    showFailTimes = 1;
    const p = ads.showRewarded('adunit-x');
    await flush();   // 等 catch → load → show 链路跑完
    assert.strictEqual(created[0].loadCalls, 1, '失败后应 load 一次，实际 ' + created[0].loadCalls);
    assert.strictEqual(created[0].showCalls, 2, '应重试 show 一次，实际 ' + created[0].showCalls);
    created[0].fireClose({ isEnded: true });
    const r = await p;
    assert.deepStrictEqual(r, { isEnded: true });
  });

  await t('show 连续失败（load 后仍失败）→ reject，pending 清理（下次可重来）', async () => {
    const ads = freshAds(); supportRewarded();
    showFailTimes = 2;
    const err = await errOf(ads.showRewarded('adunit-x'));
    assert.ok(err, '连续失败应 reject');
    // pending 已清理 → 再次调用是新的 Promise，且又走了一遍 show
    const p2 = ads.showRewarded('adunit-x');
    assert.notStrictEqual(p2, undefined);
    created[0].fireClose({ isEnded: true });
    const r = await p2;
    assert.deepStrictEqual(r, { isEnded: true }, 'pending 清理后应能正常再看一次');
  });

  await t('onError → reject（广告加载失败不挂死页面）', async () => {
    const ads = freshAds(); supportRewarded();
    const p = ads.showRewarded('adunit-x');
    created[0].fireError(new Error('boom'));
    const err = await errOf(p);
    assert.ok(err && /boom/.test(err.message), '应把 onError 转成 reject');
  });

  await t('低版本（无 createRewardedVideoAd）→ reject 且不抛异常', async () => {
    const ads = freshAds();   // 默认工厂为 null
    const err = await errOf(ads.showRewarded('adunit-x'));
    assert.ok(err, '低版本应 reject（页面 toast 降级），不能静默 resolve');
  });

  // ── 插屏 ──
  await t('preload：预创建插屏实例（配置里的 adUnitId）', async () => {
    const ads = freshAds(); supportInterstitial();
    ads.preload();
    assert.strictEqual(created.length, 1, '应预创建 1 个插屏实例');
    assert.strictEqual(created[0].kind, 'interstitial');
    assert.strictEqual(created[0].adUnitId, 'adunit-e705e2bf34033c2f', '应用 config.POINTS.ads.interstitial.adUnitId');
  });

  await t('插屏首次展示 → show 并记 storage 时间戳', async () => {
    const ads = freshAds(); supportInterstitial();
    ads.maybeShowInterstitial('adunit-i', 60000);
    await flush();
    assert.strictEqual(created[0].showCalls, 1, '冷却外应展示');
    assert.ok(store['dudu_interstitial_last_v1'] > 0, '展示成功应记时间戳');
  });

  await t('插屏冷却内（60s）→ 不再 show（防频繁骚扰）', async () => {
    const ads = freshAds(); supportInterstitial();
    ads.maybeShowInterstitial('adunit-i', 60000);
    await flush();
    const before = created[0].showCalls;
    ads.maybeShowInterstitial('adunit-i', 60000);
    await flush();
    assert.strictEqual(created[0].showCalls, before, '冷却内不得再次展示');
    assert.strictEqual(created.length, 1, '冷却内连实例都不该新建');
  });

  await t('插屏冷却外（时间戳往前挪 2 分钟）→ 复用同一实例再展示', async () => {
    const ads = freshAds(); supportInterstitial();
    ads.maybeShowInterstitial('adunit-i', 60000);
    await flush();
    store['dudu_interstitial_last_v1'] = Date.now() - 120000;
    ads.maybeShowInterstitial('adunit-i', 60000);
    await flush();
    assert.strictEqual(created.length, 1, '仍应复用单例，不新建');
    assert.strictEqual(created[0].showCalls, 2, '冷却外应再展示一次');
  });

  await t('插屏低版本（无 createInterstitialAd）→ 静默返回不抛', async () => {
    const ads = freshAds();   // 工厂为 null
    ads.maybeShowInterstitial('adunit-i', 60000);
    await flush();
    assert.strictEqual(created.length, 0, '低版本不应建实例');
  });

  console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
  process.exitCode = fail ? 1 : 0;
})();
