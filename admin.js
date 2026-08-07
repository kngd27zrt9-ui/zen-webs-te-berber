// ==========================================================
// CECE BARBER — Dashboard (client-side, RLS ile korumalı)
// Her berber Supabase'e KENDİ JWT'siyle bağlanır; RLS sayesinde
// yalnızca kendi randevularını okur/yazar. Müşteri kayıt olamaz.
// ==========================================================

// ---- Sabitler ----
const SURELER  = { 'Coupe de cheveux': 30, 'Barbe & Rasage': 15, 'Cheveux + Barbe': 45 };
const FIYATLAR = { 'Coupe de cheveux': 25, 'Barbe & Rasage': 15, 'Cheveux + Barbe': 40 };
const HIZMETLER = ['Coupe de cheveux', 'Barbe & Rasage', 'Cheveux + Barbe'];
const ACILIS = 8 * 60, KAPANIS = 18 * 60 + 30, ADIM = 15;
const DURUM_ETK = { en_attente: 'En attente', confirme: 'Confirmé', termine: 'Terminé', absent: 'Absent', annule: 'Annulé' };

// ---- Durum ----
let sb = null;
let benimId = null, benimAd = '', benimMail = '';
let randevular = [];          // RLS ile sadece kendi randevuları
let notlarMap = {};           // tel -> { isim, notlar }
let aktifSec = 'dashboard';
let takvimGorunum = 'ay';
let takvimTarih = new Date(); // referans tarih
let seciliGun = null;
let acikRvId = null;
let acikMusteriTel = null;
let bilinenIdler = null;      // bildirim farkı için { id: durum }
let bildirimler = [];
let okunmamis = 0;

// ---- Kısa DOM yardımcısı ----
const $ = (id) => document.getElementById(id);

// ==========================================================
// BAŞLATMA + KİMLİK
// ==========================================================
async function baslat() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    if (!cfg.url || !cfg.anonKey) throw new Error('config');
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch (e) {
    document.body.innerHTML = '<p style="padding:40px;text-align:center">Configuration indisponible.</p>';
    return;
  }
  const { data } = await sb.auth.getSession();
  if (data.session) { await girisSonrasi(data.session.user); }
  else { ekran('giris'); }
}

function ekran(hangi) {
  $('girisEkran').hidden = hangi !== 'giris';
  $('dashEkran').hidden = hangi !== 'dash';
}

async function girisSonrasi(user) {
  benimId = user.id;
  benimMail = user.email;
  benimAd = (user.user_metadata && user.user_metadata.kuafor) || user.email;
  $('berberAd').textContent = benimAd;
  $('berberMail').textContent = benimMail;
  $('hosgeldin').textContent = 'Bienvenue ' + benimAd + ' 👋';
  ekran('dash');
  await veriYukle(true);
  pollBaslat();
}

// ---- Giriş / çıkış ----
$('girisForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('girisHata').textContent = '';
  const btn = $('girisBtn'); btn.disabled = true; btn.textContent = 'Connexion…';
  const email = $('email').value.trim(), sifre = $('sifre').value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password: sifre });
  btn.disabled = false; btn.textContent = 'Se connecter';
  if (error) { $('girisHata').textContent = 'E-mail ou mot de passe incorrect.'; return; }
  $('girisForm').reset();
  await girisSonrasi(data.user);
});
$('cikisBtn').addEventListener('click', async () => {
  pollDurdur();
  await sb.auth.signOut();
  randevular = []; bilinenIdler = null; bildirimler = [];
  ekran('giris');
});

// ==========================================================
// VERİ YÜKLEME (RLS -> sadece kendi verisi)
// ==========================================================
async function veriYukle(ilk) {
  const [rv, nt] = await Promise.all([
    sb.from('randevular').select('*').order('tarih', { ascending: true }).order('saat', { ascending: true }),
    sb.from('musteri_notlari').select('tel, isim, notlar'),
  ]);
  if (rv.error) { console.error(rv.error.message); return; }
  const eski = bilinenIdler;
  randevular = rv.data || [];
  notlarMap = {};
  (nt.data || []).forEach((n) => { notlarMap[n.tel] = { isim: n.isim, notlar: n.notlar }; });

  // Bildirim farkı (ilk yüklemede sessiz)
  const yeniHarita = {};
  randevular.forEach((r) => { yeniHarita[r.id] = r.durum; });
  if (!ilk && eski) fark(eski, yeniHarita);
  bilinenIdler = yeniHarita;

  render();
}

