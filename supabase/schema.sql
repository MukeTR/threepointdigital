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
