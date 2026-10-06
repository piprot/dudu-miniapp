// utils/core/render_engine.js
// ─────────────────────────────────────────────────────────────────────────────
// 声明式渲染引擎（2026-10-01 整体重构核心）
//
// 借鉴 inottn/mini-poster 的 children[] 配置模型：一份「布局描述」(model) 即可驱动
// Canvas 2D 绘制，元素类型化、坐标声明式、可嵌套（container）。取代原先写死在
// card_render / comic_render 里的特例绘制逻辑，让「加一种卡片/海报/长图」变成加一份
// 数据，而不是加一堆 if/else。
//
// 设计：
//   computeLayout(model, opts, measure)  → 纯函数，把 model 解析成绝对坐标的 blocks[]（可单测，无需 wx）
//   draw(ctx, layout, assets)            → 把 blocks 画到 canvas（需要 ctx；测试中用 fakeCtx）
//   renderToCanvas(canvas, model, assets)→ 小程序端一键：算布局 + 适配 dpr + 绘制（仅运行期用）
//
// 元素类型（type）：
//   container  嵌套容器（left/top/width/height + children）
//   rect      纯色/描边矩形（背景块、分隔条）
//   gradient   线性渐变矩形（背景、色块）
//   image     图片（src + objectFit: cover|contain|fill；asset 为已加载的 Image 对象）
//   text      文本（自动折行 + lineClamp 省略号 + textAlign）
//   qrcode    二维码（contain 完整绘制，绝不裁剪码点；asset 为已加载图片）
//   line      细线（分隔线）
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// 默认文本测量：CJK 按字号宽，ASCII 半宽（与现有 wrapText 口径一致，保证布局可比）
function defaultMeasure(text, fontPx) {
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c >= 0x2e80 && c <= 0xffef) w += fontPx;
    else if (ch === ' ') w += fontPx * 0.3;
    else w += fontPx * 0.55;
  }
  return w;
}

// 按 maxWidth 折行，返回行数组
// 中文行首禁则：这些字符不能出现在行首。
// 起因（2026-10-06）：逐字塞的折行会把句末标点挤到下一行独占一行——
//「今天风很轻，连时间都放慢了脚步\n。」，标点孤零零挂在第二行，看着像排版事故。
// 处理方式：若新行首字符是禁则字符，把上一行末字挪下来与标点同行（宁可上一行少一个字，也不让标点孤立）。
const NO_LINE_START = '，。、；：！？）」』】〉》”’%·…～,.;:!?)]}>"\'';
const NO_LINE_END   = '（「『【〈《“‘([{<';   // 这些不能留在行尾（开引号/开括号）

function wrapText(text, maxWidth, measure, fontPx) {
  const out = [];
  let line = '';
  for (const ch of String(text)) {
    const test = line + ch;
    if (measure(test, fontPx) > maxWidth && line) {
      out.push(line);
      line = ch;
      continue;
    }
    line = test;
  }
  if (line) out.push(line);

  // ── 禁则处理：合并「标点独占行」 ──
  const merged = [];
  for (let i = 0; i < out.length; i++) {
    let cur = out[i];
    // 当前行首是禁则字符 → 从上一行借一个字符下来（借字本身也可能是标点，继续借）
    while (cur && NO_LINE_START.indexOf(cur[0]) >= 0) {
      if (merged.length === 0) break;           // 首行没得借，只能留着
      const prev = merged.pop();
      if (!prev) break;
      cur = prev.slice(-1) + cur;
      // 被借走一个字后上一行空了，丢弃；若只是变短则放回
      if (prev.length > 1) merged.push(prev.slice(0, -1));
    }
    merged.push(cur);
  }
  // 行尾禁则：把行尾的开括号推到下一行
  const out2 = [];
  for (let i = 0; i < merged.length; i++) {
    let cur = merged[i];
    const nxt = merged[i + 1];
    if (nxt && cur && NO_LINE_END.indexOf(cur[cur.length - 1]) >= 0) {
      out2.push(cur.slice(0, -1));
      out2.push(cur[cur.length - 1] + nxt);
      i++;                                        // 下一行已被合并消费
    } else {
      out2.push(cur);
    }
  }
  return out2.filter(Boolean);
}

