/* Tests de la livraison automatique du programme.
   Lancer :  node --test netlify/tests/*.test.mjs
   Aucun réseau, aucun secret : le stockage et le service d'e-mail sont simulés. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  verifierSignatureStripe, estProgramme, estPaye, langueDe, venteDepuisSession,
  emailLivraison, emailInterne, livrer, envoyerProgramme, inscrireVente, noterInconnu,
  lireJSON, memeSecret, emailValide, PLINK_RE, NOM_FICHIER,
  LIENS_CONNUS, lienReconnu, pdfDepose, ventePrete, adresseLien, RENONCE_RE, accordValide,
} from '../lib/programme.mjs';

/* ---------- faux stockage (même interface que Netlify Blobs) ---------- */
function fauxMagasin() {
  const m = new Map();
  return {
    _m: m,
    async get(k, o) {
      if (!m.has(k)) return null;
      const v = m.get(k).data;
      if (o && o.type === 'json') return JSON.parse(Buffer.from(v).toString('utf8'));
      if (o && o.type === 'arrayBuffer') { const b = Buffer.from(v); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
      return Buffer.from(v).toString('utf8');
    },
    async getWithMetadata(k, o) {
      if (!m.has(k)) return null;
      return { data: await this.get(k, o), metadata: m.get(k).metadata || {} };
    },
    async getMetadata(k) { return m.has(k) ? { etag: 'x', metadata: m.get(k).metadata || {} } : null; },
    async set(k, v, o) { m.set(k, { data: Buffer.from(v), metadata: o && o.metadata }); },
    async setJSON(k, v) { m.set(k, { data: Buffer.from(JSON.stringify(v)) }); },
    async delete(k) { m.delete(k); },
  };
}

/* ---------- faux service d'e-mail ---------- */
function fauxResend(reponses) {
  const appels = [];
  const file = (reponses || []).slice();
  globalThis.fetch = async (url, init) => {
    appels.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = file.length ? file.shift() : { status: 200 };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => null }, text: async () => r.texte || '' };
  };
  return appels;
}

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(4000)]);
async function magasinAvecPdf() {
  const s = fauxMagasin();
  await s.set('pdf', PDF, { metadata: { nom: 'programme.pdf', taille: PDF.length } });
  return s;
}
function env(o) {
  for (const k of ['RESEND_API_KEY', 'RESEND_FROM', 'CONTACT_TO', 'RESEND_API_URL']) delete process.env[k];
  Object.assign(process.env, { RESEND_API_KEY: 're_test', RESEND_FROM: 'CoachTanguy <contact@coachtanguy.com>', CONTACT_TO: 'tanguy@exemple.be' }, o || {});
}
const signer = (corps, secret, t) => 't=' + t + ',v1=' + crypto.createHmac('sha256', secret).update(t + '.' + corps).digest('hex');
const SESSION = {
  id: 'cs_live_abc123', mode: 'payment', payment_status: 'paid', payment_link: 'plink_PROGRAMME01',
  amount_total: 4900, currency: 'eur', locale: 'fr',
  customer_details: { email: 'Client@Exemple.be', name: 'Marie Dupont' },
};

/* ====================== signature Stripe ====================== */
test('signature : un appel correctement signé est accepté', () => {
  const corps = '{"a":1}'; const t = 1760000000;
  const r = verifierSignatureStripe(corps, signer(corps, 'whsec_x', t), 'whsec_x', { maintenant: t * 1000 });
  assert.equal(r.ok, true);
});
test('signature : un corps modifié après signature est refusé', () => {
  const t = 1760000000;
  const r = verifierSignatureStripe('{"a":2}', signer('{"a":1}', 'whsec_x', t), 'whsec_x', { maintenant: t * 1000 });
  assert.deepEqual(r, { ok: false, raison: 'signature incorrecte' });
});
test('signature : un mauvais secret est refusé', () => {
  const corps = '{}'; const t = 1760000000;
  assert.equal(verifierSignatureStripe(corps, signer(corps, 'whsec_pirate', t), 'whsec_x', { maintenant: t * 1000 }).ok, false);
});
test('signature : un vieil appel rejoué (plus de 5 min) est refusé', () => {
  const corps = '{}'; const t = 1760000000;
  const r = verifierSignatureStripe(corps, signer(corps, 'whsec_x', t), 'whsec_x', { maintenant: (t + 301) * 1000 });
  assert.deepEqual(r, { ok: false, raison: 'horodatage trop ancien' });
});
test('signature : en-tête absent, vide ou mal formé refusé', () => {
  assert.equal(verifierSignatureStripe('{}', null, 'whsec_x').ok, false);
  assert.equal(verifierSignatureStripe('{}', '', 'whsec_x').ok, false);
  assert.equal(verifierSignatureStripe('{}', 'n-importe-quoi', 'whsec_x').ok, false);
  assert.equal(verifierSignatureStripe('{}', 't=abc,v1=00', 'whsec_x').ok, false);
  assert.equal(verifierSignatureStripe('{}', 't=1,v1=00', '').ok, false);
});
test('signature : plusieurs v1 (rotation de secret), une seule bonne suffit', () => {
  const corps = '{}'; const t = 1760000000;
  const bonne = signer(corps, 'whsec_x', t).split('v1=')[1];
  const r = verifierSignatureStripe(corps, 't=' + t + ',v1=' + '0'.repeat(64) + ',v1=' + bonne, 'whsec_x', { maintenant: t * 1000 });
  assert.equal(r.ok, true);
});

