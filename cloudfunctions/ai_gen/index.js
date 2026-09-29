// 用户端文案云函数（路B-文字版 · 个人主体，低风险）
// ─────────────────────────────────────────────────────────────
// 输入（任意组合，至少一项）：
//   · prompt      文字（故事 / 想法 / 草稿 / 补充说明）
//   · imageFileId 云存储图片 fileID（多模态 vision）
//   · url         文章链接（服务端抓取正文后按文本处理）
//   · feedback    修改意见（mode=moments 的「换一批」：对上一版不满意时带意见重生成 3 条）
//   · previous    上一版文案数组（可选，随 feedback 一起传，让模型知道要改什么、别照抄）
// 产出（mode）：只支持 'moments' —— 朋友圈「防折叠」文案 3 条。
//   ⚠️ 2026-09-19 用户拍板：**不存在「生成画面感内容脚本」这一步**。画面感内容只能走**付费定制**
//      （pages/commission → vp_create_order 下单 ¥66/¥88 → custom_request 落库 → 人工绘制），
//      脚本是履约时内部使用的工作稿，不对用户生成、也不送积分。
//      原先的 mode='comic' 路径（免费/兜底生成脚本）已整体移除；显式传其他 mode 一律**明确报错**，
//      不做静默降级 —— 静默降级会让调用方拿到另一种内容却以为拿到了脚本。
//
// 积分（服务端权威记账，客户端无法伪造 —— 本函数是唯二的记账入口）：
//   · moments 首次生成   = 花 20
//   · moments 带意见换一批 = 花 15（价格由服务端按「是否带 feedback」判定，前端无法选档）
//   生成前用「余额守卫」条件更新原子扣减；生成失败自动退回。
//   余额存云数据库 vp_users.points（文档 _id = openid）。
//
// 密钥只在云函数环境变量中：LLM_API_KEY / LLM_MODEL / LLM_BASE_URL（绝不进前端代码）
//
// 豆包(火山方舟)接口：
//   POST {LLM_BASE_URL}/responses         （Responses API + 显式前缀缓存，主路径）
//   POST {LLM_BASE_URL}/chat/completions  （兜底：Responses 不可用时自动回退，含多模态）
// 环境变量：
//   LLM_API_KEY  = 火山方舟 API Key（必填）
//   LLM_BASE_URL = https://ark.cn-beijing.volces.com/api/v3（可省略，已内置默认）
//   LLM_MODEL    = 豆包接入点 ID（如 ep-xxxxxxxx，必填）
//
// 缓存策略（2026-09-17 落地）：
//   主路径走 Responses API + 显式前缀缓存(caching.prefix)，系统提示词固定 → 确定性命中、输入价 ~1/5。
//   系统提示词已扩到 ≥256 token 以跨过显式前缀缓存最低门槛（否则建缓存失败）。
//   任何报错自动回退 chat/completions（不缓存但保证可用），并在云日志留痕，便于排查。
//
// ── 双通道（2026-09-23 新增 H5 通道）──
//   channel = 小程序（默认）：openid 维度**积分**计费（vp_users.points），服务端原子扣减。
//   channel = h5（显式传 "h5"）：无 openid → 改用 **IP + 设备指纹**双维度**日额度**限流
//                                （h5_usage 集合），不涉及任何付费、不碰积分。
//   为什么放在同一个函数里而不是新建 h5_api：生成逻辑（系统提示词 / 类型 / 字数策略 /
//   解析）必须**只有一份**。复制成第二个函数迟早漂移 —— 而漂移会让同一段素材在小程序和
//   H5 得到不同篇幅的文案，这正是 test_constants_sync.js 一直在防的事。
//   ⇒ 这里只做「入口分叉」：身份与配额不同，往下**完全走同一条生成链路**。
const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function env(name) { return process.env[name] || ''; }

// ── 积分规则（与 utils/config.js 的 POINTS 保持一致）──
// 2026-09-18 用户拍板：「生成赚分」取消，earn 清空；生成类行为一律扣分。
// 2026-09-19 用户拍板：「生成画面感内容脚本」这一步整体移除（见文件头注释），故不再有 comic 档。
const POINTS_EARN = {};
// 花费：只剩朋友圈文案（首次 / 带意见换一批）。
// ⚠️ momentsRevise(15) < moments(20) 是**有意设计：复购优惠**（用户 2026-09-17 确认），
//    目的是降低"对结果不满意再试一次"的门槛。请勿"修正"为 >= moments；见 test_constants_sync 第 12 条。
const POINTS_COST = { moments: 20, momentsRevise: 15 };
const MAX_INPUT_IMAGES = 3;                                 // 最多 3 张参考图（2026-09-18 用户拍板）
const FEEDBACK_MAX = 300;                                   // 修改意见长度上限
// 唯一支持的产出模式。显式传其它值 → 报错（不做静默降级），见 resolveMode()。
const MODE = 'moments';

// ── HTTP 小工具 ──
function postJSON(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      // 2026-09-20：单次 LLM 请求超时上限 25s → 40s。
      // 背景：story 长输入的目标长度是 250-700 字，输出 token 多，25s 撑不住 ⇒ 必超时，
      //       用户看到「调用失败：请求超时」。这是既有缺陷，不是字数分叉引入的（分叉反而把 4 类压到 ≤280 字）。
      // 上限受云函数 60s 约束；配合下方「超时不再降级重试」的守卫，最坏 = 一次请求后退款返回，不会撞 60s。
      timeout: 40000,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers)
    }, res => {
      // ⚠️ 必须用 Buffer 累积再统一 utf8 解码：data 事件给的是 Buffer，逐块 `d += c`
      //    会按「每块」做 utf8 解码，多字节汉字一旦被 TCP 分片截断就变乱码(???/�)。
      //    Buffer.concat 把整段字节流拼齐后再解码，字符边界完整，彻底杜绝 ???。
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8')));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('响应解析失败: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.write(body);
    req.end();   // 必须显式 end()：否则请求不完整/可能永久挂起（曾导致云函数超时）
  });
}

