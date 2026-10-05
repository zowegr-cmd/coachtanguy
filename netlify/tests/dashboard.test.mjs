/* Tests du dashboard d'édition : brouillons et publication.
   Lancer :  node --test netlify/tests/*.test.mjs

   Le VRAI script de dashboard.html est exécuté dans Node, avec un faux navigateur minimal
   (faux localStorage conservé d'une visite à l'autre, faux éléments de page, faux réseau).
   Ces tests gardent deux pièges déjà rencontrés :
     - un brouillon qui garde une copie complète du contenu fait revenir d'anciens textes
       à la publication suivante (août 2026, puis octobre 2026) ;
     - une publication partie d'un contenu périmé écrase les mises à jour du site. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lireContenu = (l) => { const w = {}; new Function('window', fs.readFileSync(path.join(RACINE, 'content', l + '.js'), 'utf8'))(w); return w.SITE_CONTENT; };
const objetDe = (texte) => { const w = {}; new Function('window', texte)(w); return w.SITE_CONTENT; };

function fauxStockage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem(k) { k = String(k); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(String(k), String(v)); },
    removeItem(k) { m.delete(String(k)); },
    cles() { return [...m.keys()]; },
    copie() { const o = {}; for (const [k, v] of m) o[k] = v; return o; },
  };
}

function fauxElement(id, attrs) {
  const ecouteurs = {};
  const el = {
    id, attrs: attrs || {}, value: (id === 'page' ? 'index.html' : ''), textContent: '', _html: '', style: {}, src: '', disabled: false, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(n, fn) { (ecouteurs[n] = ecouteurs[n] || []).push(fn); },
    declencher(n, ev) { (ecouteurs[n] || []).forEach((fn) => fn.call(el, ev || {})); },
    getAttribute(n) { return this.attrs[n]; }, setAttribute(n, v) { this.attrs[n] = v; },
    querySelectorAll() { return []; }, querySelector() { return fauxElement('x'); },
    closest() { return fauxElement('x'); }, remove() {}, click() {}, focus() {}, select() {},
    contentWindow: { location: { reload() {} } },
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = v; } });
  return el;
}

/* Une visite du dashboard. opts.ls : stockage du navigateur ; opts.contenus : { fr, nl, en } textes
   des fichiers servis par le site (par défaut ceux du dépôt) ; opts.reponse : réponse de la publication. */