/* ====================== tri des paiements ====================== */
test('tri : seul le lien du programme déclenche un envoi', () => {
  assert.equal(estProgramme(SESSION, { plinks: ['plink_PROGRAMME01'] }), true);
  assert.equal(estProgramme(SESSION, { plinks: ['plink_PACKVISIO'] }), false, 'un pack visio ne doit pas recevoir le PDF');
  assert.equal(estProgramme(SESSION, { plinks: [] }), false);
  assert.equal(estProgramme(SESSION, { plinks: [], envPlink: 'plink_PROGRAMME01' }), true);
  assert.equal(estProgramme({ ...SESSION, payment_link: null }, { plinks: ['plink_PROGRAMME01'] }), false);
  assert.equal(estProgramme({ ...SESSION, payment_link: null, metadata: { produit: 'programme-28j' } }, {}), true);
  assert.equal(estProgramme(null, {}), false);
});
test('tri : payé, gratuit par code promo, ou pas encore payé', () => {
  assert.equal(estPaye(SESSION), true);
  assert.equal(estPaye({ ...SESSION, payment_status: 'unpaid' }), false);
  assert.equal(estPaye({ ...SESSION, payment_status: 'no_payment_required', amount_total: 0 }), true);
  assert.equal(estPaye({ ...SESSION, payment_status: 'no_payment_required', amount_total: 4900 }), false);
  assert.equal(estPaye({ ...SESSION, mode: 'subscription', payment_status: 'no_payment_required', amount_total: 0 }), false);
});
test('tri : langue et fiche de vente', () => {
  assert.equal(langueDe({ locale: 'nl' }), 'nl');
  assert.equal(langueDe({ locale: 'en-GB' }), 'en');
  assert.equal(langueDe({ locale: 'auto' }), 'fr');
  assert.equal(langueDe({}), 'fr');
  const v = venteDepuisSession(SESSION, true);
  assert.deepEqual(v, { id: 'cs_live_abc123', email: 'client@exemple.be', nom: 'Marie Dupont', montant: 4900, devise: 'eur', lang: 'fr', reel: true, renonciation: false, accord: '' });
});
test('garde-fous : identifiant de lien, e-mail, comparaison de secrets', () => {
  assert.ok(PLINK_RE.test('plink_1SAbCdEfGh123456'));
  assert.ok(!PLINK_RE.test('https://buy.stripe.com/abc'));
  assert.ok(!PLINK_RE.test('plink_'));
  assert.ok(emailValide('a.b@c.be')); assert.ok(!emailValide('pas un mail')); assert.ok(!emailValide('a@b')); assert.ok(!emailValide('a@b.be\nBcc: x@y.z'));
  assert.equal(memeSecret('abc', 'abc'), true); assert.equal(memeSecret('abc', 'abd'), false); assert.equal(memeSecret('abc', 'abcd'), false); assert.equal(memeSecret(undefined, 'x'), false);
});

