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
function findEnvFile() {
  // Hostinger her dağıtımda yeni bir sürüm klasörü oluşturur (hbuilds/versions/...),
  // bu yüzden uygulamanın yanındaki .env dağıtımda kaybolur. Dosya üst dizinlerde
  // de aranır; domain kökündeki .env dağıtımlardan etkilenmez.
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

(function loadEnvFile() {
  try {
    const envPath = findEnvFile();
    if (!envPath) return;
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
    if (yuklenen) console.log(`[env] ${envPath} dosyasından ${yuklenen} değişken yüklendi`);
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
// Talep yalnızca Supabase'e yazılır ve /admin panelinden takip edilir.
// (E-posta gönderimi kaldırıldı: FormSubmit form aktivasyonu istiyordu ve
//  aktive edilmediği sürece hiçbir bildirim göndermiyordu.)
//
// Tek kanal kaldığı için yazma başarısız olursa talep kaybolmasın diye
// LEAD_FALLBACK_LOG dosyasına da bir satır düşülür (aşağıya bakın).
const LEADS_TABLE = process.env.LEADS_TABLE || 'tpd_leads';

// Şablonlara ve JSON-LD'ye yazılan kanonik adres. CANONICAL_HOST tanımlıysa
// ondan türer; değilse sitenin bilinen www'lu adresi kullanılır.
const SITE_ORIGIN = 'https://' + (process.env.CANONICAL_HOST || 'www.threepointdigital.com');
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'info@threepointdigital.com';

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
   Talep Supabase'e yazılır ve /admin panelinden takip edilir. Yazma başarısız
   olursa talep kaybolmasın diye diskteki yedek dosyaya düşülür (lastResortLog).
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

/* Son çare yedeği.
 *
 * Veritabanına yazılamayan talep buraya bir JSON satırı olarak düşer. Dosya
 * .env ile aynı klasördedir (domain kökü), yani dağıtımlardan etkilenmez.
 * Buraya bir satır düşmesi "Supabase erişilemedi" demektir; kayıt elle
 * tabloya taşınabilir.
 */
function lastResortLog(lead, sebep) {
  try {
    const envPath = findEnvFile();
    const dir = envPath ? path.dirname(envPath) : __dirname;
    const satir = JSON.stringify(Object.assign({ ts: new Date().toISOString(), sebep }, lead)) + '\n';
    fs.appendFileSync(path.join(dir, 'kayit-edilemeyen-talepler.log'), satir, { mode: 0o600 });
    console.error('[iletisim] talep yedek dosyaya yazıldı:', sebep);
    return true;
  } catch (error) {
    console.error('[iletisim] YEDEK DOSYA DA YAZILAMADI', error && error.message);
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

  let stored = false;
  let sebep = '';

  if (hasSupabase()) {
    try {
      const inserted = await supabase(`/rest/v1/${LEADS_TABLE}`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(lead),
      });
      stored = inserted.ok;
      if (!inserted.ok) {
        sebep = 'supabase-' + inserted.status;
        console.error('[iletisim] Supabase insert hatası', inserted.status, (await inserted.text()).slice(0, 300));
      }
    } catch (error) {
      sebep = 'supabase-erisilemedi';
      console.error('[iletisim] Supabase hatası', error && error.message);
    }
  } else {
    sebep = 'supabase-yapilandirilmadi';
    console.error('[iletisim] SUPABASE_URL/SUPABASE_SERVICE_KEY tanımsız — talep tabloya yazılamıyor');
  }

  if (stored) return jsonResponse(res, 201, { ok: true, stored: true });

  // Veritabanı tek kanal olduğu için yazılamayan talep diske düşer.
  if (lastResortLog(lead, sebep)) {
    return jsonResponse(res, 201, { ok: true, stored: false, yedeklendi: true });
  }

  return jsonResponse(res, 502, { error: 'Form gönderilemedi.' });
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

/* ===========================================================================
   Blog
   ---------------------------------------------------------------------------
   İçerik Supabase'de (tpd_blog_posts), sayfa iskeleti blog/_sablon.html ve
   blog/_sablon-index.html dosyalarında durur. Sunucu şablonu okuyup doldurur.

   Veritabanında yayında yazı yoksa ya da veritabanına erişilemiyorsa istek
   blog/*.html statik dosyalarına düşer; böylece panel kurulmadan önce de,
   veritabanı çökse de yayındaki yazılar erişilebilir kalır.
   =========================================================================== */

const BLOG_TABLE = process.env.BLOG_TABLE || 'tpd_blog_posts';
const BLOG_CATEGORIES = ['Strateji', 'Ürün', 'Reklam', 'Kampanya', 'Kârlılık', 'Operasyon'];
// kategori -> [rozet yazısı, rozet renk sınıfı]
const BLOG_BADGES = {
  'Strateji': ['ST', ''],
  'Ürün': ['ÜR', 'black'],
  'Reklam': ['RK', 'purple'],
  'Kampanya': ['KM', ''],
  'Kârlılık': ['KÂ', 'black'],
  'Operasyon': ['OP', 'purple'],
};

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');   // öznitelikler çift tırnaklı; ' kaçırılmaz
}

// JSON-LD string değerleri: tırnak ve satır sonu kaçırılır.
function jsonEscape(value) {
  return JSON.stringify(String(value == null ? '' : value)).slice(1, -1);
}

function blogSlugify(value) {
  const tr = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (c) => tr[c] || c)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* Panelden gelen gövde yönetici tarafından yazılır ama yine de çalıştırılabilir
 * içerik taşımamalı: hesap ele geçirilse bile sayfaya script gömülemesin. */
function sanitizeBlogHtml(raw) {
  return String(raw || '')
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|style)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

// --- şablonlar (ilk istekte okunur, sonra bellekte tutulur) -----------------
let blogTemplateCache = null;
function blogTemplates() {
  if (blogTemplateCache) return blogTemplateCache;
  try {
    blogTemplateCache = {
      post: fs.readFileSync(path.join(ROOT, 'blog', '_sablon.html'), 'utf8'),
      index: fs.readFileSync(path.join(ROOT, 'blog', '_sablon-index.html'), 'utf8'),
    };
  } catch (e) {
    console.error('[blog] şablon okunamadı:', e.message);
    blogTemplateCache = null;
  }
  return blogTemplateCache;
}

function fillTemplate(tpl, values) {
  return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m);
}

function blogBadge(category) {
  return BLOG_BADGES[category] || BLOG_BADGES.Strateji;
}

function blogShortTitle(headline) {
  return String(headline || '').split(':')[0].trim();
}

function blogDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/* Gövdedeki h2'lere id verir ve "Bu yazıda" listesini üretir. */
function blogBodyWithToc(bodyHtml) {
  const headings = [];
  const body = String(bodyHtml || '').replace(
    /<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2>/gi,
    (m, inner) => {
      const text = inner.replace(/<[^>]+>/g, '').trim();
      const id = blogSlugify(text) || 'bolum-' + (headings.length + 1);
      headings.push({ id, text });
      return '<h2 id="' + id + '">' + inner + '</h2>';
    }
  );

  let toc = '';
  if (headings.length) {
    toc = '          <aside class="content-aside">\n' +
      '            <p class="eyebrow">Bu yazıda</p>\n' +
      '            <nav aria-label="Yazı içeriği">\n' +
      headings.map((h) => '              <a href="#' + h.id + '">' + htmlEscape(h.text) + '</a>').join('\n') +
      '\n            </nav>\n          </aside>\n\n';
  }
  return { body, toc };
}

function renderBlogPost(post, prev, next) {
  const tpl = blogTemplates();
  if (!tpl) return null;

  const url = SITE_ORIGIN + '/blog/' + post.slug;
  const headline = String(post.headline || '');
  const badge = blogBadge(post.category);
  const parts = blogBodyWithToc(sanitizeBlogHtml(post.body_html));

  const card = (other, yon, etiket) => {
    if (!other) return '';
    const b = blogBadge(other.category);
    return '            <a class="card" href="/blog/' + other.slug + '">\n' +
      '              <span class="' + ('platform-badge ' + b[1]).trim() + '">' + yon + '</span>\n' +
      '              <h3>' + htmlEscape(other.headline) + '</h3>\n' +
      '              <span class="card-link">' + etiket + '</span>\n' +
      '            </a>';
  };
  const cards = [card(prev, '←', 'Önceki yazı'), card(next, '→', 'Sonraki yazı')].filter(Boolean);
  const gezinme = cards.length
    ? '\n      <section class="section" aria-labelledby="devam-baslik">\n' +
      '        <div class="wrap">\n' +
      '          <div class="section-head">\n' +
      '            <p class="eyebrow">Seriye devam</p>\n' +
      '            <h2 id="devam-baslik">Sıradaki yazılar</h2>\n' +
      '          </div>\n' +
      '          <div class="cards-2">\n' + cards.join('\n') + '\n          </div>\n' +
      '        </div>\n      </section>\n'
    : '';

  return fillTemplate(tpl.post, {
    URL: url,
    TITLE: htmlEscape(post.title),
    HEADLINE: htmlEscape(headline),
    HEADLINE_KISA: htmlEscape(blogShortTitle(headline)),
    DESCRIPTION: htmlEscape(post.description),
    KATEGORI: htmlEscape(post.category),
    // JSON-LD içinde HTML varlıkları çözülmez; oraya JSON kaçırması gider.
    TITLE_JSON: jsonEscape(post.title),
    HEADLINE_JSON: jsonEscape(headline),
    HEADLINE_KISA_JSON: jsonEscape(blogShortTitle(headline)),
    DESCRIPTION_JSON: jsonEscape(post.description),
    KATEGORI_JSON: jsonEscape(post.category),
    ROZET: htmlEscape(badge[0]),
    ROZET_SINIF: ('platform-badge ' + badge[1]).trim(),
    YAYIN_TARIHI: blogDate(post.published_at || post.created_at),
    GUNCELLEME_TARIHI: blogDate(post.updated_at || post.published_at || post.created_at),
    TOC: parts.toc,
    // gövde veritabanında girintisiz durur; şablonun içinde hizalanır
    ICERIK: parts.body.split('\n').map((r) => (r.trim() ? '            ' + r.trim() : r)).join('\n'),
    GEZINME: gezinme,
  });
}

function renderBlogIndex(posts) {
  const tpl = blogTemplates();
  if (!tpl) return null;

  const sections = [];
  let painted = 0;
  BLOG_CATEGORIES.forEach((cat) => {
    const group = posts.filter((p) => p.category === cat);
    if (!group.length) return;
    const id = blogSlugify(cat);
    const cards = group.map((p) => {
      const b = blogBadge(p.category);
      return '            <a class="card" href="/blog/' + p.slug + '">\n' +
        '              <span class="' + ('platform-badge ' + b[1]).trim() + '">' + htmlEscape(b[0]) + '</span>\n' +
        '              <h3>' + htmlEscape(p.headline) + '</h3>\n' +
        '              <p>' + htmlEscape(p.description) + '</p>\n' +
        '              <span class="card-link">Yazıyı oku</span>\n' +
        '            </a>';
    }).join('\n');
    sections.push('      <section class="section' + (painted % 2 === 0 ? ' white' : '') +
      '" aria-labelledby="' + id + '-baslik">\n' +
      '        <div class="wrap">\n' +
      '          <div class="section-head">\n' +
      '            <p class="eyebrow">' + group.length + ' yazı</p>\n' +
      '            <h2 id="' + id + '-baslik">' + htmlEscape(cat) + '</h2>\n' +
      '          </div>\n' +
      '          <div class="cards-3">\n' + cards + '\n          </div>\n' +
      '        </div>\n      </section>');
    painted += 1;
  });

  const list = posts.map((p, i) =>
    '              { "@type": "ListItem", "position": ' + (i + 1) +
    ', "url": "' + SITE_ORIGIN + '/blog/' + jsonEscape(p.slug) + '" }').join(',\n');

  return fillTemplate(tpl.index, {
    BOLUMLER: sections.join('\n\n'),
    LISTE: list,
    YAZI_SAYISI: String(posts.length),
    ALT_BASLIK: htmlEscape(painted + ' başlıkta ' + posts.length + ' yazı'),
  });
}

/* Tüm yazılar (taslaklar dahil), sıralı.
 *
 * Otorite kuralı: veritabanında kayıt varsa yayın durumu oradan belirlenir —
 * taslağa çekilen ya da silinen yazı 404 döner. blog/*.html dosyalarına
 * yalnızca veritabanına erişilemediğinde veya tablo henüz boşken (yazılar
 * panelden içe aktarılmadan önce) düşülür.
 *
 * Hata durumunda null döner; boş dizi ile karıştırılmamalıdır.
 */
const BLOG_CACHE_MS = 60 * 1000;
let blogCache = { at: 0, rows: null };
function blogCacheClear() { blogCache = { at: 0, rows: null }; }

async function blogAll() {
  if (blogCache.rows && Date.now() - blogCache.at < BLOG_CACHE_MS) return blogCache.rows;
  if (!hasSupabase()) return null;
  try {
    const r = await supabase('/rest/v1/' + BLOG_TABLE +
      '?select=slug,title,headline,description,category,body_html,status,published_at,created_at,updated_at' +
      '&order=sort_order.asc,published_at.desc&limit=500');
    if (!r.ok) {
      console.error('[blog] liste hatası', r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const rows = await r.json();
    blogCache = { at: Date.now(), rows };
    return rows;
  } catch (error) {
    console.error('[blog] liste hatası', error && error.message);
    return null;
  }
}

async function serveBlogIndex(res) {
  const all = await blogAll();
  if (all && all.length) {
    const posts = all.filter((p) => p.status === 'yayinda');
    const html = renderBlogIndex(posts);
    if (html) return send(res, 200, MIME['.html'], html, { 'Cache-Control': cacheControl('.html') });
  }
  return serveFile(res, path.join(ROOT, 'blog.html'));   // statik yedek
}

async function serveBlogPost(res, slug, onizleyebilir) {
  const all = await blogAll();

  if (all && all.length) {
    const posts = all.filter((p) => p.status === 'yayinda');
    const i = posts.findIndex((p) => p.slug === slug);

    if (i === -1) {
      // Panelde oturum açıksa taslak da gösterilir (Önizle bağlantısı).
      // Bu yanıt aramaya kapalıdır ve önbelleğe alınmaz.
      const taslak = onizleyebilir ? all.find((p) => p.slug === slug) : null;
      if (taslak) {
        const onizleme = renderBlogPost(taslak, null, null);
        if (onizleme) {
          return send(res, 200, MIME['.html'], onizleme, {
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
          });
        }
      }
      return notFound(res);   // taslak veya silinmiş: statik yedeğe düşme
    }

    const html = renderBlogPost(posts[i], posts[i - 1] || null, posts[i + 1] || null);
    if (html) return send(res, 200, MIME['.html'], html, { 'Cache-Control': cacheControl('.html') });
  }

  const staticPath = path.join(ROOT, 'blog', slug + '.html');
  return fs.stat(staticPath, (err, stat) => {
    if (!err && stat.isFile()) return serveFile(res, staticPath);
    notFound(res);
  });
}

/* --- Panel uçları --------------------------------------------------------- */

async function adminBlogList(req, res) {
  if (!hasSupabase()) return supabaseUnavailable(res);
  try {
    const r = await supabase('/rest/v1/' + BLOG_TABLE +
      '?select=id,slug,title,headline,description,category,body_html,status,sort_order,published_at,updated_at' +
      '&order=sort_order.asc,published_at.desc&limit=500');
    if (!r.ok) {
      console.error('[admin] yazı listesi hatası', r.status, (await r.text()).slice(0, 300));
      return jsonResponse(res, 500, { error: 'Yazılar getirilemedi.' });
    }
    return jsonResponse(res, 200, { yazilar: await r.json() });
  } catch (error) {
    console.error('[admin] yazı listesi hatası', error && error.message);
    return jsonResponse(res, 500, { error: 'Yazılar getirilemedi.' });
  }
}

async function adminBlogSave(req, res) {
  if (!hasSupabase()) return supabaseUnavailable(res);
  if (!sameOrigin(req)) return jsonResponse(res, 403, { error: 'Geçersiz istek kaynağı.' });

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return jsonResponse(res, e.message === 'too-large' ? 413 : 400, { error: 'Yazı kaydedilemedi.' });
  }

  const slug = blogSlugify(body.slug || body.headline);
  const headline = clean(body.headline, 200);
  const bodyHtml = sanitizeBlogHtml(body.body_html || '');
  const category = BLOG_CATEGORIES.indexOf(body.category) === -1 ? 'Strateji' : body.category;
  const status = body.status === 'yayinda' ? 'yayinda' : 'taslak';

  if (!slug) return jsonResponse(res, 400, { error: 'Adres (slug) boş olamaz.' });
  if (!headline) return jsonResponse(res, 400, { error: 'Başlık boş olamaz.' });
  if (!bodyHtml.trim()) return jsonResponse(res, 400, { error: 'Yazı gövdesi boş olamaz.' });

  const simdi = new Date().toISOString();
  const kayit = {
    slug,
    headline,
    title: clean(body.title, 250) || headline + ' | Three Point Digital',
    description: clean(body.description, 400),
    category,
    body_html: bodyHtml,
    status,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 999,
    updated_at: simdi,
  };

  try {
    const id = String(body.id || '');
    if (UUID_RE.test(id)) {
      if (status === 'yayinda' && body.published_at) kayit.published_at = body.published_at;
      else if (status === 'yayinda') kayit.published_at = kayit.published_at || simdi;
      const r = await supabase('/rest/v1/' + BLOG_TABLE + '?id=eq.' + id, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(kayit),
      });
      if (!r.ok) {
        const metin = (await r.text()).slice(0, 300);
        console.error('[admin] yazı güncelleme hatası', r.status, metin);
        return jsonResponse(res, 500, { error: metin.indexOf('duplicate') !== -1
          ? 'Bu adres (slug) başka bir yazıda kullanılıyor.' : 'Yazı güncellenemedi.' });
      }
      blogCacheClear();
      blogCacheClear();
    return jsonResponse(res, 200, { ok: true, yazi: (await r.json())[0] || null });
    }

    kayit.id = crypto.randomUUID();
    kayit.created_at = simdi;
    kayit.published_at = status === 'yayinda' ? (body.published_at || simdi) : null;
    const r = await supabase('/rest/v1/' + BLOG_TABLE, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(kayit),
    });
    if (!r.ok) {
      const metin = (await r.text()).slice(0, 300);
      console.error('[admin] yazı ekleme hatası', r.status, metin);
      return jsonResponse(res, 500, { error: metin.indexOf('duplicate') !== -1
        ? 'Bu adres (slug) zaten kullanılıyor.' : 'Yazı eklenemedi.' });
    }
    blogCacheClear();
    return jsonResponse(res, 200, { ok: true, yazi: (await r.json())[0] || null });
  } catch (error) {
    console.error('[admin] yazı kaydetme hatası', error && error.message);
    return jsonResponse(res, 500, { error: 'Yazı kaydedilemedi.' });
  }
}

async function adminBlogDelete(req, res) {
  if (!hasSupabase()) return supabaseUnavailable(res);
  if (!sameOrigin(req)) return jsonResponse(res, 403, { error: 'Geçersiz istek kaynağı.' });

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return jsonResponse(res, 400, { error: 'Yazı silinemedi.' });
  }
  const id = String(body.id || '');
  if (!UUID_RE.test(id)) return jsonResponse(res, 400, { error: 'Geçersiz kayıt.' });

  try {
    const r = await supabase('/rest/v1/' + BLOG_TABLE + '?id=eq.' + id, { method: 'DELETE' });
    if (!r.ok) {
      console.error('[admin] yazı silme hatası', r.status, (await r.text()).slice(0, 300));
      return jsonResponse(res, 500, { error: 'Yazı silinemedi.' });
    }
    blogCacheClear();
    return jsonResponse(res, 200, { ok: true });
  } catch (error) {
    console.error('[admin] yazı silme hatası', error && error.message);
    return jsonResponse(res, 500, { error: 'Yazı silinemedi.' });
  }
}

/* blog/*.html dosyalarındaki yazıları bir kez veritabanına aktarır.
 * Var olan slug'lara dokunmaz; panelden yapılan düzenlemeleri ezmez. */
async function adminBlogImport(req, res) {
  if (!hasSupabase()) return supabaseUnavailable(res);
  if (!sameOrigin(req)) return jsonResponse(res, 403, { error: 'Geçersiz istek kaynağı.' });

  let mevcut = [];
  try {
    const r = await supabase('/rest/v1/' + BLOG_TABLE + '?select=slug&limit=500');
    if (r.ok) mevcut = (await r.json()).map((x) => x.slug);
  } catch (e) { /* boş liste ile devam */ }

  let dosyalar;
  try {
    dosyalar = fs.readdirSync(path.join(ROOT, 'blog'))
      .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
      .sort();
  } catch (e) {
    return jsonResponse(res, 500, { error: 'blog/ klasörü okunamadı.' });
  }

  const kayitlar = [];
  const atlanan = [];
  dosyalar.forEach((dosya) => {
    const slug = dosya.slice(0, -5);
    if (mevcut.indexOf(slug) !== -1) { atlanan.push(slug); return; }
    let ham;
    try { ham = fs.readFileSync(path.join(ROOT, 'blog', dosya), 'utf8'); }
    catch (e) { return; }

    const al = (re) => { const m = ham.match(re); return m ? m[1].trim() : ''; };
    const govde = al(/<article class="prose">\n([\s\S]*?)\n          <\/article>/);
    if (!govde) return;

    const kategori = al(/<p class="eyebrow">([^<]+)<\/p>/);
    const sira = parseInt(slug.slice(0, 2), 10);
    const yayin = (al(/"datePublished": "([^"]*)"/) || '2026-06-08') + 'T00:00:00Z';
    kayitlar.push({
      id: crypto.randomUUID(),
      slug,
      title: al(/<title>([\s\S]*?)<\/title>/),
      headline: al(/<h1[^>]*>([\s\S]*?)<\/h1>/),
      description: al(/<meta name="description" content="([^"]*)"/),
      category: BLOG_CATEGORIES.indexOf(kategori) === -1 ? 'Strateji' : kategori,
      // h2 id'leri render sırasında yeniden üretiliyor; gövdede tutulmasına gerek yok
      body_html: govde.replace(/^ {12}/gm, '').replace(/<h2\s+id="[^"]*"\s*>/g, '<h2>'),
      status: 'yayinda',
      sort_order: Number.isFinite(sira) ? sira : 999,
      published_at: yayin,
      // içerik değişmiyor, yalnızca yeri değişiyor: dateModified bugüne kaymasın
      created_at: yayin,
      updated_at: yayin,
    });
  });

  if (!kayitlar.length) {
    return jsonResponse(res, 200, { ok: true, eklenen: 0, atlanan: atlanan.length });
  }

  try {
    const r = await supabase('/rest/v1/' + BLOG_TABLE, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(kayitlar),
    });
    if (!r.ok) {
      console.error('[admin] içe aktarma hatası', r.status, (await r.text()).slice(0, 300));
      return jsonResponse(res, 500, { error: 'Yazılar içe aktarılamadı.' });
    }
    blogCacheClear();
    console.log('[admin] blog içe aktarıldı:', kayitlar.length);
    return jsonResponse(res, 200, { ok: true, eklenen: kayitlar.length, atlanan: atlanan.length });
  } catch (error) {
    console.error('[admin] içe aktarma hatası', error && error.message);
    return jsonResponse(res, 500, { error: 'Yazılar içe aktarılamadı.' });
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
  if (urlPath === '/admin/api/yazilar') return void adminBlogList(req, res);
  if (urlPath === '/admin/api/yazi') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Yalnızca POST desteklenir.' });
    return void adminBlogSave(req, res);
  }
  if (urlPath === '/admin/api/yazi-sil') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Yalnızca POST desteklenir.' });
    return void adminBlogDelete(req, res);
  }
  if (urlPath === '/admin/api/yazi-aktar') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Yalnızca POST desteklenir.' });
    return void adminBlogImport(req, res);
  }

  return jsonResponse(res, 404, { error: 'Bulunamadı.' });
}

