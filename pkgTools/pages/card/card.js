// pages/card/card.js —— 画面感卡片 / 日签生成器（纯本地 canvas，零 AI）
// 选模板 → 选主题 → 填文字（可选本地图/背景图）→ 声明式引擎渲染 → 存相册。
// 2026-10-01 重构：渲染切换到 模板(templates)×主题(themes)×引擎(render_engine) 三层解耦架构。
//
// ⚠️ 2026-10-24：接入完整「出图设置」（用户反馈「卡片制作/日签板块，出图设置需要参照其他
//    板块加入，目前的只有选择背景图」）。
//   改前：本页只有「主题 chip」+「选择背景图」两个出图参数，且背景图**只能从相册选**，
//         排版风格（9 种）、内置压缩图库（60 张）、衬底强弱三档全都没有。
//   改后：与天气/节气/金句/每日一句共用 components/card-config + utils/card_style_mixin，
//         一次补齐：排版风格 / 内置图库 / 相册背景 / 衬底强弱 / 主题配色。
//   渲染侧无需重写：buildCardModel 本来就消费 data.styleKey / data.bgImg / data.bgVeil，
//   只是页面一直没把它们传进去。mixin.applyCardStyle 正是负责组装这三个键。
const { CARD_TYPES, buildCardModel } = require('../../utils/templates/index');
const { computeLayout, draw } = require('../../utils/core/render_engine');
const { THEME_LIST } = require('../../utils/themes/index.js');
const { exportAndSave } = require('../../utils/share');
const { charge, costOf } = require('../../utils/charge');
const daily = require('../../utils/templates/daily'); // 每日文案库：日签/金句每天自动换一条（本地确定性轮换，零 AI）
const { surfaceLastError, currentEnvVersion, buildDebug, handlePrivacyApiFail } = require('../../../utils/diag.js');
const privacyPanel = require('../../../utils/privacy_panel.js'); // 隐私授权面板：同意按钮须用 open-type=agreePrivacyAuthorization
const cardStyle = require('../../utils/card_style_mixin');  // 排版风格 + 背景图（与天气/节气/金句/每日一句共用）

const TYPE_KEYS = ['dailysign', 'quote', 'recommend', 'notice', 'checklist', 'imagetext'];

// 每日日签的二维码（打包进小程序包内，绘制到卡片右下角）。
const QR_PATH = '/images/qrcode_miniapp.png';

// 今日日期标签：「9月30日 · 星期三」。
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

// 各模板的默认占位文本，降低首用门槛。
// 日签正文不再写死：直接取「今日推荐」——每天自动换一条，同一自然日所有人看到同一条。
const SEED = {
  dailysign: { type: 'dailysign', title: todayLabel(), body: daily.dailySignQuote().text },
  quote: { type: 'quote', title: '', body: '把复杂的事，讲简单；把简单的事，做扎实。', author: '' },
  recommend: { type: 'recommend', title: '推荐一件好物', body: '用了就回不去的小确幸，今天安利给你。', tag: '¥ 39 起', cover: '' },
  notice: { type: 'notice', title: '活动公告', body: '本周六晚 8 点，社群分享会准时开始，欢迎来聊。', author: '' },
  checklist: { type: 'checklist', title: '今日待办', items: ['梳理今天的三件要事', '写下一条朋友圈文案', '读 10 页书'], cover: '' },
  imagetext: { type: 'imagetext', title: '一张图，一段话', body: '记录此刻，分享给在意的人。', cover: '' }
};