function visite(opts) {
  const html = fs.readFileSync(path.join(RACINE, 'dashboard.html'), 'utf8');
  const partie = html.slice(html.indexOf('<div class="toast"'));
  const els = {}; let champs = {};
  const boutonsLangue = ['fr', 'nl', 'en'].map((l) => fauxElement('lang-' + l, { 'data-lang': l }));
  const boutonsMode = ['site', 'calc'].map((m) => fauxElement('mode-' + m, { 'data-mode': m }));
  const appels = []; const minuteries = []; const confirmations = [];
  const document = {
    documentElement: { lang: 'fr' },
    getElementById(id) { return els[id] || (els[id] = fauxElement(id)); },
    querySelectorAll(sel) {
      if (sel === '.lang[data-lang]') return boutonsLangue;
      if (sel === '.mode') return boutonsMode;
      if (sel === '#fields [data-path]') {
        champs = {}; const h = (els.fields && els.fields._html) || ''; const r = /data-path="([^"]+)"/g; let x; const liste = [];
        while ((x = r.exec(h))) { const e = fauxElement('f', { 'data-path': x[1] }); champs[x[1]] = e; liste.push(e); }
        return liste;
      }
      return [];
    },
    addEventListener() {}, createElement() { return fauxElement('a'); },
  };
  const reponse = opts.reponse || { status: 200, corps: { ok: true, deploy: true } };
  const ctx = {
    document, localStorage: opts.ls, sessionStorage: fauxStockage({ dash_pw: 'x' }),
    location: { origin: 'https://exemple.test', search: '', hostname: 'exemple.test', protocol: 'https:' },
    setTimeout(fn) { minuteries.push(fn); return minuteries.length; }, clearTimeout(id) { if (id) minuteries[id - 1] = null; },
    prompt() { return 'x'; }, confirm(m) { confirmations.push(String(m)); return true; },
    fetch(url, o) { appels.push({ url, o }); return Promise.resolve({ status: reponse.status, ok: reponse.status === 200, json() { return Promise.resolve(reponse.corps); }, text() { return Promise.resolve(JSON.stringify(reponse.corps)); } }); },
    console, JSON, Object, String, Math, Date, Promise, Array, Number, Error, RegExp, encodeURIComponent,
    Blob: function () {}, URL: { createObjectURL() { return ''; } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(partie))) {
    const src = /src="([^"]+)"/.exec(m[1]);
    if (!src) { vm.runInContext(m[2], ctx, { filename: 'dashboard-inline' }); continue; }
    const f = src[1].replace(/\?.*$/, '');
    const langue = /^content\/(fr|nl|en)\.js$/.exec(f);
    const texte = (langue && opts.contenus && opts.contenus[langue[1]]) || fs.readFileSync(path.join(RACINE, f), 'utf8');
    vm.runInContext(texte, ctx, { filename: f });
  }
  const purger = () => { let n = 0; while (minuteries.length && n++ < 50) { minuteries.splice(0, minuteries.length).forEach((fn) => { if (typeof fn === 'function') fn(); }); } };
  purger();
  return {
    nbModifies() { return (((els.fields && els.fields._html) || '').match(/class="field changed"/g) || []).length; },
    editer(chemin, valeur) { const e = champs[chemin]; if (!e) throw new Error('champ absent : ' + chemin); e.value = valeur; e.declencher('input'); purger(); },
    langue(l) { boutonsLangue.find((b) => b.attrs['data-lang'] === l).declencher('click'); purger(); },
    async publier() {
      appels.length = 0; els.publish.declencher('click');
      const p = appels.find((a) => /dash-publish/.test(a.url));
      await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); purger();
      return p ? JSON.parse(p.o.body) : null;
    },
    message() { return els.toast ? els.toast.textContent : ''; },
    confirmations,
    cliquerPublier() { appels.length = 0; els.publish.declencher('click'); return appels.find((a) => /dash-publish/.test(a.url)); },
    async finirEnvoi() { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); purger(); },
  };
}

const texteDepot = (l) => fs.readFileSync(path.join(RACINE, 'content', l + '.js'), 'utf8').replace(/\r\n/g, '\n');

test('dashboard : première visite, rien à publier et aucune clé sans nom', async () => {
  const ls = fauxStockage();
  const v = visite({ ls });
  assert.equal(v.nbModifies(), 0);
  assert.deepEqual(ls.cles().filter((k) => /^undefined/.test(k)), [], 'aucune clé « undefined… »');
  assert.equal(await v.publier(), null, 'rien n\'est envoyé');
  // deuxième visite : toujours rien
  const v2 = visite({ ls });
  assert.equal(v2.nbModifies(), 0);
  assert.equal(await v2.publier(), null);
});

test('dashboard : un navigateur resté sur la version fautive ne republie pas d\'anciens textes', async () => {
  const vieux = lireContenu('fr');
  vieux.stripe.programme = '';
  vieux.prog.c5 = 'Échauffement commun inclus';
  vieux.prog.whoTitle = 'Un programme pensé pour reprendre.';
  vieux.legal.cvg.body = '<p>ancien texte des CGV</p>';
  const ls = fauxStockage({
    undefinedfr: JSON.stringify(vieux),                                              // copie complète rangée sous une clé sans nom
    SITE_EDITS_fr: JSON.stringify({ legal: { cvg: { body: '<ul><li>liste jamais refermée' } } }),   // ancien brouillon
    SITE_PREVIEW_fr: JSON.stringify(vieux),
  });
  const v = visite({ ls });
  assert.equal(v.nbModifies(), 0, 'aucun champ marqué modifié');
  assert.equal(ls.getItem('undefinedfr'), null);
  assert.equal(ls.getItem('SITE_EDITS_fr'), null);
  assert.equal(await v.publier(), null, 'sans modification, rien n\'est publié');
  // une vraie modification ne publie que ce champ
  v.editer('home.hero.subtitle', 'essai');
  const envoi = await v.publier();
  const publie = objetDe(envoi.files['content/fr.js']);
  const site = lireContenu('fr');
  assert.equal(publie.home.hero.subtitle, 'essai');
  assert.equal(publie.stripe.programme, site.stripe.programme, 'le lien Stripe reste en place');
  assert.equal(publie.prog.c5, site.prog.c5);
  assert.equal(publie.prog.whoTitle, undefined, 'les clés retirées ne reviennent pas');
  assert.equal(publie.legal.cvg.body, site.legal.cvg.body, 'les CGV restent celles du site');
});

