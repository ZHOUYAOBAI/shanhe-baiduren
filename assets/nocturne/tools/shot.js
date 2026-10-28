const puppeteer = require('puppeteer-core');

const PORT = process.env.PORT || '8780';

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
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.setCacheEnabled(false);

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url() + ' ' + ((r.failure()||{}).errorText||'')));
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push('HTTP ' + r.status() + ': ' + r.url()); });

  // 注意：不能用 networkidle0 —— 3D 场景持续渲染会让"网络空闲"判定一直不成立，
  // 直接超时。改用 domcontentloaded + 固定等待。
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const total = await page.evaluate(() => document.body.scrollHeight);
  console.log('page height:', total);

  // 坏图检查
  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter(i => !i.complete || i.naturalWidth === 0)
      .map(i => i.getAttribute('src'))
  );
  console.log('broken images:', JSON.stringify(broken));

  // 3D 状态
  const gl = await page.evaluate(() => {
    const s = document.getElementById('showcase');
    const c = document.getElementById('gl-canvas');
    return { is3d: s ? s.classList.contains('is-3d') : null, canvas: c ? c.width + 'x' + c.height : null };
  });
  console.log('showcase:', JSON.stringify(gl));

  // 横向溢出检查（响应式回归）
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    const bad = [];
    document.querySelectorAll('section, header, footer, .wrap').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > de.clientWidth + 2) bad.push(el.className || el.tagName);
    });
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, bad: bad.slice(0, 8) };
  });
  console.log('overflow:', JSON.stringify(overflow));

  // 分段截图
  const shots = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000];
  for (const y of shots) {
    if (y > total) break;
    await page.evaluate(v => window.scrollTo(0, v), y);
    await new Promise(r => setTimeout(r, 700));
    await page.screenshot({ path: `/tmp/full_${y}.png` });
  }
  console.log('shots done');

  if (errors.length) {
    console.log('--- ERRORS ---');
    errors.slice(0, 20).forEach(e => console.log(e));
  } else {
    console.log('no errors');
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
