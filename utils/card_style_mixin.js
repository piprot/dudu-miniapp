// utils/card_style_mixin.js —— 卡片「排版风格 + 背景图」共享逻辑（2026-10-06）
//
// ── 为什么抽这个 mixin ──────────────────────────────────────────────────
// 天气/节气/金句/台词书摘四个页面都要「参照日签模块生成分享图」，
// 且都要支持：换排版风格、从相册选背景、从内置图库选背景、取消背景。
// 复制四份必然漂移（改一处忘三处），故把状态 + 交互 + 持久化 + 重绘收在一处，
// 页面只需 Object.assign(pageCfg, cardStyle.methods) 并在渲染前调 applyCardStyle()。
//
// ── 能力边界（与 utils/font_kit.js、utils/photo_lib.js 同源）──────────
//  · 风格只改排版参数（字体族/字号/字距/对齐/装饰），不落地字体文件——
//    主包 2MB 上限 + loadFontFace 不读包内路径 + canvas 不支持，三条硬墙。
//  · 背景图分两类：内置图库（picsum 固定 ID，需 downloadFile 白名单）与
//    手机相册（临时文件路径）。两者互斥：选相册图会清掉图库选中，反之亦然。
//  · 背景加载失败由 quote_card_render 内部 delete model.backgroundImage
//    回退主题渐变，不会白卡，也不会抛错。
//
// ── 持久化取舍 ─────────────────────────────────────────────────────────
//  风格 / 图库图 ID / 图库处理方式 → 存本地（跨页面、跨启动保持一致）。
//  相册临时路径 → **不存**（chooseMedia 的 tempFilePath 会被系统回收，
//  存下来下次启动就是坏图），只在本次会话内有效。

const photoLib = require('./photo_lib');
const fontKit = require('./font_kit');
const { handlePrivacyApiFail } = require('./diag.js');
const { renderCard } = require('./quote_card_render');

const KEY = 'dudu_card_style_v1';
const PHOTO_MODES = ['gray', 'blur', 'raw'];
const MODE_LABEL = { gray: '灰度衬底', blur: '虚化', raw: '原图' };
const PREVIEW_COUNT = 24;   // 横向滚动缩略图只铺前24 张，全库 100 张仍可选（换一张）

/** 页面 data 里的风格/背景字段。defaultStyleKey 缺省用文艺（与模板层 DEFAULT_STYLE 对齐）。 */
function defaults(defaultStyleKey) {
  return {
    // 排版风格
    styleKey: defaultStyleKey || 'literary',
    styleList: fontKit.STYLE_LIST,
    styleDefault: defaultStyleKey || 'literary',
    // 背景图库
    photos: [],
    photoMode: 'gray',
    photoModeLabel: MODE_LABEL.gray,
    bgPhotoId: '',
    bgAuthor: '',
    bgSource: 'lib',      // lib=内置图库 | album=手机相册
    localBg: ''           // 相册临时路径（不持久化）
  };
}

