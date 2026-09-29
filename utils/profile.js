// utils/profile.js
// ─────────────────────────────────────────────────────────────────────────
// 「我的素材库」：用户在自己手机上保存的可复用素材（身份 / 产品 / 卖点 / 金句…）。
// 仅存于本地（wx.storage），不上传、不调用云端、不调用 AI。
//
// 作用：选类型时自动把对应素材填进模板槽位 → 一键即成文，体感像「自动生成」，
//       但本质是确定性的「素材 + 模板」拼装，不构成深度合成。
// ─────────────────────────────────────────────────────────────────────────

const KEY = 'dudu_profile_v1';

// 素材库字段（与 gen 页 FIELDS 的 key 对齐，外加通用字段）。
// quotes 为换行分隔的多条金句；sellingPoints 暂作展示用。
const PROFILE_KEYS = [
  'identity', 'audience', 'scene', 'point',
  'product', 'signal', 'evidence',
  'choice', 'reason', 'cost',
  'moment', 'feeling', 'meaning',
  'timePlace', 'person', 'turn', 'lookback'
];

function loadProfile() {
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      return wx.getStorageSync(KEY) || {};
    }
  } catch (e) { /* node / 沙箱无 wx：返回空 */ }
  return {};
}

function saveProfile(p) {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) {
      wx.setStorageSync(KEY, p || {});
      return true;
    }
  } catch (e) { /* 忽略 */ }
  return false;
}

// 把素材库映射到「当前类型」的模板字段（只填该类型用到的 key）。
function applyProfileToForm(kind, profile) {
  const f = {};
  const KF = {
    value: ['identity', 'audience', 'scene', 'point'],
    persona: ['identity', 'choice', 'reason', 'cost'],
    deal: ['identity', 'product', 'signal', 'evidence'],
    life: ['moment', 'feeling', 'meaning'],
    story: ['timePlace', 'person', 'turn', 'lookback']
  };
  (KF[kind] || []).forEach(k => {
    if (profile && profile[k] != null && String(profile[k]).trim()) f[k] = String(profile[k]).trim();
  });
  return f;
}

module.exports = { KEY, PROFILE_KEYS, loadProfile, saveProfile, applyProfileToForm };
