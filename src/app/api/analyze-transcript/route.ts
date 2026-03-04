import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: Request) {
    console.log("[API analyze-transcript] Requête reçue.");

    try {
        const { transcript } = await req.json();

        if (!transcript || transcript.trim() === "") {
            console.error("[API] Aucun transcript fourni.");
            return NextResponse.json({ error: "L'historique de conversation est vide." }, { status: 400 });
        }

        console.log(`[API] Lancement de l'analyse IA sur le transcript texte (${transcript.length} caractères)...`);

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est de lire l'historique d'une conversation entre un thérapeute et son patient et de produire un bilan.
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "transcription": "Ne change rien, renvoie simplement le texte qu'on t'a donné",
  "resume": "Un résumé narratif en 3 à 5 phrases, sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce). Intègre l'essentiel de façon fluide.",
  "synthese": "La synthèse médicale formatée en Markdown"
}

**Règles pour la clé "resume" :**
Rédige un paragraphe de texte narratif et continu. NE CRÉE AUCUN TIRETS NI PUCE ET N'UTILISE AUCUNE LISTE. Si le thérapeute ne parle d'aucun examen (radio, IRM...), n'invente rien et n'en fais pas mention.

**Règles pour la clé "synthese" (Formatage de ton texte) :**
Utilise des titres clairs (avec ###), des paragraphes aérés, et **exclusivement des listes à puces** pour les énumérations.
**TRÈS IMPORTANT:** N'inclus JAMAIS une section, un titre ou une puce s'il n'y a aucune information à ce sujet (par exemple, si aucune radio ou IRM n'est mentionnée, ne crée pas la section "Examens Complémentaires" ni de puce "Radio"). Élimine toute mention type "Non mentionné", "Pas de description" ou "Rien à signaler" ; supprime simplement la ligne ou la section entière. NE CRÉE PAS de catégories vides.

Structure attendue dans ce texte Markdown (pour la clé synthese) :
### Identité du Patient
- **Nom / Prénom :** [Extraire si mentionné]
- **Profession :** [Extraire si mentionné]
- **Date de consultation :** La consultation se passe aujourd'hui le ${currentDate}.

### Motif de Consultation
- **Motif principal :** [Extraire]
- **Historique du problème :** [Extraire]
- **Douleur :** [Localisation, type, intensité sur 10 si mentionnée]

### Antécédents
- **Médicaux :** [Extraire]
- **Chirurgicaux / Traumatiques :** [Extraire]
- **Traitements en cours :** [Extraire]

### Bilan Thérapeutique
- **Tests et observations :** [Tests effectués et résultats]
- **Diagnostic ou hypothèse :** [Conclusion du thérapeute]
- **Avis Médical :** [Si un avis médical est nécessaire ou suggéré]

### Plan de Traitement (Techniques Douces Tissulaires)
- **Techniques utilisées :** [Ce qui a été fait pendant la séance]
- **Conseils post-séance :** [Exercices, repos, hydratation...]
- **Suivi prévu :** [Prochain rendez-vous ou consignes]

Voici le transcript exact de la conversation bilingue :
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: [
                systemPrompt,
                transcript
            ],
            config: {
                responseMimeType: "application/json",
            }
        });

        const output = response.text || "{}";

        let jsonResult;
        try {
            jsonResult = JSON.parse(output);
            console.log("[API analyze-transcript] JSON parsé avec succès.");
        } catch {
            console.error("[API analyze-transcript] Erreur de parsing JSON du retour IA. Brut:", output);
            return NextResponse.json({ error: "Erreur de formatage de l'IA." }, { status: 500 });
        }

        return NextResponse.json(jsonResult);
    } catch (error: unknown) {
        console.error("[API analyze-transcript] Erreur globale:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur interne serveur" }, { status: 500 });
    }
}
