// H5 定制样板间（comic.html）与需求提交云函数（h5_request）的守卫测试
// ─────────────────────────────────────────────────────────────
// 为什么要有这一套：
//   样板间是**付费前给客户看的成交页**，它同时压着三条不能破的线 ——
//     ① 合规线：前台绝不自助生成（自助文生图＝深度合成服务，须企业主体算法备案；
//        我们卖的是"已完成的成品内容"，性质是卖内容，不能变成提供合成服务能力）。
//     ② 资产线：示例画格必须**真的在磁盘上**（清单写了图没落 = 线上开天窗），
//        且未解锁分集不能把图白送出去。
//     ③ 一致性线：价格必须与 utils/config.js 的 COMMISSION.tiers 一致、
//        梗概上限必须与 h5_request 的服务端校验一致（改一处忘另一处 = 用户被拒）。
//   人工盯这些线迟早漏，所以交给测试。零依赖，node test/test_h5_comic.js 直接跑。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const H5 = path.join(ROOT, 'h5');
const HTML = path.join(H5, 'comic.html');
const JS = path.join(H5, 'assets', 'comic.js');
const MANIFEST = path.join(H5, 'assets', 'sample', 'manifest.js');
const SAMPLE_DIR = path.join(H5, 'assets', 'sample');
const FN = path.join(ROOT, 'cloudfunctions', 'h5_request', 'index.js');

const { COMMISSION } = require(path.join(ROOT, 'utils', 'config.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e && e.message)); fail++; }
}

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

/**
 * 去注释（**字符串感知**）。扫码合规红线时必须在"真代码"上扫：
 *  · 注释里出现 `ai_gen`、`H5_CONFIG.api` 是**说明性的**（正是要告诉后人别接生成接口），
 *    直接 grep 源码会把这些说明判成违规 → 假警报。
 *  · 反过来，`'https://open.feishu.cn/...'` 这样的字符串里有 `//`，
 *    不当成字符串就会把半行代码当注释切掉 → 漏报。
 *  所以这里做一次真正的单遍扫描。
 */
function stripComments(src) {
  let out = '';
  let str = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (str) {
      out += c;
      if (c === '\\') { out += (n || ''); i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; out += c; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); i = (e < 0 ? src.length : e); out += '\n'; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i); i = (e < 0 ? src.length : e + 1); continue; }
    out += c;
  }
  return out;
}

// ── 载入示例清单（manifest.js 是 `window.H5_SAMPLE = {...};`，不是模块）──
function loadManifest() {
  const src = read(MANIFEST);
  const win = {};
  new Function('window', src)(win);
  return win.H5_SAMPLE;
}

const HTML_SRC = read(HTML);
const JS_SRC = read(JS);
const JS_CODE = stripComments(JS_SRC);
const FN_SRC = read(FN);
const FN_CODE = stripComments(FN_SRC);
const SAMPLE = loadManifest();

const freeEpisodes = SAMPLE.episodes.filter(e => !e.locked);
const lockedEpisodes = SAMPLE.episodes.filter(e => e.locked);
const freePanels = freeEpisodes.reduce((n, e) =>
  n + e.pages.reduce((m, p) => m + p.panels.length, 0), 0);

// ═══════════════════ ① 资产与清单 ═══════════════════

t('1) 示例清单结构完整：8 集 / 54 格 / 免费 2 集', () => {
  assert.ok(SAMPLE && SAMPLE.cover && SAMPLE.cover.title, '缺少封面标题');
  assert.strictEqual(SAMPLE.totalEpisodes, 8, '分集数不是 8（清单与权威示例脱节了？重跑 tools/make_h5_sample.py）');
  assert.strictEqual(SAMPLE.totalPanels, 54, '总格数不是 54');
  assert.strictEqual(SAMPLE.freeEpisodes, 2, '免费试读集数变了 —— 这是商业决定，改了要同步本测试');
  assert.strictEqual(SAMPLE.episodes.length, 8, 'episodes 长度与 totalEpisodes 不一致');
  assert.strictEqual(lockedEpisodes.length, 6, '锁定分集应为 6 集');
  freeEpisodes.forEach(e => assert.ok(e.pages.length >= 1, e.num + ' 没有页面'));
});

