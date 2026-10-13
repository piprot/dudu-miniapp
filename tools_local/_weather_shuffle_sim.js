// 仿真验证：天气卡「换一句」不扣积分、只有「预览成卡」扣。
// 计费逻辑错了会真扣用户的分，光靠读源码断言不够 —— 这里把页面对象搭起来真跑一遍。
// 跑法：node tools_local/_weather_shuffle_sim.js
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

// ── mock wx（页面 require 与调用期间会用到）──
const calls = { toast: [], charge: [], repaint: 0, render: 0 };
global.wx = {
  showToast(o) { calls.toast.push(o && o.title); },
  showModal() {},
  navigateTo() {},
  getStorageSync() { return ''; },
  setStorageSync() {},
  removeStorageSync() {},
  getSystemInfoSync() { return { windowWidth: 375, pixelRatio: 2 }; },
  createSelectorQuery() {
    return { select: () => ({ fields: () => ({ exec: () => {} }) }), in: () => this };
  }
};

// ── 把 utils/charge.js 换成 spy ──
// 必须在 require 页面之前塞进 require.cache，否则页面拿到的是真扣费实现。
const chargePath = require.resolve(path.join(ROOT, 'utils', 'charge.js'));
// ⚠️ 页面是 `const { charge } = require('../../utils/charge.js')` 解构取属性，
//    所以 exports 必须是**对象**，不能是裸函数（否则 charge === undefined）。
require.cache[chargePath] = {
  id: chargePath, filename: chargePath, loaded: true, children: [], paths: [],
  exports: {
    costOf: () => 8,
    charge: function (action, opts) {
      calls.charge.push(action);
      if (opts && typeof opts.onDone === 'function') opts.onDone({ points: 0 });
      return Promise.resolve({ ok: true, points: 0 });
    }
  }
};

// ── 捕获 Page(...) 的配置对象 ──
let CFG = null;
global.Page = (cfg) => { CFG = cfg; };
global.getApp = () => ({ globalData: {} });

const weatherSrc = path.join(ROOT, 'pages', 'weather', 'weather.js');
require(weatherSrc);

const cardStyle = require(path.join(ROOT, 'utils/card_style_mixin'));
const cw = require(path.join(ROOT, 'utils/content_weather'));

// spy：repaint 调用次数（真 repaint 要走 canvas，这里只计数 + 记错）
const realRepaint = cardStyle.repaint;
cardStyle.repaint = function (page) {
  calls.repaint++;
  try { realRepaint(page); } catch (e) { /* 无 canvas 环境，抛错不算失败 */ }
};

// ── 搭页面对象 ──
// ⚠️ 必须以 CFG 为原型：页面方法（currentAutoText / onGen / …）都在 CFG 上，
//    只给 data/setData 的话 `this.currentAutoText()` 会是 undefined。
function makePage(opts) {
  const p = Object.create(CFG);
  p.data = {
    weather: 'sunny', mood: 'happy', variantTap: 0, note: '',
    theme: 'warm', cover: '', autoText: '', points: 0, cardCost: 8,
    cityLabel: '', style: 'literary', bgId: '', photoMode: 'none', styleOn: false
  };
  p.setData = function (o, cb) {
    Object.assign(this.data, o);
    if (typeof cb === 'function') cb();
  };
  p._cardOpts = null;
  p._lastData = null;
  return Object.assign(p, opts || {});
}

let fail = 0;
function ok(cond, name, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')); fail++; }
}

console.log('场景 1｜没出过卡，连点 3 次「换一句」');
const p1 = makePage();
const t0 = cw.textFor('sunny', 'happy', 0);
p1.setData({ autoText: cw.textFor('sunny', 'happy', 1) });
const before1 = p1.data.autoText;
for (let i = 0; i < 3; i++) CFG.onShuffle.call(p1);
ok(p1.data.variantTap === 3, '连点 3 次 → variantTap = 3', '实际 ' + p1.data.variantTap);
ok(p1.data.autoText && p1.data.autoText !== before1, '文案确实换了', '前: ' + before1 + ' / 后: ' + p1.data.autoText);
ok(calls.charge.length === 0, '换 3 句一次都没扣费', 'charge 次数 ' + calls.charge.length);
ok(calls.repaint === 0, '没出过卡时不重绘（不产出卡片）');
ok(calls.toast.length === 0, '不弹提示（该组合有 8 条可换）');
void t0;

console.log('\n场景 2｜已出过卡，再点「换一句」');
const p2 = makePage({
  _cardOpts: { canvasId: '#weatherCanvas', type: 'quote', theme: 'warm', data: { body: '旧文案' } },
  _lastData: { type: 'quote', theme: 'warm', data: { body: '旧文案' } }
});
p2.setData({ autoText: '旧文案' });
const chargeBefore = calls.charge.length;
const repaintBefore = calls.repaint;
CFG.onShuffle.call(p2);
ok(calls.charge.length === chargeBefore, '已出过卡后换文案仍然不扣费');
ok(calls.repaint === repaintBefore + 1, '走 repaint 免费重绘（卡面跟着更新）', 'repaint ' + calls.repaint);
ok(p2._cardOpts.data.body === p2.data.autoText,
  '卡面 body 与页面展示文案一致', 'body=' + p2._cardOpts.data.body + ' / autoText=' + p2.data.autoText);
ok(p2._lastData.data.body === p2.data.autoText, '_lastData 同步更新（换主题重绘不回退）');

console.log('\n场景 3｜「预览成卡」才是扣费点');
const p3 = makePage();
p3.setData({ autoText: cw.textFor('sunny', 'happy', 2) });
const chargeBefore3 = calls.charge.length;
try { CFG.onGen.call(p3); } catch (e) { console.log('    (onGen 渲染阶段抛错属预期：无 canvas 环境) ' + e.message); }
ok(calls.charge.length === chargeBefore3 + 1, '点「预览成卡」扣 1 次', 'charge 次数 ' + calls.charge.length);
ok(calls.charge[calls.charge.length - 1] === 'weatherCard', '扣的是 weatherCard 这一档');
ok(!!p3._cardOpts, 'onGen 后 _cardOpts 就绪（后续换文案才能免费重绘）');

console.log('\n场景 4｜自定义文案时不轮换（原有行为保留）');
const p4 = makePage();
p4.data.note = '我自己写的一句';
const toastBefore = calls.toast.length;
CFG.onShuffle.call(p4);
ok(p4.data.variantTap === 0, '有自定义文案时不轮换（不覆盖用户内容）');
ok(calls.toast.slice(toastBefore).some(t => /自定义/.test(t || '')), '给出「清空后才会换」提示');

console.log('\n场景 5｜源码层面：weatherCard 扣费点唯一且只在 onGen');
const src = fs.readFileSync(weatherSrc, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok((src.match(/charge\('weatherCard'/g) || []).length === 1, 'charge(\'weatherCard\') 全文仅 1 处');
const genBlock = (src.match(/onGen\(\)\s*\{[\s\S]*?\n  \},/) || [''])[0];
ok(/charge\('weatherCard'/.test(genBlock), '唯一的扣费点位于 onGen（预览成卡）');
const shufBlock = (src.match(/onShuffle\(\)\s*\{[\s\S]*?\n  \},/) || [''])[0];
ok(!/charge\(/.test(shufBlock), 'onShuffle 内不出现 charge');
ok(!/this\.onGen\(\)/.test(shufBlock), 'onShuffle 不再转调 onGen（旧扣费元凶）');

console.log(fail ? '\n✗ 仿真失败 ' + fail + ' 项' : '\n✓ 仿真全部通过');
process.exit(fail ? 1 : 0);
