-- ==========================================================
-- CECE BARBER — Kuaför özelliği migration'ı
-- Mevcut 'randevular' tablosuna kuaför desteği ekler.
-- Supabase panelinde: SQL Editor > New query > Run
-- ==========================================================

-- 1) Kuaför sütunu
alter table public.randevular
  add column if not exists kuafor text;

-- 2) Eski "ayni gun+saat tek randevu" kurallarini kaldir
--    (artik ayni saatte farkli kuaforler randevu alabilmeli)
alter table public.randevular
  drop constraint if exists randevular_tarih_saat_key;
-- Iptalleri de sayan eski (kismi-olmayan) kurali da kaldir; iptal edilen
-- saatin tekrar alinabilmesini bu kural engelliyordu.
alter table public.randevular
  drop constraint if exists randevular_tarih_saat_kuafor_key;

-- 3) Yeni KISMI benzersiz kural: yalniz AKTIF (durum <> 'annule') randevular
--    saati "dolu" tutar. Boylece:
--      • bir kuafor ayni saatte iki kez alinamaz (cift booking engeli),
--      • iki kuafor ayni saatte randevu alabilir,
--      • berber iptal edince (durum='annule') saat tekrar bosalir ve
--        yeniden alinabilir.
--    Ayrinti icin: supabase-iptal-slot.sql
create unique index if not exists randevular_aktif_slot_uidx
  on public.randevular (tarih, saat, kuafor)
  where durum <> 'annule';
