/*
 * Three Point Digital — bağımlılıksız statik dosya sunucusu.
 * Hostinger / Node app hosting ortamlarında `npm start` ile çalışır;
 * PORT ortam değişkenini kullanır (yoksa 3000).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    return send(res, 400, 'text/plain; charset=utf-8', 'Bad request');
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  let filePath = path.normalize(path.join(ROOT, urlPath));
  // dizin dışına çıkışı engelle
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // uzantısız temiz URL denemesi (ör. /referanslar -> /referanslar.html)
      fs.readFile(filePath + '.html', (err2, data2) => {
        if (err2) {
          return send(res, 404, 'text/html; charset=utf-8',
            '<!doctype html><meta charset="utf-8"><title>404</title>' +
            '<div style="font-family:sans-serif;text-align:center;padding:4rem">' +
            '<h1>404 — Sayfa bulunamadı</h1><p><a href="/">Ana sayfaya dön</a></p></div>');
        }
        send(res, 200, MIME['.html'], data2);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, MIME[ext] || 'application/octet-stream', data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Three Point Digital sunucusu çalışıyor: http://${HOST}:${PORT}`);
});