function fark(eski, yeni) {
  for (const r of randevular) {
    if (!(r.id in eski)) {
      bildirimEkle('Nouveau rendez-vous : ' + r.ad + ' — ' + tarihKisa(r.tarih) + ' ' + r.saat, r.id);
    } else if (eski[r.id] !== 'annule' && yeni[r.id] === 'annule') {
      bildirimEkle('Rendez-vous annulé : ' + r.ad + ' — ' + tarihKisa(r.tarih) + ' ' + r.saat, r.id);
    }
  }
}

// ==========================================================
// SEKME GEÇİŞİ
// ==========================================================
document.querySelectorAll('.dash-nav button').forEach((b) => {
  b.addEventListener('click', () => {
    aktifSec = b.dataset.sec;
    document.querySelectorAll('.dash-nav button').forEach((x) => x.classList.toggle('aktif', x === b));
    document.querySelectorAll('.sec').forEach((s) => s.classList.toggle('aktif', s.id === 'sec-' + aktifSec));
    render();
  });
});

function render() {
  if (aktifSec === 'dashboard') renderDashboard();
  else if (aktifSec === 'takvim') renderTakvim();
  else if (aktifSec === 'musteriler') renderMusteriler();
}

// ==========================================================
// ANA SAYFA
// ==========================================================
function renderDashboard() {
  const bugun = ymd(new Date());
  const aktif = (r) => r.durum !== 'annule';
  const bugunku = randevular.filter((r) => r.tarih === bugun && aktif(r));
  const yaklasan = randevular.filter((r) => r.tarih > bugun && aktif(r));
  const musteriBugun = new Set(bugunku.map((r) => r.tel)).size;
  const ciro = bugunku.filter((r) => r.durum === 'confirme' || r.durum === 'termine')
    .reduce((t, r) => t + (r.fiyat || 0), 0);
  const bekleyen = randevular.filter((r) => r.durum === 'en_attente').length;

  $('statIzgara').innerHTML =
    stat("Aujourd'hui", bugunku.length) +
    stat('À venir', yaklasan.length) +
    stat('Clients (jour)', musteriBugun) +
    stat('Chiffre du jour', ciro + ' <small>CHF</small>') +
    stat('En attente', bekleyen, true);

  $('bugunListe').innerHTML = bugunku.length
    ? bugunku.sort(saatSirala).map(rvKart).join('')
    : '<div class="bos-durum">Aucun rendez-vous aujourd\'hui.</div>';

  const ilkYaklasan = yaklasan.sort((a, b) => (a.tarih + a.saat).localeCompare(b.tarih + b.saat)).slice(0, 8);
  $('yaklasanListe').innerHTML = ilkYaklasan.length
    ? ilkYaklasan.map((r) => rvKart(r, true)).join('')
    : '<div class="bos-durum">Aucun rendez-vous à venir.</div>';

  kartlaraTikla();
}

function stat(etk, deg, vurgu) {
  return '<div class="stat' + (vurgu ? ' vurgu' : '') + '">' +
    '<div class="etk">' + etk + '</div><div class="deg">' + deg + '</div></div>';
}

// ==========================================================
// RANDEVU KARTI
// ==========================================================
function rvKart(r, tarihGoster) {
  const tel = String(r.tel || '').replace(/[^0-9+]/g, '');
  return '<div class="rv ' + (r.durum === 'annule' ? 'iptalli' : '') + '" data-id="' + r.id + '">' +
    '<div class="rv-saat">' + esc(r.saat) + (tarihGoster ? '<small>' + tarihKisa(r.tarih) + '</small>' : '') + '</div>' +
    '<div class="rv-orta">' +
      '<div class="ad">' + esc(r.ad) + '</div>' +
      '<div class="hizmet">' + esc(r.hizmet) + ' · ' + (r.sure || SURELER[r.hizmet] || 30) + ' min · ' + (r.fiyat || 0) + ' CHF</div>' +
    '</div>' +
    '<div class="rv-sag">' +
      '<span class="rozet ' + r.durum + '">' + (DURUM_ETK[r.durum] || r.durum) + '</span>' +
    '</div>' +
  '</div>';
}

function kartlaraTikla() {
  document.querySelectorAll('.rv[data-id], .mini-rv[data-id]').forEach((el) => {
    el.addEventListener('click', () => rvModalAc(el.dataset.id));
  });
}

