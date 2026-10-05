/* ============================================================
   Programme Reprise 28 jours : livraison automatique du PDF.

   Partagé par deux fonctions :
     - stripe-webhook   : appelée par Stripe à chaque paiement réussi
     - programme-admin  : appelée par le dashboard (dépôt du PDF, test, suivi des ventes)

   Où vit le PDF ? Dans Netlify Blobs, un stockage PRIVÉ rattaché au site.
   Il n'est jamais dans le dépôt GitHub (qui est public) ni servi par une URL
   du site : seule une fonction peut le lire, pour le joindre à l'e-mail.

   Variables d'environnement (Netlify > Environment variables) :
     STRIPE_WEBHOOK_SECRET   secret de signature du webhook Stripe (whsec_...)
     RESEND_API_KEY          déjà en place (formulaire de contact)
     RESEND_FROM             déjà en place, ex. "CoachTanguy <contact@coachtanguy.com>"
     CONTACT_TO              déjà en place : reçoit les notifications de vente
     DASH_PASSWORD           déjà en place : protège le panneau du dashboard
     STRIPE_PROGRAMME_PLINK  facultatif : identifiant du lien de paiement (plink_...),
                             en plus de ceux enregistrés depuis le dashboard
   ============================================================ */
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const PRODUIT = 'programme-28j';
export const NOM_FICHIER = 'Programme-Reprise-28-jours-CoachTanguy.pdf';
const SITE = 'https://coachtanguy.com';
const ORANGE = '#ff5a00';
const DARK = '#0c0c0e';
const GRAY = '#5f5f5f';
const GRAY_SOFT = '#6b6b6b';
const FONT = "'Inter','Segoe UI',Arial,Helvetica,sans-serif";

