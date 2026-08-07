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
const crypto = require('crypto');

/* --- .env dosyası -----------------------------------------------------------
 * Ortam değişkenleri normalde hPanel > Node.js uygulaması ekranından girilir.
 * O ekrana erişilemediğinde aynı değerler sunucunun yanındaki `.env` dosyasına
 * yazılabilir; buradaki okuyucu onu process.env'e yükler. Bağımlılık yoktur.
 *
 * hPanel'de tanımlı bir değişken varsa o kazanır; .env yalnızca eksikleri
 * tamamlar. Dosya git'e girmez (.gitignore) ve web'den istenirse 404 döner
 * (isPrivatePath: nokta ile başlayan yollar kapalıdır).
 */
(function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    let yuklenen = 0;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // hPanel'den gelen değer varsa dokunma.
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
        yuklenen += 1;
      }
    });
    if (yuklenen) console.log(`[env] .env dosyasından ${yuklenen} değişken yüklendi`);
  } catch (error) {
    console.error('[env] .env okunamadı:', error && error.message);
  }
})();

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

// --- İletişim formu ---------------------------------------------------------
// Talep iki kanala birden gider: Supabase (panelde görünsün diye) ve FormSubmit
// (posta kutusuna düşsün diye). Biri çalışmazsa diğeri talebi kurtarır.
const LEADS_TABLE = process.env.LEADS_TABLE || 'tpd_leads';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'info@threepointdigital.com';
// Yerel testte gerçek e-posta gönderilmesin diye uç adres değiştirilebilir.
const FORMSUBMIT_URL = process.env.FORMSUBMIT_URL || 'https://formsubmit.co/ajax/' + CONTACT_EMAIL;

// --- Yönetim paneli ---------------------------------------------------------
// Tek yönetici şifresi. Tercihen ADMIN_PASSWORD_HASH (şifrenin sha256 özeti)
// tanımlanır; ADMIN_PASSWORD düz metin olarak da kabul edilir ama önerilmez.
// Özet üretmek için:  node -e "console.log(require('crypto').createHash('sha256').update('ŞİFREN').digest('hex'))"
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_HASH = (process.env.ADMIN_PASSWORD_HASH || '').trim().toLowerCase();
// Oturum çerezinin imza anahtarı. Tanımlı değilse şifreden türetilir; bu
// sayede şifre değiştiğinde eski oturumlar kendiliğinden geçersizleşir.
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || '';
const ADMIN_COOKIE = 'tpd_admin';
const ADMIN_SESSION_DAYS = 7;
const hasAdmin = () => Boolean(ADMIN_PASSWORD_HASH || ADMIN_PASSWORD);

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

    const id = crypto.randomUUID();
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

/* ==========================================================================
   İletişim formu — POST /api/iletisim
   Talep önce Supabase'e yazılır, ardından FormSubmit ile e-postaya iletilir.
   İki kanaldan biri başarısız olsa bile talep kaybolmaz; her ikisi de
   başarısızsa tarayıcı doğrudan FormSubmit'e düşer (bkz. assets/site.js).
   ========================================================================== */

const MARKETPLACES = [
  'Trendyol',
  'Amazon Türkiye',
  'Hepsiburada',
  'Birden fazla platform',
  'Henüz satışa başlamadım',
];

function clean(value, maxLength) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

