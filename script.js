// ===== Menu mobile =====
const burger = document.getElementById('burger');
const navLinks = document.getElementById('navLinks');
if (burger && navLinks) {
  const setMenu = (open) => {
    navLinks.classList.toggle('open', open);
    burger.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  burger.addEventListener('click', () => setMenu(!navLinks.classList.contains('open')));
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => setMenu(false));
  });
  // Échap ferme le menu
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  // Logo centré en haut du menu mobile (réutilise le logo blanc de la barre)
  if (!navLinks.querySelector('.nav__menu-logo')) {
    const barLogo = document.querySelector('.nav__logo .nav__logo-light') || document.querySelector('.nav__logo img');
    const mlogo = document.createElement('img');
    mlogo.className = 'nav__menu-logo';
    mlogo.src = barLogo ? barLogo.getAttribute('src') : 'assets/logo-white.webp';
    mlogo.alt = 'CoachTanguy';
    mlogo.setAttribute('aria-hidden', 'true');
    navLinks.insertBefore(mlogo, navLinks.firstChild);
  }
}

// ===== Nav adaptative (claire sur fond clair, sombre sur fond sombre) =====
const nav = document.querySelector('.nav');
if (nav) {
  const adaptive = document.body.classList.contains('has-hero');
  const darkBlocks = adaptive
    ? document.querySelectorAll('.darkzone, .phero, .section--dark, .cta, .footer, .confirm, .calc-embed, .payments')
    : [];
  const lineY = 38; // point juste sous le haut de la nav
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 12);
    if (!adaptive) return;
    let overDark = false;
    darkBlocks.forEach((b) => {
      const r = b.getBoundingClientRect();
      if (r.top <= lineY && r.bottom > lineY) overDark = true;
    });
    document.body.classList.toggle('nav-over-dark', overDark);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
}

// ===== Reveal au scroll =====
const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && reveals.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        e.target.style.transitionDelay = `${Math.min(i * 60, 180)}ms`;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  reveals.forEach(el => io.observe(el));
} else {
  reveals.forEach(el => el.classList.add('in'));
}

// ===== FAQ : un seul item ouvert à la fois =====
const faqItems = document.querySelectorAll('.faq__item');
faqItems.forEach(item => {
  item.addEventListener('toggle', () => {
    if (item.open) faqItems.forEach(o => { if (o !== item) o.open = false; });
  });
});

// ===== Sélecteur de langue (FR / NL / EN) =====
(function () {
  var sw = document.getElementById('langSwitch');
  if (!sw) return;
  // Pages disponibles dans /en et /nl (ajoute-les ici quand elles sont traduites)
  var TRANSLATED = ['index.html', 'contact.html', 'coaching-visio.html', 'suivi-en-ligne.html', 'calculateur.html', 'politique-confidentialite.html', 'cookies.html', 'collaboration.html',
    'coach-sportif-rhode-saint-genese.html', 'coach-sportif-uccle.html', 'coach-sportif-waterloo.html',
    'coach-sportif-beersel.html', 'coach-sportif-linkebeek.html', 'coach-sportif-braine-lalleud.html'];
  var cur = document.documentElement.lang || 'fr';
  var file = (location.pathname.split('/').pop() || 'index.html');
  if (!file) file = 'index.html';
  var inLangFolder = /\/(en|nl)\/[^\/]*$/.test(location.pathname);
  sw.querySelectorAll('a[data-lang]').forEach(function (a) {
    var lang = a.getAttribute('data-lang');
    var href;
    if (lang === 'fr') {
      href = inLangFolder ? '../' + file : file;
    } else {
      var exists = TRANSLATED.indexOf(file) >= 0;
      if (inLangFolder) href = '../' + lang + '/' + file;
      else href = exists ? lang + '/' + file : lang + '/index.html';
    }
    a.setAttribute('href', href);
    a.classList.toggle('active', lang === cur);
  });
})();

// ===== Formulaire de contact -> page de confirmation =====
const contactForm = document.getElementById('form');
if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!contactForm.checkValidity()) {
      contactForm.reportValidity();
      return;
    }
    // Envoi via Netlify Forms (capté au déploiement), puis page de confirmation
    const go = () => { window.location.href = '/confirmation.html'; };
    const btn = contactForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = '…'; }
    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(contactForm)).toString()
    }).then(go).catch(go);
  });
}

// ===== Bouton WhatsApp flottant (FAB) sur toutes les pages =====
(function () {
  var WA_NUMBER = '32472761639'; // +32 472 76 16 39
  // Pas de FAB sur la page contact (le WhatsApp y est déjà présent)
  if (/contact\.html(?:$|[?#])/.test(location.pathname + location.search + location.hash) || /\/contact\/?$/.test(location.pathname)) return;
  if (document.querySelector('.wa-fab')) return;
  var SVG = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/></svg>';
  var a = document.createElement('a');
  a.className = 'wa-fab';
  a.href = 'https://wa.me/' + WA_NUMBER;
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Contacter sur WhatsApp');
  a.innerHTML = SVG;
  document.body.appendChild(a);
})();

// ===== Barres "safe area" iOS : peignent l'encoche (haut) et la barre d'accueil (bas) =====
// Safari iOS colore ces zones avec le fond de la page (clair ici) -> bande blanche sur les
// pages sombres. Ces barres fixes les peignent explicitement (hauteur = 0 sans encoche).
(function () {
  if (document.querySelector('.safe-top')) return;
  var t = document.createElement('div'); t.className = 'safe-top'; t.setAttribute('aria-hidden', 'true');
  var b = document.createElement('div'); b.className = 'safe-bottom'; b.setAttribute('aria-hidden', 'true');
  document.body.appendChild(t); document.body.appendChild(b);
})();
