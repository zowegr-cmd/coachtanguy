/* ============================================================
   Panneau « Programme PDF » du dashboard.

   Protégé par le mot de passe du dashboard (DASH_PASSWORD). Permet de :
     - déposer ou remplacer le PDF du programme (stockage privé Netlify Blobs) ;
     - enregistrer le lien de paiement Stripe qui vend le programme ;
     - s'envoyer un e-mail de test, renvoyer ou offrir le programme à une adresse ;
     - voir les dernières ventes et l'état de préparation du système.

   Le PDF est envoyé par morceaux : une fonction Netlify n'accepte pas plus de
   6 Mo par appel, un PDF peut en peser davantage.
   ============================================================ */
import crypto from 'node:crypto';
import {
  json, memeSecret, CLEAN, emailValide, PLINK_RE, NOM_FICHIER,
  magasin, lireJSON, lirePdf, inscrireVente, envoyerProgramme,
} from '../lib/programme.mjs';

const MAX_MORCEAU = 3.5 * 1024 * 1024;   // octets décodés par appel
const MAX_PDF = 18 * 1024 * 1024;        // au-delà, trop de boîtes mail refusent la pièce jointe
const MAX_MORCEAUX = 40;
const ENVOI_RE = /^[a-z0-9]{8,40}$/;
const cleMorceau = (envoi, i) => 'tmp/' + envoi + '/' + String(i).padStart(3, '0');

const versArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

async function etat(store) {
  const pdf = await lirePdf(store);
  const config = await lireJSON(store, 'config', {});
  const ventes = await lireJSON(store, 'ventes-index', []);
  const inconnus = await lireJSON(store, 'inconnus', []);
  const plinks = config.plinks || [];
  return {
    ok: true,
    pdf: pdf ? pdf.meta : null,
    plinks,
    pret: {
      pdf: !!pdf,
      webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
      lien: plinks.length > 0 || !!process.env.STRIPE_PROGRAMME_PLINK,
      email: !!process.env.RESEND_API_KEY,
      expediteur: process.env.RESEND_FROM || '',
      notif: !!process.env.CONTACT_TO,
    },
    ventes: ventes.slice(0, 40),
    inconnus: inconnus.filter((x) => plinks.indexOf(x.plink) < 0),
  };
}