/* ====================== e-mails ====================== */
test('e-mail : 3 langues, prénom, nom du fichier, aucun tiret long', () => {
  for (const lang of ['fr', 'nl', 'en']) {
    const m = emailLivraison({ lang, nom: 'Marie Dupont' });
    assert.ok(m.sujet.length > 10);
    assert.ok(m.html.includes('Marie'), lang + ' : prénom présent');
    assert.ok(!m.html.includes('Dupont'), lang + ' : on salue par le prénom seulement');
    assert.ok(m.html.includes(NOM_FICHIER));
    assert.ok(m.texte.includes('1. '));
    assert.ok(!/[—–]/.test(m.sujet + m.html + m.texte), lang + ' : pas de tiret long');
  }
  assert.ok(emailLivraison({ lang: 'xx' }).sujet.includes('Reprise'), 'langue inconnue = français');
  assert.ok(emailLivraison({}).html.includes('Merci pour votre achat'));
});
test('e-mail : un nom malveillant ne casse pas le HTML', () => {
  const m = emailLivraison({ lang: 'fr', nom: '<script>alert(1)</script> X' });
  assert.ok(!m.html.includes('<script>'));
});
test('e-mail interne : vente réussie et vente en échec', () => {
  const v = { nom: 'Marie', email: 'm@x.be', montant: 4900, devise: 'eur', lang: 'fr' };
  const ok = emailInterne(v, 'envoye');
  assert.ok(ok.html.includes('49,00 €') && ok.sujet.includes('Vente'));
  const ko = emailInterne({ ...v, erreur: 'aucun PDF déposé' }, 'echec');
  assert.ok(ko.html.includes('aucun PDF déposé') && ko.sujet.includes('non envoyé'));
  assert.ok(!/[—–]/.test(ok.html + ko.html + ok.sujet + ko.sujet));
});