t('2) 免费分集的每一格，画格文件都真实存在于磁盘', () => {
  const missing = [];
  freeEpisodes.forEach(e => e.pages.forEach(p => p.panels.forEach(pn => {
    assert.ok(pn.art, e.num + ' 有格子缺 art 路径');
    const abs = path.join(H5, pn.art);
    if (!exists(abs) || fs.statSync(abs).size < 1024) missing.push(pn.art);
  })));
  assert.strictEqual(missing.length, 0,
    '清单里写了但磁盘上没有（或过小）的画格：' + missing.join(', ')
    + '\n      修法：python tools/make_h5_sample.py 重新生成资产');
});

t('3) 免费分集共 12 格，且每格都有旁白或气泡（不是光秃秃的图）', () => {
  assert.strictEqual(freePanels, 12, '免费试读格数不是 12（6 + 6）');
  let bare = 0;
  freeEpisodes.forEach(e => e.pages.forEach(p => p.panels.forEach(pn => {
    if (!pn.narration && !(pn.bubbles || []).length && !(pn.sfxs || []).length) bare++;
  })));
  assert.strictEqual(bare, 0, '有 ' + bare + ' 格既无旁白也无气泡/音效 —— 成品是"图+字"，光有图不成画面感内容');
});

t('4) 锁定分集一律不带画格（不能把付费内容白送出去）', () => {
  const leaked = [];
  lockedEpisodes.forEach(e => e.pages.forEach(p => p.panels.forEach(pn => {
    if (pn.art) leaked.push(e.num + ' ' + pn.art);
  })));
  assert.strictEqual(leaked.length, 0, '锁定分集里出现了 art 路径（等于白送）：' + leaked.join(', '));
});

t('5) 示例资产总体积 < 1.5MB（公众号页面别拖成几 MB）', () => {
  const files = fs.readdirSync(SAMPLE_DIR).filter(f => f.endsWith('.jpg'));
  const total = files.reduce((s, f) => s + fs.statSync(path.join(SAMPLE_DIR, f)).size, 0);
  assert.ok(total < 1.5 * 1024 * 1024,
    '示例画格合计 ' + (total / 1024 / 1024).toFixed(2) + 'MB，超过 1.5MB 上限；'
    + '调小 tools/make_h5_sample.py 的 ART / QUALITY 后重跑');
});

// ═══════════════════ ② 合规红线（最重要）═══════════════════

t('6) 前台不接生成接口：comic 页面与脚本里没有出图模型/生成函数字样', () => {
  const banned = ['seedream', 'images/generations', 'chat/completions', 'volces', 'volcengine', 'ark.cn'];
  [['comic.html', HTML_SRC], ['comic.js', JS_CODE]].forEach(([nm, src]) => {
    banned.forEach(b => {
      assert.ok(src.toLowerCase().indexOf(b) < 0,
        nm + ' 里出现了「' + b + '」—— 一旦前台接上出图模型，性质就从"卖内容成品"'
        + '变成"提供深度合成服务"，须以企业主体做算法备案。这条线不能破。');
    });
  });
});

t('7) comic.js 只引用 apiReq（h5_request），不引用 CFG.api（ai_gen）', () => {
  assert.ok(/CFG\.apiReq/.test(JS_CODE), 'comic.js 没有引用 CFG.apiReq');
  assert.ok(!/\bCFG\.api\b/.test(JS_CODE), 'comic.js 引用了 CFG.api —— 那是文案生成接口，样板间不该碰');
  assert.ok(!/ai_gen/.test(JS_CODE), 'comic.js 里出现了 ai_gen');
  assert.ok(!/H5_FREE_DAILY/.test(JS_CODE), 'comic.js 里出现了额度常量（额度规则只应存在于服务端）');
});

