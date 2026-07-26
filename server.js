/*
 * Three Point Digital — bağımlılıksız statik dosya sunucusu.
 * Hostinger / Node app hosting ortamlarında `npm start` ile çalışır;
 * PORT ortam değişkenini kullanır (yoksa 3000).
 *
 * Davranışlar:
 *   - Uzantısız temiz URL     (/referanslar        -> referanslar.html)
 *   - /sayfa.html -> /sayfa   301
 *   - /index.html -> /        301
 *   - Sondaki eğik çizgi      301 ile kaldırılır (kök hariç)
 *   - Kanonik alan adı        threepointdigital.com -> www.threepointdigital.com 301
 *   - 404 için 404.html
 *   - Önbellek ve güvenlik başlıkları
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Kanonik alan adı. Boş bırakılırsa alan adı yönlendirmesi yapılmaz.
const CANONICAL_HOST = process.env.CANONICAL_HOST || 'www.threepointdigital.com';

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

// Uzun ömürlü önbellek: içerik değişince dosya adı da değiştiği varsayılmaz,
// bu yüzden HTML her zaman taze alınır, statik varlıklar uzun süre saklanır.
const LONG_CACHE = new Set(['.woff2', '.woff', '.ttf']);
const MEDIUM_CACHE = new Set(['.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.svg']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function cacheControl(ext) {
  if (LONG_CACHE.has(ext)) return 'public, max-age=31536000, immutable';
  if (MEDIUM_CACHE.has(ext)) return 'public, max-age=2592000';
  if (ext === '.html') return 'public, max-age=0, must-revalidate';
  return 'public, max-age=3600';
}

function send(res, status, type, body, extraHeaders) {
  res.writeHead(status, Object.assign({ 'Content-Type': type }, SECURITY_HEADERS, extraHeaders || {}));
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(301, Object.assign({ Location: location, 'Cache-Control': 'no-cache' }, SECURITY_HEADERS));
  res.end();
}

function notFound(res) {
  fs.readFile(path.join(ROOT, '404.html'), (err, data) => {
    if (err) {
      return send(res, 404, 'text/html; charset=utf-8',
        '<!doctype html><meta charset="utf-8"><title>404</title>' +
        '<div style="font-family:sans-serif;text-align:center;padding:4rem">' +
        '<h1>404 — Sayfa bulunamadı</h1><p><a href="/">Ana sayfaya dön</a></p></div>');
    }
    send(res, 404, MIME['.html'], data, { 'Cache-Control': 'no-store' });
  });
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return notFound(res);
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, MIME[ext] || 'application/octet-stream', data, {
      'Cache-Control': cacheControl(ext),
    });
  });
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  const queryIndex = rawUrl.indexOf('?');
  const query = queryIndex === -1 ? '' : rawUrl.slice(queryIndex);

  let urlPath;
  try {
    urlPath = decodeURIComponent(queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex));
  } catch (e) {
    return send(res, 400, 'text/plain; charset=utf-8', 'Bad request');
  }

  // --- Kanonik alan adı yönlendirmesi (CDN arkasında Host korunur) ---
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  if (CANONICAL_HOST && host && host !== CANONICAL_HOST && host !== 'localhost' && host !== '127.0.0.1') {
    return redirect(res, 'https://' + CANONICAL_HOST + urlPath + query);
  }

  // --- /index.html -> / ---
  if (urlPath === '/index.html') return redirect(res, '/' + query);

  // --- /sayfa.html -> /sayfa ---
  if (urlPath.endsWith('.html') && urlPath !== '/404.html') {
    return redirect(res, urlPath.slice(0, -5) + query);
  }

  // --- Sondaki eğik çizgiyi kaldır (kök hariç) ---
  if (urlPath.length > 1 && urlPath.endsWith('/')) {
    return redirect(res, urlPath.slice(0, -1) + query);
  }

  if (urlPath === '/') urlPath = '/index.html';

  let filePath = path.normalize(path.join(ROOT, urlPath));
  // dizin dışına çıkışı engelle
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) return serveFile(res, filePath);

    // Uzantısız temiz URL (ör. /referanslar -> referanslar.html)
    if (!path.extname(filePath)) {
      const htmlPath = filePath + '.html';
      return fs.stat(htmlPath, (err2, stat2) => {
        if (!err2 && stat2.isFile()) return serveFile(res, htmlPath);
        notFound(res);
      });
    }

    notFound(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Three Point Digital sunucusu çalışıyor: http://${HOST}:${PORT}`);
});
