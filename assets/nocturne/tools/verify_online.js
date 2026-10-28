/**
 * 线上站点实拍验证
 * ---------------------------------------------------------------
 * 用法：PORT=8780 node tools/verify_online.js
 * 无 PORT 则验证 GitHub Pages 线上地址。
 *
 * 检查项：
 *   1. 3D 场景是否就绪（showcase.is-3d + canvas opacity）
 *   2. 3D 就绪耗时（CDN 慢时会很关键）
 *   3. 是否有坏图
 *   4. 控制台错误 / 失败请求
 */

const puppeteer = require('puppeteer-core');

const PORT = process.env.PORT;
const BASE = PORT ? `http://127.0.0.1:${PORT}` : 'https://zhouyaobai.github.io/shanhe-baiduren';
const WAIT = Number(process.env.WAIT || 20000);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
      '--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-webgl',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 140)); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ': ' + r.url()); });

  // 记录 3D 就绪耗时
  await page.evaluateOnNewDocument(() => {
    window.__t0 = Date.now();
    window.__readyAt = null;
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.getElementById('showcase');
      if (!s) return;
      const obs = new MutationObserver(() => {
        if (s.classList.contains('is-3d') && !window.__readyAt) {
          window.__readyAt = Date.now() - window.__t0;
        }
      });
      obs.observe(s, { attributes: true, attributeFilter: ['class'] });
    });
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, WAIT));

  const st = await page.evaluate(() => {
    const s = document.getElementById('showcase');
    const c = document.getElementById('gl-canvas');
    return {
      cls: s ? s.className : 'NO SECTION',
      opacity: c ? getComputedStyle(c).opacity : 'n/a',
      readyMs: window.__readyAt,
    };
  });
  console.log('目标:', BASE);
  console.log('3D 状态:', JSON.stringify(st));

  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter(i => !i.complete || i.naturalWidth === 0)
      .map(i => i.getAttribute('src'))
  );
  console.log('坏图:', JSON.stringify(broken));

  await page.evaluate(() => {
    const el = document.getElementById('showcase');
    if (el) window.scrollTo(0, el.offsetTop);
  });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/verify_showcase.png' });
  console.log('截图: /tmp/verify_showcase.png');

  console.log(errors.length ? errors.slice(0, 8).join('\n') : '零错误');
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
