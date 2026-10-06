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
// 尺寸：400 x 533（源图750x1000 等比缩小）。
//      卡片逻辑宽 340，dpr2 → 680 物理像素、dpr3 → 1020；
//      400 宽在 dpr2 下仅差 16%，且背景是 cover-fit 铺满 + 暗色蒙版
//      （render_engine 0.32→0.52）+ 文字压上层，不追求极致锐度。
//压缩：JPEG quality 40 + progressive + optimize，单张 10~23KB，合计 978KB。
//      ⚠️ 一律 JPEG，**禁止 webp**（真机 <image> 不支持 webp → 整片空白，见 R9 红线）。
//
// ⚠️ 包体预算：基础包体 864KB + 本目录 978KB = 1842KB / 2048KB（89.9%，仅余 206KB）。
//    **主包超限是上传直接失败，不是警告**。再加任何资源前必须先跑
//    `node tools_local/pack_volume.js` 核算。新增图片务必先实测体积再决定尺寸。
//
// ── 为什么内置图也能切「灰度/虚化/原图」三档 ──────────────────────────
// 网络图的 gray/blur 是 picsum 服务端参数（?grayscale / ?blur=6），本地包内图没有服务端。
// 所以内置图改用**引擎暗色蒙版强度**来近似：gray 加厚蒙版（压暗+弱化色彩冲突）、
// blur 用中等蒙版、raw 用较薄蒙版。见 render_engine 的 bgVeil 支持。
// 视觉上不是真灰度/真高斯模糊，但**保证文字可读性**这一实际目的达到了，
// 且省掉三份图（否则 978KB 直接变2.9MB+，包体直接爆）。