// ==========================================================
// TAKVİM
// ==========================================================
$('gorunumSec').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    takvimGorunum = b.dataset.g;
    $('gorunumSec').querySelectorAll('button').forEach((x) => x.classList.toggle('aktif', x === b));
    renderTakvim();
  });
});
$('takvimOnceki').addEventListener('click', () => takvimKaydir(-1));
$('takvimSonraki').addEventListener('click', () => takvimKaydir(1));
function takvimKaydir(d) {
  if (takvimGorunum === 'ay') takvimTarih = new Date(takvimTarih.getFullYear(), takvimTarih.getMonth() + d, 1);
  else if (takvimGorunum === 'hafta') takvimTarih = new Date(takvimTarih.getTime() + d * 7 * 864e5);
  else takvimTarih = new Date(takvimTarih.getTime() + d * 864e5);
  renderTakvim();
}

function renderTakvim() {
  if (takvimGorunum === 'ay') renderAy();
  else if (takvimGorunum === 'hafta') renderHafta();
  else renderGun();
}

function gununRandevulari(tarih) {
  return randevular.filter((r) => r.tarih === tarih).sort(saatSirala);
}

// --- Aylık ---
function renderAy() {
  const yil = takvimTarih.getFullYear(), ay = takvimTarih.getMonth();
  $('takvimEtk').textContent = new Date(yil, ay, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const sayim = {};
  randevular.forEach((r) => { if (r.durum !== 'annule') sayim[r.tarih] = (sayim[r.tarih] || 0) + 1; });
  const basOfset = (new Date(yil, ay, 1).getDay() + 6) % 7;
  const gunSayisi = new Date(yil, ay + 1, 0).getDate();
  const bugun = ymd(new Date());

  let h = '<div class="ay-izgara">';
  ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].forEach((g) => h += '<div class="ay-gun-baslik">' + g + '</div>');
  for (let i = 0; i < basOfset; i++) h += '<div class="ay-hucre bos"></div>';
  for (let g = 1; g <= gunSayisi; g++) {
    const t = ymd(new Date(yil, ay, g)), adet = sayim[t] || 0;
    let c = 'ay-hucre';
    if (t === bugun) c += ' bugun';
    if (t === seciliGun) c += ' secili';
    h += '<button class="' + c + '" data-t="' + t + '"><span>' + g + '</span>' + (adet ? '<span class="adet">' + adet + '</span>' : '') + '</button>';
  }
  h += '</div>';
  $('takvimIcerik').innerHTML = h;
  $('takvimIcerik').querySelectorAll('.ay-hucre[data-t]').forEach((el) => {
    el.addEventListener('click', () => { seciliGun = el.dataset.t; renderAy(); ayGunDetay(); });
  });
  ayGunDetay();
}
function ayGunDetay() {
  if (!seciliGun) { $('takvimGunDetay').innerHTML = ''; return; }
  const g = gununRandevulari(seciliGun);
  let h = '<div class="alt-baslik">' + tarihUzun(seciliGun) + '</div>';
  h += g.length ? g.map((r) => rvKart(r)).join('') : '<div class="bos-durum">Aucun rendez-vous.</div>';
  $('takvimGunDetay').innerHTML = h;
  kartlaraTikla();
}

// --- Haftalık ---
function renderHafta() {
  const bas = haftaBasi(takvimTarih);
  const son = new Date(bas.getTime() + 6 * 864e5);
  $('takvimEtk').textContent = bas.getDate() + ' – ' + son.getDate() + ' ' + son.toLocaleDateString('fr-FR', { month: 'short' });
  const bugun = ymd(new Date());
  const gunler = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  let h = '<div class="hafta-izgara">';
  for (let i = 0; i < 7; i++) {
    const d = new Date(bas.getTime() + i * 864e5), t = ymd(d);
    const g = gununRandevulari(t).filter((r) => r.durum !== 'annule');
    h += '<div class="hafta-sutun ' + (t === bugun ? 'bugun' : '') + '">' +
      '<div class="gun-etk">' + gunler[i] + '<b>' + d.getDate() + '</b></div>';
    h += g.map((r) => '<div class="mini-rv ' + r.durum + '" data-id="' + r.id + '"><span class="s">' + esc(r.saat) + '</span> <span class="a">' + esc(r.ad) + '</span></div>').join('');
    h += '</div>';
  }
  h += '</div>';
  $('takvimIcerik').innerHTML = h;
  $('takvimGunDetay').innerHTML = '';
  kartlaraTikla();
}

