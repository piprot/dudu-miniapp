// test/test_font_kit.js —— 字体族库 + 排版风格库守卫
// 核心风险：fontFamily 字符串会被拼进 ctx.font，格式错了整个卡片文字都不渲染；
//   所以必须守住「合法 CSS font-family 语法」与「风格字段完整性」。
const path = require('path');
const assert = require('assert');
const kit = require(path.join(__dirname, '..', 'utils', 'font_kit.js'));
const { buildCardModel } = require(path.join(__dirname, '..', 'utils', 'templates', 'index.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}

// ── 字体族 ──
t('5 个字体族，每族含多系统回退（iOS/Android/桌面）', () => {
  const names = Object.keys(kit.FAMILIES);
  assert.ok(names.length >= 5, '字体族过少: ' + names.length);
  for (const n of names) {
    const f = kit.FAMILIES[n];
    assert.ok(f && f.length > 0, n + ' 字体族为空');
    assert.ok(/sans-serif|serif|monospace/.test(f), n + ' 缺少通用族回退: ' + f);
    // 每族至少含一个中文字体名，否则中文会落到系统默认
    assert.ok(/PingFang|Songti|Hiragino|Noto|Microsoft YaHei|STSong|Kaiti|SF Mono/.test(f),
      n + ' 缺中文字体: ' + f);
  }
});

t('字体族含 PingFang（iOS）与 Noto CJK（Android），保证双端不空', () => {
  const s = kit.FAMILIES.sans;
  assert.ok(s.indexOf('PingFang SC') >= 0, '缺 iOS 中文黑体');
  assert.ok(s.indexOf('Noto Sans CJK') >= 0, '缺 Android 中文黑体');
});

t('每个字体族名都用引号包裹（canvas 解析多词族名脆弱）', () => {
  for (const n of Object.keys(kit.FAMILIES)) {
    const f = kit.FAMILIES[n];
    // 去掉最后一个通用族，其余每一项都应带引号
    const parts = f.split(',').slice(0, -1).map(x => x.trim()).filter(Boolean);
    for (const p of parts) {
      assert.ok(/^".+"$/.test(p), n + ' 字体族名未加引号（会被ctx.font 误解析）: ' + p);
    }
  }
});

t('字体族不含本地路径/协议（不能混入包内字体）', () => {
  for (const n of Object.keys(kit.FAMILIES)) {
    const f = kit.FAMILIES[n];
    assert.ok(f.indexOf('/') < 0, n + ' 字体族混入了路径: ' + f);
    assert.ok(!/https?:/.test(f), n + ' 字体族混入了 URL（应纯系统字体名）');
  }
});

t('familyOf 未知族回退 sans，不返回 undefined', () => {
  assert.ok(kit.familyOf('nope').indexOf('PingFang') >= 0, '未知族应回退 sans');
  assert.ok(kit.familyOf(null).length > 0, 'null 应回退');
  assert.ok(kit.familyOf(undefined).length > 0, 'undefined 应回退');
});

t('familyForRole 语义映射正确（标题衬线/正文黑体）', () => {
  assert.ok(/Songti/.test(kit.familyForRole('title')), '标题应为衬线');
  assert.ok(/PingFang/.test(kit.familyForRole('body')), '正文应为黑体');
  assert.ok(/Noto Sans Mono|Menlo|SF Mono/.test(kit.familyForRole('date')), '日期应为等宽');
});

// ── 排版风格 ──
t('4 种排版风格齐全且 id 唯一', () => {
  const ids = Object.keys(kit.STYLES);
  assert.ok(ids.length >= 4, '风格数过少: ' + ids.length);
  assert.strictEqual(new Set(ids).size, ids.length, '风格 id 重复');
  assert.strictEqual(kit.STYLE_LIST.length, ids.length, 'STYLE_LIST 与 STYLES 不一致');
});

t('每种风格字段完整（含装饰符号与圆角）', () => {
  for (const id of Object.keys(kit.STYLES)) {
    const s = kit.STYLES[id];
    for (const k of ['id', 'name', 'titleFont', 'titleSize', 'titleWeight', 'titleAlign',
      'bodyFont', 'bodySize', 'bodyLineHeight', 'bodyAlign', 'decoSize', 'radius']) {
      assert.ok(s[k] !== undefined, id + ' 缺字段 ' + k);
    }
    assert.ok(s.titleFont && kit.FAMILIES[s.titleFont], id + ' titleFont 不是有效字体族: ' + s.titleFont);
    assert.ok(s.bodyFont && kit.FAMILIES[s.bodyFont], id + ' bodyFont 不是有效字体族: ' + s.bodyFont);
    assert.ok(['center', 'left', 'right'].indexOf(s.titleAlign) >= 0, id + ' titleAlign 非法');
    assert.ok(['center', 'left', 'right'].indexOf(s.bodyAlign) >= 0, id + ' bodyAlign 非法');
    assert.ok(s.bodyLineHeight > s.bodySize, id + ' 行高须大于字号（v2 规范 1.7+）');
    assert.ok(s.titleSize > s.bodySize, id + ' 标题字号应大于正文，才有层次');
  }
});

t('风格之间真的不同（字号或对齐有差异，不是同一份复制）', () => {
  const sig = Object.keys(kit.STYLES).map(id => {
    const s = kit.STYLES[id];
    return [s.titleFont, s.titleSize, s.titleAlign, s.bodySize, s.deco].join('|');
  });
  assert.strictEqual(new Set(sig).size, sig.length, '存在完全相同的重复风格');
});

t('styleOf 未知 id 回退 literary，styleName 同步', () => {
  assert.strictEqual(kit.styleOf('nope').id, 'literary', '未知风格应回退 literary');
  assert.strictEqual(kit.hasStyle('nope'), false);
  assert.strictEqual(kit.hasStyle('poster'), true);
  assert.ok(kit.styleName('nope').length > 0, 'styleName 未知 id 应有回退名');
});

// ── 与模板层集成（真正的价值在这里） ──
const DATA = { title: '今天的风很轻', body: '把窗帘拉开，把心事放下。', author: 'dudu' };

t('集成：传 styleKey 后标题/正文字体族按风格切换', () => {
  const lit = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'literary' }, DATA));
  const pos = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'poster' }, DATA));
  const lt = lit.children.find(c => c.type === 'text' && c.content === DATA.title);
  const pt = pos.children.find(c => c.type === 'text' && c.content === DATA.title);
  assert.ok(/Songti|Noto Serif/.test(lt.fontFamily), '文艺风标题应是衬线，实际: ' + lt.fontFamily);
  assert.ok(/Maru|Yuanti|PingFang/.test(pt.fontFamily), '海报风标题应是圆体，实际: ' + pt.fontFamily);
  assert.notStrictEqual(lt.fontFamily, pt.fontFamily, '两种风格标题字体族应不同');
  assert.ok(pt.fontSize > lt.fontSize, '海报风标题字号应更大');
});