// FormSubmit'e talebi e-posta olarak iletir. Hata fırlatmaz; sonucu döndürür,
// çünkü e-posta gitmese bile kayıt veritabanında durabilir.
async function sendLeadEmail(lead) {
  try {
    const response = await fetch(FORMSUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: 'Ücretsiz pazaryeri analizi talebi — threepointdigital.com',
        _template: 'table',
        Ad: lead.full_name,
        Marka: lead.brand,
        'E-posta': lead.email,
        Telefon: lead.phone ? '0' + lead.phone : '-',
        'Öncelikli pazaryeri': lead.marketplace || '-',
        'Aylık ciro aralığı': lead.revenue || '-',
        Mesaj: lead.message,
        'Gönderim sayfası': lead.source_page || '-',
      }),
    });
    if (!response.ok) {
      console.error('[iletisim] FormSubmit yanıtı', response.status);
      return false;
    }
    const result = await response.json().catch(() => ({}));
    const ok = result && (result.success === true || result.success === 'true');
    if (!ok) console.error('[iletisim] FormSubmit başarısız', JSON.stringify(result).slice(0, 300));
    return Boolean(ok);
  } catch (error) {
    console.error('[iletisim] FormSubmit hatası', error && error.message);
    return false;
  }
}

async function handleContact(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return jsonResponse(res, e.message === 'too-large' ? 413 : 400, { error: 'Form gönderilemedi.' });
  }

  // Bot tuzağı: gizli alan doluysa sessizce başarılı görün, hiçbir yere yazma.
  if (body._honey) return jsonResponse(res, 200, { ok: true });

  const lead = {
    id: crypto.randomUUID(),
    full_name: clean(body.name, 120),
    brand: clean(body.brand, 160),
    email: clean(body.email, 160).toLowerCase(),
    phone: normalizePhone(body.phone),
    marketplace: clean(body.marketplace, 60),
    revenue: clean(body.revenue, 60),
    message: String(body.message == null ? '' : body.message).trim().slice(0, 4000),
    source_page: clean(body.page, 300),
  };

  if (lead.full_name.length < 3) {
    return jsonResponse(res, 400, { error: 'Lütfen ad ve soyadınızı yazın.' });
  }
  if (lead.brand.length < 2) {
    return jsonResponse(res, 400, { error: 'Lütfen marka veya şirket adını yazın.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) {
    return jsonResponse(res, 400, { error: 'Geçerli bir e-posta adresi yazın.' });
  }
  if (lead.message.length < 5) {
    return jsonResponse(res, 400, { error: 'Lütfen kısaca hedefinizi veya sorununuzu yazın.' });
  }
  if (lead.marketplace && !MARKETPLACES.includes(lead.marketplace)) lead.marketplace = '';

  // E-posta ve veritabanı birbirini beklemez; ikisi de denenir.
  const emailPromise = sendLeadEmail(lead);

  let stored = false;
  if (hasSupabase()) {
    try {
      const inserted = await supabase(`/rest/v1/${LEADS_TABLE}`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(Object.assign({}, lead, { emailed: false })),
      });
      stored = inserted.ok;
      if (!inserted.ok) {
        console.error('[iletisim] Supabase insert hatası', inserted.status, (await inserted.text()).slice(0, 300));
      }
    } catch (error) {
      console.error('[iletisim] Supabase hatası', error && error.message);
    }
  } else {
    console.error('[iletisim] SUPABASE_URL/SUPABASE_SERVICE_KEY tanımsız — talep panele düşmeyecek, yalnızca e-posta gönderildi');
  }

  const emailed = await emailPromise;

  // Kayıt yazıldıysa e-posta durumunu işaretle (panelde görünsün).
  if (stored && emailed && hasSupabase()) {
    supabase(`/rest/v1/${LEADS_TABLE}?id=eq.${lead.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ emailed: true }),
    }).catch(() => {});
  }

  if (!stored && !emailed) {
    // Her iki kanal da başarısız: tarayıcı FormSubmit'e kendisi düşecek.
    return jsonResponse(res, 502, { error: 'Form gönderilemedi.', fallback: true });
  }

  return jsonResponse(res, 201, { ok: true, stored, emailed });
}

/* ==========================================================================
   Yönetim paneli — /admin
   Tek yönetici şifresi, HMAC imzalı HttpOnly çerez, IP başına deneme sınırı.
   Panel HTML'i yalnızca oturum açıkken servis edilir; dosya olarak doğrudan
   erişilemez (bkz. PRIVATE_FILES).
   ========================================================================== */

function sessionSecret() {
  return ADMIN_SESSION_SECRET || 'tpd|' + ADMIN_PASSWORD_HASH + '|' + ADMIN_PASSWORD;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// Uzunluk sızdırmadan sabit süreli karşılaştırma.
function safeEqual(a, b) {
  const bufA = Buffer.from(sha256(a), 'hex');
  const bufB = Buffer.from(sha256(b), 'hex');
  return crypto.timingSafeEqual(bufA, bufB);
}

function passwordMatches(candidate) {
  if (!candidate) return false;
  if (ADMIN_PASSWORD_HASH) return safeEqual(sha256(candidate), ADMIN_PASSWORD_HASH);
  if (ADMIN_PASSWORD) return safeEqual(candidate, ADMIN_PASSWORD);
  return false;
}

// Kullanıcı adı büyük/küçük harf duyarsız karşılaştırılır; yanlış kullanıcı adı
// ile yanlış şifre aynı hatayı döndürür (hangisinin yanlış olduğu sızmasın).
function usernameMatches(candidate) {
  return safeEqual(String(candidate || '').trim().toLowerCase(), ADMIN_USERNAME.toLowerCase());
}

function signSession(expiresAt) {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt }), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return payload + '.' + mac;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch (e) {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const jar = {};
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index === -1) return;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return jar;
}

function isSecureRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || '';
  return proto.split(',')[0].trim() === 'https';
}

function sessionCookie(req, token, maxAgeSeconds) {
  return [
    ADMIN_COOKIE + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + maxAgeSeconds,
    isSecureRequest(req) ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function isLoggedIn(req) {
  return verifySession(parseCookies(req)[ADMIN_COOKIE]);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'] || '';
  return String(forwarded).split(',')[0].trim() || req.socket.remoteAddress || 'bilinmiyor';
}

// --- Kaba kuvvet koruması: IP başına 5 hatalı deneme -> 15 dakika kilit ------
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function loginLockedFor(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return 0;
  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    return Math.ceil((record.lockedUntil - Date.now()) / 1000);
  }
  return 0;
}

function noteFailedLogin(ip) {
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= LOGIN_MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOGIN_LOCK_MS;
    record.count = 0;
    console.warn('[admin] çok fazla hatalı giriş, IP kilitlendi:', ip);
  }
  loginAttempts.set(ip, record);
}

// Bellek sızıntısı olmasın: saatte bir süresi dolmuş kayıtları at.
setInterval(() => {
  const now = Date.now();
  loginAttempts.forEach((record, ip) => {
    if (!record.lockedUntil || record.lockedUntil < now) loginAttempts.delete(ip);
  });
}, 60 * 60 * 1000).unref();

// Yazma isteklerinde kaynak kontrolü (SameSite=Strict'in yanında ikinci kat).
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Origin göndermeyen istemciler için çerez zaten SameSite ile korunuyor
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  try {
    return new URL(origin).host === host;
  } catch (e) {
    return false;
  }
}

// --- Panel verisi -----------------------------------------------------------

const LEAD_STATUSES = ['yeni', 'arandi', 'teklif', 'kazanildi', 'kayip'];

function supabaseUnavailable(res) {
  return jsonResponse(res, 503, {
    error: 'Veritabanı bağlı değil. hPanel > Node.js uygulaması > ortam değişkenlerine ' +
      'SUPABASE_URL ve SUPABASE_SERVICE_KEY ekleyip uygulamayı yeniden başlatın.',
  });
}

// PostgREST filtre değerlerinde virgül ve parantez ayırıcıdır; kaçır.
function pgQuote(value) {
  return '"' + String(value).replace(/["\\]/g, '\\$&') + '"';
}

async function adminSummary(req, res) {
  if (!hasSupabase()) return supabaseUnavailable(res);
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [leads, newLeads, weekLeads, regs] = await Promise.all([
      supabase(`/rest/v1/${LEADS_TABLE}?select=id&limit=1`, { headers: { Prefer: 'count=exact' } }),
      supabase(`/rest/v1/${LEADS_TABLE}?select=id&status=eq.yeni&limit=1`, { headers: { Prefer: 'count=exact' } }),
      supabase(`/rest/v1/${LEADS_TABLE}?select=id&created_at=gte.${since}&limit=1`, { headers: { Prefer: 'count=exact' } }),
      supabase(`/rest/v1/${SUPABASE_TABLE}?select=id&limit=1`, { headers: { Prefer: 'count=exact' } }),
    ]);
    const countOf = (response) => {
      const range = response.headers.get('content-range') || '';
      const total = range.split('/')[1];
      return total && total !== '*' ? Number(total) : 0;
    };
    return jsonResponse(res, 200, {
      toplamTalep: countOf(leads),
      yeniTalep: countOf(newLeads),
      haftalikTalep: countOf(weekLeads),
      toplamKayit: countOf(regs),
    });
  } catch (error) {
    console.error('[admin] özet hatası', error && error.message);
    return jsonResponse(res, 500, { error: 'Özet alınamadı.' });
  }
}

function leadListQuery(url, limit) {
  const params = [`select=*`, `order=created_at.desc`, `limit=${limit}`];
  const status = url.searchParams.get('durum') || '';
  if (LEAD_STATUSES.includes(status)) params.push(`status=eq.${status}`);

  const q = clean(url.searchParams.get('q'), 80);
  if (q) {
    const like = pgQuote('*' + q.replace(/[*(),]/g, ' ') + '*');
    params.push(`or=(full_name.ilike.${like},brand.ilike.${like},email.ilike.${like},phone.ilike.${like},message.ilike.${like})`);
  }

  const days = Number(url.searchParams.get('gun') || 0);
  if (days > 0 && days <= 3650) {
    params.push(`created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`);
  }
  const offset = Number(url.searchParams.get('offset') || 0);
  if (offset > 0) params.push(`offset=${Math.min(offset, 100000)}`);

  return params.join('&');
}

async function adminLeads(req, res, url) {
  if (!hasSupabase()) return supabaseUnavailable(res);
  try {
    const r = await supabase(`/rest/v1/${LEADS_TABLE}?${leadListQuery(url, 200)}`);
    if (!r.ok) {
      console.error('[admin] talep listesi hatası', r.status, (await r.text()).slice(0, 300));
      return jsonResponse(res, 500, { error: 'Talepler getirilemedi.' });
    }
    return jsonResponse(res, 200, { talepler: await r.json() });
  } catch (error) {
    console.error('[admin] talep listesi hatası', error && error.message);
    return jsonResponse(res, 500, { error: 'Talepler getirilemedi.' });
  }
}

async function adminUpdateLead(req, res) {
  if (!hasSupabase()) return supabaseUnavailable(res);
  if (!sameOrigin(req)) return jsonResponse(res, 403, { error: 'Geçersiz istek kaynağı.' });

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return jsonResponse(res, 400, { error: 'Güncellenemedi.' });
  }

  const id = String(body.id || '');
  if (!UUID_RE.test(id)) return jsonResponse(res, 400, { error: 'Geçersiz kayıt.' });

  const patch = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    if (!LEAD_STATUSES.includes(body.status)) return jsonResponse(res, 400, { error: 'Geçersiz durum.' });
    patch.status = body.status;
  }
  if (body.note !== undefined) patch.note = String(body.note).slice(0, 4000);
  if (body.read === true) patch.read_at = new Date().toISOString();

  try {
    const r = await supabase(`/rest/v1/${LEADS_TABLE}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      console.error('[admin] talep güncelleme hatası', r.status, (await r.text()).slice(0, 300));
      return jsonResponse(res, 500, { error: 'Güncellenemedi.' });
    }
    const rows = await r.json();
    return jsonResponse(res, 200, { ok: true, talep: Array.isArray(rows) ? rows[0] : null });
  } catch (error) {
    console.error('[admin] talep güncelleme hatası', error && error.message);
    return jsonResponse(res, 500, { error: 'Güncellenemedi.' });
  }
}