/* ------------------------------ utilitaires ------------------------------ */
export const json = (code, body) => new Response(JSON.stringify(body), {
  status: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export const ESC = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* Neutralise retours à la ligne et caractères de contrôle (anti injection d'en-tête). */
export const CLEAN = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max || 200);

export const emailValide = (s) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(String(s || '')) && String(s).length <= 254;

/* Comparaison à temps constant (mot de passe, signatures). */
export function memeSecret(a, b) {
  const x = Buffer.from(String(a == null ? '' : a));
  const y = Buffer.from(String(b == null ? '' : b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

/* ------------------------- signature du webhook Stripe ------------------------- */
/* Stripe signe chaque appel : en-tête "t=<horodatage>,v1=<hmac>" où
   hmac = HMAC-SHA256(secret, "<t>.<corps brut>"). Sans cette vérification, n'importe
   qui pourrait appeler l'adresse et se faire envoyer le programme gratuitement. */
export function verifierSignatureStripe(corps, entete, secret, opts) {
  const tolerance = (opts && opts.tolerance) || 300;
  const maintenant = (opts && opts.maintenant) || Date.now();
  if (!entete || !secret) return { ok: false, raison: 'en-tête ou secret manquant' };
  let t = null;
  const v1 = [];
  String(entete).split(',').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  });
  if (!t || !/^\d+$/.test(t) || !v1.length) return { ok: false, raison: 'en-tête mal formé' };
  const attendu = crypto.createHmac('sha256', secret).update(t + '.' + corps, 'utf8').digest('hex');
  if (!v1.some((sig) => memeSecret(sig, attendu))) return { ok: false, raison: 'signature incorrecte' };
  if (Math.abs(maintenant / 1000 - Number(t)) > tolerance) return { ok: false, raison: 'horodatage trop ancien' };
  return { ok: true };
}

/* ----------------------------- lecture d'un paiement ----------------------------- */
export const PLINK_RE = /^plink_[A-Za-z0-9]{6,80}$/;

/* Le compte Stripe vend aussi les packs visio et le suivi : on ne livre le PDF que
   pour le lien de paiement du programme (ou une session marquée produit=programme-28j). */
export function estProgramme(session, opts) {
  if (!session) return false;
  if (session.metadata && session.metadata.produit === PRODUIT) return true;
  const pl = session.payment_link;
  if (!pl) return false;
  const liste = (opts && opts.plinks) || [];
  const env = (opts && opts.envPlink) || '';
  return liste.indexOf(pl) >= 0 || (!!env && env === pl) || PLINKS_CONNUS.indexOf(pl) >= 0;
}

/* Liens de paiement du programme connus d'avance : adresse publique -> identifiant Stripe.
   L'identifiant se lit dans la page de paiement publique (ce n'est pas un secret) ;
   l'inscrire ici évite de le recopier à la main dans le dashboard.
   Si le lien change, ajouter le nouveau ici ou saisir son identifiant dans « Programme PDF ». */
export const LIENS_CONNUS = {
  'https://buy.stripe.com/bJe14p4Z54aLgC69Xi0RG0j': 'plink_1ULM0MRov04Y8GN77dJfJ2Ze',
};
export const PLINKS_CONNUS = Object.values(LIENS_CONNUS);

/* Adresse d'un lien de paiement sans ses paramètres (?locale=...) ni barre finale.
   Une valeur anormalement longue est ignorée : ce paramètre arrive d'un appel public. */
export const adresseLien = (u) => {
  const b = String(u == null ? '' : u).trim().split(/[?#]/)[0];
  return b.length > 200 ? '' : b.replace(/\/+$/, '');
};

/* Le lien de paiement affiché sur le site sera-t-il reconnu quand Stripe préviendra le site ?
   Oui s'il est connu d'avance. Sinon, seulement si un identifiant a été enregistré depuis le
   dashboard POUR CE LIEN-LÀ (lienAssocie = adresse du lien au moment de l'enregistrement) :
   un identifiant saisi pour un ancien lien n'ouvre pas la vente d'un nouveau. */
export function lienReconnu(lienSite, plinks, lienAssocie) {
  const adresse = adresseLien(lienSite);
  if (!adresse) return false;
  if (Object.prototype.hasOwnProperty.call(LIENS_CONNUS, adresse)) return true;
  return (plinks || []).length > 0 && !!lienAssocie && adresseLien(lienAssocie) === adresse;
}

/* Accord donné sur la page du site avant le paiement (case à cocher dédiée) : le client demande
   l'envoi immédiat du programme et reconnaît perdre son droit de rétractation. Le site le
   transmet à Stripe dans client_reference_id ; on le retrouve ici dans le paiement. */
export const RENONCE_RE = /^renonce-retractation-\d{8}$/;

/* L'accord n'est retenu que si sa date est celle du paiement, à un jour près (fuseaux horaires) :
   un ancien lien recopié ou transmis à quelqu'un d'autre ne vaut pas accord. */
export function accordValide(ref, creeLe) {
  const m = /^renonce-retractation-(\d{4})(\d{2})(\d{2})$/.exec(String(ref == null ? '' : ref));
  if (!m || !creeLe) return false;
  return Math.abs(Date.UTC(+m[1], +m[2] - 1, +m[3], 12) - Number(creeLe) * 1000) <= 36 * 3600 * 1000;
}

/* Payé, ou gratuit via un code promo de 100 % (cadeau à un client). */
export function estPaye(session) {
  if (!session) return false;
  if (session.payment_status === 'paid') return true;
  return session.payment_status === 'no_payment_required' && session.mode === 'payment' && Number(session.amount_total) === 0;
}

export function langueDe(session) {
  const l = String((session && session.locale) || '').toLowerCase().slice(0, 2);
  return l === 'nl' || l === 'en' ? l : 'fr';
}

export function venteDepuisSession(session, livemode) {
  const d = session.customer_details || {};
  return {
    id: String(session.id || ''),
    email: CLEAN(d.email || session.customer_email || '', 254).toLowerCase(),
    nom: CLEAN(d.name || '', 120),
    montant: Number(session.amount_total) || 0,
    devise: String(session.currency || 'eur').toLowerCase(),
    lang: langueDe(session),
    reel: livemode !== false,
    renonciation: accordValide(session.client_reference_id, session.created),
    accord: CLEAN(session.client_reference_id || '', 60),   // valeur reçue, gardée telle quelle comme trace
  };
}

/* --------------------------------- stockage --------------------------------- */
export function magasin() {
  return getStore({ name: 'programme28', consistency: 'strong' });
}

export async function lireJSON(store, cle, defaut) {
  const v = await store.get(cle, { type: 'json' });
  return v == null ? defaut : v;
}

export async function lirePdf(store) {
  const r = await store.getWithMetadata('pdf', { type: 'arrayBuffer' });
  if (!r || !r.data) return null;
  return { octets: Buffer.from(r.data), meta: r.metadata || {} };
}

/* Le PDF est-il déposé ? Lecture de sa fiche seulement, sans télécharger le fichier. */
export async function pdfDepose(store) {
  if (typeof store.getMetadata === 'function') return !!(await store.getMetadata('pdf'));
  return !!(await lirePdf(store));
}

/* La vente peut-elle ouvrir sur le site ? Seulement si un paiement sera réellement suivi
   de l'envoi du programme : PDF déposé, Stripe relié, e-mails actifs, lien reconnu. */
export async function ventePrete(store, env, lienSite) {
  const config = await lireJSON(store, 'config', {});   // lue en premier : prouve aussi que le stockage répond
  if (!env.STRIPE_WEBHOOK_SECRET || !env.RESEND_API_KEY) return false;
  if (!lienReconnu(lienSite, config.plinks || [], config.lien)) return false;
  return pdfDepose(store);
}

const MAX_INDEX = 200;
/* Journal des ventes affiché dans le dashboard : les plus récentes d'abord. */
export async function inscrireVente(store, fiche) {
  await store.setJSON('ventes/' + fiche.id, fiche);
  const index = await lireJSON(store, 'ventes-index', []);
  const reste = index.filter((v) => v.id !== fiche.id);
  reste.unshift(fiche);
  reste.sort((a, b) => String(b.creeLe).localeCompare(String(a.creeLe)));
  await store.setJSON('ventes-index', reste.slice(0, MAX_INDEX));
}

/* Paiements reçus mais non reconnus comme le programme : aucune donnée personnelle,
   juste de quoi aider au réglage (quel lien de paiement, quel montant, quand). */
export async function noterInconnu(store, session) {
  const liste = await lireJSON(store, 'inconnus', []);
  const item = {
    plink: String(session.payment_link || ''),
    montant: Number(session.amount_total) || 0,
    devise: String(session.currency || 'eur').toLowerCase(),
    le: new Date().toISOString(),
  };
  const reste = liste.filter((x) => x.plink !== item.plink);
  reste.unshift(item);
  await store.setJSON('inconnus', reste.slice(0, 8));
}

/* ----------------------------------- e-mails ----------------------------------- */
const TXT = {
  fr: {
    sujet: 'Votre programme Reprise 28 jours est arrivé',
    preheader: 'Votre programme est en pièce jointe. Voici comment bien démarrer.',
    bonjour: (n) => (n ? 'Merci ' + n + ' !' : 'Merci pour votre achat !'),
    intro: 'Votre <strong>programme Reprise 28 jours</strong> est en pièce jointe de cet e-mail, au format PDF. Enregistrez-le sur votre téléphone pour l\'avoir toujours sous la main.',
    etapesTitre: 'Pour bien démarrer',
    etapes: [
      'Ouvrez le PDF et lisez la page « Comment utiliser le programme ».',
      'Repérez votre première séance dans le calendrier des 28 jours.',
      'Commencez par le niveau 1, puis passez au niveau 2 quand tout est propre et sans douleur.',
    ],
    aide: 'Une question, un doute sur un exercice ? Répondez simplement à cet e-mail, je vous lis.',
    signature: 'Bonne reprise,',
    bouton: 'Découvrir le suivi en ligne',
    suite: 'Et après les 28 jours ? Un suivi en ligne construit autour de vos objectifs prend le relais.',
    suiviUrl: SITE + '/suivi-en-ligne.html',
    footer: 'CoachTanguy · Le sport facile, partout et à tout moment.',
    legal: 'Vous recevez cet e-mail à la suite de votre achat sur coachtanguy.com',
    privacy: 'Confidentialité',
    privacyUrl: SITE + '/politique-confidentialite.html',
    piece: 'Pièce jointe',
    renonce: 'Confirmation : lors de votre commande, vous avez demandé à recevoir le programme dès votre paiement et accepté de ne plus pouvoir annuler votre achat une fois le programme reçu (perte du droit de rétractation).',
    commande: (prix) => 'Confirmation de votre commande : Programme Reprise 28 jours, fichier PDF en français joint à cet e-mail, lisible sur téléphone, tablette ou ordinateur. Prix payé : ' + prix + ', toutes taxes comprises, paiement unique, sans abonnement. Vendeur : Tanguy Witters (CoachTanguy), Avenue de la Pépinière 11, 1640 Rhode-Saint-Genèse, Belgique, numéro d\'entreprise 1026.048.974, contact@coachtanguy.com, +32 472 76 16 39. Vous bénéficiez de la garantie légale de conformité applicable aux contenus numériques : si le fichier ne s\'ouvre pas ou est incomplet, répondez à cet e-mail, il vous est renvoyé ou corrigé sans frais. Une réclamation restée sans solution peut être portée devant le Service de Médiation pour le Consommateur.',
    delai: 'Vous disposez de 14 jours à compter de votre commande pour vous rétracter, sans motif, sur simple message à contact@coachtanguy.com.',
  },
  nl: {
    sujet: 'Je Herstartprogramma 28 dagen is er',
    preheader: 'Je programma zit in de bijlage. Zo start je goed.',
    bonjour: (n) => (n ? 'Bedankt ' + n + '!' : 'Bedankt voor je aankoop!'),
    intro: 'Je <strong>Herstartprogramma 28 dagen</strong> zit als pdf in de bijlage van deze e-mail. Bewaar het op je telefoon, zo heb je het altijd bij de hand. Het programma is in het Frans opgesteld.',
    etapesTitre: 'Zo start je goed',
    etapes: [
      'Open de pdf en lees de pagina « Comment utiliser le programme ».',
      'Zoek je eerste sessie in de kalender van de 28 dagen.',
      'Begin met niveau 1 en stap over naar niveau 2 zodra alles vlot en pijnvrij gaat.',
    ],
    aide: 'Een vraag of twijfel over een oefening? Antwoord gewoon op deze e-mail, ik lees je bericht.',
    signature: 'Veel succes,',
    bouton: 'Ontdek de online opvolging',
    suite: 'En na de 28 dagen? Een online opvolging op maat van je doelen neemt het over.',
    suiviUrl: SITE + '/nl/suivi-en-ligne.html',
    footer: 'CoachTanguy · Sporten wordt makkelijk, overal en altijd.',
    legal: 'Je ontvangt deze e-mail naar aanleiding van je aankoop op coachtanguy.com',
    privacy: 'Privacy',
    privacyUrl: SITE + '/nl/politique-confidentialite.html',
    piece: 'Bijlage',
    renonce: 'Bevestiging: bij je bestelling heb je gevraagd om het programma meteen na je betaling te ontvangen en aanvaard dat je je aankoop niet meer kan annuleren zodra je het programma hebt ontvangen (verlies van het herroepingsrecht).',
    commande: (prix) => 'Bevestiging van je bestelling: Herstartprogramma 28 dagen, pdf-bestand in het Frans in de bijlage van deze e-mail, leesbaar op telefoon, tablet of computer. Betaalde prijs: ' + prix + ', alle taksen inbegrepen, eenmalige betaling, geen abonnement. Verkoper: Tanguy Witters (CoachTanguy), Avenue de la Pépinière 11, 1640 Sint-Genesius-Rode, België, ondernemingsnummer 1026.048.974, contact@coachtanguy.com, +32 472 76 16 39. Je geniet de wettelijke conformiteitsgarantie voor digitale inhoud: als het bestand niet opent of onvolledig is, antwoord op deze e-mail en je krijgt het kosteloos opnieuw of verbeterd. Een klacht zonder oplossing kan je voorleggen aan de Consumentenombudsdienst.',
    delai: 'Je hebt 14 dagen vanaf je bestelling om zonder opgave van reden van je aankoop af te zien, met een eenvoudig bericht aan contact@coachtanguy.com.',
  },
  en: {
    sujet: 'Your 28-Day Restart Programme has arrived',
    preheader: 'Your programme is attached. Here is how to get started.',
    bonjour: (n) => (n ? 'Thank you ' + n + '!' : 'Thank you for your purchase!'),
    intro: 'Your <strong>28-Day Restart Programme</strong> is attached to this e-mail as a PDF. Save it on your phone so you always have it with you. The programme is written in French.',
    etapesTitre: 'Getting started',
    etapes: [
      'Open the PDF and read the page « Comment utiliser le programme ».',
      'Find your first session in the 28-day calendar.',
      'Start with level 1, then move to level 2 once everything feels clean and pain-free.',
    ],
    aide: 'A question or a doubt about an exercise? Simply reply to this e-mail, I read every message.',
    signature: 'Enjoy your comeback,',
    bouton: 'Discover the online follow-up',
    suite: 'And after the 28 days? An online follow-up built around your goals takes over.',
    suiviUrl: SITE + '/en/suivi-en-ligne.html',
    footer: 'CoachTanguy · Sport made easy, anywhere, anytime.',
    legal: 'You are receiving this e-mail following your purchase on coachtanguy.com',
    privacy: 'Privacy',
    privacyUrl: SITE + '/en/politique-confidentialite.html',
    piece: 'Attachment',
    renonce: 'Confirmation: when ordering, you asked to receive the programme as soon as you had paid and accepted that you can no longer cancel your purchase once you have received it (loss of the right of withdrawal).',
    commande: (prix) => 'Order confirmation: 28-Day Restart Programme, PDF file in French attached to this e-mail, readable on phone, tablet or computer. Price paid: ' + prix + ', all taxes included, one-off payment, no subscription. Seller: Tanguy Witters (CoachTanguy), Avenue de la Pépinière 11, 1640 Rhode-Saint-Genèse, Belgium, company number 1026.048.974, contact@coachtanguy.com, +32 472 76 16 39. You benefit from the legal guarantee of conformity for digital content: if the file does not open or is incomplete, reply to this e-mail and it will be sent again or corrected free of charge. An unresolved complaint can be referred to the Belgian Consumer Mediation Service.',
    delai: 'You have 14 days from your order to cancel your purchase, without giving a reason, by sending a message to contact@coachtanguy.com.',
  },
};

function gabarit(titre, preheader, lang, inner) {
  return '<!DOCTYPE html>'
    + '<html lang="' + lang + '"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">'
    + '<title>' + ESC(titre) + '</title></head>'
    + '<body style="margin:0;padding:0;background-color:#f5f4f2;">'
    + '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' + ESC(preheader) + '&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f4f2;">'
    + '<tr><td align="center" style="padding:28px 14px;">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">'
    + inner
    + '</table></td></tr></table></body></html>';
}

function entete() {
  return '<tr><td style="background-color:' + DARK + ';border-radius:16px 16px 0 0;border-top:4px solid ' + ORANGE + ';padding:24px 0;" align="center">'
    + '<a href="' + SITE + '" target="_blank" style="text-decoration:none;">'
    + '<img src="' + SITE + '/assets/email-logo.png" width="170" alt="CoachTanguy" '
    + 'style="display:block;width:170px;height:auto;border:0;color:#ffffff;font-family:' + FONT + ';font-size:18px;font-weight:700;">'
    + '</a></td></tr>';
}

function pied(t) {
  return '<tr><td align="center" style="padding:22px 24px 6px;">'
    + '<p style="margin:0;font-family:' + FONT + ';font-size:12.5px;line-height:1.6;color:' + GRAY_SOFT + ';">' + ESC(t.footer) + '</p>'
    + '<p style="margin:8px 0 0;font-family:' + FONT + ';font-size:12px;line-height:1.6;color:' + GRAY_SOFT + ';">' + ESC(t.legal) + ' · '
    + '<a href="' + t.privacyUrl + '" target="_blank" style="color:' + GRAY_SOFT + ';text-decoration:underline;">' + ESC(t.privacy) + '</a></p>'
    + '</td></tr>';
}

const P = 'margin:0 0 16px;font-family:' + FONT + ';font-size:16px;line-height:1.65;color:#2a2a2a;';

/* E-mail reçu par l'acheteur : le PDF est en pièce jointe. */
export function emailLivraison(opts) {
  const lang = TXT[opts && opts.lang] ? opts.lang : 'fr';
  const t = TXT[lang];
  const prenom = CLEAN(((opts && opts.nom) || '').split(' ')[0], 40);
  const renonce = !!(opts && opts.renonciation);   // confirmation écrite de l'accord donné à la commande
  /* Vente réelle (montant connu) : l'e-mail vaut aussi confirmation du contrat sur support durable.
     Sans accord de renonciation, on rappelle au client qu'il garde 14 jours pour se rétracter. */
  const vraieVente = !!(opts && opts.montant != null);
  const mentions = [];
  if (vraieVente) mentions.push(t.commande(euros(opts.montant, opts.devise)));
  if (renonce) mentions.push(t.renonce); else if (vraieVente) mentions.push(t.delai);
  const etapes = t.etapes.map((e, i) => (
    '<tr><td valign="top" width="34" style="padding:0 0 12px;">'
    + '<div style="width:26px;height:26px;border-radius:13px;background-color:' + ORANGE + ';color:#ffffff;font-family:' + FONT + ';font-size:13px;font-weight:700;line-height:26px;text-align:center;">' + (i + 1) + '</div></td>'
    + '<td valign="top" style="padding:2px 0 12px;font-family:' + FONT + ';font-size:15.5px;line-height:1.55;color:#2a2a2a;">' + ESC(e) + '</td></tr>'
  )).join('');
  const inner = entete()
    + '<tr><td style="background-color:#ffffff;padding:36px 34px 30px;border-radius:0 0 16px 16px;">'
    + '<h1 style="margin:0 0 18px;font-family:' + FONT + ';font-size:26px;line-height:1.2;font-weight:800;color:' + DARK + ';">' + ESC(t.bonjour(prenom)) + '</h1>'
    + '<p style="' + P + '">' + t.intro + '</p>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;"><tr>'
    + '<td style="background-color:#fff5ee;border-left:4px solid ' + ORANGE + ';border-radius:0 10px 10px 0;padding:14px 16px;font-family:' + FONT + ';font-size:14.5px;line-height:1.5;color:#3a3a3a;">'
    + '<strong style="color:' + DARK + ';">' + ESC(t.piece) + ' :</strong> ' + ESC(NOM_FICHIER) + '</td></tr></table>'
    + '<p style="margin:0 0 12px;font-family:' + FONT + ';font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + ORANGE + ';">' + ESC(t.etapesTitre) + '</p>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">' + etapes + '</table>'
    + '<p style="' + P + '">' + ESC(t.aide) + '</p>'
    + '<p style="margin:0;font-family:' + FONT + ';font-size:16px;line-height:1.6;color:#2a2a2a;">' + ESC(t.signature) + '<br><strong style="color:' + DARK + ';">Tanguy</strong></p>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;border-top:1px solid #ecebe8;"><tr>'
    + '<td style="padding-top:20px;font-family:' + FONT + ';font-size:14px;line-height:1.55;color:' + GRAY + ';">' + ESC(t.suite) + ' '
    + '<a href="' + t.suiviUrl + '" target="_blank" style="color:' + ORANGE + ';font-weight:700;text-decoration:none;">' + ESC(t.bouton) + '</a></td></tr></table>'
    + mentions.map((x, i) => '<p style="margin:' + (i ? 10 : 22) + 'px 0 0;font-family:' + FONT + ';font-size:13px;line-height:1.55;color:' + GRAY + ';">' + ESC(x) + '</p>').join('')
    + '</td></tr>'
    + pied(t);
  const texte = [t.bonjour(prenom), '', t.intro.replace(/<[^>]+>/g, ''), '', t.piece + ' : ' + NOM_FICHIER, '', t.etapesTitre + ' :']
    .concat(t.etapes.map((e, i) => (i + 1) + '. ' + e))
    .concat(['', t.aide, '', t.signature, 'Tanguy', '', t.suite + ' ' + t.suiviUrl])
    .concat(mentions.length ? [''].concat(mentions) : [])
    .join('\n');
  return { sujet: t.sujet, html: gabarit(t.sujet, t.preheader, lang, inner), texte };
}

const euros = (centimes, devise) => (Number(centimes) / 100).toFixed(2).replace('.', ',') + ' ' + (String(devise || 'eur').toUpperCase() === 'EUR' ? '€' : String(devise).toUpperCase());

function ligne(k, v) {
  return '<tr><td style="padding:7px 0;font-family:' + FONT + ';font-size:14px;color:' + GRAY + ';width:130px;" valign="top">' + ESC(k) + '</td>'
    + '<td style="padding:7px 0;font-family:' + FONT + ';font-size:15px;color:' + DARK + ';font-weight:600;" valign="top">' + v + '</td></tr>';
}

/* E-mail reçu par Tanguy : une vente, ou une vente qui n'a pas pu être livrée. */
export function emailInterne(vente, etat) {
  const ok = etat === 'envoye';
  const titre = ok ? 'Nouvelle vente : Programme 28 jours' : 'Vente reçue, mais le programme n\'est pas parti';
  const message = ok
    ? 'Le PDF a été envoyé automatiquement au client. Rien à faire.'
    : 'Motif : ' + ESC(vente.erreur || 'inconnu') + '. Dès que c\'est corrigé, l\'envoi repart tout seul (Stripe réessaie pendant 3 jours). Tu peux aussi l\'envoyer à la main depuis le dashboard, bouton « Programme PDF ».';
  const inner = entete()
    + '<tr><td style="background-color:#ffffff;padding:32px 34px;border-radius:0 0 16px 16px;">'
    + '<h1 style="margin:0 0 14px;font-family:' + FONT + ';font-size:22px;line-height:1.25;font-weight:800;color:' + (ok ? DARK : '#b42318') + ';">' + ESC(titre) + '</h1>'
    + '<p style="' + P + '">' + message + '</p>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #ecebe8;margin-top:6px;">'
    + ligne('Client', ESC(vente.nom || 'Nom non communiqué'))
    + ligne('E-mail', vente.email ? '<a href="mailto:' + ESC(vente.email) + '" style="color:' + ORANGE + ';text-decoration:none;">' + ESC(vente.email) + '</a>' : 'absent')
    + ligne('Montant', ESC(euros(vente.montant, vente.devise)))
    + ligne('Langue', ESC(String(vente.lang || 'fr').toUpperCase()))
    + (typeof vente.renonciation === 'boolean' ? ligne('Rétractation', vente.renonciation ? (ok ? 'Renonciation acceptée à la commande et confirmée dans l\'e-mail' : 'Renonciation acceptée à la commande, pas encore confirmée au client : la confirmation part avec le programme (relance automatique ou bouton « Renvoyer »)') : 'Non recueillie (achat passé hors de la page du site) : le client garde 14 jours pour se rétracter et être remboursé') : '')
    + '</table></td></tr>'
    + pied({ footer: 'Notification automatique du site coachtanguy.com', legal: 'Envoi du programme Reprise 28 jours', privacy: 'Dashboard', privacyUrl: SITE + '/dashboard.html' });
  const sujet = (ok ? '✅ Vente Programme 28 jours' : '⚠️ Programme non envoyé') + ' · ' + (vente.nom || vente.email || 'client');
  return { sujet, html: gabarit(titre, message.replace(/<[^>]+>/g, ''), 'fr', inner) };
}

/* ---------------------------------- envoi ---------------------------------- */
/* Un 429/5xx est retenté une fois. La clé d'idempotence empêche Resend d'envoyer
   deux fois le même e-mail si Stripe rappelle la fonction. */
export async function envoyerEmail(payload, cleIdempotence) {
  const url = process.env.RESEND_API_URL || 'https://api.resend.com/emails'; // RESEND_API_URL : uniquement pour les tests locaux
  const cle = process.env.RESEND_API_KEY;
  if (!cle) return { ok: false, erreur: 'RESEND_API_KEY non configurée' };
  const headers = { 'Authorization': 'Bearer ' + cle, 'Content-Type': 'application/json' };
  if (cleIdempotence) headers['Idempotency-Key'] = cleIdempotence;
  const post = () => fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  try {
    let r = await post();
    if (r.status === 429 || r.status >= 500) {
      const attente = Math.min(Number(r.headers.get('retry-after')) || 1, 5) * 1000;
      await new Promise((res) => setTimeout(res, attente));
      r = await post();
    }
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      console.error('Resend', r.status, detail);
      return { ok: false, erreur: 'Resend a refusé l\'envoi (code ' + r.status + ')' };
    }
    return { ok: true };
  } catch (e) {
    console.error('Resend injoignable', e);
    return { ok: false, erreur: 'service d\'e-mail injoignable' };
  }
}

const expediteur = () => process.env.RESEND_FROM || 'CoachTanguy <onboarding@resend.dev>';

export async function prevenirTanguy(vente, etat) {
  const to = process.env.CONTACT_TO;
  if (!to) return;
  const m = emailInterne(vente, etat);
  await envoyerEmail({ from: expediteur(), to: [to], subject: m.sujet, html: m.html });
}

/* Envoie le programme à une adresse. Renvoie { ok } ou { ok:false, erreur }. */
export async function envoyerProgramme(store, dest) {
  if (!emailValide(dest.email)) return { ok: false, erreur: 'adresse e-mail invalide' };
  const pdf = await lirePdf(store);
  if (!pdf) return { ok: false, erreur: 'aucun PDF déposé dans le dashboard', pdfAbsent: true };
  const m = emailLivraison({ lang: dest.lang, nom: dest.nom, renonciation: dest.renonciation, montant: dest.montant, devise: dest.devise });
  const payload = {
    from: expediteur(),
    to: [dest.email],
    subject: (dest.prefixe || '') + m.sujet,
    html: m.html,
    text: m.texte,
    attachments: [{ filename: NOM_FICHIER, content: pdf.octets.toString('base64') }],
  };
  if (process.env.CONTACT_TO) payload.reply_to = process.env.CONTACT_TO;
  return envoyerEmail(payload, dest.cle);
}

/* Livraison d'une vente Stripe. Sûre à rappeler : une vente déjà livrée n'est jamais renvoyée. */
export async function livrer(store, vente) {
  const cle = 'ventes/' + vente.id;
  const deja = await lireJSON(store, cle, null);
  if (deja && deja.statut === 'envoye') return { ok: true, deja: true };
  const fiche = Object.assign({ creeLe: new Date().toISOString(), tentatives: 0 }, deja || {}, vente);
  fiche.tentatives += 1;
  fiche.statut = 'attente';

  const r = vente.email
    ? await envoyerProgramme(store, { email: vente.email, nom: vente.nom, lang: vente.lang, renonciation: vente.renonciation, montant: vente.montant, devise: vente.devise, cle: 'prog28-' + vente.id })
    : { ok: false, erreur: 'le paiement ne contient pas d\'adresse e-mail', definitif: true };

  if (r.ok) {
    fiche.statut = 'envoye';
    fiche.envoyeLe = new Date().toISOString();
    delete fiche.erreur;
    await inscrireVente(store, fiche);
    await prevenirTanguy(fiche, 'envoye');
    return { ok: true };
  }
  fiche.erreur = r.erreur;
  await inscrireVente(store, fiche);
  if (fiche.tentatives === 1) await prevenirTanguy(fiche, 'echec'); // une seule alerte, pas une par nouvel essai
  // "definitif" : réessayer ne changera rien, on ne demande pas à Stripe de rappeler.
  return { ok: false, erreur: r.erreur, reessayer: !r.definitif };
}
