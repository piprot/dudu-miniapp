const { BACKEND, VIRTUAL_PAY } = require('./utils/config.js');

App({
  globalData: {
    appName: 'dudu画面感内容工具'
  },
  onLaunch() {
    this.setupPrivacyGuard();
    this.setupUpdateGuard();
    // 虚拟支付或个体户路径任一启用云开发，都在此初始化
    const env = (VIRTUAL_PAY.enabled && VIRTUAL_PAY.useCloud && VIRTUAL_PAY.cloudEnv)
      || (BACKEND.useCloud && BACKEND.env)
      || '';
    if (env) {
      wx.cloud.init({ env, traceUser: true });
      // 静默记录本次访问（openid 唯一标识，无需授权）→ 运营侧可在云开发数据库 app_users 看到「有哪些用户用过」。
      // 发射即忘：失败不影响启动。只记 openid + 访问时间，昵称/头像需用户自愿填写。
      wx.cloud.callFunction({ name: 'vp_get_profile', data: { action: 'touch' } }).catch(() => {});
    }
  },

  /**
   * 全局脚本异常捕获（2026-10-02 排障插桩）。
   * 背景：comic/card/poster 三页在真机（体验版）上「跳转页面为空」，但
   *   ① Node 加载模拟器 require + data 初始化全部通过；
   *   ② 渲染引擎/模板离线预览截图全部正常；
   *   ③ 静态扫描无顶层 wx/getApp 调用、无低版本 JSCore 不支持的语法。
   * ⇒ 空白是真机运行期异常，离线不可复现。此钩子把真实报错浮出水面：
   *   仅 开发版/体验版 弹窗提示一次（正式版静默），并存 globalData.lastError 供页面读取。
   * 真因定位后可移除或保留（正式版无感知）。
   */
  onError(err) {
    try {
      const msg = String((err && err.message) || err || 'unknown').slice(0, 500);
      this.globalData.lastError = msg;
      // 持久化：globalData 在冷启动即丢失，存 storage 才能事后排查（含正式版）。
      try { wx.setStorageSync('__lastAppError__', { msg, t: Date.now() }); } catch (e) { /* 忽略 */ }
      let envVersion = 'release';
      try { envVersion = wx.getAccountInfoSync().miniProgram.envVersion; } catch (e) { /* 取不到按正式版处理 */ }
      if (envVersion !== 'release' && !this._errShown) {
        this._errShown = true;
        wx.showModal({ title: '脚本异常提示（体验/开发版）', content: msg, showCancel: false });
      }
    } catch (e) { /* 排障兜底，不再抛错 */ }
  },

  // 未处理的 Promise 拒绝（charge 链、cloud.callFunction 拒绝等）默认不触发 onError，
  // 会静默吞掉真因 → 页面表现就是「点生成毫无反应 / 整页空」。这里补上捕获并持久化。
  onUnhandledRejection(res) {
    try {
      const reason = (res && (res.reason || res.message)) || res || 'unhandledRejection';
      const msg = 'UnhandledRejection: ' + String(reason && reason.message ? reason.message : reason).slice(0, 500);
      this.globalData.lastError = msg;
      try { wx.setStorageSync('__lastAppError__', { msg, t: Date.now() }); } catch (e) { /* 忽略 */ }
      let envVersion = 'release';
      try { envVersion = wx.getAccountInfoSync().miniProgram.envVersion; } catch (e) { /* 忽略 */ }
      if (envVersion !== 'release' && !this._errShown) {
        this._errShown = true;
        wx.showModal({ title: '脚本异常提示（体验/开发版）', content: msg, showCancel: false });
      }
    } catch (e) { /* 忽略 */ }
  },

  /**
   * 隐私授权拦截器（个人主体小程序合规刚需，勿删）。
   *
   * 背景：app.json 开了 __usePrivacyCheck__。此后任何「隐私受保护 API」——本项目的
   * wx.chooseMedia（选背景图）、wx.setClipboardData（复制文案）——在用户未同意
   * 《隐私保护指引》前都会被拦截。
   *
   * ⚠️⚠️ 真踩过的坑（2026-10-05，真机 errMsg 原文）：
   *   `chooseMedia:fail privacy permission is not authorized or buttonId is wrong`
   * 起因是我用 **wx.showModal 自造弹窗 + 裸 resolve({event:'agree'})** —— 这是错的写法：
   *   ① 官方要求「同意」动作必须由 **`<button open-type="agreePrivacyAuthorization">`** 触发，
   *      平台只认这个 open-type 作同意凭证，纯 showModal 的「同意」不算；
   *   ② resolve 必须带 **buttonId** 且与该 button 的 id 一致，否则平台判
   *      buttonId is wrong ⇒ 授权不成立 ⇒ 原接口永久失败。
   *   ⇒ 症状是「点了同意、弹窗关了，但接口照样 fail」，用户看不到真因。
   *
   * ✅ 正解（官方 demo2 + 社区推荐）：
   *   1) 注册 wx.onNeedPrivacyAuthorization，把 resolve 存进 **Set**（用单个变量会被覆盖，
   *      并发接口时用户要点两次 —— 社区实测确认）；
   *   2) 面板「同意」按钮用 open-type="agreePrivacyAuthorization"，
   *      在 bindagreeprivacyauthorization 里调 settlePrivacyAgree(buttonId)；
   *   3) 全部 resolve 后清空 Set。
   * 关联守卫：test/test_privacy_classify.js、test/test_frontend_guards.js F4/F12。
   */
  setupPrivacyGuard() {
    // ⚠️ 用 Set 收集待 resolve 的回调，**不要用单个变量覆盖**：
    //    多个隐私接口同时触发时后一个会覆盖前一个，用户得点两次才过（社区实测确认）。
    this._privacyResolves = this._privacyResolves || new Set();

    const handler = (resolve) => {
      if (typeof resolve === 'function') this._privacyResolves.add(resolve);
      // 唤起自定义隐私说明面板；面板内「同意」按钮用 open-type="agreePrivacyAuthorization"
      try {
        const pages = getCurrentPages();
        const top = pages && pages[pages.length - 1];
        if (top && typeof top.showPrivacyPanel === 'function') top.showPrivacyPanel();
      } catch (e) { /* 忽略 */ }
    };

    // ⚠️ 顺序必须**新名优先**。
    // 实测（基础库 3.17.2，automation_evaluate 探针）：`wx.onNeedPrivacyAuthorize`（旧名）
    // 已经是 `undefined`，只存在 `wx.onNeedPrivacyAuthorization`（带 tion 后缀）。
    // 若把旧名写在前面并依赖 if/else，一旦将来两个名字同时存在，就会注册到**废弃的那个**上，
    // 框架真正触发的回调无人应答 → 受保护 API 静默失败、我们自己的说明弹窗也永不出现
    //（真机表现正是「点了没反应 / 无处可点」）。故新名优先、旧名兜底。
    if (typeof wx.onNeedPrivacyAuthorization === 'function') {
      wx.onNeedPrivacyAuthorization(handler);
    } else if (typeof wx.onNeedPrivacyAuthorize === 'function') {
      wx.onNeedPrivacyAuthorize(handler);
    }
  },

  /**
   * 统一 resolve 所有待处理的隐私授权回调。
   * 由页面「同意」按钮的 **bindagreeprivacyauthorization** 事件调用
   *（平台只认 <button open-type="agreePrivacyAuthorization"> 这个同意凭证）。
   * ⚠️ 必须带 buttonId —— 缺了平台会判 "buttonId is wrong" 而不认这次授权。
   */
  settlePrivacyAgree(buttonId) {
    try {
      const set = this._privacyResolves;
      if (!set || !set.size) return;
      const id = buttonId || 'privacy-agree-btn';
      set.forEach((fn) => {
        try { fn({ event: 'agree', buttonId: id }); } catch (e) { /* 单个失败不影响其它 */ }
      });
      set.clear(); // resolve 是一次性回调，清空避免重复触发
    } catch (e) { /* 忽略 */ }
  },

  /** 用户点「暂不」：同样必须 resolve，否则原隐私接口永久 pending。 */
  settlePrivacyDisagree() {
    try {
      const set = this._privacyResolves;
      if (!set || !set.size) return;
      set.forEach((fn) => {
        try { fn({ event: 'disagree' }); } catch (e) { /* 忽略 */ }
      });
      set.clear();
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 版本更新守卫：审核通过发布后，新包在后台异步下载；就绪时提示用户重启生效。
   * 没有它，发版修复只能等用户手动杀进程重进才生效——线上故障恢复会慢一个量级。
   * 下载失败静默（用户下次冷启动自然拿到新包），不打扰。
   */
  ,setupUpdateGuard() {
    if (typeof wx === 'undefined' || !wx.getUpdateManager) return;
    const um = wx.getUpdateManager();
    um.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已准备好，是否重启应用？',
        success(r) { if (r.confirm) um.applyUpdate(); }
      });
    });
    um.onUpdateFailed(() => { /* 静默兜底 */ });
  }
});
