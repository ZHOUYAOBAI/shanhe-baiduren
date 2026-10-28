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
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url() + ' ' + ((r.failure()||{}).errorText||'')));
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ': ' + r.url()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return gl ? 'OK ' + (c.getContext('webgl2') ? 'webgl2' : 'webgl') : 'NO WEBGL';
  });
  console.log('webgl support:', webgl);

  // 是否进入 3D 模式
  const is3d = await page.evaluate(() => {
    const s = document.getElementById('showcase');
    const c = document.getElementById('gl-canvas');
    return {
      is3d: s ? s.classList.contains('is-3d') : 'no section',
      canvas: c ? c.width + 'x' + c.height + ' css:' + c.clientWidth + 'x' + c.clientHeight : 'no canvas',
    };
  });
  console.log('showcase state:', JSON.stringify(is3d));

  // 定位展演屏
  await page.evaluate(() => {
    const el = document.getElementById('showcase');
    if (el) window.scrollTo(0, el.offsetTop);
  });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/gl_stage.png' });
  console.log('shot: stage');

  // canvas 单独截图（看渲染是否真的出像素）
  const el = await page.$('#gl-canvas');
  if (el) await el.screenshot({ path: '/tmp/gl_canvas_only.png' });

  // 像素采样：canvas 是否有非纯色内容
  const px = await page.evaluate(() => {
    const c = document.getElementById('gl-canvas');
    if (!c) return 'no canvas';
    try {
      const t = document.createElement('canvas');
      t.width = 200; t.height = 120;
      const g = t.getContext('2d');
      g.drawImage(c, 0, 0, 200, 120);
      const d = g.getImageData(0, 0, 200, 120).data;
      const set = new Set();
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        set.add((d[i] >> 3) + ',' + (d[i+1] >> 3) + ',' + (d[i+2] >> 3));
        sum += d[i] + d[i+1] + d[i+2];
      }
      return 'uniqueColors=' + set.size + ' avgSum=' + (sum / (d.length / 4) / 3).toFixed(1);
    } catch (e) {
      return 'ERR ' + e.message;
    }
  });
  console.log('canvas pixels:', px);

  // 切到场景 B
  await page.click('#swap-portal').catch(e => console.log('click failed', e.message));
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/gl_spectrum.png' });
  const is3db = await page.evaluate(() => {
    const s = document.getElementById('showcase');
    return s ? s.classList.contains('is-3d') : '?';
  });
  console.log('after swap is3d:', is3db);
  console.log('shot: spectrum');

  // 坏图检查
  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter(i => !i.complete || i.naturalWidth === 0)
      .map(i => i.getAttribute('src'))
  );
  console.log('broken images:', JSON.stringify(broken));

  if (errors.length) {
    console.log('--- ERRORS ---');
    errors.slice(0, 20).forEach(e => console.log(e));
  } else {
    console.log('no errors');
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
