// GET /api/musaitlik?tarih=...&kuafor=...&sure=...
// Site, seçilen tarih + hizmet süresine göre boş saatleri buradan ister.
const { KUAFORLER, musaitSaatler } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ hata: 'Method Not Allowed' });
    return;
  }
  const q = req.query || {};
  const tarih = q.tarih;
  const kuafor = q.kuafor;
  const sure = parseInt(q.sure, 10) || 30;
  // Kuaför seçilmemiş ya da tanınmıyorsa boş dön (müşteri önce kuaför seçmeli).
  const saatler = (tarih && KUAFORLER.includes(kuafor))
    ? await musaitSaatler(tarih, sure, kuafor)
    : [];
  res.status(200).json({ saatler });
};
