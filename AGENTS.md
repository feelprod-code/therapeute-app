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

- **Règle Fondamentale : IRM & Clichés Radiologiques VISIBLES DIRECTEMENT vs Documents Textuels/PDF REPLIÉS :**
  - **IRM, Radios, Scanners, Échographies & Planches Didactiques : ON DOIT LES VOIR DIRECTEMENT !**
    Ne JAMAIS cacher ou replier une radio, une IRM, une échographie ou une planche didactique maîtresse dans un accordéon fermé.
    L'imagerie médicale est le cœur diagnostique de la consultation : elle doit être affichée en pleine visibilité dès l'ouverture de la fiche (`![Planche Didactique](url.png)`), avec sa netteté native, son badge discret dans le coin supérieur droit et l'option d'ouverture instantanée dans la fenêtre dédiée `/examen-viewer`.
    Dans les fiches de suivi (`suivi`), les clichés radiologiques et images sont également affichés directement ouverts et visibles, avec leur bouton d'en-tête « Fenêtre à part ».
  - **Documents Textuels, Comptes-Rendus Dactylographiés & Fichiers PDF : CE SONT EUX QUI DOIVENT ÊTRE REPLIÉS !**
    Tout document administratif, compte-rendu textuel ou fichier PDF (fiches d'admission, courriers de confrères, examens scannés dactylographiés) doit être obligatoirement placé dans un accordéon repliable `<details>` pour ne jamais encombrer la lecture :
    ```markdown
    <details><summary>📄 Voir le compte-rendu officiel original (PDF)...</summary>

    [📄 Consulter le compte-rendu officiel original (PDF)](url.pdf)

    </details>
    ```
    Dans les séances de suivi (`suivi`), les documents PDF sont repliés par défaut avec le bouton d'en-tête « Fenêtre à part ».
  - **Planches de contact exhaustives de toutes les coupes (48 coupes) :**
    Pour ne pas saturer l'espace avec des dizaines de coupes brutes secondaires, seule la mosaïque de contact de toutes les coupes reste accessible sous un volet replié :
    ```markdown
    <details><summary>🔎 Afficher la planche de contact complète de toutes les coupes...</summary>

    ![Planche de Contact](url.png)

    </details>
    ```
  - **Zéro Fausse Planche sur Documents Textuels :**
    Si un document est un compte-rendu textuel (lettre dactylographiée sans vrais clichés photographiques ou coupes DICOM), il est STRICTEMENT INTERDIT de générer une fausse planche didactique (rectangle gris vide). Le document original est simplement rattaché et mis en repli.
  - **PAS LA PEINE DE DÉCRIRE CE QUI N'EST PAS (Bannissement des Listes Négatives) :**
    Dans le résumé comme dans la synthèse, il est STRICTEMENT INTERDIT de décrire ou d'énumérer ce qui est normal, sain ou indemne.
    Bannir formellement toutes les listes négatives du type :
    *« Pas de fissure »*, *« Pas d'épanchement »*, *« Pas de calcification »*, *« Respect des autres tendons »*, *« Tendons en place »*, *« Pas d'amyotrophie »*, *« Pas d'anomalie »*, etc.
    Mentionner EXCLUSIVEMENT et directement les **constatations positives réelles**, les dysfonctions et la **conclusion clinique** utile à la thérapie manuelle TDT.

- **Ergonomie de la Pilule d'Action sur les Images (Coin Supérieur Droit) :**
  - La pilule d'action (comme *« Ouvrir dans une fenêtre à part »* ou *« Plein écran »*) ne doit JAMAIS être placée en plein centre de l'image (`flex items-center justify-center` est interdit car elle masque les vertèbres, disques et lésions).
  - Elle doit être ancrée discrètement dans le **coin supérieur droit** (`top-2.5 right-2.5`), visible au survol ou au toucher, sans jamais masquer le motif anatomique central.
  - Ne jamais assombrir toute l'image au survol (`group-hover:bg-black/20` interdit) pour préserver le contraste radiologique naturel.

- **Visionneuse Médicale Interactive & Fenêtre Dédiée (`/examen-viewer`) :**
  - Tout clic sur une image ou un PDF ouvre la vue dédiée `/examen-viewer` dans une fenêtre indépendante redimensionnable (1300×920 px sur app native macOS avec plein écran).
  - Un bouton terracotta proéminent `← Revenir au bilan` permet de fermer la fenêtre (`window.close()` / touche `Échap`) et de revenir instantanément au dossier patient.

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
