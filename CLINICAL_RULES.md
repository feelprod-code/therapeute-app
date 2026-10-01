# Règles Cliniques & Ergonomiques de Therapeute-App

## 1. Imagerie Médicale (Radios / IRM / Échographies) vs Documents Textuels (Comptes-Rendus / PDF)

### Règle d'Affichage Fondamentale :
- **Clichés Radiologiques, IRM, Scanners, Échographies & Planches Didactiques : VISIBLES DIRECTEMENT !**
  - Ne JAMAIS masquer ou replier une coupe d'imagerie, une radio, une IRM ou une planche didactique maîtresse dans un accordéon fermé.
  - L'examen visuel est au cœur du diagnostic ostéopathique TDT : il doit être immédiatement visible (`![Planche Didactique](url.png)`) avec son contraste natif et son badge discret d'agrandissement calé dans le **coin supérieur droit** (`top-2.5 right-2.5`).
  - Dans le fil chronologique des séances (`suivi`), les clichés radiologiques et imageries associées restent ouverts et visibles directement, avec accès en un clic à `/examen-viewer` ("Fenêtre à part").

- **Documents Textuels, Comptes-Rendus Dactylographiés, Ordonnances & Fichiers PDF : REPLIÉS PAR DÉFAUT !**
  - Tout document écrit administratif, compte-rendu dactylographié (lettre de radiologue/médecin) ou fichier PDF scanné doit être obligatoirement placé sous un volet replié `<details>` :
    ```markdown
    <details className="my-3 rounded-xl border border-[#EAE4D9] bg-[#FAF7F2] p-3 text-sm text-[#4a3f35]">
      <summary className="cursor-pointer font-semibold text-[#bd613c] flex items-center gap-2">📄 Voir le compte-rendu officiel original (PDF)...</summary>

      [📄 Consulter le compte-rendu officiel original (PDF)](url.pdf)
    </details>
    ```
  - Même si un compte-rendu textuel a été téléversé sous forme d'image (ex: `Capture_d_ecran.png`), le système le détecte et le place automatiquement en repli afin de ne pas saturer l'écran de texte bureautique.
  - Les planches de contact exhaustives regroupant toutes les coupes (ex: mosaïque de 48 coupes) sont également repliées sous `<details><summary>🔎 Afficher la planche de contact complète...</summary>`.

---

## 2. Pédagogie Clinique : Zéro Description Négative ("Pas de...")

Dans le résumé comme dans la synthèse :
- **Bannir formellement toutes les listes négatives du type :**
  - *« Pas de fissure »*, *« Pas d'épanchement »*, *« Pas de calcification »*, *« Respect des autres tendons »*, *« Tendons en place »*, *« Pas d'amyotrophie »*, *« Absence d'anomalie osseuse »*, etc.
- **Règle :** Se concentrer EXCLUSIVEMENT et directement sur les **constatations positives réelles**, les conflits disco-radiculaires, les zones d'hyper-pression, les dysfonctions ostéopathiques et la **conclusion clinique** utile à la thérapie tissulaire TDT.

---

## 3. Ergonomie & Format iPhone (Onglet Suivi & Bilan)

### Marges & Espace Horizontal sur Mobile (`< sm`) :
- Sur écran iPhone (390px - 440px), chaque pixel compte.
- Réduire drastiquement les marges imbriquées dans le fil chronologique (`suivi`) :
  - Padding de carte : `p-1.5 sm:p-5`.
  - Puce de timeline : `w-5 h-5 sm:w-10 sm:h-10` avec trait vertical calé à `before:ml-2.5 sm:before:ml-5`.
  - Fiches de suivi : `FollowUpCardContent` calibré en `p-1.5 sm:p-4` pour garantir une largeur de lecture maximale de 340px+ sans effet d'étouffement.
  - Iframe de document PDF : hauteur adaptée sur mobile `h-[260px] sm:h-[400px]`.

### Ergonomie des Pilules & Boutons d'Action :
- **JAMAIS en plein centre de l'image :** Interdiction d'un bouton centré (`flex items-center justify-center`) qui masque le rachis cervical/lombaire ou les foyers algogènes.
- La pilule d'action (*« Ouvrir dans une fenêtre à part »* / *« Agrandir »*) est TOUJOURS ancrée dans le **coin supérieur droit** (`top-2.5 right-2.5`).
- Ne jamais assombrir toute l'image au survol (`group-hover:bg-black/20` interdit) pour respecter le contraste médical.

---

## 4. Téléversement Direct & Robuste de Documents (Zero Event Drop)

### Règle des `<label>` Natifs :
- Pour éviter le blocage des boîtes de dialogue de sélection de fichiers sur iOS Mobile Safari ou dans les composants Radix UI (`DropdownMenu` qui se démonte au clic et interrompt `input.click()`) :
  - TOUJOURS envelopper les déclencheurs de fichiers dans une balise native `<label className="cursor-pointer ...">` contenant directement `<input type="file" className="hidden" />`.
  - Cela garantit un déclenchement 100% matériel et synchrone du sélecteur de fichiers de l'OS sans risque de blocage par le navigateur.
- Après téléversement d'un document, la liste `fetchDocs()` doit être rechargée immédiatement afin que l'onglet « Documents Associés » affiche le nouveau fichier sans nécessiter de rafraîchissement manuel de la page.
