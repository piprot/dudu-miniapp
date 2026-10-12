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

// ── 2026-10-12：风格由 4 种扩到 9 种（色带/签名/极简/刊头/大字）──
t('9 种风格齐全，每种都带一句话说明（出图设置那一行就靠它）', () => {
  const ids = Object.keys(kit.STYLES);
  assert.strictEqual(ids.length, 9, '风格数应为 9，实际 ' + ids.length);
  for (const id of ids) {
    const s = kit.STYLES[id];
    assert.ok(s.layout, id + ' 缺 layout 骨架 id（模板层靠它选构图）');
    assert.ok(s.desc && s.desc.length >= 8, id + ' 缺 desc / 太短（用户看不出这风格长什么样）');
    assert.strictEqual(kit.styleDesc(id), s.desc, id + ' styleDesc 与 STYLES 不一致');
  }
  assert.strictEqual(kit.STYLE_LIST.length, 9, 'STYLE_LIST 应同步到 9');
  assert.ok(kit.STYLE_LIST.every(x => x.desc && x.desc.length),
    'STYLE_LIST 必须带 desc —— 组件 card-config 直接遍历它渲染，缺了说明行就是空的');
  // 未知识别回退，不能返回空串（空串会让组件那一行塌成 0 高）
  assert.ok(kit.styleDesc('nope').length > 0, '未知风格说明应回退文艺，不能为空');
});

// ── 成图版式（用户拍板：固定 3:4 竖幅、隐藏胶囊与水印、保留小程序码）──
// 这些断言守的是「成图 ≠ 卡片」这条边界：一旦有人把胶囊/外框/分隔线加回来，
// 出图就会退回卡片观感，与参考图对不上 —— 所以逐条钉死。
t('5 种成图风格：固定 3:4 竖幅、无胶囊外框分隔线、保留小程序码、底部品牌行', () => {
  // 自带样例数据，不引用文件下方的 DATA（const 在 TDZ 里，提前引用会抛
  // "Cannot access 'DATA' before initialization"）
  const D = { title: '早餐', body: '把窗帘拉开，把心事放下。', author: '杜淳滢', qr: true };
  const FRAMES = ['band', 'signature', 'minimal', 'masthead', 'headline'];
  const build = k => buildCardModel('quote', 'warm', Object.assign({ styleKey: k }, D));

  for (const k of FRAMES) {
    const m = build(k);
    const cs = m.children;
    const texts = cs.filter(c => c.type === 'text');
    const at = k + ': ';

    // ① 固定 3:4（340×453），不再随内容流式增高
    assert.strictEqual(m.width, 340, at + '宽应为 340');
    assert.strictEqual(m.height, 453, at + '高应固定 453（3:4），实际 ' + m.height);

    // ② 保留小程序码（用户明确拍板保留）
    assert.ok(cs.some(c => c.type === 'qrcode'), at + '应保留小程序码');

    // ③ 无类型胶囊（成图不出现「金句卡」这类 UI 控件）
    assert.ok(!texts.some(c => /^金句卡$/.test((c.content || '').trim())),
      at + '不应有类型胶囊文案');

    // ④ 无整卡外框（left/top 归零、铺满全卡的描边 rect）
    assert.ok(!cs.some(c => c.type === 'rect' && c.left === 0 && c.top === 0 &&
      c.width === m.width && c.height === m.height), at + '不应有整卡外框');

    // ⑤ 无分隔线（卡片版式靠线分栏，成图靠留白）
    assert.ok(!cs.some(c => c.type === 'line'), at + '不应有分隔线');

    // ⑥ 底部品牌行（年份，可能是逐字插空格的 2 0 2 6）
    assert.ok(texts.some(x => /2\s*0\s*2\s*6/.test(x.content || '')),
      at + '底部应有带年份的品牌行，实际: ' + JSON.stringify(texts.map(x => x.content)));

    // ⑦ 品牌行确实在下半幅（不是飘在中间）
    const foot = texts.filter(x => x.top >= m.height * 0.75);
    assert.ok(foot.length >= 1, at + '品牌行应落在底部 25% 区域');
  }
});

t('色带风：整宽浅色磨砂带 + 带内深色字（参考图的提亮带，不是压暗带）', () => {
  const D = { title: '早餐', body: '把窗帘拉开，把心事放下。', author: '杜淳滢', qr: true };
  const m = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'band' }, D));
  const bandOf = mm => mm.children.filter(c => c.type === 'rect' && c.left === 0 && c.width === mm.width);
  // 整宽出血的色带
  assert.ok(bandOf(m).length >= 1, '色带风应有整宽色带');
  // 照片底：半透明白（提亮照片，不是压暗）
  const onPhoto = buildCardModel('quote', 'warm',
    Object.assign({ styleKey: 'band', bgImg: 'demo://photo.jpg' }, D));
  assert.ok(/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(String(bandOf(onPhoto)[0].background)),
    '照片上色带应是半透明白（提亮），实际: ' + bandOf(onPhoto)[0].background);
  // 无照片底：底色本身已经浅，再用白叠等于没画 → 必须是主色淡染
  assert.ok(!/255\s*,\s*255\s*,\s*255/.test(String(bandOf(m)[0].background)),
    '无照片时不该用白色带（浅底上看不出带子），实际: ' + bandOf(m)[0].background);
  assert.ok(/rgba\(/.test(String(bandOf(m)[0].background)), '无照片色带应是半透明淡染');
  // 带内文字必须是深色（浅底深字才可读）
  const b = bandOf(m)[0];
  const inside = m.children.filter(c => c.type === 'text' &&
    c.top >= b.top && c.top <= b.top + b.height);
  assert.ok(inside.length >= 2, '带内应有标题+正文，实际 ' + inside.length);
  for (const x of inside) {
    const c = String(x.color || '');
    if (/^rgba/.test(c)) continue; // 允许半透明深色
    assert.ok(c === '#1f1f1f' || c === '#3d3d3d' || c === '#4a4a4a' ||
      /^#(1|2|3|4)/.test(c), '浅色带内文字必须是深色，实际: ' + c);
  }
  // 出处右对齐（参考图里署名靠右）
  const src = inside.find(x => /——/.test(x.content || ''));
  assert.ok(src, '带内应有「—— 作者」出处行');
  // 注意字段名是 textAlign（模板层约定），不是 align
  assert.strictEqual(src.textAlign, 'right', '出处应右对齐，实际 textAlign=' + src.textAlign);
});