// 把一行按最大字数硬截断（兜底，防止单字超宽）
function truncateLine(line, maxWidth, measure, fontPx, ellipsis) {
  if (measure(line, fontPx) <= maxWidth) return line;
  let s = line;
  while (s.length > 1 && measure(s + ellipsis, fontPx) > maxWidth) s = s.slice(0, -1);
  return s + ellipsis;
}

function layoutText(el, x, y, w, h, blocks, measure) {
  const fontPx = el.fontSize || 14;
  const lh = el.lineHeight || Math.round(fontPx * 1.43);
  const maxLines = el.lineClamp || 999;
  let lines = wrapText(el.content || '', w, measure, fontPx);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    // 最后一行若还可塞字，尝试合并进省略号（更像真省略）
    let last = kept[maxLines - 1];
    const remain = lines.slice(maxLines).join('');
    if (last.length < 40) last = truncateLine(last + remain, w, measure, fontPx, '…');
    else last = truncateLine(last, w, measure, fontPx, '…');
    kept[maxLines - 1] = last;
    lines = kept;
  }
  blocks.push({
    type: 'text', x, y, w, h,
    lines,
    color: el.color || '#222',
    fontPx, lh,
    fontWeight: el.fontWeight || 'normal',
    fontFamily: el.fontFamily || 'sans-serif',
    align: el.textAlign || 'left',
    letterSpacing: el.letterSpacing || 0,
    shadow: el.shadow || null   // 文字投影（照片背景用，替代「压暗整卡」的旧做法）
  });
}

// 递归布局：把 children 解析为绝对坐标 blocks
function layoutChildren(children, ox, oy, parentW, parentH, blocks, measure, opts) {
  if (!Array.isArray(children)) return;
  for (const el of children) {
    if (!el) continue;
    const x = ox + (typeof el.left === 'function' ? el.left() : (el.left || 0));
    const y = oy + (typeof el.top === 'function' ? el.top() : (el.top || 0));
    const w = (typeof el.width === 'function' ? el.width() : (el.width != null ? el.width : parentW));
    const h = (typeof el.height === 'function' ? el.height() : (el.height != null ? el.height : parentH));
    const type = el.type || 'rect';

    if (type === 'container') {
      const clip = el.overflow === 'hidden';
      if (clip) blocks.push({ type: 'clipBegin', x, y, w, h, radius: el.radius || 0 });
      layoutChildren(el.children, x, y, w, h, blocks, measure, opts);
      if (clip) blocks.push({ type: 'clipEnd' });
    } else if (type === 'text') {
      layoutText(el, x, y, w, h, blocks, measure);
    } else if (type === 'image') {
      blocks.push({ type: 'image', x, y, w, h, radius: el.radius || 0, objectFit: el.objectFit || 'cover', src: el.src, asset: el.asset });
    } else if (type === 'qrcode') {
      const s = el.size || el.width || w;
      blocks.push({ type: 'qrcode', x, y, w: s, h: s, asset: el.asset, radius: el.radius || 0 });
    } else if (type === 'circle') {
      const dd = el.d || el.width || 20;
      blocks.push({ type: 'circle', x, y, d: dd, background: el.background || '#333' });
    } else if (type === 'line') {
      blocks.push({ type: 'line', x, y, w, h, color: el.color || '#e5e5e5', thickness: el.thickness || 1 });
    } else if (type === 'gradient') {
      blocks.push({ type: 'gradient', x, y, w, h, radius: el.radius || 0, colors: el.colors || ['#fff', '#fff'], direction: el.direction || 'v' });
    } else { // rect
      blocks.push({ type: 'rect', x, y, w, h, radius: el.radius || 0, background: el.background, border: el.border || 0, borderColor: el.borderColor || '#000' });
    }
  }
}

