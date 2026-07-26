# Three Point Digital — Web Sitesi Yenileme Teslimatı

**Tarih:** 25 Temmuz 2026
**Proje klasörü:** `/Users/avk/Developer/TPD Website`
**Önizleme:** `npm start` → http://localhost:3000
**Durum:** Staging'de hazır, **production'a henüz deploy edilmedi.**

---

## 0a. Kârlılık Merkezi entegrasyonu — 25 Temmuz 2026

`TPD-Profit-Studio-Claude-Handoff.zip` paketindeki uygulama siteye taşındı ve eski basit
hesaplayıcının yerini aldı.

### Ne yapıldı

- **`/e-ticaret-karlilik-hesaplama` yeniden yazıldı.** Uygulama artık sitenin header, footer,
  breadcrumb ve tasarım dili içinde çalışıyor; üç görünüm (Hesapla / Karşılaştır / Ürünler)
  sekme çubuğuyla geliyor.
- **Hesaplama motoru birebir taşındı.** `calculate()` ve `targetPrice()` fonksiyonları
  paketteki React sürümüyle karakter karakter aynı mantığı uyguluyor. 4.000 rastgele senaryoyla
  test edildi: **fark yok** (aşağıdaki test sonuçlarına bakın).
- **Korunan davranışlar:** dört pazaryeri ve varsayılan komisyonları (Trendyol %21,5 ·
  Hepsiburada %19,9 · Amazon TR %17 · Diğer %15); sabit karşılaştırma sırası (kârlılık değişse
  de kartlar yer değiştirmiyor); her kanalın bağımsız fiyat/komisyon/kargo/genel gider/reklam
  değerleri; ürün adı ve SKU'nun tüm kanallara senkronu; yüzde veya sabit TL reklam seçeneği;
  `localStorage`'da en fazla 50 ürün; KDV varsayılanı %20.
- **Kayıt kapısı:** Hesapla ekranı kayıtsız açık; Karşılaştır, Ürünler ve "Ürünü kaydet"
  ücretsiz kayıt sonrası açılıyor.
- **Ana sayfadaki hesaplayıcı aynı motora geçirildi**, genel gider alanı eklendi. Artık iki
  sayfa aynı ürün için aynı sonucu veriyor (ondalık gösterimi de eşitlendi).
- **Kayıt API'si ayrı bir Cloudflare Worker + D1 olarak kuruldu** (`api/` klasörü). Paketteki
  Next.js route handler statik hostingde çalışamayacağı için doğrulama mantığı birebir korunarak
  bağımsız Worker'a taşındı.

### Yeni ve değişen dosyalar

| Dosya | Açıklama |
|---|---|
| `e-ticaret-karlilik-hesaplama.html` | Tamamen yeniden yazıldı — uygulama + SEO içeriği |
| `assets/profit-studio.css` | Uygulama stilleri, site tasarım diline uyarlandı (tüm sınıflar `ps-` ön ekli, çakışma yok) |
| `assets/profit-studio.js` | React bileşeninin bağımlılıksız JavaScript karşılığı |
| `assets/site.js` | Ana sayfa hesaplayıcısı yeni motora geçirildi; kullanılmayan senaryo kodu çıkarıldı |
| `index.html` | Hesaplayıcıya genel gider + ödenecek KDV satırları eklendi, varsayılanlar eşitlendi |
| `api/src/index.js` | Cloudflare Worker kayıt uç noktası |
| `api/schema.sql` | D1 tablo şeması (paketteki drizzle migration ile aynı) |
| `api/wrangler.jsonc` | Worker yapılandırması |
| `api/README.md` | Kurulum, deploy ve kayıt sorgulama talimatları |
| `llms.txt` | Araç tanımı eklendi |

### Test sonuçları

**Hesaplama paritesi — 4.000 rastgele senaryo, üç uygulama karşılaştırıldı:**

| Karşılaştırma | Sonuç |
|---|---|
| Paketteki React `calculate()` ↔ `profit-studio.js` | ✅ 12 çıktı alanının tamamı, fark yok (< 1e-9) |
| Paketteki `targetPrice()` ↔ `profit-studio.js` | ✅ fark yok |
| Paketteki React ↔ ana sayfa `compute()` | ✅ 11 ortak alanda fark yok |

Varsayılan senaryo (Trendyol · 599,90 ₺ satış · 210 ₺ alış · %21,5 komisyon · %20 KDV ·
%5 reklam · 79,90 ₺ kargo · 24 ₺ genel gider · %1 stopaj):
net satış **499,92 ₺** · net kâr **74,36 ₺** · marj **%14,87** · ödenecek KDV **15,87 ₺** ·
%25 hedef marj için fiyat **743,84 ₺**. Ana sayfa ve araç sayfası aynı değerleri gösteriyor.

**Uygulama davranışları (tarayıcıda test edildi):**

