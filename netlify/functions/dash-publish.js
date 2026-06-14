/* ============================================================
   Publication des textes du dashboard → GitHub → Netlify redéploie.

   Le dashboard envoie { password, files:{ "content/fr.js": "...", ... } }.
   On vérifie le mot de passe (DASH_PASSWORD), puis on écrit les fichiers
   sur GitHub en UN SEUL commit (API Git Data) sur la branche du site.
   Pousser sur la branche déclenche le redéploiement Netlify automatique.

   ► Variables d'environnement Netlify à configurer (Site configuration →
     Environment variables) :
       DASH_PASSWORD  : (déjà configuré — le mot de passe du dashboard)
       GITHUB_TOKEN   : un "fine-grained token" GitHub avec la permission
                        Contents = Read and write sur le dépôt coachtanguy.
       GITHUB_REPO    : (optionnel) défaut "zowegr-cmd/coachtanguy"
       GITHUB_BRANCH  : (optionnel) défaut "master"

   Sécurité : seuls les fichiers content/*.js peuvent être écrits ; le token
   n'est jamais envoyé au navigateur.
   ============================================================ */
exports.handler = async (event) => {
  const json = (code, body) => ({
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  });

  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Méthode non autorisée.' });

  const expected = process.env.DASH_PASSWORD;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'zowegr-cmd/coachtanguy';
  const branch = process.env.GITHUB_BRANCH || 'master';
  if (!expected) return json(500, { ok: false, error: 'DASH_PASSWORD non configuré sur Netlify.' });
  if (!token) return json(500, { ok: false, error: 'GITHUB_TOKEN non configuré sur Netlify (voir les instructions).' });

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { ok: false, error: 'JSON invalide.' }); }

  // --- Authentification (comparaison à temps ~constant) ---
  const given = (payload.password || '').toString();
  const a = Buffer.from(given), b = Buffer.from(expected);
  let same = a.length === b.length;
  const max = Math.max(a.length, b.length, 1);
  for (let i = 0; i < max; i++) { if ((a[i] || 0) !== (b[i] || 0)) same = false; }
  if (!same) return json(401, { ok: false, error: 'Mot de passe incorrect.' });

  // --- Fichiers à publier (whitelist content/*.js uniquement) ---
  const files = payload.files || {};
  const paths = Object.keys(files).filter((p) =>
    /^content\/[a-z0-9._-]+\.js$/i.test(p) && typeof files[p] === 'string' && files[p].length < 500000
  );
  if (!paths.length) return json(400, { ok: false, error: 'Aucun fichier valide à publier.' });

  const API = 'https://api.github.com/repos/' + repo;
  const H = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'coachtanguy-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const gh = async (method, url, body) => {
    const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {}
    return { status: r.status, data, text };
  };

  try {
    // 1) Réf de la branche → commit courant
    const ref = await gh('GET', API + '/git/ref/heads/' + encodeURIComponent(branch));
    if (ref.status !== 200 || !ref.data || !ref.data.object) {
      return json(502, { ok: false, error: 'Branche introuvable (' + ref.status + '). Vérifie GITHUB_REPO / GITHUB_BRANCH.' });
    }
    const parentSha = ref.data.object.sha;

    // 2) Arbre de base
    const commit = await gh('GET', API + '/git/commits/' + parentSha);
    if (commit.status !== 200) return json(502, { ok: false, error: 'Lecture du commit échouée (' + commit.status + ').' });
    const baseTree = commit.data.tree.sha;

    // 3) Nouvel arbre (contenu inline → pas besoin de blobs séparés)
    const tree = paths.map((p) => ({ path: p, mode: '100644', type: 'blob', content: files[p] }));
    const newTree = await gh('POST', API + '/git/trees', { base_tree: baseTree, tree });
    if (newTree.status !== 201) return json(502, { ok: false, error: 'Création de l\'arbre échouée (' + newTree.status + ').', detail: (newTree.text || '').slice(0, 200) });

    // Rien n'a changé → on ne crée pas de commit inutile
    if (newTree.data.sha === baseTree) {
      return json(200, { ok: true, deploy: false, changed: [], message: 'Déjà à jour : aucun changement à publier.' });
    }

    // 4) Commit
    const made = await gh('POST', API + '/git/commits', {
      message: 'Dashboard : mise à jour du contenu (' + paths.join(', ') + ')',
      tree: newTree.data.sha,
      parents: [parentSha],
    });
    if (made.status !== 201) return json(502, { ok: false, error: 'Création du commit échouée (' + made.status + ').' });

    // 5) Avance la branche → déclenche le déploiement Netlify
    const upd = await gh('PATCH', API + '/git/refs/heads/' + encodeURIComponent(branch), { sha: made.data.sha, force: false });
    if (upd.status !== 200) return json(502, { ok: false, error: 'Mise à jour de la branche échouée (' + upd.status + ').', detail: (upd.text || '').slice(0, 200) });

    return json(200, { ok: true, deploy: true, changed: paths, commit: made.data.sha.slice(0, 7) });
  } catch (e) {
    return json(502, { ok: false, error: 'Erreur réseau GitHub : ' + (e && e.message ? e.message : String(e)) });
  }
};
