// utils/card_render.js
// ─────────────────────────────────────────────────────────────────────────
// 「画面感卡片 / 日签生成器」布局 + canvas 2d 渲染器（B 方向，纯本地、零 AI）。
//   - CARD_TEMPLATES：5 类模板元信息（金句 / 种草 / 公告 / 清单 / 图文）。
//   - computeCardLayout(model, opts, measure)：纯函数，接收 measure(text,font)→px，
//     不依赖真实 ctx，可在 Node 下单测。返回布局树（每区块坐标 + 卡片总高）。
//   - drawCard(ctx, layout, opts)：依赖小程序 canvas 2d ctx，把布局画出来；
//     opts.coverImg 为已加载的本地图（canvas.createImage），为空则画占位。
//
// 全程本地、无网络、无 AI。图片只走 wx.chooseMedia 取本地文件，不上传服务器。
// ─────────────────────────────────────────────────────────────────────────

// 模板元信息：name 角标、hint 引导、hasCover 是否需要配图、fields 需要的字段。
const CARD_TEMPLATES = {
  dailysign: {
    name: '每日日签',
    hint: '日期 + 一句金句，自动带小程序码',
    hasCover: false,
    fields: ['title', 'body']
  },
  quote: {
    name: '金句卡',
    hint: '一句打动人的话 + 出处',
    hasCover: false,
    fields: ['body', 'author']
  },
  recommend: {
    name: '种草卡',
    hint: '标题 + 卖点 + 价格标签 + 配图',
    hasCover: true,
    fields: ['title', 'body', 'tag', 'cover']
  },
  notice: {
    name: '公告卡',
    hint: '标题 + 正文 + 落款',
    hasCover: false,
    fields: ['title', 'body', 'author']
  },
  checklist: {
    name: '清单卡',
    hint: '标题 + 若干条目（逐条打勾）',
    hasCover: false,
    fields: ['title', 'items']
  },
  imagetext: {
    name: '图文卡',
    hint: '配图 + 标题 + 一句说明',
    hasCover: true,
    fields: ['cover', 'title', 'body']
  }
};

// 各类型背景主题（浅色暖调渐变，保证深色文字可读；用作卡片底色）。
// 与「画面感」基调一致：每日日签暖橙 / 金句米金 / 种草薄荷 / 公告天蓝 / 清单薰衣草 / 图文玫瑰。
const THEMES = {
  dailysign: ['#fff3e8', '#ffe2c6'],
  quote:     ['#fdf8ee', '#f1e6cf'],
  recommend: ['#eef8f1', '#d6efe0'],
  notice:    ['#eef5fc', '#d7e8f6'],
  checklist: ['#f4eefb', '#e3d8f4'],
  imagetext: ['#fdeef3', '#f7dbe5']
};

const DEFAULTS = {
  width: 340,           // 画布 CSS 宽（由页面按元素实测宽度传入）
  pad: 24,              // 卡片内边距（加宽，给内容更多呼吸感）
  radius: 18,           // 卡片圆角
  bg: '#ffffff',        // 卡片底色
  panelBg: '#fdf9f0',   // 占位 / 浅底块
  ink: '#222222',       // 主文字
  sub: '#7a7264',       // 次文字
  accent: '#f5793b',    // 强调色（橙）
  lineHeight: 24,       // 正文行高
  titleFont: 'bold 24px sans-serif',
  titleLH: 42,          // 标题行距（加宽，避免多行标题挤在一起）
  bodyFont: '16px sans-serif',
  bodyLH: 25,
  quoteFont: 'italic 20px sans-serif',
  quoteLH: 30,
  smallFont: '13px sans-serif',
  smallLH: 24,          // 落款 / 出处 / 角标行距（加宽）
  coverH: 190,          // 配图高度
  gap: 16,              // 区块间距（略加宽，排版更透气）
  pillPadX: 12,
  maxQuoteLines: 6,
  maxBodyLines: 14
};