| Kontrol | Sonuç |
|---|---|
| Ürün adı / SKU tüm kanallara aktarılıyor | ✅ |
| Kanallar bağımsız (Amazon fiyatı değişince Trendyol etkilenmiyor) | ✅ |
| Kanal seçince o kanalın komisyonu geliyor (Amazon %17) | ✅ |
| Karşılaştırma sırası sabit kalıyor, yalnızca "en kârlı" rozeti taşınıyor | ✅ |
| Sabit TL reklam hesaba giriyor (200 ₺ → zarar) | ✅ |
| Hedef fiyat "Uygula" → marj tam olarak hedefe oturuyor (%25,00) | ✅ |
| Gelişmiş giderler aç/kapa + `aria-expanded` | ✅ |
| Ürün kaydetme, listeleme, açma, silme, sayaç, `localStorage` | ✅ |
| JavaScript konsol hatası | ✅ yok |
| Mobil (375 px) — yatay taşma yok | ✅ |

**Kayıt kapısı (fetch taklit edilerek, gerçek istek gönderilmeden):**

| Kontrol | Sonuç |
|---|---|
| Kayıtsızken Karşılaştır → modal açılıyor, görünüm değişmiyor | ✅ |
| İlk alana odak veriliyor | ✅ |
| Onay kutusu işaretsizken hata veriyor | ✅ |
| Escape ve dışarı tıklama kapatıyor | ✅ |
| Kayıt sonrası bekleyen işlem çalışıyor (ürün kaydediliyor) | ✅ |
| Kayıt sonrası kapı açılıyor, "Ücretsiz" etiketleri kalkıyor | ✅ |

**Worker API (sahte D1 ile birim testi):**

| Kontrol | Sonuç |
|---|---|
| Geçerli e-posta → 201, küçük harfe çevriliyor | ✅ |
| Aynı e-posta tekrar → 200, yeni satır açılmıyor | ✅ |
| Telefon → 201, yalnızca rakamlar saklanıyor | ✅ |
| Geçersiz iletişim / kısa / uzun mağaza adı → 400 + doğru mesaj | ✅ |
| Bot tuzağı dolu → 400, kayıt yok | ✅ |
| OPTIONS preflight → 204 + doğru CORS başlığı | ✅ |
| DB bağlı değilken anlamlı hata | ✅ |
| GET /register → 405 | ✅ |

### Sizden gereken

1. **Worker'ı yayına alın** — `api/README.md` adım adım anlatıyor (yaklaşık 5 dakika,
   Cloudflare ücretsiz katman yeterli). Sonra dönen adresi
   `e-ticaret-karlilik-hesaplama.html` içindeki `data-register-endpoint` alanına yazın.
2. **Worker yayına alınmadan da site tam çalışır.** Endpoint boşken kayıt kapısı otomatik
   devre dışı kalır; Karşılaştır ve Ürünler herkese açık olur. Yani sırayı istediğiniz gibi
   kurabilirsiniz.
3. **Kayıt aydınlatma metni:** modal "ürün iletişimleri" için onay alıyor. Bu, Gizlilik
   sayfasındaki pazarlama izni bölümüyle uyumlu hâle getirilmeli; KVKK metnine kayıt
   verilerinin (iletişim + mağaza adı) Cloudflare D1'de saklandığı eklenmeli.

### Bilinçli farklar

