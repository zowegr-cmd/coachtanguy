/* Tests de la livraison automatique du programme.
   Lancer :  node --test netlify/tests/
   Aucun réseau, aucun secret : le stockage et le service d'e-mail sont simulés. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  verifierSignatureStripe, estProgramme, estPaye, langueDe, venteDepuisSession,
  emailLivraison, emailInterne, livrer, envoyerProgramme, inscrireVente, noterInconnu,
  lireJSON, memeSecret, emailValide, PLINK_RE, NOM_FICHIER,
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
  assert.deepEqual(v, { id: 'cs_live_abc123', email: 'client@exemple.be', nom: 'Marie Dupont', montant: 4900, devise: 'eur', lang: 'fr', reel: true });
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
