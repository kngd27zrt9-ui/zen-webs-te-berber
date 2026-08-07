// POST /api/randevu
// Müşteri rezervasyonunu kaydeder (online randevu -> berber onayı bekler).
const {
  TABLO, SURELER, KUAFORLER, FIYATLAR,
  veriIstemci, berberIdBul, musaitSaatler, govdeOku,
} = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, hata: 'Method Not Allowed' });
    return;
  }

  let randevu;
  try {
    randevu = await govdeOku(req);
  } catch (e) {
    res.status(400).json({ ok: false, hata: 'Données invalides' });
    return;
  }

  try {
    // Basit doğrulama
    if (!randevu.hizmet || !randevu.tarih || !randevu.saat || !randevu.ad || !randevu.tel) {
      res.status(400).json({ ok: false, hata: 'Champs manquants' });
      return;
    }
    // Geçerli bir kuaför seçilmiş mi?
    if (!KUAFORLER.includes(randevu.kuafor)) {
      res.status(400).json({ ok: false, hata: 'Veuillez choisir un coiffeur.' });
      return;
    }

    const sure = SURELER[randevu.hizmet] || 30;

    // Çift randevu engeli: seçilen kuaförde o saat hâlâ boş mu?
    const musait = await musaitSaatler(randevu.tarih, sure, randevu.kuafor);
    if (!musait.includes(randevu.saat)) {
      res.status(409).json({ ok: false, hata: 'Cet horaire vient d\'être pris, veuillez en choisir un autre.' });
      return;
    }

    const barberId = await berberIdBul(randevu.kuafor);

    const { error } = await veriIstemci().from(TABLO).insert({
      hizmet: randevu.hizmet,
      tarih:  randevu.tarih,
      saat:   randevu.saat,
      kuafor: randevu.kuafor,
      barber_id: barberId,
      durum:  'en_attente',
      fiyat:  FIYATLAR[randevu.hizmet] || 0,
      ad:     String(randevu.ad).trim(),
      tel:    String(randevu.tel).trim(),
      sure:   sure,
      olusturma: new Date().toISOString(),
    });

    if (error) {
      // 23505 = unique ihlali -> saat aynı anda başkası tarafından alındı
      if (error.code === '23505') {
        res.status(409).json({ ok: false, hata: 'Cet horaire vient d\'être pris, veuillez en choisir un autre.' });
        return;
      }
      console.error('Supabase yazma hatası:', error.message);
      res.status(500).json({ ok: false, hata: 'Erreur serveur' });
      return;
    }

    console.log('Yeni randevu:', randevu.ad, '-', randevu.hizmet, randevu.tarih, randevu.saat);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Randevu hatası:', e.message);
    res.status(400).json({ ok: false, hata: 'Données invalides' });
  }
};
