// H5 定制需求提交 · 云函数（HTTP 访问服务触发）
// ─────────────────────────────────────────────────────────────────────────
// 职责边界（**这是本函数最重要的约束**）：
//   只做「收下需求 → 落库 → 通知运营 → 回一个取件码」四件事。
//   ⛔ 不调用任何生成/合成接口（豆包、Seedream、方舟……一个都不碰），
//      不产生任何 AI 内容。H5 的前台也**不开放自助生成**。
//   原因：自助文生图属于深度合成服务，须以企业主体做算法备案；而我们卖的是
//   「已完成的成品内容」——性质是卖内容，不是提供合成服务能力。这条边界一旦
//   被跨越（比如有人"顺手"在这里接上出图），合规性质立刻改变。
//   所以本文件里出现 seedream / ark / images/generations / ai_gen 之类字样，
//   都应当被视为 Bug（test/test_h5_comic.js 会拦）。
//
// 与 custom_request 的分工（勿混）：
//   · custom_request（小程序专用）：**付费成功后**收「完整故事 + 邮箱」，
//     带 outTradeNo，履约依据。依赖 cloud.getWXContext().OPENID。
//   · h5_request（本函数，H5 专用）：**付款之前**收「故事梗概 + 邮箱」，
//     是线索（lead），用于运营跟进 + 与后续订单按邮箱对上。
//     H5 拿不到 openid，所以身份只能靠 设备标识 + IP 做限流。
//   两个集合分开是**有意的**：线索（未付款）和订单（已付款）语义不同，
//   混在一个集合里会让运营误把未付款的线索当订单去履约。
//
// 环境变量（云开发控制台 → 云函数 → h5_request → 配置；改环境变量不需重新部署）：
//   FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_CHAT_ID   与 custom_request 同名同义
//   ⚠️ 微信云函数的环境变量是**按函数隔离**的，custom_request 配过的这里要再配一次。
//   未配置时：只落库、不推送，并在返回里如实标注 notify='未配置通知通道（仅落库）'。**绝不丢单。**
const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const COLLECTION = 'h5_requests';        // 线索集合（与 custom_comic_requests 分开）
const USAGE = 'h5_req_usage';            // 限流计数（与 ai_gen 的 h5_usage 分开，避免互相影响）
const H5_REQ_DAILY = 3;                  // 每桶每天最多提交几次（设备桶 / IP 桶各自算）

const PRODUCTS = { comic_web: '画面感内容HTML（¥88）', comic_pdf: '画面感内容PDF（¥66）', undecided: '还没定' };
const EPISODES = { '4': '4 集（精简 · 约 24 格）', '8': '8 集（完整 · 约 54 格）', undecided: '还没定' };

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// 梗概上限 1500，与 h5/comic.html 的 maxlength 一致（改一处就要改另一处）。
// 注意：这与 custom_request 的 STORY_MAX=30000 不是一回事 —— 那边收的是**全文**，
// 这边收的是**梗概**，故意的：让客户先低门槛留线索，全文到小程序付费后再填。
const STORY_MIN = 20;
const STORY_MAX = 1500;
const NOTE_MAX = 300;
const WECHAT_MAX = 64;
const FROM_MAX = 200;
const DEDUP_WINDOW_MS = 10 * 60 * 1000;  // 同设备同内容 10 分钟内重复提交 → 返回原取件码

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_CHAT_ID = process.env.FEISHU_CHAT_ID || '';
const HAS_APP_BOT = !!(FEISHU_APP_ID && FEISHU_APP_SECRET && FEISHU_CHAT_ID);
const FEISHU_API = 'https://open.feishu.cn/open-apis';
const NOTIFY_TIMEOUT_MS = 5000;

// ─────────────────────── 基础工具 ───────────────────────

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