const __pageCfg = {
  // 排版风格 / 背景图 / 衬底等出图参数由 card_style_mixin.defaults() 注入，
  // 与天气/节气/金句/每日一句四页共用同一份定义，改一处全站生效。
  data: Object.assign({
    privacyShow: false,   // 隐私授权面板显隐（组件 privacy-panel 消费）
    types: TYPE_KEYS.map(k => ({ key: k, name: CARD_TYPES[k].name, hint: CARD_TYPES[k].scene })),
    theme: 'warm',
    type: 'dailysign',
    form: SEED.dailysign,
    cover: '',             // 内容配图（种草卡/图文卡用，与背景图是不同槽位）
    bgImg: '',             // 卡片背景图（可选，铺满整卡）——用户从相册选的
    showHelp: false,
    err: '',
    dbg: '',               // 调试条（仅体验/开发版）
    rendered: false,
    canvasH: 0,
    savedTick: 0,          // 保存成功翻转计数（奇偶交替换 keyframes，铁律 5）
    savedKey: '',          // 'a'/'b' = 翻转中，'' = 常态（铁律 6 内联反馈替代 toast）
    poolSize: daily.poolSizeFor('dailysign'),  // 当前类型文案库储备量（按钮展示「库存 N 条」）
    cardCost: costOf('cardGen') || 20,   // 生成卡片单价（来自 POINTS.cost，集中配置）
    // 主题选择器数据（6 套数据化主题，渲染引擎自动读取配色）
    // ⚠️ 2026-10-24：原先主题 chip 渲染在页面顶部，现已并入 card-config 组件的
    //   「主题配色」区，故这里只保留数据源，WXML 不再单独铺一行。
    themes: THEME_LIST.map(t => ({ id: t.id, name: t.name, color: t.colors.primary }))
  }, cardStyle.defaults('literary')),   // 日签气质默认文艺风

  onShow() {
    surfaceLastError(this);
    if (currentEnvVersion() !== 'release') this.setData({ dbg: buildDebug(this) });
  },

  // 2026-10-24：恢复持久化的出图设置（排版风格 / 背景图 / 衬底强弱）
  onLoad() {
    this.initCardStyle('literary');
  },

  // 切换主题（warm/fresh/graphite/zen/ticket/olive）——数据驱动，渲染引擎自动读取
  //
  // ⚠️ 2026-10-24：兼容组件上抛（e.detail.id）与页面直绑（e.currentTarget.dataset.id）。
  //   出图设置抽成 card-config 组件后事件走 e.detail，只读 currentTarget 会静默失效
  //   （点主题没反应但不报错——最难查的一类断点）。
  onPickTheme(e) {
    const id = ((e && e.detail && e.detail.id) ||
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id));
    if (!id || id === this.data.theme) return;
    this.setData({ theme: id, rendered: false });
    // 换主题后若有已渲染的卡，原样重绘（不重复扣费——改样式不该再收一次钱）
    this.repaintCard();
  },

  // 已渲染时按当前出图参数重绘（切主题/换风格/换背景都走这里，不扣费）
  //
  // ⚠️ 名字必须是 repaintCard —— card_style_mixin.repaint 会优先调用页面的
  //   这个钩子（卡片页走声明式渲染引擎，不是 mixin 默认的 quote_card_render）。
  repaintCard() {
    if (!this.canvasNode || !this._lastRecord) return;
    try {
      const d = this.collectData();
      this.renderCard(d);
    } catch (e) { /* 重绘失败保留旧图，用户可手动再生成 */ }
  },

  onSelectType(e) {
    const k = e.currentTarget.dataset.key;
    // 每类卡片都从自己的文案库取「今日推荐」种子（结构化类型返回 title/body/tag/items）
    let seed;
    if (k === 'dailysign') {
      seed = { type: 'dailysign', title: todayLabel(), body: daily.dailySignQuote().text };
    } else if (k === 'quote') {
      seed = { type: 'quote', title: '', body: daily.todayQuote().text, author: '' };
    } else {
      seed = Object.assign({ type: k }, daily.seedForType(k) || {});
      if (seed.items) seed.items = seed.items.join('\n'); // 清单以换行编辑
      // 文案池异常时回退到静态种子，保证页面永远可用
      if (!seed.body && !seed.items) seed = Object.assign({}, SEED[k] || { type: k });
    }
    this._quoteOffset = 0; // 每次切类型重置「换一套」进度
    this.setData({ type: k, form: seed, cover: seed.cover || '', rendered: false, err: '', poolSize: daily.poolSizeFor(k) || daily.poolSize() });
  },

  // 「换一套」：从当前类型的文案库跳到下一套种子（同一天内不撞车，跨天回到当日主推）。
  onShuffleQuote() {
    const t = this.data.type;
    this._quoteOffset = (this._quoteOffset || 0) + 1;
    if (t === 'dailysign' || t === 'quote') {
      const q = (t === 'dailysign') ? daily.dailySignQuote(this._quoteOffset) : daily.todayQuote(this._quoteOffset);
      this.setData({ form: Object.assign({}, this.data.form, { body: q.t }), rendered: false });
      return;
    }
    const s = daily.seedForType(t, null, this._quoteOffset);
    if (!s) return;
    const seed = Object.assign({ type: t }, s);
    if (seed.items) seed.items = seed.items.join('\n');
    this.setData({ form: seed, rendered: false });
  },

  onField(e) {
    const field = e.currentTarget.dataset.field;
    const val = e.detail.value;
    const form = Object.assign({}, this.data.form, { [field]: val });
    // 清单：把文本框按行转数组（渲染时再用）。
    this.setData({ form });
  },

  onToggleHelp() {
    this.setData({ showHelp: !this.data.showHelp });
  },

  onChooseImage() {
    const self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(r) {
        const p = r.tempFiles && r.tempFiles[0] && r.tempFiles[0].tempFilePath;
        if (p) {
          self.setData({ cover: p, form: Object.assign({}, self.data.form, { cover: p }), rendered: false });
          wx.showToast({ title: '已选图，点制作', icon: 'none' });
        }
      },
      // ⚠️ 绝不能空 fail：隐私拦截/权限拒绝都会走这里，空实现会让「点了没反应」的真因被吞掉。
      fail(e) { handlePrivacyApiFail(self, '选择配图', e); }
    });
  },

  // 选择「背景图」：铺满整张卡片（与上方「配图」是不同槽位 —— 配图是内容图，背景图是底色）。
  //
  // ⚠️ 2026-10-24：保留为兼容壳。背景图的选择已统一由 card_style_mixin 提供
  //   （onPickBuiltinBg 内置图库 / onPickAlbumBg 相册 / onClearPhoto 取消），
  //   与天气/节气/金句/每日一句四页完全一致。本页旧的「选择背景图」按钮已移除，
  //   避免两个入口互相覆盖 localBg / bgImg 两个字段。
  onChooseBgImage() {
    this.onPickAlbumBg();
  },

  // 从表单收集内容数据（与渲染解耦，便于测试）
  collectData() {
    const f = this.data.form;
    const d = {};
    if (f.title !== undefined) d.title = f.title;
    if (f.body !== undefined) d.body = f.body;
    if (f.tag !== undefined) d.tag = f.tag;
    if (this.data.cover) d.cover = this.data.cover;
    if (this.data.type === 'checklist') {
      d.items = String(f.items || '').split('\n').map(s => s.trim()).filter(Boolean);
    }
    // 所有卡片类型右下角固定叠加包内小程序码（全自动，无需选图）。
    d.qr = QR_PATH;
    // 每日日签：标题留空时自动用今天日期；正文留空时自动取「今日推荐」。
    if (this.data.type === 'dailysign') {
      d.title = d.title || todayLabel();
      d.body = d.body || daily.dailySignQuote().text;
    }
    // 背景图（可选，铺满整卡；模板层会自动转白字 + 引擎叠暗色蒙版保证可读）。
    //
    // ⚠️ 2026-10-24：改由 card_style_mixin.applyCardStyle 统一组装，
    //   它负责：styleKey（排版风格）/ bgImg（背景图）/ bgVeil（衬底强弱）/ bgFallback（兜底）。
    //   优先级：相册临时图 > 内置压缩图库 > 主题渐变。
    //   旧版只认「用户从相册选的 bgImg」，既不支持内置图库，也不支持衬底强弱。
    const styled = cardStyle.applyCardStyle(this, d);
    return styled;
  },

  // 模板 × 主题 × 内容 → 声明式 model（交给引擎渲染）
  buildModel() {
    return buildCardModel(this.data.type, this.data.theme, this.collectData());
  },

  onGenCard() {
    const d = this.collectData();
    const hasText = (d.title || d.body || (d.items && d.items.length));
    const tpl = CARD_TYPES[this.data.type];
    if (!hasText && !(tpl.hasCover && d.cover)) {
      this.setData({ err: '先填点内容，或选一张图再制作', rendered: false });
      return;
    }
    const self = this;
    const cost = this.data.cardCost;
    this.setData({ err: '' });
    // 生成卡片要扣积分（复用 utils/charge 统一流程）；扣成功才渲染。
    charge('cardGen', { label: '制作卡片' }).then(() => {
      self.renderCard(d);
      wx.showToast({ title: '已制作卡片（-' + cost + '）', icon: 'none' });
    }).catch((e) => {
      // 余额不足 / 扣费失败 / 积分云服务不可用：把真因显式显示，避免「点生成毫无反应、画布空空」。
      self.setData({ err: '制作失败：' + ((e && e.message) || '积分服务暂不可用，请稍后重试') });
    });
  },

  renderCard(data) {
    const self = this;
    const d = data || self.collectData();
    wx.createSelectorQuery().select('#cardCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        self.setData({ err: '画布初始化失败，请重试' });
        return;
      }
      try {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = getDpr();
        const cssW = res[0].width || 340;

        // 文本测量：用真实 canvas measureText（按字号设置 font，保证折行准确）
        const measure = (t, fontPx) => {
          ctx.font = fontPx + 'px sans-serif';
          return ctx.measureText(t).width;
        };

        // 模板 × 主题 × 内容 → model（传入 canvas 实测 measure，折行更准）；再加载图片资产注入。
        const model = buildCardModel(self.data.type, self.data.theme, d, { measure });
        const loadImg = (src) => new Promise(resolve => {
          const img = canvas.createImage();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        });
        const jobs = [];
        if (d.cover) jobs.push(loadImg(d.cover).then(im => {
          const c = model.children.find(x => x.type === 'image' && x.src === d.cover);
          if (c && im) c.asset = im;
        }));
        if (d.qr) jobs.push(loadImg(d.qr).then(im => {
          const q = model.children.find(x => x.type === 'qrcode');
          if (q && im) q.asset = im;
        }));
        if (d.bgImg) jobs.push(loadImg(d.bgImg).then(im => {
          if (im) {
            model.backgroundImageAsset = im;
          } else if (d.bgFallback) {
            // ⚠️ 2026-10-24：背景加载失败 → 回落内置兜底图。
            //   相册临时路径可能被系统回收（用户在相册里删了原图），
            //   内置图加载失败才是最后一层 → 那时才回退主题渐变，不画占位。
            return loadImg(d.bgFallback).then(fb => {
              if (fb) model.backgroundImageAsset = fb;
              else delete model.backgroundImage;
            });
          } else {
            delete model.backgroundImage; // 无兜底 → 回退主题渐变，不画占位
          }
        }));

        Promise.all(jobs).then(() => {
          try {
            const layout = computeLayout(model, {}, measure);
            // 引擎按 340 逻辑宽布局；画布元素实际 css 宽 cssW → 等比缩放绘制，保证清晰不变形
            const k = cssW / layout.width;
            canvas.width = Math.round(layout.width * k * dpr);
            canvas.height = Math.round(layout.height * k * dpr);
            ctx.scale(dpr * k, dpr * k);
            draw(ctx, layout);
            self.canvasNode = canvas;
            self._lastRecord = { kind: 'card', type: self.data.type, theme: self.data.theme, title: d.title || '', body: String(d.body || (d.items && d.items.join(' ')) || '').slice(0, 30) };
            self.setData({ canvasH: Math.round(layout.height * k), rendered: true, err: '' });
          } catch (e) {
            self.setData({ err: '卡片渲染失败：' + ((e && e.message) || e || '未知错误') });
          }
        });
      } catch (e) {
        self.setData({ err: '卡片渲染失败：' + ((e && e.message) || e || '未知错误') });
      }
    });
  },

  // 保存成功翻转反馈（流体库 #27 · A 档）：rotateX 翻转变绿「✓ 已存相册」1.6s 复原；
  // 双套 keyframes 奇偶交替重放（铁律 5）；timer 存 this 防竞态（铁律 6）。
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
      wx.showToast({ title: '请先制作卡片', icon: 'none' });
      return;
    }
    // 导出 → 存相册 → 自动记入本地历史（utils/share 统一闭环：防重复提交 + 文件校验）
    exportAndSave(self, self.canvasNode, {
      savingKey: '_saving',
      historyTool: 'card',
      historyRecord: self._lastRecord || { kind: 'card' }
    }).then(() => {
      self.flipSaved(); // 内联翻转替代成功 toast
    }).catch((e) => {
      const msg = (e && e.errMsg) || (e && e.message) || '';
      if (msg === 'busy') return; // 防重复提交：保存中，静默
      if (/auth|deny|authorize/i.test(msg)) return; // 权限引导由 album.js 内部处理
      // 其余失败（导出/写入等）不允许静默：带真因提示，方便用户反馈与自查
      wx.showToast({ title: '保存失败：' + (msg ? msg.slice(0, 40) : '请重试'), icon: 'none', duration: 2600 });
    });
  }
};
// 注入出图设置交互（与天气/节气/金句/每日一句四页共用同一套 mixin）
//   initCardStyle · onPickStyle · onPickBuiltinBg · onPickAlbumBg
//   onShufflePhoto · onCyclePhotoMode · onClearPhoto
// ⚠️ 2026-10-24 新增：卡片页原先没有任何出图设置，只能选一张相册图当背景。
Object.assign(__pageCfg, cardStyle.cardStyleMethods);
Object.assign(__pageCfg, privacyPanel.privacyPanelMethods);
Page(__pageCfg);