// --- Günlük ---
function renderGun() {
  const t = ymd(takvimTarih);
  $('takvimEtk').textContent = tarihUzun(t);
  const g = gununRandevulari(t);
  let h = g.length ? g.map((r) => rvKart(r)).join('') : '<div class="bos-durum">Aucun rendez-vous ce jour.</div>';
  $('takvimIcerik').innerHTML = h;
  $('takvimGunDetay').innerHTML = '';
  kartlaraTikla();
}

// ==========================================================
// RANDEVU MODALI + İŞLEMLER
// ==========================================================
function rvModalAc(id) {
  const r = randevular.find((x) => String(x.id) === String(id));
  if (!r) return;
  acikRvId = r.id;
  const tel = String(r.tel || '').replace(/[^0-9+]/g, '');
  $('rvmAd').textContent = r.ad;
  $('rvmTel').textContent = '📞 ' + (r.tel || '');
  $('rvmTel').href = 'tel:' + tel;
  $('rvmHizmet').textContent = r.hizmet;
  $('rvmTarih').textContent = tarihUzun(r.tarih);
  $('rvmSaat').textContent = r.saat;
  $('rvmSure').textContent = (r.sure || SURELER[r.hizmet] || 30) + ' min';
  $('rvmFiyat').textContent = (r.fiyat || 0) + ' CHF';
  $('rvmDurum').innerHTML = '<span class="rozet ' + r.durum + '">' + (DURUM_ETK[r.durum] || r.durum) + '</span>';
  $('rvmNotlar').value = r.notlar || '';

  // Düzenleme alanları
  $('rvmHizmetSec').innerHTML = HIZMETLER.map((s) => '<option ' + (s === r.hizmet ? 'selected' : '') + '>' + s + '</option>').join('');
  $('rvmTarihSec').value = r.tarih;
  $('rvmTarihSec').min = ymd(new Date());
  saatSecenekleriDoldur();

  $('rvModalKatman').hidden = false;
  document.body.style.overflow = 'hidden';
}
function rvModalKapat() { $('rvModalKatman').hidden = true; document.body.style.overflow = ''; acikRvId = null; }
$('rvModalKapat').addEventListener('click', rvModalKapat);
$('rvModalKatman').addEventListener('click', (e) => { if (e.target === $('rvModalKatman')) rvModalKapat(); });

// Hizmet/tarih değişince müsait saatleri (çakışmasız) yenile
$('rvmHizmetSec').addEventListener('change', saatSecenekleriDoldur);
$('rvmTarihSec').addEventListener('change', saatSecenekleriDoldur);

function saatSecenekleriDoldur() {
  const r = randevular.find((x) => x.id === acikRvId);
  if (!r) return;
  const hizmet = $('rvmHizmetSec').value;
  const tarih = $('rvmTarihSec').value;
  const sure = SURELER[hizmet] || 30;
  const musait = musaitSaatler(tarih, sure, acikRvId);
  // Mevcut saat aynı gün+hizmette hâlâ geçerliyse başa ekle
  const hepsi = musait.slice();
  if (tarih === r.tarih && !hepsi.includes(r.saat)) hepsi.unshift(r.saat);
  hepsi.sort();
  $('rvmSaatSec').innerHTML = hepsi.length
    ? hepsi.map((s) => '<option ' + (s === r.saat ? 'selected' : '') + '>' + s + '</option>').join('')
    : '<option value="">Aucun créneau libre</option>';
}

// Müsait başlangıç saatleri (kendi randevularına göre, çakışma kontrolü)
function musaitSaatler(tarih, sure, haricId) {
  const dolu = randevular
    .filter((r) => r.tarih === tarih && r.durum !== 'annule' && r.id !== haricId)
    .map((r) => { const b = saatDk(r.saat); return [b, b + (r.sure || SURELER[r.hizmet] || 30)]; });
  const buGun = tarih === ymd(new Date());
  const simdi = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
  const sonuc = [];
  for (let t = ACILIS; t + sure <= KAPANIS; t += ADIM) {
    if (buGun && t <= simdi) continue;
    if (!dolu.some(([b, e]) => t < e && b < t + sure)) sonuc.push(dk2saat(t));
  }
  return sonuc;
}

