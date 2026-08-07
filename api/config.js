// GET /api/config
// Admin sayfası, tarayıcıda Supabase Auth için genel (public) bilgileri buradan alır.
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ hata: 'Method Not Allowed' });
    return;
  }
  res.status(200).json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY || '' });
};
