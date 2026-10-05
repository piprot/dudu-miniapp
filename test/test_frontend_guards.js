// 前端回归守卫（零依赖，纯静态断言）
//
// 为什么需要它：下面每一条都**真实踩过**，且踩的时候后端测试全绿、语法全过 ——
// 因为它们是前端页面的行为/样式约定，云函数测试与语法检查都覆盖不到，只能靠
// 「改坏 → 真机反馈 → 手改回来」的代价换来。本文件把这些约定固化成断言，
// 下次再改坏会在提交前就红掉。
//
// 检查项：
//   F1 成品示例页只预览前 N 页（曾整本 54 页全铺开，页面长到滑不到底）
//   F2 首页不内联 AI 画格，且 H5 桥接已整体下线（2026-09-29：端内不再跳 H5）
//   F3 复制/选图**不得**预门控（曾经用 requirePrivacyAuthorize 包一层，
//      把调用挪进异步回调 → 丢掉手势上下文 → 真机必失败且真因被文案掩盖）
//   F4 app.js 隐私监听必须**新名优先**（旧名 wx.onNeedPrivacyAuthorize 在基础库
//      3.17.2 已是 undefined；旧名写前面会注册到废弃的那个 → 受保护 API 静默失败）
//   F5 app.js 内部**绝不**调用 wx.requirePrivacyAuthorize（会与自己的弹窗形成死循环）
//   F6 单行输入框必须显式给 height（原生 <input> 不把 padding 计入高度 → 文字只显示一半）
//   F7 积分页必须有「隐私待同意」的可点入口 + 头像/昵称为什么要手动选的说明
//   F8 commission 页不得内联 AI 样图，且不再有 H5 文字入口（2026-09-29 下线）
//   F9 pages/h5 桥接页必须保持已删除（端内零 H5 依赖，个人主体纯本地工具）
//
// 运行：node test/test_frontend_guards.js      期望：全部通过，退出码 0
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 去注释：断言必须打在**活代码**上，否则改注释就能让断言失真
function stripJs(src) {
  let out = '', i = 0; const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n) { if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; } out += src[i]; if (src[i] === q) { i++; break; } i++; }
      continue;
    }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
const stripMarkup = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const live = (rel) => {
  const s = read(rel);
  return rel.endsWith('.js') ? stripJs(s) : stripMarkup(s);
};

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (why ? '\n      → ' + why : '')); }
};

console.log('=== 前端回归守卫 ===\n');

// ── F1 成品示例页只预览前 N 页 ──
{
  const src = live('packageSample/pages/sample/sample.js');
  const mCount = src.match(/const\s+COUNT\s*=\s*(\d+)/);
  const mPrev = src.match(/const\s+PREVIEW\s*=\s*(\d+)/);
  ok('F1a sample.js 声明了 COUNT 与 PREVIEW',
    !!mCount && !!mPrev,
    '缺少 COUNT/PREVIEW 常量 —— 无法约束渲染页数');
  if (mCount && mPrev) {
    const COUNT = Number(mCount[1]), PREVIEW = Number(mPrev[1]);
    ok('F1b PREVIEW 必须小于 COUNT（否则等于整本铺开）',
      PREVIEW > 0 && PREVIEW < COUNT,
      'PREVIEW=' + PREVIEW + ' COUNT=' + COUNT + '：整本铺出来会把页面拉得极长，用户滑不到底');
    // 渲染循环必须按 PREVIEW 截断，而不是按 COUNT 全量 push
    // （示例页用的是无花括号的单语句 for，所以 { 要写成可选，否则断言自己会假红）
    const loop = src.match(/for\s*\([^)]*i\s*<=\s*(\w+)[^)]*\)\s*\{?\s*panels\.push/);
    ok('F1c 渲染循环上界用的是 n（= min(PREVIEW, COUNT)）而非 COUNT',
      !!loop && loop[1] === 'n',
      '循环直接跑 COUNT 就会渲染全本');
    ok('F1d 有 n = Math.min(PREVIEW, COUNT) 的兜底',
      /Math\.min\s*\(\s*PREVIEW\s*,\s*COUNT\s*\)/.test(src),
      '缺 Math.min 时 PREVIEW 配大了会数组越界（生成不存在的图片路径 → 真机白块）');
  }
  const wxml = live('packageSample/pages/sample/sample.wxml');
  ok('F1e 页面有「全本共 N 页」的说明（用户要知道这是预览）',
    /全本共\s*\{\{\s*total\s*\}\}\s*页/.test(wxml),
    '不给说明的话，用户会以为成品只有 8 页');
}

