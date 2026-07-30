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
 *   - Kanonik alan adı        yalnızca CANONICAL_HOST tanımlıysa (varsayılan kapalı)
 *   - 404 için 404.html
 *   - Önbellek ve güvenlik başlıkları
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// Dosya kökü iki yerleşimi de destekler: sayfalar `public/` altındaysa orayı,
// değilse server.js ile aynı klasörü (Hostinger'daki public_html) kullanır.
const ROOT = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : __dirname;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Kanonik alan adı yönlendirmesi (apex -> www).
// VARSAYILAN OLARAK KAPALIDIR. Hostinger'ın sağlık kontrolü uygulamayı apex
// host'uyla yokluyorsa, 200 yerine 301 alması uygulamayı sağlıksız saydırıp
// 503'e yol açabiliyor. Yönlendirmeyi platform (hPanel) tarafında yapmak daha
// güvenli. Yine de uygulama içinde istenirse CANONICAL_HOST ortam değişkenini
// 'www.threepointdigital.com' olarak tanımlamak yeterli.
const CANONICAL_HOST = process.env.CANONICAL_HOST || '';

// --- Kârlılık Merkezi mini uygulaması ---------------------------------------
// Kayıt ve kaydedilen ürünler Supabase'de durur. Servis anahtarı yalnızca
// sunucuda okunur; tarayıcıya hiç gitmez. Ortam değişkenleri tanımlı değilse
// uygulama "cihaz modunda" çalışır: kapı açılır, ürünler yalnızca tarayıcıda
// saklanır (bkz. registerHandler).
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'tpd_registrations';
const hasSupabase = () => Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

// Kötü niyetli büyük istekleri erken kes.
const MAX_BODY_BYTES = 64 * 1024;

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

/* ==========================================================================
   Kârlılık Merkezi API'si
   POST /api/kayit    { contact, storeName }        -> { id, mode }
   GET  /api/urunler?id=...                        -> { products }
   PUT  /api/urunler  { id, products }             -> { ok }
   ========================================================================== */

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign(
    {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    SECURITY_HEADERS
  ));
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(new Error('bad-json'));
      }
    });
    req.on('error', reject);
  });
}

// Türkiye cep telefonu: 5xxxxxxxxx (10 hane). 0/+90/90 önekleri temizlenir.
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? digits : '';
}

