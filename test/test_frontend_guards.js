// 前端回归守卫（零依赖，纯静态断言）
//
// 为什么需要它：下面每一条都**真实踩过**，且踩的时候后端测试全绿、语法全过 ——
// 因为它们是前端页面的行为/样式约定，云函数测试与语法检查都覆盖不到，只能靠
// 「改坏 → 真机反馈 → 手改回来」的代价换来。本文件把这些约定固化成断言，
// 下次再改坏会在提交前就红掉。
//
// 检查项：
//   F1 成品示例页只预览前 N 页（曾整本 54 页全铺开，页面长到滑不到底）
//   F2 首页不再内联 AI 画格（已外迁 H5，规避个人主体深度合成封堵）
//   F3 复制/选图**不得**预门控（曾经用 requirePrivacyAuthorize 包一层，
//      把调用挪进异步回调 → 丢掉手势上下文 → 真机必失败且真因被文案掩盖）
//   F4 app.js 隐私监听必须**新名优先**（旧名 wx.onNeedPrivacyAuthorize 在基础库
//      3.17.2 已是 undefined；旧名写前面会注册到废弃的那个 → 受保护 API 静默失败）
//   F5 app.js 内部**绝不**调用 wx.requirePrivacyAuthorize（会与自己的弹窗形成死循环）
//   F6 单行输入框必须显式给 height（原生 <input> 不把 padding 计入高度 → 文字只显示一半）
//   F7 积分页必须有「隐私待同意」的可点入口 + 头像/昵称为什么要手动选的说明
//   F8 commission 页不得内联 AI 样图（AI 成品示例已外迁 H5，包内零 AI 图）
//   F9 h5 承载页必须开启原生分享（onShareAppMessage/onShareTimeline，个人主体正常开放）
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

// ── F2 首页不再内联 AI 画格（已外迁 H5，规避个人主体深度合成封堵）──
{
  const src = live('pages/index/index.js');
  ok('F2a 首页有 goH5Sample 入口（AI 内容改走 H5）',
    /goH5Sample\s*\(/.test(src),
    '首页缺少跳 H5 的入口，用户找不到成品示例');
  ok('F2b 首页已移除内联 AI 画格预览（无 SAMPLE_PREVIEW/sampleChapters）',
    !/SAMPLE_PREVIEW/.test(src) && !/sampleChapters/.test(src) && !/chapters\.slice/.test(src),
    '首页仍在内联渲染 AI 画格，会被审核判深度合成');
  const wxml = live('pages/index/index.wxml');
  ok('F2c 首页通过 goH5Sample 打开 H5（不内联 sampleChapters）',
    /bindtap="goH5Sample"/.test(wxml) && !/wx:for="\{\{\s*sampleChapters\s*\}\}"/.test(wxml),
    '首页仍直接遍历 sampleChapters 内联 AI 内容');
}

// ── F8 commission 页不得内联 AI 样图（AI 成品示例已外迁 H5，包内零 AI 图）──
{
  const js = live('pages/commission/commission.js');
  ok('F8a commission.js 已移除 samples 样图数组',
    !/\bsamples\s*:\s*\[/.test(js),
    'commission 仍在 data 里挂 /images/samples/*.jpg 缩略图 —— 与「包内零 AI 图」前提矛盾');
  ok('F8b commission.js 不再含 /images/samples/ 路径引用',
    !/\/images\/samples\//.test(js),
    '仍有 AI 样图路径残留');
  const wxml = live('pages/commission/commission.wxml');
  ok('F8c commission.wxml 已移除 gallery 横滑 + image 渲染',
    !/class="gallery"/.test(wxml) && !/wx:for="\{\{\s*samples\s*\}\}"/.test(wxml),
    'wxml 仍遍历 samples 内联 AI 画面，会被审核判深度合成');
  ok('F8d commission.wxml 已移除「AI 辅助生成」标注',
    !/AI\s*辅助生成/.test(wxml),
    '仍保留 AI 标注 = 仍承认页面内展示了 AI 生成内容');
  ok('F8e commission 改走 H5 文本入口（goH5Sample）',
    /goH5Sample/.test(js) && /bindtap="goH5Sample"/.test(wxml),
    '样例入口丢失，用户从定制页找不到成品示例');
}

// ── F9 h5 承载页必须开启原生分享（个人主体正常开放，不受 AI 类目封堵影响）──
{
  const js = live('pages/h5/h5.js');
  ok('F9a h5.js 声明了 onShareAppMessage（转发给好友）',
    /onShareAppMessage\s*\(/.test(js),
    'H5 样例承载页未开启转发，用户无法把成品示例分享出去');
  ok('F9b h5.js 声明了 onShareTimeline（分享到朋友圈）',
    /onShareTimeline\s*\(/.test(js),
    'H5 样例承载页未开启朋友圈分享');
  ok('F9c h5.js 调用了 wx.showShareMenu 并启用转发+朋友圈菜单',
    /wx\.showShareMenu\s*\(/.test(js)
      && /menus\s*:\s*\['shareAppMessage'\s*,\s*'shareTimeline'\]/.test(js),
    '未在 onReady 里 showShareMenu 启用分享菜单，则「···」里的转发/朋友圈入口真机不出现');
}

// ── F3 复制 / 选图不得预门控 ──
{
  const src = live('pages/gen/gen.js');
  ok('F3a gen.js 不得使用 withPrivacy 包装（曾经因此真机必失败）',
    !/withPrivacy/.test(src),
    'requirePrivacyAuthorize 包一层会把受保护 API 挪进异步回调 → 丢掉手势上下文 → 真机必失败，'
    + '且真实错误（api scope is not declared in the privacy agreement）被自家文案掩盖');
  ok('F3b gen.js 不得调用 wx.requirePrivacyAuthorize',
    !/wx\.requirePrivacyAuthorize/.test(src),
    '正解是直接调用受保护 API，由框架触发监听并在同意后自动重跑');
  const mChoose = src.match(/onChooseImage\(\)\s*\{([\s\S]*?)\}/);
  ok('F3c onChooseImage 直接调 doChooseImage（无前置授权门）',
    !!mChoose && /this\.doChooseImage\(\)/.test(mChoose[1]),
    '选图入口被前置授权挡掉就会「点了没反应」或报未授权');
  ok('F3d 直接调用 wx.chooseMedia',
    /wx\.chooseMedia\s*\(/.test(src),
    '选图 API 丢失');
  ok('F3e 直接调用 wx.setClipboardData',
    /wx\.setClipboardData\s*\(/.test(src),
    '复制 API 丢失');
  const mCopy = src.match(/copyText\s*\([^)]*\)\s*\{([\s\S]*?)\n  \},/);
  ok('F3f copyText 必须有 fail 反馈分支（不能静默失败）',
    !!mCopy && /fail\s*\(/.test(mCopy[1]),
    '静默失败时用户只看到「点了没反应」，也无从知道能长按手动复制');
  // 选图 fail 必须能区分「隐私指引缺声明」这种配置问题
  ok('F3g chooseMedia.fail 能识别 scope is not declared',
    /scope is not declared/.test(src),
    '不区分真因时用户只会看到笼统的「失败」，排查无从下手');
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

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
process.exitCode = fail ? 1 : 0;
