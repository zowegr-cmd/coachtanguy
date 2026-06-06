/* ============================================================
   PWA — installation + mini-tutoriel (CoachTanguy Calculateur)
   - enregistre le service worker
   - Android/Chromium : capte beforeinstallprompt -> bouton "Installer"
   - iOS Safari : bouton -> instructions (pas de prompt possible)
   - Desktop / déjà installé : rien d'intrusif
   Ne s'exécute PAS quand le calculateur est embarqué dans l'iframe du site.
   ============================================================ */
(function () {
  if (window.self !== window.top) return; // pas dans l'iframe du site intégré

  /* 1) Service worker (offline) */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/calculateur/sw.js', { scope: '/calculateur/' }).catch(function () {});
    });
  }

  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return; // déjà installée -> ne rien afficher

  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /android/i.test(ua);
  var deferredPrompt = null;

  /* 2) Styles (au thème du site) */
  var style = document.createElement('style');
  style.textContent = [
    '.pwa-dock{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9998;display:none;flex-direction:column;align-items:center;gap:7px;font-family:"Sora",-apple-system,sans-serif}',
    '.pwa-dock.show{display:flex;animation:pwaUp .4s cubic-bezier(.22,1,.36,1)}',
    '@keyframes pwaUp{from{opacity:0;transform:translateX(-50%) translateY(14px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
    '.pwa-btn{display:inline-flex;align-items:center;gap:9px;font-weight:700;font-size:15px;color:#fff;background:#ff5a00;border:none;border-radius:999px;padding:13px 22px;box-shadow:0 12px 28px rgba(255,90,0,.45);cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.pwa-btn:active{transform:translateY(1px)}',
    '.pwa-btn svg{width:18px;height:18px}',
    '.pwa-how{background:rgba(0,0,0,.45);border:none;color:rgba(255,255,255,.8);font-family:inherit;font-size:12.5px;padding:5px 12px;border-radius:999px;text-decoration:none;cursor:pointer;backdrop-filter:blur(6px)}',
    '.pwa-modal{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.62);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);font-family:"Sora",-apple-system,sans-serif}',
    '.pwa-modal.show{display:flex}',
    '.pwa-card{width:100%;max-width:430px;background:#141519;border:1px solid rgba(255,255,255,.1);border-radius:22px;padding:24px 24px 22px;color:#f4f4f5;box-shadow:0 24px 60px rgba(0,0,0,.6);max-height:90vh;overflow:auto}',
    '.pwa-card h3{font-size:20px;font-weight:800;margin:0 0 4px;padding-right:28px}',
    '.pwa-card .pwa-sub{color:#a1a1aa;font-size:13.5px;margin:0 0 18px;line-height:1.5}',
    '.pwa-close{position:absolute;background:none;border:none;color:#a1a1aa;font-size:26px;cursor:pointer;line-height:1;margin-top:-4px;margin-left:8px}',
    '.pwa-steps{margin:0;padding:0;list-style:none}',
    '.pwa-step{display:flex;gap:14px;align-items:flex-start;margin:15px 0}',
    '.pwa-step .n{flex:0 0 30px;width:30px;height:30px;border-radius:50%;background:rgba(255,90,0,.15);color:#ff5a00;font-weight:800;display:grid;place-items:center;font-size:14px}',
    '.pwa-step .t{font-size:14.5px;line-height:1.55;padding-top:3px}',
    '.pwa-step .t b{color:#fff}',
    '.pwa-ic{display:inline-flex;vertical-align:-3px;color:#ff5a00;margin:0 1px}',
    '.pwa-foot{margin-top:18px;font-size:12px;color:#71717a;text-align:center}',
    '.pwa-foot a{color:#ff5a00;text-decoration:none}'
  ].join('');
  document.head.appendChild(style);

  /* Icônes inline (partage iOS, télécharger, ⋮) */
  var icShare = '<svg class="pwa-ic" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
  var icPlus = '<svg class="pwa-ic" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 9v6M9 12h6"/></svg>';
  var icDots = '<svg class="pwa-ic" viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  var icDown = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>';

  /* 3) Contenu du tutoriel selon l'appareil */
  function stepsHTML() {
    if (isIOS) {
      return '<h3>Installer l’application</h3>'
        + '<p class="pwa-sub">Sur iPhone / iPad, en 3 étapes depuis Safari :</p>'
        + '<ul class="pwa-steps">'
        + '<li class="pwa-step"><span class="n">1</span><span class="t">Appuyez sur le bouton <b>Partager</b> ' + icShare + ' en bas de l’écran.</span></li>'
        + '<li class="pwa-step"><span class="n">2</span><span class="t">Faites défiler puis choisissez <b>« Sur l’écran d’accueil »</b> ' + icPlus + '.</span></li>'
        + '<li class="pwa-step"><span class="n">3</span><span class="t">Appuyez sur <b>« Ajouter »</b> en haut à droite. C’est fait ✓</span></li>'
        + '</ul>';
    }
    if (isAndroid) {
      return '<h3>Installer l’application</h3>'
        + '<p class="pwa-sub">Sur Android, depuis Chrome :</p>'
        + '<ul class="pwa-steps">'
        + '<li class="pwa-step"><span class="n">1</span><span class="t">Appuyez sur <b>« Installer l’application »</b> ci-dessous.</span></li>'
        + '<li class="pwa-step"><span class="n">2</span><span class="t">Sinon, ouvrez le menu <b>⋮</b> ' + icDots + ' puis <b>« Installer l’application »</b> (ou « Ajouter à l’écran d’accueil »).</span></li>'
        + '<li class="pwa-step"><span class="n">3</span><span class="t">Confirmez avec <b>« Installer »</b>. C’est fait ✓</span></li>'
        + '</ul>';
    }
    return '<h3>Installer l’application</h3>'
      + '<p class="pwa-sub">Ouvrez cette page sur votre téléphone pour l’ajouter à l’écran d’accueil :</p>'
      + '<ul class="pwa-steps">'
      + '<li class="pwa-step"><span class="n">i</span><span class="t"><b>iPhone (Safari)</b> : bouton <b>Partager</b> ' + icShare + ' → <b>« Sur l’écran d’accueil »</b> → <b>Ajouter</b>.</span></li>'
      + '<li class="pwa-step"><span class="n">A</span><span class="t"><b>Android (Chrome)</b> : <b>« Installer l’application »</b> ou menu <b>⋮</b> ' + icDots + ' → <b>« Installer »</b>.</span></li>'
      + '</ul>';
  }

  /* 4) DOM : bouton + modale */
  var dock = document.createElement('div');
  dock.className = 'pwa-dock';
  dock.innerHTML =
    '<button class="pwa-btn" id="pwaInstallBtn" type="button">' + icDown + ' Installer l’application</button>'
    + '<button class="pwa-how" id="pwaHow" type="button">Comment installer ?</button>';
  document.body.appendChild(dock);

  var modal = document.createElement('div');
  modal.className = 'pwa-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML =
    '<div class="pwa-card"><button class="pwa-close" id="pwaClose" aria-label="Fermer">&times;</button>'
    + '<div id="pwaSteps">' + stepsHTML() + '</div>'
    + '<p class="pwa-foot">Guide complet : <a href="/calculateur/installer.html">coachtanguy.com/calculateur/installer</a></p></div>';
  document.body.appendChild(modal);

  var btn = document.getElementById('pwaInstallBtn');
  var howBtn = document.getElementById('pwaHow');
  var closeBtn = document.getElementById('pwaClose');

  function openModal() { modal.classList.add('show'); }
  function closeModal() { modal.classList.remove('show'); }
  howBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  /* 5) Logique d'affichage du bouton */
  if (isIOS) {
    // iOS : pas de prompt -> le bouton ouvre les instructions
    btn.addEventListener('click', openModal);
    dock.classList.add('show');
  } else {
    // Android / Chromium desktop : on attend l'événement d'installabilité
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      // On n'affiche le bouton flottant que sur mobile (pertinence). Desktop : discret.
      if (isAndroid) dock.classList.add('show');
    });
    btn.addEventListener('click', function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function () { deferredPrompt = null; dock.classList.remove('show'); });
      } else {
        openModal();
      }
    });
    window.addEventListener('appinstalled', function () { dock.classList.remove('show'); closeModal(); });
  }
})();
