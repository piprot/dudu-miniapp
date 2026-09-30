/* ─────────────────────────────────────────────────────────────
 * h5/assets/app.js —— 公众号 H5 版交互
 * ─────────────────────────────────────────────────────────────
 * 与小程序 pages/gen/gen.js 的**同一套交互**，差异只有两处（都是有意的）：
 *   ① 没有积分体系 → 改为「今日剩余免费次数」，额度由服务端按 设备标识 + IP 计算，
 *      前端只展示、不算数（前端改了也没用，真正的判定在 ai_gen 云函数里）。
 *   ② 没有图片上传 → H5 拿不到云存储写权限，硬做只会造出一堆失败态；
 *      图片类能力（小程序「卡片制作」本地完成）不在此页；本页专注文字 / 链接 → 朋友圈文案。
 *
 * 零依赖、零构建。全部 DOM 用 createElement + textContent 构建 ——
 * 文案是模型生成的，任何情况都不能当 HTML 解析（防注入）。
 * ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var K = window.H5KINDS;
  var CFG = window.H5_CONFIG || {};
  var API = String(CFG.api || '').trim();

  var DEVICE_KEY = 'dudu_h5_device_id';
  var REQ_TIMEOUT_MS = 65000;   // 云函数侧单次 LLM 请求上限 40s，前端留足余量

  // ── 状态 ──
  var S = {
    kind: K.DEFAULT_KIND,
    inputMode: 'write',        // 'write' 自写素材 | 'url' 粘贴文章链接
    form: {},
    note: '',
    url: '',
    feedback: '',
    moments: [],
    selected: 0,
    busy: false,
    quota: null                // { used, limit, left }
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
    t.textContent = msg;
    t.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }

  function setErr(msg) {
    var b = $('errBox');
    if (!msg) { b.hidden = true; b.textContent = ''; return; }
    b.hidden = false;
    b.textContent = msg;
  }

  // ── 设备标识：仅用于「每天免费次数」分桶，不含任何个人信息 ──
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
  // 渲染
  // ══════════════════════════════════════════════════════════

  function renderKinds() {
    var box = $('kindGrid');
    box.innerHTML = '';
    K.KINDS.forEach(function (k) {
      var on = (S.inputMode === 'write' && S.kind === k.id);
      var b = el('button', 'kind-chip' + (on ? ' on' : ''));
      b.type = 'button';
      var top = el('div', 'kc-top');
      top.appendChild(el('span', 'kc-icon', k.icon));
      top.appendChild(el('span', 'kc-label', k.label));
      b.appendChild(top);
      b.appendChild(el('div', 'kc-desc', k.desc));
      b.addEventListener('click', function () { onSelectKind(k.id); });
      box.appendChild(b);
    });
    // 第 6 个入口：粘贴文章链接（与 5 类并行，不是"第 4 步"）
    var link = el('button', 'kind-chip link' + (S.inputMode === 'url' ? ' on' : ''));
    link.type = 'button';
    link.appendChild(el('span', 'kc-icon', '🔗'));
    link.appendChild(el('span', 'kc-label', '粘贴文章链接'));
    link.appendChild(el('span', 'kc-desc', S.inputMode === 'url' ? '已选：按下面选的调性改写' : '读正文，按调性改写'));
    link.addEventListener('click', onSelectUrl);
    box.appendChild(link);
  }

  // 字段区：只在「切类型 / 切模式」时重建。
  // 输入过程中**绝不重建** —— 重建会让输入框失焦，中文输入法直接被打断。
  function renderFields() {
    var box = $('fields');
    box.innerHTML = '';
    var fields = K.withNo(K.FIELDS[S.kind] || []);
    fields.forEach(function (f) {
      var wrap = el('div', 'field');
      var lab = el('label', 'field-label');
      lab.appendChild(el('span', 'field-no', String(f.no)));
      lab.appendChild(document.createTextNode(f.label));
      if (f.required) lab.appendChild(el('span', 'field-req', '*'));
      lab.setAttribute('for', 'fld_' + f.key);
      wrap.appendChild(lab);

      var input;
      if (f.type === 'textarea') {
        input = el('textarea', 'textarea');
        input.rows = 3;
      } else {
        input = el('input', 'input');
        input.type = 'text';
        input.autocomplete = 'off';
      }
      input.id = 'fld_' + f.key;
      input.maxLength = f.max || 500;
      input.placeholder = f.placeholder || '';
      input.value = S.form[f.key] || '';
      input.addEventListener('input', function () {
        S.form[f.key] = input.value;
        updateMeta();
      });
      wrap.appendChild(input);
      box.appendChild(wrap);
    });
  }

  function renderUrlArea() {
    $('urlInput').value = S.url || '';
    var tone = currentKind();
    $('urlStruct').textContent = '读取文章正文 → 按「' + tone.label + '」调性改写 3 条朋友圈文案';
    var box = $('toneChips');
    box.innerHTML = '';
    K.KINDS.forEach(function (k) {
      var b = el('button', 'tone-chip' + (S.kind === k.id ? ' on' : ''), k.icon + ' ' + k.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (S.kind === k.id) return;
        S.kind = k.id;
        renderUrlArea();
        renderKinds();
        updateMeta();
      });
      box.appendChild(b);
    });
  }

  function currentKind() {
    return K.KINDS.filter(function (k) { return k.id === S.kind; })[0] || K.KINDS[0];
  }

  function countForm() {
    var fields = K.FIELDS[S.kind] || [];
    var n = 0;
    fields.forEach(function (f) { n += String(S.form[f.key] || '').length; });
    return n;
  }

  function canSubmit() {
    var hasText = countForm() > 0 || String(S.note || '').trim().length > 0;
    var hasUrl = String(S.url || '').trim().length > 0;
    return hasText || hasUrl;
  }

  // 计数 / 字数提示 / 按钮与步骤条状态（输入时高频调用 → 只改文本，不动 DOM 结构）
  function updateMeta() {
    var len = countForm();
    $('lenNum').textContent = String(len);
    $('outLen').textContent = K.outLenOf(S.kind, len);
    $('lenTip').textContent = K.lenTipOf(S.kind);

    var ready = canSubmit();
    $('step2').className = 'step-node ' + (ready ? 'done' : 'now');
    $('line2').className = 'step-line' + (ready ? ' on' : '');
    $('step3').className = 'step-node' + (ready ? ' now' : '');
    $('btnGen').disabled = !ready || S.busy;
    var btn = $('btnGen');
    btn.textContent = S.busy ? '正在写…'
      : (ready ? '✨ 生成 3 条朋友圈文案' : '先填点素材，或贴个链接');
  }

  function renderQuota() {
    var q = S.quota;
    $('quotaNum').textContent = q ? String(Math.max(0, q.left)) + ' / ' + q.limit : '—';
    $('quotaHint').textContent = q ? '每天 ' + q.limit + ' 次 · 免费' : '每天 5 次 · 免费';
  }

  function renderResult() {
    var has = S.moments.length > 0;
    $('resultCard').hidden = !has;
    if (!has) return;
    var box = $('moments');
    box.innerHTML = '';
    S.moments.forEach(function (m, i) {
      var on = (i === S.selected);
      var d = el('div', 'moment' + (on ? ' on' : ''));
      var head = el('div', 'moment-head');
      head.appendChild(el('span', 'moment-no', '方案 ' + (i + 1)));
      head.appendChild(el('span', 'moment-pick', on ? '已选中' : '选这条'));
      d.appendChild(head);
      // 文案用 textContent：模型输出不可信，绝不走 innerHTML
      d.appendChild(el('div', 'moment-text', m));
      d.appendChild(el('div', 'moment-foot', '以上内容由 AI 生成，请核对后使用'));
      d.addEventListener('click', function () {
        S.selected = i;
        renderResult();
      });
      box.appendChild(d);
    });
  }

  function renderAll() {
    renderKinds();
    renderFields();
    renderUrlArea();
    $('writeArea').hidden = (S.inputMode !== 'write');
    $('urlArea').hidden = (S.inputMode !== 'url');
    var tone = currentKind();
    $('selKind').textContent = tone.label;
    $('selDesc').textContent = tone.desc;
    $('structHint').textContent = '这条会这样写：' + (K.KIND_STRUCT[S.kind] || '');
    updateMeta();
    renderQuota();
  }

  // ══════════════════════════════════════════════════════════
  // 交互
  // ══════════════════════════════════════════════════════════

  function onSelectKind(id) {
    if (S.inputMode === 'write' && id === S.kind) return;
    S.inputMode = 'write';
    S.kind = id;
    S.form = {};          // 换了类型，字段结构全变，旧值留着只会串味
    S.url = '';
    setErr('');
    renderAll();
  }

  function onSelectUrl() {
    if (S.inputMode === 'url') return;
    S.inputMode = 'url';
    setErr('');
    renderAll();
    setTimeout(function () { try { $('urlInput').focus(); } catch (e) {} }, 60);
  }

  function onPaste() {
    function fallback() { toast('浏览器不允许读取剪贴板，请手动粘贴'); }
    if (!navigator.clipboard || !navigator.clipboard.readText) return fallback();
    navigator.clipboard.readText().then(function (t) {
      var v = String(t || '').trim();
      if (!v) { toast('剪贴板里没有内容'); return; }
      S.url = v;
      $('urlInput').value = v;
      updateMeta();
      toast('已粘贴');
    }).catch(fallback);
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
      toast(ok ? tip : '复制受限，请长按文案手动复制');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(tip); }).catch(legacy);
    } else {
      legacy();
    }
  }

  // ── 请求（两种 Content-Type 各试一次）──
  // 用 application/json 最标准；但部分网关会在预检阶段直接拒掉跨域 JSON 请求，
  // 所以失败后自动退回 text/plain（浏览器视为「简单请求」，不触发预检）。
  // 服务端两边都能解析：它对 body 只做 JSON.parse，不看 Content-Type。
  function post(payload) {
    var body = JSON.stringify(payload);
    function once(ctype) {
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, REQ_TIMEOUT_MS) : null;
      return fetch(API, {
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
      // 已经被服务端「听懂并拒绝」的业务错误（有 ok 字段）不该重试
      if (e1 && /服务返回了非预期内容/.test(String(e1.message))) throw e1;
      return once('text/plain;charset=UTF-8');
    });
  }

  function buildPayload(isRevise) {
    var p = { channel: 'h5', deviceId: deviceId(), kind: S.kind };
    if (S.inputMode === 'url') {
      p.url = String(S.url || '').trim();
      var extra = String(S.note || '').trim();
      if (extra) p.prompt = extra;
    } else {
      p.prompt = K.buildPrompt(S.kind, S.form, S.note);
    }
    if (isRevise) {
      p.feedback = String(S.feedback || '').trim();
      p.previous = S.moments;
    }
    return p;
  }

  function setBusy(on, txt) {
    S.busy = on;
    $('loadingCard').hidden = !on;
    if (txt) $('loadingTxt').textContent = txt;
    updateMeta();
    $('btnRevise').disabled = on;
    $('btnCopyOne').disabled = on;
    $('btnCopyAll').disabled = on;
  }

  function generate(isRevise) {
    if (S.busy) return;
    setErr('');

    if (!API) { setErr('页面还没配置服务地址（H5_CONFIG.api），暂时无法生成。'); return; }

    if (isRevise) {
      if (!String(S.feedback || '').trim()) { setErr('请先告诉我想改哪里，框里写一句也行。'); return; }
    } else if (!canSubmit()) {
      setErr(S.inputMode === 'url' ? '请先粘贴文章链接' : '请先填点素材，或贴个文章链接');
      return;
    }
    if (S.inputMode === 'url' && !String(S.url || '').trim()) {
      setErr('请先粘贴文章链接'); return;
    }

    setBusy(true, isRevise ? '正在换一批，大约 10-25 秒…' : '正在写文案，大约 10-25 秒…');
    post(buildPayload(isRevise)).then(function (res) {
      if (res && typeof res.quota === 'object' && res.quota) S.quota = res.quota;
      renderQuota();
      if (!res || !res.ok) {
        setBusy(false);
        setErr((res && res.err) || '生成失败，请稍后重试');
        return;
      }
      var opts = Array.isArray(res.options) ? res.options : [];
      if (!opts.length) { setBusy(false); setErr('这次没生成出内容，请换个说法再试一次'); return; }
      S.moments = opts;
      S.selected = 0;
      setBusy(false);
      renderResult();
      $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) {
      setBusy(false);
      var msg = String((e && e.message) || e || '');
      if (/abort/i.test(msg)) setErr('等待超时了。文案较长时会更慢，可以缩短素材后重试。');
      else if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) setErr('连不上服务（可能是网络问题，或 H5 的接口地址还没配置好）。');
      else setErr('生成失败：' + msg);
    });
  }

  // ══════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════
  function init() {
    if (!K) { document.body.appendChild(el('div', 'err', '页面资源加载失败，请刷新重试')); return; }

    $('btnGen').addEventListener('click', function () { generate(false); });
    $('btnRevise').addEventListener('click', function () { generate(true); });
    $('btnPaste').addEventListener('click', onPaste);
    $('urlInput').addEventListener('input', function () {
      S.url = $('urlInput').value;
      updateMeta();
    });
    $('noteInput').addEventListener('input', function () {
      S.note = $('noteInput').value;
      updateMeta();
    });
    $('feedbackInput').addEventListener('input', function () {
      S.feedback = $('feedbackInput').value;
    });
    $('btnCopyOne').addEventListener('click', function () {
      var m = S.moments[S.selected];
      if (m) copy(m, '已复制，去朋友圈粘贴吧');
    });
    $('btnCopyAll').addEventListener('click', function () {
      if (!S.moments.length) return;
      copy(S.moments.join('\n\n——\n\n'), '已复制全部 3 条');
    });

    // 深链参数：?k=<类型> 直接选中类型、?mode=url 直接进「粘贴文章链接」、?note=<补充>
    // 用途是公众号侧的不同入口指向不同默认值（菜单挂「成交型」、某篇讲故事的推文挂 story），
    // 顺带也让本地做视觉验证不需要在浏览器里手点。
    try {
      var qs = {};
      String(window.location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
        if (!kv) return;
        var eq = kv.indexOf('=');
        var kk = decodeURIComponent(eq < 0 ? kv : kv.slice(0, eq));
        var vv = eq < 0 ? '' : decodeURIComponent(kv.slice(eq + 1));
        if (kk) qs[kk] = vv;
      });
      if (qs.k && K.KINDS.some(function (x) { return x.id === qs.k; })) S.kind = qs.k;
      if (qs.mode === 'url') S.inputMode = 'url';
      if (qs.note && !S.note) { S.note = qs.note; $('noteInput').value = qs.note; }
    } catch (e) { /* 参数不合法就一律用默认值，绝不让它挡住主流程 */ }

    // 额度未知时先显示占位；首次生成后由服务端回传真实值
    S.quota = null;
    renderAll();

    // 可选：挂了小程序码就展示（没配就保持隐藏，不留破图）
    if (CFG.mpQr) {
      var f = $('foot');
      var img = el('img');
      img.src = CFG.mpQr;
      img.alt = (CFG.mpName || '小程序') + ' 小程序码';
      img.style.cssText = 'width:150px;height:150px;border-radius:10px;margin:12px auto 4px;display:block';
      f.insertBefore(img, f.firstChild);
      f.insertBefore(el('div', null, '想做图文卡片 / 每日日签，或看真人定制成品？长按识别进小程序'), f.firstChild);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