// 抓取网页文本（GET，跟随重定向，限流限长）。仅用于抓文章正文。
function getText(url, opts) {
  opts = opts || {};
  const maxBytes = opts.maxBytes || 600 * 1024;
  const depth = opts._depth || 0;
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('链接格式不正确')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('仅支持 http/https 链接'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      timeout: 15000,
      headers: {
        // 伪装成微信内置浏览器，部分公众号/站点对普通 UA 返回空壳
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'identity'
      }
    }, res => {
      const code = res.statusCode;
      if ([301, 302, 303, 307, 308].indexOf(code) >= 0 && res.headers.location && depth < 4) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url).toString(); } catch (e) { return reject(new Error('重定向地址无效')); }
        return getText(next, Object.assign({}, opts, { _depth: depth + 1 })).then(resolve, reject);
      }
      if (code !== 200) { res.resume(); return reject(new Error('链接返回状态 ' + code)); }
      let d = ''; let n = 0; let done = false;
      const finish = () => { if (!done) { done = true; resolve(d); } };
      res.setEncoding('utf8');
      res.on('data', c => {
        n += c.length;
        if (n <= maxBytes) d += c; else { res.destroy(); finish(); }
      });
      res.on('end', finish);
      res.on('close', finish);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('抓取超时')));
    req.end();
  });
}

// ── HTML → 纯文本（无第三方依赖）──
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', hellip: '…', middot: '·', times: '×', laquo: '«', raquo: '»', copy: '©', reg: '®' };
function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g.charAt(0) === '#') {
      const code = (g.charAt(1) === 'x' || g.charAt(1) === 'X') ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return (code && code > 0 && code < 0x110000) ? String.fromCodePoint(code) : '';
    }
    const k = g.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
  });
}

// 从整页 HTML 里抽正文：优先定位公众号图文容器（并截掉容器之后的页面噪声），再剥标签
function extractMainText(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  // 微信图文正文容器（服务端渲染，可直接取到）
  const anchor = s.search(/id=["']js_content["']/i);
  if (anchor >= 0) {
    s = s.slice(anchor);
    // 截掉正文之后的页面噪声：二维码 / 标签 / 评论 / 推荐 / 赞赏 / 广告位
    const cut = s.search(/id=["'](js_pc_qr_code|js_tags|js_article_comment|js_related|js_reward|js_profile_qrcode|js_sponsor_ad_area|js_pc_qr_code_container)["']|class=["'][^"']*(rich_media_tool|rich_media_area_extra|qr_code_pc)[^"']*["']/i);
    if (cut > 0) s = s.slice(0, cut);
  }
  // 块级标签 → 换行，保留段落感
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t\u00a0\u3000\u2002-\u200b]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.replace(/^\s+|\s+$/g, '');
}

// 防 SSRF：拒绝内网 / 回环 / 云元数据地址
function isBlockedHost(host) {
  if (!host) return true;
  const h = String(host).toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const p = h.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 169 && p[1] === 254) return true; // 含 169.254.169.254 云元数据
  }
  return false;
}

// 抓取文章链接 → { ok, title, text } / { ok:false, err }
async function fetchArticle(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch (e) { return { ok: false, err: '链接格式不正确' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, err: '仅支持 http/https 链接' };
  if (isBlockedHost(u.hostname)) return { ok: false, err: '该链接不可访问' };

  let html;
  try { html = await getText(u.toString()); }
  catch (e) { return { ok: false, err: '抓取失败：' + (e && e.message ? e.message : String(e)) }; }

  const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleM ? decodeEntities(titleM[1]).replace(/\s+/g, ' ').trim() : '';

  // 微信公众号文章的标题常在 og:title / msg_title
  let h1 = '';
  const m2 = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (m2) h1 = decodeEntities(m2[1]).trim();

  const body = extractMainText(html);
  if (!body || body.length < 20) return { ok: false, err: '未能提取到正文（可能是动态页面或需要登录）' };
  return { ok: true, title: title || h1, text: body };
}

// 云存储图片 → base64 data URL（供多模态 vision 使用）
async function imageToDataUrl(fileID) {
  const dl = await cloud.downloadFile({ fileID });
  const buf = dl && dl.fileContent;
  if (!buf || !buf.length) throw new Error('图片下载为空');
  if (buf.length > 8 * 1024 * 1024) throw new Error('图片过大（请压缩后重试）');
  let mime = 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
  else if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif';
  else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) mime = 'image/webp';
  return 'data:' + mime + ';base64,' + buf.toString('base64');
}

// ── 系统提示词（固定前缀 → 显式前缀缓存命中；≥256 token 以满足缓存最低门槛）──
// 只剩 moments 一套。（原 mode=comic 的「画面感内容叙事脚本」提示词已随该路径移除，见文件头注释。）