// ── F2 首页不内联 AI 画格，且 H5 桥接已整体下线（2026-09-29）──
{
  const src = live('pages/index/index.js');
  ok('F2a 首页已无 goH5Sample（H5 桥接下线，端内纯本地工具）',
    !/goH5Sample/.test(src),
    '首页又出现跳 H5 的入口 —— 端内已全面去 H5，别加回来');
  ok('F2b 首页已移除内联 AI 画格预览（无 SAMPLE_PREVIEW/sampleChapters）',
    !/SAMPLE_PREVIEW/.test(src) && !/sampleChapters/.test(src) && !/chapters\.slice/.test(src),
    '首页仍在内联渲染 AI 画格，会被审核判深度合成');
  const wxml = live('pages/index/index.wxml');
  ok('F2c 首页已无 sample-section / 跳 H5 卡片（不内联 sampleChapters）',
    !/sample-section/.test(wxml) && !/goH5Sample/.test(wxml) && !/wx:for="\{\{\s*sampleChapters\s*\}\}"/.test(wxml),
    '首页仍直接遍历 sampleChapters 内联 AI 内容');
}

// ── F8 已删除：pages/commission 页面已整体移除（去生成化重构，付费定制内容不再端内提供）──

// ── F9 pages/h5 桥接页必须保持已删除（2026-09-29 端内去 H5）──
{
  const appJson = JSON.parse(read('app.json'));
  ok('F9a app.json 不再注册 pages/h5/h5',
    !appJson.pages.some(p => /pages\/h5/.test(p)),
    'pages/h5 已随端内去 H5 删除，app.json 里别再注册回来');
  ok('F9b pages/h5 目录保持不存在',
    !fs.existsSync(path.join(ROOT, 'pages', 'h5')),
    'pages/h5 目录又回来了 —— 端内零 H5 依赖是审核前提');
  ok('F9c utils/config.js 已无 H5 桥接字段',
    !/const\s+H5\s*=/.test(read('utils/config.js')) && !/H5\.comicUrl/.test(read('utils/config.js')),
    'config.js 又挂回 H5.comicUrl，但已无消费方，只会误导后续开发');
}

