-- ==========================================================
-- CECE BARBER — Kuaför özelliği migration'ı
-- Mevcut 'randevular' tablosuna kuaför desteği ekler.
-- Supabase panelinde: SQL Editor > New query > Run
-- ==========================================================

-- 1) Kuaför sütunu
alter table public.randevular
  add column if not exists kuafor text;

-- 2) Eski "ayni gun+saat tek randevu" kuralini kaldir
--    (artik ayni saatte farkli kuaforler randevu alabilmeli)
alter table public.randevular
  drop constraint if exists randevular_tarih_saat_key;

-- 3) Yeni kural: ayni gun + saat + KUAFOR tekildir
--    (bir kuafor ayni saatte iki kez alinamaz; ama iki kuafor ayni saatte olabilir)
alter table public.randevular
  add constraint randevular_tarih_saat_kuafor_key unique (tarih, saat, kuafor);