export default async (req) => {
  /* Appel sans mot de passe : dit seulement si la fonction et le stockage répondent. */
  if (req.method === 'GET') {
    try { await magasin().get('config'); return json(200, { ok: true, stockage: true }); }
    catch (e) { return json(200, { ok: true, stockage: false }); }
  }
  if (req.method !== 'POST') return json(405, { ok: false, erreur: 'Méthode non autorisée.' });

  const attendu = process.env.DASH_PASSWORD;
  if (!attendu) return json(500, { ok: false, erreur: 'DASH_PASSWORD non configuré sur Netlify.' });

  let p = {};
  try { p = JSON.parse((await req.text()) || '{}'); } catch (e) { return json(400, { ok: false, erreur: 'JSON invalide.' }); }
  if (!memeSecret(p.password || '', attendu)) return json(401, { ok: false, erreur: 'Mot de passe incorrect.' });

  try {
    const store = magasin();
    const action = String(p.action || 'etat');

    if (action === 'etat') return json(200, await etat(store));

    /* ---- dépôt du PDF, morceau par morceau ---- */
    if (action === 'morceau') {
      const i = Number(p.index);
      if (!ENVOI_RE.test(p.envoi || '') || !Number.isInteger(i) || i < 0 || i >= MAX_MORCEAUX) return json(400, { ok: false, erreur: 'Morceau invalide.' });
      const octets = Buffer.from(String(p.data || ''), 'base64');
      if (!octets.length || octets.length > MAX_MORCEAU) return json(400, { ok: false, erreur: 'Morceau vide ou trop gros.' });
      await store.set(cleMorceau(p.envoi, i), versArrayBuffer(octets));
      return json(200, { ok: true, recu: i });
    }

    if (action === 'finaliser') {
      const total = Number(p.total);
      if (!ENVOI_RE.test(p.envoi || '') || !Number.isInteger(total) || total < 1 || total > MAX_MORCEAUX) return json(400, { ok: false, erreur: 'Envoi invalide.' });
      const parts = [];
      for (let i = 0; i < total; i++) {
        const ab = await store.get(cleMorceau(p.envoi, i), { type: 'arrayBuffer' });
        if (!ab) return json(400, { ok: false, erreur: 'Il manque un morceau du fichier (' + (i + 1) + '/' + total + '). Recommence le dépôt.' });
        parts.push(Buffer.from(ab));
      }
      const pdf = Buffer.concat(parts);
      const menage = async () => { for (let i = 0; i < total; i++) await store.delete(cleMorceau(p.envoi, i)); };
      if (pdf.length !== Number(p.taille)) { await menage(); return json(400, { ok: false, erreur: 'Le fichier reçu est incomplet. Recommence le dépôt.' }); }
      if (pdf.length > MAX_PDF) { await menage(); return json(400, { ok: false, erreur: 'PDF trop lourd (' + (pdf.length / 1048576).toFixed(1) + ' Mo). Maximum : 18 Mo, sinon les boîtes mail refusent la pièce jointe.' }); }
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') { await menage(); return json(400, { ok: false, erreur: 'Ce fichier n\'est pas un PDF.' }); }
      const meta = {
        nom: CLEAN(p.nom || NOM_FICHIER, 140),
        taille: pdf.length,
        empreinte: crypto.createHash('sha256').update(pdf).digest('hex').slice(0, 16),
        deposeLe: new Date().toISOString(),
      };
      await store.set('pdf', versArrayBuffer(pdf), { metadata: meta });
      await menage();
      return json(200, { ok: true, pdf: meta });
    }

    /* ---- lien de paiement Stripe qui vend le programme ---- */
    if (action === 'liens') {
      const liste = (Array.isArray(p.plinks) ? p.plinks : []).map((x) => String(x).trim()).filter(Boolean);
      const mauvais = liste.filter((x) => !PLINK_RE.test(x));
      if (mauvais.length) return json(400, { ok: false, erreur: 'Identifiant invalide : « ' + CLEAN(mauvais[0], 60) + ' ». Il doit commencer par plink_' });
      const config = await lireJSON(store, 'config', {});
      config.plinks = Array.from(new Set(liste)).slice(0, 10);
      await store.setJSON('config', config);
      return json(200, await etat(store));
    }

    /* ---- envois manuels ---- */
    if (action === 'test') {
      const to = process.env.CONTACT_TO;
      if (!to) return json(400, { ok: false, erreur: 'CONTACT_TO non configuré : je ne sais pas à quelle adresse envoyer le test.' });
      const r = await envoyerProgramme(store, { email: to, nom: 'Tanguy', lang: p.lang, prefixe: '[TEST] ' });
      return json(r.ok ? 200 : 400, r.ok ? { ok: true, envoyeA: to } : { ok: false, erreur: r.erreur });
    }

    if (action === 'envoyer') {
      const email = CLEAN(p.email, 254).toLowerCase();
      if (!emailValide(email)) return json(400, { ok: false, erreur: 'Adresse e-mail invalide.' });
      const lang = ['fr', 'nl', 'en'].indexOf(p.lang) >= 0 ? p.lang : 'fr';
      const r = await envoyerProgramme(store, { email, nom: CLEAN(p.nom, 120), lang });
      if (!r.ok) return json(400, { ok: false, erreur: r.erreur });
      const maintenant = new Date().toISOString();
      await inscrireVente(store, {
        id: 'manuel-' + Date.now().toString(36), email, nom: CLEAN(p.nom, 120), montant: 0, devise: 'eur', lang,
        manuel: true, statut: 'envoye', creeLe: maintenant, envoyeLe: maintenant, tentatives: 1,
      });
      return json(200, await etat(store));
    }

    if (action === 'renvoyer') {
      const id = CLEAN(p.id, 120);
      const fiche = await lireJSON(store, 'ventes/' + id, null);
      if (!fiche) return json(404, { ok: false, erreur: 'Vente introuvable.' });
      const r = await envoyerProgramme(store, { email: fiche.email, nom: fiche.nom, lang: fiche.lang });
      if (!r.ok) return json(400, { ok: false, erreur: r.erreur });
      fiche.statut = 'envoye';
      fiche.envoyeLe = new Date().toISOString();
      fiche.renvois = (fiche.renvois || 0) + 1;
      delete fiche.erreur;
      await inscrireVente(store, fiche);
      return json(200, await etat(store));
    }

    return json(400, { ok: false, erreur: 'Action inconnue.' });
  } catch (e) {
    console.error('programme-admin', e);
    return json(500, { ok: false, erreur: 'Erreur interne : ' + (e && e.message ? e.message : String(e)) });
  }
};
