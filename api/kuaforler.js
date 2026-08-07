// GET /api/kuaforler
// Rezervasyon formu, seçilebilir kuaförleri buradan alır (tek kaynak: KUAFORLER).
const { KUAFORLER } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ hata: 'Method Not Allowed' });
    return;
  }
  res.status(200).json({ kuaforler: KUAFORLER });
};
