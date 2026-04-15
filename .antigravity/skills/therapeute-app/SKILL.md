---
name: therapeute-app
description: "Règles et instructions spécifiques pour le développement et la maintenance de l'application Therapeute-App."
category: app
risk: safe
source: local
tags: "[therapeute, frontend, nextjs, react, ui, design]"
date_added: "2026-03-31"
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
