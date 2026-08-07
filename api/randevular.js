// GET /api/randevular  (KORUMALI — berber girişi gerekli)
// Giriş yapmış berberin JWT'siyle randevuları döndürür. Kuaföre bağlı hesap
// yalnız kendi randevularını görür. (Dashboard ayrıca doğrudan Supabase + RLS
// kullanır; bu uç yedek/uyumluluk içindir.)
const { TABLO, veriIstemci, kullaniciDogrula } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, hata: 'Method Not Allowed' });
    return;
  }

  const user = await kullaniciDogrula(req);
  if (!user) {
    res.status(401).json({ ok: false, hata: 'Yetkisiz' });
    return;
  }
  const kuafor = (user.user_metadata && user.user_metadata.kuafor) || null;

  let sorgu = veriIstemci()
    .from(TABLO)
    .select('id, hizmet, tarih, saat, kuafor, ad, tel, sure, olusturma')
    .order('tarih', { ascending: true })
    .order('saat', { ascending: true });
  if (kuafor) sorgu = sorgu.eq('kuafor', kuafor);

  const { data, error } = await sorgu;
  if (error) {
    console.error('Supabase liste hatası:', error.message);
    res.status(500).json({ ok: false, hata: 'Erreur serveur' });
    return;
  }
  res.status(200).json({ ok: true, kuafor: kuafor, randevular: data || [] });
};
