// 登录态缓存（只读）：个人主体以 openid 标识用户，openid 由虚拟支付服务端（vp_create_order 的
// sessionKey、vp_deliver/vp_get_profile 的 cloud.getWXContext().OPENID）注入，前端无需单独登录。
// 因此本模块只提供本地只读缓存；手机号登录（手机号快速验证组件）仅个体户/企业可用，已移除。
const ID_KEY = 'comic_identity_v1';

function getStored() {
  return wx.getStorageSync(ID_KEY) || null;
}

module.exports = { getStored };