// ── F3 复制 / 选图不得预门控 ──
// 2026-09-29 起 gen 为纯文本工具（无选图）；选图守卫落点改 pages/card/card.js。
{
  const src = live('pages/gen/gen.js');
  ok('F3a gen.js 不得使用 withPrivacy 包装（曾经因此真机必失败）',
    !/withPrivacy/.test(src),
    'requirePrivacyAuthorize 包一层会把受保护 API 挪进异步回调 → 丢掉手势上下文 → 真机必失败，'
    + '且真实错误（api scope is not declared in the privacy agreement）被自家文案掩盖');
  ok('F3b gen.js 不得调用 wx.requirePrivacyAuthorize',
    !/wx\.requirePrivacyAuthorize/.test(src),
    '正解是直接调用受保护 API，由框架触发监听并在同意后自动重跑');
  ok('F3c gen.js 保持纯文本：不含任何选图调用（onChooseImage/chooseMedia 不得回潜）',
    !/onChooseImage|chooseMedia/.test(src),
    'gen 已无选图功能（图片能力归 pages/card）；要加回必须直接调 API 并带 fail 真因分支');
  ok('F3e 直接调用 wx.setClipboardData',
    /wx\.setClipboardData\s*\(/.test(src),
    '复制 API 丢失');
  const mCopy = src.match(/copyText\s*\([^)]*\)\s*\{([\s\S]*?)\n  \},/);
  ok('F3f copyText 必须有 fail 反馈分支（不能静默失败）',
    !!mCopy && /fail\s*\(/.test(mCopy[1]),
    '静默失败时用户只看到「点了没反应」，也无从知道能长按手动复制');

  // 选图守卫落点：pages/card/card.js（B 方向卡片生成器，当前唯一选图页）
  const card = live('pages/card/card.js');
  ok('F3d card.js 直接调用 wx.chooseMedia（无 withPrivacy / requirePrivacyAuthorize 门控）',
    /wx\.chooseMedia\s*\(/.test(card) && !/withPrivacy|requirePrivacyAuthorize/.test(card),
    '选图 API 丢失或被前置授权门挡掉 → 「点了没反应」或报未授权');
  ok('F3g card.js 存相册 fail 分支能识别 auth/deny（保存失败不静默）',
    /auth\|deny\|authorize/.test(card),
    '不区分真因时用户只会看到笼统的「保存失败」，无从知道要去设置开相册权限');
}

// ── F4/F5 app.js 隐私监听注册 ──
{
  const src = live('app.js');
  const iNew = src.indexOf('wx.onNeedPrivacyAuthorization(');
  const iOld = src.indexOf('wx.onNeedPrivacyAuthorize(');
  ok('F4a app.js 注册了隐私监听', iNew >= 0 || iOld >= 0, '未注册监听则受保护 API 永久 pending');
  ok('F4b 新名 wx.onNeedPrivacyAuthorization 必须先注册',
    iNew >= 0 && (iOld < 0 || iNew < iOld),
    '⚠️ 旧名 wx.onNeedPrivacyAuthorize 在基础库 3.17.2 已是 undefined；'
    + '若把旧名写前面并依赖 if/else，会注册到废弃的那个 → 框架真正触发的回调无人应答 → '
    + '受保护 API 静默失败、自家说明弹窗也永不出现（真机表现就是「点了没反应」）');
  ok('F4c 旧名仍作为兜底保留（低版本基础库兼容）',
    iOld >= 0,
    '删掉旧名会让旧基础库完全失去兜底');
  ok('F5 app.js 内绝不调用 wx.requirePrivacyAuthorize',
    !/wx\.requirePrivacyAuthorize/.test(src),
    '监听回调里调它会与自家 showModal 形成「同意→再弹→再同意」无限循环（踩过两次）');
  ok('F5b 回调只 settle 一次（不先调 exposureAuthorization）',
    !/exposureAuthorization/.test(src),
    'resolve 是一次性回调；先调 exposureAuthorization 会消耗它 → agree 被忽略 → 原 API 永不重跑');
}

// ── F6 单行输入框必须显式给 height ──
{
  const css = live('pages/gen/gen.wxss');
  const m = css.match(/\.field-input\s*\{([^}]*)\}/);
  ok('F6a .field-input 规则存在', !!m, '样式规则丢失');
  if (m) {
    ok('F6b .field-input 显式声明了 height',
      /(^|[;\s])height\s*:/.test(m[1]),
      '⚠️ 小程序 <input> 是原生组件，不像常规块元素把 padding 计入自身高度；'
      + '只设 padding 不设 height 会挤压内容区 —— 真机表现就是「每一行只显示一半的字」');
  }
  const ma = css.match(/\.field-area\s*\{([^}]*)\}/);
  ok('F6c 多行输入用 auto 高度 + 内边距撑开',
    !!ma && /height\s*:\s*auto/.test(ma[1]) && /padding\s*:/.test(ma[1]),
    'textarea 用固定 height 会与 auto-height 冲突');
}