/** 把 HTTP 访问服务事件归一化（与 ai_gen 的 parseH5Event 同一套约定）。 */
function parseH5Event(event) {
  const e = event || {};
  const isHttp = !!(e.httpMethod || e.headers || e.queryStringParameters !== undefined || e.path !== undefined);
  if (!isHttp) return { isHttp: false, payload: e || {}, ip: '', method: 'POST' };
  const headers = e.headers || {};
  const lower = {};
  Object.keys(headers).forEach((k) => { lower[String(k).toLowerCase()] = headers[k]; });
  const ip = String(lower['x-forwarded-for'] || lower['x-real-ip'] || lower['x-client-ip'] || '')
    .split(',')[0].trim();
  let payload = {};
  let raw = e.body;
  if (e.isBase64Encoded && typeof raw === 'string') {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (err) { raw = ''; }
  }
  if (raw && typeof raw === 'string') {
    try { payload = JSON.parse(raw); } catch (err) { payload = {}; }
  } else if (raw && typeof raw === 'object') {
    payload = raw;
  }
  const q = e.queryStringParameters || {};
  Object.keys(q).forEach((k) => { if (payload[k] === undefined) payload[k] = q[k]; });
  return { isHttp: true, payload: payload || {}, ip: ip, method: String(e.httpMethod || 'POST').toUpperCase() };
}

/** 轻量哈希（不落原始 IP，减少个人信息留存；与 ai_gen 同算法）。 */
function hashId(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 北京时间自然日（云函数跑在 UTC，必须手动 +8，否则 8:00 前会算到前一天）。 */
function bjDay() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 取件码字母表：去掉 0/O/1/I/L 等易混字符，方便用户口头报、手抄
const CODE_ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function makeCode(len) {
  const n = len || 6;
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += CODE_ABC[bytes[i] % CODE_ABC.length];
  return out;
}

// ─────────────────────── 限流（设备桶 + IP 桶）───────────────────────

function h5Buckets(ip, deviceId) {
  const day = bjDay();
  const list = [];
  const d = String(deviceId || '').trim();
  if (d) list.push({ id: day + '_d_' + hashId(d), kind: 'device' });
  if (ip) list.push({ id: day + '_i_' + hashId(ip), kind: 'ip' });
  return list;
}

/** 先统一读、再统一写 —— 避免"第一个桶加过了、第二个桶才发现满"造成的白扣。 */
async function takeQuota(ip, deviceId) {
  const buckets = h5Buckets(ip, deviceId);
  if (!buckets.length) return { ok: false, reason: 'noid' };
  const db = cloud.database();
  const _ = db.command;
  const cur = [];
  for (const b of buckets) {
    const r = await db.collection(USAGE).doc(b.id).get().catch(() => ({ data: null }));
    cur.push((r && r.data && typeof r.data.n === 'number') ? r.data.n : 0);
  }
  for (let i = 0; i < buckets.length; i++) {
    if (cur[i] >= H5_REQ_DAILY) return { ok: false, reason: 'limit', used: cur[i], limit: H5_REQ_DAILY };
  }
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const ref = db.collection(USAGE).doc(b.id);
    if (cur[i] > 0) {
      await ref.update({ data: { n: _.inc(1), updateTime: db.serverDate() } }).catch(() => {});
    } else {
      await ref.set({
        data: { day: bjDay(), kind: b.kind, n: 1, createTime: db.serverDate(), updateTime: db.serverDate() }
      }).catch(() => {});
    }
  }
  return { ok: true };
}

/** 落库失败或校验后置失败时退还（别让服务端故障吃掉用户的提交机会）。 */
async function releaseQuota(ip, deviceId) {
  const db = cloud.database();
  const _ = db.command;
  for (const b of h5Buckets(ip, deviceId)) {
    await db.collection(USAGE).doc(b.id).update({ data: { n: _.inc(-1), updateTime: db.serverDate() } })
      .catch(() => {});
  }
}

// ─────────────────────── 飞书通知 ───────────────────────

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
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: 'POST', headers: headers
    }, (res) => {
      // ⚠️ Buffer 累积后统一 utf8 解码，避免多字节汉字被分片截断成乱码
      const chunks = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8')));
      res.on('end', () => {
        const full = Buffer.concat(chunks).toString('utf8');
        let j = null;
        try { j = JSON.parse(full); } catch (e) { /* 非 JSON，看 body */ }
        const code = j ? (j.code !== undefined ? j.code : j.StatusCode) : undefined;
        resolve({
          ok: res.statusCode === 200 && code === 0,
          status: res.statusCode, body: String(full).slice(0, 300), json: j
        });
      });
    });
    req.on('error', (e) => resolve({ ok: false, err: String((e && e.message) || e) }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, err: 'timeout ' + timeoutMs + 'ms' }); });
    req.write(payload);
    req.end();
  });
}

