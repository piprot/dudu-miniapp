// components/add-mine/index.js
// ─────────────────────────────────────────────────────────────────────────────
// 「添加到我的小程序」引导按钮
//
// ⚠️ 必读：微信小程序**没有**「一键添加到我的小程序」的 API。
//   · `wx.addToFavorites` **不存在于小程序**（那是小游戏 API，要求 type:'miniProgram'
//     + webViewUrl，小程序侧不适用；社区里大量文章把它当小程序 API 是错的）。
//   · 小程序侧只有 `Page.onAddToFavorites` —— **被动钩子**，用户自己点右上角胶囊
//     → 收藏时才触发，开发者无法主动调起。
//   · 官方社区原话：「目前没有相关 api，你只能添加一个引导框指向右上角提示」。
//
// 所以这个组件做的是**行业标准解**：点按钮 → 弹出浮层 + 箭头指向右上角胶囊，
// 教用户点「收藏」。收藏后「我的小程序」列表里就有了。
//
// 设计要点：
//   ① 不能假装能一键添加。按钮文案说的是「添加到我的小程序」（用户的目标），
//      而不是「一键添加」或「收藏」（那会承诺做不到的事，跟之前把灰度改名
//      「深衬底」是同一个原则：不承诺做不到的事）。
//   ② 一次性引导。收藏成功后本设备不再弹（localStorage 记 flag），
//      反复弹会变骚扰。用户仍可从按钮手动再次打开。
//   ③ 胶囊位置不能写死。右上角胶囊在 iOS/Android、浅色/深色模式下位置不同，
//      所以浮层用「右上角固定块 + 箭头」的方式，靠 --status-bar 级别做偏移，
//      并在 onShow 里按 getMenuButtonBoundingClientRect 实测校正（见 index.js 底部）。
// ─────────────────────────────────────────────────────────────────────────────
const fav = require('../../utils/fav.js');

Component({
  properties: {
    // 页面是否允许展示引导（总开关）。关掉时连入口按钮一起隐藏。
    show: { type: Boolean, value: false },
    // 浮层主文案，按页面场景差异化（首页说「下次快速打开」，工具页说「常用这个工具」）
    text: { type: String, value: '收藏后可在「我的小程序」快速打开，下次不用再找' },
    // 按钮文案
    label: { type: String, value: '⭐ 添加到我的小程序' }
  },

  data: {
    // 浮层是否展开（**内部状态**，不写 properties.show —— 组件不该改父级传进来的 prop）
    panelOpen: false,
    // 胶囊实测位置（px），null 表示尚未测量 → 用 CSS 兜底值
    capsule: null,
    // 窗口宽（px）：算胶囊到右边缘的距离要用
    windowWidth: 375,
    // 本机是否已收藏过（用于把按钮文案从「添加」改成「已添加 ✓」）
    added: false
  },

  lifetimes: {
    attached() {
      let ww = 375;
      try {
        const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
        if (info && info.windowWidth) ww = info.windowWidth;
      } catch (e) { /* 用兜底 375 */ }
      this.setData({ added: fav.isAdded(), windowWidth: ww });
    }
  },

  pageLifetimes: {
    show() {
      this.measureCapsule();
      // 每次回到前台都问一次：用户可能刚从右上角收藏完回来
      this.refreshAdded();
    }
  },

  methods: {
    /**
     * 点入口按钮：开引导浮层。
     * 每次都实测一次胶囊位置——用户可能转屏、换机型，横竖屏下胶囊位置会变。
     */
    onTapBtn() {
      this.measureCapsule();
      this.setData({ panelOpen: true });
      this.triggerEvent('open');
    },

    /** 阻止 catchtouchmove 触发的默认滚动（方法体不能为空，否则被判定为未处理） */
    noop() {},

    /**
     * 实测右上角胶囊的位置，让箭头能精确指到它。
     * 拿不到就用 CSS 兜底（右侧 8px、顶部按状态栏高度）——
     * 箭头位置偏几个像素不影响理解，指向大致对就行，不必为像素完美牺牲可用性。
     */
    measureCapsule() {
      let rect = null;
      try {
        if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
          rect = wx.getMenuButtonBoundingClientRect();
        }
      } catch (e) { rect = null; }
      if (!rect || !rect.top || !rect.right) {
        this.setData({ capsule: null });
        return;
      }
      // 只用 top/right/width，够定位箭头；存 px 数值供 wxml 内联 style 用
      this.setData({ capsule: { top: rect.top, right: rect.right, width: rect.width } });
    },

    refreshAdded() {
      const added = fav.isAdded();
      if (added !== this.data.added) this.setData({ added });
    },

    /** 点「知道了」：关浮层。引导只是告知，不阻断任何流程。 */
    onClose() {
      this.setData({ panelOpen: false });
      this.triggerEvent('close');
    },

    /** 点浮层空白处也能关（符合直觉，别逼用户只能点按钮） */
    onMaskTap() {
      this.setData({ panelOpen: false });
      this.triggerEvent('close');
    },

    /**
     * 外部（页面 onShow）检测到收藏相关 scene 时调它，把按钮转成「已添加 ✓」。
     * 场景值判定与存储全在 utils/fav.js，组件只管改 UI，不重复实现判定逻辑。
     */
    markAdded() {
      fav.markAdded();
      this.setData({ added: true });
      this.triggerEvent('added');
    }
  }
});