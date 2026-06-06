/* ===========================================================
   Moteur de contenu i18n — CoachTanguy
   Applique window.SITE_CONTENT aux éléments [data-i18n*].
   Si le dashboard a enregistré un aperçu (localStorage), il est prioritaire.
   Fonctionne en file:// (pas de fetch).
   =========================================================== */
(function () {
  function deepGet(obj, path) {
    return path.split('.').reduce(function (a, k) {
      return (a && a[k] != null) ? a[k] : undefined;
    }, obj);
  }

  var lang = document.documentElement.lang || 'fr';
  var content = window.SITE_CONTENT || {};

  // Aperçu live depuis le dashboard (même navigateur)
  try {
    var raw = localStorage.getItem('SITE_CONTENT_' + lang);
    if (raw) content = JSON.parse(raw);
  } catch (e) {}

  function setText(attr, fn) {
    document.querySelectorAll('[' + attr + ']').forEach(function (el) {
      var v = deepGet(content, el.getAttribute(attr));
      if (v != null) fn(el, v);
    });
  }

  function apply() {
    setText('data-i18n', function (el, v) { el.textContent = v; });
    setText('data-i18n-html', function (el, v) { el.innerHTML = v; });
    setText('data-i18n-href', function (el, v) { el.setAttribute('href', v); });
    setText('data-i18n-ph', function (el, v) { el.setAttribute('placeholder', v); });
  }

  if (document.readyState !== 'loading') apply();
  else document.addEventListener('DOMContentLoaded', apply);

  window.__siteContent = content;
  window.__applyContent = apply;
})();
