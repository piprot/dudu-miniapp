// utils/ads.js —— 流量主广告统一管理器（2026-10-25 接入）
//
// 铁律（都是踩过坑换来的，改动前先读）：
//   ① 同一 adUnitId 全局只建一个实例。每页各建一份会互相抢加载，onClose/onError 回调还会
//      叠加注册 —— 一次关闭触发 N 次发奖，直接刷穿积分。单例 + 回调只注册一次从这里兜住。
//   ② 激励视频奖励只认 onClose 的 res.isEnded（看完才发）。前端只上报「看完了」，
//      发不发、发多少、今日上限全由服务端 points 云函数 adReward 裁决（见 utils/points.js）。
//   ③ 插屏带冷却（storage 时间戳）：微信广告运营规范要求不得频繁弹出影响体验
//      （以官方最新规则为准）；连点/来回切页面都不重复弹。
//   ④ 低版本/异常一律静默降级：不建实例、不抛到页面上，广告是增益不是主干。
//
// 广告 API 说明（基础库版本要求以微信官方文档为准，此处不写死版本号）：
//   wx.createRewardedVideoAd({ adUnitId })  激励视频：ad.onLoad/onError/onClose(res.isEnded)
//   wx.createInterstitialAd({ adUnitId })   插屏：    ad.onLoad/onError/onClose
//   <video ad-unit-id="...">                视频贴片：组件级广告，见 pages/index
//
// 测试：test/test_ads.js（mock 全局 wx，覆盖单例/isEnded/连点/重试/冷却/降级）。
const { POINTS } = require('./config.js');

const rewardedCache = {};      // adUnitId -> 激励视频实例
const interstitialCache = {};  // adUnitId -> 插屏实例
const rewardedPending = {};    // adUnitId -> { promise, resolve, reject }（连点只开一个）

const INTERSTITIAL_LAST_KEY = 'dudu_interstitial_last_v1';

function adsCfg() {
  return (POINTS && POINTS.ads) || {};
}

// ── 激励视频 ──────────────────────────────────────────────────────────────

function rewarded(adUnitId) {
  if (!adUnitId || typeof wx.createRewardedVideoAd !== 'function') return null;
  if (rewardedCache[adUnitId]) return rewardedCache[adUnitId];
  const ad = wx.createRewardedVideoAd({ adUnitId });
  // 回调只在这里注册一次（实例创建时），之后每次 show 都复用同一套回调
  ad.onLoad(() => {});
  ad.onError((err) => {
    console.error('[ads] 激励视频广告加载失败', adUnitId, err);
    const p = rewardedPending[adUnitId];
    delete rewardedPending[adUnitId];
    if (p && p.reject) p.reject(err || new Error('广告加载失败'));
  });
  ad.onClose((res) => {
    // isEnded=true 表示完整看完（30 秒）；false = 中途关闭 → 调用方不发奖
    const p = rewardedPending[adUnitId];
    delete rewardedPending[adUnitId];
    if (p && p.resolve) p.resolve({ isEnded: !!(res && res.isEnded) });
  });
  rewardedCache[adUnitId] = ad;
  return ad;
}

// 展示激励视频 → Promise<{ isEnded }>。
// 连点第二次不重复 show（返回同一个 Promise）；show 失败自动 load 后重试一次。
function showRewarded(adUnitId) {
  const ad = rewarded(adUnitId);
  if (!ad) return Promise.reject(new Error('当前微信版本不支持激励视频广告'));
  if (rewardedPending[adUnitId]) return rewardedPending[adUnitId].promise;
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  rewardedPending[adUnitId] = { promise, resolve, reject };
  ad.show().catch(() => {
    // 失败重试：先 load 再 show（官方推荐写法）
    ad.load()
      .then(() => ad.show())
      .catch((err) => {
        delete rewardedPending[adUnitId];
        reject(err || new Error('广告显示失败'));
      });
  });
  return promise;
}

// ── 插屏 ──────────────────────────────────────────────────────────────────

function interstitial(adUnitId) {
  if (!adUnitId || typeof wx.createInterstitialAd !== 'function') return null;
  if (interstitialCache[adUnitId]) return interstitialCache[adUnitId];
  const ad = wx.createInterstitialAd({ adUnitId });
  ad.onLoad(() => {});
  ad.onError((err) => { console.error('[ads] 插屏广告加载失败', adUnitId, err); });
  ad.onClose(() => {});
  interstitialCache[adUnitId] = ad;
  return ad;
}

function lastShowAt() {
  try { return wx.getStorageSync(INTERSTITIAL_LAST_KEY) || 0; } catch (e) { return 0; }
}

function markShown() {
  try { wx.setStorageSync(INTERSTITIAL_LAST_KEY, Date.now()); } catch (e) { /* 存储异常不阻断 */ }
}

// 冷却内不展示；展示成功才记时间戳（失败不记，留给下次重试）。
// 两个场景共用：冷启动（首页 onReady 延迟 1.5s）+ 进入积分页。
function maybeShowInterstitial(adUnitId, cooldownMs) {
  if (!adUnitId || typeof wx.createInterstitialAd !== 'function') return;
  const cd = typeof cooldownMs === 'number' ? cooldownMs : 60000;
  if (Date.now() - lastShowAt() < cd) return;
  const ad = interstitial(adUnitId);
  if (!ad) return;
  ad.show()
    .then(markShown)
    .catch(() => {
      ad.load()
        .then(() => ad.show())
        .then(markShown)
        .catch((err) => console.error('[ads] 插屏广告显示失败', err));
    });
}

// 预创建实例（创建即触发预加载）：app.js onLaunch 调用，
// 等首页 onReady 时广告通常已就绪，开屏场景不必现场等 load。
function preload() {
  const cfg = adsCfg();
  const it = cfg.interstitial || {};
  interstitial(it.adUnitId);
}

module.exports = { showRewarded, maybeShowInterstitial, preload };
