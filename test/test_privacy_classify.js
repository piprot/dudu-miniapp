// 隐私错误分类守卫（零依赖，纯断言）
//
// 为什么必须有它（2026-10-04 真实事故）：
//   我曾用宽泛正则 `/privacy|隐私|未声明|指引/` 判断「后台信息类型未声明」，
//   结果把 103/104（用户主动拒绝官方隐私弹窗）、权限不足、甚至真机 bug
//   **全部误判**成「后台没配」，于是弹出「需到公众平台配隐私指引」。
//   ⇒ 真实原因被自家文案盖住，用户反复去后台勾选/发布却永远不好，绕了整整一天。
//
// 官方依据（《小程序隐私协议开发指南》五、常见错误说明）——判定必须靠 errno，不能靠 errMsg 猜：
//   errno 112 / "api scope is not declared" ⇒ 后台确实未声明（唯一该去后台配的情况）
//   errno 103 / 104                        ⇒ 用户拒绝官方隐私弹窗（不是后台问题）
//   "appid privacy api banned"             ⇒ 提审勾了「未采集隐私」，接口权限被回收
//
// 本文件把这条分类规则钉死，防止有人再把正则放宽回去。
// 运行：node test/test_privacy_classify.js      期望：全部通过，退出码 0

const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (why ? '\n      → ' + why : '')); }
};

// 只加载纯逻辑函数：避开 diag.js 对 wx 全局的依赖（不需要 wx 即可测分类）
const src = require('fs').readFileSync(path.join(__dirname, '..', 'utils', 'diag.js'), 'utf8');
const sandbox = { module: { exports: {} }, exports: {}, wx: undefined, console };
// 从 SCOPE_UNDECLARED 常量开始截取（它前面是 errnoOf/注释，函数体不依赖 wx），
// 再拼上 export。注意 SCOPE_UNDECLARED 之前的注释块含反引号与中文，必须一并带上。
const start = src.indexOf('const SCOPE_UNDECLARED');
const end = src.indexOf('module.exports');
if (start < 0 || end < 0) throw new Error('diag.js 结构变了：找不到 SCOPE_UNDECLARED 或 module.exports，测试需同步');
const body = src.slice(start, end);
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'wx', body + '\nmodule.exports={isPrivacyScopeError,isPrivacyRefusedError,isPrivacyBannedError};')(sandbox.module, sandbox.exports, undefined);
const { isPrivacyScopeError, isPrivacyRefusedError, isPrivacyBannedError } = sandbox.module.exports;

console.log('=== 隐私错误分类守卫 ===\n');

// ── 1. 唯一该指向「后台未声明」的情况：errno 112 / 官方原文 ──
ok('errno 112 → isPrivacyScopeError=true',
  isPrivacyScopeError({ errMsg: 'chooseMedia:fail api scope is not declared in the privacy agreement', errno: 112 }),
  'errno 112 是官方定义的「未声明」，必须识别为需去后台配置');
ok('无 errno 但 errMsg 含 scope is not declared → true',
  isPrivacyScopeError({ errMsg: 'chooseMedia:fail api scope is not declared in the privacy agreement' }),
  '部分环境不带 errno，需回退匹配官方原文');

// ── 2. 用户拒绝（103/104）绝不能被误判成「后台没配」（这是本次事故核心）──
ok('errno 103（拒绝弹窗）→ isPrivacyScopeError=false',
  !isPrivacyScopeError({ errMsg: 'chooseMedia:fail user privacy authorization refused', errno: 103 }),
  '❌ 误判回本事故：用户拒绝被当成后台没配 ⇒ 会把用户引去反复改后台，真因被盖住');
ok('errno 104（未同意）→ isPrivacyScopeError=false',
  !isPrivacyScopeError({ errMsg: 'chooseMedia:fail privacy not agreed', errno: 104 }),
  '❌ 同上，104 是用户未同意，不是后台问题');
ok('errno 103/104 → isPrivacyRefusedError=true',
  isPrivacyRefusedError({ errno: 103 }) && isPrivacyRefusedError({ errno: 104 }),
  '应走「重新同意」分支，提示重新进入页面点同意，而非让用户去后台');

// ── 3. banned 是另一类问题（提审勾了未采集隐私），不能混进「去后台勾选」──
ok('appid privacy api banned → isPrivacyScopeError=false',
  !isPrivacyScopeError({ errMsg: 'chooseMedia:fail appid privacy api banned' }),
  'banned 是提审勾选问题，与「信息类型未声明」不同，不该让用户去勾信息类型');
ok('appid privacy api banned → isPrivacyBannedError=true',
  isPrivacyBannedError({ errMsg: 'chooseMedia:fail appid privacy api banned' }), '应命中 banned 分支');

// ── 4. 其它含 privacy 字样的错误，一律不算「未声明」（宽泛匹配的教训）──
const noisy = [
  { errMsg: 'chooseMedia:fail privacy permission denied' },
  { errMsg: 'saveImageToPhotosAlbum:fail privacy authorize no response' },
  { errMsg: 'chooseMedia:fail privacy user reject' },
  { errMsg: 'some privacy error' }
];
noisy.forEach((e, i) => {
  ok('非声明类 privacy 错误 #' + (i + 1) + ' 不误判为未声明',
    !isPrivacyScopeError(e),
    '❌ 宽泛 /privacy/ 匹配会命中这条：' + e.errMsg);
});

// ── 5. 纯隐私词但与权限无关的，不应触发任何隐私分类 ──
ok('普通业务错误不误判',
  !isPrivacyScopeError({ errMsg: 'exportFile:fail canvas is null' })
  && !isPrivacyRefusedError({ errMsg: 'exportFile:fail canvas is null' }),
  '非隐私错误不应被隐私分支吞掉');

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
if (fail > 0) process.exit(1);
