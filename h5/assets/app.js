/* ─────────────────────────────────────────────────────────────
 * h5/assets/app.js —— 朋友圈文案 · 纯本地模板版（B1 合规同构）
 * ─────────────────────────────────────────────────────────────
 * 2026-09-30 起本页**不再调用任何云端接口**：
 *   · 「套模板出文案」= assets/templates.js 的人工骨架 + {{key}} 字符串替换，
 *     与小程序 pages/gen（B1 纯本地版）同一套模板与清理规则。
 *   · 「排版优化」= assets/text_tools.js 的确定性规则（防折叠/加 emoji/分段）。
 *   · 因此没有 AI 标识、没有免费次数、没有设备指纹、没有任何网络请求。
 * 仍保留的能力：类型选择 / 引导字段 / 深链 ?k= / 复制 / 排版优化 / 小程序码导流。
 * 全部 DOM 用 createElement + textContent 构建 —— 用户输入绝不当 HTML 解析（防注入）。
 * 零依赖、零构建。
 * ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var K = window.H5KINDS;
  var T = window.H5_TEMPLATES;
  var TOOLS = window.H5_TOOLS;

  // ── 状态 ──
  var S = {
    mode: 'tpl',               // 'tpl' 套模板 | 'opt' 排版优化
    kind: K.DEFAULT_KIND,
    form: {},
    fields: [],
    moments: [],
    selected: 0,
    optRaw: '',
    optResult: '',
    optStats: { chars: 0, lines: 0, emojiCount: 0 },
    optMode: 'antiFold'
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

  // ══════════════════════════════════════════════════════════
  // 渲染
  // ══════════════════════════════════════════════════════════

  function renderKinds() {
    var box = $('kindGrid');
    box.innerHTML = '';
    K.KINDS.forEach(function (k) {
      var on = (S.kind === k.id);
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
  }

  // 字段区：只在「切类型 / 切模式」时重建 —— 输入过程绝不重建（防中文输入法被打断）。
  function renderFields() {
    var box = $('fields');
    box.innerHTML = '';
    var fields = K.withNo(K.FIELDS[S.kind] || []);
    S.fields = fields;
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

  function currentKind() {
    return K.KINDS.filter(function (k) { return k.id === S.kind; })[0] || K.KINDS[0];
  }

  // 计数 / 按钮与步骤条状态（输入时高频调用 → 只改文本，不动 DOM 结构）
  function updateMeta() {
    var filled = K.countFilled(S.fields, S.form);
    var total = (S.fields || []).length;
    var fillNum = $('fillNum');
    if (fillNum) fillNum.textContent = String(filled);
    var fillTotal = $('fillTotal');
    if (fillTotal) fillTotal.textContent = String(total);

    var ready = filled > 0;
    var step2 = $('step2');
    if (step2) step2.className = 'step-node ' + (ready ? 'done' : 'now');
    var line2 = $('line2');
    if (line2) line2.className = 'step-line' + (ready ? ' on' : '');
    var step3 = $('step3');
    if (step3) step3.className = 'step-node' + (ready ? ' now' : '');
    var btn = $('btnGen');
    if (btn) {
      btn.disabled = !ready;
      btn.textContent = ready ? '✨ 套模板出 3 条文案（免费 · 本地）' : '先填一两项，模板才好套上你的内容';
    }
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
      // 文案用 textContent：用户输入不可信，绝不走 innerHTML（防注入）
      d.appendChild(el('div', 'moment-text', m));
      d.appendChild(el('div', 'moment-foot', '模板套用 · 发布前请核对内容'));
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
    var tone = currentKind();
    $('selKind').textContent = tone.label;
    $('selDesc').textContent = tone.desc;
    $('structHint').textContent = '这套模板会这样组织：' + (K.KIND_STRUCT[S.kind] || '');
    updateMeta();
  }

  // ══════════════════════════════════════════════════════════
  // 交互
  // ══════════════════════════════════════════════════════════

  function onSelectKind(id) {
    if (id === S.kind) return;
    S.kind = id;
    S.form = {};          // 换了类型，字段结构全变，旧值留着只会串味
    S.moments = [];
    S.selected = 0;
    setErr('');
    renderAll();
    renderResult();
  }

  function onSwitchMode(m) {
    if (m === S.mode) return;
    S.mode = m;
    $('tplArea').hidden = (m !== 'tpl');
    $('optArea').hidden = (m !== 'opt');
    var tabTpl = $('modeTpl'), tabOpt = $('modeOpt');
    if (tabTpl) tabTpl.className = 'mode-tab' + (m === 'tpl' ? ' on' : '');
    if (tabOpt) tabOpt.className = 'mode-tab' + (m === 'opt' ? ' on' : '');
    setErr('');
  }

  // ── ① 套模板（纯本地字符串替换，零网络）──
  function onGenMoments() {
    var filled = K.countFilled(S.fields, S.form);
    if (filled === 0) { setErr('先填一两项，模板才有东西可套'); return; }
    var out = T.render(S.kind, S.form).filter(function (m) { return m && m.trim().length > 0; });
    if (!out.length) { setErr('再补一两项内容，让模板有东西可套'); return; }
    S.moments = out;
    S.selected = 0;
    setErr('');
    renderResult();
    var rc = $('resultCard');
    if (rc && rc.scrollIntoView) rc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('已套出 ' + out.length + ' 条');
  }

  // ── ② 排版优化（确定性规则，零网络）──
  function onPasteOpt() {
    function fallback() { toast('浏览器不允许读取剪贴板，请手动粘贴'); }
    if (!navigator.clipboard || !navigator.clipboard.readText) return fallback();
    navigator.clipboard.readText().then(function (t) {
      var v = String(t || '').trim();
      if (!v) { toast('剪贴板里没有内容'); return; }
      S.optRaw = v;
      $('optInput').value = v;
      toast('已粘贴');
    }).catch(fallback);
  }

  function onOptInput() {
    S.optRaw = $('optInput').value;
    S.optResult = '';
    $('optResultBox').hidden = true;
  }

  function applyOpt(type) {
    var raw = S.optRaw;
    if (!raw || !raw.trim()) { setErr('先在上方粘贴或输入一段文字'); return; }
    var out = raw;
    if (type === 'antiFold') out = TOOLS.antiFold(raw, 20);
    else if (type === 'emoji') out = TOOLS.insertEmoji(raw);
    else if (type === 'split') out = TOOLS.autoSplit(raw);
    S.optResult = out;
    S.optStats = TOOLS.countStats(out);
    S.optMode = type;
    setErr('');
    $('optStatsBox').hidden = false;
    $('optChars').textContent = String(S.optStats.chars);
    $('optLines').textContent = String(S.optStats.lines);
    $('optEmoji').textContent = String(S.optStats.emojiCount);
    $('optResultText').textContent = out;
    $('optResultBox').hidden = false;
  }

  function onOptAntiFold() { applyOpt('antiFold'); }
  function onOptEmoji() { applyOpt('emoji'); }
  function onOptSplit() { applyOpt('split'); }

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

  // ══════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════
  function init() {
    if (!K || !T || !TOOLS) {
      document.body.appendChild(el('div', 'err', '页面资源加载失败，请刷新重试'));
      return;
    }

    var bg = $('btnGen');
    if (bg) bg.addEventListener('click', onGenMoments);
    var mt = $('modeTpl');
    if (mt) mt.addEventListener('click', function () { onSwitchMode('tpl'); });
    var mo = $('modeOpt');
    if (mo) mo.addEventListener('click', function () { onSwitchMode('opt'); });

    var po = $('btnPasteOpt');
    if (po) po.addEventListener('click', onPasteOpt);
    var oi = $('optInput');
    if (oi) oi.addEventListener('input', onOptInput);
    var baf = $('btnAntiFold');
    if (baf) baf.addEventListener('click', onOptAntiFold);
    var be = $('btnEmoji');
    if (be) be.addEventListener('click', onOptEmoji);
    var bs = $('btnSplit');
    if (bs) bs.addEventListener('click', onOptSplit);
    var bc = $('btnCopyOpt');
    if (bc) bc.addEventListener('click', function () {
      if (S.optResult) copy(S.optResult, '已复制排版结果');
    });

    $('btnCopyOne').addEventListener('click', function () {
      var m = S.moments[S.selected];
      if (m) copy(m, '已复制，去朋友圈粘贴吧');
    });
    $('btnCopyAll').addEventListener('click', function () {
      if (!S.moments.length) return;
      copy(S.moments.join('\n\n——\n\n'), '已复制全部 ' + S.moments.length + ' 条');
    });

    // 深链参数：?k=<类型> 直接选中类型；?mode=opt 直接进排版优化。
    // 用途：公众号侧不同入口指向不同默认值，也方便本地视觉验证。
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
      if (qs.mode === 'opt') onSwitchMode('opt');
    } catch (e) { /* 参数不合法就一律用默认值，绝不让它挡住主流程 */ }

    renderAll();
    renderResult();

    // 可选：挂了小程序码就展示（没配就保持隐藏，不留破图）
    var CFG = window.H5_CONFIG || {};
    if (CFG.mpQr) {
      var f = $('foot');
      var img = el('img');
      img.src = CFG.mpQr;
      img.alt = (CFG.mpName || '小程序') + ' 小程序码';
      img.style.cssText = 'width:150px;height:150px;border-radius:10px;margin:12px auto 4px;display:block';
      f.insertBefore(img, f.firstChild);
      f.insertBefore(el('div', null, '想做图文排版，或看真人定制成品？长按识别进小程序'), f.firstChild);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
