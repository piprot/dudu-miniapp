// utils/card_style_mixin.js —— 卡片「排版风格 + 背景图」共享逻辑（2026-10-06）
//
// ── 为什么抽这个 mixin ──────────────────────────────────────────────────
// 天气/节气/金句/台词书摘四个页面都要「参照日签模块生成分享图」，
// 且都要支持：换排版风格、从相册选背景、从内置图库选背景、取消背景。
// 复制四份必然漂移（改一处忘三处），故把状态 + 交互 + 持久化 + 重绘收在一处，
// 页面只需 Object.assign(pageCfg, cardStyle.methods) 并在渲染前调 applyCardStyle()。
//
// ── 能力边界（与 utils/font_kit.js 同源）──────────────────────────────
//  · 风格只改排版参数（字体族/字号/字距/对齐/装饰），不落地字体文件——
//    主包 2MB 上限 + loadFontFace 不读包内路径 + canvas 不支持，三条硬墙。
//  · 背景图分**两级来源**（2026-10-06 定案）：
//      album手机相册（用户自己的图，临时路径，不落盘）
//      builtin  内置压缩兜底图（包内 /images/bg/*.jpg，零网络零白名单，永远能出图）← 默认
//    两级互斥：选相册清内置，选内置清相册。
//
// ── 为什么没有第三级「网络图库」（2026-10-06 移除）──────────────────────
//  曾经有picsum 100 张网络图库，但它是**从未真正可用过**的增强项：
//  canvas createImage() 加载网络图受后台 downloadFile 白名单管辖，而该白名单
//  至今未配置 → 那一百张图一张都出不来，只是让用户多点一次、白等一次失败。
//  内置 60 张已覆盖全部需求（480×640 深色调、作者分散、永久可用），故整层删除：
//  utils/photo_lib.js、onPickPhoto、onToggleNetLib 惰性探测、netAvailable 状态机全没了。
//  附带收益：applyCardStyle 不再需要判定远程/本地并挂 bgFallback，
//  首屏与出卡路径上彻底不存在任何网络请求。
//  · 背景加载失败由 quote_card_render 内部处理：图加载失败 → 回落内置兜底图 →
//    再失败才 delete model.backgroundImage 回退主题渐变，任何一级都不白卡。
//
// ── 持久化取舍 ─────────────────────────────────────────────────────────
//  风格 / 背景图 ID / 背景来源 / 处理方式 → 存本地（跨页面、跨启动保持一致）。
//  相册临时路径 → **不存**（chooseMedia 的 tempFilePath 会被系统回收，
//  存下来下次启动就是坏图），只在本次会话内有效。

const bgPack = require('./bg_pack');
const fontKit = require('./font_kit');
const { handlePrivacyApiFail } = require('./diag.js');
const { renderCard } = require('./quote_card_render');

const KEY = 'dudu_card_style_v1';
const PHOTO_MODES = ['gray', 'blur', 'raw'];
// 命名说明：内置图走引擎蒙版近似，不是真灰度/真高斯模糊（见 BUILTIN_VEIL）。
// 所以标签用「衬底强弱」如实描述，不用「灰度/虚化」这种承诺了做不到的事。
const MODE_LABEL = { gray: '深衬底', blur: '中衬底', raw: '淡衬底' };

// 内置包内图没有服务端做灰度/虚化，改用引擎暗色蒙版强度近似三档。
// 核心目的不是"真的灰度"，而是**白字压在图上必须可读** → 越靠gray 蒙版越厚。
const BUILTIN_VEIL = { gray: [0.46, 0.68], blur: [0.36, 0.56], raw: [0.24, 0.42] };
const FALLBACK_ID = 'bg01';   // 背景加载失败时回落到这张（保证不白卡的最后一层）

/** 页面 data 里的风格/背景字段。defaultStyleKey 缺省用文艺（与模板层 DEFAULT_STYLE 对齐）。 */
function defaults(defaultStyleKey) {
  return {
    // 排版风格
    styleKey: defaultStyleKey || 'literary',
    styleList: fontKit.STYLE_LIST,
    styleDefault: defaultStyleKey || 'literary',
    // 背景：内置压缩兜底图（默认来源，零网络零白名单）
    builtinPhotos: bgPack.listAll(),
    bgPhotoId: FALLBACK_ID,
    bgSource: 'builtin',   // builtin=内置兜底 | album=手机相册 | none=显式取消背景
    photoMode: 'gray',
    photoModeLabel: MODE_LABEL.gray,
    bgAuthor: bgPack.authorOf(FALLBACK_ID),
    localBg: ''            // 相册临时路径（不持久化）
  };
}

function normalizeMode(m) {
  return PHOTO_MODES.indexOf(m) >= 0 ? m : 'gray';
}

