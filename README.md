# CoachTanguy — clone local

Reproduction statique du site coachtanguy.com (HTML / CSS / JS, sans dépendances).

## Aperçu
Ouvre simplement `index.html` dans ton navigateur. Pour le rechargement auto pendant le dev :

```bash
# avec Python
python -m http.server 8000
# puis ouvre http://localhost:8000
```

## Structure
```
tanguy/
├── index.html      # page unique (nav, hero, services, about, FAQ, contact, footer)
├── styles.css      # styles + palette (orange #ff5a00 / noir / gris)
├── script.js       # menu mobile + accordéon FAQ
└── assets/         # vraies photos du site (optimisées) + icônes SVG
    ├── logo.png          # logo officiel CoachTanguy
    ├── hero.jpg          # Tanguy (photo d'accueil)
    ├── about.jpg         # Tanguy avec son diplôme
    ├── service-visio.jpg # coaching visio
    ├── service-suivi.jpg # suivi en ligne
    ├── banner.jpg        # photo large de groupe (en réserve)
    ├── favicon.svg
    ├── icon-visio.svg
    └── icon-suivi.svg
```

> Les photos proviennent du site original et ont été redimensionnées + compressées en JPEG (58–107 Ko chacune) pour des temps de chargement rapides.

## Palette
| Rôle      | Couleur   |
|-----------|-----------|
| Accent    | `#ff5a00` |
| Texte     | `#0a0a0a` |
| Gris      | `#777` / `#999` |
| Fonds     | `#fff` / `#f5f5f5` |

Police : **Inter Tight** (titres) + **Inter** (texte), via Google Fonts.

## À personnaliser
- Remplacer les SVG du dossier `assets/` par les vraies photos.
- Mettre la vraie adresse e-mail dans le bouton "Me contacter" (`index.html`).
- Ajouter les liens Mentions légales / CGV dans le footer.
