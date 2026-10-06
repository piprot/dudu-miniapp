// utils/bg_pack.js —— 内置压缩兜底背景图（2026-10-06）
//
// ── 为什么要有这一层 ──────────────────────────────────────────────────
// utils/photo_lib.js 是**网络图库**（picsum 固定 ID，100 张），但它有一个硬前提：
// canvas createImage() 加载网络图受小程序后台 downloadFile 合法域名管辖。
// 白名单没配 / 配错 / 用户断网 / 境外图源抖动 → 背景图加载失败。
//
// 用户诉求原文：「内置一组压缩兜底图，网络图库作为增强项」。
// 于是把背景来源拆成两级：
//   一级·内置兜底（本地包内路径，零网络、零等待、零白名单，永远能出图）
//   二级·网络图库（picsum 100 张，配置了白名单才有额外选择，是「增强」不是「前提」）
//
// ── 图源与压缩规格 ────────────────────────────────────────────────────
// 图源：picsum.photos 固定 ID（与 photo_lib 同源，picsum 上游为 Unsplash），
//      每张保留 author / source 便于署名与溯源，与 photo_lib 口径一致。
// 选图：16 张，作者尽量分散（同一作者的图色调相近，连着选视觉重复）。
// 尺寸：500 x 667（原 750x1000 等比缩小）。
//      画布逻辑宽 340，dpr 常见 2~3 → 物理像素 680~1020；
//      背景是cover-fit 铺满+ 暗色蒙版（render_engine 0.32→0.52），
//      文字在上层，本身不追求极致锐度，500 宽足够且省一半体积。
// 压缩：JPEG quality 46 + progressive + optimize，单张 10~59KB，合计 445KB。
//      ⚠️ 一律 JPEG，**禁止 webp**（真机 <image> 不支持 webp → 整片空白，见 R9 红线）。
//
// ── 为什么内置图也能切「灰度/虚化/原图」三档 ──────────────────────────
// 网络图的 gray/blur 是 picsum 服务端参数（?grayscale / ?blur=6），本地包内图没有服务端。
// 所以内置图改用**引擎暗色蒙版强度**来近似：gray 加厚蒙版（压暗+弱化色彩冲突）、
// blur 用中等蒙版、raw 用较薄蒙版。见 render_engine 的 bgVeil 支持。
// 视觉上不是真灰度/真高斯模糊，但**保证文字可读性**这一实际目的达到了，
// 且省掉三份图（否则 445KB 直接变1.3MB+）。

const BUILTIN = [
  { id: 'bg00', picsumId: '0', path: '/images/bg/bg00.jpg', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/yC-Yzbqy7PY' },
  { id: 'bg10', picsumId: '10', path: '/images/bg/bg10.jpg', author: 'Paul Jarvis', source: 'unsplash.com/photos/6J--NXulQCs' },
  { id: 'bg20', picsumId: '20', path: '/images/bg/bg20.jpg', author: 'Aleks Dorohovich', source: 'unsplash.com/photos/nJdwUHmaY8A' },
  { id: 'bg26', picsumId: '26', path: '/images/bg/bg26.jpg', author: 'Vadim Sherbakov', source: 'unsplash.com/photos/tCICLJ5ktBE' },
  { id: 'bg27', picsumId: '27', path: '/images/bg/bg27.jpg', author: 'Yoni Kaplan-Nadel', source: 'unsplash.com/photos/iJnZwLBOB1I' },
  { id: 'bg28', picsumId: '28', path: '/images/bg/bg28.jpg', author: 'Jerry Adney', source: 'unsplash.com/photos/_WiFMBRT7Aw' },
  { id: 'bg29', picsumId: '29', path: '/images/bg/bg29.jpg', author: 'Go Wild', source: 'unsplash.com/photos/V0yAek6BgGk' },
  { id: 'bg30', picsumId: '30', path: '/images/bg/bg30.jpg', author: 'Shyamanta Baruah', source: 'unsplash.com/photos/aeVA-j1y2BY' },
  { id: 'bg31', picsumId: '31', path: '/images/bg/bg31.jpg', author: 'How-Soon Ngu', source: 'unsplash.com/photos/7Vz3DtQDT3Q' },
  { id: 'bg32', picsumId: '32', path: '/images/bg/bg32.jpg', author: 'Rodrigo Melo', source: 'unsplash.com/photos/eG3k60PrTGY' },
  { id: 'bg35', picsumId: '35', path: '/images/bg/bg35.jpg', author: 'Shane Colella', source: 'unsplash.com/photos/znM0ujn2RUA' },
  { id: 'bg37', picsumId: '37', path: '/images/bg/bg37.jpg', author: 'Austin Neill', source: 'unsplash.com/photos/erTjj730fMk' },
  { id: 'bg38', picsumId: '38', path: '/images/bg/bg38.jpg', author: 'Allyson Souza', source: 'unsplash.com/photos/JabLtzJl8bc' },
  { id: 'bg39', picsumId: '39', path: '/images/bg/bg39.jpg', author: 'Luke Chesser', source: 'unsplash.com/photos/pFqrYbhIAXs' },
  { id: 'bg40', picsumId: '40', path: '/images/bg/bg40.jpg', author: 'Ryan Mcguire', source: 'unsplash.com/photos/N-1XGL54pQg' },
  { id: 'bg41', picsumId: '41', path: '/images/bg/bg41.jpg', author: 'Nithya Ramanujam', source: 'unsplash.com/photos/fTKetYpEKNQ' }
];

const BY_ID = {};
for (const b of BUILTIN) BY_ID[b.id] = b;

/** 本地包内路径。未知 id 返回空串（防dataset 注入任意路径）。 */
function pathOf(id) {
  return BY_ID[id] ? BY_ID[id].path : '';
}

/** 缩略图/大图同源（包内图没有多档尺寸，统一用同一张，靠 CSS 缩放）。 */
function urlOf(id) { return pathOf(id); }

function authorOf(id) { const b = BY_ID[id]; return b ? b.author : ''; }
function sourceOf(id) { const b = BY_ID[id]; return b ? b.source : ''; }
function has(id) { return !!BY_ID[id]; }

/** 清单（wxml 循环渲染缩略图）。 */
function listAll() {
  return BUILTIN.map(b => ({ id: b.id, author: b.author, url: b.path }));
}

/** 全库 id 顺序（换一张时按此循环）。 */
function ids() { return BUILTIN.map(b => b.id); }

function stats() {
  return { total: BUILTIN.length, authors: new Set(BUILTIN.map(b => b.author)).size };
}

module.exports = { BUILTIN, pathOf, urlOf, authorOf, sourceOf, has, listAll, ids, stats };
