// components/privacy-panel/index.js
// 隐私授权面板组件（详见 index.wxml 顶部注释：open-type 是合规硬要求）
const { privacyPanelMethods } = require('../../utils/privacy_panel.js');

Component({
  // 面板显隐由父页面通过 properties 传入
  properties: {
    privacyShow: { type: Boolean, value: false }
  },
  methods: {
    noop() {},

    // 直接复用页面侧实现（同一个 app.settlePrivacyAgree 出口，避免两套逻辑漂移）
    onAgreePrivacy: privacyPanelMethods.onAgreePrivacy,
    onDisagreePrivacy: privacyPanelMethods.onDisagreePrivacy,
    onOpenPrivacyContract: privacyPanelMethods.onOpenPrivacyContract
  }
});
