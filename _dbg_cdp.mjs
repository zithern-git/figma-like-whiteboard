// dbg.mjs - 用 Chrome CDP 抓 http://localhost:5173 刷新时的 console / dialog / 异常
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const USER_DATA = 'C:\\temp\\chrome-cdp-' + Date.now();
rmSync(USER_DATA, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + USER_DATA,
  'about:blank',
], { stdio: 'ignore', detached: false });

const cleanup = () => { try { chrome.kill(); } catch {} };
process.on('exit', cleanup);

await wait(2000);
const res = await fetch(`http://127.0.0.1:${PORT}/json`);
const targets = await res.json();
const target = targets.find(t => t.type === 'page');
if (!target) { console.log('NO TARGET'); cleanup(); process.exit(1); }
console.log('TARGET:', target.url);

const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) => {
  msgId++;
  return new Promise(resolve => {
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
};

const logs = [];
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const args = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || a.unserializableValueValue || a.type)).join(' ');
    logs.push(`[CONSOLE.${msg.params.type}] ${args}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const ed = msg.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${ed.text} :: ${ed.exception?.description || ed.exception?.value || ''}`);
  } else if (msg.method === 'Page.javascriptDialogOpening') {
    logs.push(`[DIALOG ${msg.params.type}] ${msg.params.message}`);
    // 自动 dismiss 防止阻塞
    send('Page.handleJavaScriptDialog', { accept: false });
  } else if (msg.method === 'Log.entryAdded') {
    const e2 = msg.params.entry;
    logs.push(`[LOG.${e2.level}] ${e2.text} (${e2.url || ''}:${e2.lineNumber || 0})`);
  }
});

await new Promise(r => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
await send('Network.enable');

// 注入 hook 捕获 window.alert/confirm/prompt
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (() => {
      const orig = { alert: window.alert, confirm: window.confirm, prompt: window.prompt };
      window.alert = function(...a) { console.warn('DIALOG_ALERT: ' + a.join(' ')); return orig.alert.apply(this, a); };
      window.confirm = function(...a) { console.warn('DIALOG_CONFIRM: ' + a.join(' ')); return orig.confirm.apply(this, a); };
      window.prompt = function(...a) { console.warn('DIALOG_PROMPT: ' + a.join(' ')); return orig.prompt.apply(this, a); };
    })();
  `,
});

await send('Page.navigate', { url: 'http://localhost:5173' });
await wait(8000);

// 也试一下打开白板列表触发更深的页面
try { await send('Page.navigate', { url: 'http://localhost:5173/whiteboards' }); } catch {}
await wait(3000);

console.log('\n=== LOGS ===');
logs.forEach(l => console.log(l));
console.log('=== END ===');
cleanup();
process.exit(0);
