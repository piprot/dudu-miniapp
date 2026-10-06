// pages/weather/weather.js —— 天气心情卡（2026-10-06 新增 · 纯本地静态库，零 AI）
// 参照「天气星语」剥离星座/占卜风险后的纯本地版本：天气 + 心情 → 图文卡。
//   ① 选天气 ② 选心情 ③ 选城市（可选）④ 写一句（可选）⑤ 选本地图（可选）⑥ 一键成卡。
// 2026-10-06 起启用积分：每次成卡扣 5 分（charge('weatherCard')，单价见 config.POINTS.cost）。
//
// 城市方案（2026-10-06 定案）：省市级联 picker 选到「市」+ 最近使用快捷区。
//   不使用 wx.getLocation —— 它只回经纬度，拿不到城市名；变城市名必须走逆地理编码
//   （联网 → 域名白名单+备案；或离线坐标库 → 包体爆炸），且属隐私敏感信息需声明。
//   详见 utils/region_data.js 顶部说明。个人主体审核下这是合规最优解。
//
// 「天天换」实现：文案不写死，取自 utils/content_weather.js 的
//   8 天气 × 8 心情 = 64 组合 × 4 变体 = 256 条静态文案，
//   配合 utils/daily_rotate 按「日期 + 变体计数」轮换 → 同一天稳定、跨天必变、点「换一条」也变。
const { renderCard, saveCanvas } = require('../../utils/quote_card_render');
const { THEME_LIST } = require('../../utils/themes/index.js');
const { handlePrivacyApiFail } = require('../../utils/diag.js');
const { textFor, variantCount } = require('../../utils/content_weather');
const { seedOf } = require('../../utils/daily_rotate');
const region = require('../../utils/region_data');
const regionStore = require('../../utils/region_store');
const cardStyle = require('../../utils/card_style_mixin');  // 排版风格 + 背景图（四页共用）
const catPicker = require('../../utils/cat_picker_mixin.js'); // 分层选择器（大类→小类 + 常用前置）
const privacyPanel = require('../../utils/privacy_panel.js');
const { charge } = require('../../utils/charge.js');

const WEATHER = [
  { key: 'sunny', name: '晴', icon: '☀️' },
  { key: 'cloudy', name: '多云', icon: '⛅' },
  { key: 'rain', name: '雨', icon: '🌧️' },
  { key: 'snow', name: '雪', icon: '❄️' },
  { key: 'wind', name: '风', icon: '🌬️' },
  { key: 'fog', name: '雾', icon: '🌫️' },
  { key: 'thunder', name: '雷', icon: '⛈️' },
  { key: 'night', name: '夜', icon: '🌙' }
];
const MOODS = [
  { key: 'happy', name: '开心', icon: '😊' },
  { key: 'calm', name: '平静', icon: '😌' },
  { key: 'tired', name: '疲惫', icon: '😪' },
  { key: 'sad', name: '低落', icon: '😔' },
  { key: 'excited', name: '兴奋', icon: '🤩' },
  { key: 'anxious', name: '焦虑', icon: '😰' },
  { key: 'grateful', name: '感恩', icon: '🥰' },
  { key: 'lonely', name: '孤独', icon: '🫧' }
];

// ── 分层选择（2026-10-06）──────────────────────────────────────────────
// 旧版是「8 个天气格子 + 8 个心情格子」两段共 16 个选项一次性铺开，
// 用户反馈观感差、找不到起点。改成分层：
//   大类 = 今天什么天气 / 此刻心情（两个大区，用 segment 在顶部切换）
//   小类 = 该区里的具体项
//   常用 = 晴/开心/平静/多云——真实高频，置顶一步到位
// WEATHER / MOODS 保持扁平（渲染与文案逻辑依赖它们），分组只存在于 UI 层。
const PICKS = [
  { groupKey: 'w', name: '今天什么天气', items: WEATHER },
  { groupKey: 'm', name: '此刻心情', items: MOODS }
];
const HOT_PICKS = ['w:sunny', 'm:happy', 'm:calm', 'w:cloudy'];

function nameOf(list, key) { const it = list.find(x => x.key === key); return it ? it.name : ''; }
function emojiOf(list, key) { const it = list.find(x => x.key === key); return it ? (it.icon || '') : ''; }

