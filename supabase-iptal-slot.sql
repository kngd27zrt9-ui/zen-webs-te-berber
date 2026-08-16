-- ==========================================================
-- CECE BARBER — İptal edilen randevunun saatini geri açma (SAĞLAM SÜRÜM)
-- Supabase panelinde: SQL Editor > New query > tümünü yapıştır > Run
-- Bu dosya idempotent'tir: birden çok kez çalıştırmak güvenlidir.
--
-- SORUN
--   Benzersizlik kuralı, iptal edilmiş (durum = 'annule') satır tabloda
--   kaldığı için o saatin tekrar alınmasını engelliyordu. Ayrıca kural
--   'barber_id' üzerineydi; barber_id NULL olabildiğinden (berber silinince
--   'set null' + isim eşleşmezse null) Postgres NULL'ları benzersiz saymaz
--   ve aynı saate iki AKTİF randevu sızabilirdi.
--
-- ÇÖZÜM
--   Benzersizliği HER ZAMAN dolu olan 'kuafor' alanına taşı ve KISMİ yap:
--   yalnız durum <> 'annule' satırlar saati "dolu" tutar. Böylece
--     • berber iptal edince saat müşteri sitesinde tekrar boş görünür ve
--       yeniden alınabilir,
--     • aynı gün+saat+kuaförde en fazla BİR aktif randevu olabilir (çift
--       booking / eşzamanlı çakışma engellenir),
--     • iki farklı kuaför aynı saatte randevu alabilir.
-- ==========================================================

-- 1) Eski / çakışan benzersizlik kurallarını temizle (varsa)
alter table public.randevular drop constraint if exists randevular_tarih_saat_key;
alter table public.randevular drop constraint if exists randevular_tarih_saat_kuafor_key;
drop index if exists public.randevular_barber_slot_uidx;   -- eski (barber_id) sürüm
drop index if exists public.randevular_aktif_slot_uidx;    -- kendini yeniden kurabilmek için

-- 2) Yeni KISMİ benzersiz indeks: yalnız aktif (iptal edilmemiş) randevular
create unique index if not exists randevular_aktif_slot_uidx
  on public.randevular (tarih, saat, kuafor)
  where durum <> 'annule';

-- 3) Berber bazlı gün sorguları için performans indeksi (benzersiz DEĞİL)
create index if not exists randevular_barber_tarih_idx
  on public.randevular (barber_id, tarih);
