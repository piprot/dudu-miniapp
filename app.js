const { BACKEND, VIRTUAL_PAY } = require('./utils/config.js');

App({
  globalData: {
    appName: 'dudu画面感内容工具'
  },
  onLaunch() {
    this.setupPrivacyGuard();
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
   * 隐私授权拦截器（个人主体小程序合规刚需，勿删）。
   *
   * 背景：app.json 开了 __usePrivacyCheck__。此后任何「隐私受保护 API」——本项目的
   * wx.chooseMedia（添加图片）、wx.setClipboardData（复制文案）——在用户未同意
   * 《隐私保护指引》前都会被静默拦截（表现为「点了没反应」）或走系统空授权页。
   *
   * 正解 = 注册 onNeedPrivacyAuthorize 监听：框架把该 API 挂起（pending），回调里
   * 由我们弹出说明，用户点「同意」后调用 resolve({event:'agree'})，框架自动**重跑**
   * 原 API，复制/选图即正常执行。
   *
   * ⚠️ 铁律（踩过两次）：
   * 1) 回调里【绝不能再调用 wx.requirePrivacyAuthorize】——它本身就会触发本监听器，
   *    会与 showModal 形成「同意→再弹→再同意」的无限循环。
   * 2) 确认时【只调用一次 resolve({event:'agree'})】，**不要再先调 exposureAuthorization**。
   *    resolve 是一次性回调，先调 exposureAuthorization 会消耗它，导致 agree 被忽略、
   *    原隐私接口（选图/复制）永不重跑 —— 表现就是「点了没反应」。曝光由弹窗已展示隐含。
   */
  setupPrivacyGuard() {
    const handler = (resolve) => {
      const settle = (event) => {
        if (typeof resolve === 'function') resolve({ event });
      };
      wx.showModal({
        title: '隐私授权说明',
        content: '为使用「添加图片」「复制文案」功能，需要你同意《隐私保护指引》。你的图片与文案仅用于本次操作，不会另作他用，也不会提供给第三方。',
        confirmText: '同意',
        cancelText: '暂不',
        success: (res) => {
          if (res.confirm) {
            // ⚠️ 确认时【只调用一次】 resolve({event:'agree'})。
            // resolve 是一次性回调：若先调 exposureAuthorization 会消耗本次回调，
            // 导致 agree 被忽略、原隐私接口（选图/复制）永不重跑 —— 表现就是「点了没反应」。
            // 曝光由「弹窗已展示」隐含，无需单独上报。
            settle('agree');
          } else {
            settle('disagree');
          }
        },
        // 弹窗自身异常时按拒绝处理，避免原 API 永久 pending
        fail: () => settle('disagree')
      });
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
  }
});
