// pages/comic/comic.js —— 画面感分镜编辑器（A 方向，纯本地 canvas，零 AI）
// 用户写文字脚本 → 解析 → 本地 canvas 渲染多格分镜图 → 存相册。
// 全程不调用云端 / 不生成内容，不构成深度合成，个人主体可过审。
const { parseScript } = require('../../utils/comic_markup');
const { computeLayout, draw } = require('../../utils/comic_render');
const { THEME_LIST, palette } = require('../../utils/themes/index.js');
const { exportAndSave } = require('../../utils/share');
const { charge, costOf } = require('../../utils/charge');
const { surfaceLastError, currentEnvVersion, buildDebug } = require('../../utils/diag.js');
const privacyPanel = require('../../utils/privacy_panel.js'); // 隐私授权面板：同意按钮须用 open-type=agreePrivacyAuthorization

const SAMPLES = {
  story: `# 江边的告别
【分镜1】
场景：江边傍晚
旁白：那天下班，风很轻
小明：你真的要走了吗
小红：嗯，车票已经买好了
情绪：忧伤

【分镜2】
旁白：很多年后，我还记得那个背影
情绪：温馨`,
  sell: `# 一本让我开窍的书
【分镜1】
旁白：以前写文案像挤牙膏
我：到底差在哪
情绪：紧张

【分镜2】
旁白：直到用了「结构模板」
我：原来不是文笔，是骨架
情绪：欢乐`,
  tutorial: `# 三步做出画面感
【分镜1】
旁白：第一步，写下你的故事
情绪：默认

【分镜2】
旁白：第二步，套一个结构模板
情绪：默认

【分镜3】
旁白：第三步，一键出分镜图
情绪：欢乐`
};

function getDpr() {
  try {
    const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return info.pixelRatio || 2;
  } catch (e) { return 2; }
}

const __pageCfg = {
  data: {
    privacyShow: false,   // 隐私授权面板显隐（组件 privacy-panel 消费）
    script: SAMPLES.story,
    cols: 2,
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name })), // 主题选择器（6 套，数据驱动）
    theme: 'warm',
    rendered: false,
    canvasH: 0,
    err: '',
    dbg: '',               // 调试条（仅体验/开发版）
    savedTick: 0,          // 保存成功翻转计数（奇偶交替换 keyframes，铁律 5）
    savedKey: '',          // 'a'/'b' = 翻转中，'' = 常态
    showHelp: false,
    comicCost: costOf('comicGen') || 20   // 生成分镜单价（来自 POINTS.cost，集中配置）
  },

  onShow() {
    surfaceLastError(this);
    if (currentEnvVersion() !== 'release') this.setData({ dbg: buildDebug(this) });
  },

  onScriptInput(e) {
    this.setData({ script: e.detail.value, err: '' });
  },

  onLoadSample(e) {
    const kind = e.currentTarget.dataset.kind;
    const s = SAMPLES[kind];
    if (s) this.setData({ script: s, err: '', rendered: false });
  },

  onToggleHelp() {
    this.setData({ showHelp: !this.data.showHelp });
  },

  onClear() {
    this.setData({ script: '', rendered: false, err: '', canvasH: 0 });
  },

  onToggleCols() {
    const cols = this.data.cols === 2 ? 1 : 2;
    this.setData({ cols });
    if (this.data.rendered) this.renderComic();
  },

  // 切换主题（warm/fresh/graphite/zen/ticket/olive）——已渲染时免费即时重绘，不重复扣积分。
  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id });
    if (this.data.rendered) this.renderComic();
  },

  // 解析 + 渲染到 canvas（2d 模式）。
  onGenComic() {
    const model = parseScript(this.data.script);
    if (!model.panels.length) {
      this.setData({ err: '脚本里还没有分镜内容：用【分镜】或 --- 起头，写几句旁白 / 对白试试', rendered: false });
      return;
    }
    const self = this;
    const cost = this.data.comicCost;
    this.setData({ err: '' });
    // 生成分镜要扣积分（复用 utils/charge 统一流程）；扣成功才渲染。
    charge('comicGen', { label: '生成分镜' }).then(() => {
      self.renderComic(model);
      wx.showToast({ title: '已生成分镜（-' + cost + '）', icon: 'none' });
    }).catch((e) => {
      // 余额不足 / 扣费失败 / 积分云服务不可用：把真因显式显示，避免「点生成毫无反应、画布空空」。
      self.setData({ err: '生成失败：' + ((e && e.message) || '积分服务暂不可用，请稍后重试') });
    });
  },

  renderComic(model) {
    const self = this;
    const m = model || parseScript(this.data.script);
    wx.createSelectorQuery().select('#comicCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        self.setData({ err: '画布初始化失败，请重试' });
        return;
      }
      try {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = getDpr();
        const cssW = res[0].width || 340;
        const layout = computeLayout(m, { width: cssW, cols: self.data.cols }, (t, f) => {
          ctx.font = f;
          return ctx.measureText(t).width;
        });
        canvas.width = Math.round(layout.width * dpr);
        canvas.height = Math.round(layout.height * dpr);
        ctx.scale(dpr, dpr);
        // 主题化配色：palette 喂给 draw，底色/标题/气泡/旁白随主题切换
        draw(ctx, layout, { width: layout.width, cols: self.data.cols, theme: palette(self.data.theme) });
        self.canvasNode = canvas;
        self._lastRecord = { kind: 'comic', theme: self.data.theme, title: m.title || '', panels: m.panels.length };
        self.setData({ canvasH: layout.height, rendered: true, err: '' });
      } catch (e) {
        self.setData({ err: '分镜渲染失败：' + ((e && e.message) || e || '未知错误') });
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
      wx.showToast({ title: '请先生成分镜', icon: 'none' });
      return;
    }
    // 导出 → 存相册 → 自动记入本地历史（utils/share 统一闭环）
    exportAndSave(self, self.canvasNode, {
      savingKey: '_saving',
      historyTool: 'comic',
      historyRecord: self._lastRecord || { kind: 'comic' }
    }).then(() => {
      self.flipSaved(); // 内联翻转替代成功 toast
    }).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return; // 防重复提交：保存中，静默
      if (/auth|deny|authorize/i.test(msg)) return; // 权限引导由 album.js 内部处理
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  }
};
Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