t('8) 页面有 AI 生成标识，并明说「本页不生成任何内容」', () => {
  const html = HTML_SRC;
  assert.ok(/AI\s*生成/.test(html), '缺少「AI 生成」提示标识（《人工智能生成合成内容标识办法》要求，不可删）');
  assert.ok(/本页不生成任何内容|这一步不收费、也不会立刻生成任何东西/.test(html),
    '缺少「本页不生成内容」的明确声明 —— 这是把"卖内容"与"提供合成服务"区分开的关键表述');
  assert.ok(/算法备案|深度合成/.test(HTML_SRC) || /深度合成/.test(JS_SRC) || /深度合成/.test(FN_SRC),
    '缺少深度合成合规边界的说明注释（后人很容易"顺手"接上生成接口，注释是唯一的路障）');
  assert.ok(/隐私|匿名|设备标识/.test(html), '缺少数据使用说明');
});

t('9) 页面上没有「生成」按钮（只有提交需求）', () => {
  assert.ok(!/id="btnGen"/.test(HTML_SRC), '出现了 id="btnGen" —— 样板间不能有生成入口');
  assert.ok(!/重新生成|立即生成|一键生成|生成我的|开始生成/.test(HTML_SRC),
    '出现生成类按钮文案 —— 前台自助生成会触发深度合成备案义务，必须去掉');
  assert.ok(!/btnGen/.test(JS_CODE), 'comic.js 里出现了 btnGen');
  assert.ok(/id="btnSubmit"/.test(HTML_SRC), '找不到提交需求按钮');
});

t('9b) 客户可见文案里不泄漏工程信息（路径 / 文件名）', () => {
  // 「小程序码没配」的兜底文案是**客户能看到的**，一旦写进 config.js、h5/assets 这类
  // 工程细节，客户会看到开发者说明 —— 真机上看过一眼才发现，所以固化成断言。
  const fb = /el\('div',\s*'qr-fallback',\s*([\s\S]{0,200}?)\);/.exec(JS_CODE);
  assert.ok(fb, '找不到 qr-fallback 的文案构造（结构变了要同步改本测试）');
  assert.ok(!/\.js\b|assets\/|h5\//.test(fb[1]),
    '客户可见的兜底文案里出现了路径/文件名：' + fb[1].trim());
  // 开发提示允许存在，但必须只在 localhost 下渲染
  assert.ok(/qr-devhit/.test(JS_CODE), '缺少本地调试提示的独立节点（应与客户文案分开）');
  assert.ok(/localhost\|127\\?\.0\\?\.0\\?\.1/.test(JS_CODE) || /localhost/.test(JS_CODE),
    '开发提示没有 localhost 判断 —— 线上客户也会看到工程说明');
});

t('10) h5_request 绝不调用任何生成接口', () => {
  const banned = ['seedream', 'images/generations', 'chat/completions', 'volces', 'doubao', 'ai_gen', 'callFunction'];
  banned.forEach(b => {
    assert.ok(FN_CODE.toLowerCase().indexOf(b.toLowerCase()) < 0,
      'h5_request 里出现了「' + b + '」—— 本函数只允许「落库 + 通知 + 回取件码」，'
      + '一旦它开始生成内容，H5 就等于提供了自助合成服务能力。');
  });
  assert.ok(/不调用任何生成/.test(FN_SRC), '缺少"不调用任何生成接口"的职责声明注释');
});

// ═══════════════════ ③ h5_request 服务端 ═══════════════════

