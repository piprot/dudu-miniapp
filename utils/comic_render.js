// utils/comic_render.js
// ─────────────────────────────────────────────────────────────────────────
// 「画面感分镜编辑器」布局 + canvas 2d 渲染器。
//   - computeLayout(model, opts, measure): 纯函数，接收 measure(text,font)→px 回调，
//     不依赖真实 ctx，可在 Node 下单测。返回布局树（含每格坐标与总高）。
//   - draw(ctx, layout, opts): 依赖小程序 canvas 2d ctx，把布局画出来。
//
// 全程本地、无网络、无 AI。输出是「用户脚本的可视化」，不是生成内容。
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  width: 340,          // 画布 CSS 宽（由页面按元素实测宽度传入）
  cols: 2,             // 每行列数
  gap: 12,             // 分镜间距
  pad: 14,             // 页面外边距
  panelPad: 12,        // 分镜内边距
  font: '14px sans-serif',
  lineHeight: 20,      // 文本行高
  titleFont: 'bold 18px sans-serif',
  titleLH: 26,
  balloonPad: 10,      // 气泡内边距
  headerFont: '12px sans-serif',
  headerLH: 18,
  bg: '#f5f0e8'
};

// 贪婪折行：按字符累加宽度，超宽则换行（兼容中文逐字 / 英文按空格）。
function wrapText(text, maxW, measure) {
  const out = [];
  const chars = Array.from(String(text || ''));
  let cur = '';
  let curW = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\n') {
      out.push(cur); cur = ''; curW = 0;
      continue;
    }
    const w = measure(ch);
    if (curW + w > maxW && cur.length > 0) {
      out.push(cur); cur = ch; curW = w;
    } else {
      cur += ch; curW += w;
    }
  }
  if (cur.length) out.push(cur);
  return out.length ? out : [''];
}

// 手动圆角矩形（兼容不支持 ctx.roundRect 的环境）。
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function truncate(ctx, text, maxW, font) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) {
    s = s.slice(0, -1);
  }
  return s + '…';
}

// 计算布局（纯函数，可单测）。
function computeLayout(model, opts, measure) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const panels = (model && model.panels) || [];
  const panelW = (o.width - o.pad * 2 - o.gap * (o.cols - 1)) / o.cols;
  const textW = panelW - o.panelPad * 2 - o.balloonPad * 2;

  const measured = panels.map(p => {
    let h = o.panelPad * 2 + o.headerLH; // 头部行
    if (p.scene) h += o.headerLH;
    for (const ln of p.lines) {
      const txt = (ln.type === 'speech' && ln.who ? ln.who + '：' : '') + ln.text;
      const wrapped = wrapText(txt, textW, measure);
      h += wrapped.length * o.lineHeight + (ln.type === 'speech' ? o.balloonPad * 2 : o.balloonPad);
    }
    if (p.lines.length === 0) h += o.lineHeight;
    return { p, h: Math.max(h, 120) };
  });

  // 按 cols 分组成行。
  const rows = [];
  for (let i = 0; i < measured.length; i += o.cols) {
    rows.push(measured.slice(i, i + o.cols));
  }

  let totalH = o.pad * 2;
  if (model && model.title) totalH += o.titleLH + 8;
  for (const r of rows) totalH += Math.max.apply(null, r.map(m => m.h));
  totalH += o.gap * Math.max(0, rows.length - 1);

  // 计算每格坐标。
  let y = o.pad;
  if (model && model.title) y += o.titleLH + 8;
  const layout = { width: o.width, height: totalH, title: (model && model.title) || '', rows: [] };
  for (const r of rows) {
    const rowH = Math.max.apply(null, r.map(m => m.h));
    let x = o.pad;
    const rowPanels = [];
    for (const m of r) {
      rowPanels.push({ x, y, w: panelW, h: rowH, panel: m.p });
      x += panelW + o.gap;
    }
    layout.rows.push(rowPanels);
    y += rowH + o.gap;
  }
  return layout;
}

// 在真实 canvas 上绘制（依赖 ctx）。
function draw(ctx, layout, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const measure = (t, f) => { ctx.font = f; return ctx.measureText(t).width; };

  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = o.bg;
  ctx.fillRect(0, 0, layout.width, layout.height);

  let y = o.pad;
  if (layout.title) {
    ctx.fillStyle = '#2b2b2b';
    ctx.font = o.titleFont;
    ctx.textBaseline = 'top';
    ctx.fillText(layout.title, o.pad, y);
    y += o.titleLH + 8;
  }

  for (const row of layout.rows) {
    for (const cell of row) {
      const p = cell.panel;
      const m = p.mood || DEFAULTS.mood;
      const innerX = cell.x + o.panelPad;
      const innerW = cell.w - o.panelPad * 2;
      const textW = innerW - o.balloonPad * 2;

      // 分镜底色 + 边框（情绪色调）。
      roundRectPath(ctx, cell.x, cell.y, cell.w, cell.h, 10);
      ctx.fillStyle = m.tint;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = m.border;
      ctx.stroke();

      let ly = cell.y + o.panelPad;

      // 头部：标签或场景。
      const header = p.label || p.scene || '';
      if (header) {
        ctx.font = o.headerFont;
        ctx.fillStyle = m.border;
        ctx.textBaseline = 'top';
        ctx.fillText(truncate(ctx, header, innerW, o.headerFont), innerX, ly);
        ly += o.headerLH;
      }

      // 内容行：对白→白底气泡；旁白→浅灰说明框。
      for (const ln of p.lines) {
        const txt = (ln.type === 'speech' && ln.who ? ln.who + '：' : '') + ln.text;
        const wrapped = wrapText(txt, textW, measure);
        const bh = wrapped.length * o.lineHeight + o.balloonPad * 2;
        const bx = innerX;
        const by = ly;

        roundRectPath(ctx, bx, by, innerW, bh, ln.type === 'speech' ? 8 : 6);
        if (ln.type === 'speech') {
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#d8d2c6';
          ctx.stroke();
          ctx.fillStyle = '#2b2b2b';
        } else {
          ctx.fillStyle = 'rgba(0,0,0,0.05)';
          ctx.fill();
          ctx.fillStyle = '#555555';
        }
        ctx.font = o.font;
        ctx.textBaseline = 'top';
        for (let i = 0; i < wrapped.length; i++) {
          ctx.fillText(wrapped[i], bx + o.balloonPad, by + o.balloonPad + i * o.lineHeight);
        }
        ly += bh + (ln.type === 'speech' ? 8 : 6);
      }
    }
  }
}

module.exports = { DEFAULTS, wrapText, roundRectPath, computeLayout, draw };
