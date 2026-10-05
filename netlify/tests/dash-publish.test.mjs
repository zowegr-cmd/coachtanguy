/* Tests de la publication du dashboard (netlify/functions/dash-publish.js).
   Lancer :  node --test netlify/tests/*.test.mjs
   GitHub est simulé : aucun réseau, aucun secret. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handler, comparerBase, objetDuFichier } = require('../functions/dash-publish.js');

const fichier = (l, objet, finDeLigne) => {
  const t = '/* ===========================================================\n   CONTENU — CoachTanguy\n   =========================================================== */\n'
    + 'window.SITE_CONTENT = ' + JSON.stringify(objet, null, 2) + ';\n'
    + '(window.SITE_CONTENT_ALL = window.SITE_CONTENT_ALL || {}).' + l + ' = window.SITE_CONTENT;\n';
  return finDeLigne ? t.replace(/\n/g, finDeLigne) : t;
};

/* Faux GitHub : la branche contient `branche` (chemin -> texte). Note chaque appel reçu. */
function fauxGitHub(branche) {
  const appels = [];
  globalThis.fetch = async (url, init) => {
    const methode = (init && init.method) || 'GET';
    appels.push(methode + ' ' + url.replace('https://api.github.com/repos/zowegr-cmd/coachtanguy', ''));
    const rep = (status, data) => ({ status, text: async () => JSON.stringify(data) });
    if (/\/git\/ref\/heads\//.test(url)) return rep(200, { object: { sha: 'parent123' } });
    if (/\/git\/commits\/parent123$/.test(url)) return rep(200, { tree: { sha: 'arbre1' } });
    const c = /\/contents\/(.+)\?ref=parent123$/.exec(url);
    if (c) return (c[1] in branche) ? rep(200, { encoding: 'base64', content: Buffer.from(branche[c[1]], 'utf8').toString('base64').replace(/(.{60})/g, '$1\n') }) : rep(404, { message: 'Not Found' });
    if (/\/git\/trees$/.test(url)) return rep(201, { sha: 'arbre2' });
    if (/\/git\/commits$/.test(url)) return rep(201, { sha: 'commit2abcdef' });
    if (/\/git\/refs\/heads\//.test(url)) return rep(200, {});
    return rep(500, {});
  };
  return appels;
}

const publier = async (corps) => {
  process.env.DASH_PASSWORD = 'secret-de-test'; process.env.GITHUB_TOKEN = 'jeton-de-test';
  delete process.env.GITHUB_REPO; delete process.env.GITHUB_BRANCH;
  const r = await handler({ httpMethod: 'POST', body: JSON.stringify(Object.assign({ password: 'secret-de-test' }, corps)) });
  return { status: r.statusCode, j: JSON.parse(r.body) };
};
const aEcrit = (appels) => appels.some((a) => /^(POST|PATCH) /.test(a));

const SITE = { nav: { accueil: 'Accueil' }, stripe: { programme: 'https://buy.stripe.com/x' }, legal: { cvg: { body: '<h2>1.</h2>\n<p>« CGV »</p>' } } };

test('publication : acceptée quand le dashboard part du contenu actuel du site', async () => {
  const appels = fauxGitHub({ 'content/fr.js': fichier('fr', SITE, '\r\n') });       // fins de ligne différentes : sans importance
  const nouveau = JSON.parse(JSON.stringify(SITE)); nouveau.nav.accueil = 'Bienvenue';
  const r = await publier({ files: { 'content/fr.js': fichier('fr', nouveau) }, bases: { 'content/fr.js': fichier('fr', SITE) } });
  assert.equal(r.status, 200); assert.equal(r.j.ok, true); assert.equal(r.j.deploy, true);
  assert.ok(aEcrit(appels));
});

test('publication : refusée si le site a changé depuis l\'ouverture du dashboard', async () => {
  const enLigne = JSON.parse(JSON.stringify(SITE)); enLigne.stripe.programme = 'https://buy.stripe.com/nouveau';   // mis à jour entre-temps
  const appels = fauxGitHub({ 'content/fr.js': fichier('fr', enLigne) });
  const nouveau = JSON.parse(JSON.stringify(SITE)); nouveau.nav.accueil = 'Bienvenue';
  const r = await publier({ files: { 'content/fr.js': fichier('fr', nouveau) }, bases: { 'content/fr.js': fichier('fr', SITE) } });
  assert.equal(r.status, 409); assert.equal(r.j.perime, true);
  assert.match(r.j.error, /Recharge la page du dashboard/);
  assert.equal(aEcrit(appels), false, 'rien n\'est écrit sur GitHub');
});

test('publication : refusée pour un ancien onglet du dashboard, qui n\'envoie pas son contenu de départ', async () => {
  const appels = fauxGitHub({ 'content/fr.js': fichier('fr', SITE) });
  const r = await publier({ files: { 'content/fr.js': fichier('fr', SITE) } });
  assert.equal(r.status, 409); assert.equal(r.j.perime, true); assert.equal(r.j.ancien, true);
  assert.match(r.j.error, /ancienne version/);
  assert.match(r.j.error, /ne seront pas conservées/, 'le message ne promet pas que les modifications sont gardées');
  assert.equal(aEcrit(appels), false);
});

test('publication : chaque fichier de textes est contrôlé, un seul périmé suffit à tout refuser', async () => {
  const nlEnLigne = { nav: { accueil: 'Start' } };
  const appels = fauxGitHub({ 'content/fr.js': fichier('fr', SITE), 'content/nl.js': fichier('nl', nlEnLigne) });
  const r = await publier({
    files: { 'content/fr.js': fichier('fr', SITE), 'content/nl.js': fichier('nl', { nav: { accueil: 'Welkom' } }) },
    bases: { 'content/fr.js': fichier('fr', SITE), 'content/nl.js': fichier('nl', { nav: { accueil: 'Home' } }) },
  });
  assert.equal(r.status, 409);
  assert.equal(aEcrit(appels), false);
});

test('publication : les traductions du calculateur ne sont pas concernées par le contrôle', async () => {
  const appels = fauxGitHub({});
  const r = await publier({ files: { 'content/calc-i18n.nl.js': 'window.CALC_I18N = {};\n' } });
  assert.equal(r.status, 200);
  assert.ok(aEcrit(appels));
  assert.equal(appels.some((a) => /\/contents\//.test(a)), false);
});

test('publication : un fichier de la branche illisible ou absent ne bloque pas le dashboard', async () => {
  let appels = fauxGitHub({ 'content/fr.js': '// fichier réécrit à la main, forme inattendue\n' });
  let r = await publier({ files: { 'content/fr.js': fichier('fr', SITE) }, bases: { 'content/fr.js': fichier('fr', SITE) } });
  assert.equal(r.status, 200); assert.ok(aEcrit(appels));
  appels = fauxGitHub({});
  r = await publier({ files: { 'content/en.js': fichier('en', SITE) }, bases: { 'content/en.js': fichier('en', SITE) } });
  assert.equal(r.status, 200); assert.ok(aEcrit(appels));
});

test('publication : mot de passe et fichiers autorisés (comportement inchangé)', async () => {
  const appels = fauxGitHub({ 'content/fr.js': fichier('fr', SITE) });
  process.env.DASH_PASSWORD = 'secret-de-test'; process.env.GITHUB_TOKEN = 'jeton-de-test';
  const mauvais = await handler({ httpMethod: 'POST', body: JSON.stringify({ password: 'faux', files: { 'content/fr.js': 'x' }, bases: { 'content/fr.js': 'x' } }) });
  assert.equal(mauvais.statusCode, 401);
  const interdit = await publier({ files: { 'netlify/functions/dash-login.js': 'x', '../secret.js': 'x', 'index.html': 'x' } });
  assert.equal(interdit.status, 400);
  assert.equal(aEcrit(appels), false);
});

test('comparaison : seul le contenu compte, pas la mise en forme du fichier', () => {
  const a = fichier('fr', SITE);
  assert.equal(comparerBase(a, a), 'ok');
  assert.equal(comparerBase(a.replace(/\n/g, '\r\n'), a), 'ok');
  assert.equal(comparerBase(a, fichier('fr', Object.assign({}, SITE, { nav: { accueil: 'Autre' } }))), 'perime');
  assert.equal(comparerBase(a, 'pas un fichier de contenu'), 'perime');
  assert.equal(comparerBase('pas un fichier de contenu', a), 'illisible');
  assert.deepEqual(objetDuFichier(a), SITE);
  assert.equal(objetDuFichier('window.SITE_CONTENT = {oups};\n(window.SITE_CONTENT_ALL'), null);
});
