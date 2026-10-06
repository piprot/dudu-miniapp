// utils/fav.js
// ─────────────────────────────────────────────────────────────────────────────
// 「已添加到我的小程序」判定 —— 单一真相源，页面与组件都从这里读。
//
// ⚠️ 背景：微信小程序**没有**主动添加收藏的 API（`wx.addToFavorites` 是小游戏
//    的，小程序侧不存在），只有被动的 `Page.onAddToFavorites`。所以我们只能
//    「引导用户点右上角收藏」，然后**事后**判断收藏是否真的成功了。
//
// 判定依据 = 启动场景值 `scene`（`wx.getLaunchOptionsSync().scene`）。
// 从收藏 / 我的小程序 入口点进来时，微信会把这些场景码给我们：
//
//   1010  收藏夹                —— 用户从「收藏」的小程序打开
//   1103  发现页「我的小程序」   —— 基础库 2.29.1 起
//   1104  聊天下拉「我的小程序」 —— 基础库 2.29.1 起
//   1257  PC 面板「我的小程序」列表
//   1001  发现页最近使用        —— 基础库 2.2.4~2.29.0 时该入口含「我的小程序」
//   1089  聊天主界面下拉最近使用 —— 同上
//
// 关于 1001 / 1089：2.29.1 之前「最近使用」列表里就包含用户加过的「我的小程序」，
// 所以命中这两个值基本也意味着用户在用收藏功能。但它们同样会被「随手打开一次」
// 触发，语义不如 1103/1104 精确 —— 判 true 只是把按钮文案从「添加」改成
// 「已添加 ✓」，**不会给任何不该发的权益**，所以宁可稍宽、不必苛刻。
//
// ⚠️ 常见坑：scene 只在**冷启动**的 launchOptions 里有。热启动（切后台再回来）
//    走的是 `wx.getEnterOptionsSync()`，值可能为空。所以判定只在 onLoad 做一次。
// ─────────────────────────────────────────────────────────────────────────────

const KEY = '_addMineAdded';          // 本机是否已收藏过
const FAV_SCENES = [1010, 1103, 1104, 1257, 1001, 1089];

function isFavScene(scene) {
  return FAV_SCENES.indexOf(Number(scene)) >= 0;
}

/** 读本机收藏标记；存储不可用（隐私模式）时按「未收藏」走，不报错。 */
function isAdded() {
  try { return !!wx.getStorageSync(KEY); } catch (e) { return false; }
}

/** 写收藏标记。返回是否写入成功（失败不抛，避免打断页面流程）。 */
function markAdded() {
  try { wx.setStorageSync(KEY, true); return true; } catch (e) { return false; }
}

/**
 * 页面 onLoad 里调一次：读启动场景，命中收藏类场景就落标记。
 * @returns {boolean} 是否判定为「已收藏」
 */
function syncFromLaunch() {
  let scene = null;
  try {
    const opt = wx.getLaunchOptionsSync();
    if (opt) scene = opt.scene;
  } catch (e) { /* 拿不到就当没收藏 */ }
  if (isFavScene(scene)) { markAdded(); return true; }
  return isAdded();
}

/** 仅测试用：清掉标记 */
function _reset() {
  try { wx.removeStorageSync(KEY); } catch (e) { /* ignore */ }
}

module.exports = { KEY, FAV_SCENES, isFavScene, isAdded, markAdded, syncFromLaunch, _reset };