let tokenCache = { token: '', expireAt: 0 };
async function getTenantToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expireAt > now) return tokenCache.token;
  const r = await postJson(FEISHU_API + '/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }, NOTIFY_TIMEOUT_MS);
  const tk = r.json && r.json.tenant_access_token;
  if (!tk) throw new Error('取 tenant_access_token 失败：' + (r.err || r.body || ('HTTP ' + r.status)));
  const expire = Number(r.json.expire) || 7200;
  tokenCache = { token: tk, expireAt: now + Math.max(60, expire - 300) * 1000 };
  return tk;
}

/** 线索很短（梗概 ≤1500 字），用纯文本一条发完即可，不做 custom_request 那套富文本拆条。 */
function leadText(o) {
  const L = [
    '🆕 H5 定制线索（未付款，收需求）',
    '取件码：' + o.pickupCode,
    '档位：' + (PRODUCTS[o.productId] || o.productId),
    '篇幅：' + (EPISODES[o.episodes] || o.episodes || '未填'),
    '邮箱：' + o.email,
    '微信：' + (o.wechat || '（未填）'),
    '梗概 ' + String(o.story || '').length + ' 字' + (o.note ? '，补充 ' + String(o.note).length + ' 字' : '')
  ];
  if (o.from) L.push('来源：' + o.from);
  L.push('');
  L.push('── 故事梗概 ──');
  L.push(String(o.story || ''));
  if (o.note) { L.push(''); L.push('── 补充说明 ──'); L.push(String(o.note)); }
  L.push('');
  L.push('※ 客户下单后会带同一个邮箱，按邮箱把线索与订单对上。');
  return L.join('\n');
}

