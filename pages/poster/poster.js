// pages/poster/poster.js —— 海报长图生成器（纯本地 canvas，零 AI）
// 竖版 375 宽长图，高度随内容流式增长（不裁切金句/正文）；
// 个性化三件套：头像（圆形裁剪）+ 昵称 + 专属小程序码，发朋友圈后扫码回流。
// 沿用 模板(templates/poster)×主题(themes)×引擎(render_engine) 三层解耦架构。
const { buildPosterModel } = require('../../utils/templates/poster');
const { computeLayout, draw } = require('../../utils/core/render_engine');
const { THEME_LIST } = require('../../utils/themes');
const { charge, costOf } = require('../../utils/charge');
const { exportAndSave, shareConfig } = require('../../utils/share');
const daily = require('../../utils/templates/daily'); // 每日文案库：金句每天自动换一条（本地确定性轮换，零 AI）
const { surfaceLastError } = require('../../utils/diag');

const QR_PATH = '/images/qrcode_miniapp.png';

function todayLabel() {
  const d = new Date();
  const wk = '日一二三四五六'.charAt(d.getDay());
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + wk;
}

function getDpr() {
  try {
    const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return info.pixelRatio || 2;
  } catch (e) { return 2; }
}

Page({
  data: {
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name })),
    theme: 'warm',
    form: {
      title: '',
      quote: daily.todayQuote().text,   // 默认带今日金句，每天自动换
      body: '',
      author: '',
      nickname: ''
    },
    avatar: '',
    bgImg: '',
    showHelp: false,
    err: '',
    rendered: false,
    canvasH: 0,
    savedTick: 0,          // 保存成功翻转计数（奇偶交替换 keyframes，铁律 5）
    savedKey: '',          // 'a'/'b' = 翻转中，'' = 常态
    quotePoolSize: daily.poolSize(),          // 金句库储备量
    posterCost: costOf('posterGen') || 20
  },

  onLoad() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  onShow() {
    surfaceLastError(this);
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id, rendered: false });
  },

  onField(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ form: Object.assign({}, this.data.form, { [field]: e.detail.value }) });
  },

  onToggleHelp() {
    this.setData({ showHelp: !this.data.showHelp });
  },

  // 「换一套」：从每日金句库跳到下一套（同一天内不撞车，跨天回到当日主推）
  onShuffleQuote() {
    this._quoteOffset = (this._quoteOffset || 0) + 1;
    const q = daily.todayQuote(this._quoteOffset);
    this.setData({ form: Object.assign({}, this.data.form, { quote: q.t }), rendered: false });
  },

  onChooseAvatar() {
    const self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(r) {
        const p = r.tempFiles && r.tempFiles[0] && r.tempFiles[0].tempFilePath;
        if (p) {
          self.setData({ avatar: p, rendered: false });
          wx.showToast({ title: '已选头像，点生成', icon: 'none' });
        }
      },
      fail() { /* 用户取消，忽略 */ }
    });
  },

  onChooseBgImage() {
    const self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(r) {
        const p = r.tempFiles && r.tempFiles[0] && r.tempFiles[0].tempFilePath;
        if (p) {
          self.setData({ bgImg: p, rendered: false });
          wx.showToast({ title: '已选背景图，点生成', icon: 'none' });
        }
      },
      fail() { /* 用户取消，忽略 */ }
    });
  },

  // 从表单收集内容数据（与渲染解耦，便于测试）
  collectData() {
    const f = this.data.form;
    const d = {
      title: f.title || '',
      quote: f.quote || '',
      body: f.body || '',
      author: f.author || '',
      nickname: f.nickname || '',
      dateLabel: todayLabel(),
      qr: QR_PATH
    };
    if (this.data.avatar) d.avatar = this.data.avatar;
    if (this.data.bgImg) d.bgImg = this.data.bgImg;
    // 金句留空且没有任何内容时，自动回填今日金句，保证首用永远有产出
    if (!d.quote && !d.title && !d.body) d.quote = daily.todayQuote().text;
    return d;
  },

  onGenPoster() {
    // 不做空内容拦截：collectData 会在全空时自动回填今日金句（首用永远有产出），
    // 这里若再校验必然是死代码（回填先于校验发生）。
    const d = this.collectData();
    const self = this;
    const cost = this.data.posterCost;
    this.setData({ err: '' });
    charge('posterGen', { label: '生成海报' }).then(() => {
      self.renderPoster(d);
      wx.showToast({ title: '已生成海报（-' + cost + '）', icon: 'none' });
    }).catch((e) => {
      // 余额不足 / 扣费失败 / 积分云服务不可用：把真因显式显示，避免「点生成毫无反应、画布空空」。
      self.setData({ err: '生成失败：' + ((e && e.message) || '积分服务暂不可用，请稍后重试') });
    });
  },

  renderPoster(data) {
    const self = this;
    const d = data || self.collectData();
    wx.createSelectorQuery().select('#posterCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        self.setData({ err: '画布初始化失败，请重试' });
        return;
      }
      try {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = getDpr();
        const cssW = res[0].width || 340;
        const measure = (t, fontPx) => {
          ctx.font = fontPx + 'px sans-serif';
          return ctx.measureText(t).width;
        };

        const loadImg = (src) => new Promise(resolve => {
          const img = canvas.createImage();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        });
        // 先加载全部图片资产，再按「实际加载成功」的资产建模：
        // 头像加载失败 → 按「无头像」建模（模板层自动出主色首字圆形占位，不空缺）；
        // 背景图加载失败 → 回退主题渐变。绝不做半成品渲染。
        Promise.all([
          d.avatar ? loadImg(d.avatar) : Promise.resolve(null),
          loadImg(d.qr),
          d.bgImg ? loadImg(d.bgImg) : Promise.resolve(null)
        ]).then(([avatarImg, qrImg, bgImg]) => {
          try {
            const buildData = Object.assign({}, d);
            if (!avatarImg) delete buildData.avatar; // 模板层会走首字占位分支
            const model = buildPosterModel(self.data.theme, buildData, { measure });
            if (avatarImg) {
              const c = model.children.find(x => x.type === 'image' && x.src === d.avatar);
              if (c) c.asset = avatarImg;
            }
            if (qrImg) {
              const q = model.children.find(x => x.type === 'qrcode');
              if (q) q.asset = qrImg;
            }
            if (d.bgImg && bgImg) model.backgroundImageAsset = bgImg;
            else if (d.bgImg && !bgImg) delete model.backgroundImage;

            const layout = computeLayout(model, {}, measure);
            const k = cssW / layout.width;
            canvas.width = Math.round(layout.width * k * dpr);
            canvas.height = Math.round(layout.height * k * dpr);
            ctx.scale(dpr * k, dpr * k);
            draw(ctx, layout);
            self.canvasNode = canvas;
            self._lastRecord = { kind: 'poster', theme: self.data.theme, title: d.title, quote: (d.quote || '').slice(0, 30), date: d.dateLabel };
            self.setData({ canvasH: Math.round(layout.height * k), rendered: true, err: '' });
          } catch (e) {
            self.setData({ err: '海报渲染失败：' + ((e && e.message) || e || '未知错误') });
          }
        });
      } catch (e) {
        self.setData({ err: '海报渲染失败：' + ((e && e.message) || e || '未知错误') });
      }
    });
  },

  // 保存成功翻转反馈（流体库 #27 · A 档）：timer 存 this 防竞态（铁律 6）。
  flipSaved() {
    const tick = (this.data.savedTick || 0) + 1;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this.setData({ savedTick: tick, savedKey: tick % 2 ? 'a' : 'b' });
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.setData({ savedKey: '' });
    }, 1600);
  },

  onSaveImage() {
    const self = this;
    if (!self.canvasNode) {
      wx.showToast({ title: '请先生成海报', icon: 'none' });
      return;
    }
    exportAndSave(self, self.canvasNode, {
      savingKey: '_saving',
      historyTool: 'poster',
      historyRecord: self._lastRecord || { kind: 'poster' }
    }).then(() => {
      self.flipSaved(); // 内联翻转替代成功 toast
    }).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return; // 防重复提交：保存中，静默
      if (/auth|deny|authorize/i.test(msg)) return; // 权限引导由 album.js 内部处理
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  },

  onShareAppMessage() {
    return shareConfig('写一句话，生成你的专属海报长图 · dudu 画面感', '/pages/poster/poster');
  },
  onShareTimeline() {
    return { title: '写一句话，生成你的专属海报长图 · dudu 画面感', query: '' };
  }
});