// 贪婪折行（兼容中文逐字 / 英文按空格），与 comic_render 同算法。
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
function computeCardLayout(model, opts, measure) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const m = model || {};
  const type = CARD_TEMPLATES[m.type] ? m.type : 'quote';
  const tpl = CARD_TEMPLATES[type];
  const theme = THEMES[type] || THEMES.quote;
  const innerW = o.width - o.pad * 2;
  let y = o.pad;
  const blocks = [];

  // ① 类型角标（pill）。
  const pillText = tpl.name;
  const pillW = measure(pillText, o.smallFont) + o.pillPadX * 2;
  blocks.push({ kind: 'pill', x: o.pad, y: y, w: pillW, h: o.smallLH + 8, text: pillText });
  y += o.smallLH + 8 + o.gap;

  // ② 标题（可选）。
  if (m.title) {
    const wrapped = wrapText(m.title, innerW, measure);
    blocks.push({ kind: 'title', x: o.pad, y: y, w: innerW, h: wrapped.length * o.titleLH, text: wrapped });
    y += wrapped.length * o.titleLH + o.gap;
  }

  // ③ 配图（仅 hasCover 且有 cover 路径时预留区域）。
  let cover = null;
  if (tpl.hasCover && m.cover) {
    cover = { x: o.pad, y: y, w: innerW, h: o.coverH };
    y += o.coverH + o.gap;
  }

  // ④ 正文 / 金句。
  if (m.body) {
    const isQuote = (type === 'quote' || type === 'dailysign');
    const lh = isQuote ? o.quoteLH : o.bodyLH;
    const font = isQuote ? o.quoteFont : o.bodyFont;
    const wrapped = wrapText(m.body, innerW, measure);
    const maxLines = isQuote ? o.maxQuoteLines : o.maxBodyLines;
    const lines = wrapped.slice(0, maxLines);
    blocks.push({ kind: 'body', x: o.pad, y: y, w: innerW, h: lines.length * lh, text: lines, quote: isQuote, font, lh });
    y += lines.length * lh + o.gap;
  }

  // 小程序码占位（具体坐标在落款之后统一结算，确保任何卡片类型都带码且不重叠）。
  let qr = null;

  // ⑤ 清单条目（逐条）。
  if (type === 'checklist' && Array.isArray(m.items)) {
    let idx = 0;
    for (const it of m.items) {
      const wrapped = wrapText(String(it), innerW - 34, measure);
      const h = wrapped.length * o.bodyLH;
      blocks.push({ kind: 'item', x: o.pad, y: y, w: innerW, h: h, text: wrapped, idx: idx });
      y += h + 12;
      idx++;
    }
    y += o.gap - 12;
  }

  // ⑥ 标签（种草卡的卖点 / 价格）。
  if (type === 'recommend' && m.tag) {
    const tw = measure(m.tag, o.smallFont) + o.pillPadX * 2;
    blocks.push({ kind: 'tag', x: o.pad, y: y, w: tw, h: o.smallLH + 8, text: m.tag });
    y += o.smallLH + 8 + o.gap;
  }

  // ⑦ 落款 / 出处（右对齐）。
  if (m.author) {
    const wrapped = wrapText(m.author, innerW, measure);
    blocks.push({ kind: 'footer', x: o.pad, y: y, w: innerW, h: wrapped.length * o.smallLH, text: wrapped });
    y += wrapped.length * o.smallLH + 12;   // 与底部留白之间留出更宽间距
  }

  // ⑧ 小程序码（所有卡片类型右下角收尾；contain 等比完整绘制，绝不裁剪码点）。
  //    此前仅每日日签带码；现统一带码，方便发到朋友圈 / 群后扫码回流到小程序。
  //    放在全部文字之后、作为收尾元素，避免与正文 / 清单 / 落款重叠。
  if (m.qr) {
    const qs = 56;
    qr = { x: o.width - o.pad - qs, y: y, w: qs, h: qs };
    y += qs + o.gap;
  }

  // 底部留白（抵扣最后一个 gap）。
  y += o.pad - o.gap;
  const height = Math.max(y, o.pad * 2 + 40);

  return {
    width: o.width,
    height: height,
    type: type,
    pill: tpl.name,
    accent: o.accent,
    bg: { grad: theme },
    center: type === 'dailysign',
    blocks: blocks,
    cover: cover,
    qr: qr
  };
}