async function adminRegistrations(req, res, url) {
  if (!hasSupabase()) return supabaseUnavailable(res);
  try {
    const params = ['select=id,full_name,email,phone,products,created_at,updated_at', 'order=created_at.desc', 'limit=200'];
    const q = clean(url.searchParams.get('q'), 80);
    if (q) {
      const like = pgQuote('*' + q.replace(/[*(),]/g, ' ') + '*');
      params.push(`or=(full_name.ilike.${like},email.ilike.${like},phone.ilike.${like})`);
    }
    const r = await supabase(`/rest/v1/${SUPABASE_TABLE}?${params.join('&')}`);
    if (!r.ok) {
      console.error('[admin] kayıt listesi hatası', r.status, (await r.text()).slice(0, 300));
      return jsonResponse(res, 500, { error: 'Kayıtlar getirilemedi.' });
    }
    // Ürün listesinin tamamı panelde gerekmiyor; sayı ve pazaryerleri yeter.
    const rows = (await r.json()).map((row) => {
      const products = Array.isArray(row.products) ? row.products : [];
      return {
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        urun_sayisi: products.length,
        urunler: products.slice(0, 50).map((p) => clean(p && (p.name || p.title || p.sku), 80)).filter(Boolean),
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
    return jsonResponse(res, 200, { kayitlar: rows });
  } catch (error) {
    console.error('[admin] kayıt listesi hatası', error && error.message);
    return jsonResponse(res, 500, { error: 'Kayıtlar getirilemedi.' });
  }
}

function toCsv(rows, columns) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    // Excel'in formül olarak yorumlamasını engelle.
    const safe = /^[=+\-@]/.test(text) ? "'" + text : text;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const lines = [columns.map((c) => escape(c.baslik)).join(';')];
  rows.forEach((row) => {
    lines.push(columns.map((c) => escape(c.deger(row))).join(';'));
  });
  // BOM: Excel'in Türkçe karakterleri doğru okuması için.
  return '\uFEFF' + lines.join('\r\n');
}

function trDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d) ? '' : d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
}