/* ====================== livraison ====================== */
test('livraison : le PDF part en pièce jointe, octets identiques, bons destinataires', async () => {
  env(); const appels = fauxResend(); const s = await magasinAvecPdf();
  const r = await livrer(s, venteDepuisSession(SESSION, true));
  assert.deepEqual(r, { ok: true });
  assert.equal(appels.length, 2, 'un e-mail client + une notification à Tanguy');
  const client = appels[0].body;
  assert.deepEqual(client.to, ['client@exemple.be']);
  assert.equal(client.from, 'CoachTanguy <contact@coachtanguy.com>');
  assert.equal(client.reply_to, 'tanguy@exemple.be');
  assert.equal(client.attachments.length, 1);
  assert.equal(client.attachments[0].filename, NOM_FICHIER);
  assert.ok(Buffer.from(client.attachments[0].content, 'base64').equals(PDF), 'le PDF joint est exactement celui déposé');
  assert.equal(appels[0].headers['Idempotency-Key'], 'prog28-cs_live_abc123');
  assert.deepEqual(appels[1].body.to, ['tanguy@exemple.be']);
  const fiche = await lireJSON(s, 'ventes/cs_live_abc123', null);
  assert.equal(fiche.statut, 'envoye'); assert.ok(fiche.envoyeLe); assert.equal(fiche.erreur, undefined);
  assert.equal((await lireJSON(s, 'ventes-index', [])).length, 1);
});
test('livraison : Stripe rappelle deux fois, le client ne reçoit qu\'un seul e-mail', async () => {
  env(); const appels = fauxResend(); const s = await magasinAvecPdf();
  await livrer(s, venteDepuisSession(SESSION, true));
  const avant = appels.length;
  const r = await livrer(s, venteDepuisSession(SESSION, true));
  assert.deepEqual(r, { ok: true, deja: true });
  assert.equal(appels.length, avant, 'aucun nouvel envoi');
});
test('livraison : PDF pas encore déposé, puis déposé : la vente finit par être livrée', async () => {
  env(); const appels = fauxResend(); const s = fauxMagasin();
  const r1 = await livrer(s, venteDepuisSession(SESSION, true));
  assert.equal(r1.ok, false); assert.equal(r1.reessayer, true, 'on demande à Stripe de rappeler');
  assert.equal(appels.length, 1, 'Tanguy est alerté');
  assert.ok(appels[0].body.subject.includes('non envoyé'));
  const r2 = await livrer(s, venteDepuisSession(SESSION, true));
  assert.equal(r2.ok, false);
  assert.equal(appels.length, 1, 'pas de seconde alerte pour la même vente');
  assert.equal((await lireJSON(s, 'ventes/cs_live_abc123', null)).tentatives, 2);
  await s.set('pdf', PDF, { metadata: {} });
  const r3 = await livrer(s, venteDepuisSession(SESSION, true));
  assert.deepEqual(r3, { ok: true });
  assert.equal((await lireJSON(s, 'ventes/cs_live_abc123', null)).statut, 'envoye');
  assert.equal((await lireJSON(s, 'ventes-index', [])).length, 1, 'une seule ligne dans le journal');
});
test('livraison : service d\'e-mail en panne = erreur avec nouvel essai, rien de marqué envoyé', async () => {
  env(); fauxResend([{ status: 500 }, { status: 500 }, { status: 200 }]); const s = await magasinAvecPdf();
  const r = await livrer(s, venteDepuisSession(SESSION, true));
  assert.equal(r.ok, false); assert.equal(r.reessayer, true);
  assert.equal((await lireJSON(s, 'ventes/cs_live_abc123', null)).statut, 'attente');
});
test('livraison : une erreur passagère (429) est retentée et aboutit', async () => {
  env(); const appels = fauxResend([{ status: 429 }, { status: 200 }, { status: 200 }]); const s = await magasinAvecPdf();
  const r = await livrer(s, venteDepuisSession(SESSION, true));
  assert.deepEqual(r, { ok: true });
  assert.equal(appels.length, 3);
});
test('livraison : paiement sans adresse e-mail = pas de nouvel essai inutile', async () => {
  env(); fauxResend(); const s = await magasinAvecPdf();
  const r = await livrer(s, venteDepuisSession({ ...SESSION, customer_details: {} }, true));
  assert.equal(r.ok, false); assert.equal(r.reessayer, false);
});
test('envoi manuel : adresse invalide refusée, clé e-mail absente signalée', async () => {
  env(); fauxResend(); const s = await magasinAvecPdf();
  assert.equal((await envoyerProgramme(s, { email: 'pas-un-mail' })).ok, false);
  delete process.env.RESEND_API_KEY;
  const r = await envoyerProgramme(s, { email: 'a@b.be' });
  assert.equal(r.ok, false); assert.ok(r.erreur.includes('RESEND_API_KEY'));
});
test('journal : les ventes les plus récentes en premier, sans doublon', async () => {
  const s = fauxMagasin();
  await inscrireVente(s, { id: 'a', creeLe: '2026-10-01T10:00:00Z', statut: 'envoye' });
  await inscrireVente(s, { id: 'b', creeLe: '2026-10-03T10:00:00Z', statut: 'envoye' });
  await inscrireVente(s, { id: 'a', creeLe: '2026-10-01T10:00:00Z', statut: 'envoye', renvois: 1 });
  const idx = await lireJSON(s, 'ventes-index', []);
  assert.deepEqual(idx.map((v) => v.id), ['b', 'a']);
  assert.equal(idx[1].renvois, 1);
});
test('paiements non reconnus : mémorisés sans aucune donnée personnelle', async () => {
  const s = fauxMagasin();
  await noterInconnu(s, { ...SESSION, payment_link: 'plink_AUTRE' });
  const l = await lireJSON(s, 'inconnus', []);
  assert.equal(l.length, 1);
  assert.deepEqual(Object.keys(l[0]).sort(), ['devise', 'le', 'montant', 'plink']);
  assert.ok(!JSON.stringify(l).includes('exemple.be'));
});

/* ---------- ouverture automatique de la vente sur le site ---------- */
test('lien connu d\'avance : le lien affiché sur le site est reconnu sans rien saisir', () => {
  const [url, id] = Object.entries(LIENS_CONNUS)[0];
  assert.match(url, /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/);
  assert.match(id, PLINK_RE);
  assert.equal(estProgramme({ payment_link: id }, { plinks: [] }), true);
  assert.equal(estProgramme({ payment_link: 'plink_PACKVISIO4' }, { plinks: [] }), false);
  assert.equal(lienReconnu(url, [], ''), true);
  assert.equal(lienReconnu(url + '?locale=nl', [], ''), true, 'le paramètre de langue ne compte pas');
  assert.equal(lienReconnu('https://buy.stripe.com/unAutreLien', [], ''), false);
  assert.equal(lienReconnu('https://buy.stripe.com/unAutreLien', ['plink_NOUVEAU1'], ''), false, 'identifiant saisi sans lien associé');
  assert.equal(lienReconnu('https://buy.stripe.com/unAutreLien', ['plink_ANCIEN01'], 'https://buy.stripe.com/ancienLien'), false, 'identifiant saisi pour un ancien lien');
  assert.equal(lienReconnu('https://buy.stripe.com/unAutreLien', ['plink_NOUVEAU1'], 'https://buy.stripe.com/unAutreLien'), true);
  assert.equal(lienReconnu('https://buy.stripe.com/unAutreLien?locale=nl', ['plink_NOUVEAU1'], 'https://buy.stripe.com/unAutreLien/'), true);
  assert.equal(lienReconnu('https://buy.stripe.com/unAutreLien', [], 'https://buy.stripe.com/unAutreLien'), false, 'lien associé mais aucun identifiant');
  assert.equal(adresseLien(url + '/?locale=fr#x'), url);
  assert.equal(adresseLien('https://buy.stripe.com/' + '/'.repeat(5000)), '', 'valeur démesurée ignorée');
  assert.equal(lienReconnu(url + '?' + 'a'.repeat(5000), [], ''), true, 'de longs paramètres ne gênent pas un lien connu');
  for (const vide of ['', null, undefined, 'constructor', '__proto__', 'toString']) assert.equal(lienReconnu(vide, [], ''), false);
});