function normalizeMode(m) {
  return PHOTO_MODES.indexOf(m) >= 0 ? m : 'gray';
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
 * 组装 renderCard 的 data：注入 styleKey 与 bgImg。
 * bgImg 优先级：相册临时图 > 内置图库图；都没有则不设该键（走主题渐变）。
 * @param {object} base 页面自己的卡片数据（title/body/author/cover…）
 */
function applyCardStyle(page, base) {
  const d = (page && page.data) || {};
  const out = Object.assign({}, base || {});
  if (d.styleKey && fontKit.hasStyle(d.styleKey)) out.styleKey = d.styleKey;
  let bg = '';
  if (d.localBg) bg = d.localBg;
  else if (d.bgPhotoId && photoLib.has(d.bgPhotoId)) {
    bg = photoLib.urlOf(d.bgPhotoId, { mode: normalizeMode(d.photoMode) });
  }
  if (bg) out.bgImg = bg;
  else delete out.bgImg;
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
   * onLoad 里调一次：恢复持久化的风格/图库选择，并铺缩略图。
   * @param {string} [defaultStyleKey] 该页面的默认风格（不传则 literary）
   */
  initCardStyle(defaultStyleKey) {
    const def = defaultStyleKey || 'literary';
    const s = readStore();
    const styleKey = fontKit.hasStyle(s.styleKey) ? s.styleKey : def;
    const photoMode = normalizeMode(s.photoMode);
    // 图库 ID 必须仍在库内（防手改storage / 库更新后旧 ID 失效）
    const bgPhotoId = photoLib.has(s.bgPhotoId) ? s.bgPhotoId : '';
    this.setData(Object.assign({}, defaults(def), {
      styleKey,
      photoMode,
      photoModeLabel: MODE_LABEL[photoMode],
      bgPhotoId,
      bgAuthor: bgPhotoId ? photoLib.authorOf(bgPhotoId) : '',
      photos: photoLib.listAll({ mode: photoMode }).slice(0, PREVIEW_COUNT)
    }));
  },

  onPickStyle(e) {
    const k = e.currentTarget.dataset.key;
    if (!fontKit.hasStyle(k) || k === this.data.styleKey) return;
    this.setData({ styleKey: k, rendered: false });
    writeStore({ styleKey: k });
    repaint(this);
  },

  onPickPhoto(e) {
    const id = e.currentTarget.dataset.id;
    if (!photoLib.has(id)) return;          // 防dataset 注入任意 URL
    this.setData({
      bgPhotoId: id,
      bgAuthor: photoLib.authorOf(id),
      bgSource: 'lib',
      localBg: '',                          // 二选一：清掉相册图
      rendered: false
    });
    writeStore({ bgPhotoId: id });
    repaint(this);
  },

  /** 换一张：库内循环取下一张。 */
  onShufflePhoto() {
    const ids = photoLib.PHOTOS.map(p => p.id);
    if (!ids.length) return;
    const cur = ids.indexOf(this.data.bgPhotoId);
    const nextId = ids[(cur + 1) % ids.length];
    this.setData({
      bgPhotoId: nextId,
      bgAuthor: photoLib.authorOf(nextId),
      bgSource: 'lib',
      localBg: '',
      rendered: false
    });
    writeStore({ bgPhotoId: nextId });
    repaint(this);
    wx.showToast({ title: '已换背景', icon: 'none' });
  },

  /** 灰度 → 虚化 → 原图 循环；query 参数变了必须重算缩略图 URL。 */
  onCyclePhotoMode() {
    const next = PHOTO_MODES[(PHOTO_MODES.indexOf(normalizeMode(this.data.photoMode)) + 1) % PHOTO_MODES.length];
    this.setData({
      photoMode: next,
      photoModeLabel: MODE_LABEL[next],
      photos: photoLib.listAll({ mode: next }).slice(0, PREVIEW_COUNT),
      rendered: false
    });
    writeStore({ photoMode: next });
    repaint(this);
    wx.showToast({ title: '背景：' + MODE_LABEL[next], icon: 'none' });
  },

  /** 从手机相册选一张作背景（与图库互斥）。临时路径不持久化。 */
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
          bgPhotoId: '',// 二选一：清掉图库选中
          bgAuthor: '',
          rendered: false
        });
        repaint(self);
        wx.showToast({ title: '已用相册图', icon: 'none' });
      },
      fail(e) { handlePrivacyApiFail(self, '选背景图', e); }
    });
  },

  /** 取消背景，回到主题渐变。 */
  onClearPhoto() {
    this.setData({ bgPhotoId: '', bgAuthor: '', localBg: '', bgSource: 'lib', rendered: false });
    writeStore({ bgPhotoId: '' });
    repaint(this);
  }
};

module.exports = {
  KEY, PHOTO_MODES, MODE_LABEL, PREVIEW_COUNT,
  defaults, normalizeMode, applyCardStyle, repaint, cardStyleMethods
};