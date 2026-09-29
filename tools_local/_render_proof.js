// 模拟器运行时取证：跳到 commission / points 页，读页面真实文本，并截图。
// 目的：证明「画面感内容定制」已生效，而不是只看源码 / 上传成功。
const automator = require('miniprogram-automator');
const path = require('path');

const PRJ = 'C:/Users/Administrator/WorkBuddy/2026-09-11-21-15-54/comic_miniapp';
const OUT = path.join(PRJ, '_backup', 'render_proof');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  } catch (e) {
    console.log('[FAIL] connect: ' + (e && e.message));
    process.exit(1);
  }
  console.log('[OK] automator connected');

  // 等 IDE 把项目编译完（刚开窗口时会不够）
  await sleep(12000);

  // 探活：拿当前页
  let ready = false;
  for (let i = 1; i <= 8; i++) {
    try {
      const cur = await mp.currentPage();
      console.log('[OK] 编译完成，当前页 = ' + (cur && cur.path));
      ready = true;
      break;
    } catch (e) {
      console.log('  …等编译 (' + i + '/8): ' + (e && e.message));
      await sleep(6000);
    }
  }
  if (!ready) {
    console.log('[FAIL] 模拟器迟迟未就绪，放弃');
    try { await mp.disconnect(); } catch (e) {}
    process.exit(1);
  }

  const targets = ['/pages/commission/commission', '/pages/points/points'];
  const summary = [];

  for (const p of targets) {
    console.log('\n════════ ' + p + ' ════════');
    let page = null;
    for (let i = 1; i <= 4; i++) {
      try { page = await mp.reLaunch(p); await page.waitFor(3000); break; }
      catch (e) { console.log('  …reLaunch 重试 (' + i + '/4): ' + (e && e.message)); await sleep(5000); }
    }
    if (!page) { console.log('[FAIL] 无法进入 ' + p); continue; }

    // 读导航栏标题（page.data 无此字段，走原生 UI 快照）
    let navTitle = '(读不到)';
    try {
      const sys = await mp.systemInfo();
      navTitle = (sys && (sys.navigationBarTitleText || sys.title)) || navTitle;
    } catch (e) {}
    // 兜底：直接从页面 JSON 的标题约定 + 截图目视
    console.log('导航栏标题(自动读取): ' + navTitle);

    // 抓可见文本
    const uniq = [];
    try {
      const nodes = await page.$$('view, text, textarea, button');
      const seen = new Set();
      for (const el of nodes) {
        try {
          const t = await el.text();
          if (t && t.trim() && !seen.has(t.trim())) { seen.add(t.trim()); uniq.push(t.trim()); }
        } catch (e) {}
      }
    } catch (e) {
      console.log('[WARN] 取节点失败: ' + (e && e.message));
    }

    console.log('可见文本（去重，共 ' + uniq.length + ' 条）:');
    uniq.forEach(t => console.log('  · ' + t));

    const all = uniq.join(' | ');
    const checks = [
      ['含「画面感内容定制」', all.indexOf('画面感内容定制') >= 0],
      ['不含「定制我的连环画」', all.indexOf('定制我的连环画') < 0],
      ['不含「定制连环画」', all.indexOf('定制连环画') < 0],
      ['不含「生成我的连环画」', all.indexOf('生成我的连环画') < 0],
      ['不含「AI」', all.indexOf('AI') < 0]
    ];
    console.log('断言:');
    checks.forEach(c => console.log('  ' + (c[1] ? '✓' : '✗') + ' ' + c[0]));
    summary.push({ page: p, pass: checks.every(c => c[1]), texts: uniq });

    const shot = path.join(OUT, p.split('/').pop() + '.png');
    try { await mp.screenshot({ path: shot }); console.log('截图: ' + shot); }
    catch (e) { console.log('[WARN] mp.screenshot 失败: ' + (e && e.message)); }
  }

  console.log('\n════════ 汇总 ════════');
  summary.forEach(s => console.log((s.pass ? '✓ PASS' : '✗ FAIL') + '  ' + s.page));

  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})();