// 配图 cover-fit 裁剪绘制（居中铺满，溢出裁掉）。
function drawCover(ctx, rect, img) {
  if (img && img.width && img.height) {
    const cw = rect.w, ch = rect.h;
    const scale = Math.max(cw / img.width, ch / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    const dx = rect.x - (dw - cw) / 2;
    const dy = rect.y - (dh - ch) / 2;
    ctx.save();
    roundRectPath(ctx, rect.x, rect.y, cw, ch, 12);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  } else {
    // 占位：浅底 + 提示文字。
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 12);
    ctx.fillStyle = '#efe7d8';
    ctx.fill();
    ctx.fillStyle = '#b3a890';
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('点击下方「选择图片」', rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.textAlign = 'left';
  }
}

// 在真实 canvas 上绘制（依赖 ctx）。
function drawCard(ctx, layout, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const m = (opts && opts.model) || {};
  const coverImg = opts && opts.coverImg;
  const qrImg = opts && opts.qrImg;
  const bgImg = opts && opts.bgImg;
  // 是否使用照片作背景：是则文字转白字 + 暗色蒙版；否则用类型主题渐变 + 深色字。
  const onPhoto = !!(bgImg && bgImg.width && bgImg.height);
  const ink = onPhoto ? '#ffffff' : o.ink;
  const sub = onPhoto ? 'rgba(255,255,255,0.9)' : o.sub;

  ctx.clearRect(0, 0, layout.width, layout.height);

  // 卡片底（圆角）：背景图 cover-fit 铺满 + 暗色蒙版（保证白字可读）；
  // 否则用类型主题渐变（浅暖色，上压一层极淡白光增加质感）。
  ctx.save();
  roundRectPath(ctx, 0, 0, layout.width, layout.height, o.radius);
  ctx.clip();
  if (onPhoto) {
    const cw = layout.width, ch = layout.height;
    const scale = Math.max(cw / bgImg.width, ch / bgImg.height);
    const dw = bgImg.width * scale, dh = bgImg.height * scale;
    ctx.drawImage(bgImg, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    const og = ctx.createLinearGradient(0, 0, 0, ch);
    og.addColorStop(0, 'rgba(15,14,22,0.32)');
    og.addColorStop(1, 'rgba(15,14,22,0.52)');
    ctx.fillStyle = og;
    ctx.fillRect(0, 0, cw, ch);
  } else {
    const grad = (layout.bg && layout.bg.grad) || [o.bg, o.bg];
    const g = ctx.createLinearGradient(0, 0, 0, layout.height);
    g.addColorStop(0, grad[0]);
    g.addColorStop(1, grad[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, layout.width, layout.height);
    const hg = ctx.createLinearGradient(0, 0, 0, layout.height);
    hg.addColorStop(0, 'rgba(255,255,255,0.5)');
    hg.addColorStop(0.45, 'rgba(255,255,255,0.06)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }
  ctx.restore();

  // 内描边：增加卡片「抬起」质感（照片背景用白线，渐变背景用淡灰线）。
  ctx.save();
  roundRectPath(ctx, 1, 1, layout.width - 2, layout.height - 2, o.radius);
  ctx.lineWidth = 1;
  ctx.strokeStyle = onPhoto ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.06)';
  ctx.stroke();
  ctx.restore();

  // 顶部强调条（贴合圆角，不做溢出）。
  ctx.save();
  roundRectPath(ctx, 0, 0, layout.width, 6, o.radius);
  ctx.clip();
  ctx.fillStyle = o.accent;
  ctx.fillRect(0, 0, layout.width, 6);
  ctx.restore();

  // 配图（在绘制文字前，紧跟在标题后区域；cover 已含坐标）。
  if (layout.cover) drawCover(ctx, layout.cover, coverImg);

  // 小程序码（所有卡片右下角收尾）：白底描边 + contain 等比完整绘制（不裁剪码点）。
  if (layout.qr) {
    const q = layout.qr;
    roundRectPath(ctx, q.x, q.y, q.w, q.h, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (qrImg && qrImg.width && qrImg.height) {
      const s = Math.min(q.w / qrImg.width, q.h / qrImg.height);   // contain
      const dw = qrImg.width * s, dh = qrImg.height * s;
      ctx.save();
      roundRectPath(ctx, q.x, q.y, q.w, q.h, 10);
      ctx.clip();
      ctx.drawImage(qrImg, q.x + (q.w - dw) / 2, q.y + (q.h - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.strokeStyle = '#e5ddcc';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  for (const b of layout.blocks) {
    switch (b.kind) {
      case 'pill': {
        const px = layout.center ? (o.width - b.w) / 2 : b.x;
        roundRectPath(ctx, px, b.y, b.w, b.h, b.h / 2);
        ctx.fillStyle = o.accent;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = o.smallFont;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(b.text, px + b.w / 2, b.y + b.h / 2);
        ctx.textAlign = 'left';
        break;
      }
      case 'title': {
        ctx.fillStyle = ink;
        ctx.font = o.titleFont;
        ctx.textBaseline = 'top';
        if (layout.center) {
          ctx.textAlign = 'center';
          for (let i = 0; i < b.text.length; i++) ctx.fillText(b.text[i], o.width / 2, b.y + i * o.titleLH);
          ctx.textAlign = 'left';
        } else {
          for (let i = 0; i < b.text.length; i++) ctx.fillText(b.text[i], b.x, b.y + i * o.titleLH);
        }
        break;
      }
      case 'body': {
        ctx.fillStyle = ink;
        ctx.font = b.font;
        ctx.textBaseline = 'top';
        if (layout.center) {
          ctx.textAlign = 'center';
          for (let i = 0; i < b.text.length; i++) ctx.fillText(b.text[i], o.width / 2, b.y + i * b.lh);
          ctx.textAlign = 'left';
        } else {
          for (let i = 0; i < b.text.length; i++) ctx.fillText(b.text[i], b.x, b.y + i * b.lh);
        }
        if (b.quote) {
          // 引号装饰：左上角（居中时移到正上方居中）大引号。
          ctx.fillStyle = o.accent;
          ctx.font = 'bold 40px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('“', layout.center ? o.width / 2 : b.x - 2, b.y - 18);
          ctx.textAlign = 'left';
        }
        break;
      }
      case 'item': {
        // 勾选方块。
        const boxS = 18;
        roundRectPath(ctx, b.x, b.y + 2, boxS, boxS, 5);
        ctx.strokeStyle = o.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
        // 对勾。
        ctx.beginPath();
        ctx.moveTo(b.x + 4, b.y + 2 + boxS / 2);
        ctx.lineTo(b.x + 7, b.y + 2 + boxS - 5);
        ctx.lineTo(b.x + boxS - 4, b.y + 2 + 4);
        ctx.strokeStyle = o.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
        // 文本（右侧缩进）。
        ctx.fillStyle = ink;
        ctx.font = o.bodyFont;
        ctx.textBaseline = 'top';
        for (let i = 0; i < b.text.length; i++) {
          ctx.fillText(b.text[i], b.x + 28, b.y + i * o.bodyLH);
        }
        break;
      }
      case 'tag': {
        roundRectPath(ctx, b.x, b.y, b.w, b.h, b.h / 2);
        ctx.fillStyle = o.accent;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = o.smallFont;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(b.text, b.x + b.w / 2, b.y + b.h / 2);
        ctx.textAlign = 'left';
        break;
      }
      case 'footer': {
        ctx.fillStyle = sub;
        ctx.font = o.smallFont;
        ctx.textBaseline = 'top';
        if (layout.center) {
          ctx.textAlign = 'center';
          for (let i = 0; i < b.text.length; i++) ctx.fillText(b.text[i], o.width / 2, b.y + i * o.smallLH);
          ctx.textAlign = 'left';
        } else {
          ctx.textAlign = 'right';
          for (let i = 0; i < b.text.length; i++) ctx.fillText(b.text[i], b.x + b.w, b.y + i * o.smallLH);
          ctx.textAlign = 'left';
        }
        break;
      }
    }
  }
}

module.exports = {
  CARD_TEMPLATES,
  DEFAULTS,
  wrapText,
  roundRectPath,
  truncate,
  computeCardLayout,
  drawCard,
  drawCover
};