test('ouverture de la vente : seulement si un paiement sera réellement suivi de l\'envoi', async () => {
  const url = Object.keys(LIENS_CONNUS)[0];
  const pret = { STRIPE_WEBHOOK_SECRET: 'whsec_x', RESEND_API_KEY: 're_test' };
  const s = fauxMagasin();
  assert.equal(await ventePrete(s, pret, url), false, 'PDF pas encore déposé');
  await s.set('pdf', Buffer.from('%PDF-1.7 essai'), { metadata: { nom: 'programme.pdf' } });
  assert.equal(await ventePrete(s, pret, url), true, 'tout est prêt');
  assert.equal(await ventePrete(s, { RESEND_API_KEY: 're_test' }, url), false, 'Stripe pas relié');
  assert.equal(await ventePrete(s, { STRIPE_WEBHOOK_SECRET: 'whsec_x' }, url), false, 'e-mails inactifs');
  assert.equal(await ventePrete(s, {}, url), false);
  assert.equal(await ventePrete(s, pret, ''), false, 'aucun lien affiché');
  assert.equal(await ventePrete(s, pret, 'https://buy.stripe.com/lienInconnu'), false, 'lien que le site ne saurait pas reconnaître');
  await s.setJSON('config', { plinks: ['plink_NOUVEAU1'] });
  assert.equal(await ventePrete(s, pret, 'https://buy.stripe.com/lienInconnu'), false, 'identifiant enregistré sans lien associé');
  await s.setJSON('config', { plinks: ['plink_NOUVEAU1'], lien: 'https://buy.stripe.com/lienInconnu' });
  assert.equal(await ventePrete(s, pret, 'https://buy.stripe.com/lienInconnu'), true, 'identifiant enregistré pour ce lien');
  assert.equal(await ventePrete(s, pret, 'https://buy.stripe.com/encoreUnAutre'), false, 'le lien a changé depuis');
  assert.equal(await ventePrete(s, Object.assign({ STRIPE_PROGRAMME_PLINK: 'plink_PARVARIABLE' }, pret), 'https://buy.stripe.com/encoreUnAutre'), false, 'la variable seule n\'ouvre pas la vente');
});

test('ouverture de la vente : le stockage est réellement interrogé, même si un réglage manque', async () => {
  const url = Object.keys(LIENS_CONNUS)[0];
  const s = fauxMagasin();
  let lectures = 0;
  const lire = s.get.bind(s);
  s.get = async (...a) => { lectures++; return lire(...a); };
  assert.equal(await ventePrete(s, {}, url), false);
  assert.equal(lectures, 1);
  const enPanne = { get: async () => { throw new Error('stockage indisponible'); } };
  await assert.rejects(() => ventePrete(enPanne, {}, url));
});

test('garde : si la vente est dite ouverte, le paiement de ce lien sera reconnu', async () => {
  const pret = { STRIPE_WEBHOOK_SECRET: 'whsec_x', RESEND_API_KEY: 're_test' };
  const s = fauxMagasin();
  await s.set('pdf', Buffer.from('%PDF-1.7 essai'), { metadata: {} });
  for (const [url, id] of Object.entries(LIENS_CONNUS)) {
    assert.equal(await ventePrete(s, pret, url), true);
    assert.equal(estProgramme({ payment_link: id }, { plinks: [] }), true);
  }
});

