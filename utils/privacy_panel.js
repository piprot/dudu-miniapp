// utils/privacy_panel.js
// 隐私授权面板的**页面侧行为**（配合 app.js 的 settlePrivacyAgree/Disagree 使用）。
//
// 为什么需要它（2026-10-05 真机事故）：
//   真机报 `privacy permission is not authorized or buttonId is wrong`。
//   起因是「同意」动作用 wx.showModal 自造 ⇒ 平台不认。官方要求同意必须由
//   `<button open-type="agreePrivacyAuthorization">` 触发，且 resolve 时带上该 button 的 id。
//   ⇒ 页面里必须有那个 open-type 按钮，并把它的事件接到 app.settlePrivacyAgree()。
//
// 用法（每个含隐私接口的页面）：
//   1) page.js  引入本模块（路径 utils/privacy_panel），把 privacyPanelMethods 并入 Page 配置：
//        const __cfg = { ...页面配置..., privacyShow: false };
//        Object.assign(__cfg, privacyPanel.privacyPanelMethods);
//        Page(__cfg);
//   2) page.wxml 末尾加入 <privacy-panel privacy-show="{{privacyShow}}" /> 组件标签
//   3) page.json 的 usingComponents 注册 "privacy-panel": "../../components/privacy-panel/index"
//
// ⚠️ 铁律：
//   - 同意按钮 id 必须与 resolve 的 buttonId 一致，否则又判 buttonId is wrong。
//   - 不要再用 showModal 模拟同意（那正是本次事故根因）。
//   - 拒绝也必须 resolve（settlePrivacyDisagree），否则原接口永久 pending。

const AGREE_BTN_ID = 'privacy-agree-btn';

// 页面 data 片段
function privacyPanelData() {
  return { privacyShow: false };
}

// 页面方法（挂到 Page 上）
const privacyPanelMethods = {
  // 由 app.js 的 onNeedPrivacyAuthorization 回调触发
  showPrivacyPanel() {
    this.setData({ privacyShow: true });
  },

  // ⚠️ 必须绑在 <button open-type="agreePrivacyAuthorization" bindagreeprivacyauthorization="...">
  //    平台的「同意凭证」就是这个 open-type；不用它平台不认这次授权。
  onAgreePrivacy() {
    const app = getApp();
    if (app && typeof app.settlePrivacyAgree === 'function') {
      app.settlePrivacyAgree(AGREE_BTN_ID);
    } else {
      // 极端兜底：app 实例异常时也要把面板关掉，避免卡在遮罩上
      console.warn('[privacy] app.settlePrivacyAgree 不可用');
    }
    this.setData({ privacyShow: false });
  },

  // 用户点「暂不」。必须 resolve({event:'disagree'})，否则原隐私接口永久 pending。
  onDisagreePrivacy() {
    const app = getApp();
    if (app && typeof app.settlePrivacyDisagree === 'function') app.settlePrivacyDisagree();
    this.setData({ privacyShow: false });
  },

  // 打开《隐私保护指引》原文（wx.openPrivacyContract 是官方能力，会展示后台配置的那份）
  onOpenPrivacyContract() {
    try {
      wx.openPrivacyContract({
        fail: () => {
          // 低版本兜底：不阻断主流程
          wx.showToast({ title: '请在「设置-服务内容」查看隐私指引', icon: 'none' });
        }
      });
    } catch (e) { /* 忽略 */ }
  }
};

// 便于 Page({ ...privacyPanelMethods }) 展开
const privacyPanelMixin = (extra) => Object.assign({}, privacyPanelMethods, extra || {});

module.exports = { AGREE_BTN_ID, privacyPanelData, privacyPanelMethods, privacyPanelMixin };