t('集成：字距 letterSpacing 真实落到 model（不是只写在库里）', () => {
  const m = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'poster' }, DATA));
  const t = m.children.find(c => c.type === 'text' && c.content === DATA.title);
  assert.ok(t.letterSpacing > 0, '海报风应带字距，实际: ' + t.letterSpacing);
});

t('集成：装饰符号随风格变化（❝ / ❀ / ◆）', () => {
  const marks = ['literary', 'warm', 'poster'].map(k => {
    const m = buildCardModel('quote', 'warm', Object.assign({ styleKey: k }, DATA));
    const deco = m.children.find(c => c.type === 'text' && /[❝❀◆]/.test(c.content || ''));
    return deco ? deco.content : '';
  });
  assert.ok(marks.every(Boolean), '某些风格缺装饰符号: ' + JSON.stringify(marks));
  assert.strictEqual(new Set(marks).size, marks.length, '三种风格装饰符号应各不相同: ' + JSON.stringify(marks));
});

t('回归：showDeco:false 的风格不生成装饰节点（不留 0px 空块）', () => {
  // modern 风格 showDeco:false —— 早前实现仍 push 了 0px 装饰块，白占纵向空间
  const m = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'modern' }, DATA));
  const deco = m.children.find(c => c.type === 'text' && /[❝❀◆]/.test(c.content || ''));
  assert.ok(!deco, 'modern 风格不应生成装饰节点，实际仍有: ' + (deco && deco.content));
  assert.ok(m.children.every(c => !(c.type === 'text' && c.fontSize === 0)),
    '存在 0px 的空文本节点');
  // 反向：showDeco:true 的风格必须有
  const w = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'warm' }, DATA));
  assert.ok(w.children.some(c => c.type === 'text' && c.content === '❀'), 'warm 风格应有❀ 装饰');
});

t('集成：不传 styleKey 时旧行为不变（回归保护）', () => {
  // quote 不传 styleKey → 仍走主题 cjkFont（而非风格字体族）
  const m = buildCardModel('quote', 'zen', DATA);
  const body = m.children.find(c => c.type === 'text' && c.content === DATA.body);
  assert.ok(/serif/.test(body.fontFamily), '不传 styleKey 时应保持主题字体，实际: ' + body.fontFamily);
});

t('集成：dailysign 走风格但仍保持居中（它的识别特征）', () => {
  const m = buildCardModel('dailysign', 'warm', DATA);
  const body = m.children.find(c => c.type === 'text' && c.content === DATA.body);
  assert.ok(body && body.textAlign === 'center', '日签正文必须居中');
});

t('集成：卡片仍能被引擎消费（字体改动不破坏 layout）', () => {
  const { computeLayout } = require(path.join(__dirname, '..', 'utils', 'core', 'render_engine.js'));
  const m2 = t => ({ width: (t || '').length * 12 });
  for (const k of Object.keys(kit.STYLES)) {
    const m = buildCardModel('dailysign', 'warm', Object.assign({ styleKey: k }, DATA));
    const layout = computeLayout(m, {}, m2);
    assert.ok(layout && layout.width > 0, k + ' 风格 layout 缺宽度');
    assert.ok(Array.isArray(layout.blocks) && layout.blocks.length > 0, k + ' 风格 blocks 为空');
    assert.ok(layout.height > 0, k + ' 风格 layout 高度异常');
  }
});

console.log('\n──────── 结果：' + pass + ' PASS / ' + fail + ' FAIL ────────');
if (fail > 0) process.exitCode = 1;