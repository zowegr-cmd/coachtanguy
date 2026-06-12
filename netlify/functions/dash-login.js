/* ============================================================
   Vérification du mot de passe du tableau de bord — côté serveur.
   Le mot de passe N'EST PLUS dans le code du site : il est dans la
   variable d'environnement Netlify  DASH_PASSWORD.

   ► À configurer une fois sur Netlify :
     Site configuration → Environment variables → Add variable
        Key   : DASH_PASSWORD
        Value : (ton mot de passe)
   ============================================================ */
exports.handler = async (event) => {
  const json = (code, body) => ({
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  });

  if (event.httpMethod !== 'POST') return json(405, { ok: false });

  const expected = process.env.DASH_PASSWORD;
  if (!expected) return json(500, { ok: false, error: 'DASH_PASSWORD non configuré sur Netlify.' });

  let given = '';
  try { given = (JSON.parse(event.body || '{}').password || '').toString(); } catch (e) {}

  // Comparaison à temps ~constant (évite la fuite par timing)
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  let same = a.length === b.length;
  const max = Math.max(a.length, b.length, 1);
  for (let i = 0; i < max; i++) { if ((a[i] || 0) !== (b[i] || 0)) same = false; }

  return same ? json(200, { ok: true }) : json(401, { ok: false });
};