/** 推一条线索。返回 {ok, err?}；**永不抛异常**（落库优先，绝不能因推送失败丢线索）。 */
async function notifyFeishu(o) {
  if (!HAS_APP_BOT) return { ok: false, err: '未配置通知通道' };
  try {
    const token = await getTenantToken();
    const r = await postJson(FEISHU_API + '/im/v1/messages?receive_id_type=chat_id', {
      receive_id: FEISHU_CHAT_ID,
      msg_type: 'text',
      content: JSON.stringify({ text: leadText(o) })
    }, NOTIFY_TIMEOUT_MS, { Authorization: 'Bearer ' + token });
    return { ok: !!r.ok, err: r.ok ? '' : (r.err || r.body || ('HTTP ' + r.status)) };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
}

// ─────────────────────── 主入口 ───────────────────────

exports.main = async (event) => {
  const ctx = parseH5Event(event);
  if (ctx.isHttp && ctx.method === 'OPTIONS') return jsonOut({ ok: true });   // CORS 预检
  if (ctx.isHttp && ctx.method !== 'POST') return jsonOut({ ok: false, err: '只接受 POST' }, 405);

  const p = ctx.payload || {};
  const action = String(p.action || 'submit');

  // 通知链路自检：配好环境变量后调一次，确认能推、出网通
  if (action === 'test_notify') {
    const r = await notifyFeishu({
      pickupCode: 'TEST', productId: 'undecided', episodes: 'undecided',
      email: '(自检，非真实线索)', wechat: '', from: '自检',
      story: '这是一条测试推送，用于验证「H5 需求 → 飞书群」链路。收到即表示配置成功。', note: ''
    });
    return jsonOut({ ok: !!r.ok, configured: HAS_APP_BOT, err: r.err || '' });
  }

  if (action !== 'submit') return jsonOut({ ok: false, err: '未知的 action' });

  // ── 校验（全部服务端做，前端校验只是体验，不是防线）──
  const productId = String(p.productId || 'undecided').trim();
  const episodes = String(p.episodes || 'undecided').trim();
  const email = String(p.email || '').trim();
  const wechat = String(p.wechat || '').trim().slice(0, WECHAT_MAX);
  const story = String(p.story || '').trim();
  const note = String(p.note || '').trim().slice(0, NOTE_MAX);
  const from = String(p.from || '').trim().slice(0, FROM_MAX);
  const deviceId = String(p.deviceId || '').trim();

  if (!PRODUCTS[productId]) return jsonOut({ ok: false, err: '档位取值不合法' });
  if (!EPISODES[episodes]) return jsonOut({ ok: false, err: '篇幅取值不合法' });
  if (!EMAIL_RE.test(email)) return jsonOut({ ok: false, err: '邮箱格式不正确，请检查后重试' });
  if (story.length < STORY_MIN) return jsonOut({ ok: false, err: '故事梗概太短（至少 ' + STORY_MIN + ' 字）' });
  if (story.length > STORY_MAX) return jsonOut({ ok: false, err: '故事梗概过长（' + story.length + ' 字），请精简到 ' + STORY_MAX + ' 字以内' });

  const db = cloud.database();

  // ── 幂等：同设备 + 同内容 10 分钟内重复提交 → 返回原取件码（前端重试/双击不该产生两条线索）──
  // 只在拿到设备标识时才做：设备标识为空的话，这条查询会跨用户命中，反而错并线索。
  const storyHash = hashId(deviceId + '|' + story);
  if (deviceId) {
    const existed = await db.collection(COLLECTION)
      .where({ storyHash, deviceId })
      .orderBy('createTime', 'desc').limit(1).get().catch(() => ({ data: [] }));
    const prev = (existed.data || [])[0];
    if (prev && prev.createTime) {
      const t = new Date(prev.createTime).getTime();
      if (t && (Date.now() - t) < DEDUP_WINDOW_MS) {
        return jsonOut({ ok: true, pickupCode: prev.pickupCode, dedup: true });
      }
    }
  }

  // ── 限流（放在幂等之后：自己的重试不该吃额度）──
  const quota = await takeQuota(ctx.ip, deviceId);
  if (!quota.ok) {
    if (quota.reason === 'noid') {
      return jsonOut({ ok: false, err: '请求缺少必要的设备标识，请刷新页面后重试' });
    }
    return jsonOut({
      ok: false,
      err: '今天提交得有点多（上限 ' + H5_REQ_DAILY + ' 次）。请直接进小程序联系我们，或明天再试。'
    }, 429);
  }

  const pickupCode = makeCode(6);
  let add;
  try {
    add = await db.collection(COLLECTION).add({
      data: {
        pickupCode,
        productId,
        tier: PRODUCTS[productId],
        episodes,
        episodesText: EPISODES[episodes],
        email,
        wechat,
        story,
        note,
        storyHash,
        from,
        deviceId,
        ipHash: ctx.ip ? hashId(ctx.ip) : '',   // 只留哈希，不留原始 IP
        source: 'h5',
        paid: false,                             // 未付款 —— 与 custom_comic_requests 的已付款单区分
        status: 'lead',                          // lead → contacted → paid → delivered（运营侧流转）
        notify: '待推送',
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
  } catch (e) {
    await releaseQuota(ctx.ip, deviceId);      // 落库失败 → 退还额度，用户可重试
    return jsonOut({ ok: false, err: '提交失败，请稍后重试' });
  }

  // 落库成功后才推送（顺序不可颠倒：推送失败不能导致丢线索）。
  const res = await notifyFeishu({ pickupCode, productId, episodes, email, wechat, story, note, from })
    .catch((e) => ({ ok: false, err: String((e && e.message) || e) }));
  const notifyText = !HAS_APP_BOT ? '未配置通知通道（仅落库）'
    : (res.ok ? '已推送飞书' : ('推送失败：' + res.err));
  await db.collection(COLLECTION).doc(add._id)
    .update({ data: { notify: notifyText, notifyTime: db.serverDate() } })
    .catch(() => { /* 记不上不影响主流程 */ });

  return jsonOut({ ok: true, pickupCode, notified: !!res.ok, notify: notifyText });
};
