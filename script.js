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
