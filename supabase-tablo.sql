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
  olusturma  timestamptz not null default now(),
  -- Ayni gun + saat + kuafor iki kez alinamaz; ama iki kuafor ayni saatte olabilir:
  unique (tarih, saat, kuafor)
);

-- Gun bazli sorgular hizli olsun:
create index if not exists randevular_tarih_idx on public.randevular (tarih);

-- RLS acik kalsin: sunucu secret (service_role) anahtariyla baglaniyor ve
-- RLS'i bypass eder. Public/anon anahtarla tabloya erisim OLMAZ -> musteri
-- verisi disariya acilmaz.
alter table public.randevular enable row level security;
