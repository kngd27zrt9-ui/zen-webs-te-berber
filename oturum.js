// ==========================================================
// CECE BARBER — Ana sayfa oturum linki
// Berber Supabase ile giriş yaptıysa menüdeki link "Tableau de bord"
// olur ve panele götürür; giriş yoksa "Se connecter" gösterir.
// Dashboard tasarımına / RLS'e DOKUNMAZ — sadece linkin metnini değiştirir.
// ==========================================================
(function () {
  const link = document.getElementById('oturumLink');
  if (!link) return;

  // Oturum durumuna göre linkin metnini ayarla ve (gizliyse) görünür yap.
  // Her iki durumda da hedef /admin: giriş yoksa login ekranı, varsa dashboard.
  function uygula(girisVar) {
    link.textContent = girisVar ? 'Tableau de bord' : 'Se connecter';
    link.hidden = false; // flicker'ı önlemek için durum belli olunca açılır
  }

  (async function () {
    try {
      const cfg = await (await fetch('/api/config')).json();
      if (!cfg.url || !cfg.anonKey || !window.supabase) {
        uygula(false);
        return;
      }
      // admin.js ile AYNI ayarlar -> aynı localStorage oturumunu okur.
      const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });

      const { data } = await sb.auth.getSession();
      uygula(!!(data && data.session));

      // Başka sekmede giriş/çıkış olursa linki canlı güncelle.
      sb.auth.onAuthStateChange(function (_olay, session) {
        uygula(!!session);
      });
    } catch (e) {
      // Sunucu/config erişilemezse güvenli varsayılan: "Se connecter".
      uygula(false);
    }
  })();
})();