// mode=moments：朋友圈文案，一次返回 3 组备选，用【1】【2】【3】分隔。
// ─────────────────────────────────────────────────────────────
// 2026-09-18 晚 二次升级（五类型框架，对齐网页版「朋友圈文案工作台」四类框架 + 新增叙事型）：
//   ① 类型由前端 kind 参数指定：value / persona / deal / life / story；缺省 'value'。
//   ② 字数策略分叉（2026-09-19 用户拍板）：
//        价值型 100-200 · 人设型 150-220 · 成交型 180-280 · 生活型 80-150（这 4 类用**固定区间**，与原文长短无关）
//        叙事型 story → **长度跟随用户原文**（OUT_LEN_TIERS，下限 80）
//        ⇒ 不再"统一区间"，也不再"全跟随原文"：4 类定长 + 2 类跟随。
//   ③ 新增第 5 类「叙事型（我的故事 / 往事 / 小说 / 随笔）」——它是**定制画面感内容的素材来源**，
//      所以刻意不写营销引导、不推产品，只把原始素材写成有画面、有情绪、能延展成画面感内容的作品。
//   ④ 提示词为**单一固定字符串**（不含任何随 kind 变化的插值）→ 显式前缀缓存仍然确定性命中。
//      kind 的影响通过【用户消息】里的「本次类型」声明传递，缓存前缀不受影响。
//      见 buildKindDirective()。
const SYSTEM_PROMPT_MOMENTS = '' +
'你是朋友圈文案高手，给真实用户写“发在朋友圈里、像他自己写的”短文案。用户输入是一段故事、感悟或草稿，也可能附了图片或网文；你产出 3 条可直接复制去发的备选。\n' +
'\n' +
'【先定类型】严格按用户在【本次类型】里的指定写，不得改判。类型只决定“怎么写”（结构/视角/语气），也部分决定“写多长”：价值/人设/成交/生活四类用【本次长度】给的固定区间，叙事型跟随用户原文，都见【本次长度】。\n' +
'\n' +
'【各类型写法】\n' +
'· 价值型：干货、方法、洞察。身份+观察/案例+观点；用“我最近发现／今天聊到”自然起头，结尾给收获感，不说教不硬广。\n' +
'· 人设型：选择、代价、信念。四段：选择→代价→为什么不后悔→给犹豫的人一句。真实大于完美，可写差点后悔，不发宣言不卖惨。\n' +
'· 成交型：信号、证据、引导。先说时机→用具体变化建信任→只给一个清晰动作。先帮后卖，不刷屏不连感叹号不夸大。\n' +
'· 生活型：日常片段、状态、温度。身份/状态+具体片段+感受细节；用可感的小事带情绪，可轻口语，不硬带产品不刻意升华，结尾留白。\n' +
'· 叙事型（往事/回忆/小说/随笔）：当作品写，不是广告。时间地点+人物关系+一个真实转折+事后那点明白。第一人称亲历，用“那一年／我记得”起头；靠动作、对话、物件、气味、光线说话，不靠形容词和总结；结尾收在一个具体画面，不喊口号。禁止产品、点击/私信/评论区/名额等引导与促销语气。\n' +
'\n' +
'【统一的声音（最重要）】写“有审美、话不多、但每句都有画面”的真人：\n' +
'1. 短句为主，每行一个意群，2-3 行就换一段，段间真实空行，长短交错有呼吸。\n' +
'2. 开头第一句就是钩子——前 6-15 字给出全组最抓人的画面或情绪（朋友圈只展开前一两行，黄金位置要留人）。\n' +
'3. 写具体可感的画面：时间、地点、动作、声音、气味、光线、触感，让人“看见”而不是“知道”一个道理；少用“在这个快节奏的时代”“人生就像”“愿我们”这类空话。\n' +
'4. 情绪克制、内敛、积极；不喊口号、不硬煽、不卖惨，把力量藏在细节里。\n' +
'5. 每组 1-2 个 emoji，只放句首或句尾，贴合场景（🌙✨🍜🐱🌿），不堆砌；叙事型可 0-1 个。\n' +
'6. 说人话：允许不完整句、允许留白、允许一点点口语；像深夜随手发的，不像稿、不像套话。\n' +
'7. 3 条里至少 1 条第一人称（我/我们，亲历），1 条第三人称（他/她/那个…，旁观讲），情绪从平静到触动、克制但真实。\n' +
'\n' +
'【好 vs 差，一眼懂】\n' +
'✗ 差（机器腔/空泛）：“在这个快节奏的时代，我们常常忽略身边的美好。愿我们慢下来，感受生活的小确幸。人生就像一场旅行，重要的不是终点。”\n' +
'✓ 好（真人/有画面）：“昨晚十一点下楼丢垃圾，\n看见隔壁大爷在路灯下给流浪猫热饺子。\n原来有人比我还舍不得这栋楼。🐱”\n' +
'✗ 差（长段落不分）：一大段不分行的感慨，读着累、像转发。\n' +
'✓ 好：每段 2-3 行，手机上一眼读完，留白让人想往下看。\n' +
'\n' +
'【硬规则】每组字数落在【本次长度】区间、且不低于 80 字（不足就展开用户已有细节补足，绝不编造原文没有的人物/地点/事件/关系）；叙事型不得出现任何营销引导与促销标签。\n' +
'\n' +
'【防折叠（默认开启）】在相邻汉字之间插入一个零宽空格（U+200B），让微信不触发“全文”折叠；标点、emoji、数字、英文之间不插。字数只算可见汉字，零宽空格不计入。用户复制后直接发朋友圈即可完整展开。\n' +
'\n' +
'【输出格式】只输出 3 条，用【1】【2】【3】分隔；每条 2-5 行、组内真实换行；每条结尾另起一行加 1-2 个 #话题标签（贴合内容、有记忆点，不用 #正能量 这类空泛标签）。字数控在【本次长度】区间、每条不低于 80 字；若用户明确要求更长/更详细/展开写，优先满足、不受上限约束。不要解释、不要开头结尾客套。';

// ── 类型白名单 + 用户消息里的类型声明 ──
// 为什么放在用户消息而不是系统提示词里：系统提示词必须**逐字节固定**才能命中显式前缀缓存
// （caching.prefix=true 要求前缀完全一致）。把 kind 做成插值会让每次请求的系统提示词都不同，
// 缓存直接失效、输入成本翻数倍。所以这里只把「本次类型」拼进用户消息。
const MOMENTS_KINDS = ['value', 'persona', 'deal', 'life', 'story'];
// 类型标签只写类型名 —— 字数不再由类型决定（见 OUT_LEN_TIERS），避免两处打架。
const MOMENTS_KIND_LABEL = {
  value: '价值型',
  persona: '人设型',
  deal: '成交型',
  life: '生活型',
  story: '叙事型 · 我的故事 / 往事 / 小说 / 随笔'
};
// 归一化前端传来的 kind：非法值一律退化为 value（永不让脏参数影响生成）
function normalizeKind(k) {
  const s = String(k || '').trim().toLowerCase();
  return MOMENTS_KINDS.indexOf(s) >= 0 ? s : 'value';
}