// Durum butonları
document.querySelectorAll('.durum-btnlar button').forEach((b) => {
  b.addEventListener('click', () => durumDegistir(b.dataset.durum));
});
async function durumDegistir(durum) {
  if (!acikRvId) return;
  const { error } = await sb.from('randevular').update({ durum }).eq('id', acikRvId);
  if (error) { toast('Erreur: ' + error.message); return; }
  toast('Statut mis à jour : ' + (DURUM_ETK[durum] || durum));
  rvModalKapat();
  await veriYukle();
}

// Kaydet (hizmet/tarih/saat/not değişikliği)
$('rvmKaydet').addEventListener('click', async () => {
  if (!acikRvId) return;
  const hizmet = $('rvmHizmetSec').value;
  const tarih = $('rvmTarihSec').value;
  const saat = $('rvmSaatSec').value;
  const notlar = $('rvmNotlar').value.trim();
  if (!saat) { toast('Choisissez un créneau valide.'); return; }
  // Çakışma güvence kontrolü
  const sure = SURELER[hizmet] || 30;
  if (!musaitSaatler(tarih, sure, acikRvId).includes(saat)) {
    // aynı gün+aynı saat değişmediyse sorun yok; değilse uyar
    const r = randevular.find((x) => x.id === acikRvId);
    if (!(r && r.tarih === tarih && r.saat === saat)) { toast('Ce créneau chevauche un autre rendez-vous.'); return; }
  }
  const guncelle = { hizmet, tarih, saat, notlar, sure, fiyat: FIYATLAR[hizmet] || 0 };
  const { error } = await sb.from('randevular').update(guncelle).eq('id', acikRvId);
  if (error) { toast('Erreur: ' + error.message); return; }
  toast('Rendez-vous mis à jour.');
  rvModalKapat();
  await veriYukle();
});

// ==========================================================
// MÜŞTERİLER
// ==========================================================
$('musteriArama').addEventListener('input', renderMusteriler);
function musteriListesi() {
  const harita = {};
  for (const r of randevular) {
    const k = r.tel || '?';
    if (!harita[k]) harita[k] = { tel: r.tel, isim: r.ad, ziyaret: 0, sonTarih: '', tutar: 0 };
    const m = harita[k];
    m.isim = r.ad; // en güncel isim
    if (r.durum !== 'annule') { m.ziyaret++; if (r.tarih > m.sonTarih) m.sonTarih = r.tarih; }
    if (r.durum === 'termine') m.tutar += (r.fiyat || 0);
  }
  return Object.values(harita).sort((a, b) => (b.sonTarih || '').localeCompare(a.sonTarih || ''));
}
function renderMusteriler() {
  const q = $('musteriArama').value.trim().toLowerCase();
  let liste = musteriListesi();
  if (q) liste = liste.filter((m) => (m.isim || '').toLowerCase().includes(q) || (m.tel || '').includes(q));
  $('musteriListe').innerHTML = liste.length
    ? liste.map((m) => {
        const bas = (m.isim || '?').trim().charAt(0).toUpperCase();
        return '<div class="musteri" data-tel="' + esc(m.tel) + '">' +
          '<div class="musteri-av">' + esc(bas) + '</div>' +
          '<div class="musteri-orta"><div class="ad">' + esc(m.isim) + '</div><div class="tel">' + esc(m.tel) + '</div></div>' +
          '<div class="musteri-sag"><b>' + m.ziyaret + '</b> visite(s)<br>' + (m.sonTarih ? tarihKisa(m.sonTarih) : '—') + '</div>' +
        '</div>';
      }).join('')
    : '<div class="bos-durum">Aucun client.</div>';
  $('musteriListe').querySelectorAll('.musteri[data-tel]').forEach((el) => {
    el.addEventListener('click', () => musteriModalAc(el.dataset.tel));
  });
}

