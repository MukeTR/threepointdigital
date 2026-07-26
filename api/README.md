# Kârlılık Merkezi — Ücretsiz Kayıt API'si

Statik site Hostinger'da durduğu için kayıt uç noktası ayrı bir **Cloudflare Worker**
olarak çalışır ve kayıtları **Cloudflare D1** veritabanına yazar.

- Kod: `src/index.js` (bağımlılık yok, derleme adımı yok)
- Şema: `schema.sql`
- Doğrulama mantığı teslim edilen `app/api/register/route.ts` ile birebir aynıdır.

---

## Kurulum (tek seferlik)

Cloudflare hesabınız yoksa ücretsiz bir hesap açmanız yeterlidir; D1'in ücretsiz
katmanı bu kullanım için fazlasıyla geniştir.

```bash
cd "/Users/avk/Developer/TPD Website/api"
npx wrangler login
```

**1. Veritabanını oluşturun**

```bash
npx wrangler d1 create tpd-karlilik
```

Komut bir `database_id` döndürür. Bu değeri `wrangler.jsonc` içindeki
`BURAYA_D1_DATABASE_ID_YAZIN` yerine yapıştırın.

**2. Tabloyu oluşturun**

```bash
npx wrangler d1 execute tpd-karlilik --remote --file=./schema.sql
```

**3. Worker'ı yayına alın**

```bash
npx wrangler deploy
```

Çıktıda `https://tpd-karlilik-kayit.<hesabınız>.workers.dev` biçiminde bir adres
göreceksiniz. **Bu adresi kopyalayın.**

**4. Siteye bağlayın**

`e-ticaret-karlilik-hesaplama.html` dosyasında tek bir satır var:

```html
<body data-register-endpoint="https://tpd-karlilik-kayit.ORNEK.workers.dev/register">
```

`ORNEK` kısmını kendi Worker adresinizle değiştirin ve dosyayı yeniden yükleyin.

> Endpoint boş bırakılırsa uygulama kayıt kapısını **otomatik olarak devre dışı
> bırakır**; Karşılaştır ve Ürünler herkese açık çalışmaya devam eder. Yani Worker
> yayına alınmadan önce de site tam çalışır durumdadır.

---

## Doğrulama

```bash
curl -s https://tpd-karlilik-kayit.ORNEK.workers.dev/health
```

`{"ok":true,"hasDb":true}` dönmeli.

```bash
curl -s -X POST https://tpd-karlilik-kayit.ORNEK.workers.dev/register \
  -H "content-type: application/json" \
  -H "Origin: https://www.threepointdigital.com" \
  -d '{"contact":"deneme@ornek.com","storeName":"Deneme Magaza"}'
```

`{"id":"..."}` dönmeli.

---

## Kayıtları görüntüleme

```bash
npx wrangler d1 execute tpd-karlilik --remote \
  --command="SELECT contact, contact_type, store_name, datetime(created_at,'unixepoch') AS tarih FROM registrations ORDER BY created_at DESC LIMIT 50"
```

CSV olarak dışa aktarmak için:

```bash
npx wrangler d1 execute tpd-karlilik --remote --json \
  --command="SELECT * FROM registrations ORDER BY created_at DESC" > kayitlar.json
```

---

## Orijinal paketten farklar

| Konu | Paket | Buradaki uygulama | Neden |
|---|---|---|---|
| Çalışma ortamı | Next.js route handler | Bağımsız Worker | Statik site ayrı hostingde; Next.js çalıştırmaya gerek kalmadı |
| Veritabanı erişimi | Drizzle ORM | D1 prepared statement | Derleme adımı ve bağımlılık gerekmesin diye; şema aynı |
| Tekrar kayıt | Her seferinde yeni satır | Aynı iletişim bilgisi varsa mevcut kimlik döner | Aynı kişinin tekrar tekrar satır açmasını engeller |
| CORS | Aynı origin olduğu için gereksizdi | İzinli origin listesi | Site farklı alan adından POST atıyor |
| Bot koruması | Yok | Gizli `website` alanı + gövde boyutu sınırı | Açık uç nokta olduğu için |

Doğrulama kuralları, hata mesajları, tablo şeması ve zaman damgası biçimi (saniye)
değiştirilmemiştir.

---

## Güvenlik notu

Uç nokta herkese açıktır ve kimlik doğrulaması yoktur — paketteki tasarım da böyleydi.
Kötüye kullanım görürseniz Cloudflare panelinden Worker'a **Rate Limiting** kuralı
ekleyebilirsiniz (örn. IP başına dakikada 5 istek). Kod değişikliği gerekmez.
