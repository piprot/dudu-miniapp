// 付费定制画面感内容 · 需求收集云函数
// 流程：用户选档（comic_pdf/comic_web）→ 虚拟支付成功 → 前端带邮箱+故事调本函数落库。
// 履约：运营侧从 custom_comic_requests 集合读取 pending 请求，8 小时内生成并发回用户邮箱。
// 通知：落库成功后**推送飞书群**，全文推送（画师需逐字读需求）。两种通道，**优先用应用机器人**：
//   通道A（当前采用）**应用机器人**：FEISHU_APP_ID + FEISHU_APP_SECRET + FEISHU_CHAT_ID
//          —— 换 tenant_access_token 后调 im/v1/messages。**不需要 webhook**，整条链路可 CLI 全自动搭建。
//   通道B（兜底）**自定义机器人 webhook**：FEISHU_WEBHOOK（+ 可选 FEISHU_WEBHOOK_SECRET）
//          ⚠️ 飞书**不支持**用 API/CLI 创建自定义机器人（官方 FAQ 明确），webhook 只能在客户端「群设置」里手工加。
// 两个通道都没配时：只落库、不推送，并在文档上记 notify='未配置通知通道（仅落库）'。**绝不丢单。**
// 安全：openid 服务端注入（不采信前端）；邮箱/档位/故事做服务端校验；同一订单号幂等（重复提交不重复建单）。
//
// 环境变量（云开发控制台 → 云函数 → custom_request → 配置；**改环境变量不需重新部署代码**）：
//   FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_CHAT_ID   通道A（推荐）
//   FEISHU_WEBHOOK / FEISHU_WEBHOOK_SECRET               通道B（兜底，可选）
const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TIER_PRICE_FEN = { comic_pdf: 6600, comic_web: 8800 };  // 与 vp_* 的 PRODUCTS 保持一致
// 积分兑换来的权益（白名单）：只认这里登记过的类型，前端传什么都不采信。
// 券不参与前端改价（定价权在 vp_create_order.PRODUCTS），而是随订单落库 + 推送给运营，
// 由人工在履约时按券减免 —— 这才让「积分兑换」真正接续到「下单使用」（2026-09-20）。
const COUPON_TYPES = { comic_discount: '画面感内容 9 折券' };
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const STORY_MAX = 30000;  // 故事正文上限（与前端 commission 输入框 maxlength 一致，用户要求 3 万字）
const NOTE_MAX = 500;     // 补充说明上限

const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK || '';          // 通道B
const FEISHU_SECRET = process.env.FEISHU_WEBHOOK_SECRET || '';
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';            // 通道A
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_CHAT_ID = process.env.FEISHU_CHAT_ID || '';

const HAS_APP_BOT = !!(FEISHU_APP_ID && FEISHU_APP_SECRET && FEISHU_CHAT_ID);
const NOTIFY_MODE = HAS_APP_BOT ? 'app' : (FEISHU_WEBHOOK ? 'webhook' : '');
const FEISHU_API = 'https://open.feishu.cn/open-apis';
const NOTIFY_TIMEOUT_MS = 5000;   // 单条推送超时（订单落库不能被推送拖死）
const NOTIFY_CHUNK_CHARS = 2500;  // 单条消息装多少字；超出自动拆条连发
const NOTIFY_MAX_CHUNKS = 6;

// ─────────────────────── 飞书推送 ───────────────────────

/** 飞书「自定义机器人」签名：key = timestamp + "\n" + secret，data 为空，结果 base64。 */
function feishuSign(secret, timestamp) {
  return crypto.createHmac('sha256', timestamp + '\n' + secret).update('').digest('base64');
}

/** 极简 HTTPS POST（用内置 https，不引三方依赖 —— 否则 R8 会要求声明 dependencies）。 */
function postJson(url, body, timeoutMs, extraHeaders) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { resolve({ ok: false, err: '请求地址非法' }); return; }
    if (u.protocol !== 'https:') { resolve({ ok: false, err: '请求地址必须是 https' }); return; }
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const headers = Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': payload.length
    }, extraHeaders || {});
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: headers
    }, (res) => {
      // ⚠️ 用 Buffer 累积后统一 utf8 解码，避免多字节汉字被分片截断成乱码(???/�)
      const chunks = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8')));
      res.on('end', () => {
        const full = Buffer.concat(chunks).toString('utf8');
        let j = null;
        try { j = JSON.parse(full); } catch (e) { /* 非 JSON，看 body */ }
        const code = j ? (j.code !== undefined ? j.code : j.StatusCode) : undefined;
        resolve({ ok: res.statusCode === 200 && code === 0, status: res.statusCode, body: String(full).slice(0, 300), json: j });
      });
    });
    req.on('error', (e) => resolve({ ok: false, err: String((e && e.message) || e) }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, err: 'timeout ' + timeoutMs + 'ms' }); });
    req.write(payload);
    req.end();
  });
}

