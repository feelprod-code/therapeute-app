# Instructions et Règles Spécifiques — Thérapeute-App (Bilan TDT)

## 1. Traitement Visuel Obligatoire de l'Imagerie Médicale (Documents Visuels, Résumé & Synthèse)
Dès qu'un document visuel (PDF ou image contenant des examens radiologiques, IRM, scanners, échographies) est téléversé ou présent dans le dossier d'un patient :

- **RÈGLE ABSOLUE ANTI-PDF DANS LES IMAGES :**
  Il est STRICTEMENT INTERDIT d'insérer un fichier `.pdf` dans une balise image Markdown `![...](...pdf)`. Les navigateurs web et le composant React ne peuvent pas afficher un PDF dans une balise image `<img>`. Les fichiers PDF officiels doivent TOUJOURS être présentés sous forme de bouton ou lien de consultation :
  ```markdown
  [📄 Consulter le compte-rendu officiel original (PDF)](url_du_fichier.pdf)
  ```

- **Obligation stricte sur les DEUX RUBRIQUES (`résumé` ET `synthèse`) :**
  L'agent ou le système ne doit JAMAIS se contenter d'un simple lien passif, d'un texte descriptif sans image ou d'un `<iframe>` opaque dans la synthèse. Il a l'obligation formelle de réaliser le travail didactique visuel complet sur les deux rubriques.

- **Standard Didactique des Planches Annotées :**
  1. **Extraction Haute Résolution :** Extraire les coupes radiologiques clés (médio-sagittale, para-sagittale foraminale, T1, T2, STIR, axiales, fluoroscopie) à résolution native nette (minimum 2.5x, min 2000×1400 px).
  2. **Flèches Indicatrices & Cibles Focales (Charte Couleur TDT) :**
     - 🔴 **Rouge / Terracotta (`#AF2D14`) :** Pour les sténoses, fissures osseuses, hernies discales, conflits disco-radiculaires, kystes algogènes ou foyers inflammatoires aigus (avec anneau circulaire de ciblage rouge centré exactement sur la lésion).
     - 🟢 **Vert Forêt (`#236E41`) :** Pour l'intégrité du cordon médullaire, le libre écoulement du LCR, l'absence de sténose canalaire, l'intégrité des tendons de la coiffe des rotateurs et la trophicité musculaire normale.
     - 🔵 **Bleu Ardoise (`#1A535C`) / Cyan (`#0E7490`) :** Pour les repères anatomiques cardinaux (charnière C1-C2, promontoire S1, interligne articulaire) et le guidage opératoire (aiguille de ponction intra-articulaire).
     - 🟠 **Ocre / Ambre (`#BD613C` / `#BE6E14`) :** Pour les remaniements chroniques, l'arthrose, l'épaississement capsulaire rétractile (capsulite) ou les cals osseux.
  3. **Cartouches Explicatifs Succincts :** Relier chaque flèche par une fine ligne directrice à un badge/cartouche clair comprenant un titre en gras et une description clinique concise en une ligne, positionné dans les marges sans masquer l'anatomie.
  4. **Bandeau Inférieur de Synthèse Radiologique :** Intégrer en bas de planche un cartouche récapitulant fidèlement la conclusion du radiologue signataire.

- **Intégration Systématique dans les Deux Rubriques :**
  - **Dans le Résumé (`resume`) :** 
    1. Afficher la planche didactique maîtresse annotée dès l'en-tête : `![Bilan Didactique Global](url.png)`.
    2. Insérer le récapitulatif visuel des repères anatomiques et flèches de couleur (🔴, 🟢, 🔵, 🟠).
    3. Conclure par la synthèse clinique ostéopathique TDT.
  - **Dans la Synthèse (`synthese`) :** 
    1. Intégrer la planche didactique annotée sous chaque compte-rendu d'imagerie en visibilité immédiate.
    2. Insérer le menu accordéon déroulant (`<details>`) regroupant les planches de contact complètes de toutes les coupes (axiales, sagittales, coronales) sans recadrage.
    3. Ajouter le bouton d'accès direct au PDF officiel original.

- **Visionneuse Médicale Interactive (`MedicalImageViewerModal`) :**
  - Téléverser systématiquement toutes les planches `.png` sur Supabase Storage (`tdt_uploads`).
  - Utiliser la syntaxe Markdown `![Titre](url.png)` qui active automatiquement l'ouverture en plein écran avec zoom interactif et loupe au clic du praticien.

- **Pipeline Automatisé CLI / Script :**
  Pour tout traitement automatisé ou correction rapide par un agent, utiliser le script standard :
  ```bash
  python3 src/lib/medical-imaging/pipeline.py --input-path "<chemin_pdf_ou_image>" --consultation-id "<uuid>" --patient-name "<nom>"
  ```

## 2. Formatage du Titre de Consultation
Le titre principal d'un "Bilan de consultation" doit obligatoirement respecter la balise HTML pour la date :
```markdown
# Bilan de consultation <span style="font-size: 0.6em; color: #8c7b6d;">- [Date]</span>
```

## 3. Charte Graphique BD Anatomique (Ligne Claire Francophone)
Pour toutes les illustrations médicales :
- **Fond :** Parchemin chaud `#FAF7F2`
- **Tensions / Foyers algogènes :** Terracotta `#8C4E33` / `#AF2D14`
- **Fascias / Dure-mère :** Bleu ardoise `#7EAEC8` / `#1A535C`
- **Fluides / Souffle :** Cyan / Or `#38B2AC` / `#E2B357`

## 4. Fusion (Merge) de notes 
Lorsqu'un thérapeute ajoute un enregistrement vocal qui vient compléter un "Bilan de consultation" pré-existant :
- Les éléments existants du rapport clinique (Motif, Mode de vie, ATCD, etc.) doivent être bonifiés avec le nouveau texte de façon invisible/fluide si possible. 
- S'il faut modifier la date globale de la consultation via cette nouvelle note (par ex. si le praticien mentionne "Note pour le 19 janvier"), on doit simplement mettre à jour le `[Date]` dans la balise HTML tout en haut du document sans rajouter de fausse section en bas du texte du style "Ajout au 19 janvier".

## 5. Modification structurelle des dates de "Suivi"
Dans l'interface, lorsqu'une session de "suivi" voit sa date être modifiée par l'utilisateur, on **décale linéairement** le *timestamp* de l'ensemble de ses "notes" filles associées. On ne les écrase jamais avec la même valeur temporelle, pour préserver la chronologie d'édition relative de la session.
