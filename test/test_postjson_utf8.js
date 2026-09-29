// 验证 ai_gen 等云函数的 HTTP 响应解码 bug 与修复
// ───────────────────────────────────────────────────────────────────
// Root cause：res.on('data', c => (d += c)) 中 data 事件给的是 Buffer，
//   每个 chunk 被独立 `c.toString('utf8')` 解码。当多字节汉字（3 字节/字）被 TCP
//   分片截断时，半截字节解码成替换字符 → 文案里出现 ??? / �。
// Fix：先把所有 chunk 推进 Buffer[]，结束时 Buffer.concat(...).toString('utf8') 一次性
//   解码，字符边界完整。
//
// 本脚本做两件事：
//   ① 机制复现（确定性）：把响应字节流按「每字节一刀」模拟 TCP 分片，分别用旧/新逻辑累积，
//      断言旧逻辑产生乱码、新逻辑完整还原。
//   ② 真实 socket 复现：本地起 HTTP 服务，1 字节 1 段发送（两端 setNoDelay），端到端验证。

const http = require('http');

// 一段典型的中文文案（含 emoji、全角标点、多字节汉字），会被拆成多段
const PAYLOAD = '【1】昨晚十一点下楼丢垃圾，看见隔壁大爷在路灯下给流浪猫热饺子。原来有人比我还舍不得这栋楼。🐱\n' +
  '【2】今天聊到一个观察：真正慢下来的人，不是没事做，是把值得和将就分得很清。\n' +
  '【3】那一年冬天，老家巷口，外婆总在路口等我。后来她记不起我的名字了，我才懂那是最慢也最暖的告别。';
const BODY = JSON.stringify({ output_text: PAYLOAD });
const BODY_BUF = Buffer.from(BODY, 'utf8');

// 旧逻辑（buggy）：逐块 d += c
function oldAccumulate(chunks) {
  let d = '';
  for (const c of chunks) d += c; // c 是 Buffer，等价于 c.toString('utf8')
  return d;
}
// 新逻辑（fixed）：Buffer.concat 后统一解码
function newAccumulate(chunks) {
  return Buffer.concat(chunks).toString('utf8');
}

// 把整段字节流按「每字节一刀」模拟 TCP 分片（最极端、必触发截断）
function splitPerByte(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) out.push(buf.slice(i, i + 1));
  return out;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      let i = 0;
      const tick = () => {
        if (i >= BODY_BUF.length) { res.end(); return; }
        res.write(BODY_BUF.slice(i, i + 1)); // 1 字节 1 段
        i++;
        setImmediate(tick);
      };
      tick();
    });
    server.on('connection', (s) => s.setNoDelay(true));
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function oldPostJSON(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('socket', (s) => s && s.setNoDelay && s.setNoDelay());
    req.on('error', reject);
    req.end();
  });
}
function newPostJSON(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('socket', (s) => s && s.setNoDelay && s.setNoDelay());
    req.on('error', reject);
    req.end();
  });
}

let failures = 0;
function check(name, cond) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
  if (!cond) failures++;
}

(async () => {
  console.log('— ① 机制复现（确定性：每字节一刀模拟 TCP 分片）—');
  const byteChunks = splitPerByte(BODY_BUF);
  const oldText = oldAccumulate(byteChunks);
  const newText = newAccumulate(byteChunks);
  const oldObj = (() => { try { return JSON.parse(oldText); } catch (e) { return null; } })();
  const oldRestored = oldObj && oldObj.output_text === PAYLOAD;
  const newRestored = newText === BODY && JSON.parse(newText).output_text === PAYLOAD;

  console.log('   旧逻辑 output_text 前 30 字:', JSON.stringify((oldObj && oldObj.output_text || '').slice(0, 30)));
  console.log('   新逻辑 output_text 前 30 字:', JSON.stringify(JSON.parse(newText).output_text.slice(0, 30)));
  check('旧逻辑(逐块 d+=c) 产生乱码、无法完整还原原文', !oldRestored);
  check('新逻辑(Buffer.concat 统一解码) 完整还原原文', newRestored);

  console.log('\n— ② 真实 socket 复现（1 字节/段 + setNoDelay）—');
  const server = await startServer();
  const port = server.address().port;
  try {
    const oldSock = await oldPostJSON(port);
    const newSock = await newPostJSON(port);
    const oldSockOk = oldSock && oldSock.output_text === PAYLOAD;
    const newSockOk = newSock && newSock.output_text === PAYLOAD;
    console.log('   旧逻辑(真实socket) 完整还原 =', oldSockOk, '| 新逻辑(真实socket) 完整还原 =', newSockOk);
    check('真实 socket 下新逻辑完整还原中文文案', newSockOk);
    if (!oldSockOk) console.log('   （符合预期：真实分片下旧逻辑也出现乱码，印证根因）');
    else console.log('   （本轮分片未截断多字节字符，旧逻辑侥幸未乱；机制复现已证明 bug 存在）');
  } catch (e) {
    console.log('   真实 socket 测试异常:', e && e.message);
    failures++;
  } finally {
    server.close();
  }

  console.log('\n' + (failures === 0 ? '✅ 全部通过：修复有效，根因确认' : '❌ 有 ' + failures + ' 项失败'));
  process.exit(failures === 0 ? 0 : 1);
})();