const bold = (t) => ({ tag: 'text', text: t, style: ['bold'] });
const plain = (t) => ({ tag: 'text', text: t });

/** 把工单编成飞书「post」富文本段落：meta 段 + 故事全文（逐行保留，画师要照抄）。 */
function paragraphsFor(order) {
  const yuan = ((order.priceFen || 0) / 100).toFixed(2);
  const ps = [
    [bold('🆕 新定制单'), plain('　' + order.tier + '　原价 ¥' + yuan)],
    [bold('订单号：'), plain(order.outTradeNo || '（无）')],
    [bold('邮箱：'), plain(order.email || '（无）')],
    [bold('内容量：'), plain('故事 ' + String(order.story || '').length + ' 字'
      + (order.note ? '，补充说明 ' + String(order.note).length + ' 字' : ''))],
    // 用券的订单要显眼标出来：把"原价 / 券减 / 微信已收全款 / 券后实付"一次说清，
    // 否则运营按原价结算、用户的券就白换了（2026-09-22「支付↔运营打通」）。
    // 注：个人虚拟支付固定按道具价收全款，券以「履约退差价」形式落地，不参与改支付金额。
    ...(order.coupon && order.coupon.label
      ? [
          [bold('🎫 已用权益：'), plain(order.coupon.label)],
          [bold('   原价：'), plain('¥' + yuan)],
          [bold('   券减：'), plain('¥' + ((order.discountFen || 0) / 100).toFixed(2) + '（微信已实收全款，履约退此差额）')],
          [bold('   券后实付：'), plain('¥' + (((order.priceFen || 0) - (order.discountFen || 0)) / 100).toFixed(2))]
        ]
      : []),
    [plain('')],
    [bold('── 故事全文（请逐字阅读，勿删改设定）──')]
  ];
  String(order.story || '').split(/\r?\n/).forEach((l) => ps.push([plain(l)]));
  if (order.note) {
    ps.push([plain('')]);
    ps.push([bold('── 补充说明 ──')]);
    String(order.note).split(/\r?\n/).forEach((l) => ps.push([plain(l)]));
  }
  return ps;
}

/** 按字符预算把段落装箱，避免单条消息过长被飞书拒收。 */
function packChunks(paragraphs, budget) {
  const chunks = [];
  let cur = [];
  let size = 0;
  paragraphs.forEach((p) => {
    const len = p.reduce((s, e) => s + e.text.length, 0) + 1;
    if (cur.length && size + len > budget) { chunks.push(cur); cur = []; size = 0; }
    cur.push(p);
    size += len;
  });
  if (cur.length) chunks.push(cur);
  return chunks.slice(0, NOTIFY_MAX_CHUNKS);
}

// ── 通道A：应用机器人（tenant_access_token → im/v1/messages）──

// token 有效期约 2 小时。云函数实例会被复用，缓存住避免每条消息都换一次 token
// （换 token 是一次额外出网，白花超时预算）。
let tokenCache = { token: '', expireAt: 0 };

async function getTenantToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expireAt > now) return tokenCache.token;
  const r = await postJson(FEISHU_API + '/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }, NOTIFY_TIMEOUT_MS);
  const tk = r.json && r.json.tenant_access_token;
  if (!tk) throw new Error('取 tenant_access_token 失败：' + (r.err || r.body || ('HTTP ' + r.status)));
  const expire = Number(r.json.expire) || 7200;
  // 提前 5 分钟过期，避免边界上用到刚好失效的 token
  tokenCache = { token: tk, expireAt: now + Math.max(60, expire - 300) * 1000 };
  return tk;
}

/** 通道A 发一条。content 必须是 **JSON 字符串**（飞书强制「二次编码」），不是对象。 */
async function sendViaAppBot(chatId, title, chunk) {
  const token = await getTenantToken();
  const headers = { Authorization: 'Bearer ' + token };
  const url = FEISHU_API + '/im/v1/messages?receive_id_type=chat_id';
  let r = await postJson(url, {
    receive_id: chatId,
    msg_type: 'post',
    content: JSON.stringify({ post: { zh_cn: { title: title, content: chunk } } })
  }, NOTIFY_TIMEOUT_MS, headers);
  if (!r.ok) {
    const text = chunk.map((p) => p.map((e) => e.text).join('')).join('\n');
    r = await postJson(url, {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: title + '\n\n' + text })
    }, NOTIFY_TIMEOUT_MS, headers);
  }
  return r;
}

