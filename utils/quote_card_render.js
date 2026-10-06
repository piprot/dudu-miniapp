// utils/quote_card_render.js
// ─────────────────────────────────────────────────────────────────────────
// 新增 5 个免费本地模块的共享渲染器（2026-10-06）
//   金句收藏馆 / 每日一句 / 天气心情卡 / 节气·今日文案 / 台词书摘卡
//
// 直接复用既有的「模板(templates) × 主题(themes) × 引擎(render_engine)」三层解耦管线，
// 与 pages/card/card.js 同款代码路径（buildCardModel → computeLayout → draw）。
//
// ⚠️ 这些模块均为「免费本地工具」，不调用 utils/charge 扣积分（个人主体合规：
//    纯本地文字/图片处理，零 AI、零网络上传）。本文件只是渲染/保存的薄封装。
//
// ⚠️ 不要覆盖 utils/card_render.js（test_card.js / test/test_fixes_regression.js 依赖它）。
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const { buildCardModel } = require('./templates/index');
const { computeLayout, draw } = require('./core/render_engine');
const { exportAndSave } = require('./share');

// 包内小程序码（绘制到卡片右下角，长按可回流到小程序）
const QR_PATH = '/images/qrcode_miniapp.png';

function getDpr() {
  try {
    const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return info.pixelRatio || 2;
  } catch (e) { return 2; }
}

// opts = { canvasId, type, theme, data }
//   data 可含 { title, body, author, tag, items[], cover, bgImg }
// 内部自动加载 qr（包内小程序码）+ cover + bgImg 资产并注入 model，再绘制。
// 成功 resolve({ layout, canvasNode })，并把 canvasNode 挂到 page._cardCanvasNode 供保存。
function renderCard(page, opts) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().select(opts.canvasId).fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        reject(new Error('画布初始化失败，请重试'));
        return;
      }
      try {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = getDpr();
        const cssW = res[0].width || 340;

        // 文本测量：用真实 canvas measureText（按字号设置 font，保证折行准确）
        const measure = (t, fontPx) => {
          ctx.font = fontPx + 'px sans-serif';
          return ctx.measureText(t).width;
        };

        // 所有卡片右下角固定叠加包内小程序码（全自动，无需选图）
        const data = Object.assign({}, opts.data || {});
        data.qr = QR_PATH;

        const model = buildCardModel(opts.type, opts.theme || 'warm', data, { measure });

        const loadImg = (src) => new Promise(r => {
          const img = canvas.createImage();
          img.onload = () => r(img);
          img.onerror = () => r(null);
          img.src = src;
        });

        const jobs = [];
        if (data.cover) jobs.push(loadImg(data.cover).then(im => {
          const c = model.children.find(x => x.type === 'image' && x.src === data.cover);
          if (c && im) c.asset = im;
        }));
        // ⚠️ 二维码必须在这里加载 asset，否则 draw() 会走 drawPlaceholder 画一个「码」字灰块。
        //    这个坑踩过一次：data.qr 设了路径，但 jobs 只push 了 cover / bgImg，
        //    qrcode 节点的 asset 恒为 undefined → 四个页面（金句/天气/节气/台词）二维码全都不显示。
        //    对照 pages/card/card.js 的同名逻辑补齐，别以为"设了路径就会画"。
        if (data.qr) jobs.push(loadImg(data.qr).then(im => {
          const q = model.children.find(x => x.type === 'qrcode');
          if (q && im) q.asset = im;
        }));
        if (data.bgImg) jobs.push(loadImg(data.bgImg).then(im => {
          if (im) {
            model.backgroundImageAsset = im;
            return;
          }
          // 网络图加载失败（白名单没配 / 断网 / 图源抖动）→ 改用内置兜底图；
          // 内置图也失败才回退主题渐变。任何一级都不白卡、不抛错。
          if (data.bgFallback) {
            return loadImg(data.bgFallback).then(im2 => {
              if (im2) model.backgroundImageAsset = im2;
              else delete model.backgroundImage;
            });
          }
          delete model.backgroundImage; // 无兜底 → 回退主题渐变，不画占位
        }));

        Promise.all(jobs).then(() => {
          try {
            const layout = computeLayout(model, {}, measure);
            // 引擎按 340 逻辑宽布局；画布元素实际 css 宽 cssW → 等比缩放绘制，清晰不变形
            const k = cssW / layout.width;
            canvas.width = Math.round(layout.width * k * dpr);
            canvas.height = Math.round(layout.height * k * dpr);
            ctx.scale(dpr * k, dpr * k);
            draw(ctx, layout);
            page._cardCanvasNode = canvas;
            page.setData({ canvasH: Math.round(layout.height * k), rendered: true, err: '' });
            resolve({ layout, canvasNode: canvas });
          } catch (e) {
            reject(new Error('卡片渲染失败：' + ((e && e.message) || e || '未知错误')));
          }
        }).catch(reject);
      } catch (e) {
        reject(new Error('卡片渲染失败：' + ((e && e.message) || e || '未知错误')));
      }
    });
  });
}

// 保存当前已渲染的 canvas 到相册并记录本地历史。
// opts = { savingKey, historyTool, historyRecord }
function saveCanvas(page, opts) {
  opts = opts || {};
  if (!page._cardCanvasNode) {
    wx.showToast({ title: '请先制作卡片', icon: 'none' });
    return Promise.reject(new Error('no canvas'));
  }
  return exportAndSave(page, page._cardCanvasNode, {
    savingKey: opts.savingKey || '_saving',
    historyTool: opts.historyTool,
    historyRecord: opts.historyRecord || {}
  }).then(() => true);
}

module.exports = { renderCard, saveCanvas, QR_PATH, getDpr };