t('11) h5_request 有邮箱校验 / 梗概上下限 / CORS / 限流 / 幂等', () => {
  assert.ok(/EMAIL_RE\s*=/.test(FN_CODE), '缺少邮箱正则校验');
  assert.ok(/STORY_MIN\s*=\s*\d+/.test(FN_CODE), '缺少梗概下限常量');
  assert.ok(/STORY_MAX\s*=\s*\d+/.test(FN_CODE), '缺少梗概上限常量');
  assert.ok(/Access-Control-Allow-Origin/.test(FN_CODE), '缺少 CORS 头（H5 跨域读不到响应体）');
  assert.ok(/function takeQuota/.test(FN_CODE), '缺少限流扣减');
  assert.ok(/function releaseQuota/.test(FN_CODE), '缺少限流退还（落库失败应退还，别吃掉用户的提交机会）');
  assert.ok(/DEDUP_WINDOW_MS/.test(FN_CODE), '缺少幂等窗口（前端重试/双击不该产生两条线索）');
  assert.ok(/function makeCode/.test(FN_CODE), '缺少取件码生成');
});

t('12) 线索与已付款订单分开落库（不碰 custom_comic_requests）', () => {
  assert.ok(/COLLECTION\s*=\s*'h5_requests'/.test(FN_CODE), '未落到 h5_requests 集合');
  assert.ok(FN_CODE.indexOf('custom_comic_requests') < 0,
    'h5_request 里出现了 custom_comic_requests —— 线索（未付款）与订单（已付款）混在一起，'
    + '运营会把未付款的线索当订单去履约。两个集合必须分开。');
});

t('13) 落库的线索标了 paid:false / status:lead（运营一眼能分清）', () => {
  assert.ok(/paid:\s*false/.test(FN_CODE), '缺少 paid:false');
  assert.ok(/status:\s*'lead'/.test(FN_CODE), "缺少 status:'lead'");
  assert.ok(/source:\s*'h5'/.test(FN_CODE), "缺少 source:'h5'（便于区分线索来源）");
});

t('14) 梗概上限：前端 maxlength 与服务端 STORY_MAX 一致', () => {
  const m = /const\s+STORY_MAX\s*=\s*(\d+)/.exec(FN_CODE);
  assert.ok(m, '读不到 STORY_MAX');
  const server = Number(m[1]);
  const h = /id="storyInput"[^>]*maxlength="(\d+)"/.exec(HTML_SRC);
  assert.ok(h, '读不到 storyInput 的 maxlength');
  const front = Number(h[1]);
  assert.strictEqual(front, server,
    '前端 maxlength=' + front + ' 但服务端 STORY_MAX=' + server + '：'
    + '前端能写进去的字数被服务端拒掉，用户会莫名其妙地失败');
  const min = /const\s+STORY_MIN\s*=\s*(\d+)/.exec(FN_CODE);
  assert.ok(/STORY_MIN/.test(JS_CODE), 'comic.js 没有引用 STORY_MIN 的下限语义（提示文案会与校验脱节）');
  assert.ok(min, '读不到 STORY_MIN');
});

// ═══════════════════ ④ 工程与一致性 ═══════════════════

t('15) project.config.json 仍把 h5 排除在小程序包之外', () => {
  const cfg = JSON.parse(read(path.join(ROOT, 'project.config.json')));
  const ig = (cfg.packOptions && cfg.packOptions.ignore) || [];
  assert.ok(ig.some(x => x && x.value === 'h5'),
    'packOptions.ignore 里没有 h5 —— h5/assets/sample 的图会被打进小程序上传包（主包上限 2MB）');
});

t('16) 配置只有一份：两个页面都引 config.js，且不再各自硬编码地址', () => {
  const idx = read(path.join(H5, 'index.html'));
  [['index.html', idx], ['comic.html', HTML_SRC]].forEach(([nm, src]) => {
    assert.ok(/src="assets\/config\.js"/.test(src), nm + ' 没有引用 assets/config.js');
    assert.ok(!/window\.H5_CONFIG\s*=/.test(src),
      nm + ' 里又内联了一份 window.H5_CONFIG —— 配置只能有一份（assets/config.js），否则改一处漏一处');
  });
  const cfg = read(path.join(H5, 'assets', 'config.js'));
  assert.ok(/window\.H5_CONFIG\s*=/.test(cfg), 'config.js 没有定义 window.H5_CONFIG');
  assert.ok(/apiReq:/.test(cfg), 'config.js 缺 apiReq（需求提交入口）');
});