// ── 通道B：自定义机器人 webhook（兜底，签名可选）──

async function sendViaWebhook(title, chunk) {
  const withSign = (b) => {
    if (!FEISHU_SECRET) return b;
    const ts = String(Math.floor(Date.now() / 1000));
    b.timestamp = ts;
    b.sign = feishuSign(FEISHU_SECRET, ts);
    return b;
  };
  // 首选 post 富文本（标题+加粗），失败降级纯 text，两条路都试过才算失败
  let r = await postJson(FEISHU_WEBHOOK,
    withSign({ msg_type: 'post', content: { post: { zh_cn: { title: title, content: chunk } } } }),
    NOTIFY_TIMEOUT_MS);
  if (!r.ok) {
    const text = chunk.map((p) => p.map((e) => e.text).join('')).join('\n');
    r = await postJson(FEISHU_WEBHOOK,
      withSign({ msg_type: 'text', content: { text: title + '\n\n' + text } }),
      NOTIFY_TIMEOUT_MS);
  }
  return r;
}

/** 推一条工单给飞书。返回 {ok, err?, count?}；永不抛异常（订单落库优先）。 */
async function notifyFeishu(order) {
  if (!NOTIFY_MODE) return { ok: false, err: '未配置通知通道' };
  const chunks = packChunks(paragraphsFor(order), NOTIFY_CHUNK_CHARS);
  const yuan = ((order.priceFen || 0) / 100).toFixed(2);
  const finalYuan = (((order.priceFen || 0) - (order.discountFen || 0)) / 100).toFixed(2);
  const baseTitle = (order.coupon && order.coupon.label)
    ? '新定制单 · ' + order.tier + ' 原价¥' + yuan + ' 券后¥' + finalYuan
    : '新定制单 · ' + order.tier + ' ¥' + yuan;

  for (let i = 0; i < chunks.length; i++) {
    const title = baseTitle + (chunks.length > 1 ? '（' + (i + 1) + '/' + chunks.length + '）' : '');
    const r = NOTIFY_MODE === 'app'
      ? await sendViaAppBot(FEISHU_CHAT_ID, title, chunks[i])
      : await sendViaWebhook(title, chunks[i]);
    if (!r.ok) {
      return { ok: false, err: '第' + (i + 1) + '/' + chunks.length + ' 条失败：'
        + (r.err || r.body || ('HTTP ' + r.status)) };
    }
  }
  return { ok: true, count: chunks.length };
}

// ─────────────────────── 主入口 ───────────────────────