function supabase(pathAndQuery, init = {}) {
  return fetch(SUPABASE_URL + pathAndQuery, Object.assign({}, init, {
    headers: Object.assign(
      {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      init.headers || {}
    ),
  }));
}

async function handleRegister(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return jsonResponse(res, e.message === 'too-large' ? 413 : 400, { error: 'Kayıt tamamlanamadı.' });
  }

  // Bot tuzağı: gizli alan doluysa sessizce reddet.
  if (body.website) return jsonResponse(res, 400, { error: 'Kayıt tamamlanamadı.' });

  const phone = normalizePhone(body.contact);
  const fullName = String(body.fullName || '').trim().replace(/\s+/g, ' ');
  const email = String(body.email || '').trim().toLowerCase();

  if (fullName.length < 3 || fullName.length > 120 || !fullName.includes(' ')) {
    return jsonResponse(res, 400, { error: 'Ad ve soyadını birlikte yaz.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) {
    return jsonResponse(res, 400, { error: 'Geçerli bir e-posta adresi gir.' });
  }
  if (!phone) {
    return jsonResponse(res, 400, { error: 'Geçerli bir cep telefonu numarası gir (05xx xxx xx xx).' });
  }

  // Supabase tanımlı değilse uygulama cihaz modunda çalışmaya devam eder:
  // kapı açılır, ürünler yalnızca tarayıcıda saklanır.
  if (!hasSupabase()) {
    console.warn('[kayit] SUPABASE_URL/SUPABASE_SERVICE_KEY tanımsız — cihaz modu');
    return jsonResponse(res, 200, { id: 'local-' + phone, mode: 'local' });
  }

  try {
    const found = await supabase(
      `/rest/v1/${SUPABASE_TABLE}?select=id&phone=eq.${encodeURIComponent(phone)}&limit=1`
    );
    if (found.ok) {
      const rows = await found.json();
      if (Array.isArray(rows) && rows.length && rows[0].id) {
        // Mağaza adı değişmişse güncelle, aynı numaraya ikinci kayıt açma.
        // Aynı numara tekrar kayıt olursa yeni satır açmaz, bilgilerini tazeler.
        await supabase(`/rest/v1/${SUPABASE_TABLE}?id=eq.${rows[0].id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ full_name: fullName, email: email }),
        });
        return jsonResponse(res, 200, { id: rows[0].id, mode: 'sync' });
      }
    }

    const id = require('crypto').randomUUID();
    const inserted = await supabase(`/rest/v1/${SUPABASE_TABLE}`, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id, phone, full_name: fullName, email, products: [] }),
    });

    if (!inserted.ok) {
      const detail = await inserted.text();
      // 23505 = unique violation; araya başka istek girmiş olabilir.
      if (detail.includes('23505')) {
        const again = await supabase(
          `/rest/v1/${SUPABASE_TABLE}?select=id&phone=eq.${encodeURIComponent(phone)}&limit=1`
        );
        const rows = again.ok ? await again.json() : [];
        if (Array.isArray(rows) && rows.length) {
          return jsonResponse(res, 200, { id: rows[0].id, mode: 'sync' });
        }
      }
      console.error('[kayit] Supabase insert hatası', inserted.status, detail);
      return jsonResponse(res, 500, { error: 'Kayıt şu anda tamamlanamadı.' });
    }

    return jsonResponse(res, 201, { id, mode: 'sync' });
  } catch (error) {
    console.error('[kayit] hata', error);
    return jsonResponse(res, 500, { error: 'Kayıt şu anda tamamlanamadı.' });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleProducts(req, res, url) {
  if (!hasSupabase()) return jsonResponse(res, 200, { products: [], mode: 'local' });

  if (req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    if (!UUID_RE.test(id)) return jsonResponse(res, 400, { error: 'Geçersiz oturum.' });
    try {
      const r = await supabase(`/rest/v1/${SUPABASE_TABLE}?select=products&id=eq.${id}&limit=1`);
      const rows = r.ok ? await r.json() : [];
      const products = Array.isArray(rows) && rows.length && Array.isArray(rows[0].products)
        ? rows[0].products
        : [];
      return jsonResponse(res, 200, { products, mode: 'sync' });
    } catch (error) {
      console.error('[urunler] okuma hatası', error);
      return jsonResponse(res, 500, { error: 'Ürünler getirilemedi.' });
    }
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return jsonResponse(res, e.message === 'too-large' ? 413 : 400, { error: 'Kaydedilemedi.' });
    }
    const id = String(body.id || '');
    if (!UUID_RE.test(id)) return jsonResponse(res, 400, { error: 'Geçersiz oturum.' });
    if (!Array.isArray(body.products)) return jsonResponse(res, 400, { error: 'Kaydedilemedi.' });
    // Kârlılık Merkezi cihazda en fazla 50 ürün tutuyor; sunucu da aynı sınırı uygular.
    const products = body.products.slice(0, 50);
    try {
      const r = await supabase(`/rest/v1/${SUPABASE_TABLE}?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ products, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) {
        console.error('[urunler] yazma hatası', r.status, await r.text());
        return jsonResponse(res, 500, { error: 'Kaydedilemedi.' });
      }
      return jsonResponse(res, 200, { ok: true });
    } catch (error) {
      console.error('[urunler] yazma hatası', error);
      return jsonResponse(res, 500, { error: 'Kaydedilemedi.' });
    }
  }

  return jsonResponse(res, 405, { error: 'Desteklenmeyen yöntem.' });
}

// Site içeriği olmayan proje dosyaları. Deploy repo kökünü aldığı için bunlar
// da web köküne düşer; sunucu seviyesinde kapatılır.
const PRIVATE_DIRS = ['api', 'src', 'supabase', 'node_modules', '_yedek-mevcut-site'];
const PRIVATE_FILES = ['server.js', 'package.json', 'package-lock.json', 'wrangler.jsonc'];
const PRIVATE_EXTS = new Set(['.md', '.jsonc', '.sql', '.ts', '.yml', '.yaml', '.log']);

function isPrivatePath(urlPath) {
  const parts = urlPath.split('/').filter(Boolean);
  if (parts.some((part) => part.startsWith('.'))) return true;
  if (parts.length && PRIVATE_DIRS.includes(parts[0])) return true;
  const last = parts[parts.length - 1] || '';
  if (PRIVATE_FILES.includes(last)) return true;
  return PRIVATE_EXTS.has(path.extname(last).toLowerCase());
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

  // --- Kârlılık Merkezi API'si (statik dosyalardan önce) ---
  if (urlPath === '/api/kayit') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Yalnızca POST desteklenir.' });
    return void handleRegister(req, res);
  }
  if (urlPath === '/api/urunler') {
    const parsed = new URL(rawUrl, 'http://localhost');
    return void handleProducts(req, res, parsed);
  }
  if (urlPath === '/api/durum') {
    return jsonResponse(res, 200, { ok: true, supabase: hasSupabase() });
  }

  // --- Yayına açılmaması gereken dosyalar ---
  // Deploy repo kökünü aldığı için proje dosyaları da sunucunun yanında durur.
  // Bunlar site içeriği değildir; istenirse 404 döner (403 varlığı doğrular).
  if (isPrivatePath(urlPath)) return notFound(res);

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
