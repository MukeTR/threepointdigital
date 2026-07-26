-- Three Point Digital — Kârlılık Merkezi kayıt tablosu
-- Teslim edilen pakette yer alan drizzle/0000_orange_songbird.sql ile aynı şemadır.
-- Ek olarak yalnızca `contact` üzerinde tekilleştirme için bir indeks tanımlanır.

CREATE TABLE IF NOT EXISTS registrations (
  id           text    PRIMARY KEY NOT NULL,
  contact      text    NOT NULL,
  contact_type text    NOT NULL,
  store_name   text    NOT NULL,
  consent_at   integer NOT NULL,
  created_at   integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS registrations_contact_idx ON registrations (contact);
