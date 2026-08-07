// ==========================================================
// CECE BARBER — Küçük hareketler (JavaScript)
// Şimdilik tek bir şey yapıyoruz: menüdeki linklere tıklayınca
// sayfa sertçe zıplamak yerine yumuşakça kaysın.
// ==========================================================

// ---- Hamburger (mobil) menü ----
const hamburger = document.getElementById('hamburger');
const anaMenu = document.getElementById('anaMenu');

function menuKapat() {
  if (anaMenu) anaMenu.classList.remove('acik');
  if (hamburger) { hamburger.classList.remove('acik'); hamburger.setAttribute('aria-expanded', 'false'); }
}
if (hamburger && anaMenu) {
  hamburger.addEventListener('click', function (olay) {
    olay.stopPropagation();
    const acik = anaMenu.classList.toggle('acik');
    hamburger.classList.toggle('acik', acik);
    hamburger.setAttribute('aria-expanded', acik ? 'true' : 'false');
  });
  // Menü dışına tıklayınca kapat
  document.addEventListener('click', function (olay) {
    if (anaMenu.classList.contains('acik') && !anaMenu.contains(olay.target) && olay.target !== hamburger) {
      menuKapat();
    }
  });
}

// ---- Menü linkleri ----
const linkler = document.querySelectorAll('nav a');
linkler.forEach(function (link) {
  link.addEventListener('click', function (olay) {
    const href = this.getAttribute('href');

    // "Prendre rendez-vous" (randevu-ac): modalı aç, sayfayı zıplatma
    if (this.classList.contains('randevu-ac')) {
      olay.preventDefault();
      menuKapat();
      return; // modalı .randevu-ac handler'ı açar
    }
    // Sayfa içi çapa (#hizmetler vb.): yumuşak kaydır
    if (href && href.charAt(0) === '#') {
      olay.preventDefault();
      menuKapat();
      if (href.length > 1) {
        const hedef = document.querySelector(href);
        if (hedef) hedef.scrollIntoView({ behavior: 'smooth' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' }); // "Accueil" -> en üste
      }
      return;
    }
    // Dış link (/admin gibi): normal git, önce menüyü kapat
    menuKapat();
  });
});


// ==========================================================
// RANDEVU PENCERESİ (modal)
// "Randevu Al" butonlarına basınca açılır; hizmet + tarih +
// saat + isim + telefon alınır ve sunucuya kaydedilir.
// ==========================================================

const katman   = document.getElementById('randevuKatman');
const kapatBtn = document.getElementById('randevuKapat');
const form     = document.getElementById('randevuForm');
const saatSec  = document.getElementById('saat');
const tarihGir = document.getElementById('tarih');
const kuaforSecim = document.getElementById('kuaforSecim');
const icerik   = document.getElementById('randevuIcerik');
const basari   = document.getElementById('randevuBasari');
const basariMetin = document.getElementById('basariMetin');
const basariKapat = document.getElementById('basariKapat');

// 1) Tarih alanının en erken günü bugün olsun (geçmişe randevu olmaz).
const bugun = new Date().toISOString().split('T')[0];
tarihGir.min = bugun;

// Saat kutusuna tek satırlık bir bilgi/uyarı yaz.
function saatMesaji(metin) {
  saatSec.innerHTML = '';
  const o = document.createElement('option');
  o.value = '';
  o.disabled = true;
  o.selected = true;
  o.textContent = metin;
  saatSec.appendChild(o);
  saatSec.disabled = true;
}

// 2) Seçili hizmetin süresini (dakika) bul.
function seciliSure() {
  const secili = form.querySelector('input[name="hizmet"]:checked');
  if (!secili) return null;
  return parseInt(secili.dataset.sure, 10) || 30; // data-sure="30 dk"
}

// Seçili kuaförü bul.
function seciliKuafor() {
  const secili = form.querySelector('input[name="kuafor"]:checked');
  return secili ? secili.value : null;
}

// Kuaförleri sunucudan (/api/kuaforler) çek ve seçim düğmelerini oluştur.
async function kuaforleriYukle() {
  try {
    const cevap = await fetch('/api/kuaforler');
    const veri = await cevap.json();
    const liste = veri.kuaforler || [];
    kuaforSecim.innerHTML = '';
    liste.forEach(function (isim) {
      const label = document.createElement('label');
      label.className = 'kuafor-sec';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'kuafor';
      input.value = isim;
      input.required = true;
      const govde = document.createElement('span');
      govde.className = 'kuafor-govde';
      govde.textContent = isim;
      label.appendChild(input);
      label.appendChild(govde);
      kuaforSecim.appendChild(label);
      // Kuaför değişince o kuaförün boş saatlerini yenile
      input.addEventListener('change', saatleriGuncelle);
    });
  } catch (e) {
    kuaforSecim.innerHTML = '<span class="kuafor-yukleniyor">Coiffeurs indisponibles</span>';
  }
}
kuaforleriYukle();

// 3) Kuaför + hizmet + tarih seçilince MÜSAİT saatleri sunucudan çek ve listele.
async function saatleriGuncelle() {
  const kuafor = seciliKuafor();
  const sure = seciliSure();
  const tarih = tarihGir.value;

  if (!kuafor || !sure || !tarih) {
    saatMesaji('Choisissez un coiffeur, un service et une date');
    return;
  }

  saatMesaji('Chargement...');
  try {
    const cevap = await fetch('/api/musaitlik?tarih=' + tarih + '&sure=' + sure + '&kuafor=' + encodeURIComponent(kuafor));
    const veri = await cevap.json();

    if (!veri.saatler || veri.saatler.length === 0) {
      saatMesaji('Aucun horaire disponible ce jour');
      return;
    }

    // Boş saatleri seçeneğe dönüştür
    saatSec.innerHTML = '';
    const bas = document.createElement('option');
    bas.value = '';
    bas.disabled = true;
    bas.selected = true;
    bas.textContent = 'Choisir une heure';
    saatSec.appendChild(bas);

    veri.saatler.forEach(function (saat) {
      const o = document.createElement('option');
      o.value = saat;
      o.textContent = saat;
      saatSec.appendChild(o);
    });
    saatSec.disabled = false;
  } catch (e) {
    saatMesaji('Impossible de charger les horaires');
  }
}

// Hizmet değişince (süre değişir) ve tarih değişince saatleri yenile.
form.querySelectorAll('input[name="hizmet"]').forEach(function (r) {
  r.addEventListener('change', saatleriGuncelle);
});
tarihGir.addEventListener('change', saatleriGuncelle);

// 3) Pencereyi aç / kapat
function pencereyiAc(secilenHizmet) {
  katman.hidden = false;
  document.body.style.overflow = 'hidden'; // arkadaki sayfa kaymasın

  // Kart üzerindeki butondan gelindiyse ilgili hizmeti önceden seç
  if (secilenHizmet) {
    const radyo = form.querySelector('input[name="hizmet"][value="' + secilenHizmet + '"]');
    if (radyo) radyo.checked = true;
  }
  // Saat kutusunu duruma göre hazırla
  saatleriGuncelle();
}
function pencereyiKapat() {
  katman.hidden = true;
  document.body.style.overflow = '';
  // Formu başa döndür
  icerik.hidden = false;
  basari.hidden = true;
  form.reset();
}

// "Randevu Al" yazan tüm butonlar
document.querySelectorAll('.randevu-ac').forEach(function (btn) {
  btn.addEventListener('click', function () {
    pencereyiAc(this.dataset.hizmet); // varsa data-hizmet ile önseçim
  });
});

kapatBtn.addEventListener('click', pencereyiKapat);
basariKapat.addEventListener('click', pencereyiKapat);

// Karartı alana (kutunun dışına) tıklayınca kapat
katman.addEventListener('click', function (olay) {
  if (olay.target === katman) pencereyiKapat();
});
// ESC tuşu ile kapat
document.addEventListener('keydown', function (olay) {
  if (olay.key === 'Escape' && !katman.hidden) pencereyiKapat();
});

// 4) Form gönderilince randevuyu oluştur
form.addEventListener('submit', async function (olay) {
  olay.preventDefault();

  const veri = {
    kuafor: seciliKuafor(),
    hizmet: form.hizmet.value,
    tarih:  form.tarih.value,
    saat:   form.saat.value,
    ad:     form.ad.value.trim(),
    tel:    form.tel.value.trim(),
  };

  // Sunucuya kaydet (sunucu.js /api/randevu ucu).
  try {
    const cevap = await fetch('/api/randevu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(veri),
    });
    const sonuc = await cevap.json();

    // Saat az önce başkası tarafından alındıysa (409): uyar ve saatleri tazele.
    if (!sonuc.ok) {
      alert(sonuc.hata || 'Rendez-vous impossible, veuillez réessayer.');
      await saatleriGuncelle();
      return;
    }
  } catch (e) {
    alert('Serveur inaccessible. Veuillez réessayer plus tard.');
    console.warn('Randevu kaydedilemedi:', e);
    return;
  }

  // Başarı ekranını göster
  const tarihGosterim = new Date(veri.tarih).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  basariMetin.innerHTML =
    '<strong>' + veri.ad + '</strong>, votre rendez-vous est confirmé :<br>' +
    veri.hizmet + ' (' + seciliSure() + ' min) avec <strong>' + veri.kuafor + '</strong><br>' +
    tarihGosterim + ' — ' + veri.saat;

  icerik.hidden = true;
  basari.hidden = false;
});