exports.main = async (event) => {
  const openid = (cloud.getWXContext() && cloud.getWXContext().OPENID) || '';
  if (!openid) return { ok: false, err: '未获取到用户身份' };

  const action = (event && event.action) || 'save';

  // 查询我的请求状态（支付成功页展示用）
  if (action === 'list') {
    const r = await cloud.database().collection('custom_comic_requests')
      .where({ openid })
      .orderBy('createTime', 'desc')
      .limit(5)
      .get().catch(() => ({ data: [] }));
    return { ok: true, requests: (r.data || []).map(d => ({
      productId: d.productId, tier: d.tier, email: d.email,
      status: d.status, createTime: d.createTime
    })) };
  }

  // 推送链路自检（发一条测试消息到飞书，验证 webhook 是否配好、出网是否通）
  if (action === 'test_notify') {
    const r = await notifyFeishu({
      tier: '自检', priceFen: 0, productId: 'test',
      outTradeNo: 'TEST-' + Date.now(), email: '(自检，非真实订单)',
      story: '这是一条测试推送，用于验证「定制需求 → 飞书群」链路。收到即表示配置成功。',
      note: ''
    });
    return { ok: !!r.ok, configured: !!NOTIFY_MODE, mode: NOTIFY_MODE || 'none', err: r.err || '', count: r.count || 0 };
  }

  // ── save：落库一条定制请求 ──
  const productId = String((event && event.productId) || '').trim();
  const email = String((event && event.email) || '').trim();
  const story = String((event && event.story) || '').trim();
  const note = String((event && event.note) || '').trim().slice(0, NOTE_MAX);
  const outTradeNo = String((event && event.outTradeNo) || '').trim();

  // 优惠券（积分兑换而来）：只接受白名单类型 + 合法折率（0<value<1），其余一律丢弃（不采信前端）
  let coupon = null;
  const rawCoupon = event && event.coupon;
  if (rawCoupon && typeof rawCoupon === 'object') {
    const cType = String(rawCoupon.type || '');
    const cValue = Number(rawCoupon.value);
    if (COUPON_TYPES[cType] && cValue > 0 && cValue < 1) {
      coupon = { type: cType, value: cValue, label: COUPON_TYPES[cType] };
    }
  }

  if (!TIER_PRICE_FEN[productId]) return { ok: false, err: '未知的定制档位' };
  if (!EMAIL_RE.test(email)) return { ok: false, err: '邮箱格式不正确，请检查后重试' };
  if (!story) return { ok: false, err: '缺少故事内容' };
  if (story.length > STORY_MAX) return { ok: false, err: '故事过长（当前 ' + story.length + ' 字），请精简后重试' };

  const db = cloud.database();

  // 幂等：同一订单号只建一条请求（前端可能重试提交）
  if (outTradeNo) {
    const exist = await db.collection('custom_comic_requests').where({ openid, outTradeNo }).get()
      .catch(() => ({ data: [] }));
    if (exist.data && exist.data.length) {
      return { ok: true, already: true, requestId: exist.data[0]._id };
    }
  }

  const tierName = productId === 'comic_pdf' ? '画面感内容PDF' : '画面感内容HTML';
  const priceFen = TIER_PRICE_FEN[productId];
  // 券减额：券不参与改支付金额（定价权在 vp_create_order.PRODUCTS，个人虚拟支付固定按道具价收全款），
  // 折算成「券减额」随订单落库 + 推给运营，履约时退差价；finalFen = 券后应付（应退 = priceFen - finalFen）。
  const discountFen = coupon ? Math.round(priceFen * (1 - coupon.value)) : 0;
  const finalFen = priceFen - discountFen;
  const add = await db.collection('custom_comic_requests').add({
    data: {
      openid,
      productId,
      tier: tierName,
      priceFen,
      discountFen,             // 券减额（分）；无券为 0
      finalFen,                // 券后应付（分）= priceFen - discountFen；运营履约时按此对账
      outTradeNo: outTradeNo || '',
      email,
      story,
      note,
      coupon,                   // 用券信息（无则 null）：运营侧按券减免，履约后核销
      status: 'pending',        // pending → delivered（人工履约完成后改）
      notify: '待推送',
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  }).catch(e => { throw new Error('落库失败：' + (e && e.message ? e.message : e)); });

  // 核销券：下单成功后立即移除该权益，避免同一张券被多个订单重复使用（与 points 兑换去重对称）。
  // 用「读出数组 → 过滤 → 写回」而非 db.command.pull：微信云开发的 pull 对普通对象做的是**严格深相等**
  // 匹配，而券带 grantedAt 时间戳，plain 对象匹配会静默删不掉（券仍可被复用，最糟结果）。
  // 读改写在此低频场景足够稳妥；若过滤后无变化则跳过写，避免无意义覆盖。
  if (coupon) {
    const ref = db.collection('vp_users').doc(openid);
    const udoc = await ref.get().catch(() => ({ data: null }));
    const list = (udoc && udoc.data && Array.isArray(udoc.data.coupons)) ? udoc.data.coupons : [];
    const kept = list.filter(c => !(c && c.type === coupon.type));
    if (kept.length !== list.length) {
      await ref.update({ data: { coupons: kept } })
        .catch(e => console.error('[custom_request] 核销券失败（不影响落库与发货）:', e && e.message));
    }
  }

  // 落库成功后才推送（顺序不可颠倒：推送失败不能导致丢单）。
  // 推送结果写回文档 → 「一键查询」里能看到每单的通知状态，失败不会静默丢失。
  const res = await notifyFeishu({ productId, tier: tierName, priceFen, discountFen, outTradeNo, email, story, note, coupon })
    .catch(e => ({ ok: false, err: String((e && e.message) || e) }));
  const notifyText = !NOTIFY_MODE ? '未配置通知通道（仅落库）'
    : (res.ok ? ('已推送飞书' + (res.count > 1 ? '(' + res.count + '条)' : '')) : ('推送失败：' + res.err));
  await db.collection('custom_comic_requests').doc(add._id)
    .update({ data: { notify: notifyText, notifyTime: db.serverDate() } })
    .catch(() => { /* 记不上不影响主流程 */ });

  return { ok: true, requestId: add._id, notified: !!res.ok, notify: notifyText };
};
