# 💡 Idées d'amélioration & d'optimisation — CoachTanguy

> Note de travail. Légende : ⭐ = priorité forte · Impact / Effort indiqués entre parenthèses.

---

## 💰 Conversion & ventes
- **Codes promo** ⭐ (impact fort / facile) — géré nativement par Stripe dans les Payment Links (ex. `BIENVENUE10`, `-20%`). Idéal pour relancer ou récompenser.
- **Offre de lancement / urgence** — bandeau « -15 % sur le 1er pack ce mois-ci » + compte à rebours.
- **Garantie satisfait / remboursé** (ex. 1re séance) — lève le frein à l'achat.
- **Bundle / upsell** — « Pack 8 + bilan nutrition offert », ou afficher l'économie (« -25 % vs séance à l'unité »).
- **Parrainage** — « Parraine un ami : 1 séance offerte pour vous deux ».
- **Carte cadeau** — Stripe permet de vendre des bons cadeaux (Noël, anniversaires).

## 🛡️ Preuve sociale & confiance
- **Témoignages clients** ⭐ (impact très fort) — 3 à 5 avis avec prénom + objectif atteint.
- **Photos avant / après** ⭐ — très puissant en fitness (avec accord des clients).
- **Note Google / avis** — badge « ⭐ 4,9/5 sur X avis ».
- **Logos / certifications** — diplôme HE Léonard de Vinci en bandeau « certifié ».
- **Compteur de résultats** — « +50 clients accompagnés », « 2 000 séances réalisées ».

## 📈 Acquisition & SEO
- **Blog / articles** ⭐ — « 5 exercices à faire chez soi », « Bien manger sans se priver » → trafic Google gratuit sur la durée.
- **SEO local** — si présentiel : page/ville + fiche Google Business.
- **Lead magnet** — « Programme PDF gratuit » contre l'email → construire une liste.
- **Pixel Meta + Google Analytics 4** — mesurer la provenance du trafic et ce qui convertit.
- **Newsletter** — capture email + relance (Brevo / Mailchimp gratuits au début).

## 🔁 Rétention & engagement
- **Espace membre / app FitPros** (déjà en place) — bien le mettre en avant.
- **Relance panier abandonné** — Stripe envoie un email auto si le paiement n'est pas finalisé.
- **Suivi post-achat** — email de bienvenue auto + prise de RDV.

## ⚡ UX & technique
- **Bouton WhatsApp flottant** ⭐ (facile / impact fort) — toujours visible, contact en 1 clic.
- **Réservation en ligne** — Calendly / Cal.com pour booker une séance directement.
- **FAQ enrichie** — déjà en données structurées (rich snippets Google) ✅.
- **Performance** — déjà optimisé (WebP, lazy-load, preload) ✅.
- **Page 404 personnalisée** — garder le visiteur sur le site.
- **Bandeau cookies / RGPD** — obligatoire dès l'ajout d'Analytics / Pixel.

## 💳 Spécifique paiement (Stripe)
- **Klarna / paiement en plusieurs fois** — réduit le frein sur les gros packs (déjà annoncé en FAQ).
- **Abonnement** pour le suivi mensuel (150 €/mois récurrent automatique).
- **Redirection après paiement** vers `confirmation.html` + email de reçu auto.

---

## 🎯 Top 5 priorités (impact max / effort raisonnable)
1. **Témoignages + avant/après** — confiance = conversion
2. **Bouton WhatsApp flottant** — contact instantané
3. **Codes promo + offre de lancement** — déclencheur d'achat
4. **Lead magnet + capture email** — récupérer les visiteurs pas encore prêts
5. **Analytics GA4 + Pixel Meta** — mesurer pour optimiser

---

## ✅ Déjà fait sur le site
- Structure 7 pages, design moderne/épuré, responsive
- SEO technique : Open Graph, Twitter Cards, JSON-LD (FAQ, Service, Person), sitemap, robots, favicons, canonical
- Performance : images WebP, lazy-loading, dimensions, preload, defer
- Nav transparente, séparateurs épurés, page contact finalisée (vrai logo WhatsApp)

## ⏳ À faire (reste du plan d'audit)
- Section témoignages / avant-après
- Vrai envoi du formulaire de contact (Web3Forms / Formspree)
- Accessibilité : contraste orange des petits textes, `<main>`, skip-link, `aria-current`/`aria-expanded`
- Brancher les boutons « Choisir » sur les Stripe Payment Links
- Nettoyage des assets orphelins
- Remplacer les placeholders : n° WhatsApp, email, infos légales (adresse, TVA)

---
*Dernière mise à jour : juin 2026*
