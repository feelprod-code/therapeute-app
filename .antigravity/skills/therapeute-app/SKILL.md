---
name: therapeute-app
description: "Règles et instructions spécifiques pour le développement et la maintenance de l'application Therapeute-App."
category: app
risk: safe
source: local
tags: "[therapeute, frontend, nextjs, react, ui, design]"
date_added: "2026-03-31"
okf_version: "0.2"
status: stable
trust_level: verified
verified_by: Guillaume Philippe
last_updated: "2026-07-27"
provenance: human_curated
---

# Therapeute-App

## Purpose

To ensure AI coding assistants strictly follow the business, design, and structural rules of the Therapeute-App. This covers the visual style for consultation syntheses, data merging, and session tracking logic.

## When to Use This Skill

This skill should be used when:
- Creating or editing the **Bilan de consultation** views or components.
- Modifying or prompting the LLM for note merging logic.
- Building out new components inside `therapeute-app`.
- Working with the dates and timestamps of the `Suivi` view.

## Core Rules

### 1. Synthesis Formatting (Bilan de Consultation)
Whenever you modify the Markdown or the generation prompt for a "Bilan de consultation", you MUST keep the main title perfectly formatted like this:

\`\`\`markdown
# Bilan de consultation <span style="font-size: 0.6em; color: #8c7b6d;">- [Date]</span>
\`\`\`

- **Visual Consistency:** The HTML `<span style="font-size: 0.6em; color: #8c7b6d;">- [Date]</span>` ensures the date is displayed with a smaller size and specific color inside the h1 tag on the frontend.
- **Data Integrity:** Never overwrite, delete, or hallucinate the patient's personal information (name, surname, etc.) when regenerating a report.

### 2. Note Merging (Fusion)
When a practitioner adds an oral note to an existing "Bilan de consultation":
- Do not append awkward text blocks like "Ajout au 19 janvier" at the end of the synthesis.
- Integrate the added information smoothly into the existing categories (Motif, Mode de vie, ATCD, etc.).
- If the practitioner specifies a new date for the overall report through the new note, update the `[Date]` inside the title's span.

### 3. Date Shifting (Suivi Interface)
When a user explicitly edits the date of a "suivi" session:
- You must linearly translate (shift) the timestamps of all children "notes" associated with that session.
- **Never collapse** all child notes to a single timestamp. The relative time offset between each note of the session must be preserved.

### 4. Technical Rules for Document Layout & Clinical Syntheses (Mise en Page des Bilans)
Whenever embedding medical documents, OCT scans, operative reports, or visual comparisons in a consultation Bilan:

- **Strict Database Field Separation:**
  - `transcription`: Contains the complete, verbatim audio interrogatoire text (mot-à-mot). Never dump raw transcript text blocks directly inside the `synthese` or `resume` fields.
  - `resume`: Contains a concise, professional executive summary paragraph.
  - `synthese`: Contains the structured Markdown Bilan (Patient Info, HPI, Medical History, Visual Comparisons, Document Scans with syntheses, and Clinical Chronology).

- **Authentic Scans Only (Pas de "Moules" / Faux Blocs de Texte) :**
  - Never regenerate fake synthetic text mockups ("moules") for scanned documents. Always display the **authentic original document scans** (PDF & 200 DPI PNG images).

- **Feuille par Feuille & Sans Scrollbar :**
  - Multi-page documents must be split page by page (Feuille 1, Feuille 2) so that every page is displayed in its own dedicated block.
  - Never place scrolling iframes with internal scrollbars. Use high-res scan images (`<img src="..." style="width: 100%; height: auto; display: block;" />`) so each document page renders completely, cleanly, and without any scrollbar.
  - For landscape documents (e.g. OCT Thickness Map), ensure native landscape orientation (width > height).

- **Cadrage Compact & Épuré ("Pas trop grand dans la page") :**
  - Wrap each document page in an elegant, minimal white card (`#ffffff`, border `#e5e2dd`, border-radius `8px`, shadow `0 1px 4px rgba(0,0,0,0.04)`).
  - Include a compact header with title, sheet subtitle, and discreet links for `"🔍 Grand format (Retour disponible)"` and `"PDF Original ↗"`.
  - When opened in grand format, ensure the user can seamlessly return back to the consultation report ("Revenir en arrière").


- **Synthèse Ciblée sous Chaque Document :**
  - Direct under each document scan image, place a dedicated concise clinical synthesis callout (`background: #fdfbf7; border-left: 3px solid #bd613c; padding: 10px 14px; font-size: 0.88em;`).

- **Module d'Évaluation Visuelle Comparative (Avant vs Après Opération) :**
  - For pre-op vs post-op comparisons, include a side-by-side visual gallery (`grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`) showing the pre-op authentic scan image (red alert border) next to the post-op authentic scan image (green progress border), accompanied by a comparative data table (Central Thickness, Max Thickness, Volume) highlighting percentage reductions.