// ── 字数策略分叉（2026-09-19 用户拍板）──
//  · 价值型 / 人设型 / 成交型 / 生活型（4 类）→ 用**固定字数区间**（对齐参考站《朋友圈文案工作台》真实规则）
//  · 叙事型 story（2 类）→ 仍**长度跟随用户原文**（OUT_LEN_TIERS，下限 80）
//    这样既能让常见 4 类保持稳定的篇幅体感，又保留 story 对用户素材长短的弹性。
const KIND_LEN_FIXED = {
  value:   [100, 250],
  persona: [150, 280],
  deal:    [150, 320],
  life:    [80, 200]
};
// 「用户明确要求更长」时切换到加长区间（识别见 LEN_UP_RE；值必须 > 基准上限，由 test_constants_sync 守卫）
const KIND_LEN_FIXED_LONG = {
  value:   [200, 400],
  persona: [250, 430],
  deal:    [280, 500],
  life:    [180, 350]
};
// 「更长」诉求关键词（③ 2026-09-20 用户拍板）：命中则本次长度升档。
// ⚠️ 刻意不含「具体 / 展开 / 丰富」——它们出现在生活型/价值型的写作指令里，会造成误触发。
const LEN_UP_RE = /(更长|再长|长一点|长点|写长|加长|篇幅长|字数多|多写点|写多点|多写一些|详细点|详细些|更详细)/;

// ── 输出长度tiers：由**用户原文实际字数**推出输出字数区间（仅用于 story）──
// 设计意图：长度跟随用户的输入量 —— 用户写得多，就给长的反馈；写得少，就给短的反馈；
// 哪怕只给一句话也至少 80 字（这样才有具体画面、细节、内容）。
// 优先级：用户明确要求的长度 > 这里推出的区间 > 类型的结构描述。
// ⚠️ 前端 pages/gen/gen.js 有一份**同规则的副本**（用于在输入框下实时提示预计字数），
//    两处的 OUT_LEN_TIERS 必须逐字一致，由 test_constants_sync.js 做源码级比对守卫。
const OUT_LEN_TIERS = [[50, 80, 150], [200, 150, 300], [500, 250, 450], [null, 350, 700]];
const OUT_LEN_FLOOR = 80;                       // 硬下限：任何情况不低于 80 字
// 返回 { min, max, text, n, fixed }；n = 参与计算的字数（0 = 仅图片/链接，无自有文字）；
// fixed = true 表示本次是 4 类的固定区间（与用户原文长短无关）。
function momentLengthHint(kind, n, wantLonger) {
  const k = normalizeKind(kind);
  const up = !!wantLonger;
  // 4 类固定区间：默认按类型定长；用户明确要求「更长」时切到加长区间
  if (KIND_LEN_FIXED[k]) {
    const boosted = up && !!KIND_LEN_FIXED_LONG[k];
    const r = boosted ? KIND_LEN_FIXED_LONG[k] : KIND_LEN_FIXED[k];
    return { min: r[0], max: r[1], text: r[0] + '-' + r[1], n: n > 0 ? n : 0, fixed: true, boosted: boosted };
  }
  // 其余（story）：长度跟随用户原文（OUT_LEN_TIERS，下限 80）
  const len = n > 0 ? n : 0;
  let idx = OUT_LEN_TIERS.length - 1;
  for (let i = 0; i < OUT_LEN_TIERS.length; i++) {
    const t = OUT_LEN_TIERS[i];
    if (t[0] === null || len < t[0]) { idx = i; break; }
  }
  // 用户要求更长 → 档位上移一格（已在最高档则维持，由指令层"要长则不设上限"兜住）
  const boosted = up && idx < OUT_LEN_TIERS.length - 1;
  if (boosted) idx += 1;
  const t = OUT_LEN_TIERS[idx];
  return { min: t[1], max: t[2], text: t[1] + '-' + t[2], n: len, fixed: false, boosted: up };
}

// 生成「本次类型 + 本次长度」声明块（拼在用户消息最前面）。
// 为什么放用户消息而不是系统提示词：系统提示词必须**逐字节固定**才能命中显式前缀缓存
// （caching.prefix=true 要求前缀完全一致）。把 kind / 长度做成插值会让每次请求的系统提示词都不同，
// 缓存直接失效、输入成本翻数倍。所以这里只把它们拼进用户消息。
function buildKindDirective(kind, inputLen, wantLonger) {
  const k = normalizeKind(kind);
  const L = momentLengthHint(kind, inputLen, wantLonger);
  const head = '【本次类型】' + MOMENTS_KIND_LABEL[k] + '\n本次已由用户明确指定类型，**不要再改判**，直接按该类型的要求输出 3 组。\n';
  let lenBlock;
  if (L.fixed) {
    lenBlock =
      '【本次长度】本类型使用**固定字数区间**：每组写 ' + L.text + ' 字。\n' +
      (L.boosted ? '用户本轮明确要求更长 → 已上调到加长区间，请落在 ' + L.text + ' 字内。\n' : '') +
      '（价值型 / 人设型 / 成交型 / 生活型 的篇幅与您填写多少无关，请严格落在该区间内，\n' +
      '不要因为原文长就超上限、也不要因为原文短就低于下限。）\n';
  } else {
    const src = L.n > 0 ? ('用户原文约 ' + L.n + ' 字') : '用户没有给文字（只有图片或链接）';
    lenBlock =
      '【本次长度】' + src + ' → 每组写 ' + L.text + ' 字。\n' +
      (L.boosted ? '用户本轮明确要求更长 → 已上调一个档位，请落在 ' + L.text + ' 字内。\n' : '') +
      '这是按"长度跟随用户原文"算出来的：用户给得多就写得多，给得少就写得少。\n' +
      '**每组不得低于 ' + OUT_LEN_FLOOR + ' 字**（即便是只有一句话的素材）；不足时靠展开已有细节补足，' +
      '**不得编造原文没有的人物、地点、事件**。\n';
  }
  return head + '\n' + lenBlock +
    '若用户在本轮明确要求更长或更短，以用户要求为准（要长则不设上限）。\n';
}

