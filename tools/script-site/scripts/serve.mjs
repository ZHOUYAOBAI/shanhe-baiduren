#!/usr/bin/env node
/* ============================================================
   剧本站 · 本地预览服务器
   ------------------------------------------------------------
   纯 Node，无依赖。正确的 MIME 类型 + 禁用缓存（改完刷新即见）。
   注意：权限门依赖 WebCrypto，必须走 http://localhost 或 HTTPS。

   用法：
     node serve.mjs <站点目录> [--port 8000]
   ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function main() {
  const argv = process.argv.slice(2);
  const pos = argv.filter((a) => !a.startsWith('--'));
  const portIdx = argv.indexOf('--port');
  const root = path.resolve(pos[0] || '.');
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8000;

  if (!fs.existsSync(root)) {
    console.error('✗ 目录不存在：' + root);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400); res.end('bad request'); return;
    }
    if (urlPath.endsWith('/')) urlPath += 'index.html';

    let file = path.join(root, urlPath);
    /* 防目录穿越 */
    if (!path.resolve(file).startsWith(root)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) {
      const nf = path.join(root, '404.html');
      if (fs.existsSync(nf)) {
        const body = fs.readFileSync(nf);
        res.writeHead(404, { 'Content-Type': MIME['.html'], 'Content-Length': body.length });
        res.end(body);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404');
      }
      return;
    }

    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const stat = fs.statSync(file);
    const head = {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store, must-revalidate',
    };
    /* 音频支持范围请求 */
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = parseInt(s, 10) || 0;
      const end = e ? parseInt(e, 10) : stat.size - 1;
      head['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      head['Content-Length'] = end - start + 1;
      head['Accept-Ranges'] = 'bytes';
      res.writeHead(206, head);
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    head['Accept-Ranges'] = 'bytes';
    res.writeHead(200, head);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });

  server.listen(port, () => {
    const nets = os.networkInterfaces();
    const lan = Object.values(nets).flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address)[0];
    console.log('✓ 本地预览已启动');
    console.log('  http://localhost:%d/', port);
    if (lan) console.log('  http://%s:%d/  （同一 Wi-Fi 下可从手机看）', lan, port);
    console.log('  根目录：%s', root);
    console.log('  Ctrl+C 停止');
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error('✗ 端口 %d 被占用，换一个： node serve.mjs %s --port %d', port, root, port + 1);
    } else {
      console.error('✗ ' + e.message);
    }
    process.exit(1);
  });
}

main();
