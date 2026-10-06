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
// 选图：60 张，作者尽量分散——同一作者的图色调相近，连着选视觉会重复。
//      picsum 清单 100 张里共 59 位不同作者，所以「每作者 1 张」最多凑 59 张，
//      第 60 张必然有1 位作者取到第 2 张（Alejandro Escamilla）。
//      这是清单容量的硬约束，不是偷懒，测试对此有断言。
// ── 深色调处理（关键：这是「背景图」，上方要压白字）───────────────────
// 实测原图亮度：57~ 206，其中 **42/60 张偏亮**（>120），最亮的 bg58/bg22/bg03
// 有 90%+ 像素落在亮区 —— 白字压上去基本不可读。
// 所以入库前统一做**色调映射压暗**：把每张的平均亮度线性映射到
// [52, 88] 区间，再轻微降饱和 0.85（色彩不与白字抢）。
// 为什么不直接换暗图：picsum 图源亮度不可控，靠挑图赌运气不可靠；
// 色调映射是确定性的，且区间收敛后每张都必然合格。
// 为什么压到区间而非固定值：全部压成同一亮度会让 60 张看起来像同一张图，
// 区间收敛既能保证白字可读，又保留照片本身的明暗层次。
// 压暗后实测 48.2 ~ 85.8（均值 70.2），**0 张过亮、0 张过黑**。
//
// 附带好处：暗部细节少，JPEG 压缩更省 —— 压暗后体积不增反降 33.8%
// （q40 时 977KB → 647KB），腾出的余量用来把画质提回 480x640/q46。
//
// 尺寸：480 x 640（源图 750x1000 等比缩小）。
//      卡片逻辑宽 340，dpr2 → 680 物理像素；480 宽在 dpr2 下仅差 29%，
//      且背景是 cover-fit 铺满 + 暗色蒙版 + 文字压上层，不追求极致锐度。
// 压缩：JPEG quality 46 + progressive + optimize，单张约 16KB，合计 973KB。
//      ⚠️ 一律 JPEG，**禁止 webp**（真机 <image> 不支持 webp → 整片空白，见 R9 红线）。
//
// ⚠️ 包体预算：基础包体 870KB + 本目录 973KB = 1848KB / 2048KB（90.1%，仅余 200KB）。
//    **主包超限是上传直接失败，不是警告**。再加任何资源前必须先跑
//    `node tools_local/pack_volume.js` 核算。新增图片务必先实测体积再决定尺寸。
//
// ⚠️ 换图/重新压缩时**必须复核平均亮度**（见 test_content_library.js 的守卫）：
//    工具：PIL ImageStat 灰度均值，落在 40~100 之间才算合格背景图。
//
// ── 为什么内置图也能切「灰度/虚化/原图」三档 ──────────────────────────
// 网络图的 gray/blur 是 picsum 服务端参数（?grayscale / ?blur=6），本地包内图没有服务端。
// 所以内置图改用**引擎暗色蒙版强度**来近似：gray 加厚蒙版（压暗+弱化色彩冲突）、
// blur 用中等蒙版、raw 用较薄蒙版。见 render_engine 的 bgVeil 支持。
// 视觉上不是真灰度/真高斯模糊，但**保证文字可读性**这一实际目的达到了，
// 且省掉三份图（否则 978KB 直接变2.9MB+，包体直接爆）。