function musteriModalAc(tel) {
  acikMusteriTel = tel;
  const gecmis = randevular.filter((r) => r.tel === tel).sort((a, b) => (b.tarih + b.saat).localeCompare(a.tarih + a.saat));
  const isim = gecmis.length ? gecmis[0].ad : (notlarMap[tel] && notlarMap[tel].isim) || '';
  const ziyaret = gecmis.filter((r) => r.durum !== 'annule').length;
  const son = gecmis.filter((r) => r.durum !== 'annule').map((r) => r.tarih).sort().pop();
  const tutar = gecmis.filter((r) => r.durum === 'termine').reduce((t, r) => t + (r.fiyat || 0), 0);

  $('musmAd').textContent = isim || '(sans nom)';
  $('musmTel').textContent = '📞 ' + tel;
  $('musmTel').href = 'tel:' + String(tel).replace(/[^0-9+]/g, '');
  $('musmZiyaret').textContent = ziyaret;
  $('musmSon').textContent = son ? tarihUzun(son) : '—';
  $('musmTutar').textContent = tutar + ' CHF';
  $('musmNot').value = (notlarMap[tel] && notlarMap[tel].notlar) || '';
  $('musmGecmis').innerHTML = gecmis.map((r) =>
    '<div class="rv ' + (r.durum === 'annule' ? 'iptalli' : '') + '">' +
    '<div class="rv-saat">' + esc(r.saat) + '<small>' + tarihKisa(r.tarih) + '</small></div>' +
    '<div class="rv-orta"><div class="ad">' + esc(r.hizmet) + '</div><div class="hizmet">' + (r.fiyat || 0) + ' CHF</div></div>' +
    '<div class="rv-sag"><span class="rozet ' + r.durum + '">' + (DURUM_ETK[r.durum] || r.durum) + '</span></div></div>'
  ).join('');
  $('musModalKatman').hidden = false;
  document.body.style.overflow = 'hidden';
}
function musModalKapat() { $('musModalKatman').hidden = true; document.body.style.overflow = ''; acikMusteriTel = null; }
$('musModalKapat').addEventListener('click', musModalKapat);
$('musModalKatman').addEventListener('click', (e) => { if (e.target === $('musModalKatman')) musModalKapat(); });

$('musmKaydet').addEventListener('click', async () => {
  if (!acikMusteriTel) return;
  const gecmis = randevular.filter((r) => r.tel === acikMusteriTel);
  const isim = gecmis.length ? gecmis[0].ad : null;
  const { error } = await sb.from('musteri_notlari').upsert(
    { barber_id: benimId, tel: acikMusteriTel, isim, notlar: $('musmNot').value.trim(), guncelleme: new Date().toISOString() },
    { onConflict: 'barber_id,tel' }
  );
  if (error) { toast('Erreur: ' + error.message); return; }
  toast('Note enregistrée.');
  musModalKapat();
  await veriYukle();
});

// ==========================================================
// BİLDİRİMLER
// ==========================================================
function bildirimEkle(metin, id) {
  bildirimler.unshift({ metin, id, zaman: new Date() });
  bildirimler = bildirimler.slice(0, 30);
  okunmamis++;
  zilGuncelle();
  toast(metin);
}
function zilGuncelle() {
  const s = $('zilSayi');
  if (okunmamis > 0) { s.hidden = false; s.textContent = okunmamis; } else { s.hidden = true; }
}
$('zilBtn').addEventListener('click', () => {
  const p = $('bildirimPanel');
  p.hidden = !p.hidden;
  if (!p.hidden) {
    okunmamis = 0; zilGuncelle();
    $('bildirimListe').innerHTML = bildirimler.length
      ? bildirimler.map((b) => '<div class="bildirim" data-id="' + (b.id || '') + '"><span class="nokta">●</span> ' + esc(b.metin) + '<div class="t">' + b.zaman.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</div></div>').join('')
      : '<div class="bos-durum">Aucune notification.</div>';
    $('bildirimListe').querySelectorAll('.bildirim[data-id]').forEach((el) => {
      el.addEventListener('click', () => { if (el.dataset.id) { p.hidden = true; rvModalAc(el.dataset.id); } });
    });
  }
});
document.addEventListener('click', (e) => {
  const p = $('bildirimPanel');
  if (!p.hidden && !p.contains(e.target) && e.target !== $('zilBtn')) p.hidden = true;
});

// ---- Yoklama (30 sn'de bir yeni/iptal randevu) ----
let pollId = null;
function pollBaslat() { pollDurdur(); pollId = setInterval(() => veriYukle(), 30000); }
function pollDurdur() { if (pollId) clearInterval(pollId); pollId = null; }

// ==========================================================
// YARDIMCILAR
// ==========================================================
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function saatDk(s) { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; }
function dk2saat(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function saatSirala(a, b) { return a.saat.localeCompare(b.saat); }
function haftaBasi(d) { const g = (d.getDay() + 6) % 7; const b = new Date(d.getFullYear(), d.getMonth(), d.getDate() - g); return b; }
function parcalaTarih(t) { const [y, ay, g] = t.split('-').map(Number); return new Date(y, ay - 1, g); }
function tarihUzun(t) { return parcalaTarih(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function tarihKisa(t) { return parcalaTarih(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function toast(metin) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = metin;
  $('toastAlan').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

baslat();