t('17) 页面上的价格与 utils/config.js 的 COMMISSION.tiers 一致', () => {
  const web = COMMISSION.tiers.filter(x => x.productId === 'comic_web')[0];
  const pdf = COMMISSION.tiers.filter(x => x.productId === 'comic_pdf')[0];
  assert.ok(web && pdf, 'COMMISSION.tiers 里找不到 comic_web / comic_pdf');
  assert.ok(HTML_SRC.indexOf(web.priceText) >= 0, '页面缺少 ' + web.priceText + '（网页版价）');
  assert.ok(HTML_SRC.indexOf(pdf.priceText) >= 0, '页面缺少 ' + pdf.priceText + '（PDF 版价）');
  assert.ok(JS_CODE.indexOf('网页版 ' + web.priceText) >= 0,
    'comic.js 的档位标签没有用 config 里的 ' + web.priceText + '（价格改了就漂了）');
  assert.ok(JS_CODE.indexOf('PDF 版 ' + pdf.priceText) >= 0,
    'comic.js 的档位标签没有用 config 里的 ' + pdf.priceText);
});

t('18) comic.js 用 textContent 构建 DOM（用户输入不能当 HTML 解析）', () => {
  assert.ok(/function el\(tag, cls, text\)/.test(JS_CODE), '缺少 el() 构建器');
  assert.ok(/n\.textContent\s*=/.test(JS_CODE), 'el() 没有用 textContent');
  // 只有清空容器可以 innerHTML=''；出现 innerHTML = 变量 就是注入风险。
  // ⚠️ 别用 `(?!'')` 那种负向断言：`\s*` 会回溯到空格之前，从而把 `= ''` 也判成违规（假阳性）。
  //    正确判法是「赋值总数 === 空串清空数」。
  const allAssign = JS_CODE.match(/\.innerHTML\s*=/g) || [];
  const clearOnly = JS_CODE.match(/\.innerHTML\s*=\s*(''|"")\s*;/g) || [];
  assert.strictEqual(allAssign.length, clearOnly.length,
    'comic.js 里有 ' + (allAssign.length - clearOnly.length) + ' 处把变量写进 innerHTML —— '
    + '故事梗概是用户输入，必须走 textContent');
});

t('19) 示例资产有可重建的工具（不是手工产物）', () => {
  const tool = path.join(ROOT, 'tools', 'make_h5_sample.py');
  assert.ok(exists(tool), '缺少 tools/make_h5_sample.py —— 资产无法重建，示例换了也没法同步');
  const src = read(tool);
  assert.ok(/FREE_EPISODES\s*=\s*\d+/.test(src), '工具缺少免费分集数常量');
  assert.ok(/ART\s*=\s*\d+/.test(src) && /QUALITY\s*=\s*\d+/.test(src), '工具缺图幅/质量常量');
  // 三个抽图工具职责不同，最容易搞混的是"字"：必须写清边界，否则后人选错工具会丢字
  assert.ok(/extract_sample_panels/.test(src) && /compose_sample_panels/.test(src),
    '工具顶部没有说明与另两个抽图脚本的分工（一个丢字、一个烧字、本脚本字图分离），后人容易选错');
});

t('20) 样板间与文案工具互相导流（一条漏斗，不是两个孤岛）', () => {
  assert.ok(/href="comic\.html"/.test(read(path.join(H5, 'index.html'))), '文案工具页没有指向样板间的入口');
  assert.ok(/href="index\.html"/.test(HTML_SRC), '样板间没有指向文案工具的入口');
  assert.ok(/\.cross-link/.test(read(path.join(H5, 'assets', 'style.css'))), 'style.css 缺少 .cross-link 样式');
});

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
process.exitCode = fail ? 1 : 0;
