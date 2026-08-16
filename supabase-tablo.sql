-- ==========================================================
-- CECE BARBER — Supabase tablo kurulumu
-- Bu SQL'i Supabase panelinde: SQL Editor > New query > Run
-- ==========================================================

create table if not exists public.randevular (
  id         bigint generated always as identity primary key,
  hizmet     text        not null,
  tarih      date        not null,
  saat       text        not null,
  kuafor     text,
  ad         text        not null,
  tel        text        not null,
  sure       integer     not null,
  olusturma  timestamptz not null default now()
);

-- Gun bazli sorgular hizli olsun:
create index if not exists randevular_tarih_idx on public.randevular (tarih);

-- Ayni gun + saat + kuafor iki kez alinamaz; ama iki kuafor ayni saatte
-- olabilir. KISMI indeks: yalniz AKTIF (durum <> 'annule') randevular saati
-- "dolu" tutar -> berber iptal edince saat tekrar bosalir ve yeniden alinabilir.
-- (durum sutunu supabase-dashboard.sql ile eklenir; o dosya da bu indeksi kurar.)
-- Ayrinti icin: supabase-iptal-slot.sql

-- RLS acik kalsin: sunucu secret (service_role) anahtariyla baglaniyor ve
-- RLS'i bypass eder. Public/anon anahtarla tabloya erisim OLMAZ -> musteri
-- verisi disariya acilmaz.
alter table public.randevular enable row level security;