const __pageCfg = {
  // 排版风格与背景图的字段由 card_style_mixin.defaults() 注入
  // （与节气/金句/台词书摘四页共用同一份定义，改一处全站生效）。
  // 用 Object.assign 而非对象展开：保持与本仓库其余代码一致，也避开
  // 「开发者工具转 ES5 时对象展开降级」的不确定性。
  data: Object.assign({
    privacyShow: false,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    weatherList: WEATHER,
    moodList: MOODS,
    weather: 'sunny',
    mood: 'happy',
    // 当前组合的回显（分层选择器下方的「晴 · 开心」）：从 WEATHER/MOODS 派生，
    // 别在 WXML 里做查找——模板表达式不该承担查表职责。
    weatherName: '晴', weatherEmoji: '☀️',
    moodName: '开心', moodEmoji: '😊',
    note: '',
    cover: '',
    // 城市（纯本地静态列表选中，零网络零隐私接口）。
    // provinceIdx/cityIdx 是 picker 的 range 索引；cityNames 是该省的市级列表。
    provinceIdx: 0,
    cityIdx: 0,
    provinceNames: region.PROVINCE_NAMES,
    cityNames: region.citiesOf(region.PROVINCE_NAMES[0]),
    province: region.PROVINCE_NAMES[0],
    city: '',
    cityLabel: '',        // 成卡用的地点文案，如「江苏苏州」
    recent: [],           // 最近使用过的城市（最多 6 个，点一下即选中）
    // 「换一条」计数器：驱动同一天内的文案轮换（跨天由日期种子自动换）
    variantTap: 0,
    autoText: '',        // 当前自动文案（预览给用户看「这句是库里的」）
    canvasH: 0,
    rendered: false,
    err: '',
    savedTick: 0,
    savedKey: ''
  }, cardStyle.defaults('literary')),

  onLoad() {
    this.initCardStyle('literary');
    // 图库只取前 24 张（mixin 内已做）：横向滚动足够，占用也小
    this.setData({ recent: regionStore.getRecent() });
    this.restoreCity();
    this.initPicker();
  },

  // 分层选择器：大类=天气/心情分区，小类=具体项
  initPicker() {
    const picker = catPicker.build({
      groups: PICKS.map(g => ({ key: g.groupKey, name: g.name, items: g.items })),
      hotKeys: HOT_PICKS,
      activeGroup: 'w',
      activeItem: this.data.weather || 'sunny',
      groupLabel: '选择',
      itemLabel: '细选'
    });
    Object.assign(this.data, picker.data);
    // 选中项写回页面字段（weather / mood）——这是分层选择器与旧页面的唯一接缝
    this._pickerOnChange = (it) => {
      if (!it) return;
      const gk = this.data.pgGroup;
      if (gk === 'w') this.setData({ weather: it.key });
      else if (gk === 'm') this.setData({ mood: it.key });
      this.syncComboEcho();
    };
    this.syncComboEcho();
  },

  // 同步「晴 · 开心」回显。每次改天气/心情都要调，否则回显会与实际组合脱节。
  syncComboEcho() {
    this.setData({
      weatherName: nameOf(WEATHER, this.data.weather),
      weatherEmoji: emojiOf(WEATHER, this.data.weather),
      moodName: nameOf(MOODS, this.data.mood),
      moodEmoji: emojiOf(MOODS, this.data.mood)
    });
  },

  // 恢复上次选中的城市；没有或已失效（数据改名）则保持未选状态。
  restoreCity() {
    const saved = regionStore.getCity();
    if (!saved) return;
    const provinceIdx = region.PROVINCE_NAMES.indexOf(saved.province);
    if (provinceIdx < 0) return;
    const cityNames = region.citiesOf(saved.province);
    const cityIdx = cityNames.indexOf(saved.city);
    if (cityIdx < 0) return;
    this.setData({
      provinceIdx, cityIdx, cityNames,
      province: saved.province,
      city: saved.city,
      cityLabel: region.shortName(saved.province, saved.city)
    });
  },

  //旧 onPickWeather / onPickMood 已删：选择统一由分层选择器（cat_picker_mixin）驱动。
  // 保留这两个作为兼容壳，避免别处（如自动化脚本/测试）调用时静默失败。
  onPickWeather(e) { this.setData({ weather: e.currentTarget.dataset.key }); this.syncComboEcho(); this.syncPicker({ groupKey: 'w', key: e.currentTarget.dataset.key }); },
  onPickMood(e) { this.setData({ mood: e.currentTarget.dataset.key }); this.syncComboEcho(); this.syncPicker({ groupKey: 'm', key: e.currentTarget.dataset.key }); },

  onNote(e) { this.setData({ note: e.detail.value }); },

  // 换省：重置市级列表并默认选中第一个市。
  onProvinceChange(e) {
    const provinceIdx = Number(e.detail.value) || 0;
    const province = region.PROVINCE_NAMES[provinceIdx];
    if (!province) return;
    const cityNames = region.citiesOf(province);
    this.setData({ provinceIdx, province, cityNames, cityIdx: 0, city: '' });
  },

  // 换市：立即落盘并记入「最近使用」。
  onCityChange(e) {
    const cityIdx = Number(e.detail.value) || 0;
    const city = this.data.cityNames[cityIdx];
    if (!city) return;
    const province = this.data.province;
    regionStore.setCity(province, city);
    this.setData({
      cityIdx,
      city,
      cityLabel: region.shortName(province, city),
      recent: regionStore.getRecent()
    });
  },

  // 点「最近使用」快捷条：直接跳到该城市并落盘。
  onPickRecent(e) {
    const province = e.currentTarget.dataset.province;
    const city = e.currentTarget.dataset.city;
    if (!region.isValid(province, city)) return;
    const provinceIdx = region.PROVINCE_NAMES.indexOf(province);
    const cityNames = region.citiesOf(province);
    const cityIdx = cityNames.indexOf(city);
    if (provinceIdx < 0 || cityIdx < 0) return;
    regionStore.setCity(province, city);
    this.setData({
      provinceIdx, cityIdx, cityNames,
      province, city,
      cityLabel: region.shortName(province, city),
      recent: regionStore.getRecent()
    });
  },

  // 清空已选城市（回到「不标地点」状态）。
  onClearCity() {
    regionStore.clearCity();
    this.setData({ city: '', cityLabel: '' });
    wx.showToast({ title: '已取消地点标注', icon: 'none' });
  },

  onChooseImage() {
    const self = this;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success(r) {
        const p = r.tempFiles && r.tempFiles[0] && r.tempFiles[0].tempFilePath;
        if (p) {
          self.setData({ cover: p, rendered: false });
          wx.showToast({ title: '已选图，点生成', icon: 'none' });
        }
      },
      fail(e) { handlePrivacyApiFail(self, '选择配图', e); }
    });
  },

  // ── 排版风格 / 背景图 的交互方法来自 cardStyle.cardStyleMethods ──
  //   onPickStyle · onPickBuiltinBg · onPickAlbumBg · onShufflePhoto
  //   onCyclePhotoMode · onClearPhoto（页面底部统一 Object.assign 注入）
  // 原因：节气 / 金句 / 台词书摘三页需要完全相同的一套，复制四份必然漂移。

  // 从静态库取当前该显示的文案。
  // 变体下标 = (日期种子 + 换一条点击次数) % 该组合条数
  //   → 同一天进来是同一句（稳定，不会每次 onLoad 乱跳）
  //   → 跨天自动换；点「换一条」在同一天内也能立刻换一句
  currentAutoText() {
    const { weather, mood, variantTap } = this.data;
    const total = variantCount(weather, mood) || 0;
    if (!total) return '';
    const base = seedOf(new Date(), 'weather:' + weather + '|' + mood) % total;
    const idx = (base + (Number(variantTap) || 0)) % total;
    return textFor(weather, mood, idx) || '';
  },

  onGen() {
    const wn = nameOf(WEATHER, this.data.weather);
    const mn = nameOf(MOODS, this.data.mood);
    const note = (this.data.note || '').trim();
    const locLabel = (this.data.cityLabel || '').trim();

    // 优先级：用户手写 > 静态库自动文案（256 条轮换）> 兜底句
    const auto = this.currentAutoText();
    const body = note || auto || ('今天' + (locLabel ? '在' + locLabel + '，' : '') + '天气' + wn + '，心情' + mn + '。记录此刻，留下一点画面感。');
    // ⚠️ 城市/天气降到 12px kicker 小字，金句升格为 hero 主体（2026-10-06）。
    // 旧版把「北京·晴·好心情」塞进 20px 粗体标题槽，天气信息比金句还抢眼——喧宾夺主。
    // 现在卡面层级是：主标题（可选）> 金句（20px 粗）> 城市天气（12px 灰）。
    const title = (locLabel ? locLabel + ' · ' : '') + wn + ' · ' + mn;
    const hasCover = !!this.data.cover;
    const type = hasCover ? 'imagetext' : 'quote';
    // 风格 + 背景由 card_style_mixin 组装（相册图优先于图库，都空则走主题渐变）。
    const base = hasCover
      ? Object.assign({ cover: this.data.cover }, { kicker: title, body, hero: true })
      : { kicker: title, body, hero: true };
    const data = cardStyle.applyCardStyle(this, base);
    this._lastData = { type, theme: this.data.theme, data };
    // 供 mixin.repaint 在风格/背景变化后原样重绘
    this._cardOpts = { canvasId: '#weatherCanvas', type, theme: this.data.theme, data };
    const self = this;
    this.setData({ err: '', autoText: note ? '' : auto });
    // ⚠️ 扣费在前、渲染在后：积分不足时**不产出**（charge 会 reject 并弹引导）。
    //    「换一条」也会走onGen → 同样扣 5 分（用户拍板「每次成卡扣 5 积分」）。
    //    改价只动 utils/config.js 的 POINTS.cost.weatherCard，云函数 GEN_COST 同名同值。
    charge('weatherCard', { label: '天气心情卡' }).then(() => {
      renderCard(self, { canvasId: '#weatherCanvas', type, theme: self.data.theme, data })
        .catch(err => { self.setData({ err: (err && err.message) || '生成失败' }); });
    }).catch(() => {
      self.setData({ err: '' });   // charge 已弹积分不足引导，不重复提示
    });
  },

  // 「换一条」：在当前天气×心情组合内轮换下一句，并立即重绘预览。
  onShuffle() {
    const total = variantCount(this.data.weather, this.data.mood) || 0;
    if (total <= 1) { wx.showToast({ title: '这个组合只有一条文案', icon: 'none' }); return; }
    // 用户手写文案优先时不轮换（避免覆盖用户内容），先提示
    if ((this.data.note || '').trim()) {
      wx.showToast({ title: '你写了自定义文案，清空后才会换', icon: 'none', duration: 2200 });
      return;
    }
    this.setData({ variantTap: (this.data.variantTap || 0) + 1 }, () => this.onGen());
  },

  onPickTheme(e) {
    // ⚠️ 兼容组件上抛（e.detail.id）与页面直绑（e.currentTarget.dataset.id）两种来源。
    //    背景图/风格已由 card_style_mixin 的 pickVal 统一处理；这个handler 是
    //    页面自己写的，得自己兼容——否则主题点击会静默失效。
    const ds = (e && e.detail) || {};
    const dd = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = ds.id || dd.id;
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id });
    if (this._lastData) {
      this._cardOpts = Object.assign({}, this._cardOpts, { theme: id });
      renderCard(this, { canvasId: '#weatherCanvas', type: this._lastData.type, theme: id, data: this._lastData.data }).catch(() => {});
    }
  },

  flipSaved() {
    const tick = (this.data.savedTick || 0) + 1;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this.setData({ savedTick: tick, savedKey: tick % 2 ? 'a' : 'b' });
    this._saveTimer = setTimeout(() => { this.setData({ savedKey: '' }); }, 1600);
  },

  onSaveImage() {
    const self = this;
    saveCanvas(self, {
      savingKey: '_saving',
      historyTool: 'weather',
      historyRecord: { kind: 'weather', title: (self._lastData && self._lastData.data.title) || '天气心情卡' }
    }).then(() => self.flipSaved()).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return;
      if (/auth|deny|authorize/i.test(msg)) return;
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  },

  onShareAppMessage() {
    return { title: 'dudu 画面感 · 天气心情卡', path: '/pages/weather/weather' };
  }
};

// 注入风格/背景交互（onPickStyle / onPickBuiltinBg / onPickAlbumBg /
//   onShufflePhoto / onCyclePhotoMode / onClearPhoto）
Object.assign(__pageCfg, cardStyle.cardStyleMethods, catPicker.build({ groups: [] }).methods);
Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
