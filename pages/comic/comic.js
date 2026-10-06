// pages/comic/comic.js —— 画面感分镜编辑器（纯本地 canvas，零 AI / 零生成式模型）
// 用户输入极简「文字脚本」→ comic_markup.parseScript 解析成结构化分镜 →
// comic_render 在本地 canvas 确定性渲染成多格分镜图（对白气泡 / 旁白框 / 情绪色调 / 场景头）。
// 整个过程不调用任何大模型、不生成内容，不构成深度合成，个人主体可正常过审。
//
// 合规与一致性：复用 utils/charge（扣 comicGen 积分）、utils/share.exportAndSave（存相册 + 记历史）、
// utils/history（historyTool='comic'，history.js 已为该工具预留分桶）、utils/privacy_panel（同意按钮）。
const { parseScript } = require('../../utils/comic_markup.js');
const { computeLayout, draw } = require('../../utils/comic_render.js');
const { THEME_LIST, palette } = require('../../utils/themes/index.js');
const { exportAndSave } = require('../../utils/share');
const { charge, costOf } = require('../../utils/charge');
const { surfaceLastError, currentEnvVersion, buildDebug } = require('../../utils/diag.js');
const privacyPanel = require('../../utils/privacy_panel.js'); // 隐私授权面板：同意按钮须用 open-type=agreePrivacyAuthorization

// 默认示例脚本：演示「场景 / 情绪 / 旁白 / 角色对白」四类标记，开箱即出一页分镜。
const SAMPLE = [
  '# 雨夜的便利店',
  '【第一格】',
  '场景：凌晨两点的街角便利店',
  '情绪：温暖',
  '旁白：城市的灯一盏盏熄灭，只有它还亮着。',
  '',
  '【第二格】',
  '小明：阿姨，来碗关东煮。',
  '阿姨：这么晚还没睡？',
  '',
  '【第三格】',
  '情绪：忧伤',
  '旁白：她笑了笑，没回答。',
  '',
  '【第四格】',
  '旁白：有些疲惫，不必说给谁听。'
].join('\n');

const __pageCfg = {
  data: {
    privacyShow: false,   // 隐私授权面板显隐（组件 privacy-panel 消费）
    script: SAMPLE,       // 分镜脚本（textarea 双向）
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    cols: 2,              // 每行列数（2 / 3）
    rendered: false,
    canvasH: 0,
    err: '',
    dbg: '',              // 调试条（仅体验/开发版）
    comicCost: costOf('comicGen') || 20,
    panelCount: 0,        // 当前脚本解析出的分镜格数（生成前实时预览）
    savedTick: 0,
    savedKey: ''
  },

  onLoad() {
    this.refreshPanelCount();
  },

  onShow() {
    surfaceLastError(this);
    if (currentEnvVersion() !== 'release') this.setData({ dbg: buildDebug(this) });
  },

  onReady() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  // 实时统计脚本分镜格数（不渲染，纯解析，随输入更新）
  refreshPanelCount() {
    try {
      const m = parseScript(this.data.script || '');
      this.setData({ panelCount: (m && m.panels) ? m.panels.length : 0 });
    } catch (e) { /* 解析异常不阻断输入 */ }
  },

  onScriptInput(e) {
    this.setData({ script: e.detail.value });
    this.refreshPanelCount();
  },

  onLoadSample() {
    this.setData({ script: SAMPLE, rendered: false, err: '' });
    this.refreshPanelCount();
    wx.showToast({ title: '已载入示例', icon: 'none' });
  },

  onClearScript() {
    this.setData({ script: '', rendered: false, err: '', panelCount: 0 });
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id, rendered: false });
  },

  onPickCols(e) {
    const c = Number(e.currentTarget.dataset.cols) || 2;
    if (c === this.data.cols) return;
    this.setData({ cols: c, rendered: false });
  },

  onToggleHelp() {
    this.setData({ showHelp: !this.data.showHelp });
  },

  // 生成分镜：先本地解析校验 → 扣积分 → 渲染。
  onGenComic() {
    const model = parseScript(this.data.script || '');
    if (!model || !model.panels || model.panels.length === 0) {
      this.setData({ err: '先写点分镜内容，或点「载入示例」看看格式', rendered: false });
      return;
    }
    const self = this;
    const cost = this.data.comicCost;
    this.setData({ err: '' });
    charge('comicGen', { label: '生成分镜' }).then(() => {
      self.renderComic();
      wx.showToast({ title: '已生成分镜（-' + cost + '）', icon: 'none' });
    }).catch((e) => {
      // 余额不足 / 扣费失败 / 积分云服务不可用：把真因显式显示，避免「点生成毫无反应、画布空空」。
      self.setData({ err: '生成失败：' + ((e && e.message) || '积分服务暂不可用，请稍后重试') });
    });
  },

  renderComic() {
    const self = this;
    wx.createSelectorQuery().select('#comicCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        self.setData({ err: '画布初始化失败，请重试' });
        return;
      }
      try {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = (typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
        const cssW = res[0].width || 340;
        const model = parseScript(self.data.script || '');
        if (!model || !model.panels || model.panels.length === 0) {
          self.setData({ err: '脚本里没有可用的分镜', rendered: false });
          return;
        }
        const pal = palette(self.data.theme);
        // 文本测量：用真实 canvas measureText（按字号设置 font，保证折行与高度一致）。
        const measure = (t, font) => { ctx.font = font; return ctx.measureText(t).width; };
        const opts = { width: cssW, cols: self.data.cols, theme: pal };
        const layout = computeLayout(model, opts, measure);
        const k = cssW / layout.width;
        canvas.width = Math.round(layout.width * k * dpr);
        canvas.height = Math.round(layout.height * k * dpr);
        ctx.scale(dpr * k, dpr * k);
        draw(ctx, layout, { theme: pal });
        self.canvasNode = canvas;
        self._lastRecord = {
          kind: 'comic',
          theme: self.data.theme,
          cols: self.data.cols,
          title: model.title || '',
          panels: model.panels.length,
          script: String(self.data.script || '').slice(0, 60)
        };
        self.setData({ canvasH: Math.round(layout.height * k), rendered: true, err: '' });
      } catch (e) {
        self.setData({ err: '分镜渲染失败：' + ((e && e.message) || e || '未知错误') });
      }
    });
  },

  // 保存成功翻转反馈（复用 app.wxss 全局 saveFlipA/B 双套 keyframes，奇偶交替防重放）
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
      wx.showToast({ title: '请先生成分镜', icon: 'none' });
      return;
    }
    // 导出 → 存相册 → 自动记入本地历史（utils/share 统一闭环：防重复提交 + 文件校验 + historyTool='comic'）
    exportAndSave(self, self.canvasNode, {
      savingKey: '_saving',
      historyTool: 'comic',
      historyRecord: self._lastRecord || { kind: 'comic' }
    }).then(() => {
      self.flipSaved();
    }).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return; // 防重复提交：保存中，静默
      if (/auth|deny|authorize/i.test(msg)) return; // 权限引导由 album.js 内部处理
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  },

  // ── 分享能力（个人主体：复制链接受限，改用「转发给好友 + 朋友圈」传播）──
  onShareAppMessage() {
    return { title: 'dudu 画面感｜把故事画成多格分镜', path: '/pages/comic/comic' };
  },
  onShareTimeline() {
    return { title: 'dudu 画面感｜把故事画成多格分镜', query: '' };
  }
};

Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