// 兼容解析 Responses API 与 Chat API 两种返回结构，避免某一格式字段名变化导致取空
function extractText(resp) {
  try {
    if (resp && typeof resp.output_text === 'string' && resp.output_text.trim()) return resp.output_text.trim();
    if (resp && resp.output && typeof resp.output === 'string' && resp.output.trim()) return resp.output.trim();
    const item = resp && resp.output && resp.output[0];
    if (item) {
      if (typeof item.text === 'string' && item.text.trim()) return item.text.trim();
      const c = item.content;
      if (Array.isArray(c)) {
        for (let i = 0; i < c.length; i++) {
          if (c[i] && typeof c[i].text === 'string' && c[i].text.trim()) return c[i].text.trim();
        }
      }
    }
    const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
    if (msg && typeof msg.content === 'string' && msg.content.trim()) return msg.content.trim();
  } catch (e) {}
  return '';
}

// 把 moments 返回文本按【1】【2】【3】拆成 3 条；兜底：拆不出就整段作为单条
function parseMoments(text) {
  const parts = text.split(/【\s*(\d+)\s*】/);
  const opts = [];
  for (let i = 1; i < parts.length; i += 2) {
    const content = (parts[i + 1] || '').trim();
    if (content) opts.push(content);
  }
  if (opts.length < 1) opts.push(text.trim());
  return opts.slice(0, 3);
}

// ── 积分：读 / 加 / 扣（全部服务端权威，客户端无法伪造）──
async function readPoints(openid) {
  const r = await cloud.database().collection('vp_users').doc(openid).get().catch(() => ({ data: null }));
  return (r && r.data && typeof r.data.points === 'number') ? r.data.points : 0;
}

// 加分（含首次建档）。返回加分后余额。
async function awardPoints(openid, delta) {
  const db = cloud.database();
  const _ = db.command;
  const ref = db.collection('vp_users').doc(openid);
  const r = await ref.get().catch(() => ({ data: null }));
  if (!(r && r.data)) {
    await ref.set({ data: { openid, points: delta, unlockedAll: false, coupons: [], createTime: db.serverDate() } });
  } else {
    const data = { points: _.inc(delta), updateTime: db.serverDate() };
    if (!Array.isArray(r.data.coupons)) data.coupons = [];
    await ref.update({ data });
  }
  return await readPoints(openid);
}

// 扣分（余额守卫）：用 where(points >= cost) 条件更新，天然防并发超扣（updated=0 即余额不足）。
// 返回 { ok, balance }：ok=false 表示积分不足（balance=当前余额）。
async function chargePoints(openid, cost) {
  const db = cloud.database();
  const _ = db.command;
  const r = await db.collection('vp_users')
    .where({ _id: openid, points: _.gte(cost) })
    .update({ data: { points: _.inc(-cost), updateTime: db.serverDate() } })
    .catch(e => { console.error('[ai_gen] 扣分失败:', e && e.message); return { stats: { updated: 0 } }; });
  if (!(r && r.stats && r.stats.updated === 1)) {
    return { ok: false, balance: await readPoints(openid) };
  }
  return { ok: true, balance: await readPoints(openid) };
}

// ═══════════════════════════════════════════════════════════════════════════
// H5 通道（公众号版）· 2026-09-23
// ───────────────────────────────────────────────────────────────────────────
// 场景：个人主体拿不到「深度合成」类目 → AI 文案能力外迁到 H5，放在公众号里用。
// H5 没有 openid、也不该让用户在网页上买积分，所以计费模型整体换成「日额度」：
//   · 维度 = 设备指纹（localStorage UUID）+ 客户端 IP，**两个桶各自独立计数**，
//     任一桶超限即拒 —— 清掉 localStorage 也绕不过 IP 桶。
//   · 额度池**不区分首次/换一批**：每成功生成一次扣 1，语义简单、用户一眼看懂。
//   · 生成失败（超时/上游报错）**退还额度**，不能因为服务端问题吃掉用户的次数。
//   · 全部落在 h5_usage 集合，`_id = <北京日>_<桶前缀>_<hash>`，天然按天分区、次日自动重置
//     （老文档不删，仅作统计留痕；h5_usage 可随时加 TTL 索引清理）。
// 合规：H5 侧同样是「生成合成内容」，页面上有常驻 AI 标识 + 用户须知（见 h5/index.html）。
// ═══════════════════════════════════════════════════════════════════════════
const H5_FREE_DAILY = 5;        // 每个桶每天免费生成次数（首次与换一批共用）
const H5_COLLECTION = 'h5_usage';

