// Basit yerel web sunucusu — siteyi localhost:8000 adresinde açar.
// Randevular Supabase veritabanında saklanır (dosya değil).
const http = require('http');
const fs = require('fs');
const path = require('path');

const KLASOR = __dirname;
const PORT = process.env.PORT || 8000;

// ---- .env dosyasını yükle (varsa) ----
// Render gibi ortamlarda değişkenler panelden gelir; yerelde .env'den okunur.
(function ortamYukle() {
  const yol = path.join(KLASOR, '.env');
  if (!fs.existsSync(yol)) return;
  for (const satir of fs.readFileSync(yol, 'utf8').split('\n')) {
    const t = satir.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const anahtar = t.slice(0, i).trim();
    let deger = t.slice(i + 1).trim();
    if ((deger.startsWith('"') && deger.endsWith('"')) ||
        (deger.startsWith("'") && deger.endsWith("'"))) {
      deger = deger.slice(1, -1);
    }
    if (!(anahtar in process.env)) process.env[anahtar] = deger;
  }
})();

// ---- Supabase istemcisi (yalnız sunucu tarafı, secret anahtar) ----
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('HATA: SUPABASE_URL veya SUPABASE_SECRET_KEY tanımlı değil (.env dosyasına bakın).');
  process.exit(1);
}
// Veri istemcisi (service_role) — SADECE veritabanı işlemleri için kullanılır.
// Üzerinde auth çağrısı YAPILMAZ; yoksa yetki başlığı değişir ve RLS'e takılır.
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Kimlik doğrulama istemcisi (anon) — yalnız berber JWT'sini doğrulamak için.
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const TABLO = 'randevular';

// Gelen isteğin "Authorization: Bearer <token>" başlığındaki berber oturumunu
// doğrula. Geçerliyse kullanıcıyı döndürür, değilse null.
async function kullaniciDogrula(req) {
  const baslik = req.headers['authorization'] || '';
  const token = baslik.startsWith('Bearer ') ? baslik.slice(7) : '';
  if (!token) return null;
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

const tipler = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
};

// ==========================================================
// BERBER AYARLARI — çalışma saatleri ve hizmet süreleri
// ==========================================================
const ACILIS  = 8 * 60;        // 08:00  (dakika cinsinden = 480)
const KAPANIS = 18 * 60 + 30;  // 18:30  (dakika cinsinden = 1110)
const ADIM    = 15;            // randevu başlangıçları 15 dk aralıklarla

// Her hizmetin kaç dakika sürdüğü:
const SURELER = {
  'Coupe de cheveux': 30,
  'Barbe & Rasage':   15,
  'Cheveux + Barbe':  45,
};

// Kuaförler — müşteri randevu alırken birini seçer, her biri kendi takvimini tutar.
const KUAFORLER = ['Cebrail', 'Ahmet'];

// Her hizmetin fiyatı (CHF) — ciro hesabı için randevuya yazılır.
const FIYATLAR = {
  'Coupe de cheveux': 25,
  'Barbe & Rasage':   15,
  'Cheveux + Barbe':  40,
};

