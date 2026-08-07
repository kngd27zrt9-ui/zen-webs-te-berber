-- ==========================================================
-- CECE BARBER — Dashboard veritabanı kurulumu (şema + RLS)
-- Supabase panelinde: SQL Editor > New query > tümünü yapıştır > Run
-- ==========================================================

-- ---- 1) BERBERLER: her berber = bir auth kullanıcısı ----
create table if not exists public.berberler (
  id        uuid primary key references auth.users(id) on delete cascade,
  isim      text not null unique,
  olusturma timestamptz not null default now()
);

-- ---- 2) RANDEVULAR: yeni alanlar ----
alter table public.randevular add column if not exists kuafor    text;
alter table public.randevular add column if not exists barber_id uuid references public.berberler(id) on delete set null;
alter table public.randevular add column if not exists durum     text not null default 'en_attente';  -- en_attente | confirme | termine | absent | annule
alter table public.randevular add column if not exists notlar    text;
alter table public.randevular add column if not exists fiyat     integer;  -- CHF

-- Eski "gün+saat tek randevu" kuralını kaldır, berber bazlı yeni kural koy
alter table public.randevular drop constraint if exists randevular_tarih_saat_key;
alter table public.randevular drop constraint if exists randevular_tarih_saat_kuafor_key;
create unique index if not exists randevular_barber_slot_uidx
  on public.randevular (barber_id, tarih, saat);
create index if not exists randevular_barber_tarih_idx
  on public.randevular (barber_id, tarih);

-- ---- 3) MÜŞTERİ NOTLARI: berber başına müşteri notu ----
create table if not exists public.musteri_notlari (
  id         uuid primary key default gen_random_uuid(),
  barber_id  uuid not null references public.berberler(id) on delete cascade,
  tel        text not null,
  isim       text,
  notlar     text,
  guncelleme timestamptz not null default now(),
  unique (barber_id, tel)
);

-- ==========================================================
-- 4) ROW LEVEL SECURITY — her berber SADECE kendi verisi
-- ==========================================================
alter table public.berberler       enable row level security;
alter table public.randevular       enable row level security;
alter table public.musteri_notlari  enable row level security;

-- berberler: sadece kendi satırını okuyabilir
drop policy if exists berber_self_select on public.berberler;
create policy berber_self_select on public.berberler
  for select to authenticated using (id = auth.uid());

-- randevular: sadece kendi randevuları (okuma / ekleme / güncelleme / silme)
drop policy if exists rv_select on public.randevular;
create policy rv_select on public.randevular
  for select to authenticated using (barber_id = auth.uid());

drop policy if exists rv_insert on public.randevular;
create policy rv_insert on public.randevular
  for insert to authenticated with check (barber_id = auth.uid());

drop policy if exists rv_update on public.randevular;
create policy rv_update on public.randevular
  for update to authenticated using (barber_id = auth.uid()) with check (barber_id = auth.uid());

drop policy if exists rv_delete on public.randevular;
create policy rv_delete on public.randevular
  for delete to authenticated using (barber_id = auth.uid());

-- musteri_notlari: sadece kendi müşteri notları
drop policy if exists mn_all on public.musteri_notlari;
create policy mn_all on public.musteri_notlari
  for all to authenticated using (barber_id = auth.uid()) with check (barber_id = auth.uid());

-- NOT: Public (müşteri) rezervasyonu Node sunucusunun SECRET anahtarıyla yapılır;
-- service_role RLS'i bypass ettiği için müşteri tarafına ekstra policy gerekmez.
-- Müşteri hiçbir randevuyu OKUYAMAZ (select policy yok) -> veri gizli kalır.