/* ---------- renonciation au droit de rétractation (CGV 12.2) ---------- */
test('rétractation : l\'accord donné sur le site est lu dans le paiement', () => {
  const jour = Date.UTC(2026, 9, 5, 14, 30) / 1000;   // paiement le 5 octobre 2026 à 14 h 30 UTC
  const base = { id: 'cs_1', created: jour, customer_details: { email: 'a@exemple.be', name: 'Ana' }, amount_total: 4900, currency: 'eur' };
  const v = venteDepuisSession(Object.assign({ client_reference_id: 'renonce-retractation-20261005' }, base), true);
  assert.equal(v.renonciation, true);
  assert.equal(v.accord, 'renonce-retractation-20261005', 'la valeur reçue est gardée comme trace');
  for (const autre of [undefined, null, '', 'renonce-retractation', 'renonce-retractation-2026', 'autre-chose-20261005', 'renonce-retractation-20261005 ', 12345678]) {
    assert.equal(venteDepuisSession(Object.assign({ client_reference_id: autre }, base), true).renonciation, false, String(autre));
  }
  assert.match('renonce-retractation-20261005', RENONCE_RE);
  assert.match('renonce-retractation-20261005', /^[A-Za-z0-9_-]{1,200}$/, 'format accepté par Stripe pour client_reference_id');
});

test('rétractation : un accord daté d\'un autre jour que le paiement n\'est pas retenu', () => {
  const jour = Date.UTC(2026, 9, 5, 14, 30) / 1000;
  assert.equal(accordValide('renonce-retractation-20261005', jour), true);
  assert.equal(accordValide('renonce-retractation-20261004', jour), true, 'veille : décalage horaire possible');
  assert.equal(accordValide('renonce-retractation-20261006', jour), true, 'lendemain : décalage horaire possible');
  assert.equal(accordValide('renonce-retractation-20261005', Date.UTC(2026, 9, 5, 0, 5) / 1000), true, 'paiement juste après minuit');
  assert.equal(accordValide('renonce-retractation-20261005', Date.UTC(2026, 9, 5, 23, 55) / 1000), true, 'paiement juste avant minuit');
  for (const vieux of ['renonce-retractation-20261003', 'renonce-retractation-20261007', 'renonce-retractation-19990101', 'renonce-retractation-99999999', 'renonce-retractation-00000000']) {
    assert.equal(accordValide(vieux, jour), false, vieux);
  }
  assert.equal(accordValide('renonce-retractation-20261005', undefined), false, 'paiement sans date');
  assert.equal(accordValide('renonce-retractation-20261005', 0), false);
});

test('rétractation : la confirmation écrite figure dans l\'e-mail, seulement si l\'accord a été donné', () => {
  for (const lang of ['fr', 'nl', 'en']) {
    const avec = emailLivraison({ lang, nom: 'Ana Dupont', renonciation: true });
    const sans = emailLivraison({ lang, nom: 'Ana Dupont' });
    const mot = { fr: 'droit de rétractation', nl: 'herroepingsrecht', en: 'right of withdrawal' }[lang];
    assert.ok(avec.html.includes(mot) && avec.texte.includes(mot), lang + ' : confirmation absente');
    assert.ok(!sans.html.includes(mot) && !sans.texte.includes(mot), lang + ' : confirmation affichée sans accord');
    assert.ok(!/[\u2014\u2013]/.test(avec.html + avec.texte), lang + ' : tiret long');
    assert.equal(avec.sujet, sans.sujet);
  }
});

test('rétractation : l\'accord suit la vente jusqu\'à l\'e-mail du client et à l\'avis interne', async () => {
  process.env.RESEND_API_KEY = 're_test'; process.env.CONTACT_TO = 'tanguy@exemple.be';
  for (const accord of [true, false]) {
    const s = fauxMagasin();
    await s.set('pdf', Buffer.from('%PDF-1.7 essai'), { metadata: {} });
    const appels = fauxResend();
    const session = { id: 'cs_accord_' + accord, created: Date.UTC(2026, 9, 5, 9) / 1000, customer_details: { email: 'ana@exemple.be', name: 'Ana' }, amount_total: 4900, currency: 'eur', locale: 'fr' };
    if (accord) session.client_reference_id = 'renonce-retractation-20261005';
    const r = await livrer(s, venteDepuisSession(session, true));
    assert.equal(r.ok, true);
    const client = appels.find((a) => a.body.to[0] === 'ana@exemple.be');
    const interne = appels.find((a) => a.body.to[0] === 'tanguy@exemple.be');
    assert.equal(client.body.html.includes('droit de rétractation'), accord);
    assert.ok(interne.body.html.includes(accord ? 'Renonciation acceptée' : 'Non recueillie'));
    assert.equal((await lireJSON(s, 'ventes/cs_accord_' + accord, null)).renonciation, accord);
  }
});

