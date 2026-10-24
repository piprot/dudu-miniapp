// pages/poster/poster.js —— 海报长图制作工具（纯本地 canvas，零生成式模型）
// 竖版 375 宽长图，高度随内容流式增长（不裁切金句/正文）。
// 合规（2026-10-04 提审被拒「社交-笔记」后整改）：已移除署名（落款/昵称/头像）与
// 站内转发/朋友圈分享入口；制作内容仅保存到用户本机相册，不做发布与传播。
// 沿用 模板(templates/poster)×主题(themes)×引擎(render_engine) 三层解耦架构。
const { buildPosterModel } = require('../../utils/templates/poster');
const { computeLayout, draw } = require('../../utils/core/render_engine');
const { THEME_LIST } = require('../../utils/themes/index.js');
const { charge, costOf } = require('../../utils/charge');
const { exportAndSave } = require('../../utils/share');
const daily = require('../../utils/templates/daily'); // 每日文案库：金句每天自动换一条（本地确定性轮换，零 AI）
const { surfaceLastError, currentEnvVersion, buildDebug, handlePrivacyApiFail } = require('../../../utils/diag.js');
const privacyPanel = require('../../../utils/privacy_panel.js'); // 隐私授权面板：同意按钮须用 open-type=agreePrivacyAuthorization
const cardStyle = require('../../utils/card_style_mixin');  // 排版风格 + 背景图（与天气/节气/金句/每日一句/日签共用）

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

