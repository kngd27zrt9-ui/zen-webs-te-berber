-- ==========================================================
-- CECE BARBER — İptal edilen randevunun saatini geri açma
-- Supabase panelinde: SQL Editor > New query > tümünü yapıştır > Run
--
-- Sorun: (barber_id, tarih, saat) benzersizlik kuralı, iptal edilmiş
-- (durum = 'annule') satır tabloda kaldığı için o saatin tekrar
-- alınmasını engelliyordu. Çözüm: kuralı KISMİ yap -> yalnız iptal
-- edilmemiş randevular saati "dolu" tutar. Böylece berber iptal edince
-- saat hem müşteri sitesinde boş görünür hem de tekrar alınabilir.
-- ==========================================================

-- Eski (iptal edilenleri de kapsayan) benzersiz indeksi kaldır
drop index if exists public.randevular_barber_slot_uidx;

-- Yeni KISMİ benzersiz indeks: sadece durum <> 'annule' olan satırlara uygulanır
create unique index if not exists randevular_barber_slot_uidx
  on public.randevular (barber_id, tarih, saat)
  where durum <> 'annule';
