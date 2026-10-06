// utils/photo_lib.js —— 背景图库清单（picsum 固定 ID + 灰度衬底）
//
// 数据来源：https://picsum.photos/v2/list 抓取于 2026-10-06，取前 100 张。
// picsum 上游为 Unsplash，故每张保留 author 与 source，便于溯源 / 署名。
//
// 为什么用它（2026-10-06 四家实测）：
//   devimg.cn/photo200 但不支持题材（scene= 全 400）、未知参数静默返回垃圾图、官网无版权声明；
//   source.unsplash.com   503 已停服；images.unsplash.com 境内超时且要 API Key；
//   picsum固定 ID 200 可用、List API 暴露 Unsplash 作者（可溯源 = 可辩护）、支持 grayscale/blur。
//
// 画布尺寸：手机卡片约 750 宽，故取 750 x 1000。
//
// ⚠️ 这是全项目唯一一处网络依赖。canvas 2d 的 createImage 加载网络图受
//    downloadFile 白名单管辖 → 须在小程序后台「服务器域名」配置 picsum.photos。
//    未配置 / 加载失败时必须降级到内置纯色背景，绝不能白卡。
const PHOTOS = [
  { id: '0', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/yC-Yzbqy7PY' },
  { id: '1', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/LNRyGwIJr5c' },
  { id: '2', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/N7XodRrbzS0' },
  { id: '3', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/Dl6jeyfihLk' },
  { id: '4', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/y83Je1OC6Wc' },
  { id: '5', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/LF8gK8-HGSg' },
  { id: '6', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/tAKXap853rY' },
  { id: '7', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/BbQLHCpVUqA' },
  { id: '8', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/xII7efH1G6o' },
  { id: '9', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/ABDTiLqDhJA' },
  { id: '10', author: 'Paul Jarvis', source: 'unsplash.com/photos/6J--NXulQCs' },
  { id: '11', author: 'Paul Jarvis', source: 'unsplash.com/photos/Cm7oKel-X2Q' },
  { id: '12', author: 'Paul Jarvis', source: 'unsplash.com/photos/I_9ILwtsl_k' },
  { id: '13', author: 'Paul Jarvis', source: 'unsplash.com/photos/3MtiSMdnoCo' },
  { id: '14', author: 'Paul Jarvis', source: 'unsplash.com/photos/IQ1kOQTJrOQ' },
  { id: '15', author: 'Paul Jarvis', source: 'unsplash.com/photos/NYDo21ssGao' },
  { id: '16', author: 'Paul Jarvis', source: 'unsplash.com/photos/gkT4FfgHO5o' },
  { id: '17', author: 'Paul Jarvis', source: 'unsplash.com/photos/Ven2CV8IJ5A' },
  { id: '18', author: 'Paul Jarvis', source: 'unsplash.com/photos/Ps2n0rShqaM' },
  { id: '19', author: 'Paul Jarvis', source: 'unsplash.com/photos/P7Lh0usGcuk' },
  { id: '20', author: 'Aleks Dorohovich', source: 'unsplash.com/photos/nJdwUHmaY8A' },
  { id: '21', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/jVb0mSn0LbE' },
  { id: '22', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/du_OrQAA4r0' },
  { id: '23', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/8yqds_91OLw' },
  { id: '24', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/cZhUxIQjILg' },
  { id: '25', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/Iuq0EL4EINY' },
  { id: '26', author: 'Vadim Sherbakov', source: 'unsplash.com/photos/tCICLJ5ktBE' },
  { id: '27', author: 'Yoni Kaplan-Nadel', source: 'unsplash.com/photos/iJnZwLBOB1I' },
  { id: '28', author: 'Jerry Adney', source: 'unsplash.com/photos/_WiFMBRT7Aw' },
  { id: '29', author: 'Go Wild', source: 'unsplash.com/photos/V0yAek6BgGk' },
  { id: '30', author: 'Shyamanta Baruah', source: 'unsplash.com/photos/aeVA-j1y2BY' },
  { id: '31', author: 'How-Soon Ngu', source: 'unsplash.com/photos/7Vz3DtQDT3Q' },
  { id: '32', author: 'Rodrigo Melo', source: 'unsplash.com/photos/eG3k60PrTGY' },
  { id: '33', author: 'Alejandro Escamilla', source: 'unsplash.com/photos/LBI7cgq3pbM' },
  { id: '34', author: 'Aleks Dorohovich', source: 'unsplash.com/photos/zZvsEMPxjIA' },
  { id: '35', author: 'Shane Colella', source: 'unsplash.com/photos/znM0ujn2RUA' },
  { id: '36', author: 'Vadim Sherbakov', source: 'unsplash.com/photos/osSryggkso4' },
  { id: '37', author: 'Austin Neill', source: 'unsplash.com/photos/erTjj730fMk' },
  { id: '38', author: 'Allyson Souza', source: 'unsplash.com/photos/JabLtzJl8bc' },
  { id: '39', author: 'Luke Chesser', source: 'unsplash.com/photos/pFqrYbhIAXs' },
  { id: '40', author: 'Ryan Mcguire', source: 'unsplash.com/photos/N-1XGL54pQg' },
  { id: '41', author: 'Nithya Ramanujam', source: 'unsplash.com/photos/fTKetYpEKNQ' },
  { id: '42', author: 'Luke Chesser', source: 'unsplash.com/photos/KR2mdHJ5qMg' },
  { id: '43', author: 'Oleg Chursin', source: 'unsplash.com/photos/IoCWq07GaG4' },
  { id: '44', author: 'Christopher Sardegna', source: 'unsplash.com/photos/R1E6x8U83Ho' },
  { id: '45', author: 'Alan Haverty', source: 'unsplash.com/photos/-XA-fTYYfV0' },
  { id: '46', author: 'Jeffrey Kam', source: 'unsplash.com/photos/Nzw3HHsNHYU' },
  { id: '47', author: 'Christopher Sardegna', source: 'unsplash.com/photos/uDUiRS8YroY' },
  { id: '48', author: 'Luke Chesser', source: 'unsplash.com/photos/1uxV8fAfhVM' },
  { id: '49', author: 'Margaret Barley', source: 'unsplash.com/photos/Qo51KwK1dKg' },
  { id: '50', author: 'Tyler Wanlass', source: 'unsplash.com/photos/L7MpmBGpM94' },
  { id: '51', author: 'Ireneuilia', source: 'unsplash.com/photos/knYQ6arClBE' },
  { id: '52', author: 'Cierra', source: 'unsplash.com/photos/57vHdjeZ0yg' },
  { id: '53', author: 'J Duclos', source: 'unsplash.com/photos/6qORI5j_6n8' },
  { id: '54', author: 'Nicholas Swanson', source: 'unsplash.com/photos/d19by2PLaPc' },
  { id: '55', author: 'Tyler Wanlass', source: 'unsplash.com/photos/akbHiqZy4Pg' },
  { id: '56', author: 'Sebastian Muller', source: 'unsplash.com/photos/VLdaxYyXJvw' },
  { id: '57', author: 'Nicholas Swanson', source: 'unsplash.com/photos/SyBYM8R6VU4' },
  { id: '58', author: 'Tony Naccarato', source: 'unsplash.com/photos/-kEr-QltARg' },
  { id: '59', author: 'Art Wave', source: 'unsplash.com/photos/algEQavPY4M' },
  { id: '60', author: 'Vadim Sherbakov', source: 'unsplash.com/photos/Hi9GSwWkCJk' },
  { id: '61', author: 'Alex', source: 'unsplash.com/photos/zMz14hsbpuU' },
  { id: '62', author: 'Daniel Genser', source: 'unsplash.com/photos/PzPbh-faPgU' },
  { id: '63', author: 'Justin Leibow', source: 'unsplash.com/photos/ZJsseAxEcqM' },
  { id: '64', author: 'Alexander Shustov', source: 'unsplash.com/photos/AHBiSKaENwc' },
  { id: '65', author: 'Alexander Shustov', source: 'unsplash.com/photos/2FrX56QL7P8' },
  { id: '66', author: 'Nicholas Swanson', source: 'unsplash.com/photos/agnhLQWqr1Q' },
  { id: '67', author: 'Rula Sibai', source: 'unsplash.com/photos/QbkGwv3xtmQ' },
  { id: '68', author: 'Cristian Moscoso', source: 'unsplash.com/photos/2SfRAWkinpU' },
  { id: '69', author: 'Alexander Shustov', source: 'unsplash.com/photos/SITaCHf7jjg' },
  { id: '70', author: 'Dorothy Lin', source: 'unsplash.com/photos/OokBLPrkCNk' },
  { id: '71', author: 'Jon Eckert', source: 'unsplash.com/photos/IoIbdFdGCnQ' },
  { id: '72', author: 'Tyler Finck', source: 'unsplash.com/photos/Cs4QZdHrHt4' },
  { id: '73', author: 'Jon Eckert', source: 'unsplash.com/photos/umLpP7uCZs0' },
  { id: '74', author: 'Isaak Dury', source: 'unsplash.com/photos/YhZbnxqtooM' },
  { id: '75', author: 'Jassy Onyae', source: 'unsplash.com/photos/1gBUXhf0PtA' },
  { id: '76', author: 'Alexander Shustov', source: 'unsplash.com/photos/OxzhYtL-00Y' },
  { id: '77', author: 'May Pamintuan', source: 'unsplash.com/photos/j9nfqTi5T5o' },
  { id: '78', author: 'Paul Evans', source: 'unsplash.com/photos/CtkDsu4w-Rs' },
  { id: '79', author: 'Dorothy Lin', source: 'unsplash.com/photos/TIr6EwYMRUM' },
  { id: '80', author: 'Sonja Langford', source: 'unsplash.com/photos/Y2PYfopoz-k' },
  { id: '81', author: 'Sander Weeteling', source: 'unsplash.com/photos/rlxZqmc6D_I' },
  { id: '82', author: 'Rula Sibai', source: 'unsplash.com/photos/-vq7mi4oF0s' },
  { id: '83', author: 'Julie Geiger', source: 'unsplash.com/photos/dYshDcTI1Js' },
  { id: '84', author: 'Johnny Lam', source: 'unsplash.com/photos/63qfL0TciY8' },
  { id: '85', author: 'Gozha Net', source: 'unsplash.com/photos/xDrxJCdedcI' },
  { id: '87', author: 'Barcelona', source: 'unsplash.com/photos/o697BgRH_-M' },
  { id: '88', author: 'Barcelona', source: 'unsplash.com/photos/muC_6gTMLR4' },
  { id: '89', author: 'Vectorbeast', source: 'unsplash.com/photos/rsJtMXn3p_c' },
  { id: '90', author: 'Rula Sibai', source: 'unsplash.com/photos/qVj3KuEikvg' },
  { id: '91', author: 'Jennifer Trovato', source: 'unsplash.com/photos/baRYCsjO6z4' },
  { id: '92', author: 'Rafael Souza', source: 'unsplash.com/photos/QxkBP3A9XmU' },
  { id: '93', author: 'Caroline Sada', source: 'unsplash.com/photos/r1XwWjI4PyE' },
  { id: '94', author: 'Jean Kleisz', source: 'unsplash.com/photos/4yzPVohNuVI' },
  { id: '95', author: 'Kundan Ramisetti', source: 'unsplash.com/photos/87TJNWkepvI' },
  { id: '96', author: 'Pawel Kadysz', source: 'unsplash.com/photos/CuFYW1c97w8' },
  { id: '98', author: 'Laurice Solomon', source: 'unsplash.com/photos/ThJIf6Q0b2s' },
  { id: '99', author: 'Jon Toney', source: 'unsplash.com/photos/xyDQNmT6vSs' },
  { id: '100', author: 'Tina Rataj', source: 'unsplash.com/photos/pwaaqfoMibI' },
  { id: '101', author: 'Christian Bardenhorst', source: 'unsplash.com/photos/8lMhzUjD1Wk' },
];

const BY_ID = {};
for (const p of PHOTOS) BY_ID[p.id] = p;

const W = 750;
const H = 1000;
const BASE = 'https://picsum.photos/id/';

// mode: gray（默认，灰度衬底，文字更清晰）| blur（虚化）| raw（原图）
function urlOf(id, opts) {
  const o = opts || {};
  const mode = o.mode || 'gray';
  const q = mode === 'gray' ? '?grayscale' : (mode === 'blur' ? '?blur=6' : '');
  if (!BY_ID[id]) return '';
  return BASE + id + '/' + W + '/' + H + q;
}

/** 全库清单（wxml 循环渲染缩略图）。 */
function listAll(opts) {
  return PHOTOS.map(p => ({ id: p.id, author: p.author, url: urlOf(p.id, opts) }));
}

function authorOf(id) { const p = BY_ID[id]; return p ? p.author : ''; }
function sourceOf(id) { const p = BY_ID[id]; return p ? p.source : ''; }
function has(id) { return !!BY_ID[id]; }

function stats() {
  return {
    total: PHOTOS.length,
    authors: new Set(PHOTOS.map(p => p.author)).size,
    w: W,
    h: H
  };
}

module.exports = { PHOTOS, urlOf, listAll, authorOf, sourceOf, has, stats, W, H };
