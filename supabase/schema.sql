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
