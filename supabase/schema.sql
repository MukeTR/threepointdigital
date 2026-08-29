-- Three Point Digital — Kârlılık Merkezi mini uygulaması
-- Supabase SQL Editor'de bir kez çalıştırın.
--
-- Doğrulama (OTP) yoktur: cep telefonu numarası kimliktir. Bu tablo yalnızca
-- sunucu tarafındaki servis anahtarıyla okunup yazılır; tarayıcı doğrudan
-- erişmez (bkz. server.js -> /api/kayit, /api/urunler).

create table if not exists public.tpd_registrations (
  id          uuid primary key,
  phone       text not null unique,          -- 5xxxxxxxxx (10 hane, öneksiz)
  full_name   text not null,
  email       text not null,
  products    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tpd_registrations_email_idx on public.tpd_registrations (email);
create index if not exists tpd_registrations_created_idx on public.tpd_registrations (created_at desc);

-- Tarayıcıdan (anon/authenticated rolleriyle) erişim tamamen kapalı.
-- Servis anahtarı RLS'i baypas eder; sunucu bu yüzden çalışmaya devam eder.
alter table public.tpd_registrations enable row level security;

-- Kayıt listesini panelden okumak için hazır görünüm.
create or replace view public.tpd_kayitlar as
  select
    created_at as kayit_tarihi,
    full_name  as ad_soyad,
    email      as eposta,
    '0' || phone as telefon,
    jsonb_array_length(products) as kayitli_urun,
    updated_at as son_islem
  from public.tpd_registrations
  order by created_at desc;


-- ===========================================================================
-- İletişim formu talepleri (ana sayfadaki "Ücretsiz analiz iste")
--
-- Talep buraya yazılır ve /admin panelinden takip edilir. E-posta gönderimi
-- yoktur: FormSubmit form aktivasyonu istediği ve aktive edilmediği sürece
-- sessizce hiçbir bildirim göndermediği için kaldırıldı.
-- ===========================================================================

create table if not exists public.tpd_leads (
  id           uuid primary key,
  full_name    text not null,
  brand        text not null,
  email        text not null,
  phone        text,                              -- 5xxxxxxxxx (10 hane) veya boş
  marketplace  text,
  revenue      text,
  message      text not null,
  source_page  text,                              -- talebin gönderildiği sayfa
  status       text not null default 'yeni',      -- yeni | arandi | teklif | kazanildi | kayip
  note         text not null default '',          -- ekip notu (panelden yazılır)
  read_at      timestamptz,                       -- panelde ilk açılış anı
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists tpd_leads_created_idx on public.tpd_leads (created_at desc);
create index if not exists tpd_leads_status_idx  on public.tpd_leads (status);
create index if not exists tpd_leads_email_idx   on public.tpd_leads (email);

-- Yalnızca sunucu (servis anahtarı) erişir; tarayıcıya tamamen kapalı.
alter table public.tpd_leads enable row level security;

-- Durum değerini veritabanı seviyesinde de sınırla; panelde bir hata olsa bile
-- tabloya tanımsız durum düşmesin.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tpd_leads_status_chk'
  ) then
    alter table public.tpd_leads
      add constraint tpd_leads_status_chk
      check (status in ('yeni', 'arandi', 'teklif', 'kazanildi', 'kayip'));
  end if;
end $$;

-- Panel dışında (Supabase Table Editor'de) okumak için okunaklı görünüm.
create or replace view public.tpd_talepler as
  select
    created_at as talep_tarihi,
    full_name  as ad_soyad,
    brand      as marka,
    email      as eposta,
    case when phone is null or phone = '' then '-' else '0' || phone end as telefon,
    marketplace as pazaryeri,
    revenue    as ciro_araligi,
    message    as mesaj,
    case status
      when 'yeni'      then 'Yeni'
      when 'arandi'    then 'Arandı'
      when 'teklif'    then 'Teklif verildi'
      when 'kazanildi' then 'Kazanıldı'
      when 'kayip'     then 'Kayıp'
      else status
    end as durum,
    note       as not,
    source_page as geldigi_sayfa
  from public.tpd_leads
  order by created_at desc;


-- ===========================================================================
-- Blog yazıları (/admin > Blog sekmesinden yönetilir)
--
-- Yazılar önce statik dosya olarak (blog/*.html) yayına alınmıştı. Panelden
-- yönetilebilmesi için içerik buraya taşındı: Hostinger'da uygulama dizini
-- dağıtımlarda değiştiği için dosyaya yazmak kalıcı değil.
--
-- Sunucu önce bu tabloya bakar; kayıt yoksa (ya da veritabanına erişilemezse)
-- blog/*.html dosyasına düşer. Böylece veritabanı çökse bile yayındaki
-- yazılar erişilebilir kalır.
-- ===========================================================================

create table if not exists public.tpd_blog_posts (
  id            uuid primary key,
  slug          text not null unique,             -- /blog/<slug>
  title         text not null,                    -- <title> etiketi
  headline      text not null,                    -- sayfadaki h1
  description   text not null,                    -- meta description + kart özeti
  category      text not null default 'Strateji', -- Strateji|Ürün|Reklam|Kampanya|Kârlılık|Operasyon
  body_html     text not null,                    -- yazı gövdesi (p, h2, ul...)
  status        text not null default 'taslak',   -- taslak | yayinda
  sort_order    integer not null default 999,     -- dizin sayfasındaki sıra
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tpd_blog_posts_slug_idx   on public.tpd_blog_posts (slug);
create index if not exists tpd_blog_posts_status_idx on public.tpd_blog_posts (status);
create index if not exists tpd_blog_posts_order_idx  on public.tpd_blog_posts (sort_order, published_at desc);

-- Yalnızca sunucu (servis anahtarı) erişir; tarayıcıya tamamen kapalı.
alter table public.tpd_blog_posts enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tpd_blog_posts_status_chk') then
    alter table public.tpd_blog_posts
      add constraint tpd_blog_posts_status_chk
      check (status in ('taslak', 'yayinda'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tpd_blog_posts_category_chk') then
    alter table public.tpd_blog_posts
      add constraint tpd_blog_posts_category_chk
      check (category in ('Strateji', 'Ürün', 'Reklam', 'Kampanya', 'Kârlılık', 'Operasyon'));
  end if;
end $$;

-- Supabase Table Editor'de okunaklı liste.
create or replace view public.tpd_yazilar as
  select
    sort_order as sira,
    slug,
    headline   as baslik,
    category   as kategori,
    case status when 'yayinda' then 'Yayında' else 'Taslak' end as durum,
    published_at as yayin_tarihi,
    updated_at   as son_guncelleme
  from public.tpd_blog_posts
  order by sort_order, published_at desc;


-- ===========================================================================
-- Referans logoları (/admin > Referans logoları sekmesinden yönetilir)
--
-- Logo görselleri Supabase Storage'daki "logolar" kovasında durur; tabloda
-- yalnızca kaydın kendisi ve görselin yolu tutulur. Hostinger'da uygulama
-- dizini dağıtımlarda değiştiği için dosyayı sunucuya yazmak kalıcı olmazdı.
--
-- Sunucu ana sayfadaki logo şeridini ve referanslar sayfasındaki ızgarayı bu
-- tablodan doldurur; tablo boşsa ya da erişilemezse sayfalardaki mevcut statik
-- liste olduğu gibi kalır.
-- ===========================================================================

create table if not exists public.tpd_logos (
  id          uuid primary key,
  name        text not null,                  -- marka adı (img alt değeri)
  grup        text not null default 'uluslararasi', -- uluslararasi | yerel
  kategori    text,                           -- markanın ürün kategorisi (title metni)
  image_path  text not null,                  -- kovadaki dosya yolu veya /images/... 
  width       integer,                        -- görselin doğal genişliği (CLS önlemek için)
  height      integer,
  status      text not null default 'yayinda',-- yayinda | gizli
  sort_order  integer not null default 999,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tpd_logos_order_idx  on public.tpd_logos (grup, status, sort_order);

alter table public.tpd_logos enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tpd_logos_status_chk') then
    alter table public.tpd_logos
      add constraint tpd_logos_status_chk check (status in ('yayinda', 'gizli'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tpd_logos_grup_chk') then
    alter table public.tpd_logos
      add constraint tpd_logos_grup_chk check (grup in ('uluslararasi', 'yerel'));
  end if;
end $$;

-- Görsel kovası: herkese açık okuma, yazma yalnızca servis anahtarıyla.
insert into storage.buckets (id, name, public)
values ('logolar', 'logolar', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'tpd_logolar_acik_okuma'
  ) then
    create policy tpd_logolar_acik_okuma on storage.objects
      for select to anon, authenticated using (bucket_id = 'logolar');
  end if;
end $$;

-- Panel dışında okumak için okunaklı görünüm.
create or replace view public.tpd_referans_logolari as
  select
    grup,
    sort_order as sira,
    name       as marka,
    kategori,
    image_path as gorsel,
    case status when 'yayinda' then 'Yayında' else 'Gizli' end as durum,
    updated_at as son_guncelleme
  from public.tpd_logos
  order by grup, sort_order, name;