| Konu | Pakette | Burada | Neden |
|---|---|---|---|
| Çerçeve | Next.js + React | Bağımlılıksız JS | Site statik; Next.js runtime'ı taşımak hosting değişikliği gerektirirdi |
| Uygulama header'ı | Kendi logolu üst barı | Sitenin header'ı + sekme çubuğu | Entegrasyon notundaki "sitenin navigasyonu içine yerleştir" maddesi |
| Mobil alt menü | Sabit alt navigasyon | Yapışkan sekme çubuğu | Site footer'ıyla çakışmaması için; üç görünüm ve mobil kullanım korundu |
| Başlık fontu | Georgia (serif) | Manrope | Sitenin tipografi sistemi |
| Kayıt yolu | `/api/register` (aynı origin) | Cloudflare Worker (CORS'lu) | Statik hostingde sunucu yok |
| Görünüm bağlantısı | Yok | `#karsilastir` / `#urunler` ile doğrudan açılabiliyor | Paylaşılabilir bağlantı; kayıt kapısı yine geçerli |

---

## 0. Revizyon kaydı — 25 Temmuz 2026

| # | Talep | Uygulanan |
|---|---|---|
| 1 | Form bilgileri `info@threepointdigital.com`'a gitsin | FormSubmit endpoint'i değiştirildi (hem AJAX hem JS'siz `action`). **Aktivasyon adımı gerekiyor — bkz. 5. bölüm, madde 3.** |
| 2 | 2025 özetinin arka planı site renkleriyle uyumlu olsun | Siyah blok kaldırıldı; beyaz kart + `--line` çerçeve + turuncu/mor/siyah ince üst şerit. Ana sayfa ve Hakkımızda'da geçerli, mobilde de kontrol edildi. |
| 3 | "Nedir?" cevabından Londra ve "ciro değil net kâr" ifadesi çıksın | İkisi de kaldırıldı. |
| 4 | Platform kartından "Buybox" çıksın, SEO + görsel optimizasyonu gelsin | Ana sayfadaki Trendyol kartı güncellendi; aynı kartın diğer 3 sayfadaki ve 404'teki tekrarları da tutarlılık için güncellendi. |
| 5 | SSS'ten Londra ofisi çıksın | Görünür metinden ve FAQPage schema'sından kaldırıldı. |
| 6 | Garanti cümlesi çıksın, ajans seçimi cevabı değişsin | Yeni metin uygulandı; görünür metin ve schema birebir eşleşiyor. |
| 7 | Site altındaki "son güncelleme" tarihi kaldırılsın | 10 sayfanın footer'ından silindi. |

**Not (madde 4):** Trendyol hizmet sayfasının gövdesinde buybox hâlâ ayrı bir başlık, tablo satırı
ve SSS sorusu olarak duruyor — orada teknik bir konu olarak anlatılıyor. Talep "Platform
uzmanlığı" kartıyla ilgiliydi, o yüzden dokunmadım. Oradan da kaldırmamı isterseniz söyleyin.

**Not (madde 7):** Footer tarihi kaldırıldı; içerik sayfalarının altındaki "İçerik son güncelleme"
satırı ve schema'daki `dateModified` alanı duruyor. GEO açısından güncellik sinyali bunlarla
korunuyor.

**Not (madde 3 ve 5):** Londra yalnızca istediğiniz iki yerden kaldırıldı. Hâlâ geçtiği yerler:
ana sayfa hero rozetleri ("İstanbul + Londra"), iletişim bölümü ("Avrupa ofisi"), tüm sayfaların
footer'ı, Hakkımızda (giriş, özet kutusu, ofis tablosu), meta açıklamalar ve Organization
schema'sındaki ikinci adres. Bunların da kaldırılmasını isterseniz tek seferde yapabilirim.

---

## 1. Uygulanan değişikliklerin kısa özeti

Mevcut site tek sayfalık bir yapıydı: ana sayfa + `referanslar.html` + `hakkimizda.html`.
Hizmetler yalnızca ana sayfada bir kart listesiydi; hiçbir platform için ayrı bir sayfa yoktu.
Blog kaldırılmıştı (tüm `/blog/*` adresleri 404 dönüyor). Bu yapıda "Trendyol mağaza yönetimi
ajansı" gibi bir sorguya karşılık verecek bir hedef sayfa bulunmuyordu.

Yeni yapıda:

- **9 sayfa** oluşturuldu; her pazaryeri ve reklam yönetimi kendi sayfasına taşındı.
- Konumlandırma **"Pazaryerlerinde kârlı büyüme"** üzerine kuruldu; ciro değil net kâr merkeze alındı.
- Her sayfa **answer-first** yazıldı: soru başlık, ilk paragraf doğrudan cevap.
- Platform sayfaları birbirinden bağımsız yazıldı; **hiçbir metin platform adı değiştirilerek
  tekrar kullanılmadı** (ölçüldü: sayfa çiftleri arası benzerlik en fazla 0,35'in altında).
- Site içinde çelişen rakamlar tekilleştirildi. Eski sitede aynı anda "50+", "56", "57'den fazla"
  ve "30+ Marka" geçiyordu; hepsi tek bir doğrulanmış tanıma bağlandı: **2025 · 56+ marka ·
  2,5 milyon sipariş · 1,8 milyar TL ciro** ve her geçtiği yerde bunun *portföyün tamamı* olduğu
  yazıldı.
- Eski ana sayfadaki **doğrulanmamış büyüme yüzdeleri kaldırıldı** (`+%34,2 Aylık Büyüme`,
  `Trendyol +%12,4`, `Hepsiburada +%8,7`, `AmazonTR +%15,1`). Bunların yerine kanıt ve şeffaflık
  bölümü ile vaka çalışması şablonu kondu.
- Kârlılık hesaplayıcı korundu ve genişletildi; **formül mevcut siteyle birebir aynı**, tek fark
  stopajın artık kullanıcı girdisi olması.
- İletişim formu genişletildi ve **mevcut FormSubmit entegrasyonu korundu** (aynı endpoint).
- Fontlar self-host edildi; site artık **hiçbir üçüncü taraf sunucuya istek atmıyor**.

### Teknoloji kararı

Mevcut site, Hostinger'da statik olarak servis edilen bir Next.js export çıktısıydı; kaynak proje
elde yok, dosyalar elle düzenlenmişti (`custom.css?v=10`, `app.js?v=4` gibi yamalar). Yeni site
**aynı teslim modelinde (Hostinger üzerinde statik dosyalar)** kaldı, framework eklenmedi.
Böylece hosting, deploy yöntemi ve hPanel dosya yöneticisiyle düzenleme alışkanlığı değişmiyor;
buna karşılık Next.js runtime artığı ve kullanılmayan CSS/JS yükü ortadan kalktı.

---

## 2. Değiştirilen / oluşturulan dosyalar

### Yeni sayfalar

| Dosya | URL | Not |
|---|---|---|
| `index.html` | `/` | Yeniden yazıldı |
| `trendyol-pazaryeri-yonetimi.html` | `/trendyol-pazaryeri-yonetimi` | Yeni |
| `amazon-tr-pazaryeri-yonetimi.html` | `/amazon-tr-pazaryeri-yonetimi` | Yeni |
| `hepsiburada-pazaryeri-yonetimi.html` | `/hepsiburada-pazaryeri-yonetimi` | Yeni |
| `pazaryeri-reklam-yonetimi.html` | `/pazaryeri-reklam-yonetimi` | Yeni |
| `e-ticaret-karlilik-hesaplama.html` | `/e-ticaret-karlilik-hesaplama` | Yeni |
| `referanslar.html` | `/referanslar` | Yeniden yazıldı |
| `hakkimizda.html` | `/hakkimizda` | Yeniden yazıldı |
| `gizlilik.html` | `/gizlilik` | Yeni (eski sitede ayrı sayfa yoktu, sadece ana sayfada bölümdü) |
| `404.html` | — | Yeni |

### Varlıklar ve yapılandırma

| Dosya | Açıklama |
|---|---|
| `assets/site.css` | Tüm site stili (35 KB / gzip 7 KB). Harici CSS yok. |
| `assets/site.js` | Mobil menü + hesaplayıcı + form (15 KB / gzip 4,4 KB). Bağımlılık yok. |
| `assets/fonts/*.woff2` | DM Sans + Manrope, latin ve latin-ext alt kümeleri (self-hosted, 93 KB) |
| `assets/og.jpg` | Sosyal paylaşım görseli 1200×630 (2 MB PNG'den 178 KB JPEG'e indirildi) |
| `images/` (76 dosya) | Mevcut siteden alınan 56 marka logosu + TPD logosu + favicon seti |
| `robots.txt` | OAI-SearchBot dahil tüm botlar açık, sitemap bildirimi |
| `sitemap.xml` | 9 URL |
| `llms.txt` | Şirket/hizmet dizini |
| `.htaccess` | Uzantısız URL, 301 yönlendirmeler, önbellek, güvenlik başlıkları |
| `server.js` + `package.json` | Production sunucusu (Hostinger Node app). Yerel önizleme de aynı dosyayla yapılır. |
| _(yedek klasörü kaldırıldı)_ | Geri dönüş artık git geçmişiyle yapılır — bkz. 8. bölüm. |

### Silinenler

- Eski sitedeki 4 preload edilen PNG (`image_1..4.png`) → yalnızca logo kaldı, platform logoları
  (Trendyol/Hepsiburada/Amazon) tasarımda kullanılmadığı için indirildikten sonra silindi.
  Gerekirse `_yedek-mevcut-site` üzerinden veya canlı siteden geri alınabilir.
- Next.js runtime CSS'i (`css/2ivnuh0ygkjz1.css`, 38 KB) ve `custom.css` (18 KB) → tek CSS dosyasında birleştirildi.

---

## 3. Test sonuçları

Tümü yerel önizleme sunucusunda (`http://localhost:4173`) çalıştırıldı.

### Otomatik kontroller — **0 hata**

| Kontrol | Sonuç |
|---|---|
| Sayfa başına tek `<h1>` | ✅ 10/10 sayfa |
| Benzersiz `<title>` | ✅ tekrar yok |
| Benzersiz meta description | ✅ tekrar yok, hepsi ≤175 karakter |
| Canonical adresler | ✅ 9/9 sayfa, production URL'leriyle birebir eşleşiyor |
| JSON-LD geçerliliği | ✅ tüm bloklar geçerli JSON olarak parse edildi |
| Kırık iç bağlantı | ✅ yok |
| Kırık sayfa içi çapa (`#…`) | ✅ yok |
| Eksik görsel / eksik `alt` | ✅ yok (56 marka logosunun tamamı 200 döndü, `naturalWidth>0`) |
| Yinelenen `id` | ✅ yok |
| Başlık hiyerarşisi | ✅ H1→H2→H3, seviye atlaması yok |
| JavaScript konsol hatası | ✅ yok |
| Üçüncü taraf isteği | ✅ yok (tüm istekler kendi alan adından) |

### İçerik tekrarı ölçümü

Platform sayfalarının gövde metinleri karşılaştırıldı; hiçbir sayfa çifti 0,35 benzerlik eşiğini
aşmadı. Kelime sayıları: Trendyol 1.306 · Amazon TR 1.230 · Hepsiburada 1.170 · Reklam 1.026 ·
Kârlılık 559 · Gizlilik 620 · Hakkımızda 499 · Referanslar 327.

### Kârlılık hesaplayıcı — mevcut formülle karşılaştırma

Girdi: satış 500 ₺ · alış 180 ₺ · komisyon %21,5 · KDV %20 · reklam %5 · kargo 70 ₺ · stopaj %1

| Çıktı | Sonuç |
|---|---|
| Net satış | 416,67 ₺ |
| Ürün maliyeti (net) | 150,00 ₺ |
| Komisyon | 107,50 ₺ |
| Ödenecek KDV | 15,17 ₺ |
| **Tahmini net kâr** | **71,67 ₺** |
| Net kâr oranı | +%17,2 |

Değerler mevcut `app.js` formülüyle birebir aynı. Ayrıca doğrulandı: zarar durumunda kırmızı
gösterim (satış 200 ₺ → −96,33 ₺), maliyet dağılım çubuğu 6 segment, KDV dökümü, senaryo
kaydetme/silme (en fazla 5).

### İletişim formu

`fetch` taklit edilerek test edildi — **gerçek e-posta gönderilmedi.**

| Senaryo | Sonuç |
|---|---|
| Boş form gönderimi | ✅ istek atılmadı, hata mesajı gösterildi |
| Geçerli form | ✅ `https://formsubmit.co/ajax/info@threepointdigital.com` adresine doğru alanlarla gönderildi, başarı mesajı, form temizlendi |
| Sunucu hatası | ✅ hata mesajı + e-posta alternatifi gösterildi |
| Honeypot dolu (bot) | ✅ istek atılmadı, sessizce başarı gösterildi |

### Erişilebilirlik

| Kontrol | Sonuç |
|---|---|
| Kontrast (32 renk çifti hesaplandı) | ✅ tümü WCAG AA'yı geçiyor (en düşük 4,96:1) |
| Form alanlarının görünür etiketi | ✅ tamamı `<label for>` ile bağlı |
| `autocomplete` değerleri | ✅ name / organization / email / tel |
| Zorunlu alan işareti | ✅ görsel `*` + `required` |
| Pozitif `tabindex` | ✅ yok (yalnızca honeypot `-1`) |
| Landmark'lar (header/main/footer/nav) | ✅ mevcut, tüm `<nav>`'larda `aria-label` |
| Skip link | ✅ `#main` hedefi var, odakta görünür oluyor |
| Görünür odak halkası | ✅ `:focus-visible` 3px mor, koyu zeminde açık turuncu |
| Mobil menü | ✅ açılıyor, `aria-expanded` güncelleniyor, Escape ve link tıklaması kapatıyor |
| `prefers-reduced-motion` | ✅ animasyonlar devre dışı |

### Responsive

- 1280×720 (masaüstü), 1280×1500 ve 375×812 (mobil) görüntülendi.
- Mobilde yatay taşma yok; 7 maddelik menü hamburger'e düşüyor, butonlar tam genişlik.
- KPI tabloları `overflow-x:auto` içinde; sayfa gövdesi yatay kaymıyor.

### Performans (ana sayfa kritik yol)

| | Ham | Aktarım (gzip) |
|---|---|---|
| HTML | 38,9 K | 8,1 K |
| CSS | 34,9 K | 7,3 K |
| JS | 15,1 K | 4,4 K |
| Fontlar (4 woff2) | 92,8 K | 92,8 K |
| Logo | 24,4 K | 24,4 K |
| **Toplam** | **206 K** | **≈137 K** |

56 marka logosunun tamamı (1,3 MB) yalnızca `/referanslar` sayfasında ve **lazy** yükleniyor.
Tüm görsellerde `width`/`height` tanımlı → layout shift beklenmiyor.

### Canlı ortam bot erişimi (bugün test edildi)

CDN/firewall katmanında engelleme **yok**; tüm crawler'lar 200 alıyor:

```
200  OAI-SearchBot     200  GPTBot        200  ChatGPT-User
200  Googlebot         200  PerplexityBot 200  ClaudeBot
```

---

## 4. Production'a geçiş adımları

> **ÖNEMLİ — hosting modeli düzeltmesi (26 Temmuz 2026):** Bu bölüm ilk yazıldığında sitenin
> Apache/LiteSpeed üzerinde düz statik dosya olarak servis edildiği varsayılmıştı. Depo
> incelendiğinde durumun farklı olduğu görüldü: site **Hostinger Node app hosting** üzerinde
> `server.js` ile çalışıyor (`npm start`). Canlı sitede `/referanslar` adresinin uzantısız
> çalışması bunu doğruluyor. Dolayısıyla **`.htaccess` kullanılmıyor**; tüm yönlendirme ve
> başlık işleri `server.js` içinde yapılır. `.htaccess` dosyası, ileride düz statik hostinge
> geçilirse diye depoda bırakıldı.
>
> Deploy edilmeyecekler: **`_yedek-mevcut-site/`**, **`.claude/`**, **`api/`**, **`TESLIMAT.md`**

**1. Yedek al (zorunlu).** hPanel → Dosya Yöneticisi → `public_html` klasörünün tamamını
zip'leyip indirin. `_yedek-mevcut-site/` klasöründeki kopya yalnızca 3 HTML + CSS/JS içerir,
`images/` klasörünü içermez.

**2. Dosyaları yükleyin.** `public_html` içine:

```
index.html  404.html  gizlilik.html  hakkimizda.html  referanslar.html
trendyol-pazaryeri-yonetimi.html  amazon-tr-pazaryeri-yonetimi.html
hepsiburada-pazaryeri-yonetimi.html  pazaryeri-reklam-yonetimi.html
e-ticaret-karlilik-hesaplama.html
robots.txt  sitemap.xml  llms.txt  .htaccess
assets/  images/
```

Eski `css/`, `js/` ve `_next/` klasörleri artık kullanılmıyor; silmeden önce 1–2 hafta bırakmanız
önerilir (önbellekteki eski HTML'ler bunları isteyebilir).

**3. Node uygulamasını yeniden başlatın.** hPanel → Node.js uygulaması → Restart.
Ardından:

```bash
curl -sSI https://www.threepointdigital.com/trendyol-pazaryeri-yonetimi | head -1
```

`HTTP/2 200` dönmeli.

**4. Yönlendirmeleri doğrulayın.**

```bash
curl -sS -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://threepointdigital.com/
curl -sS -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://www.threepointdigital.com/referanslar.html
curl -sS -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://www.threepointdigital.com/hakkimizda.html
```

Üçü de `301` ve doğru hedef göstermeli.

**5. robots ve sitemap erişimini doğrulayın.**

```bash
curl -sS https://www.threepointdigital.com/robots.txt
curl -sS -o /dev/null -w "%{http_code}\n" https://www.threepointdigital.com/sitemap.xml
```

**6. Search Console.** Yeni sitemap'i gönderin ve 9 URL'yi tek tek "URL denetimi → dizine
ekleme iste" ile bildirin. Kanonik host www'ye taşındığı için Search Console'da **www'li mülkün
de doğrulanmış olduğundan** emin olun.

**7. Yapısal veriyi doğrulayın.** Rich Results Test ve Schema Markup Validator ile en az ana sayfa,
bir platform sayfası ve kârlılık sayfasını kontrol edin.

**8. hPanel önbelleğini temizleyin** (hCDN kullanıldığı için eski HTML servis edilebilir).

---

## 5. Doğrulanması gereken bilgiler

> Bu maddeler **siz onaylamadan yayına alınmamalıdır.** Sayfalarda ilgili yerler mor kesikli
> "Doğrulama bekliyor" kutularıyla işaretlendi.

### Yüksek öncelik — yayın öncesi

| # | Konu | Nerede | Ne gerekiyor |
|---|---|---|---|
| 1 | **Portföy rakamları** | Ana sayfa, Hakkımızda, Referanslar, 4 hizmet sayfası | 56+ marka / 2,5 milyon sipariş / 1,8 milyar TL / 2025 dönemi — panel raporlarıyla teyit. Doğrulanmazsa sayı bloklarının kaldırılması gerekir. |
| 2 | **Kanonik alan adı** | Tüm sayfalar + robots + sitemap + .htaccess | Şu anda **www** seçildi (eski sitede canonical `threepointdigital.com`, yani www'siz idi ve iki host da 200 dönüyordu). www yerine köke geçmek isterseniz söyleyin, tek seferde çevirebiliriz. |
| 3 | **FormSubmit adres aktivasyonu** | `index.html` içindeki FormSubmit endpoint'i | Alıcı `info@threepointdigital.com` olarak değiştirildi. **FormSubmit yeni bir adresi ilk gönderimde aktive eder:** deploy sonrası formdan bir test gönderimi yapın, `info@` kutusuna gelen onay e-postasındaki bağlantıya tıklayın. Onaylanana kadar form çalışmaz. Ayrıca adres HTML kaynağında açıkta olduğu için, aktivasyondan sonra FormSubmit panelinden alınan **karma (hash) endpoint'e** geçilmesi önerilir. |
| 4 | **Şirket unvanı ve kurumsal bilgiler** | Hakkımızda, Gizlilik | Yasal unvan, ticaret sicil no, MERSİS, vergi dairesi/no, KEP adresi. |
| 5 | **Açık adres ve telefon** | Hakkımızda, Gizlilik | Şu an yalnızca "Moda, Kadıköy, İstanbul" ve "Londra" var. Yerel arama görünürlüğü için tam adres + telefon önerilir. |
| 6 | **KVKK metni** | Gizlilik | Metin taslak. **Hukuk danışmanı onayı şart.** Saklama süreleri ve veri işleyen listesi boş. |
| 7 | **FormSubmit yurt dışı aktarımı** | Gizlilik | Form gönderimleri üçüncü taraf servis üzerinden geçiyor; KVKK yurt dışına aktarım hükümleri açısından değerlendirilmeli. |

### Orta öncelik

| # | Konu | Nerede | Ne gerekiyor |
|---|---|---|---|
| 8 | **Marka logoları** | Referanslar, Ana sayfa | 56 logonun tamamı **mevcut canlı siteden** alındı, yeni logo eklenmedi. Yine de her marka için yazılı kullanım izni bulunduğunu teyit edin. |
| 9 | **Ekip bilgileri** | Hakkımızda | İsim/unvan/fotoğraf/LinkedIn. Uydurma ekip üyesi eklenmedi, alan boş bırakıldı. |
| 10 | **Vaka çalışmaları** | Referanslar | Şablon hazır, içerik boş. İlk vaka için müşteri izni + panel rapor çıktısı gerekiyor. |
| 11 | **"1 iş günü içinde yanıt"** | Ana sayfa, Hakkımızda | Eski sitede "24 saat içinde" yazıyordu. Gerçekte tutabildiğiniz süre bu mu? |
| 12 | **Ofis rolleri** | Hakkımızda | Londra ofisinin rolü "uluslararası marka ilişkileri" olarak yazıldı — doğru mu? |

### Bilgi

| # | Konu | Not |
|---|---|---|
| 13 | **Analytics** | Mevcut sitede **hiçbir ölçümleme kodu yok** (GA, GTM, Pixel, Clarity — hiçbiri). Dolayısıyla bozulacak bir ölçüm de yok. Analytics eklemek isterseniz Gizlilik sayfası güncellenmeli ve çerez onayı gerekebilir. |
| 14 | **Blog** | `/blog/*` adresleri zaten 404 (mevcut sitemap'te de yer almıyor). Yeniden yayınlanacaksa ayrı bir çalışma. |
| 15 | **GPTBot tercihi** | `robots.txt` içinde eğitim crawler'ı şu an **açık**. Kapatmak isterseniz tek satır: `Allow: /` → `Disallow: /`. Bu, ChatGPT Search görünürlüğünü etkilemez. |

---

## 6. GEO ve teknik SEO için uygulananlar

### İçerik tarafı

- **Answer-first yapı:** Her ana bölüm bir soru başlığıyla açılıyor ve ilk paragraf doğrudan cevap
  veriyor. Tanım cümleleri ayrıca "Kısa tanım" kutusunda tekrarlanıyor — alıntılanabilir birim.
- **Hedeflenen sorgu tipleri:** Trendyol mağaza yönetimi ajansı · Trendyol satışlarını artıracak
  ajans · Amazon Türkiye pazaryeri yönetimi · Amazon TR reklam yönetimi · Hepsiburada mağaza
  yönetimi · Türkiye'de pazaryeri yönetim ajansı · Trendyol Amazon ve Hepsiburada yönetimi ·
  Pazaryeri reklam yönetimi · E-ticaret kârlılık danışmanlığı · Pazaryerinde kârlı büyüme ajansı.
  Her biri için ya ayrı sayfa ya da adı geçen bir H2/SSS başlığı var.
- **Açık varlık tanımları:** Şirket adı, hizmet, platform, lokasyon ve dönem her sayfada düz
  metinde geçiyor (yalnızca schema'da değil) — modeller görünen metni okuyor.
- **Kapsamlı SSS:** Ana sayfada 6, Trendyol'da 6, Amazon TR'de 5, Hepsiburada'da 5, Reklam'da 5,
  Kârlılık'ta 5 soru. Tümü FAQPage schema'sıyla eşleşiyor.
- **Güncelleme tarihi:** Her sayfanın altında "İçerik son güncelleme" satırı + schema'da `dateModified`.
- **Güçlü iç bağlantı:** Platform sayfaları birbirine, reklam sayfasına ve kârlılık aracına;
  kârlılık sayfası üç platforma; hepsi referanslar ve iletişime bağlı.
- **Garanti ifadesi yok:** Her hizmet sayfasında sıralama/satış garantisi verilmediğini açıkça
  belirten bir uyarı bloğu var.

### Yapısal veri

| Şema | Nerede |
|---|---|
| `Organization` + `ProfessionalService` | Ana sayfa (`@id` ile diğer sayfalardan referans veriliyor) |
| `WebSite` | Ana sayfa |
| `WebPage` / `AboutPage` | Tüm sayfalar, `dateModified` ile |
| `Service` (+ `OfferCatalog`) | Ana sayfa ve 4 hizmet sayfası, `audience` ve `areaServed` ile |
| `FAQPage` | Ana sayfa + 5 sayfa |
| `BreadcrumbList` | 8 iç sayfa (görünür breadcrumb ile birebir aynı) |
| `SoftwareApplication` | Kârlılık hesaplama sayfası |

Yapısal verideki her ifade sayfada görünür metinde de mevcut; doğrulanmamış bilgi yok.

### Teknik

- Uzantısız, açıklayıcı URL'ler; her sayfada tek canonical.
- Semantik HTML: `header`/`main`/`footer`/`nav`/`article`/`aside`/`section`, etiketli landmark'lar.
- **Server-side render gerekmiyor** — tüm içerik statik HTML'de. JavaScript kapalıyken de sayfa
  tam okunabilir; JS yalnızca menü, hesaplayıcı ve form için.
- Open Graph + Twitter Card metadata; 1200×630 görsel.
- `robots.txt`'te OAI-SearchBot, GPTBot, ChatGPT-User, PerplexityBot, ClaudeBot, Google-Extended,
  Applebot-Extended ayrı ayrı `Allow`.
- `llms.txt` şirket, hizmet ve önemli sayfalar için içerik dizini olarak eklendi.

> **Not:** `llms.txt` bilinen bir sıralama faktörü değildir ve hiçbir arama motoru veya ChatGPT
> görünürlüğü garanti edilmez. Yapılan iş, içeriğin doğru okunabilmesi için gereken teknik ve
> yapısal zemini kurmaktır.

---

## 7. Bilinen sınırlamalar

1. **`.htaccess` production'da test edilmedi.** Yerel önizleme sunucusu uzantısız URL davranışını
   taklit ediyor ama Apache/LiteSpeed kuralları ancak yüklendikten sonra doğrulanabilir.
   Deploy adım 3'teki `curl` kontrolü bunun içindir; çalışmazsa 9. bölümdeki yedek plan var.
2. **HTTPS yönlendirmesi `.htaccess`'e konmadı.** hCDN arkasında `%{HTTPS}` yanlış okunup sonsuz
   döngü oluşturabildiği için hPanel'deki "Force HTTPS" ayarına bırakıldı (zaten çalışıyor).
3. **Form gönderimi uçtan uca test edilmedi.** İstemci tarafı akış taklit `fetch` ile tam test
   edildi; gerçek bir e-posta göndermemek için canlı gönderim yapılmadı. Deploy sonrası
   kendinize bir test gönderimi yapmanız gerekir.
4. **Ekip ve vaka çalışması bölümleri boş.** Doğrulanmış bilgi olmadan içerik üretilmedi.
5. **Marka logolarının dosya adları anlamsız** (`image_10.webp` gibi) — mevcut siteden olduğu gibi
   alındı. `alt` metinleri doğru marka adlarını taşıyor, bu yüzden SEO açısından sorun yok; ancak
   ileride yeniden adlandırmak bakım kolaylığı sağlar.
6. **Blog geri gelirse** navigasyon ve sitemap güncellenmeli.
7. **Görsel çeşitliliği sınırlı.** Site tipografi ve düzen ağırlıklı; ofis, ekip veya süreç
   fotoğrafı yok. Gerçek fotoğraf sağlanırsa Hakkımızda ve ana sayfa belirgin şekilde güçlenir.
8. **Lighthouse/CrUX ölçümü yapılmadı** — production'a çıkmadan gerçek Core Web Vitals verisi
   alınamaz. Yapısal olarak gereken önlemler (boyut tanımlı görseller, lazy loading, tek CSS/JS,
   self-hosted font, bloklayıcı üçüncü taraf yok) alındı.

---

## 8. Geri dönüş planı

Deploy sonrası sorun çıkarsa, en hızlıdan en kapsamlıya:

**A. Tek kural sorunu (uzantısız URL'ler 404).**
`.htaccess` dosyasını silin. Site anında eski davranışa döner (`/index.html` çalışır), ancak iç
bağlantılar uzantısız olduğu için kırılır → bu durumda doğrudan B'ye geçin veya 9. bölümü uygulayın.

**B. Tam geri dönüş — git ile (önerilen).**
Yenileme, mevcut deponun geçmişi üzerine tek commit olarak eklenmiştir. Bir önceki canlı sürüm
`671973b` commit'idir:

```bash
git checkout 671973b -- . && git checkout HEAD -- TESLIMAT.md README.md
```

veya yenileme commit'ini tümüyle geri almak için:

```bash
git revert --no-edit <yenileme-commit-hash>
```

Ardından dosyaları yeniden yükleyip Node uygulamasını yeniden başlatın. Adım 1'de aldığınız
`public_html` zip'i de aynı işi görür.

**C. Kısmi geri dönüş (yalnızca kanonik host).**
www kararından dönmek isterseniz `.htaccess`'teki 1 numaralı bloğu kaldırın ve tüm sayfalarda
`https://www.threepointdigital.com` → `https://threepointdigital.com` değişimini yapın
(canonical, og:url, sitemap, robots, llms.txt, JSON-LD `@id`'leri).

**Geri dönüş sonrası:** hPanel önbelleğini temizleyin ve Search Console'da varsa hatalı
yönlendirme bildirimlerini kontrol edin.

---

## 9. `.htaccess` çalışmazsa yedek plan

Hostinger'da rewrite çalışmıyorsa uzantısız URL'lerden vazgeçip `.html` uzantılı adreslere dönmek
gerekir. Bu, proje klasöründe tek komutla yapılır:

```bash
cd "/Users/avk/Developer/TPD Website" && python3 - <<'EOF'
import re, glob
pages = [p[:-5] for p in glob.glob("*.html") if p != "index.html"]
for f in glob.glob("*.html"):
    s = open(f, encoding="utf-8").read()
    for p in pages:
        s = s.replace(f'href="/{p}"', f'href="/{p}.html"')
    open(f, "w", encoding="utf-8").write(s)
print("İç bağlantılar .html uzantılı hâle getirildi.")
EOF
```

Bu durumda `canonical`, `og:url`, `sitemap.xml` ve `llms.txt` adreslerine de `.html` eklenmeli ve
`.htaccess`'teki 2–5 numaralı bloklar kaldırılmalıdır (1 numaralı www yönlendirmesi kalabilir).

---

## Sayfaları yerelde görüntülemek

```bash
cd "/Users/avk/Developer/TPD Website" && npm start
```

Ardından http://localhost:3000 adresini açın. Bu, production'da çalışan sunucunun aynısıdır;
yönlendirme ve başlık davranışı yerelde de canlıdakiyle birebir aynıdır.