function computeLayout(model, opts, measure) {
  const o = Object.assign({ width: 375, height: 600, radius: 0, pad: 0 }, opts || {});
  const m = Object.assign({ width: o.width, height: o.height, children: [] }, model || {});
  measure = measure || defaultMeasure;
  const blocks = [];

  // 根圆角：整卡按圆角裁剪（所有背景/子元素都被裁进圆角矩形内）
  if (m.radius) {
    blocks.push({ type: 'clipBegin', x: 0, y: 0, w: m.width, h: m.height, radius: m.radius });
  }

  // 画布底层，三选一（优先级：照片背景 > 纯色 > 渐变）：
  //   backgroundImage —— 照片铺满（cover-fit）+ 暗色线性蒙版（保证上层白字可读）；
  //   background      —— 纯色；
  //   gradient        —— 两色线性渐变。
  // backgroundImageAsset 由调用方加载图片后注入（computeLayout 保持纯函数）。
  //
  // bgVeil：蒙版强度覆盖 [上不透明度, 下不透明度]，缺省 [0.32, 0.52]。
  //   网络图的灰度/虚化由 picsum 服务端做（?grayscale / ?blur=6），
  //   但**内置包内图没有服务端**（见 utils/bg_pack.js 注释），
  //   只能靠加厚/减薄暗色蒙版来近似三档，核心目的是保证白字可读。
  if (m.backgroundImage) {
    const v = (m.bgVeil && m.bgVeil.length === 2) ? m.bgVeil : [0.32, 0.52];
    blocks.push({ type: 'image', x: 0, y: 0, w: m.width, h: m.height, radius: 0, objectFit: 'cover', asset: m.backgroundImageAsset });
    blocks.push({ type: 'gradient', x: 0, y: 0, w: m.width, h: m.height, radius: 0, colors: ['rgba(15,14,22,' + v[0] + ')', 'rgba(15,14,22,' + v[1] + ')'], direction: 'v' });
  } else if (m.background) {
    blocks.push({ type: 'rect', x: 0, y: 0, w: m.width, h: m.height, radius: m.radius || 0, background: m.background });
  } else if (m.gradient) {
    blocks.push({ type: 'gradient', x: 0, y: 0, w: m.width, h: m.height, radius: m.radius || 0, colors: m.gradient, direction: 'v' });
  }

  layoutChildren(m.children || [], 0, 0, m.width, m.height, blocks, measure, o);

  if (m.radius) {
    blocks.push({ type: 'clipEnd' });
  }
  return { width: m.width, height: m.height, blocks };
}