const STATUS_LABELS = {
  yeni: 'Yeni',
  arandi: 'Arandı',
  teklif: 'Teklif verildi',
  kazanildi: 'Kazanıldı',
  kayip: 'Kayıp',
};

async function adminExport(req, res, url) {
  if (!hasSupabase()) return supabaseUnavailable(res);
  const type = url.searchParams.get('tur') === 'kayitlar' ? 'kayitlar' : 'talepler';
  try {
    if (type === 'talepler') {
      const r = await supabase(`/rest/v1/${LEADS_TABLE}?${leadListQuery(url, 5000)}`);
      if (!r.ok) return jsonResponse(res, 500, { error: 'Dışa aktarılamadı.' });
      const csv = toCsv(await r.json(), [
        { baslik: 'Tarih', deger: (r) => trDate(r.created_at) },
        { baslik: 'Ad Soyad', deger: (r) => r.full_name },
        { baslik: 'Marka', deger: (r) => r.brand },
        { baslik: 'E-posta', deger: (r) => r.email },
        { baslik: 'Telefon', deger: (r) => (r.phone ? '0' + r.phone : '') },
        { baslik: 'Pazaryeri', deger: (r) => r.marketplace },
        { baslik: 'Ciro Aralığı', deger: (r) => r.revenue },
        { baslik: 'Mesaj', deger: (r) => r.message },
        { baslik: 'Durum', deger: (r) => STATUS_LABELS[r.status] || r.status },
        { baslik: 'Not', deger: (r) => r.note },
        { baslik: 'Geldiği Sayfa', deger: (r) => r.source_page },
      ]);
      return send(res, 200, 'text/csv; charset=utf-8', csv, {
        'Content-Disposition': 'attachment; filename="tpd-talepler.csv"',
        'Cache-Control': 'no-store',
      });
    }

    const r = await supabase(
      `/rest/v1/${SUPABASE_TABLE}?select=full_name,email,phone,products,created_at,updated_at&order=created_at.desc&limit=5000`
    );
    if (!r.ok) return jsonResponse(res, 500, { error: 'Dışa aktarılamadı.' });
    const csv = toCsv(await r.json(), [
      { baslik: 'Kayıt Tarihi', deger: (r) => trDate(r.created_at) },
      { baslik: 'Ad Soyad', deger: (r) => r.full_name },
      { baslik: 'E-posta', deger: (r) => r.email },
      { baslik: 'Telefon', deger: (r) => (r.phone ? '0' + r.phone : '') },
      { baslik: 'Kayıtlı Ürün', deger: (r) => (Array.isArray(r.products) ? r.products.length : 0) },
      { baslik: 'Son İşlem', deger: (r) => trDate(r.updated_at) },
    ]);
    return send(res, 200, 'text/csv; charset=utf-8', csv, {
      'Content-Disposition': 'attachment; filename="tpd-kayitlar.csv"',
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    console.error('[admin] dışa aktarım hatası', error && error.message);
    return jsonResponse(res, 500, { error: 'Dışa aktarılamadı.' });
  }
}

// --- Panel yönlendiricisi ---------------------------------------------------

async function handleLogin(req, res) {
  const ip = clientIp(req);
  const locked = loginLockedFor(ip);
  if (locked) {
    return jsonResponse(res, 429, {
      error: `Çok fazla hatalı deneme. ${Math.ceil(locked / 60)} dakika sonra tekrar deneyin.`,
    });
  }
  if (!sameOrigin(req)) return jsonResponse(res, 403, { error: 'Geçersiz istek kaynağı.' });

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return jsonResponse(res, 400, { error: 'Giriş yapılamadı.' });
  }

  if (!hasAdmin()) {
    return jsonResponse(res, 503, {
      error: 'Panel şifresi tanımlı değil. hPanel > ortam değişkenlerine ADMIN_PASSWORD_HASH ekleyin.',
    });
  }

  // İki kontrol de her zaman çalıştırılır; erken çıkış yapılmaz ki yanıt süresi
  // hangi alanın yanlış olduğunu ele vermesin.
  const userOk = usernameMatches(body.username);
  const passOk = passwordMatches(String(body.password || ''));
  if (!userOk || !passOk) {
    noteFailedLogin(ip);
    console.warn('[admin] hatalı giriş denemesi:', ip);
    return jsonResponse(res, 401, { error: 'Kullanıcı adı veya şifre hatalı.' });
  }

  loginAttempts.delete(ip);
  const maxAge = ADMIN_SESSION_DAYS * 24 * 60 * 60;
  const token = signSession(Date.now() + maxAge * 1000);
  console.log('[admin] giriş yapıldı:', ip);
  res.writeHead(200, Object.assign(
    {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionCookie(req, token, maxAge),
    },
    SECURITY_HEADERS
  ));
  res.end(JSON.stringify({ ok: true }));
}

function serveAdminPage(req, res) {
  fs.readFile(path.join(__dirname, 'admin.html'), (err, data) => {
    if (err) {
      console.error('[admin] admin.html okunamadı', err.message);
      return send(res, 500, 'text/plain; charset=utf-8', 'Panel dosyası bulunamadı.');
    }
    send(res, 200, MIME['.html'], data, { 'Cache-Control': 'no-store' });
  });
}

async function handleAdmin(req, res, urlPath, url) {
  // Panel hiçbir koşulda arama motorlarına düşmesin.
  const noIndex = { 'X-Robots-Tag': 'noindex, nofollow' };

  if (urlPath === '/admin.html') return redirect(res, '/admin');

  if (urlPath === '/admin/giris') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Yalnızca POST desteklenir.' });
    return void handleLogin(req, res);
  }

  if (urlPath === '/admin/cikis') {
    res.writeHead(200, Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': sessionCookie(req, '', 0),
      },
      SECURITY_HEADERS,
      noIndex
    ));
    return res.end(JSON.stringify({ ok: true }));
  }

  // Buradan sonrası oturum ister.
  const authed = isLoggedIn(req);

  if (urlPath === '/admin' || urlPath === '/admin/') {
    // Giriş sayfası da panel de aynı dosyada; hangisinin görüneceğine
    // tarayıcı /admin/durum yanıtına bakarak karar verir.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return serveAdminPage(req, res);
  }

  if (urlPath === '/admin/durum') {
    return jsonResponse(res, 200, {
      girisYapildi: authed,
      supabase: hasSupabase(),
      sifreTanimli: hasAdmin(),
      uyari: hasSupabase()
        ? null
        : 'Veritabanı bağlı değil: yeni talepler yalnızca e-postaya gidiyor, panelde görünmez.',
    });
  }

  if (!authed) return jsonResponse(res, 401, { error: 'Oturum gerekli.' });

  if (urlPath === '/admin/api/ozet') return void adminSummary(req, res);
  if (urlPath === '/admin/api/talepler') return void adminLeads(req, res, url);
  if (urlPath === '/admin/api/talep') {
    if (req.method !== 'PATCH' && req.method !== 'POST') {
      return jsonResponse(res, 405, { error: 'Desteklenmeyen yöntem.' });
    }
    return void adminUpdateLead(req, res);
  }
  if (urlPath === '/admin/api/kayitlar') return void adminRegistrations(req, res, url);
  if (urlPath === '/admin/api/disa-aktar') return void adminExport(req, res, url);

  return jsonResponse(res, 404, { error: 'Bulunamadı.' });
}