// Site içeriği olmayan proje dosyaları. Deploy repo kökünü aldığı için bunlar
// da web köküne düşer; sunucu seviyesinde kapatılır.
const PRIVATE_DIRS = ['api', 'src', 'supabase', 'node_modules', '_yedek-mevcut-site'];
// admin.html yalnızca handleAdmin üzerinden, oturum kontrolüyle servis edilir;
// dosya olarak istenirse yokmuş gibi davranılır.
const PRIVATE_FILES = ['server.js', 'package.json', 'package-lock.json', 'wrangler.jsonc', 'admin.html'];
const PRIVATE_EXTS = new Set(['.md', '.jsonc', '.sql', '.ts', '.yml', '.yaml', '.log']);

/* --- Eski site (Next.js dönemi) adresleri -----------------------------------
 * Site yenilenirken bu adresler kaldırıldı ama Google onları hâlâ gösteriyor;
 * yönlendirilmezlerse 404'e düşüyor ve biriken arama değeri kayboluyor.
 * Kaynak: Search Console > Sayfalar raporu (Ağustos 2026).
 */
const LEGACY_REDIRECTS = new Map([
  ['/iletisim', '/#iletisim'],
  ['/analysis', '/#iletisim'],
  ['/hizmetler', '/#hizmetler'],
  ['/hizmetlerimiz', '/#hizmetler'],
  ['/hizmetlerimiz/pazaryeri-magaza-yonetimi', '/#hizmetler'],
  ['/hizmetlerimiz/pazaryeri-magaza-kurulumu', '/#hizmetler'],
  ['/hizmetlerimiz/pazar-arastirmasi', '/#hizmetler'],
  ['/hizmetlerimiz/fotograf-studyosu', '/#hizmetler'],
  ['/hizmetlerimiz/fulfillment', '/#hizmetler'],
  ['/hizmetlerimiz/marka-tescili', '/#hizmetler'],
  ['/nasil-amazon-saticisi-olunur', '/amazon-tr-pazaryeri-yonetimi'],
  ['/wayfair-saticisi-nasil-olunur', '/blog'],
  ['/e-ticaret-ve-e-ihracat-nedir', '/blog'],
  ['/category/e-ticaret', '/blog'],
  ['/category/pazaryerleri', '/blog'],
  ['/basari-hikayeleri', '/referanslar'],
]);

