// utils/themes/index.js
// ─────────────────────────────────────────────────────────────────────────────
// 数据化主题系统（2026-10-01 整体重构）
//
// 借鉴 isjiamu/gzh-design-skill 的「主题 = 角色化色板」思路：每套主题不是拍脑袋配色，
// 而是固定的角色分工（主色 / 浅底 / 灰阶 / 点睛 / 下划线），保证产出下限稳定、风格不飘。
// 克制三原则（沿用其方法论）：
//   ① 主色只在锚点出现（标题/强调/封面色），大面积留白+灰阶承重（≈90% 文字交给中性灰阶）；
//   ② 彩色只做点缀，一段内高亮 ≤ 2 种；
//   ③ 主题可切换、可扩展——新增一套只需在此追加一个对象，渲染引擎自动读取。
//
// 主题字段：
//   id, name, scene  标识与适用场景
//   colors.bg        [c1, c2] 画布渐变（cards/poster 背景）
//   colors.bgSolid   纯色兜底（无渐变时）
//   colors.primary   主色（锚点强调）
//   colors.bgSoft    主色系浅底（卡片/引用块/标签底）
//   colors.ink       正文主色（深灰阶）
//   colors.sub       次要文字（中灰阶）
//   colors.line      分割线
//   colors.accent    点睛高亮（与主色冷暖对比的第二色）
//   colors.underline 关键词下划线（主色浅版）
//   cjkFont          中文字体栈
//   radius           圆角基准
//   spacing          间距基准
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const THEMES = {
  warm: {
    id: 'warm', name: '暖橙', scene: '教程 / 测评 / 清单 / 工具盘点',
    colors: {
      bg: ['#fff3e8', '#ffe2c6'], bgSolid: '#fff6ee',
      primary: '#E8833A', bgSoft: '#fde9d8',
      ink: '#3a2f28', sub: '#8a7a6e', line: '#ecd9c6',
      accent: '#2f9e8f', underline: '#f7c9a3'
    },
    cjkFont: '"PingFang SC", "Microsoft YaHei", sans-serif', radius: 16, spacing: 16
  },
  fresh: {
    id: 'fresh', name: '清新绿', scene: '生活 / 知识 / 治愈 / 公众号',
    colors: {
      bg: ['#eef8f1', '#d6efe0'], bgSolid: '#f1faf3',
      primary: '#059669', bgSoft: '#d8f0e4',
      ink: '#243a30', sub: '#6f8a7e', line: '#cfe7da',
      accent: '#e0a32e', underline: '#a7e3c8'
    },
    cjkFont: '"PingFang SC", "Microsoft YaHei", sans-serif', radius: 16, spacing: 16
  },
  graphite: {
    id: 'graphite', name: '石墨极简', scene: '设计 / 科技评论 / 专业观点',
    colors: {
      bg: ['#fafafa', '#ededed'], bgSolid: '#f6f6f6',
      primary: '#52525B', bgSoft: '#ececec',
      ink: '#1f2024', sub: '#7a7d85', line: '#e2e2e2',
      accent: '#2563eb', underline: '#c9c9cf'
    },
    cjkFont: '"PingFang SC", "Microsoft YaHei", sans-serif', radius: 10, spacing: 14
  },
  zen: {
    id: 'zen', name: '留白禅意', scene: '极简生活 / 深度随笔',
    colors: {
      bg: ['#f6f5f1', '#e9e7df'], bgSolid: '#f4f3ef',
      primary: '#4A5D52', bgSoft: '#e3e8e2',
      ink: '#33372f', sub: '#8b8d82', line: '#dddcd2',
      accent: '#b08442', underline: '#c3cfc6'
    },
    cjkFont: '"Songti SC", "SimSun", serif', radius: 8, spacing: 20
  },
  ticket: {
    id: 'ticket', name: '票据风', scene: '工具对比 / 创意评测',
    colors: {
      bg: ['#fff8ec', '#fdeecb'], bgSolid: '#fffaf0',
      primary: '#D97706', bgSoft: '#fdeecb',
      ink: '#3a3022', sub: '#8a7a5e', line: '#ecdcb6',
      accent: '#0e7490', underline: '#f6d99a'
    },
    cjkFont: '"PingFang SC", "Microsoft YaHei", sans-serif', radius: 6, spacing: 14
  },
  olive: {
    id: 'olive', name: '橄榄手记', scene: '内刊手记 / 深度评测 / 案例复盘',
    colors: {
      bg: ['#23241f', '#2c2d27'], bgSolid: '#23241f',
      primary: '#c9b27e', bgSoft: '#33342c',
      ink: '#f1ede2', sub: '#a9a596', line: '#3d3e36',
      accent: '#7fa06a', underline: '#6f6450'
    },
    cjkFont: '"Songti SC", "SimSun", serif', radius: 8, spacing: 16
  }
};

const THEME_LIST = Object.keys(THEMES).map(k => THEMES[k]);

function getTheme(id) {
  return THEMES[id] || THEMES.warm;
}

// 给定主题，返回一套可直接喂给渲染引擎的「背景/文字色」快捷表（供各工具复用）
function palette(id) {
  const t = getTheme(id);
  const c = t.colors;
  return {
    bg: c.bg, bgSolid: c.bgSolid,
    ink: c.ink, sub: c.sub, line: c.line,
    primary: c.primary, bgSoft: c.bgSoft, accent: c.accent, underline: c.underline,
    cjkFont: t.cjkFont, radius: t.radius, spacing: t.spacing
  };
}

module.exports = { THEMES, THEME_LIST, getTheme, palette };
