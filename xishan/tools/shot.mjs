#!/usr/bin/env node
/**
 * 自带静态服务 + CDP 截图 / 诊断
 * 用法: node tools/shot.mjs <root> <outdir> [W] [H] [scrolls]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const root = process.argv[2];
const outDir = process.argv[3] || '/tmp/shots';
const W = Number(process.argv[4] || 1440);
const H = Number(process.argv[5] || 900);
const SCROLLS = (process.argv[6] || '0,0.16,0.32,0.5,0.68,0.86,1').split(',').map(Number);
const PORT = 8899;
const CDP = 9500 + Math.floor(Math.random() * 300);

mkdirSync(outDir, { recursive: true });
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg',
};

const srv = http.createServer((req, res) => {
  let f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith('/')) f = path.join(f, 'index.html');
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    });
    res.end(buf);
  });
});

await new Promise(r => srv.listen(PORT, r));

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${CDP}`,
  '--disable-gpu', '--use-gl=swiftshader', '--in-process-gpu',
  '--no-sandbox', '--no-first-run', '--disable-crash-reporter',
  '--disable-features=Crashpad', '--hide-scrollbars',
  `--user-data-dir=/tmp/cdp${CDP}`, `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP}/json/version`);
    if (r.ok) { wsUrl = (await r.json()).webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(300);
}
if (!wsUrl) { console.log('CDP_FAIL'); chrome.kill('SIGKILL'); srv.close(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));

let mid = 0;
const pending = new Map();
const errors = [];
const logs = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push((d.exception?.description || d.text || '').split('\n').slice(0, 3).join(' | '));
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = m.params.type;
    const txt = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (t === 'error' || t === 'warning') errors.push(`[${t}] ${txt}`);
    else logs.push(`[${t}] ${txt}`);
  }
  if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error') errors.push(`[log:${e.source}] ${e.text} ${e.url || ''}`);
  }
});

const send = (method, params = {}, sessionId) => new Promise(res => {
  const id = ++mid; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });

await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride',
  { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, sessionId);
await sleep(5000);

const shots = [];
for (let i = 0; i < SCROLLS.length; i++) {
  const t = SCROLLS[i];
  if (t > 0) {
    await send('Runtime.evaluate', {
      expression: `window.scrollTo(0, (document.body.scrollHeight - innerHeight) * ${t})`,
    }, sessionId);
    await sleep(1700);
  }
  const { result } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const nm = `${outDir}/${String(i).padStart(2, '0')}.png`;
  writeFileSync(nm, Buffer.from(result.data, 'base64'));
  shots.push(nm);
}

const metrics = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    title: document.title,
    acts: document.querySelectorAll('.act').length,
    scenes: document.querySelectorAll('.scene').length,
    songs: document.querySelectorAll('.song').length,
    songcards: document.querySelectorAll('.songcard').length,
    lyrics: document.querySelectorAll('.lyric .ly').length,
    dlg: document.querySelectorAll('.dlg').length,
    sd: document.querySelectorAll('.sd').length,
    cast: document.querySelectorAll('.person').length,
    threads: document.querySelectorAll('.thread').length,
    motifs: document.querySelectorAll('.motif').length,
    plates: document.querySelectorAll('.plate').length,
    rail: document.querySelectorAll('.rail-item').length,
    nav: document.querySelectorAll('.topnav a').length,
    mechRows: document.querySelectorAll('.mech-row').length,
    spine: document.querySelectorAll('.spine-item').length,
    canvas: document.querySelector('#stage')?.width || 0,
    scrollH: document.body.scrollHeight,
    dataJs: typeof window.SCRIPT,
  })`,
  returnByValue: true,
}, sessionId);

console.log('METRICS ' + metrics.result.result.value);
console.log('ERRORS(' + errors.length + ') ' + JSON.stringify(errors.slice(0, 12), null, 1));
if (logs.length) console.log('LOGS ' + JSON.stringify(logs.slice(0, 6), null, 1));
console.log('SHOTS ' + shots.length);

await send('Target.closeTarget', { targetId });
ws.close();
chrome.kill('SIGKILL');
srv.close();
process.exit(0);