test('dashboard : un brouillon tient au rechargement et la publication part du contenu du site', async () => {
  const ls = fauxStockage();
  let v = visite({ ls });
  v.editer('home.hero.subtitle', 'brouillon en cours');
  v = visite({ ls });                                   // rechargement de la page
  assert.equal(v.nbModifies(), 1);
  const envoi = await v.publier();
  assert.deepEqual(Object.keys(envoi.files), ['content/fr.js']);
  assert.equal(envoi.bases['content/fr.js'].replace(/\r\n/g, '\n'), texteDepot('fr'), 'le contenu de départ envoyé est exactement le fichier du site');
  assert.equal(objetDe(envoi.files['content/fr.js']).home.hero.subtitle, 'brouillon en cours');
  // après une publication réussie : plus rien à publier, et la publication suivante part du contenu publié
  assert.equal(v.nbModifies(), 0);
  assert.equal(await v.publier(), null);
  v.editer('nav.accueil', 'deuxième modification');
  const envoi2 = await v.publier();
  assert.equal(envoi2.bases['content/fr.js'], envoi.files['content/fr.js'], 'la base suit ce qui vient d\'être publié');
  assert.equal(objetDe(envoi2.files['content/fr.js']).home.hero.subtitle, 'brouillon en cours');
});

test('dashboard : les fichiers du dépôt ont exactement le format produit par le dashboard', async () => {
  // Sinon chaque publication afficherait un faux changement, et le garde-fou de publication refuserait à tort.
  for (const l of ['fr', 'nl', 'en']) {
    const ls = fauxStockage();
    const v = visite({ ls });
    if (l !== 'fr') v.langue(l);
    v.editer('nav.accueil', 'essai de format');
    const envoi = await v.publier();
    assert.equal(envoi.bases['content/' + l + '.js'].replace(/\r\n/g, '\n'), texteDepot(l), 'content/' + l + '.js');
  }
});

test('dashboard : publication refusée car le site a changé, le brouillon est gardé', async () => {
  const ls = fauxStockage();
  const v = visite({ ls, reponse: { status: 409, corps: { ok: false, perime: true, error: 'Le site a été mis à jour depuis l\'ouverture de ce dashboard.' } } });
  v.editer('home.hero.subtitle', 'à ne pas perdre');
  await v.publier();
  assert.match(v.message(), /mis à jour/);
  assert.match(ls.getItem('SITE_EDITS2_fr') || '', /à ne pas perdre/, 'le brouillon est toujours dans le navigateur');
  const v2 = visite({ ls });
  assert.equal(v2.nbModifies(), 1, 'et elle est retrouvée après rechargement');
});

test('dashboard : la confirmation nomme les champs qui vont partir', async () => {
  const ls = fauxStockage();
  const v = visite({ ls });
  v.editer('home.hero.subtitle', 'un');
  v.editer('nav.accueil', 'deux');
  await v.publier();
  assert.match(v.confirmations[0], /Champs modifiés qui vont partir/);
  assert.match(v.confirmations[0], /FR : .*home\.hero\.subtitle/);
  assert.match(v.confirmations[0], /nav\.accueil/);
});

test('dashboard : ce qui est tapé pendant l\'envoi n\'est pas perdu', async () => {
  const ls = fauxStockage();
  const v = visite({ ls });
  v.editer('home.hero.subtitle', 'publié');
  const envoi = v.cliquerPublier();                 // la demande part, la réponse n'est pas encore revenue
  assert.ok(envoi);
  v.editer('nav.accueil', 'tapé pendant l\'envoi');
  await v.finirEnvoi();
  const reste = JSON.parse(ls.getItem('SITE_EDITS2_fr') || '{}');
  assert.deepEqual(reste, { nav: { accueil: 'tapé pendant l\'envoi' } }, 'seule la saisie faite pendant l\'envoi reste en brouillon');
  const suivant = await v.publier();
  assert.equal(objetDe(suivant.files['content/fr.js']).nav.accueil, 'tapé pendant l\'envoi');
  assert.equal(objetDe(suivant.files['content/fr.js']).home.hero.subtitle, 'publié');
});