t('刊头风：贴顶极小极淡字链（参考图的团队名式刊头）', () => {
  const D = { title: '早餐', body: '把窗帘拉开，把心事放下。', author: '杜淳滢', qr: true };
  const cs = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'masthead' }, D)).children;
  const head = cs.filter(c => c.type === 'text' && c.top <= 12);
  assert.ok(head.length >= 1, '刊头应贴顶（top<=12）');
  const h = head[0];
  assert.ok(h.fontSize <= 10, '刊头应极小（<=10px），实际 ' + h.fontSize);
  assert.ok(/\s/.test(h.content || ''), '刊头应逐字插空格（引擎不消费 letterSpacing）');
  assert.ok(/rgba\(/.test(String(h.color)), '刊头应极淡（半透明），实际 ' + h.color);
});

t('签名风：右上角楷体署名 + ❄ 标签链 + 「年份｜品牌 @作者」', () => {
  const D = { title: '早餐', body: '把窗帘拉开，把心事放下。', author: '杜淳滢', qr: true };
  const cs = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'signature' }, D)).children;
  const texts = cs.filter(c => c.type === 'text');
  // 署名在右上角：靠右（left 过半）且在顶部
  const sign = texts.find(x => x.content === D.author);
  assert.ok(sign, '应有署名节点');
  assert.ok(sign.top <= 24 && sign.left >= 200, '署名应在右上角，实际 top=' + sign.top + ' left=' + sign.left);
  assert.ok(/Kaiti|STKaiti|KaiTi/.test(sign.fontFamily), '署名应楷体，实际 ' + sign.fontFamily);
  // 标签链（❄ 分隔）
  assert.ok(texts.some(x => /❄/.test(x.content || '')), '应有 ❄ 标签链');
  // 「2026 ｜ 品牌 @作者」
  assert.ok(texts.some(x => /^20\d\d ｜ .*@/.test(x.content || '')),
    '底部应有「年份｜品牌 @作者」，实际: ' + JSON.stringify(texts.map(x => x.content)));
});

t('极简风：无任何装饰元素，只有文字 + 码', () => {
  const D = { title: '早餐', body: '把窗帘拉开，把心事放下。', author: '杜淳滢', qr: true };
  const cs = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'minimal' }, D)).children;
  const deco = cs.filter(c => c.type !== 'text' && c.type !== 'qrcode' && c.type !== 'image');
  assert.strictEqual(deco.length, 0, '极简风不应有 rect/line/circle 等装饰，实际: ' +
    JSON.stringify(deco.map(c => c.type)));
  // 两行超小水印（逐字空格的年份行 + slogan）
  const foot = cs.filter(c => c.type === 'text' && c.top >= 400);
  assert.ok(foot.length >= 2, '底部应有两行水印，实际 ' + foot.length);
  assert.ok(foot.every(x => x.fontSize <= 10), '水印字号应 <=10');
});

t('大字风：衬线大字逐字渲染 + 字间竖排嵌字（参考图 5 的招牌构图）', () => {
  const D = { title: '早餐', body: '把窗帘拉开，把心事放下。', author: '杜淳滢', qr: true };
  const cs = buildCardModel('quote', 'warm', Object.assign({ styleKey: 'headline' }, D)).children;
  const texts = cs.filter(c => c.type === 'text');
  // 两个大字：字号 >=60、衬线、单字
  const hero = texts.filter(x => x.fontSize >= 60);
  assert.strictEqual(hero.length, 2, '「早餐」应拆成两个大字，实际 ' + hero.length);
  assert.ok(hero.every(x => /Songti|Noto Serif|serif/.test(x.fontFamily)), '大字应衬线');
  assert.ok(hero.every(x => Array.from(x.content).length === 1), '大字节点应单字');
  assert.ok(hero[0].top === hero[1].top, '两个大字应同一基线');
  // 字间嵌字：竖排两字、同 x、上下排列、夹在两大字之间
  const inset = texts.filter(x => x.fontSize >= 20 && x.fontSize < 40);
  assert.strictEqual(inset.length, 2, '应有竖排嵌字（2 字），实际 ' + inset.length);
  assert.strictEqual(inset[0].left, inset[1].left, '嵌字应同 x（竖排）');
  assert.ok(inset[0].top < inset[1].top, '嵌字应上下排列');
  const l = Math.max(hero[0].left, 0), r = Math.min(hero[1].left, hero[1].left);
  assert.ok(inset[0].left > hero[0].left && inset[0].left < hero[1].left,
    '嵌字应夹在两个大字之间（左' + l + ' 嵌' + inset[0].left + ' 右' + r + '）');
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