// components/card-config/index.js
// ─────────────────────────────────────────────────────────────────────────────
// 卡片配置区（排版风格 + 背景图 + 主题）—— 金句/天气/节气/台词四页共用
//
// 为什么做成组件（2026-10-06 界面优化）：
//   这四页原本**各自抄了一份**完全相同的 WXML（block-title「排版风格」/「背景图」
//   / bg-item横滚 / bg-ops / theme-row ≈ 45 行 × 4 页 = 180 行重复）。后果：
//     ① 改一处要动四个文件，漏一个就漂移（金句页的文案与天气页的不一致就是活证据）
//     ② 四页控件在页面里的**位置各不相同**——天气页 4 个block 连续堆叠，
//        用户改完配置要往上翻才见「生成卡片」；金句页那块干脆插在列表和
//        「＋收藏金句」中间，把主流程切断了。
//   组件化后：结构只此一份，且**位置由页面用 slot 决定**，页面想放哪放哪。
//
// 组件只负责渲染与上抛事件，不持有状态——状态仍由页面的 card_style_mixin 管。
// 这样避免出现「组件内部改了 selected，页面却不知道」的双真相源。
//
// 另加一层「折叠」：这四页的配置项本质是**出图参数**，不是主任务。
// 按 impeccable 认知负荷清单的「渐进披露」原则，默认收起、给一个
// 「出图设置 ▾」入口 —— 首屏回到内容本身，而不是一堆控件。
// ─────────────────────────────────────────────────────────────────────────────
Component({
  options: {
    // 用 virtualHost 不必要（组件根节点需要参与布局），但显式声明避免隐式行为
    addGlobalClass: true
  },

  properties: {
    // ── 折叠态控制 ──
    // 页面通过 selectComponent 调 toggle() 也能开合；这个 prop 供「外部强制收起」
    forceCollapsed: { type: Boolean, value: false },
    // 首屏是否默认展开。四页都是「先出图、调样式是次要」→ 默认 false。
    defaultOpen: { type: Boolean, value: false },

    // ── 排版风格（来自 card_style_mixin.styleList）──
    styleList: { type: Array, value: [] },
    styleKey: { type: String, value: '' },
    // 风格说明文案（各页措辞不同，页面自己传，避免组件里写死）
    styleHint: { type: String, value: '' },

    // ── 背景图（来自 card_style_mixin）──
    builtinPhotos: { type: Array, value: [] },
    bgSource: { type: String, value: '' },
    bgPhotoId: { type: String, value: '' },
    localBg: { type: String, value: '' },
    photoModeLabel: { type: String, value: '' },
    bgAuthor: { type: String, value: '' },
    bgHint: { type: String, value: '' },

    // ── 主题 ──
    themes: { type: Array, value: [] },
    theme: { type: String, value: '' },

    // 主题标题：只有金句/天气/节气/台词四页有；card/poster 页传 false 即不渲染
    showTheme: { type: Boolean, value: true }
  },

  data: {
    // 内部展开态。**不写 properties** —— 与 add-mine 同理，组件不该改父级 prop。
    open: false
  },

  lifetimes: {
    attached() {
      this.setData({ open: !!this.data.defaultOpen });
    }
  },

  methods: {
    /** 点标题栏：展开 / 收起配置区 */
    onToggle() {
      if (this.data.forceCollapsed) return;   // 页面强制收起时不给开
      const open = !this.data.open;
      this.setData({ open });
      this.triggerEvent('toggle', { open });
    },

    /** 供页面主动开合（比页面自己维护一份 open 状态更可靠：组件是唯一真相源） */
    setOpen(open) {
      this.setData({ open: !!open });
    },

    /** 阻断冒泡：点配置区内容不该触到标题栏的收起 */
    noop() {},

    // ── 全部上抛，页面在 bind:* 上接（事件名与页面原 handler 同名，迁移零改名）──
    onPickStyle(e) { this.triggerEvent('style', { key: e.currentTarget.dataset.key }); },
    onPickBuiltinBg(e) { this.triggerEvent('builtin', { id: e.currentTarget.dataset.id }); },
    onPickAlbumBg() { this.triggerEvent('album'); },
    onClearPhoto() { this.triggerEvent('clearphoto'); },
    onShufflePhoto() { this.triggerEvent('shufflephoto'); },
    onCyclePhotoMode() { this.triggerEvent('cyclemode'); },
    onPickTheme(e) { this.triggerEvent('theme', { id: e.currentTarget.dataset.id }); }
  }
});