// ── 绘制 ──
function draw(ctx, layout, assets) {
  assets = assets || {};
  const dpr = assets.dpr || 1;
  ctx.clearRect(0, 0, layout.width * dpr, layout.height * dpr);
  let clipDepth = 0;
  for (const b of layout.blocks) {
    if (b.type === 'clipBegin') {
      ctx.save();
      roundRectPath(ctx, b.x, b.y, b.w, b.h, b.radius);
      ctx.clip();
      clipDepth++;
      continue;
    }
    if (b.type === 'clipEnd') {
      if (clipDepth > 0) { ctx.restore(); clipDepth--; }
      continue;
    }
    if (b.type === 'rect') {
      if (b.background) {
        if (b.radius) { roundRectPath(ctx, b.x, b.y, b.w, b.h, b.radius); ctx.fillStyle = b.background; ctx.fill(); }
        else { ctx.fillStyle = b.background; ctx.fillRect(b.x, b.y, b.w, b.h); }
      }
      if (b.border) {
        roundRectPath(ctx, b.x, b.y, b.w, b.h, b.radius);
        ctx.lineWidth = b.border; ctx.strokeStyle = b.borderColor; ctx.stroke();
      }
    } else if (b.type === 'gradient') {
      const g = ctx.createLinearGradient(b.x, b.y, b.direction === 'h' ? b.x + b.w : b.x, b.direction === 'h' ? b.y : b.y + b.h);
      const cs = b.colors.length ? b.colors : ['#fff', '#fff'];
      g.addColorStop(0, cs[0]);
      g.addColorStop(1, cs[cs.length - 1]);
      if (b.radius) { roundRectPath(ctx, b.x, b.y, b.w, b.h, b.radius); } else { ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); }
      ctx.fillStyle = g; ctx.fill();
    } else if (b.type === 'circle') {
      ctx.fillStyle = b.background;
      ctx.beginPath();
      ctx.arc(b.x + b.d / 2, b.y + b.d / 2, b.d / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.type === 'line') {
      ctx.fillStyle = b.color;
      if (b.h <= b.thickness) ctx.fillRect(b.x, b.y, b.w, b.thickness);
      else ctx.fillRect(b.x, b.y, b.thickness, b.h);
    } else if (b.type === 'text') {
      ctx.fillStyle = b.color;
      ctx.textBaseline = 'top';
      ctx.textAlign = b.align;
      const anchorX = b.align === 'center' ? b.x + b.w / 2 : (b.align === 'right' ? b.x + b.w : b.x);
      // 文字投影：照片背景下靠它保证可读，从而**不必把整卡蒙版压得很暗**。
      // 旧版只靠全卡暗色渐变（最深 0.68），整张图发闷、看着郁闷；
      // 现在改成「浅蒙版 + 局部文字投影」——图能看清，文字也读得清。
      if (b.shadow) {
        ctx.shadowColor = b.shadow.color || 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = b.shadow.blur || 6;
        ctx.shadowOffsetX = b.shadow.x || 0;
        ctx.shadowOffsetY = b.shadow.y || 1;
      }
      for (let i = 0; i < b.lines.length; i++) {
        const ty = b.y + i * b.lh;
        ctx.font = (b.fontWeight !== 'normal' ? b.fontWeight + ' ' : '') + b.fontPx + 'px ' + b.fontFamily;
        ctx.fillText(b.lines[i], anchorX, ty);
      }
      if (b.shadow) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
    } else if (b.type === 'image') {
      if (b.asset && b.asset.width && b.asset.height) drawCover(ctx, b, b.asset);
      else drawPlaceholder(ctx, b, '图');
    } else if (b.type === 'qrcode') {
      if (b.asset && b.asset.width && b.asset.height) drawContain(ctx, b, b.asset);
      else drawPlaceholder(ctx, b, '码');
    }
  }
  while (clipDepth > 0) { ctx.restore(); clipDepth--; }
}

function drawCover(ctx, b, img) {
  const scale = Math.max(b.w / img.width, b.h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  const dx = b.x - (dw - b.w) / 2, dy = b.y - (dh - b.h) / 2;
  if (b.radius) { roundRectPath(ctx, b.x, b.y, b.w, b.h, b.radius); ctx.save(); ctx.clip(); ctx.drawImage(img, dx, dy, dw, dh); ctx.restore(); }
  else ctx.drawImage(img, dx, dy, dw, dh);
}

function drawContain(ctx, b, img) {
  const scale = Math.min(b.w / img.width, b.h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  const dx = b.x + (b.w - dw) / 2, dy = b.y + (b.h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawPlaceholder(ctx, b, label) {
  if (b.radius) { roundRectPath(ctx, b.x, b.y, b.w, b.h, b.radius); ctx.fillStyle = '#efe7d8'; ctx.fill(); }
  else { ctx.fillStyle = '#efe7d8'; ctx.fillRect(b.x, b.y, b.w, b.h); }
  ctx.fillStyle = '#b3a890'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
  ctx.textAlign = 'left';
}

// 小程序端一键渲染（仅运行期；测试请直接用 computeLayout + draw）
function renderToCanvas(canvas, model, assets) {
  return new Promise((resolve, reject) => {
    try {
      const info = (wx && wx.getWindowInfo) ? wx.getWindowInfo() : { pixelRatio: 2 };
      const dpr = info.pixelRatio || 2;
      const ctx = canvas.getContext('2d');
      const layout = computeLayout(model, { width: model.width, height: model.height }, defaultMeasure);
      canvas.width = model.width * dpr;
      canvas.height = model.height * dpr;
      ctx.scale(dpr, dpr);
      draw(ctx, layout, Object.assign({ dpr }, assets));
      resolve(layout);
    } catch (e) { reject(e); }
  });
}

module.exports = {
  computeLayout,
  draw,
  renderToCanvas,
  wrapText,
  roundRectPath,
  defaultMeasure
};