// 把 HTTP 访问服务的事件归一化成小程序 callFunction 的参数形态。
// 云开发 HTTP 访问服务事件结构：{ path, httpMethod, headers, queryStringParameters, body, isBase64Encoded }
function parseH5Event(event) {
  const e = event || {};
  const isHttp = !!(e.httpMethod || e.headers || e.queryStringParameters !== undefined || e.path !== undefined);
  if (!isHttp) return { isHttp: false };
  const headers = e.headers || {};
  const lower = {};
  Object.keys(headers).forEach(k => { lower[String(k).toLowerCase()] = headers[k]; });
  // 真实来源 IP：HTTP 访问服务会把客户端 IP 放进 x-forwarded-for（可能带多级代理逗号串）
  const ip = String(lower['x-forwarded-for'] || lower['x-real-ip'] || lower['x-client-ip'] || '')
    .split(',')[0].trim();
  let payload = {};
  const raw = e.body;
  if (raw && typeof raw === 'string') {
    try { payload = JSON.parse(raw); } catch (err) { payload = {}; }
  } else if (raw && typeof raw === 'object') {
    payload = raw;
  }
  // 兼容 query 传参（便于用浏览器直接 GET 调试）
  const q = e.queryStringParameters || {};
  Object.keys(q).forEach(k => { if (payload[k] === undefined) payload[k] = q[k]; });
  return { isHttp: true, payload: payload || {}, ip: ip, method: String(e.httpMethod || 'POST').toUpperCase() };
}

// 集成响应（带 CORS）。**只在 HTTP 通道使用** —— 小程序 callFunction 拿到的必须是裸对象，
// 若把 statusCode/headers/body 结构返回给小程序，前端读 r.result.options 会直接取空。
function jsonOut(obj, status) {
  return {
    statusCode: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(obj)
  };
}

// 轻量哈希（不引 crypto，够用于限流分桶；不落原始 IP，减少个人信息留存）
function hashId(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// 北京时间自然日（云函数运行在 UTC，必须手动 +8；否则 8:00 前会算到前一天）
function bjDay() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 组装本次请求要检查的桶：设备桶 + IP 桶（有哪个算哪个）
function h5Buckets(ip, deviceId) {
  const day = bjDay();
  const list = [];
  const d = String(deviceId || '').trim();
  if (d) list.push({ id: day + '_d_' + hashId(d), kind: 'device' });
  if (ip) list.push({ id: day + '_i_' + hashId(ip), kind: 'ip' });
  return list;
}

// 取一次额度：任一桶已满即拒；全部通过才各自 +1。
async function takeH5Quota(ip, deviceId) {
  const buckets = h5Buckets(ip, deviceId);
  if (!buckets.length) return { ok: false, reason: 'noid', used: H5_FREE_DAILY, limit: H5_FREE_DAILY };
  const db = cloud.database();
  const _ = db.command;
  // 先统一读，再统一写：避免"第一个桶加过了、第二个桶才发现满"造成的白扣
  const cur = [];
  for (const b of buckets) {
    const r = await db.collection(H5_COLLECTION).doc(b.id).get().catch(() => ({ data: null }));
    cur.push((r && r.data && typeof r.data.n === 'number') ? r.data.n : 0);
  }
  let maxUsed = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (cur[i] >= H5_FREE_DAILY) return { ok: false, reason: 'limit', used: cur[i], limit: H5_FREE_DAILY };
    if (cur[i] > maxUsed) maxUsed = cur[i];
  }
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const ref = db.collection(H5_COLLECTION).doc(b.id);
    if (cur[i] > 0) {
      await ref.update({ data: { n: _.inc(1), updateTime: db.serverDate() } }).catch(() => {});
    } else {
      // 文档不存在 → 建档。若并发下已被别的请求建好，update 分支自然承接，此处失败可忽略。
      await ref.set({ data: { day: bjDay(), kind: b.kind, n: 1, createTime: db.serverDate(), updateTime: db.serverDate() } }).catch(() => {});
    }
  }
  const used = maxUsed + 1;
  return { ok: true, used: used, limit: H5_FREE_DAILY };
}

// 退还一次额度（生成失败时调用，别让服务端故障吃掉用户次数）
async function releaseH5Quota(ip, deviceId) {
  const buckets = h5Buckets(ip, deviceId);
  const db = cloud.database();
  const _ = db.command;
  for (const b of buckets) {
    await db.collection(H5_COLLECTION).doc(b.id)
      .update({ data: { n: _.inc(-1), updateTime: db.serverDate() } })
      .catch(() => {});
  }
}

