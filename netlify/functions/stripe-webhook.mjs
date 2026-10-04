/* ============================================================
   Stripe > Netlify : envoi automatique du programme après paiement.

   Stripe appelle cette adresse à chaque paiement réussi :
     https://www.coachtanguy.com/.netlify/functions/stripe-webhook
   (événements : checkout.session.completed
                 checkout.session.async_payment_succeeded)

   Déroulé :
     1. On vérifie que l'appel vient bien de Stripe (signature).
     2. On ne garde que les paiements du lien « Programme 28 jours ».
     3. On envoie le PDF par e-mail à l'acheteur (pièce jointe, via Resend).
     4. On note la vente et on prévient Tanguy.

   Si quelque chose empêche l'envoi (PDF pas encore déposé, service d'e-mail en
   panne), on répond en erreur : Stripe rappelle alors tout seul pendant 3 jours,
   et l'e-mail part dès que c'est réparé. Une vente déjà livrée n'est jamais
   renvoyée une seconde fois.
   ============================================================ */
import {
  json, verifierSignatureStripe, estProgramme, estPaye, venteDepuisSession,
  magasin, lireJSON, noterInconnu, livrer,
} from '../lib/programme.mjs';

const TYPES = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, erreur: 'Méthode non autorisée.' });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json(500, { ok: false, erreur: 'STRIPE_WEBHOOK_SECRET non configuré sur Netlify.' });

  const corps = await req.text();
  const v = verifierSignatureStripe(corps, req.headers.get('stripe-signature'), secret);
  if (!v.ok) return json(400, { ok: false, erreur: 'Signature Stripe refusée : ' + v.raison + '.' });

  let evt;
  try { evt = JSON.parse(corps); } catch (e) { return json(400, { ok: false, erreur: 'JSON invalide.' }); }
  if (!evt || TYPES.indexOf(evt.type) < 0) return json(200, { ok: true, ignore: 'événement non concerné' });

  const session = evt.data && evt.data.object;
  if (!session || !session.id) return json(200, { ok: true, ignore: 'session absente' });

  try {
    const store = magasin();
    const config = await lireJSON(store, 'config', {});
    const reconnu = estProgramme(session, { plinks: config.plinks || [], envPlink: process.env.STRIPE_PROGRAMME_PLINK });
    if (!reconnu) {
      if (estPaye(session) && session.payment_link) await noterInconnu(store, session);
      return json(200, { ok: true, ignore: 'autre produit' });
    }
    if (!estPaye(session)) return json(200, { ok: true, ignore: 'paiement pas encore confirmé' });

    const r = await livrer(store, venteDepuisSession(session, evt.livemode));
    if (r.ok) return json(200, { ok: true, livre: true, deja: !!r.deja });
    // 500 = Stripe réessaiera plus tard ; 200 = inutile de réessayer.
    return json(r.reessayer ? 500 : 200, { ok: false, erreur: r.erreur });
  } catch (e) {
    console.error('stripe-webhook', e);
    return json(500, { ok: false, erreur: 'Erreur interne : ' + (e && e.message ? e.message : String(e)) });
  }
};