// ── F7 积分页：隐私可点入口 + 手动选择说明 ──
{
  const js = live('pages/points/points.js');
  const wxml = live('pages/points/points.wxml');
  ok('F7a points.js 用 wx.getPrivacySetting 主动查询授权态',
    /wx\.getPrivacySetting\s*\(/.test(js) && /checkPrivacy/.test(js),
    '不主动查，用户就只能面对一个点了没反应的加号');
  ok('F7b 提供了用户可点的同意入口（requirePrivacyAuthorize 由点击触发）',
    /onAgreePrivacy/.test(js) && /wx\.requirePrivacyAuthorize\s*\(/.test(js),
    '只能由用户点击触发；写进启动流程会死循环');
  ok('F7c wxml 有 privacyNeed 时才显示的可点条目',
    /class="privacy-bar"/.test(wxml) && /onAgreePrivacy/.test(wxml),
    '隐私待同意时页面没有任何可点项 → 用户以为页面坏了');
  ok('F7d 说明了微信不允许自动读取头像/昵称（避免用户等一个不存在的按钮）',
    /微信不允许小程序自动读取/.test(wxml),
    '微信设计上就没有「一键同步微信头像昵称」的静默接口，必须讲清路径');
  ok('F7e 昵称输入框 type="nickname"（唤起系统「使用微信昵称」快捷填充）',
    /type="nickname"/.test(wxml),
    '缺 type=nickname 就没有快捷填充，用户只能手打');
  // chooseAvatar 被拦时无任何回调（不报错不弹窗）→ 需 bindtap 兜底；
  // 但**绝不能**用"点击后 N 秒无回调就报错"，那会盖在真机正常弹出的头像面板上（假阳性）。
  ok('F7f 头像按钮有 bindtap 兜底（chooseAvatar 被拦时无任何回调）',
    /bindchooseavatar="onChooseAvatar"/.test(wxml) && /bindtap="onAvatarTap"/.test(wxml)
    && /onAvatarTap/.test(js) && /_avatarPicked/.test(js),
    'open-type="chooseAvatar" 被隐私闸门拦下时既不报错也不回调，只绑 bindchooseavatar 等于「点了没反应」');
  {
    const mTap = js.match(/onAvatarTap\(\)\s*\{([\s\S]*?)\n  \},/);
    ok('F7g 头像兜底用「连点两次」判定，不得用固定超时',
      !!mTap && /_avatarLastTap/.test(mTap[1]) && !/setTimeout/.test(mTap[1]),
      '⚠️ 真机点加号会先弹出微信头像面板，用户挑图常 >2s；用 setTimeout 固定超时必然'
      + '盖在正常弹出的面板上乱报错（假阳性比不说话更糟）。面板会盖住按钮 → 用户点不到，'
      + '所以「能点第二次」才是可靠的失败信号');
  }
}

// ── F10 打包完整性：packOptions.ignore 不得吃掉 app.json 注册的页面 ──
// 真踩过：gen 页曾是 AI 生成页，合规清理时被临时加进 packOptions.ignore「下线」；
// 后 B1 改造把它重写为纯本地工具箱、app.json 注册 + 首页加入口，却忘了从 ignore 移除 ——
// 开发者工具里一切正常（预览不受 ignore 影响的程度取决于版本），**上传的线上包里 pages/gen 根本不存在**，
// 用户点「文案工具箱」直接白屏。所有既有测试仍全绿（没有任何测试读 project.config.json）。
{
  const appJson = JSON.parse(live('app.json'));
  const pages = appJson.pages || [];
  ok('F10a app.json 至少注册了一个页面', pages.length > 0, 'pages 为空，包里将没有任何可打开页面');

  // F10b 每个注册页面的 js/wxml 必须真实存在（少了就是线上白屏，且无编译报错）
  pages.forEach(p => {
    ['.js', '.wxml'].forEach(ext => {
      ok('F10b 页面文件齐全 ' + p + ext, fs.existsSync(path.join(ROOT, p + ext)),
        'app.json 注册了 ' + p + '，但磁盘上找不到 ' + p + ext + ' —— 线上打开该页必然白屏');
    });
  });

  // F10c packOptions.ignore 不得忽略任何注册页面（前缀匹配：目录级忽略也算）
  {
    const pc = JSON.parse(live('project.config.json'));
    const ignored = ((pc.packOptions && pc.packOptions.ignore) || []).map(x => String(x.value || ''));
    pages.forEach(p => {
      const hit = ignored.find(ig => ig && (p === ig || p.indexOf(ig + '/') === 0 || ig.indexOf(p + '/') === 0));
      ok('F10c 注册页面未被 ignore 排除 ' + p, !hit,
        'packOptions.ignore 的 "' + hit + '" 会把注册页面 ' + p + ' 排除出线上包 —— '
        + '预览时正常、上传后白屏（真踩过：pages/gen 被临时下线后忘了移除）。'
        + '若确要下线该页，请先从 app.json.pages 摘除再 ignore。');
    });
  }
}

// ── F11 合规红线：UGC 生成页不得有「转发/朋友圈分享」与「署名」入口（个人主体）──
// 真踩过：v1.1.23 官方提审被拒 —— 「涉及用户自行生成内容（文字、图片）的记录、分享，
// 属社交-笔记范畴，为个人主体小程序未开放类目」。根因正是 3 个 UGC 生成页
// （gen/card/poster）都带 onShareAppMessage/onShareTimeline + showShareMenu，
// 且 poster 还带落款/昵称/头像「署名」。整改后（1df92ba）全部移除。
// 本守卫的作用：防止以后「顺手加个分享按钮」把类目又打回社交-笔记 —— 那种回退
// 在提交前没有任何编译/单测会红，只有提审被拒才发现，代价极高。
// 注意：这里刻意**只查 3 个 UGC 生成页**，不管 index/commission/points/order
// （那几个是「转发小程序本体」，不涉及 UGC 分享，合法且需保留）。
{
  const UGC_PAGES = ['pages/gen/gen', 'pages/card/card', 'pages/poster/poster'];

  UGC_PAGES.forEach(p => {
    const js = live(p + '.js');
    const wxml = fs.existsSync(path.join(ROOT, p + '.wxml')) ? live(p + '.wxml') : '';

    // F11a 不得注册转发/朋友圈分享处理器
    ok('F11a ' + p + ' 无 onShareAppMessage/onShareTimeline',
      !/\bonShareAppMessage\b/.test(js) && !/\bonShareTimeline\b/.test(js),
      p + ' 又注册了分享处理器 —— 叠加「用户自行生成内容」即触发社交-笔记类目，'
      + '个人主体会被驳回。若确需分享，先评估申请企业主体。');

    // F11b 不得主动开启分享菜单（转发/朋友圈入口）
    ok('F11b ' + p + ' 无 wx.showShareMenu', !/wx\.showShareMenu/.test(js),
      p + ' 又调用了 wx.showShareMenu 开启转发/朋友圈入口，同样触发社交-笔记类目。');

    // F11c 不得残留署名（落款/昵称/头像）输入
    const sigFields = wxml.match(/data-field="(author|nickname)"/g) || [];
    ok('F11c ' + p + ' 无署名输入字段（落款/昵称）', sigFields.length === 0,
      p + ' 的 wxml 又出现了署名输入（' + sigFields.join(',') + '）—— 署名+生成+分享'
      + '是社交-笔记的完整特征。');

    // F11d 页面不得出现「发朋友圈 / 群」类传播引导文案
    const spread = /发朋友圈|分享给|一键发布/.exec(wxml);
    ok('F11d ' + p + ' 无传播引导文案', !spread,
      p + ' 的文案里出现「' + (spread ? spread[0] : '') + '」—— 应统一表述为'
      + '「仅保存到本机相册，不提供内容发布与传播功能」。');
  });

  // F11e poster 不得再残留头像/署名相关逻辑（头像是最典型的 UGC 署名载体）
  const posterJs = live('pages/poster/poster.js');
  ok('F11e poster 页无 onChooseAvatar/data.avatar 署名逻辑',
    !/\bonChooseAvatar\b/.test(posterJs) && !/data\.avatar/.test(posterJs),
    'poster 页又出现头像署名逻辑 —— 整改后已移除，选图仅保留「背景图」。');
}

// ── F12 隐私授权面板：同意必须走 open-type（2026-10-05 真机事故回归）──
// 真踩过：真机 `chooseMedia:fail privacy permission is not authorized or buttonId is wrong`。
// 起因是我用 wx.showModal 自造「同意」+ 裸 resolve({event:'agree'}) —— 平台不认这种同意：
//   官方要求同意动作必须由 <button open-type="agreePrivacyAuthorization"> 触发，
//   且 resolve 要带该按钮的 buttonId，否则判 buttonId is wrong ⇒ 授权不成立 ⇒
//   「点了同意、弹窗关了，接口照样 fail」，用户看不到真因。
// 官方正解（demo2）：resolve 收进 Set（不能用单个变量覆盖，否则并发接口要点两次）+ 同意时带 buttonId。
{
  const appLive = live('app.js');   // 去掉注释的活代码：注释里提到 showModal 不算违规
  const panelWxml = read('components/privacy-panel/index.wxml');

  ok('F12a app.js 不再用 showModal 模拟隐私同意',
    !/showModal\(\{[\s\S]{0,200}隐私授权/.test(appLive),
    '❌ 回到事故写法：用 showModal 当同意按钮，平台不认（buttonId is wrong）。'
    + '同意必须由 <button open-type="agreePrivacyAuthorization"> 触发。');
  ok('F12b app.js 提供 settlePrivacyAgree 且带 buttonId',
    /settlePrivacyAgree/.test(appLive) && /buttonId/.test(appLive),
    '缺 settlePrivacyAgree/buttonId ⇒ 无法把同意凭证回传给平台');
  ok('F12c resolve 用 Set 收集（不用单个变量覆盖）',
    /_privacyResolves\s*=\s*this\._privacyResolves\s*\|\|\s*new Set\(\)/.test(appLive),
    '用单个变量存 resolve 会在多接口并发时被覆盖，用户得点两次才通过（社区实测）。');
  ok('F12d 组件同意按钮带 open-type="agreePrivacyAuthorization"',
    /open-type="agreePrivacyAuthorization"/.test(panelWxml),
    '❌ 同意按钮缺 open-type ⇒ 平台不认这次授权，真机报 buttonId is wrong。');
  ok('F12e 同意事件绑 bindagreeprivacyauthorization（不是 bindtap）',
    /bindagreeprivacyauthorization="onAgreePrivacy"/.test(panelWxml),
    '必须用 bindagreeprivacyauthorization；用 bindtap 平台收不到同意凭证。');
  ok('F12f 同意按钮 id 与 settlePrivacyAgree 的 buttonId 一致',
    /id="privacy-agree-btn"/.test(panelWxml)
    && /AGREE_BTN_ID\s*=\s*'privacy-agree-btn'/.test(read('utils/privacy_panel.js')),
    '两处 buttonId 不一致 ⇒ 平台判 buttonId is wrong，授权不成立。');
  ok('F12g 拒绝也会 resolve（否则原接口永久 pending）',
    /settlePrivacyDisagree/.test(appLive) && /event:\s*'disagree'/.test(appLive),
    '拒绝分支不 resolve ⇒ 受保护 API 永久挂起，表现为「点了没反应」。');

  // 每个含隐私接口的页面都必须挂上组件，否则平台无同意凭证可认
  ['index', 'gen', 'card', 'poster'].forEach(p => {
    const json = read('pages/' + p + '/' + p + '.json');
    const wxml = read('pages/' + p + '/' + p + '.wxml');
    const js = read('pages/' + p + '/' + p + '.js');
    ok('F12h ' + p + ' 页已挂载 privacy-panel 组件',
      /privacy-panel/.test(json) && /<privacy-panel/.test(wxml) && /privacyPanel/.test(js),
      p + ' 用了隐私接口却没挂 privacy-panel ⇒ 用户无处点击「同意」，接口必然失败。');
  });
}

process.exitCode = fail ? 1 : 0;