exports.main = async (event) => {
  // ── 入口分叉：HTTP 访问服务（H5 / 公众号） vs 小程序 callFunction ──
  const h5ctx = parseH5Event(event);
  if (h5ctx.isHttp && h5ctx.method === 'OPTIONS') return jsonOut({ ok: true });   // CORS 预检
  const p = h5ctx.isHttp ? (h5ctx.payload || {}) : (event || {});
  // H5 通道必须**显式**带 channel:'h5'，不接受任何形式的推断（宁可返回"未获取到身份"，
  // 也绝不能让一个恰好没有 openid 的调用悄悄绕过身份校验白拿免费额度）。
  // 另加一道与「无 openid」的合取：即便有人在小程序里伪造 channel:'h5'，只要拿到了 openid
  // 就仍走积分路径 —— 伪造无法换来免费额度。
  const declaredH5 = String(p.channel || '').trim().toLowerCase() === 'h5';
  const openid = (cloud.getWXContext() && cloud.getWXContext().OPENID) || '';
  const isH5 = declaredH5 && (h5ctx.isHttp || !openid);
  const reply = (obj) => (h5ctx.isHttp ? jsonOut(obj) : obj);

  const apiKey = env('LLM_API_KEY');
  if (!apiKey) return reply({ ok: false, err: '服务端未配置 LLM_API_KEY（请在云函数环境变量中填写你的火山方舟 API Key）' });
  const model = env('LLM_MODEL');
  if (!model) return reply({ ok: false, err: '服务端未配置 LLM_MODEL（请在云函数环境变量中填写你的豆包接入点 ID，如 ep-xxxxxxxx）' });

  // 唯一产出模式 = moments。缺省即 moments（只剩一种产出，缺省取最宽容）；
  // 但**显式传别的值一律明确报错，不做静默降级** —— 静默降级会让调用方
  // 以为拿到了画面感内容脚本、实际拿到朋友圈文案，比报错危险得多。
  const rawMode = String(p.mode || '').trim();
  if (rawMode && rawMode !== MODE) {
    return reply({
      ok: false,
      err: '不支持的 mode: ' + rawMode + '（本应用只提供朋友圈文案服务；画面感内容请走「付费定制」入口）'
    });
  }
  // 校验通过后，本函数后续逻辑只有 moments 一条分支（不再有 mode 变量分叉）。
  let text = String(p.prompt || '').trim();
  const url = String(p.url || '').trim();
  const imageFileId = String(p.imageFileId || '').trim();
  // 多图（2026-09-18：最多 3 张）。兼容旧单图字段 imageFileId。
  // H5 通道 v1 不开放图片：网页端没有云存储写权限、拿不到合法 fileID，
  // 硬传进来的 fileID 只会在 downloadFile 抛错并打断整条链路，故直接忽略。
  const imageFileIds = (isH5 ? [] : (Array.isArray(p.imageFileIds) ? p.imageFileIds : []))
    .map(v => String(v || '').trim()).filter(Boolean).slice(0, MAX_INPUT_IMAGES);
  if (!imageFileIds.length && imageFileId && !isH5) imageFileIds.push(imageFileId);

  // 「换一批」：对上一版不满意 → 带修改意见（以及上一版文案）重新生成 3 条。
  // 是否走 15 分档**由服务端按 feedback 是否存在判定**，前端无法自选价格档位。
  const feedback = String(p.feedback || '').trim().slice(0, FEEDBACK_MAX);
  const previous = Array.isArray(p.previous)
    ? p.previous.map(v => String(v || '').trim().slice(0, 300)).filter(Boolean).slice(0, 3)
    : [];
  const isRevise = !!feedback;
  // 类型路由：value/persona/deal/life/story；缺省或非法 → value。
  // 前端在 gen 页「类型 Tab」里选；服务端只做白名单归一化，脏值永不透传。
  const kind = normalizeKind(p.kind);

  if (isH5) {
    if (!h5ctx.ip && !String(p.deviceId || '').trim()) {
      return reply({ ok: false, err: '无法识别请求来源（未取到设备标识与 IP），请刷新页面重试' });
    }
  } else if (!openid) {
    return reply({ ok: false, err: '未获取到用户身份（openid）' });
  }

  // ① 文章链接 → 服务端抓正文，与手写文字合并
  if (url) {
    const a = await fetchArticle(url);
    if (!a.ok) return reply({ ok: false, err: a.err });
    let bodyText = a.text;
    const CAP = 4000;
    const truncated = bodyText.length > CAP;
    if (truncated) bodyText = bodyText.slice(0, CAP);
    const head = a.title ? ('【来源标题】' + a.title + '\n') : '';
    text = (head + '【来源正文】\n' + bodyText + (truncated ? '\n…（正文过长已截断）' : '')
      + (text ? ('\n\n【我的补充】\n' + text) : '')).trim();
  }

  if (text.length > 6000) return reply({ ok: false, err: '内容过长（当前 ' + text.length + ' 字），请精简后重试' });

  // ② 图片（最多 3 张）→ base64 data URL 列表（多模态）
  const imageDataUrls = [];
  for (const fid of imageFileIds) {
    try { imageDataUrls.push(await imageToDataUrl(fid)); }
    catch (e) { return reply({ ok: false, err: '图片处理失败：' + (e && e.message ? e.message : String(e)) }); }
  }
  const imageDataUrl = imageDataUrls[0] || '';

  // 换一批时即使没有正文/图片也允许（修改意见 + 上一版文案本身就是上下文）
  if (!text && !imageDataUrls.length && !isRevise) {
    return reply({ ok: false, err: isH5 ? '请先填写素材，或粘贴一个文章链接' : '请输入文字、上传图片或粘贴文章链接' });
  }

  // 纯图无文字 → 补一句默认指令；图文并存 → 提示模型图文结合
  let userText = text;
  if (!userText && imageDataUrls.length) {
    userText = '根据这张图片写 3 条朋友圈分享文案';
  } else if (imageDataUrls.length) {
    userText = userText + '\n\n（请同时参考我上传的 ' + imageDataUrls.length + ' 张图片内容）';
  }

  // 类型 + 长度声明：拼在用户消息**最前面**，让模型第一眼看到本次约束。
  // 放用户消息而非系统提示词，是为了不动系统的缓存前缀（见 buildKindDirective 注释）。
  // 长度用 `text.length`（url 抓来的正文也算材料量，材料越多越有得写）。
  // 「更长」诉求识别（③ 2026-09-20 用户拍板）：正文或修改意见里明确要求更长 → 本次长度升档
  const wantLonger = LEN_UP_RE.test(text + ' ' + (isRevise ? feedback : ''));
  const lenHint = momentLengthHint(kind, text.length, wantLonger);
  userText = (buildKindDirective(kind, text.length, wantLonger) + '\n' + userText).trim();

  // 「换一批」：把「上一版文案 + 修改意见」拼进**用户消息**（而非系统提示词，保持缓存前缀稳定不被打散）
  if (isRevise) {
    const prevBlock = previous.length
      ? ('【上一版文案】\n' + previous.map((s, i) => '【' + (i + 1) + '】' + s).join('\n') + '\n\n')
      : '';
    const reviseAsk = '请按【我的修改意见】重写 3 条与上一版**明显不同**的朋友圈文案（仍用【1】【2】【3】分隔），\n' +
      '【修改意见是最高优先级指令】必须逐条落实：用户说要什么场景/情绪/长度/视角，就照做；\n' +
      '不要照抄上一版的句子（连续 7 个字相同即视为照抄）；保留用户原本想表达的核心信息与真实情绪。\n' +
      '若意见是「再来3个文案」这类无具体方向的话，则换 3 个完全不同的切入角度重写。';
    userText = ((userText ? userText + '\n\n' : '') + prevBlock
      + '【我的修改意见】\n' + feedback + '\n\n' + reviseAsk).trim();
  }

  // ③ 计费 / 配额（服务端权威）：
  //    小程序 → 扣积分：首次 20 / 带意见换一批 15（前端无法自选档位）；
  //    H5     → 扣日额度：不涉及任何付费，首次与换一批共用同一个池。
  //    两条路径的生成失败都会在下方自动退还，用户不会白花。
  let charged = 0;
  let balanceAfter = null;
  let quota = null;
  const cost = isRevise ? (POINTS_COST.momentsRevise || 15) : (POINTS_COST.moments || 20);
  if (isH5) {
    const q = await takeH5Quota(h5ctx.ip, String(p.deviceId || '').trim());
    if (!q.ok) {
      return reply({
        ok: false,
        channel: 'h5',
        err: q.reason === 'noid'
          ? '无法识别请求来源（未取到设备标识与 IP），请刷新页面重试'
          : ('今天的免费次数已用完（' + q.limit + ' 次/天）。想要更多，请到小程序里用积分继续生成。'),
        quota: { used: q.used, limit: q.limit, left: Math.max(0, q.limit - q.used) }
      });
    }
    quota = { used: q.used, limit: q.limit, left: Math.max(0, q.limit - q.used) };
  } else {
    const c = await chargePoints(openid, cost);
    if (!c.ok) return reply({ ok: false, err: '积分不足', points: c.balance, need: cost, cost: cost, revise: isRevise });
    charged = cost;
    balanceAfter = c.balance;
  }

  const base = env('LLM_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3';
  const headers = { 'Authorization': 'Bearer ' + apiKey };
  const sysPrompt = SYSTEM_PROMPT_MOMENTS;
  // 输出上限随长度档位浮动（2026-09-19 修）：
  //   moments 一次要出 3 组，若用户给的是长文（单组 350-700 字），3 组合计可达 ~2100 字；
  //   写死 1500 token 会把第 2、3 组**截断成半截话**（parseMoments 拆出来的就是残句）。
  //   按「3 × 单组上限 × 1.2（分隔标记/话题标签开销）」估 token，并保留 1500 的旧下限避免短输入时反而变小。
  //   （中文约 0.6-1 token/字；上限 4000 防止意外撑爆模型输出额度）
  const maxOut = Math.min(4000, Math.max(1500, Math.round(3 * lenHint.max * 1.2) + 200));

  // 用户消息：纯文本用字符串；带图（1-3 张）用多模态数组（两种 API 的 part 类型名不同）
  const hasImages = imageDataUrls.length > 0;
  const contentResponses = hasImages
    ? [{ type: 'input_text', text: userText }].concat(imageDataUrls.map(u => ({ type: 'input_image', image_url: u })))
    : userText;
  const contentChat = hasImages
    ? [{ type: 'text', text: userText }].concat(imageDataUrls.map(u => ({ type: 'image_url', image_url: { url: u } })))
    : userText;

  // 生成失败时退回已扣资源：小程序退积分、H5 退日额度（只在真的扣过时生效）
  const refund = async () => {
    if (isH5) {
      if (quota) await releaseH5Quota(h5ctx.ip, String(p.deviceId || '').trim());
      return;
    }
    if (charged) { try { await awardPoints(openid, charged); } catch (e) { console.error('[ai_gen] 退回积分失败:', e && e.message); } }
  };

  let out = '';
  try {
    // 主路径：Responses API + 显式前缀缓存（系统提示词固定 → 确定性命中）
    const res = await postJSON(base + '/responses', headers, {
      model,
      input: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: contentResponses }
      ],
      caching: { type: 'enabled', prefix: true },
      temperature: 0.8,
      max_output_tokens: maxOut
    });
    out = extractText(res);
    if (!out) throw new Error('模型返回为空');
  } catch (e) {
    // 2026-09-20：单次请求**超时**时不再降级重试。
    // ① 重试没意义：同样长度的输出再跑一次，大概率还是超；
    // ② 更危险：两次叠加会把总耗时顶到云函数 60s 上限被强杀 ⇒ refund() 来不及执行 ⇒ 用户丢分。
    // 所以超时路径跳过重试、直接退款返回，把总耗时压在一次请求以内。
    const emsg = (e && e.message) ? String(e.message) : '';
    if (emsg.indexOf('请求超时') >= 0) {
      await refund();
      return reply({
        ok: false, channel: isH5 ? 'h5' : 'mp',
        err: isH5 ? '生成超时，本次不占用你的免费次数，请缩短内容后重试' : '生成超时，请缩短内容后重试（本次未扣除积分）'
      });
    }
    // 兜底：Responses 失败（端点未开 / 字段不识别 / 多模态不支持）→ 回退 chat/completions，保证可用
    console.error('[ai_gen] Responses 路径失败，回退 chat/completions：', e && e.message ? e.message : String(e));
    try {
      const res2 = await postJSON(base + '/chat/completions', headers, {
        model,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: contentChat }
        ],
        temperature: 0.8,
        max_tokens: maxOut
      });
      out = extractText(res2);
      if (!out) throw new Error('模型返回为空');
    } catch (e2) {
      await refund();
      return reply({
        ok: false, channel: isH5 ? 'h5' : 'mp',
        err: '调用失败：' + (e2 && e2.message ? e2.message : String(e2))
      });
    }
  }

  // 成功返回：小程序带上扣费后余额；H5 带上剩余日额度。
  // kind 原样回传（前端据此决定结果区形态，如叙事型显示「做成画面感内容」入口）。
  const okOut = {
    ok: true, mode: MODE, options: parseMoments(out),
    cost: charged, revised: isRevise, kind: kind,
    channel: isH5 ? 'h5' : 'mp'
  };
  if (isH5) okOut.quota = quota;
  else okOut.points = typeof balanceAfter === 'number' ? balanceAfter : await readPoints(openid);
  return reply(okOut);
};
