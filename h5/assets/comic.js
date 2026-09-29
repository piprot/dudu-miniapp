/* ─────────────────────────────────────────────────────────────
 * h5/assets/comic.js —— 定制画面感内容 · 样板间交互
 * ─────────────────────────────────────────────────────────────
 * 这个页面只做三件事：
 *   ① 把成品示例按**真实交付版面**渲染出来（让客户看到他会拿到什么）
 *   ② 说明两档价格与交付流程
 *   ③ 收下需求并落库（云函数 h5_request），给出取件码
 *
 * ⛔ 合规红线（勿改）：本页**绝不**提供"输入故事→立刻出图"的自助生成。
 *    自助文生图属于深度合成服务，须以企业主体做算法备案；而我们只售卖
 *    「已完成的成品内容」，性质是卖内容而非提供合成服务能力。一旦在这里
 *    加一个"生成"按钮并接上出图模型，性质就变了 —— 所以前端连生成接口
 *    （H5_CONFIG.api / ai_gen）都不引用，只引用 apiReq（h5_request，仅落库）。
 *
 * 零依赖、零构建。全部 DOM 用 createElement + textContent 构建 ——
 * 故事梗概是用户输入，任何情况都不能当 HTML 解析（防注入）。
 * ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var CFG = window.H5_CONFIG || {};
  var REQ = String(CFG.apiReq || '').trim();
  var MP_NAME = CFG.mpName || '小程序';
  var SAMPLE = window.H5_SAMPLE || null;

  var STORY_MIN = 20;
  var STORY_MAX = 1500;
  var NOTE_MAX = 300;
  var EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  var DEVICE_KEY = 'dudu_h5_device_id';
  var REQ_TIMEOUT_MS = 25000;

  var TIERS = [
    { id: 'comic_web', label: '网页版 ¥88' },
    { id: 'comic_pdf', label: 'PDF 版 ¥66' },
    { id: 'undecided', label: '还没定' }
  ];
  var LENS = [
    { id: '8', label: '8 集（完整 · 约 54 格）' },
    { id: '4', label: '4 集（精简 · 约 24 格）' },
    { id: 'undecided', label: '还没定' }
  ];

  var S = {
    productId: 'comic_web',
    episodes: '8',
    story: '',
    email: '',
    wechat: '',
    note: '',
    busy: false,
    pickupCode: ''
  };

  // ── DOM 快捷方式 ──
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }

  function setErr(msg) {
    var b = $('errBox');
    if (!b) return;
    if (!msg) { b.hidden = true; b.textContent = ''; return; }
    b.hidden = false;
    b.textContent = msg;
  }

  // ── 设备标识：仅用于「限制重复提交」分桶，不含任何个人信息 ──
  function deviceId() {
    var id = '';
    try { id = window.localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { id = ''; }
    if (!id) {
      var rnd = '';
      try {
        var buf = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(buf);
        for (var i = 0; i < buf.length; i++) rnd += ('0' + buf[i].toString(16)).slice(-2);
      } catch (e) {
        rnd = String(Date.now()) + Math.random().toString(36).slice(2);
      }
      id = 'h5_' + rnd;
      try { window.localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* 隐私模式：退化到本次会话内存 */ }
    }
    return id;
  }

  // ══════════════════════════════════════════════════════════
  // ① 封面 + 成品版面渲染
  // ══════════════════════════════════════════════════════════

  function renderCover() {
    var box = $('cover');
    if (!box) return;
    var c = (SAMPLE && SAMPLE.cover) || {};
    box.innerHTML = '';
    box.appendChild(el('h1', null, c.title || '成品示例'));
    box.appendChild(el('div', 'cv-div'));
    if (c.subtitle) box.appendChild(el('p', 'cv-sub', c.subtitle));
    if (c.author) box.appendChild(el('p', 'cv-author', c.author));

    var meta = $('coverMeta');
    if (meta) {
      meta.innerHTML = '';
      if (SAMPLE) {
        meta.appendChild(el('span', null, '全本 ' + SAMPLE.totalEpisodes + ' 集 · ' + SAMPLE.totalPanels + ' 格'));
      }
      meta.appendChild(el('span', null, '水彩写实风'));
      meta.appendChild(el('span', null, '可在线翻阅 · 可打印'));
      if (SAMPLE) meta.appendChild(el('span', null, '免费试读前 ' + SAMPLE.freeEpisodes + ' 集'));
    }
  }

  /** 交付物的类名（bubble.thought.pos-tr）→ 样板间的类名（sx-bubble thought sx-pos-tr）。 */
  function mapCls(raw, base) {
    var out = [base];
    String(raw || '').split('.').forEach(function (c) {
      c = String(c).trim();
      if (!c || c === 'bubble' || c === 'sfx') return;
      out.push(c.indexOf('pos-') === 0 ? 'sx-' + c : c);
    });
    return out.join(' ');
  }

  function renderPanel(p, eager) {
    var cell = el('div', 'sx-cell');
    var panel = el('div', 'sx-panel');

    var img = el('img');
    img.src = p.art;
    img.alt = p.alt || '';
    img.width = 640;
    img.height = 640;
    img.loading = eager ? 'eager' : 'lazy';
    img.decoding = 'async';
    panel.appendChild(img);

    (p.bubbles || []).forEach(function (b) {
      panel.appendChild(el('div', mapCls(b.cls, 'sx-bubble'), b.text));
    });
    (p.sfxs || []).forEach(function (s) {
      panel.appendChild(el('div', mapCls(s.cls, 'sx-sfx'), s.text));
    });

    cell.appendChild(panel);
    // 旁白条即使为空也保留：交付物的格高是齐的，缺一条会让宫格错位
    cell.appendChild(el('div', 'sx-narr', p.narration || ''));
    return cell;
  }

  function renderSample() {
    var host = $('sampleHost');
    if (!host) return;
    host.innerHTML = '';
    if (!SAMPLE || !SAMPLE.episodes || !SAMPLE.episodes.length) {
      host.appendChild(el('div', 'err', '示例加载失败，请刷新重试。'));
      return;
    }

    var eagerBudget = 6;   // 首屏 6 格不等懒加载，其余懒加载省流量
    var shown = 0;

    SAMPLE.episodes.forEach(function (ep) {
      if (ep.locked) return;
      var head = el('div', 'sx-ep');
      head.appendChild(el('span', 'sx-num', ep.num));
      head.appendChild(el('h2', null, ep.name));
      host.appendChild(head);

      (ep.pages || []).forEach(function (pg) {
        var page = el('div', 'sx-page');
        if (pg.label) page.appendChild(el('div', 'sx-label', pg.label));
        // 2x2 / 2x3 都只用 2 列 + 自动行 —— 行数由格子数量自然决定，
        // 不需要两套 grid 类（交付物分两套只是它的历史写法）。
        var grid = el('div', 'sx-grid');
        (pg.panels || []).forEach(function (p) {
          shown++;
          grid.appendChild(renderPanel(p, shown <= eagerBudget));
        });
        page.appendChild(grid);
        host.appendChild(page);
      });
    });

    var tag = el('div', 'sx-taghost');
    tag.appendChild(el('span', 'sx-tag',
      '以下为真实交付形态（' + (SAMPLE.freeEpisodes) + ' 集 · 一字未改）'));
    host.appendChild(tag);
  }

  function renderLockList() {
    var box = $('lockList');
    if (!box || !SAMPLE) return;
    box.innerHTML = '';
    var locked = (SAMPLE.episodes || []).filter(function (e) { return e.locked; });
    if (!locked.length) return;
    locked.forEach(function (ep) {
      var rows = ep.pages || [];
      var cells = rows.reduce(function (n, p) { return n + (p.panels || []).length; }, 0);
      var row = el('div', 'lock-row');
      row.appendChild(el('span', 'lk-i', '🔒'));
      row.appendChild(el('span', 'lk-n', ep.num));
      row.appendChild(el('span', 'lk-m', ep.name));
      row.appendChild(el('span', 'lk-c', cells + ' 格'));
      box.appendChild(row);
    });
  }

  // ══════════════════════════════════════════════════════════
  // ② 小程序码
  // ══════════════════════════════════════════════════════════

  function qrReady() { return !!String(CFG.mpQr || '').trim(); }

  /** 进小程序的入口说法：配了码就说"长按"，没配就说"搜索"（别让文案指向不存在的东西）。 */
  function mpEntryText() {
    return qrReady() ? ('长按识别小程序码，进「' + MP_NAME + '」') : ('在微信里搜索「' + MP_NAME + '」进入小程序');
  }

  function renderQr(host, cap) {
    if (!host) return;
    host.innerHTML = '';
    var qr = String(CFG.mpQr || '').trim();
    if (!qr) {
      // ⚠️ 这段文案是**给客户看的**，绝不能出现 config.js / 目录路径之类的工程信息。
      //    配码的提示只在本地调试时显示（见下），线上客户看不到。
      host.appendChild(el('div', 'qr-fallback', mpEntryText() + '。'));
      if (/^(localhost|127\.0\.0\.1)$/.test(String(location.hostname || ''))) {
        host.appendChild(el('div', 'qr-devhit',
          '[本地调试] 小程序码未配置：图片放 h5/assets/ 下，填 config.js 的 mpQr。'));
      }
      return;
    }
    var img = el('img');
    img.src = qr;
    img.alt = MP_NAME + ' 小程序码';
    host.appendChild(img);
    host.appendChild(el('div', 'qr-cap', cap || ('长按识别，进「' + MP_NAME + '」')));
  }

  // ══════════════════════════════════════════════════════════
  // ③ 表单
  // ══════════════════════════════════════════════════════════

  function renderChips(host, list, cur, onPick) {
    if (!host) return;
    host.innerHTML = '';
    list.forEach(function (it) {
      var b = el('button', 'pick' + (it.id === cur ? ' on' : ''), it.label);
      b.type = 'button';
      b.addEventListener('click', function () { onPick(it.id); });
      host.appendChild(b);
    });
  }

  function renderForm() {
    renderChips($('tierPick'), TIERS, S.productId, function (id) {
      S.productId = id;
      renderForm();
      renderTierCards();
    });
    renderChips($('lenPick'), LENS, S.episodes, function (id) {
      S.episodes = id;
      renderForm();
    });
    updateMeta();
  }

  /** 价格卡跟着选中的档位高亮（表单与价格区是同一个人写的一处状态） */
  function renderTierCards() {
    var w = $('tierWeb'), p = $('tierPdf');
    if (w) w.className = 'tier' + (S.productId === 'comic_web' ? ' on' : '');
    if (p) p.className = 'tier' + (S.productId === 'comic_pdf' ? ' on' : '');
  }

  function updateMeta() {
    var n = String(S.story || '').length;
    var l = $('storyLen');
    if (l) l.textContent = String(n);
    var okStory = n >= STORY_MIN && n <= STORY_MAX;
    var okMail = EMAIL_RE.test(String(S.email || '').trim());
    var btn = $('btnSubmit');
    if (!btn) return;
    if (S.busy) { btn.disabled = true; btn.textContent = '正在提交…'; return; }
    btn.disabled = false;
    if (!okStory) btn.textContent = '还差故事梗概（≥' + STORY_MIN + ' 字）';
    else if (!okMail) btn.textContent = '还差你的邮箱';
    else btn.textContent = '提交需求';
  }

  function validate() {
    var story = String(S.story || '').trim();
    var email = String(S.email || '').trim();
    if (story.length < STORY_MIN) return '故事梗概写 ' + STORY_MIN + ' 字以上吧，太短了不好判断怎么画。';
    if (story.length > STORY_MAX) return '故事梗概有点长（' + story.length + ' 字），精简到 ' + STORY_MAX + ' 字以内再提交。';
    if (!email) return '填一下邮箱吧，成品要发到这里。';
    if (!EMAIL_RE.test(email)) return '邮箱格式看起来不对，检查一下再提交。';
    if (String(S.note || '').length > NOTE_MAX) return '补充说明超过 ' + NOTE_MAX + ' 字了，精简一下。';
    return '';
  }

  // ── 把填的内容整理成一段可粘贴的文本（提交入口没配时也能用）──
  function requirementText() {
    var tier = TIERS.filter(function (x) { return x.id === S.productId; })[0];
    var len = LENS.filter(function (x) { return x.id === S.episodes; })[0];
    var lines = [
      '【定制画面感内容 · 需求】',
      '想要的档位：' + ((tier && tier.label) || '还没定'),
      '希望的篇幅：' + ((len && len.label) || '还没定'),
      '邮箱：' + String(S.email || '').trim()
    ];
    if (String(S.wechat || '').trim()) lines.push('微信号：' + String(S.wechat).trim());
    lines.push('');
    lines.push('故事大概讲什么：');
    lines.push(String(S.story || '').trim());
    if (String(S.note || '').trim()) {
      lines.push('');
      lines.push('补充说明：' + String(S.note).trim());
    }
    if (S.pickupCode) lines.push('', '取件码：' + S.pickupCode);
    return lines.join('\n');
  }

  function copy(text, tip) {
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? tip : '复制受限，请长按手动复制');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(tip); }).catch(legacy);
    } else {
      legacy();
    }
  }

  // ── 请求：主用 JSON，失败退回 text/plain（跨域预检被网关拒时的兜底）──
  function post(payload) {
    var body = JSON.stringify(payload);
    function once(ctype) {
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, REQ_TIMEOUT_MS) : null;
      return fetch(REQ, {
        method: 'POST',
        headers: { 'Content-Type': ctype },
        body: body,
        signal: ctl ? ctl.signal : undefined
      }).then(function (r) {
        if (timer) clearTimeout(timer);
        return r.text();
      }).then(function (t) {
        var o;
        try { o = JSON.parse(t); } catch (e) {
          throw new Error('服务返回了非预期内容（' + String(t || '').slice(0, 80) + '）');
        }
        return o;
      }).catch(function (e) {
        if (timer) clearTimeout(timer);
        throw e;
      });
    }
    return once('application/json').catch(function (e1) {
      if (e1 && /服务返回了非预期内容/.test(String(e1.message))) throw e1;
      return once('text/plain;charset=UTF-8');
    });
  }

  function showDone(code) {
    S.pickupCode = code || '';
    var c = $('pickupCode');
    if (c) c.textContent = code || '------';
    var done = $('doneCard');
    if (done) done.hidden = false;
    var req = $('reqCard');
    if (req) req.hidden = true;
    // 提交后把这处二维码收掉：完成卡自己带一个，同一屏出现两块是多余的
    var qb = $('qrBox');
    if (qb) qb.hidden = true;
    renderQr($('doneQr'), mpEntryText());
    var s1 = $('doneStep1');
    if (s1) s1.textContent = mpEntryText() + '，在定制页选档下单。';
    if (done) {
      try { done.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 老浏览器忽略 */ }
    }
  }

  function submit() {
    if (S.busy) return;
    setErr('');
    var bad = validate();
    if (bad) { setErr(bad); return; }

    if (!REQ) {
      // 提交入口还没配：**绝不伪造成功**，如实说明并给出可用的替代路径
      setErr('需求提交入口还没配置（h5/assets/config.js 的 apiReq）。'
        + '请长按下方小程序码，进「' + MP_NAME + '」的定制页填写；'
        + '也可以先点「复制我填的内容」，进去粘贴。');
      var qb = $('qrBox');
      if (qb) { try { qb.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }
      return;
    }

    S.busy = true;
    updateMeta();
    post({
      channel: 'h5',
      action: 'submit',
      deviceId: deviceId(),
      productId: S.productId,
      episodes: S.episodes,
      story: String(S.story || '').trim(),
      email: String(S.email || '').trim(),
      wechat: String(S.wechat || '').trim(),
      note: String(S.note || '').trim(),
      from: String(document.referrer || '').split('?')[0].slice(0, 200)
    }).then(function (res) {
      S.busy = false;
      updateMeta();
      if (!res || !res.ok) {
        setErr((res && res.err) || '提交失败，请稍后重试。');
        return;
      }
      showDone(res.pickupCode || '');
      toast('需求已收到');
    }).catch(function (e) {
      S.busy = false;
      updateMeta();
      var msg = String((e && e.message) || e || '');
      if (/abort/i.test(msg)) setErr('提交超时了，请检查网络后重试。');
      else if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        setErr('连不上服务（可能是网络问题，或提交入口还没配置好）。可以先点「复制我填的内容」，进小程序粘贴。');
      } else setErr('提交失败：' + msg);
    });
  }

  // ══════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════
  function init() {
    renderCover();
    renderSample();
    renderLockList();
    renderForm();
    renderTierCards();
    renderQr($('qrBox'));

    var bind = function (id, key) {
      var n = $(id);
      if (!n) return;
      n.addEventListener('input', function () {
        S[key] = n.value;
        updateMeta();
      });
    };
    bind('storyInput', 'story');
    bind('mailInput', 'email');
    bind('wxInput', 'wechat');
    bind('noteInput', 'note');

    var bs = $('btnSubmit');
    if (bs) bs.addEventListener('click', submit);

    var bc = $('btnCopyReq');
    if (bc) bc.addEventListener('click', function () {
      copy(requirementText(), '已复制，进小程序粘贴即可');
    });

    var bcc = $('btnCopyCode');
    if (bcc) bcc.addEventListener('click', function () {
      if (!S.pickupCode) { toast('还没有取件码'); return; }
      copy(S.pickupCode, '取件码已复制');
    });

    var bg = $('btnGoReq');
    if (bg) bg.addEventListener('click', function () {
      var c = $('reqCard');
      if (c) { try { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