// İsim -> barber_id haritası (berberler tablosundan, tembel yüklenir + önbelleğe alınır).
let berberHarita = null;
async function berberIdBul(isim) {
  if (!berberHarita) {
    const { data, error } = await supabase.from('berberler').select('id, isim');
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
// Her randevu, kendi hizmet süresi kadar yer kaplar. -> [ [bas, bit], ... ]
async function doluAraliklar(tarih, kuafor) {
  let sorgu = supabase.from(TABLO).select('saat, hizmet, sure').eq('tarih', tarih);
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
// Kurallar: 08:00–18:30 arası, hizmet kapanıştan önce bitmeli,
// SEÇİLEN KUAFÖRÜN mevcut randevularıyla çakışmamalı, bugün ise geçmiş saatler gösterilmez.
async function musaitSaatler(tarih, sure, kuafor) {
  const dolu = await doluAraliklar(tarih, kuafor);
  const buGun = tarih === bugunStr();
  const simdi = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();

  const sonuc = [];
  for (let t = ACILIS; t + sure <= KAPANIS; t += ADIM) {
    // Bugünse ve saat geçmişse atla
    if (buGun && t <= simdi) continue;
    // Mevcut bir randevuyla çakışıyor mu? (yeni [t, t+sure] ile örtüşme)
    const cakisiyor = dolu.some(([b, e]) => t < e && b < t + sure);
    if (!cakisiyor) sonuc.push(dakikaToSaat(t));
  }
  return sonuc;
}

http.createServer(async (req, res) => {
  const parcalar = req.url.split('?');
  let dosya = decodeURIComponent(parcalar[0]);
  const sorgu = new URLSearchParams(parcalar[1] || '');

  // ---- Ayar ucu ----
  // Admin sayfası, tarayıcıda Supabase Auth için genel (public) bilgileri buradan alır.
  if (req.method === 'GET' && dosya === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY || '' }));
    return;
  }

  // ---- Randevu listesi ucu (KORUMALI — berber girişi gerekli) ----
  // Admin sayfası, giriş yapmış berberin JWT'siyle tüm randevuları buradan ister.
  if (req.method === 'GET' && dosya === '/api/randevular') {
    const user = await kullaniciDogrula(req);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, hata: 'Yetkisiz' }));
      return;
    }
    // Bu hesap hangi kuaföre bağlı? (createUser sırasında user_metadata.kuafor'a yazılır)
    const kuafor = (user.user_metadata && user.user_metadata.kuafor) || null;

    let sorgu = supabase
      .from(TABLO)
      .select('id, hizmet, tarih, saat, kuafor, ad, tel, sure, olusturma')
      .order('tarih', { ascending: true })
      .order('saat', { ascending: true });
    // Kuaföre bağlı hesap yalnızca kendi randevularını görür.
    if (kuafor) sorgu = sorgu.eq('kuafor', kuafor);

    const { data, error } = await sorgu;
    if (error) {
      console.error('Supabase liste hatası:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, hata: 'Erreur serveur' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, kuafor: kuafor, randevular: data || [] }));
    return;
  }

  // ---- Favicon (tarayıcı otomatik ister; 204 ile sessizce geç) ----
  if (dosya === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- Kuaför listesi ucu ----
  // Rezervasyon formu, seçilebilir kuaförleri buradan alır (tek kaynak: KUAFORLER).
  if (req.method === 'GET' && dosya === '/api/kuaforler') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ kuaforler: KUAFORLER }));
    return;
  }

  // ---- MÜSAİTLİK ucu ----
  // Site, seçilen tarih + hizmet süresine göre boş saatleri buradan ister.
  if (req.method === 'GET' && dosya === '/api/musaitlik') {
    const tarih = sorgu.get('tarih');
    const kuafor = sorgu.get('kuafor');
    const sure = parseInt(sorgu.get('sure'), 10) || 30;
    // Kuaför seçilmemiş ya da tanınmıyorsa boş dön (müşteri önce kuaför seçmeli).
    const saatler = (tarih && KUAFORLER.includes(kuafor))
      ? await musaitSaatler(tarih, sure, kuafor)
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ saatler }));
    return;
  }

  // ---- Randevu kaydetme ucu ----
  if (req.method === 'POST' && dosya === '/api/randevu') {
    let govde = '';
    req.on('data', (parca) => (govde += parca));
    req.on('end', async () => {
      try {
        const randevu = JSON.parse(govde);

        // Basit doğrulama
        if (!randevu.hizmet || !randevu.tarih || !randevu.saat || !randevu.ad || !randevu.tel) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, hata: 'Champs manquants' }));
          return;
        }
        // Geçerli bir kuaför seçilmiş mi?
        if (!KUAFORLER.includes(randevu.kuafor)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, hata: 'Veuillez choisir un coiffeur.' }));
          return;
        }

        const sure = SURELER[randevu.hizmet] || 30;

        // Çift randevu engeli: seçilen kuaförde o saat hâlâ boş mu?
        const musait = await musaitSaatler(randevu.tarih, sure, randevu.kuafor);
        if (!musait.includes(randevu.saat)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, hata: 'Cet horaire vient d\'être pris, veuillez en choisir un autre.' }));
          return;
        }

        const barberId = await berberIdBul(randevu.kuafor);

        const { error } = await supabase.from(TABLO).insert({
          hizmet: randevu.hizmet,
          tarih:  randevu.tarih,
          saat:   randevu.saat,
          kuafor: randevu.kuafor,
          barber_id: barberId,
          durum:  'en_attente',                 // online randevu -> berber onayı bekler
          fiyat:  FIYATLAR[randevu.hizmet] || 0,
          ad:     String(randevu.ad).trim(),
          tel:    String(randevu.tel).trim(),
          sure:   sure,
          olusturma: new Date().toISOString(),
        });

        if (error) {
          // 23505 = unique ihlali -> saat aynı anda başkası tarafından alındı
          if (error.code === '23505') {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, hata: 'Cet horaire vient d\'être pris, veuillez en choisir un autre.' }));
            return;
          }
          console.error('Supabase yazma hatası:', error.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, hata: 'Erreur serveur' }));
          return;
        }

        console.log('Yeni randevu:', randevu.ad, '-', randevu.hizmet, randevu.tarih, randevu.saat);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, hata: 'Données invalides' }));
      }
    });
    return;
  }

  if (dosya === '/') dosya = '/index.html';
  if (dosya === '/admin' || dosya === '/admin/') dosya = '/admin.html';
  const tamYol = path.join(KLASOR, dosya);

  fs.readFile(tamYol, (hata, veri) => {
    if (hata) {
      res.writeHead(404);
      res.end('Sayfa bulunamadi');
      return;
    }
    const uzanti = path.extname(tamYol).toLowerCase();
    res.writeHead(200, { 'Content-Type': tipler[uzanti] || 'application/octet-stream' });
    res.end(veri);
  });
}).listen(PORT, () => {
  console.log('Site calisiyor: http://localhost:' + PORT);
});
