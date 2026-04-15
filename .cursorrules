# Therapeute-App AI Guidelines

## 1. Règles de mise en page des "Bilans de Consultation"
Quand tu génères ou mets à jour un Bilan (la première note clinique complète), tu **dois** conserver ce format pour le titre principal :

```markdown
# Bilan de consultation <span style="font-size: 0.6em; color: #8c7b6d;">- [Date]</span>
```
- Conserve toujours ces balises HTML CSS inlines exactes. Cela assure que l'application restitue la date de la consultation avec un style plus discret par rapport au titre.
- Ne modifie **jamais** les informations personnelles du patient. Ne les supprime jamais lors d'une régénération (fusion de notes).

## 2. Fusion (Merge) de notes 
Lorsqu'un thérapeute ajoute un enregistrement vocal qui vient compléter un "Bilan de consultation" pré-existant :
- Les éléments existants du rapport clinique (Motif, Mode de vie, ATCD, etc.) doivent être bonifiés avec le nouveau texte de façon invisible/fluide si possible. 
- S'il faut modifier la date globale de la consultation via cette nouvelle note (par ex. si le praticien mentionne "Note pour le 19 janvier"), on doit simplement mettre à jour le `[Date]` dans la balise HTML tout en haut du document sans rajouter de fausse section en bas du texte du style "Ajout au 19 janvier".

## 3. Modification structurelle des dates de "Suivi"
Dans l'interface, lorsqu'une session de "suivi" voit sa date être modifiée par l'utilisateur, on **décale linéairement** le *timestamp* de l'ensemble de ses "notes" filles associées. On ne les écrase jamais avec la même valeur temporelle, pour préserver la chronologie d'édition relative de la session.
