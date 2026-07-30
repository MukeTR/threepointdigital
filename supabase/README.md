# Kârlılık Merkezi — kayıt ve ürün senkronu

`/e-ticaret-karlilik-hesaplama` sayfasındaki mini uygulama; **Karşılaştır**, **Ürünler** ve
**Ürünü kaydet** işlemlerinde ücretsiz kayıt ister. Doğrulama (SMS/OTP) yoktur: cep telefonu
numarası kimliktir.

Form alanları: **ad soyad · e-posta · cep telefonu** (+ aydınlatma metni onayı).

## Nasıl çalışır

```
Tarayıcı                     server.js (Hostinger)            Supabase
  Ürünü kaydet
   → modal            POST /api/kayit  ───────────────→  tpd_registrations (upsert, phone unique)
                            ←── { id, mode: "sync" }
  ürün eklendi        PUT  /api/urunler ──────────────→  products (jsonb, en çok 50 kayıt)
  sayfa açılışı       GET  /api/urunler?id=… ────────→  products
```

- Servis anahtarı **yalnızca sunucuda** okunur; tarayıcıya hiç gitmez.
- Oturum `localStorage`'daki `tpd-free-registration` kaydıdır (id + mod + iletişim bilgileri).
- Ürünler her zaman cihazda da tutulur; sunucu erişilemezse uygulama çalışmaya devam eder.
- Aynı numarayla başka cihazdan girildiğinde ürünler sunucudan çekilip cihazdakiyle birleşir
  (id'ye göre tekilleştirme).

## Kurulum (tek seferlik)

1. **Supabase projesi**: yeni proje aç (veya mevcut projeyi kullan — tablo adı `tpd_` önekli).
2. **Şema**: SQL Editor'de `supabase/schema.sql` dosyasını çalıştır.
3. **API bilgileri**: Project Settings → API → `Project URL` ve `service_role` anahtarı.
4. **hPanel → Node.js uygulaması → ortam değişkenleri**:

   | Değişken | Değer |
   |---|---|
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | `service_role` anahtarı |
   | `SUPABASE_TABLE` | (opsiyonel) varsayılan `tpd_registrations` |

5. **Uygulamayı yeniden başlat**, ardından doğrula:

   ```bash
   curl -s https://www.threepointdigital.com/api/durum
   # {"ok":true,"supabase":true}  <- false ise değişkenler okunmuyor
   ```

## Değişkenler tanımlı değilse

Uygulama **cihaz modunda** çalışır: kayıt formu açılır, kapı geçilir, ürünler yalnızca
tarayıcıda saklanır. `/api/kayit` yanıtı `{"mode":"local"}` döner ve sunucu günlüğüne
`[kayit] SUPABASE_URL/SUPABASE_SERVICE_KEY tanımsız — cihaz modu` yazılır. Değişkenler
eklenip uygulama yeniden başlatıldığında yeni kayıtlar Supabase'e düşmeye başlar.

## Kayıtları görmek

Supabase → Table Editor → `tpd_registrations`, ya da hazır görünüm:

```sql
select * from public.tpd_kayitlar;   -- kayit_tarihi, ad_soyad, eposta, telefon, kayitli_urun
```

## KVKK

Kayıt formunda toplanan ad soyad, e-posta ve telefon `gizlilik.html` sayfasındaki
aydınlatma metni kapsamındadır. Supabase yeni bir **veri işleyen** olduğu için o sayfadaki
"Aktarım ve veri işleyenler" tablosuna eklenmelidir (proje bölgesi AB seçilirse aktarım
AB içinde kalır).
