// 交互回归测试：以「第一次访问的观众」身份验证站点
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png' };

const srv = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith('/')) f = path.join(f, 'index.html');
  try {
    const b = fs.readFileSync(f);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    res.end(b);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => srv.listen(8907, r));

const PORT = 9871;
const c = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--use-gl=swiftshader',
    '--in-process-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=/tmp/i${PORT}`,
    '--hide-scrollbars', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) { wsUrl = (await r.json()).webSocketDebuggerUrl; break; } } catch {}
  await sleep(300);
}
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const p = new Map();
const errors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 200));
});
const send = (method, params = {}, sessionId) => new Promise(res => {
  const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
});
const evalJs = async (expr, sessionId) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8907/' }, sessionId);
await sleep(6000);

const T = [];
const chk = (name, ok, detail = '') => { T.push({ name, ok, detail }); };

// 1. 首屏三秒内能知道「这是什么剧」
const hero = await evalJs(`(()=>{const t=document.querySelector('.hero-title');
  const k=document.querySelector('.hero-kicker'); const m=document.querySelector('.hero-meta');
  return {title:t?.textContent.trim(),kicker:k?.textContent.trim(),meta:m?.textContent.replace(/\\s+/g,' ').trim()};})()`, sessionId);
chk('首屏有剧名', !!hero.title, hero.title);
chk('首屏说明体裁与题材', /音乐剧/.test(hero.kicker) && /睡美人/.test(hero.kicker), hero.kicker);
chk('首屏有规模信息', /78/.test(hero.meta) && /14/.test(hero.meta), hero.meta);

// 2. 故事段：一口气读完能知道讲什么
const story = await evalJs(`(()=>{const b=document.querySelector('#storyBox');
  if(!b) return null; return {logline:(b.querySelector('.story-logline')?.textContent||'').trim(),
  layers:b.querySelectorAll('.story-layer').length, thesis:b.querySelectorAll('.thesis').length,
  coda:b.querySelectorAll('.coda-line').length};})()`, sessionId);
chk('故事段已渲染', !!story);
chk('有一句话概括', (story?.logline||'').length > 20, story?.logline);
chk('传说/现实两栏对照', story?.layers === 2, 'layers=' + story?.layers);
chk('三条论点', story?.thesis === 3, 'thesis=' + story?.thesis);
chk('结尾那几句', story?.coda >= 4, 'coda=' + story?.coda);

// 3. 主线：每条都有场次锚点，且锚点真实存在
const spine = await evalJs(`(()=>{const items=[...document.querySelectorAll('.spine-item')];
  const anchors=items.map(a=>a.getAttribute('href'));
  const missing=anchors.filter(h=>h&&h!=='#'&&!document.querySelector(h));
  return {n:items.length, anchors, missing};})()`, sessionId);
chk('主线节点 ≥ 8', spine.n >= 8, 'n=' + spine.n);
chk('主线锚点全部有效', spine.missing.length === 0, 'missing=' + JSON.stringify(spine.missing));

// 4. 唱段：无重复卡片，每首只展开一次
const songs = await evalJs(`(()=>{const cards=[...document.querySelectorAll('.song:not(.song-cont)')];
  const conts=document.querySelectorAll('.song-cont').length;
  const nos=cards.map(c=>c.dataset.song);
  const dup=nos.filter((n,i)=>nos.indexOf(n)!==i);
  return {cards:cards.length, conts, dup, uniq:new Set(nos).size};})()`, sessionId);
chk('唱段卡无重复', songs.dup.length === 0, 'dup=' + JSON.stringify(songs.dup));
chk('七首唱段各一张卡', songs.uniq === 7, 'uniq=' + songs.uniq);

// 5. 点唱段能展开歌词
await evalJs(`document.querySelector('.song[data-song="1"] .song-head').click()`, sessionId);
await sleep(600);
const exp = await evalJs(`(()=>{const c=document.querySelector('.song[data-song="1"]');
  const body=c.querySelector('.song-body');
  const st=getComputedStyle(body);
  return {open:c.classList.contains('open'), lines:c.querySelectorAll('.lyric .ly').length,
  h:body.getBoundingClientRect().height, disp:st.display, vis:st.visibility};})()`, sessionId);
chk('点击唱段可展开', exp.open === true);
chk('展开后有歌词行', exp.lines > 0, 'lines=' + exp.lines);
chk('展开区实际可见', exp.h > 20 && exp.vis === 'visible', 'h=' + exp.h);

// 6. 曲目墙点进去能定位
await evalJs(`document.querySelector('.songcard[data-jump-song="3"]').click()`, sessionId);
await sleep(400);
const jump = await evalJs(`(()=>{const c=document.querySelector('.song[data-song="3"]');
  const r=c?.getBoundingClientRect(); return {open:c?.classList.contains('open'), top:r?.top};})()`, sessionId);
chk('曲目墙可跳转并展开', jump.open === true, 'top=' + Math.round(jump.top));

// 7. 幕与场次导航可用
const acts = await evalJs(`(()=>({acts:document.querySelectorAll('.act').length,
  scenes:document.querySelectorAll('.scene').length,
  sceneHeads:document.querySelectorAll('.scene-head').length}))()`, sessionId);
chk('五幕齐', acts.acts === 5, 'acts=' + acts.acts);
chk('十四场齐', acts.scenes === 14 && acts.sceneHeads === 14, 'scenes=' + acts.scenes);

// 8. 关键内容在场（观众会找的东西）
const content = await evalJs(`(()=>{const t=document.body.innerText;
  return {sleep: t.includes('睡美人'), yuangai: t.includes('1903'), nie: t.includes('聂耳'),
  theme: t.includes('隔着水看的东西'), poem: t.includes('门在这里'), gate: t.includes('对外公开')};})()`, sessionId);
chk('提及睡美人传说', content.sleep);
chk('提及 1903 年史实', content.yuangai);
chk('提及聂耳', content.nie);
chk('主题句在页面中', content.theme);
chk('主题曲名在页面中', content.poem);
chk('公开说明存在', content.gate);

// 9. 段落齐全（观众会找的板块）
const secs = await evalJs(`[...document.querySelectorAll('.sec-num')].map(e=>e.textContent.replace(/\\s/g,''))`, sessionId);
const need = ['故事', '主线', '机制', '歌单', '动机', '人物', '伏笔'];
const miss = need.filter(n => !secs.includes(n));
chk('七个板块齐全', miss.length === 0, '缺=' + JSON.stringify(miss) + ' 有=' + JSON.stringify(secs));

// 10. 移动端不塌
await send('Emulation.setDeviceMetricsOverride',
  { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
await sleep(1200);
const mob = await evalJs(`(()=>({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth,
  overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
  storyCols:getComputedStyle(document.querySelector('.story-layers')).gridTemplateColumns.split(' ').length}))()`, sessionId);
chk('移动端无横向溢出', mob.overflow <= 2, 'overflow=' + mob.overflow);
chk('移动端故事段单栏', mob.storyCols === 1, 'cols=' + mob.storyCols);

console.log('\n══════ 观众视角回归测试 ══════');
let pass = 0;
for (const t of T) {
  console.log(`  ${t.ok ? '✓' : '✗'} ${t.name}${t.detail ? '  〔' + t.detail + '〕' : ''}`);
  if (t.ok) pass++;
}
console.log(`\n  ${pass}/${T.length} 通过`);
if (errors.length) { console.log('\n  JS 异常:'); errors.forEach(e => console.log('   ', e)); }
else console.log('  JS 异常：无');

c.kill('SIGKILL'); srv.close(); process.exit(0);
