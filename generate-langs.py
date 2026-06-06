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
PAGES = ["index.html"]

def transform(html, lang, locale):
    # langue
    html = html.replace('<html lang="fr">', '<html lang="%s">' % lang)
    # chemins vers la racine
    html = html.replace('href="styles.css', 'href="../styles.css')
    html = html.replace('src="assets/', 'src="../assets/')
    html = html.replace('href="assets/', 'href="../assets/')
    html = html.replace('href="site.webmanifest"', 'href="../site.webmanifest"')
    html = html.replace('src="content/fr.js"', 'src="../content/%s.js"' % lang)
    html = html.replace('src="script.js"', 'src="../script.js"')
    # canonical + og:url -> /lang/
    html = html.replace('rel="canonical" href="https://www.coachtanguy.com/"',
                        'rel="canonical" href="https://www.coachtanguy.com/%s/"' % lang)
    html = html.replace('property="og:url" content="https://www.coachtanguy.com/"',
                        'property="og:url" content="https://www.coachtanguy.com/%s/"' % lang)
    html = html.replace('content="fr_FR"', 'content="%s"' % locale)
    # liens internes vers les pages NON présentes dans le dossier de langue -> ../
    for page in ["coaching-visio.html", "suivi-en-ligne.html", "contact.html",
                 "mentions-legales.html", "cvg.html"]:
        if page not in PAGES:
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
