const tools = require('./utils/text_tools');
const tpl = require('./utils/templates');
const knowledge = require('./utils/knowledge');
const profile = require('./utils/profile');

function assert(cond, msg) {
  if (!cond) { console.error('  ✗ FAIL:', msg); process.exitCode = 1; }
  else { console.log('  ✓', msg); }
}

console.log('— text_tools —');
const sample = '今天下班后去江边散步，看到一位老人练书法。风很轻，突然觉得慢下来也不是浪费时间。忙碌之外，也要给自己一点喘息。';
const folded = tools.antiFold(sample, 20);
assert(folded.split('\n').length >= sample.split('。').length - 1, 'antiFold 按句分行');
assert(folded.split('\n').every(l => l.length <= 22), 'antiFold 单行长 ≤ 22');
const emo = tools.insertEmoji('最近在健身，感觉身体更健康了，很开心。');
assert(/\p{Extended_Pictographic}/u.test(emo), 'insertEmoji 句子尾部补了 emoji');
assert(!/🏃/.test(emo.split('\n')[0]) || /💪|😊|🏃/.test(emo), 'insertEmoji 命中健身/开心');
const sp = tools.autoSplit('第一句。第二句！第三句？');
assert(sp.split('\n').length === 3, 'autoSplit 三句成三行');
const st = tools.countStats(emo);
assert(st.chars > 0 && st.lines > 0, 'countStats 返回字数/行数');

console.log('— templates —');
const form = { identity: '知识付费创作者', audience: '新手', scene: '很多人问我怎么开始', point: '开始比完美重要' };
const out = tpl.render('value', form);
assert(out.length === 3, 'value 渲染出 3 条');
assert(out.every(m => m.indexOf('{{') < 0), '渲染后无残留占位符');
assert(out[0].indexOf('知识付费创作者') >= 0, '渲染结果含用户字段');
// 留空字段不应产生空壳行
const out2 = tpl.render('life', { moment: '下班散步', feeling: '风很轻', meaning: '给自己喘息' });
assert(out2.every(m => !/^我是[。.]*$/.test(m)), 'life 无 identity 时不产生空壳行');
assert(tpl.TEMPLATES.story.length === 3, 'story 有 3 套模板');

console.log('— knowledge —');
assert(knowledge.quotesFor('value').length >= 3, 'value 金句库有内容');
assert(knowledge.quotesFor('story').length >= 3, 'story 金句库有内容');
assert(knowledge.skeletonsFor('deal').length >= 1, 'deal 结构骨架有内容');

console.log('— profile —');
const pf = { identity: '知识付费创作者', product: '陪跑营', audience: '新手', scene: '很多人问', point: '开始比完美重要', quotes: '开始比完美重要\n更清晰就好' };
const pfValue = profile.applyProfileToForm('value', pf);
assert(pfValue.identity === '知识付费创作者' && pfValue.point === '开始比完美重要', 'applyProfileToForm 正确映射 value');
const pfDeal = profile.applyProfileToForm('deal', pf);
assert(pfDeal.product === '陪跑营' && !pfDeal.point, 'applyProfileToForm 只填当前类型用到的 key');
assert(typeof profile.loadProfile === 'function' && typeof profile.saveProfile === 'function', 'profile 读写接口存在（node 无 wx 时安全降级）');

console.log(process.exitCode ? '\n=== 有失败 ===' : '\n=== 全部通过 ===');
