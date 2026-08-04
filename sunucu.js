// Basit yerel web sunucusu — siteyi localhost:8000 adresinde açar.
const http = require('http');
const fs = require('fs');
const path = require('path');

const KLASOR = __dirname;
const PORT = process.env.PORT || 8000;
const KAYIT_YOLU = path.join(KLASOR, 'randevular.json');

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

// randevular.json'u oku (yoksa boş liste)
function randevulariOku() {
  if (!fs.existsSync(KAYIT_YOLU)) return [];
  try { return JSON.parse(fs.readFileSync(KAYIT_YOLU, 'utf8') || '[]'); }
  catch (e) { return []; }
}

// Belirli bir GÜN için dolu zaman aralıklarını çıkar.
// Her randevu, kendi hizmet süresi kadar yer kaplar. -> [ [bas, bit], ... ]
function doluAraliklar(tarih) {
  return randevulariOku()
    .filter((r) => r.tarih === tarih)
    .map((r) => {
      const bas = saatToDakika(r.saat);
      const sure = SURELER[r.hizmet] || 30;
      return [bas, bas + sure];
    });
}

// Bir gün + hizmet süresi için MÜSAİT başlangıç saatlerini hesapla.
// Kurallar: 08:30–18:30 arası, hizmet kapanıştan önce bitmeli,
// mevcut randevularla çakışmamalı, bugün ise geçmiş saatler gösterilmez.
function musaitSaatler(tarih, sure) {
  const dolu = doluAraliklar(tarih);
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

http.createServer((req, res) => {
  const parcalar = req.url.split('?');
  let dosya = decodeURIComponent(parcalar[0]);
  const sorgu = new URLSearchParams(parcalar[1] || '');

  // ---- MÜSAİTLİK ucu ----
  // Site, seçilen tarih + hizmet süresine göre boş saatleri buradan ister.
  if (req.method === 'GET' && dosya === '/api/musaitlik') {
    const tarih = sorgu.get('tarih');
    const sure = parseInt(sorgu.get('sure'), 10) || 30;
    const saatler = tarih ? musaitSaatler(tarih, sure) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ saatler }));
    return;
  }

  // ---- Randevu kaydetme ucu ----
  if (req.method === 'POST' && dosya === '/api/randevu') {
    let govde = '';
    req.on('data', (parca) => (govde += parca));
    req.on('end', () => {
      try {
        const randevu = JSON.parse(govde);
        const sure = SURELER[randevu.hizmet] || 30;

        // Çift randevu engeli: seçilen saat hâlâ boş mu?
        const musait = musaitSaatler(randevu.tarih, sure);
        if (!musait.includes(randevu.saat)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, hata: 'Cet horaire vient d\'être pris, veuillez en choisir un autre.' }));
          return;
        }

        randevu.sure = sure;
        randevu.olusturma = new Date().toISOString();

        const liste = randevulariOku();
        liste.push(randevu);
        fs.writeFileSync(KAYIT_YOLU, JSON.stringify(liste, null, 2));

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