const __pageCfg = {
  // 排版风格 / 背景图 / 衬底等出图参数由 card_style_mixin.defaults() 注入，
  // 与天气/节气/金句/每日一句/日签五页共用同一份定义，改一处全站生效。
  //
  // ⚠️ 2026-10-25：海报页原先只有「主题 chip + 从相册选一张背景图」两个参数，
  //   与其余五页能力不齐（用户反馈「海报只有选择手机图片这一个选项」）。
  //   现按同一套 mixin 补齐：9 种排版风格 / 60 张内置压缩背景 / 相册背景 / 衬底强弱 / 主题配色。
  data: Object.assign({
    privacyShow: false,   // 隐私授权面板显隐（组件 privacy-panel 消费）
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary })),
    theme: 'warm',
    form: {
      title: '',
      quote: daily.posterQuote().text,   // 默认带海报文案，每天自动换（独立文案库，不与日签卡重复）
      body: ''
    },
    bgImg: '',
    showHelp: false,
    err: '',
    dbg: '',               // 调试条（仅体验/开发版）
    rendered: false,
    canvasH: 0,
    savedTick: 0,          // 保存成功翻转计数（奇偶交替换 keyframes，铁律 5）
    savedKey: '',          // 'a'/'b' = 翻转中，'' = 常态
    quotePoolSize: daily.posterPoolSize(),          // 海报文案库储备量
    posterCost: costOf('posterGen') || 20
  }, cardStyle.defaults('literary')),   // 海报与日签同气质，默认文艺风

  onShow() {
    surfaceLastError(this);
    if (currentEnvVersion() !== 'release') this.setData({ dbg: buildDebug(this) });
  },

  // 2026-10-25：恢复持久化的出图设置（排版风格 / 背景图 / 衬底强弱）
  onLoad() {
    this.initCardStyle('literary');
  },

  // ⚠️ 2026-10-25：兼容组件上抛（e.detail.id）与页面直绑（e.currentTarget.dataset.id）。
  //   出图设置抽成 card-config 组件后事件走 e.detail，只读 currentTarget 会静默失效
  //   （点主题没反应但不报错——最难查的一类断点）。
  onPickTheme(e) {
    const id = ((e && e.detail && e.detail.id) ||
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id));
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id, rendered: false });
    // 换主题后若已出过图，原样重绘（不重复扣费——改样式不该再收一次钱）
    this.repaintCard();
  },

  // 已渲染时按当前出图参数重绘（切主题/换风格/换背景都走这里，不扣费）
  //
  // ⚠️ 名字必须是 repaintCard —— card_style_mixin.repaint 会优先调用页面的
  //   这个钩子（海报页走声明式渲染引擎，不是 mixin 默认的 quote_card_render）。
  repaintCard() {
    if (!this.canvasNode || !this._lastRecord) return;
    try {
      const d = this.collectData();
      this.renderPoster(d);
    } catch (e) { /* 重绘失败保留旧图，用户可手动再生成 */ }
  },

  onField(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ form: Object.assign({}, this.data.form, { [field]: e.detail.value }) });
  },

  onToggleHelp() {
    this.setData({ showHelp: !this.data.showHelp });
  },

  // 「换一套」：从海报文案库跳到下一套（同一天内不撞车，跨天回到当日主推）
  onShuffleQuote() {
    this._quoteOffset = (this._quoteOffset || 0) + 1;
    const q = daily.posterQuote(this._quoteOffset);
    this.setData({ form: Object.assign({}, this.data.form, { quote: q.t }), rendered: false });
  },

  // 选择「背景图」：铺满整张海报。
  //
  // ⚠️ 2026-10-25：保留为兼容壳。背景图的选择已统一由 card_style_mixin 提供
  //   （onPickBuiltinBg 内置图库 / onPickAlbumBg 相册 / onClearPhoto 取消），
  //   与天气/节气/金句/每日一句/日签五页完全一致。本页旧的独立「选择背景图」按钮
  //   已并入「出图设置」，避免两个入口互相覆盖 bgImg / localBg 两个字段。
  onChooseBgImage() {
    this.onPickAlbumBg();
  },

  // 从表单收集内容数据（与渲染解耦，便于测试）
  collectData() {
    const f = this.data.form;
    const d = {
      title: f.title || '',
      quote: f.quote || '',
      body: f.body || '',
      dateLabel: todayLabel(),
      qr: QR_PATH
    };
    // 金句留空且没有任何内容时，自动回填今日金句，保证首用永远有产出
    if (!d.quote && !d.title && !d.body) d.quote = daily.posterQuote().text;
    // 背景图 / 衬底 / 排版风格：
    //
    // ⚠️ 2026-10-25：改由 card_style_mixin.applyCardStyle 统一组装，
    //   它负责：styleKey（排版风格）/ bgImg（背景图）/ bgVeil（衬底强弱）/ bgFallback（兜底）。
    //   优先级：相册临时图 > 内置压缩图库（60 张）> 主题渐变。
    //   旧版只认「用户从相册选的 bgImg」，既不支持内置图库，也不支持衬底强弱——
    //   这正是用户反馈「海报只有选择手机图片这一个选项」的根因。
    return cardStyle.applyCardStyle(this, d);
  },

  onGenPoster() {
    // 不做空内容拦截：collectData 会在全空时自动回填今日金句（首用永远有产出），
    // 这里若再校验必然是死代码（回填先于校验发生）。
    const d = this.collectData();
    const self = this;
    const cost = this.data.posterCost;
    this.setData({ err: '' });
    charge('posterGen', { label: '制作海报' }).then(() => {
      self.renderPoster(d);
      wx.showToast({ title: '已制作海报（-' + cost + '）', icon: 'none' });
    }).catch((e) => {
      // 余额不足 / 扣费失败 / 积分云服务不可用：把真因显式显示，避免「点制作毫无反应、画布空空」。
      self.setData({ err: '制作失败：' + ((e && e.message) || '积分服务暂不可用，请稍后重试') });
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
        // 背景图加载失败 → 回落内置兜底图（bgFallback，由 card_style_mixin 挂上）→
        // 再失败才回退主题渐变。绝不做半成品渲染。
        Promise.all([
          loadImg(d.qr),
          d.bgImg ? loadImg(d.bgImg) : Promise.resolve(null)
        ]).then(([qrImg, bgImg]) => {
          // 相册临时路径可能失效（用户在系统相册里删了原图），此时改加载内置兜底图，
          // 保证「永远能出带背景的海报」而不是突然变成纯色渐变。
          const useFallback = d.bgImg && !bgImg && d.bgFallback;
          const afterBg = useFallback ? loadImg(d.bgFallback) : Promise.resolve(bgImg);
          return afterBg.then((finalBg) => {
          try {
            const model = buildPosterModel(self.data.theme, d, { measure });
            if (qrImg) {
              const q = model.children.find(x => x.type === 'qrcode');
              if (q) q.asset = qrImg;
            }
            if (d.bgImg && finalBg) model.backgroundImageAsset = finalBg;
            else if (d.bgImg && !finalBg) delete model.backgroundImage;

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
          });   // ← afterBg.then
        });     // ← Promise.all().then
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
      wx.showToast({ title: '请先制作海报', icon: 'none' });
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
  }
};
Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
// 注入出图设置交互（与天气/节气/金句/每日一句/日签五页共用同一套 mixin）
Object.assign(__pageCfg, cardStyle.cardStyleMethods);
Page(__pageCfg);
