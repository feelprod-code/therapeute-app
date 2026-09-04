# Instructions et Règles Spécifiques — Thérapeute-App (Bilan TDT)

## 1. Traitement Visuel Obligatoire de l'Imagerie Médicale (Documents Visuels, Résumé & Synthèse)
Dès qu'un document visuel (PDF ou image contenant des examens radiologiques, IRM, scanners, échographies) est téléversé ou présent dans le dossier d'un patient :
- **Obligation stricte sur les DEUX RUBRIQUES (`résumé` ET `synthèse`) :**
  L'agent ne doit JAMAIS se contenter d'un simple lien passif, d'un texte descriptif sans image ou d'un `<iframe>` opaque dans la synthèse. Il a l'obligation formelle de réaliser le travail didactique visuel complet sur les deux rubriques.

- **Standard Didactique des Planches Annotées :**
  1. **Extraction Haute Résolution :** Extraire les coupes radiologiques clés (médio-sagittale, para-sagittale foraminale, T1, T2 Dixon, STIR, axiales) à résolution native nette (minimum 2.5x, min 2000×1400 px).
  2. **Flèches Indicatrices & Cibles Focales :**
     - 🔴 **Rouge / Terracotta (`#AF2D14`) :** Pour les sténoses foraminales, hernies discales, conflits disco-radiculaires, uncarthrose ou foyers algogènes aigus (avec anneau circulaire de ciblage rouge centré sur la lésion).
     - 🟢 **Vert Forêt (`#236E41`) :** Pour l'intégrité du cordon médullaire, le libre écoulement du LCR, l'absence de sténose canalaire ou les disques sains.
     - 🔵 **Bleu Ardoise (`#1A535C`) / Cyan (`#0E7490`) :** Pour les repères anatomiques cardinaux (charnière C1-C2, promontoire S1, massifs postérieurs) et les anomalies bénignes (angiomes vertébraux).
  3. **Cartouches Explicatifs Succincts :** Relier chaque flèche par une fine ligne directrice à un badge/cartouche clair comprenant un titre en gras et une description clinique concise en une ligne.
  4. **Bandeau Inférieur de Synthèse Radiologique :** Intégrer en bas de planche un cartouche récapitulant fidèlement la conclusion du radiologue signataire.

- **Intégration Systématique dans les Deux Rubriques :**
  - **Dans le Résumé (`resume`) :** Afficher la planche didactique maîtresse annotée dès l'en-tête (`![Bilan IRM Didactique Annoté](url)`), suivie du récapitulatif visuel des repères anatomiques et flèches de couleur.
  - **Dans la Synthèse (`synthese`) :** Intégrer la planche didactique maîtresse sous chaque compte-rendu d'imagerie en visibilité immédiate, suivie d'un menu accordéon déroulant (`<details>`) regroupant les planches de contact complètes de toutes les coupes (T2 Dixon, phase, STIR, axiales) et les zooms macro, ainsi que le bouton de consultation du PDF officiel original.

- **Visionneuse Médicale Interactive (`MedicalImageViewerModal`) :**
  - Téléverser systématiquement toutes les planches sur Supabase Storage (`tdt_uploads`).
  - Utiliser la syntaxe Markdown `![Titre](url)` qui active automatiquement l'ouverture en plein écran avec zoom interactif et loupe au clic du praticien.

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
