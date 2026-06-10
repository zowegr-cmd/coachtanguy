/* ============================================================
   CONSENT.JS — gestionnaire de consentement cookies (CoachTanguy)
   ------------------------------------------------------------
   ⚠️  DÉSACTIVÉ PAR DÉFAUT : le site n'utilise actuellement AUCUN
   traceur non essentiel, donc aucune bannière n'est nécessaire
   (recommandations cookies de l'APD belge).

   ► COMMENT L'ACTIVER (le jour où tu ajoutes Analytics, un pixel…) :

   1. Passe ENABLED à true ci-dessous.

   2. Dans chaque page, charge ce fichier AVANT tout script de mesure :
        <script src="assets/consent.js"></script>

   3. Neutralise chaque script tiers en le déclarant ainsi
      (type="text/plain" => le navigateur ne l'exécute PAS) :
        <script type="text/plain" data-consent="analytics"
                src="https://exemple.com/analytics.js"></script>
      Il ne sera exécuté qu'APRÈS un consentement explicite.
      (Consentement préalable : rien ne se charge avant le choix.)

   4. Le lien « Cookies » du footer sert de « Gérer les cookies » :
      ajoute-lui  data-consent-manage  pour rouvrir la bannière :
        <a href="cookies.html" data-consent-manage>Cookies</a>

   Conformité intégrée :
   - Refus aussi simple que l'accord (2 boutons identiques).
   - Aucune case pré-cochée, aucun consentement implicite.
   - Choix stocké 6 mois MAXIMUM (puis la bannière revient).
   - Le refus est stocké aussi (on ne re-demande pas à chaque visite).
   ============================================================ */
(function () {
  'use strict';

  /* ----------- CONFIGURATION ----------- */
  var ENABLED = false;                  // ← passe à true pour activer
  var STORAGE_KEY = 'cookie_consent';   // clé localStorage (documentée dans cookies.html)
  var MAX_AGE_DAYS = 180;               // 6 mois maximum (APD)
  var TEXTS = {
    fr: { msg: "Ce site souhaite utiliser des cookies de mesure d'audience. Vous pouvez accepter ou refuser librement.",
          accept: "Accepter", refuse: "Refuser", more: "En savoir plus" },
    nl: { msg: "Deze site wil cookies voor publieksmeting gebruiken. U kan vrij aanvaarden of weigeren.",
          accept: "Aanvaarden", refuse: "Weigeren", more: "Meer info" },
    en: { msg: "This site would like to use audience-measurement cookies. You are free to accept or refuse.",
          accept: "Accept", refuse: "Refuse", more: "Learn more" }
  };
  /* -------------------------------------- */

  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || !raw.ts) return null;
      // expiration : 6 mois max
      if (Date.now() - raw.ts > MAX_AGE_DAYS * 864e5) { localStorage.removeItem(STORAGE_KEY); return null; }
      return raw.value; // 'accepted' | 'refused'
    } catch (e) { return null; }
  }
  function save(value) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ value: value, ts: Date.now() })); } catch (e) {}
  }

  // Exécute les scripts neutralisés (type="text/plain" data-consent)
  function unlock() {
    document.querySelectorAll('script[type="text/plain"][data-consent]').forEach(function (s) {
      var n = document.createElement('script');
      for (var i = 0; i < s.attributes.length; i++) {
        var a = s.attributes[i];
        if (a.name !== 'type' && a.name !== 'data-consent') n.setAttribute(a.name, a.value);
      }
      n.text = s.text;
      s.parentNode.replaceChild(n, s);
    });
  }

  function banner() {
    var lang = (document.documentElement.lang || 'fr').slice(0, 2);
    var t = TEXTS[lang] || TEXTS.fr;
    var cookiesHref = /\/(en|nl)\//.test(location.pathname) ? 'cookies.html' : 'cookies.html';
    var el = document.createElement('div');
    el.id = 'consentBanner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin:0 auto;' +
      'background:#101013;color:#fff;border:1px solid rgba(255,90,0,.4);border-radius:16px;padding:18px 20px;' +
      'box-shadow:0 18px 50px rgba(0,0,0,.45);font:14px/1.5 Inter,system-ui,sans-serif';
    el.innerHTML =
      '<p style="margin:0 0 12px">' + t.msg + ' <a href="' + cookiesHref + '" style="color:#ff5a00">' + t.more + '</a></p>' +
      '<div style="display:flex;gap:10px">' +
      // Refuser et Accepter : même taille, même visibilité (pas de bouton "caché")
      '<button id="consentRefuse" style="flex:1;padding:11px;border-radius:10px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;font-weight:700;cursor:pointer">' + t.refuse + '</button>' +
      '<button id="consentAccept" style="flex:1;padding:11px;border-radius:10px;border:none;background:#ff5a00;color:#fff;font-weight:700;cursor:pointer">' + t.accept + '</button>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById('consentAccept').onclick = function () { save('accepted'); el.remove(); unlock(); };
    document.getElementById('consentRefuse').onclick = function () { save('refused'); el.remove(); };
  }

  function init() {
    if (!ENABLED) return;               // ← site sans traceur : on ne fait RIEN
    var choice = read();
    if (choice === 'accepted') unlock();
    else if (choice === null) banner(); // pas de choix mémorisé → on demande AVANT de charger quoi que ce soit
    // lien « Gérer les cookies » : rouvre la bannière
    document.querySelectorAll('[data-consent-manage]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        localStorage.removeItem(STORAGE_KEY);
        if (!document.getElementById('consentBanner')) banner();
      });
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);

  // API publique (debug / réouverture manuelle)
  window.Consent = { open: banner, read: read, reset: function () { localStorage.removeItem(STORAGE_KEY); } };
})();