// Tek tek sayılmayan alt sayfalar için önek kuralı; tabloda birebir eşleşme
// bulunamazsa bunlara bakılır.
const LEGACY_PREFIXES = [
  ['/hizmetlerimiz/', '/#hizmetler'],
  ['/category/', '/blog'],
];

function legacyTarget(urlPath) {
  const key = (urlPath.length > 1 && urlPath.endsWith('/') ? urlPath.slice(0, -1) : urlPath).toLowerCase();
  const exact = LEGACY_REDIRECTS.get(key);
  if (exact) return exact;
  for (let i = 0; i < LEGACY_PREFIXES.length; i += 1) {
    if (key.startsWith(LEGACY_PREFIXES[i][0])) return LEGACY_PREFIXES[i][1];
  }
  return null;
}


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

  // --- Eski site adresleri (301) ---
  const legacy = legacyTarget(urlPath);
  if (legacy) return redirect(res, legacy);

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

  // --- Blog (içerik veritabanında; şablon dosyaları servis edilmez) ---
  if (urlPath === '/blog') return void serveBlogIndex(res);
  if (urlPath.startsWith('/blog/')) {
    const slug = urlPath.slice('/blog/'.length);
    if (!slug || slug.indexOf('/') !== -1 || slug.startsWith('_')) return notFound(res);
    if (/^[a-z0-9-]+$/.test(slug)) return void serveBlogPost(res, slug, isLoggedIn(req));
    return notFound(res);
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
