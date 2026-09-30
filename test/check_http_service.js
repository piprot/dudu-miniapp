// CloudBase HTTP 访问服务巡检（只读，零副作用，零依赖 Node 18+）
// 巡检对象：/h5req → h5_request（H5 comic.html 需求表单的唯一后端通道）
//
// 背景（2026-09-30 事故）：用户在云开发控制台删除云函数 ai_gen 时，
// 平台连带删除了 /h5req → h5_request 的 HTTP 访问映射——comic 表单**静默断链**
// （前端只会在提交时报错，无任何告警）。本脚本用于主动发现这类断链。
//
// 判活标准：POST 空 body 到 /h5req，若「网关 + 映射 + 函数」全通，
// h5_request 会返回 HTTP 200 + 业务校验失败 JSON（{"ok":false,"err":"邮箱..."}）。
// 断链特征：HTTP 404 + {"code":"INVALID_PATH"}（映射缺失/网关不认）。
//
// 用法：node test/check_http_service.js
// 修复（映射缺失时，⚠️ 必须用 PowerShell 跑，Git Bash 会把 /h5req 转成 Windows 垃圾路径）：
//   PowerShell: tcb service create -p /h5req -f h5_request
const REQ_URL = 'https://cloudbase-d8ge1hu2324c8fcdf.service.tcloudbase.com/h5req';

(async () => {
  let ok = false, detail = '';
  try {
    const res = await fetch(REQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),   // 空 body → 走 h5_request 的参数校验分支，零副作用
      signal: AbortSignal.timeout(20000)
    });
    const text = await res.text();
    if (res.status === 200 && text.includes('"ok":false') && text.includes('邮箱')) {
      ok = true;
      detail = 'HTTP 200 + 业务校验响应（网关/映射/函数全通）';
    } else {
      detail = 'HTTP ' + res.status + ' ' + text.slice(0, 120);
    }
  } catch (e) {
    detail = '网络异常: ' + (e && e.message);
  }

  console.log((ok ? '✓' : '✗') + ' /h5req → h5_request ' + (ok ? '存活' : '断链！') + '  [' + detail + ']');
  if (!ok) {
    console.log('\n修复方法（⚠️ 必须在 PowerShell 中执行，Git Bash 会破坏路径参数）：');
    console.log('  1) tcb service list                      # 确认 /h5req 映射是否存在');
    console.log('  2) tcb service create -p /h5req -f h5_request');
    console.log('  3) 重跑本脚本验证');
  }
  process.exitCode = ok ? 0 : 1;
})();
