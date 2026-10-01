// utils/share.js
// ─────────────────────────────────────────────────────────────────────────
// 分享/保存闭环封装（P6 · 2026-10-01）
// 借鉴 Superljf poster 的稳定性实践：
//   ① 防重复提交（页面级 saving 标记，保存中再点直接拒绝）
//   ② 导出后文件校验（tempFilePath 为空视为失败，不允许假成功）
//   ③ 保存成功 → 自动写入本地历史（utils/history）
//   ④ 相册权限类失败由 album.js 内部引导去设置，这里不重复打扰
//   ⑤ 统一 onShareAppMessage 配置出口
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const { saveImageToAlbum } = require('./album');
const { addHistory } = require('./history');

// 导出 canvas → 存相册 → 记历史。失败 reject（带 errMsg），成功 resolve(tempFilePath)
function exportAndSave(page, canvasNode, opts) {
  opts = opts || {};
  const key = opts.savingKey || '_saving';
  return new Promise((resolve, reject) => {
    if (!canvasNode) { reject(new Error('画布未生成')); return; }
    if (page[key]) { reject(new Error('busy')); return; } // 防重复提交
    page[key] = true;
    wx.canvasToTempFilePath({
      canvas: canvasNode,
      success(r) {
        const p = r && r.tempFilePath;
        if (!p) { page[key] = false; reject(new Error('导出文件为空')); return; } // 文件校验
        saveImageToAlbum(p).then(() => {
          if (opts.historyTool) addHistory(opts.historyTool, opts.historyRecord || {});
          page[key] = false;
          resolve(p);
        }).catch((e) => { page[key] = false; reject(e); });
      },
      fail(e) { page[key] = false; reject(e || new Error('导出失败')); }
    });
  });
}

// 统一分享配置（onShareAppMessage 用）
function shareConfig(title, path) {
  return { title: title || 'dudu 画面感', path: path || '/pages/index/index' };
}

module.exports = { exportAndSave, shareConfig };
