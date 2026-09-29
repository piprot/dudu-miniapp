// 解锁状态：本地(赞赏码) + 服务端(微信支付回调) 合并判断
const KEY = 'comic_unlock_v1';

function getState() {
  return wx.getStorageSync(KEY) || { unlockedAll: false, serverUnlocked: false, codes: [] };
}
function isUnlockedAll() {
  const s = getState();
  return !!(s.unlockedAll || s.serverUnlocked);
}
function unlockAll() {        // 本地赞赏码路径
  const s = getState();
  s.unlockedAll = true;
  wx.setStorageSync(KEY, s);
}
function setServerUnlocked(v) { // 服务端解锁态（支付回调后由前端拉取或乐观置位）
  const s = getState();
  s.serverUnlocked = !!v;
  wx.setStorageSync(KEY, s);
}
function canRead(chapter) {
  if (chapter.free) return true;
  return isUnlockedAll();
}
module.exports = { getState, isUnlockedAll, unlockAll, setServerUnlocked, canRead };