const BUILTIN = [
  { id: 'bg01', picsumId: '0', path: '/images/bg/bg01.jpg', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/yC-Yzbqy7PY' },
  { id: 'bg02', picsumId: '10', path: '/images/bg/bg02.jpg', author: 'Paul Jarvis', source: 'unsplash.com/photos/6J--NXulQCs' },
  { id: 'bg03', picsumId: '20', path: '/images/bg/bg03.jpg', author: 'Aleks Dorohovich', source: 'unsplash.com/photos/nJdwUHmaY8A' },
  { id: 'bg04', picsumId: '26', path: '/images/bg/bg04.jpg', author: 'Vadim Sherbakov', source: 'unsplash.com/photos/tCICLJ5ktBE' },
  { id: 'bg05', picsumId: '27', path: '/images/bg/bg05.jpg', author: 'Yoni Kaplan-Nadel', source: 'unsplash.com/photos/iJnZwLBOB1I' },
  { id: 'bg06', picsumId: '28', path: '/images/bg/bg06.jpg', author: 'Jerry Adney', source: 'unsplash.com/photos/_WiFMBRT7Aw' },
  { id: 'bg07', picsumId: '29', path: '/images/bg/bg07.jpg', author: 'Go Wild', source: 'unsplash.com/photos/V0yAek6BgGk' },
  { id: 'bg08', picsumId: '30', path: '/images/bg/bg08.jpg', author: 'Shyamanta Baruah', source: 'unsplash.com/photos/aeVA-j1y2BY' },
  { id: 'bg09', picsumId: '31', path: '/images/bg/bg09.jpg', author: 'How-Soon Ngu', source: 'unsplash.com/photos/7Vz3DtQDT3Q' },
  { id: 'bg10', picsumId: '32', path: '/images/bg/bg10.jpg', author: 'Rodrigo Melo', source: 'unsplash.com/photos/eG3k60PrTGY' },
  { id: 'bg11', picsumId: '35', path: '/images/bg/bg11.jpg', author: 'Shane Colella', source: 'unsplash.com/photos/znM0ujn2RUA' },
  { id: 'bg12', picsumId: '37', path: '/images/bg/bg12.jpg', author: 'Austin Neill', source: 'unsplash.com/photos/erTjj730fMk' },
  { id: 'bg13', picsumId: '38', path: '/images/bg/bg13.jpg', author: 'Allyson Souza', source: 'unsplash.com/photos/JabLtzJl8bc' },
  { id: 'bg14', picsumId: '39', path: '/images/bg/bg14.jpg', author: 'Luke Chesser', source: 'unsplash.com/photos/pFqrYbhIAXs' },
  { id: 'bg15', picsumId: '40', path: '/images/bg/bg15.jpg', author: 'Ryan Mcguire', source: 'unsplash.com/photos/N-1XGL54pQg' },
  { id: 'bg16', picsumId: '41', path: '/images/bg/bg16.jpg', author: 'Nithya Ramanujam', source: 'unsplash.com/photos/fTKetYpEKNQ' },
  { id: 'bg17', picsumId: '43', path: '/images/bg/bg17.jpg', author: 'Oleg Chursin', source: 'unsplash.com/photos/IoCWq07GaG4' },
  { id: 'bg18', picsumId: '44', path: '/images/bg/bg18.jpg', author: 'Christopher Sardegna', source: 'unsplash.com/photos/R1E6x8U83Ho' },
  { id: 'bg19', picsumId: '45', path: '/images/bg/bg19.jpg', author: 'Alan Haverty', source: 'unsplash.com/photos/-XA-fTYYfV0' },
  { id: 'bg20', picsumId: '46', path: '/images/bg/bg20.jpg', author: 'Jeffrey Kam', source: 'unsplash.com/photos/Nzw3HHsNHYU' },
  { id: 'bg21', picsumId: '49', path: '/images/bg/bg21.jpg', author: 'Margaret Barley', source: 'unsplash.com/photos/Qo51KwK1dKg' },
  { id: 'bg22', picsumId: '50', path: '/images/bg/bg22.jpg', author: 'Tyler Wanlass', source: 'unsplash.com/photos/L7MpmBGpM94' },
  { id: 'bg23', picsumId: '51', path: '/images/bg/bg23.jpg', author: 'Ireneuilia', source: 'unsplash.com/photos/knYQ6arClBE' },
  { id: 'bg24', picsumId: '52', path: '/images/bg/bg24.jpg', author: 'Cierra', source: 'unsplash.com/photos/57vHdjeZ0yg' },
  { id: 'bg25', picsumId: '53', path: '/images/bg/bg25.jpg', author: 'J Duclos', source: 'unsplash.com/photos/6qORI5j_6n8' },
  { id: 'bg26', picsumId: '54', path: '/images/bg/bg26.jpg', author: 'Nicholas Swanson', source: 'unsplash.com/photos/d19by2PLaPc' },
  { id: 'bg27', picsumId: '56', path: '/images/bg/bg27.jpg', author: 'Sebastian Muller', source: 'unsplash.com/photos/VLdaxYyXJvw' },
  { id: 'bg28', picsumId: '58', path: '/images/bg/bg28.jpg', author: 'Tony Naccarato', source: 'unsplash.com/photos/-kEr-QltARg' },
  { id: 'bg29', picsumId: '59', path: '/images/bg/bg29.jpg', author: 'Art Wave', source: 'unsplash.com/photos/algEQavPY4M' },
  { id: 'bg30', picsumId: '61', path: '/images/bg/bg30.jpg', author: 'Alex', source: 'unsplash.com/photos/zMz14hsbpuU' },
  { id: 'bg31', picsumId: '62', path: '/images/bg/bg31.jpg', author: 'Daniel Genser', source: 'unsplash.com/photos/PzPbh-faPgU' },
  { id: 'bg32', picsumId: '63', path: '/images/bg/bg32.jpg', author: 'Justin Leibow', source: 'unsplash.com/photos/ZJsseAxEcqM' },
  { id: 'bg33', picsumId: '64', path: '/images/bg/bg33.jpg', author: 'Alexander Shustov', source: 'unsplash.com/photos/AHBiSKaENwc' },
  { id: 'bg34', picsumId: '67', path: '/images/bg/bg34.jpg', author: 'Rula Sibai', source: 'unsplash.com/photos/QbkGwv3xtmQ' },
  { id: 'bg35', picsumId: '68', path: '/images/bg/bg35.jpg', author: 'Cristian Moscoso', source: 'unsplash.com/photos/2SfRAWkinpU' },
  { id: 'bg36', picsumId: '70', path: '/images/bg/bg36.jpg', author: 'Dorothy Lin', source: 'unsplash.com/photos/OokBLPrkCNk' },
  { id: 'bg37', picsumId: '71', path: '/images/bg/bg37.jpg', author: 'Jon Eckert', source: 'unsplash.com/photos/IoIbdFdGCnQ' },
  { id: 'bg38', picsumId: '72', path: '/images/bg/bg38.jpg', author: 'Tyler Finck', source: 'unsplash.com/photos/Cs4QZdHrHt4' },
  { id: 'bg39', picsumId: '74', path: '/images/bg/bg39.jpg', author: 'Isaak Dury', source: 'unsplash.com/photos/YhZbnxqtooM' },
  { id: 'bg40', picsumId: '75', path: '/images/bg/bg40.jpg', author: 'Jassy Onyae', source: 'unsplash.com/photos/1gBUXhf0PtA' },
  { id: 'bg41', picsumId: '77', path: '/images/bg/bg41.jpg', author: 'May Pamintuan', source: 'unsplash.com/photos/j9nfqTi5T5o' },
  { id: 'bg42', picsumId: '78', path: '/images/bg/bg42.jpg', author: 'Paul Evans', source: 'unsplash.com/photos/CtkDsu4w-Rs' },
  { id: 'bg43', picsumId: '80', path: '/images/bg/bg43.jpg', author: 'Sonja Langford', source: 'unsplash.com/photos/Y2PYfopoz-k' },
  { id: 'bg44', picsumId: '81', path: '/images/bg/bg44.jpg', author: 'Sander Weeteling', source: 'unsplash.com/photos/rlxZqmc6D_I' },
  { id: 'bg45', picsumId: '83', path: '/images/bg/bg45.jpg', author: 'Julie Geiger', source: 'unsplash.com/photos/dYshDcTI1Js' },
  { id: 'bg46', picsumId: '84', path: '/images/bg/bg46.jpg', author: 'Johnny Lam', source: 'unsplash.com/photos/63qfL0TciY8' },
  { id: 'bg47', picsumId: '85', path: '/images/bg/bg47.jpg', author: 'Gozha Net', source: 'unsplash.com/photos/xDrxJCdedcI' },
  { id: 'bg48', picsumId: '87', path: '/images/bg/bg48.jpg', author: 'Barcelona', source: 'unsplash.com/photos/o697BgRH_-M' },
  { id: 'bg49', picsumId: '89', path: '/images/bg/bg49.jpg', author: 'Vectorbeast', source: 'unsplash.com/photos/rsJtMXn3p_c' },
  { id: 'bg50', picsumId: '91', path: '/images/bg/bg50.jpg', author: 'Jennifer Trovato', source: 'unsplash.com/photos/baRYCsjO6z4' },
  { id: 'bg51', picsumId: '92', path: '/images/bg/bg51.jpg', author: 'Rafael Souza', source: 'unsplash.com/photos/QxkBP3A9XmU' },
  { id: 'bg52', picsumId: '93', path: '/images/bg/bg52.jpg', author: 'Caroline Sada', source: 'unsplash.com/photos/r1XwWjI4PyE' },
  { id: 'bg53', picsumId: '94', path: '/images/bg/bg53.jpg', author: 'Jean Kleisz', source: 'unsplash.com/photos/4yzPVohNuVI' },
  { id: 'bg54', picsumId: '95', path: '/images/bg/bg54.jpg', author: 'Kundan Ramisetti', source: 'unsplash.com/photos/87TJNWkepvI' },
  { id: 'bg55', picsumId: '96', path: '/images/bg/bg55.jpg', author: 'Pawel Kadysz', source: 'unsplash.com/photos/CuFYW1c97w8' },
  { id: 'bg56', picsumId: '98', path: '/images/bg/bg56.jpg', author: 'Laurice Solomon', source: 'unsplash.com/photos/ThJIf6Q0b2s' },
  { id: 'bg57', picsumId: '99', path: '/images/bg/bg57.jpg', author: 'Jon Toney', source: 'unsplash.com/photos/xyDQNmT6vSs' },
  { id: 'bg58', picsumId: '100', path: '/images/bg/bg58.jpg', author: 'Tina Rataj', source: 'unsplash.com/photos/pwaaqfoMibI' },
  { id: 'bg59', picsumId: '101', path: '/images/bg/bg59.jpg', author: 'Christian Bardenhorst', source: 'unsplash.com/photos/8lMhzUjD1Wk' },
  { id: 'bg60', picsumId: '1', path: '/images/bg/bg60.jpg', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/LNRyGwIJr5c' }
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
