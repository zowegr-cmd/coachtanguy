/* ============================================================
   Netlify Forms → Resend
   Cette fonction est appelée AUTOMATIQUEMENT par Netlify à chaque
   soumission d'un formulaire (nom réservé "submission-created").

   Elle envoie 2 e-mails via Resend :
     1. À Tanguy : le contenu du message reçu.
     2. Au visiteur : un accusé de réception automatique.

   ► Variables d'environnement à configurer sur Netlify :
       RESEND_API_KEY   clé API Resend (re_xxx)
       RESEND_FROM      expéditeur vérifié, ex: "CoachTanguy <contact@coachtanguy.com>"
       CONTACT_TO       destinataire des notifications, ex: contact@coachtanguy.com
   Si RESEND_API_KEY est absente, la fonction ne fait rien (pas d'erreur).
   ============================================================ */
const ESC = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function send(payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) console.error('Resend error', r.status, await r.text());
  return r.ok;
}

exports.handler = async (event) => {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY absente — aucun e-mail envoyé.');
    return { statusCode: 200, body: 'skipped' };
  }

  let data = {};
  try { data = (JSON.parse(event.body || '{}').payload || {}).data || {}; } catch (e) {}

  // Ne traite que le formulaire de contact
  const name = data.name || '';
  const email = (data.email || '').trim();
  const subject = data.subject || 'Contact';
  const message = data.message || '';
  if (!email && !message) return { statusCode: 200, body: 'no-data' };

  const FROM = process.env.RESEND_FROM || 'CoachTanguy <onboarding@resend.dev>';
  const TO = process.env.CONTACT_TO || email;

  // 1) Notification à Tanguy
  await send({
    from: FROM,
    to: [TO],
    reply_to: email || undefined,
    subject: '📩 Nouveau message — ' + ESC(subject) + ' (' + ESC(name) + ')',
    html:
      '<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#141414">' +
      '<h2 style="color:#ff5a00;margin:0 0 12px">Nouveau message via coachtanguy.com</h2>' +
      '<p><strong>Nom :</strong> ' + ESC(name) + '</p>' +
      '<p><strong>E-mail :</strong> ' + ESC(email) + '</p>' +
      '<p><strong>Sujet :</strong> ' + ESC(subject) + '</p>' +
      '<p><strong>Message :</strong></p>' +
      '<p style="white-space:pre-wrap;background:#f5f4f2;border-radius:8px;padding:14px">' + ESC(message) + '</p>' +
      '</div>',
  });

  // 2) Accusé de réception au visiteur
  if (email) {
    await send({
      from: FROM,
      to: [email],
      subject: 'Bien reçu — CoachTanguy',
      html:
        '<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#141414">' +
        '<h2 style="color:#ff5a00;margin:0 0 12px">Merci ' + ESC(name) + ' !</h2>' +
        '<p>J\'ai bien reçu votre message et je reviens vers vous <strong>dans la journée</strong>.</p>' +
        '<p>À très vite,<br>Tanguy — CoachTanguy</p>' +
        '<hr style="border:none;border-top:1px solid #e6e4e1;margin:18px 0">' +
        '<p style="font-size:13px;color:#8a8a8a">Vous recevez cet e-mail car vous avez écrit via coachtanguy.com. ' +
        'Si ce n\'est pas vous, ignorez simplement ce message.</p>' +
        '</div>',
    });
  }

  return { statusCode: 200, body: 'sent' };
};
