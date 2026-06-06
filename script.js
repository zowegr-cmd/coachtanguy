// ===== Menu mobile =====
const burger = document.getElementById('burger');
const navLinks = document.getElementById('navLinks');
if (burger && navLinks) {
  burger.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    burger.classList.toggle('open');
  });
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      burger.classList.remove('open');
    });
  });
}

// ===== Nav adaptative (claire sur fond clair, sombre sur fond sombre) =====
const nav = document.querySelector('.nav');
if (nav) {
  const adaptive = document.body.classList.contains('has-hero');
  const darkBlocks = adaptive
    ? document.querySelectorAll('.darkzone, .phero, .section--dark, .cta, .footer, .confirm')
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
  var TRANSLATED = ['index.html', 'contact.html', 'coaching-visio.html', 'suivi-en-ligne.html'];
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
    // (Brancher ici l'envoi réel : email, API, etc.)
    window.location.href = 'confirmation.html';
  });
}

// ===== Bouton WhatsApp flottant (FAB) sur toutes les pages =====
(function () {
  var WA_NUMBER = '32470000000'; // ⬅️ remplace par ton vrai numéro WhatsApp (format international, sans +)
  var LABELS = { fr: 'Une question ?', nl: 'Een vraag?', en: 'A question?' };
  if (document.querySelector('.wa-fab')) return;
  var lang = document.documentElement.lang || 'fr';
  var label = LABELS[lang] || LABELS.fr;
  var SVG = '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.414Z"/></svg>';
  var a = document.createElement('a');
  a.className = 'wa-fab';
  a.href = 'https://wa.me/' + WA_NUMBER;
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Contacter sur WhatsApp');
  a.innerHTML = '<span class="wa-fab__label">' + label + '</span><span class="wa-fab__icon">' + SVG + '</span>';
  document.body.appendChild(a);
})();