// Site içeriği olmayan proje dosyaları. Deploy repo kökünü aldığı için bunlar
// da web köküne düşer; sunucu seviyesinde kapatılır.
const PRIVATE_DIRS = ['api', 'src', 'supabase', 'node_modules', '_yedek-mevcut-site'];
// admin.html yalnızca handleAdmin üzerinden, oturum kontrolüyle servis edilir;
// dosya olarak istenirse yokmuş gibi davranılır.
const PRIVATE_FILES = ['server.js', 'package.json', 'package-lock.json', 'wrangler.jsonc', 'admin.html'];
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
  if (urlPath === '/api/iletisim') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Yalnızca POST desteklenir.' });
    return void handleContact(req, res);
  }
  if (urlPath === '/api/durum') {
    // Eksik yapılandırma artık sessiz kalmıyor: hangi değişkenin eksik olduğu
    // burada ve panelin uyarı şeridinde açıkça görünür.
    const eksik = [];
    if (!SUPABASE_URL) eksik.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_KEY) eksik.push('SUPABASE_SERVICE_KEY');
    if (!hasAdmin()) eksik.push('ADMIN_PASSWORD_HASH');
    return jsonResponse(res, 200, {
      ok: true,
      supabase: hasSupabase(),
      admin: hasAdmin(),
      mod: hasSupabase() ? 'sync' : 'local',
      eksikDegiskenler: eksik,
      uyari: hasSupabase()
        ? null
        : 'Supabase yapılandırılmadı: kayıtlar ve talepler veritabanına yazılmıyor.',
    });
  }

  // --- Yönetim paneli ---
  if (urlPath === '/admin' || urlPath === '/admin.html' || urlPath.startsWith('/admin/')) {
    const parsed = new URL(rawUrl, 'http://localhost');
    return void handleAdmin(req, res, urlPath, parsed);
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