test('PDF déposé : la présence se lit sans télécharger le fichier', async () => {
  const s = fauxMagasin();
  let lectures = 0;
  const lire = s.getWithMetadata.bind(s);
  s.getWithMetadata = async (...a) => { lectures++; return lire(...a); };
  assert.equal(await pdfDepose(s), false);
  await s.set('pdf', Buffer.from('%PDF-1.7 essai'), { metadata: {} });
  assert.equal(await pdfDepose(s), true);
  assert.equal(lectures, 0, 'aucune lecture complète du PDF');
  delete s.getMetadata;                       // stockage sans lecture de fiche : repli sur la lecture complète
  assert.equal(await pdfDepose(s), true);
  assert.equal(lectures, 1);
});

/* ---------- confirmation de commande sur support durable (CDE, art. VI.46 § 7) ---------- */
test('e-mail : une vente réelle porte la confirmation de commande, un test ou un envoi offert non', () => {
  for (const lang of ['fr', 'nl', 'en']) {
    const vente = emailLivraison({ lang, nom: 'Ana', renonciation: true, montant: 4900, devise: 'eur' });
    for (const attendu of ['49,00 €', 'Tanguy Witters', 'Avenue de la Pépinière 11', '1026.048.974', 'contact@coachtanguy.com']) {
      assert.ok(vente.html.includes(attendu) && vente.texte.includes(attendu), lang + ' : « ' + attendu + ' » absent');
    }
    const offert = emailLivraison({ lang, nom: 'Ana' });
    assert.ok(!offert.html.includes('1026.048.974') && !offert.texte.includes('1026.048.974'), lang + ' : confirmation de commande sur un envoi sans paiement');
    const test = emailLivraison({ lang, nom: 'Tanguy', renonciation: true });
    assert.ok(!test.html.includes('1026.048.974'), lang);
    assert.ok(!/[\u2014\u2013]/.test(vente.html + vente.texte), lang + ' : tiret long');
  }
  assert.ok(emailLivraison({ lang: 'fr', nom: 'Ana', montant: 0, devise: 'eur' }).html.includes('0,00 €'), 'code promo de 100 %');
});

test('e-mail : sans accord de renonciation, la vente rappelle les 14 jours ; avec accord, elle ne les promet pas', () => {
  const mots = { fr: '14 jours à compter de votre commande', nl: '14 dagen vanaf je bestelling', en: '14 days from your order' };
  for (const lang of ['fr', 'nl', 'en']) {
    const sans = emailLivraison({ lang, nom: 'Ana', renonciation: false, montant: 4900, devise: 'eur' });
    const avec = emailLivraison({ lang, nom: 'Ana', renonciation: true, montant: 4900, devise: 'eur' });
    assert.ok(sans.html.includes(mots[lang]) && sans.texte.includes(mots[lang]), lang);
    assert.ok(!avec.html.includes(mots[lang]) && !avec.texte.includes(mots[lang]), lang);
  }
});

test('avis interne : la ligne « Rétractation » dit vrai selon l\'état de l\'envoi', () => {
  const v = { id: 'cs_1', nom: 'Ana', email: 'a@exemple.be', montant: 4900, devise: 'eur', lang: 'fr' };
  assert.ok(emailInterne(Object.assign({ renonciation: true }, v), 'envoye').html.includes('confirmée dans l\'e-mail'));
  const echec = emailInterne(Object.assign({ renonciation: true, erreur: 'aucun PDF' }, v), 'echec').html;
  assert.ok(echec.includes('pas encore confirmée au client') && !echec.includes('et confirmée dans'));
  assert.ok(emailInterne(Object.assign({ renonciation: false }, v), 'envoye').html.includes('le client garde 14 jours'));
  assert.ok(!emailInterne(v, 'envoye').html.includes('Rétractation'), 'envoi manuel : pas de ligne');
});
