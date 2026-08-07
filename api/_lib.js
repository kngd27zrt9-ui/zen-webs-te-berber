// ==========================================================
// ORTAK KÜTÜPHANE — Vercel serverless fonksiyonları buradan
// beslenir. İş mantığı sunucu.js ile BİREBİR aynıdır; tek fark
// Vercel'de kalıcı sunucu yerine istek başına fonksiyon çalışır.
// ==========================================================
const { createClient } = require('@supabase/supabase-js');

// ---- Ortam değişkenleri (Vercel panelinden gelir) ----
// .trim(): panele yapıştırırken başa/sona karışan boşluk veya satır atlamasını
// temizler (aksi halde anahtar bozuk sayılır ve giriş/bağlantı hata verir).
const temizle = (d) => (typeof d === 'string' ? d.trim() : d);
const SUPABASE_URL = temizle(process.env.SUPABASE_URL);
const SUPABASE_SECRET_KEY = temizle(process.env.SUPABASE_SECRET_KEY);
const SUPABASE_ANON_KEY = temizle(process.env.SUPABASE_ANON_KEY);

// Eksik değişken varsa net hata ver (fonksiyon çağrılınca fark edilir).
function ortamKontrol() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      'SUPABASE_URL veya SUPABASE_SECRET_KEY tanımlı değil. ' +
      'Vercel > Project > Settings > Environment Variables bölümüne ekleyin.'
    );
  }
}

// ---- Supabase istemcileri (modül düzeyinde: sıcak çağrılarda tekrar kullanılır) ----
// Veri istemcisi (service_role) — SADECE veritabanı işlemleri için. Auth çağrısı YAPILMAZ.
let _supabase = null;
function veriIstemci() {
  ortamKontrol();
  if (!_supabase) {
    _supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}
// Kimlik doğrulama istemcisi (anon) — yalnız berber JWT'sini doğrulamak için.
let _supabaseAuth = null;
function authIstemci() {
  ortamKontrol();
  if (!_supabaseAuth) {
    _supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabaseAuth;
}

const TABLO = 'randevular';

// Gelen isteğin "Authorization: Bearer <token>" başlığındaki berber oturumunu
// doğrula. Geçerliyse kullanıcıyı döndürür, değilse null.
async function kullaniciDogrula(req) {
  const baslik = req.headers['authorization'] || '';
  const token = baslik.startsWith('Bearer ') ? baslik.slice(7) : '';
  if (!token) return null;
  const { data, error } = await authIstemci().auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

// ==========================================================
// BERBER AYARLARI — çalışma saatleri ve hizmet süreleri
// ==========================================================
const ACILIS  = 8 * 60;        // 08:00
const KAPANIS = 18 * 60 + 30;  // 18:30
const ADIM    = 15;            // randevu başlangıçları 15 dk aralıklarla

const SURELER = {
  'Coupe de cheveux': 30,
  'Barbe & Rasage':   15,
  'Cheveux + Barbe':  45,
};

// Kuaförler — müşteri randevu alırken birini seçer.
const KUAFORLER = ['Cebrail', 'Ahmet'];

// Her hizmetin fiyatı (CHF).
const FIYATLAR = {
  'Coupe de cheveux': 25,
  'Barbe & Rasage':   15,
  'Cheveux + Barbe':  40,
};

// İsim -> barber_id haritası (tembel yüklenir + önbelleğe alınır).
let berberHarita = null;
async function berberIdBul(isim) {
  if (!berberHarita) {
    const { data, error } = await veriIstemci().from('berberler').select('id, isim');
    if (error) { console.error('berberler okuma hatası:', error.message); return null; }
    berberHarita = {};
    (data || []).forEach((b) => { berberHarita[b.isim] = b.id; });
  }
  return berberHarita[isim] || null;
}

// ---- Küçük zaman yardımcıları ----
function dakikaToSaat(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
function saatToDakika(s) {
  const [h, d] = s.split(':').map(Number);
  return h * 60 + d;
}
function bugunStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// Belirli bir GÜN + KUAFÖR için dolu zaman aralıklarını Supabase'den çıkar.
async function doluAraliklar(tarih, kuafor) {
  let sorgu = veriIstemci().from(TABLO).select('saat, hizmet, sure').eq('tarih', tarih);
  if (kuafor) sorgu = sorgu.eq('kuafor', kuafor);
  const { data, error } = await sorgu;
  if (error) {
    console.error('Supabase okuma hatası:', error.message);
    return [];
  }
  return (data || []).map((r) => {
    const bas = saatToDakika(r.saat);
    const sure = r.sure || SURELER[r.hizmet] || 30;
    return [bas, bas + sure];
  });
}

// Bir gün + hizmet süresi + KUAFÖR için MÜSAİT başlangıç saatlerini hesapla.
async function musaitSaatler(tarih, sure, kuafor) {
  const dolu = await doluAraliklar(tarih, kuafor);
  const buGun = tarih === bugunStr();
  const simdi = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();

  const sonuc = [];
  for (let t = ACILIS; t + sure <= KAPANIS; t += ADIM) {
    if (buGun && t <= simdi) continue;
    const cakisiyor = dolu.some(([b, e]) => t < e && b < t + sure);
    if (!cakisiyor) sonuc.push(dakikaToSaat(t));
  }
  return sonuc;
}

// POST gövdesini JSON olarak oku (Vercel gövdeyi ayrıştırmadıysa akıştan okur).
async function govdeOku(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return req.body ? JSON.parse(req.body) : {};
    }
    return req.body; // Vercel zaten JSON olarak ayrıştırmışsa
  }
  const parcalar = [];
  for await (const parca of req) parcalar.push(parca);
  const ham = Buffer.concat(parcalar).toString('utf8');
  return ham ? JSON.parse(ham) : {};
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TABLO,
  SURELER,
  KUAFORLER,
  FIYATLAR,
  veriIstemci,
  kullaniciDogrula,
  berberIdBul,
  musaitSaatler,
  govdeOku,
};
