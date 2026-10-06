// utils/region_store.js —— 城市选择记忆（纯本地 Storage，零网络）
//
// 目的：省市级联要点两层，用「最近用过」把多数情况压成点一下。
// 全部数据只在本机 wx Storage，不上传、不同步。
const { isValid } = require('./region_data');

const KEY = 'dudu_weather_city_v1';
const RECENT_KEY = 'dudu_weather_recent_v1';
const MAX_RECENT = 6;

/** 读当前选中的城市。脏数据（手动改过 Storage / 版本升级改名）一律回退为空。 */
function getCity() {
  const v = wx.getStorageSync(KEY);
  if (!v || typeof v !== 'object') return null;
  if (!isValid(v.province, v.city)) return null;
  return { province: v.province, city: v.city };
}

/** 写入当前选中城市，并顺手推进「最近使用」。 */
function setCity(province, city) {
  if (!isValid(province, city)) return false;
  wx.setStorageSync(KEY, { province, city });
  pushRecent(province, city);
  return true;
}

function getRecent() {
  const arr = wx.getStorageSync(RECENT_KEY);
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    if (!it || !isValid(it.province, it.city)) continue;   // 过滤脏值
    if (out.some(x => x.city === it.city)) continue;        // 同城去重（按城市判重）
    // key 供 wxml wx:key 用：省+市组合，唯一且稳定
    out.push({ key: it.province + '/' + it.city, province: it.province, city: it.city });
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

/** 把城市提到最近使用最前（LRU）。同省不同市视为不同条目，便于「本省常去」。 */
function pushRecent(province, city) {
  const next = [{ province, city }].concat(getRecent().filter(x => x.city !== city));
  wx.setStorageSync(RECENT_KEY, next.slice(0, MAX_RECENT));
}

/** 换省时若目标省不在最近使用里，清掉跨省的旧选择，避免 picker 索引错位。 */
function clearCity() {
  wx.removeStorageSync(KEY);
}

module.exports = { KEY, RECENT_KEY, MAX_RECENT, getCity, setCity, getRecent, pushRecent, clearCity };