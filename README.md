# Three Point Digital — threepointdigital.com

Trendyol, Amazon Türkiye ve Hepsiburada satıcılarına hizmet veren pazaryeri yönetim ajansının
kurumsal web sitesi. Bağımlılıksız statik site; Hostinger üzerinde servis edilir.

## Yerel önizleme

```bash
npm start
```

Ardından http://localhost:3000 adresini açın. Aynı `server.js` production'da da çalışır; yerelde
gördüğünüz yönlendirme, önbellek ve başlık davranışı canlıdakiyle birebir aynıdır.

## Yapı

| Yol | Açıklama |
|---|---|
| `*.html` | 9 sayfa + `404.html`. Header/footer her sayfada gömülüdür, derleme adımı yoktur. |
| `blog.html`, `blog/*.html` | Blog dizini ve 30 yazı. **Statik yedektir**: yayın içeriği Supabase'de durur (bkz. aşağısı), bu dosyalara yalnızca veritabanına erişilemediğinde düşülür. |
| `blog/_sablon*.html` | Sunucunun blog sayfalarını üretirken doldurduğu iskeletler. Web'e servis edilmez. |
| `assets/site.css` | Tüm sitenin stil sistemi |
| `assets/site.js` | Mobil menü, ana sayfa hesaplayıcısı, iletişim formu |
| `assets/profit-studio.css` / `.js` | Kârlılık Merkezi uygulaması (`/e-ticaret-karlilik-hesaplama`) |
| `assets/fonts/` | Self-hosted DM Sans + Manrope (harici font isteği yok) |
| `images/` | Marka logoları, TPD logosu, favicon seti |
| `api/` | Kârlılık Merkezi kayıt uç noktası — Cloudflare Worker + D1 (ayrı deploy) |
| `server.js` | Production sunucusu (Hostinger Node app). Uzantısız URL, 301 yönlendirmeler, önbellek ve güvenlik başlıkları |
| `.htaccess` | Yalnızca yedek — düz statik hostinge geçilirse aynı kuralları Apache tarafında sağlar |

## Belgeler

- **`TESLIMAT.md`** — teslimat notu: yapılan değişiklikler, test sonuçları, production'a geçiş
  adımları, doğrulanması gereken bilgiler ve geri dönüş planı. **Önce bunu okuyun.**
- **`api/README.md`** — kayıt API'sinin kurulumu ve deploy adımları.

## Blog yönetimi

Yazılar `/admin` panelindeki **Blog yazıları** sekmesinden yönetilir; içerik
Supabase'deki `tpd_blog_posts` tablosunda durur. Hostinger'da uygulama dizini
dağıtımlarda değiştiği için dosyaya yazmak kalıcı olmazdı.

İlk kurulum:

1. `supabase/schema.sql` dosyasını Supabase SQL Editor'de çalıştırın (dosya
   yeniden çalıştırılabilir; mevcut tablolara dokunmaz).
2. Panelde **Blog yazıları > Dosyadaki yazıları aktar** düğmesine basın.
   `blog/*.html` içindeki 30 yazı tabloya taşınır; zaten kayıtlı slug'lar atlanır.

Sonrasında:

- Taslağa çekilen ya da silinen yazı `404` döner — statik dosya onu yayında tutmaz.
- Panelde oturum açıkken taslaklar `/blog/<slug>` adresinden önizlenebilir;
  bu yanıt `X-Robots-Tag: noindex` taşır ve önbelleğe alınmaz.
- Gövdedeki `h2` başlıkları "Bu yazıda" listesini otomatik üretir.
- `script`, `iframe`, `on*` gibi çalıştırılabilir içerik kaydedilirken temizlenir.
- Yayın listesi 60 saniye önbelleklenir; panelden yapılan her değişiklik
  önbelleği anında düşürür.

Slug'lar arama sonuçlarında kayıtlıdır; yayındaki bir yazının adresini
değiştirmek o bağlantıyı kırar.

## Deploy

Site Hostinger Node app hosting üzerinde `npm start` ile çalışır. Yüklenecekler: tüm `*.html`,
`assets/`, `images/`, `server.js`, `package.json`, `robots.txt`, `sitemap.xml`, `llms.txt`.

Yüklenmeyecekler: `TESLIMAT.md`, `README.md`, `api/`, `.claude/`.

Ayrıntı ve doğrulama komutları için `TESLIMAT.md` → "Production'a geçiş adımları".

## Durum

Site staging'de hazır, **production'a henüz alınmadı.** Yayın öncesi doğrulanması gereken
bilgiler `TESLIMAT.md` içinde listelenmiştir (portföy rakamları, şirket bilgileri, KVKK metni,
ekip ve vaka çalışması içerikleri).