function normalizeSource(s) {
  // none 是显式的「不要背景」（用户点了取消背景）。必须与 builtin 区分：
  // builtin 是兜底默认值，id 为空会回落默认图；none 则真的不设 bgImg。
  //
  //⚠️ 这里只列两个合法值，少了历史值 'lib'（网络图库，2026-10-06 整层移除）。
  //    这**不是漏写**：老用户 storage 里存着 bgSource='lib' + 某个 picsum id，
  //    走 else 分支自动回落 'builtin'，配initCardStyle 的 id 校验换成 bg01，
  //    迁移零成本、不报错。若日后见到 normalizeSource 少一支，别急着"补全"——
  //    除非真的重做网络图库，否则那会把废弃值又请回来。
  if (s === 'album' || s === 'none') return s;
  return 'builtin';
}

function readStore() {
  try {
    const v = wx.getStorageSync(KEY);
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}

function writeStore(patch) {
  try {
    wx.setStorageSync(KEY, Object.assign({}, readStore(), patch));
  } catch (e) { /* 存储失败只影响偏好保持，不影响出卡，忽略 */ }
}

/**
 * 组装 renderCard 的 data：注入 styleKey 与背景三键（bgImg / bgVeil / bgFallback）。
 *
 * 优先级：相册临时图 > 内置兜底图；显式取消则不设 bgImg（走主题渐变）。
 *
 * @param {object} base 页面自己的卡片数据（title/body/author/cover…）
 */
function applyCardStyle(page, base) {
  const d = (page && page.data) || {};
  const out = Object.assign({}, base || {});
  if (d.styleKey && fontKit.hasStyle(d.styleKey)) out.styleKey = d.styleKey;

  const mode = normalizeMode(d.photoMode);
  const src = normalizeSource(d.bgSource);
  let bg = '';
  let isBuiltin = false;

  if (d.localBg) {
    bg = d.localBg;                          // 相册图：原图直用，不叠 veil（用户自己的图）
  } else if (src === 'none') {
    bg = '';                                 // 用户显式取消背景 → 走主题渐变
  } else {
    // builtin：未知/空 id 一律拦下落回默认内置图。
    // 老 storage 的 bgSource='lib' 也走这里（normalizeSource 已回落），配下面
    // 的 id 校验把 picsum id 换成 bg01 —— 迁移路径与普通未知 id 完全一致。
    bg = bgPack.pathOf(d.bgPhotoId) || bgPack.pathOf(FALLBACK_ID);
    isBuiltin = true;
  }

  if (bg) {
    out.bgImg = bg;
    // 衬底三档只对内置图生效：内置图没有服务端做灰度/虚化，用引擎蒙版强度近似。
    // 相册图是用户自己的图，不叠蒙版（叠了等于替用户改作品）。
    if (isBuiltin) out.bgVeil = BUILTIN_VEIL[mode];
    else delete out.bgVeil;
    // 挂内置兜底：相册临时路径也可能失效（用户在系统相册里删了原图），
    // 加载失败时由渲染层改用内置图，**保证永远能出带背景的卡**。
    // 内置图自己不需要兜底（它就是兜底），再兜底会自我循环。
    if (!isBuiltin) out.bgFallback = bgPack.pathOf(FALLBACK_ID);
    else delete out.bgFallback;
  } else {
    delete out.bgImg;
    delete out.bgVeil;
    delete out.bgFallback;
  }
  return out;
}

/**
 * 风格/背景变化后自动重绘已渲染的卡片。
 * 页面在renderCard 前把参数存到 this._cardOpts，这里直接复用，避免各页重写一遍。
 *
 * ⚠️ 判定「是否已渲染」必须看 page._cardOpts（=曾经成功渲染过），
 *    **不能**看 page.data.rendered —— 各 setter 会把 rendered 置false
 *    以提示"参数已变、需重新生成"，若据此判断就会永远不重绘（2026-10-06 实测踩到）。
 */
function repaint(page) {
  const o = page && page._cardOpts;
  if (!o) return;
  const data = applyCardStyle(page, o.data);
  page._cardOpts = Object.assign({}, o, { data });
  renderCard(page, {
    canvasId: o.canvasId,
    type: o.type,
    theme: page.data.theme || o.theme,
    data
  }).catch(() => { /* 重绘失败保留旧图，用户可手动再生成 */ });
}

const cardStyleMethods = {
  /**
   * onLoad 里调一次：恢复持久化的风格/背景选择。
   *
   * 背景恢复的两级净化（防手改 storage / 库更新后旧 ID 失效）：
   *   bgSource=album  → 相册路径本就不落盘，必然为空 → 回落内置兜底
   *   bgSource=builtin→ ID 必须在 bg_pack 内，否则回落默认内置图
   *   bgSource='lib'  → 历史废弃值，normalizeSource 已回落 builtin，
   *                     其 picsum id 不在 bg_pack 内 → 被下面的 id 校验换成 bg01
   * @param {string} [defaultStyleKey] 该页面的默认风格（不传则 literary）
   */
  initCardStyle(defaultStyleKey) {
    const def = defaultStyleKey || 'literary';
    const s = readStore();
    const styleKey = fontKit.hasStyle(s.styleKey) ? s.styleKey : def;
    const photoMode = normalizeMode(s.photoMode);

    let src = normalizeSource(s.bgSource);
    let bgPhotoId = s.bgPhotoId;
    if (src === 'builtin') {
      //这一支同时兜住两类失效：老 lib 来源带来的 picsum id，和手改的乱值。
      if (!bgPack.has(bgPhotoId)) bgPhotoId = FALLBACK_ID;
    } else {
      bgPhotoId = '';                // album（路径不落盘必然为空）/ none：都无选中图
    }

    this.setData(Object.assign({}, defaults(def), {
      styleKey,
      photoMode,
      photoModeLabel: MODE_LABEL[photoMode],
      bgSource: src,
      bgPhotoId,
      bgAuthor: (src === 'builtin' && bgPhotoId) ? bgPack.authorOf(bgPhotoId) : ''
    }));
  },

  onPickStyle(e) {
    const k = e.currentTarget.dataset.key;
    if (!fontKit.hasStyle(k) || k === this.data.styleKey) return;
    this.setData({ styleKey: k, rendered: false });
    writeStore({ styleKey: k });
    repaint(this);
  },

  /** 选内置压缩兜底图（默认来源，零网络零白名单）。 */
  onPickBuiltinBg(e) {
    const id = e.currentTarget.dataset.id;
    if (!bgPack.has(id)) return;             // 防dataset 注入任意路径
    this.setData({
      bgPhotoId: id,
      bgAuthor: bgPack.authorOf(id),
      bgSource: 'builtin',
      localBg: '',                          // 二选一：清掉相册图
      rendered: false
    });
    writeStore({ bgSource: 'builtin', bgPhotoId: id });
    repaint(this);
  },

  /**
   * 换一张：在内置图库内循环（60 张成环）。
   * 曾经按来源分环（内置 60 / 网络 100），网络图库移除后只剩内置一环。
   */
  onShufflePhoto() {
    const list = bgPack.ids();
    if (!list.length) return;
    const cur = list.indexOf(this.data.bgPhotoId);
    const nextId = list[(cur + 1) % list.length];
    this.setData({
      bgPhotoId: nextId,
      bgAuthor: bgPack.authorOf(nextId),
      bgSource: 'builtin',
      localBg: '',
      rendered: false
    });
    writeStore({ bgSource: 'builtin', bgPhotoId: nextId });
    repaint(this);
    wx.showToast({ title: '已换背景', icon: 'none' });
  },

  /**
   * 衬底强弱三档循环：深衬底 → 中衬底 → 淡衬底。
   * 只改内置图的引擎蒙版强度（BUILTIN_VEIL），缩略图 URL 不变，无需重算。
   */
  onCyclePhotoMode() {
    const next = PHOTO_MODES[(PHOTO_MODES.indexOf(normalizeMode(this.data.photoMode)) + 1) % PHOTO_MODES.length];
    this.setData({
      photoMode: next,
      photoModeLabel: MODE_LABEL[next],
      rendered: false
    });
    writeStore({ photoMode: next });
    repaint(this);
    wx.showToast({ title: '衬底：' + MODE_LABEL[next], icon: 'none' });
  },

  /** 从手机相册选一张作背景（与内置/图库互斥）。临时路径不持久化。 */
  onPickAlbumBg() {
    const self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(r) {
        const p = r.tempFiles && r.tempFiles[0] && r.tempFiles[0].tempFilePath;
        if (!p) return;
        self.setData({
          localBg: p,
          bgSource: 'album',
          bgPhotoId: '',                      // 二选一：清掉图库/内置选中
          bgAuthor: '',
          rendered: false
        });
        repaint(self);
        wx.showToast({ title: '已用相册图', icon: 'none' });
      },
      fail(e) { handlePrivacyApiFail(self, '选背景图', e); }
    });
  },

  /** 取消背景，回到主题渐变（bgSource=none，区别于兜底默认的 builtin）。 */
  onClearPhoto() {
    this.setData({ bgPhotoId: '', bgAuthor: '', localBg: '', bgSource: 'none', rendered: false });
    writeStore({ bgSource: 'none', bgPhotoId: '' });
    repaint(this);
  }
};

module.exports = {
  KEY, PHOTO_MODES, MODE_LABEL, BUILTIN_VEIL, FALLBACK_ID,
  defaults, normalizeMode, normalizeSource, applyCardStyle, repaint, cardStyleMethods
};