const BUILTIN = [
  { id: 'bg01', picsumId: '0', path: '/images/bg/bg01.jpg', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/yC-Yzbqy7PY', lum: 54.7 },
  { id: 'bg02', picsumId: '10', path: '/images/bg/bg02.jpg', author: 'Paul Jarvis', source: 'unsplash.com/photos/6J--NXulQCs', lum: 64.5 },
  { id: 'bg03', picsumId: '20', path: '/images/bg/bg03.jpg', author: 'Aleks Dorohovich', source: 'unsplash.com/photos/nJdwUHmaY8A', lum: 85.0 },
  { id: 'bg04', picsumId: '26', path: '/images/bg/bg04.jpg', author: 'Vadim Sherbakov', source: 'unsplash.com/photos/tCICLJ5ktBE', lum: 60.4 },
  { id: 'bg05', picsumId: '27', path: '/images/bg/bg05.jpg', author: 'Yoni Kaplan-Nadel', source: 'unsplash.com/photos/iJnZwLBOB1I', lum: 72.7 },
  { id: 'bg06', picsumId: '28', path: '/images/bg/bg06.jpg', author: 'Jerry Adney', source: 'unsplash.com/photos/_WiFMBRT7Aw', lum: 66.2 },
  { id: 'bg07', picsumId: '29', path: '/images/bg/bg07.jpg', author: 'Go Wild', source: 'unsplash.com/photos/V0yAek6BgGk', lum: 67.1 },
  { id: 'bg08', picsumId: '30', path: '/images/bg/bg08.jpg', author: 'Shyamanta Baruah', source: 'unsplash.com/photos/aeVA-j1y2BY', lum: 75.6 },
  { id: 'bg09', picsumId: '31', path: '/images/bg/bg09.jpg', author: 'How-Soon Ngu', source: 'unsplash.com/photos/7Vz3DtQDT3Q', lum: 74.0 },
  { id: 'bg10', picsumId: '32', path: '/images/bg/bg10.jpg', author: 'Rodrigo Melo', source: 'unsplash.com/photos/eG3k60PrTGY', lum: 79.3 },
  { id: 'bg11', picsumId: '35', path: '/images/bg/bg11.jpg', author: 'Shane Colella', source: 'unsplash.com/photos/znM0ujn2RUA', lum: 71.6 },
  { id: 'bg12', picsumId: '37', path: '/images/bg/bg12.jpg', author: 'Austin Neill', source: 'unsplash.com/photos/erTjj730fMk', lum: 80.9 },
  { id: 'bg13', picsumId: '38', path: '/images/bg/bg13.jpg', author: 'Allyson Souza', source: 'unsplash.com/photos/JabLtzJl8bc', lum: 66.5 },
  { id: 'bg14', picsumId: '39', path: '/images/bg/bg14.jpg', author: 'Luke Chesser', source: 'unsplash.com/photos/pFqrYbhIAXs', lum: 74.9 },
  { id: 'bg15', picsumId: '40', path: '/images/bg/bg15.jpg', author: 'Ryan Mcguire', source: 'unsplash.com/photos/N-1XGL54pQg', lum: 74.9 },
  { id: 'bg16', picsumId: '41', path: '/images/bg/bg16.jpg', author: 'Nithya Ramanujam', source: 'unsplash.com/photos/fTKetYpEKNQ', lum: 70.6 },
  { id: 'bg17', picsumId: '43', path: '/images/bg/bg17.jpg', author: 'Oleg Chursin', source: 'unsplash.com/photos/IoCWq07GaG4', lum: 61.9 },
  { id: 'bg18', picsumId: '44', path: '/images/bg/bg18.jpg', author: 'Christopher Sardegna', source: 'unsplash.com/photos/R1E6x8U83Ho', lum: 70.8 },
  { id: 'bg19', picsumId: '45', path: '/images/bg/bg19.jpg', author: 'Alan Haverty', source: 'unsplash.com/photos/-XA-fTYYfV0', lum: 65.7 },
  { id: 'bg20', picsumId: '46', path: '/images/bg/bg20.jpg', author: 'Jeffrey Kam', source: 'unsplash.com/photos/Nzw3HHsNHYU', lum: 72.3 },
  { id: 'bg21', picsumId: '49', path: '/images/bg/bg21.jpg', author: 'Margaret Barley', source: 'unsplash.com/photos/Qo51KwK1dKg', lum: 81.0 },
  { id: 'bg22', picsumId: '50', path: '/images/bg/bg22.jpg', author: 'Tyler Wanlass', source: 'unsplash.com/photos/L7MpmBGpM94', lum: 84.7 },
  { id: 'bg23', picsumId: '51', path: '/images/bg/bg23.jpg', author: 'Ireneuilia', source: 'unsplash.com/photos/knYQ6arClBE', lum: 81.0 },
  { id: 'bg24', picsumId: '52', path: '/images/bg/bg24.jpg', author: 'Cierra', source: 'unsplash.com/photos/57vHdjeZ0yg', lum: 78.0 },
  { id: 'bg25', picsumId: '53', path: '/images/bg/bg25.jpg', author: 'J Duclos', source: 'unsplash.com/photos/6qORI5j_6n8', lum: 67.2 },
  { id: 'bg26', picsumId: '54', path: '/images/bg/bg26.jpg', author: 'Nicholas Swanson', source: 'unsplash.com/photos/d19by2PLaPc', lum: 70.1 },
  { id: 'bg27', picsumId: '56', path: '/images/bg/bg27.jpg', author: 'Sebastian Muller', source: 'unsplash.com/photos/VLdaxYyXJvw', lum: 70.7 },
  { id: 'bg28', picsumId: '58', path: '/images/bg/bg28.jpg', author: 'Tony Naccarato', source: 'unsplash.com/photos/-kEr-QltARg', lum: 71.0 },
  { id: 'bg29', picsumId: '59', path: '/images/bg/bg29.jpg', author: 'Art Wave', source: 'unsplash.com/photos/algEQavPY4M', lum: 83.3 },
  { id: 'bg30', picsumId: '61', path: '/images/bg/bg30.jpg', author: 'Alex', source: 'unsplash.com/photos/zMz14hsbpuU', lum: 71.1 },
  { id: 'bg31', picsumId: '62', path: '/images/bg/bg31.jpg', author: 'Daniel Genser', source: 'unsplash.com/photos/PzPbh-faPgU', lum: 64.5 },
  { id: 'bg32', picsumId: '63', path: '/images/bg/bg32.jpg', author: 'Justin Leibow', source: 'unsplash.com/photos/ZJsseAxEcqM', lum: 59.5 },
  { id: 'bg33', picsumId: '64', path: '/images/bg/bg33.jpg', author: 'Alexander Shustov', source: 'unsplash.com/photos/AHBiSKaENwc', lum: 80.5 },
  { id: 'bg34', picsumId: '67', path: '/images/bg/bg34.jpg', author: 'Rula Sibai', source: 'unsplash.com/photos/QbkGwv3xtmQ', lum: 69.1 },
  { id: 'bg35', picsumId: '68', path: '/images/bg/bg35.jpg', author: 'Cristian Moscoso', source: 'unsplash.com/photos/2SfRAWkinpU', lum: 74.4 },
  { id: 'bg36', picsumId: '70', path: '/images/bg/bg36.jpg', author: 'Dorothy Lin', source: 'unsplash.com/photos/OokBLPrkCNk', lum: 71.9 },
  { id: 'bg37', picsumId: '71', path: '/images/bg/bg37.jpg', author: 'Jon Eckert', source: 'unsplash.com/photos/IoIbdFdGCnQ', lum: 67.1 },
  { id: 'bg38', picsumId: '72', path: '/images/bg/bg38.jpg', author: 'Tyler Finck', source: 'unsplash.com/photos/Cs4QZdHrHt4', lum: 62.9 },
  { id: 'bg39', picsumId: '74', path: '/images/bg/bg39.jpg', author: 'Isaak Dury', source: 'unsplash.com/photos/YhZbnxqtooM', lum: 81.4 },
  { id: 'bg40', picsumId: '75', path: '/images/bg/bg40.jpg', author: 'Jassy Onyae', source: 'unsplash.com/photos/1gBUXhf0PtA', lum: 69.5 },
  { id: 'bg41', picsumId: '77', path: '/images/bg/bg41.jpg', author: 'May Pamintuan', source: 'unsplash.com/photos/j9nfqTi5T5o', lum: 81.6 },
  { id: 'bg42', picsumId: '78', path: '/images/bg/bg42.jpg', author: 'Paul Evans', source: 'unsplash.com/photos/CtkDsu4w-Rs', lum: 65.5 },
  { id: 'bg43', picsumId: '80', path: '/images/bg/bg43.jpg', author: 'Sonja Langford', source: 'unsplash.com/photos/Y2PYfopoz-k', lum: 68.1 },
  { id: 'bg44', picsumId: '81', path: '/images/bg/bg44.jpg', author: 'Sander Weeteling', source: 'unsplash.com/photos/rlxZqmc6D_I', lum: 66.2 },
  { id: 'bg45', picsumId: '83', path: '/images/bg/bg45.jpg', author: 'Julie Geiger', source: 'unsplash.com/photos/dYshDcTI1Js', lum: 55.2 },
  { id: 'bg46', picsumId: '84', path: '/images/bg/bg46.jpg', author: 'Johnny Lam', source: 'unsplash.com/photos/63qfL0TciY8', lum: 50.5 },
  { id: 'bg47', picsumId: '85', path: '/images/bg/bg47.jpg', author: 'Gozha Net', source: 'unsplash.com/photos/xDrxJCdedcI', lum: 80.7 },
  { id: 'bg48', picsumId: '87', path: '/images/bg/bg48.jpg', author: 'Barcelona', source: 'unsplash.com/photos/o697BgRH_-M', lum: 72.9 },
  { id: 'bg49', picsumId: '89', path: '/images/bg/bg49.jpg', author: 'Vectorbeast', source: 'unsplash.com/photos/rsJtMXn3p_c', lum: 66.1 },
  { id: 'bg50', picsumId: '91', path: '/images/bg/bg50.jpg', author: 'Jennifer Trovato', source: 'unsplash.com/photos/baRYCsjO6z4', lum: 48.2 },
  { id: 'bg51', picsumId: '92', path: '/images/bg/bg51.jpg', author: 'Rafael Souza', source: 'unsplash.com/photos/QxkBP3A9XmU', lum: 67.6 },
  { id: 'bg52', picsumId: '93', path: '/images/bg/bg52.jpg', author: 'Caroline Sada', source: 'unsplash.com/photos/r1XwWjI4PyE', lum: 71.5 },
  { id: 'bg53', picsumId: '94', path: '/images/bg/bg53.jpg', author: 'Jean Kleisz', source: 'unsplash.com/photos/4yzPVohNuVI', lum: 58.8 },
  { id: 'bg54', picsumId: '95', path: '/images/bg/bg54.jpg', author: 'Kundan Ramisetti', source: 'unsplash.com/photos/87TJNWkepvI', lum: 67.4 },
  { id: 'bg55', picsumId: '96', path: '/images/bg/bg55.jpg', author: 'Pawel Kadysz', source: 'unsplash.com/photos/CuFYW1c97w8', lum: 67.5 },
  { id: 'bg56', picsumId: '98', path: '/images/bg/bg56.jpg', author: 'Laurice Solomon', source: 'unsplash.com/photos/ThJIf6Q0b2s', lum: 69.1 },
  { id: 'bg57', picsumId: '99', path: '/images/bg/bg57.jpg', author: 'Jon Toney', source: 'unsplash.com/photos/xyDQNmT6vSs', lum: 67.3 },
  { id: 'bg58', picsumId: '100', path: '/images/bg/bg58.jpg', author: 'Tina Rataj', source: 'unsplash.com/photos/pwaaqfoMibI', lum: 85.8 },
  { id: 'bg59', picsumId: '101', path: '/images/bg/bg59.jpg', author: 'Christian Bardenhorst', source: 'unsplash.com/photos/8lMhzUjD1Wk', lum: 78.5 },
  { id: 'bg60', picsumId: '1', path: '/images/bg/bg60.jpg', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/LNRyGwIJr5c', lum: 58.4 }
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
  return BUILTIN.map(b => ({ id: b.id, author: b.author, url: b.path, lum: b.lum }));
}

/** 全库 id 顺序（换一张时按此循环）。 */
function ids() { return BUILTIN.map(b => b.id); }

/**
 * 合格亮度区间。这是「背景图」——上方要压白字，太亮白字不可读，太黑失去层次。
 * 换图/ 重新压缩后若stats().lumOutliers > 0，说明有图不合格，必须重做色调映射。
 */
const LUM_MIN = 40;
const LUM_MAX = 100;

function stats() {
  const lums = BUILTIN.map(b => b.lum).filter(v => typeof v === 'number');
  return {
    total: BUILTIN.length,
    authors: new Set(BUILTIN.map(b => b.author)).size,
    lumMin: Math.min.apply(null, lums),
    lumMax: Math.max.apply(null, lums),
    lumAvg: Math.round(lums.reduce((a, c) => a + c, 0) / lums.length * 10) / 10,
    lumOutliers: lums.filter(v => v < LUM_MIN || v > LUM_MAX).length,
    lumMissing: BUILTIN.length - lums.length,
  };
}

module.exports = { BUILTIN, pathOf, urlOf, authorOf, sourceOf, has, listAll, ids, stats, LUM_MIN, LUM_MAX };
