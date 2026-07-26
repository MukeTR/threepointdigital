/**
 * Three Point Digital — Kârlılık Merkezi ücretsiz kayıt API'si
 *
 * Cloudflare Worker + D1. Statik site (Hostinger) bu uç noktaya CORS ile POST atar.
 * Doğrulama mantığı, teslim edilen Next.js paketindeki app/api/register/route.ts
 * dosyasıyla birebir aynıdır; yalnızca Drizzle yerine doğrudan D1 sorgusu kullanılır
 * (böylece derleme adımı gerekmez).
 *
 * Uç noktalar:
 *   POST /register       → kayıt oluşturur, { id } döner
 *   POST /api/register   → aynı işlev (yolun her iki biçimi de desteklenir)
 *   GET  /health         → { ok: true }
 */

const ALLOWED_ORIGINS = [
  "https://www.threepointdigital.com",
  "https://threepointdigital.com",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

// Gövde boyutu üst sınırı (kötü niyetli büyük istekleri erken keser).
const MAX_BODY_BYTES = 2048;

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(request),
    },
  });
}

function normalizePhone(value) {
  return value.replace(/[^\d+]/g, "");
}

async function handleRegister(request, env) {
  if (!env.DB) {
    return json(request, { error: "Kayıt sistemi hazırlanıyor. Lütfen kısa süre sonra tekrar dene." }, 500);
  }

  let payload;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json(request, { error: "İstek gövdesi çok büyük." }, 413);
    }
    payload = JSON.parse(raw || "{}");
  } catch {
    return json(request, { error: "Kayıt şu anda tamamlanamadı." }, 400);
  }

  // Bot tuzağı: gizli alan doluysa istek sessizce reddedilir.
  if (payload.website) {
    return json(request, { error: "Kayıt şu anda tamamlanamadı." }, 400);
  }

  const rawContact = (payload.contact ?? "").trim();
  const storeName = (payload.storeName ?? "").trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawContact);
  const phone = normalizePhone(rawContact);
  const isPhone = /^\+?\d{10,15}$/.test(phone);

  if (!isEmail && !isPhone) {
    return json(request, { error: "Geçerli bir e-posta veya telefon numarası gir." }, 400);
  }
  if (storeName.length < 2 || storeName.length > 100) {
    return json(request, { error: "Mağaza adı 2–100 karakter arasında olmalı." }, 400);
  }

  const contact = isEmail ? rawContact.toLowerCase() : phone;
  const contactType = isEmail ? "email" : "phone";

  try {
    // Aynı kişi tekrar kayıt olursa yeni satır açmak yerine mevcut kaydı döndürürüz.
    const existing = await env.DB.prepare("SELECT id FROM registrations WHERE contact = ?1 LIMIT 1")
      .bind(contact)
      .first();
    if (existing && existing.id) {
      return json(request, { id: existing.id }, 200);
    }

    const id = crypto.randomUUID();
    // Drizzle şemasındaki integer timestamp alanları saniye cinsindendir.
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      "INSERT INTO registrations (id, contact, contact_type, store_name, consent_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
      .bind(id, contact, contactType, storeName, now, now)
      .run();

    return json(request, { id }, 201);
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("no such table")
        ? "Kayıt sistemi hazırlanıyor. Lütfen kısa süre sonra tekrar dene."
        : "Kayıt şu anda tamamlanamadı.";
    return json(request, { error: message }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === "/health") {
      return json(request, { ok: true, hasDb: Boolean(env.DB) });
    }

    if (url.pathname === "/register" || url.pathname === "/api/register") {
      if (request.method !== "POST") {
        return json(request, { error: "Yalnızca POST desteklenir." }, 405);
      }
      return handleRegister(request, env);
    }

    return json(request, { error: "Bulunamadı." }, 404);
  },
};
