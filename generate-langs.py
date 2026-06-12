#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère les versions /en et /nl des pages à partir des pages FR (racine).
Le texte est piloté par content/<lang>.js ; ce script ne fait qu'adapter
les chemins, la langue, le canonical, hreflang et le fichier de contenu.

Usage :  python generate-langs.py
"""
import os, re, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
LANGS = {"en": "en_US", "nl": "nl_NL"}

# Pages traduites disponibles dans chaque dossier de langue.
# Ajoute-en ici au fur et à mesure que tu les câbles (puis relance le script).
PAGES = ["index.html", "contact.html", "coaching-visio.html", "suivi-en-ligne.html", "calculateur.html", "politique-confidentialite.html", "cookies.html", "collaboration.html"]

# Pages qui n'existent QUE en FR (leurs liens pointeront vers ../ depuis /en /nl)
FR_ONLY = ["mentions-legales.html", "cvg.html"]

def transform(html, lang, locale):
    # langue
    html = html.replace('<html lang="fr">', '<html lang="%s">' % lang)
    # chemins vers la racine
    html = html.replace('href="styles.css', 'href="../styles.css')
    html = html.replace('src="assets/', 'src="../assets/')
    html = html.replace('href="assets/', 'href="../assets/')
    html = html.replace('href="site.webmanifest"', 'href="../site.webmanifest"')
    html = re.sub(r'src="content/fr\.js(\?[^"]*)?"', r'src="../content/%s.js"' % lang, html)
    html = html.replace('src="script.js', 'src="../script.js')
    # iframe du calculateur (page autonome, chemin relatif depuis /lang/) + langue
    html = re.sub(r'src="calculateur/index\.html([^"]*)"',
                  r'src="../calculateur/index.html\1&lang=%s"' % lang, html)
    # canonical + og:url -> insère /lang/ après le domaine (toute page)
    html = re.sub(r'(rel="canonical" href="https://www\.coachtanguy\.com/)',
                  r'\g<1>%s/' % lang, html)
    html = re.sub(r'(property="og:url" content="https://www\.coachtanguy\.com/)',
                  r'\g<1>%s/' % lang, html)
    html = html.replace('content="fr_FR"', 'content="%s"' % locale)
    # liens internes vers les pages uniquement FR -> ../
    for page in FR_ONLY:
        html = html.replace('href="%s"' % page, 'href="../%s"' % page)
    return html

def main():
    for lang, locale in LANGS.items():
        outdir = os.path.join(ROOT, lang)
        os.makedirs(outdir, exist_ok=True)
        for page in PAGES:
            src = os.path.join(ROOT, page)
            if not os.path.exists(src):
                print("  (ignoré, introuvable) %s" % page); continue
            with open(src, encoding="utf-8") as f:
                html = f.read()
            html = transform(html, lang, locale)
            with open(os.path.join(outdir, page), "w", encoding="utf-8") as f:
                f.write(html)
            print("  %s/%s" % (lang, page))
    print("OK — pages générées.")

if __name__ == "__main__":
    main()
