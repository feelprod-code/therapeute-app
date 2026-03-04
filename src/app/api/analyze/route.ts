import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 300;

export async function POST(req: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("[API] Clé API Gemini manquante.");
            return NextResponse.json({ error: "Clé API Gemini (Google) manquante." }, { status: 500 });
        }

        // Initialisation du client avec la clé d'environnement
        const ai = new GoogleGenAI({ apiKey });

        const formData = await req.formData();
        const file = formData.get('audio') as File | null;

        if (!file) {
            console.error("[API] Aucun fichier audio dans le FormData.");
            return NextResponse.json({ error: "Aucun fichier audio fourni." }, { status: 400 });
        }

        console.log(`[API] Réception d'un fichier audio : ${file.name}, Taille: ${file.size} octets, Type: ${file.type}`);

        // Transformation en ArrayBuffer pour la soumission InlineData
        const arrayBuffer = await file.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');

        if (file.size === 0 || base64Data.length === 0) {
            console.error("[API] Le flux audio encodé est vide.");
            return NextResponse.json({ error: "L'enregistrement audio est vide." }, { status: 400 });
        }

        const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est d'écouter l'enregistrement d'un interrogatoire patient et de produire un bilan.
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "transcription": "La retranscription littérale et intégrale (brouillon mots-à-mots) de l'enregistrement",
  "resume": "Un résumé narratif en 3 à 5 phrases, sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce). Intègre l'essentiel de façon fluide.",
  "synthese": "La synthèse médicale formatée en Markdown"
}

**Règles pour la clé "transcription" :**
Retranscris tout ce que tu entends, le plus fidèlement possible, mot pour mot. Ne mets AUCUN texte en gras.

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
[...]
### Histoire de la Maladie / Douleur
- **Description :** [...]
- **Intensité :** [...]
- **Fréquence :** [...]
- **Circonstances d'apparition :** [...]
### Examens Complémentaires
- **Photos / PDF / Textes :** [...]
### Antécédents (ATCD) et Chronologie
*Présente TOUS les antécédents, traumatismes, accidents, interventions dans un ordre strictement chronologique de la naissance jusqu'à aujourd'hui.*
*IMPORTANT : Ne garde que ce qui est explicitement dit dans l'audio.*
- [Année] - [Description]`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: file.type || 'audio/webm', data: base64Data } },
                        { text: systemPrompt }
                    ]
                }
            ],
            config: {
                responseMimeType: "application/json",
            }
        });

        // Gemini nous renvoie cette fois une string contenant l'objet JSON. On doit la parser.
        const responseText = response.text || "{}";
        let parsedResult;
        try {
            parsedResult = JSON.parse(responseText);
        } catch {
            // Fallback sécurité si l'IA s'est ratée
            parsedResult = { patientName: "", transcription: "Erreur de formatage de la retranscription.", resume: "", synthese: responseText };
        }

        return NextResponse.json({
            synthese: parsedResult.synthese,
            resume: parsedResult.resume,
            patientName: parsedResult.patientName,
            transcription: parsedResult.transcription
        });
    } catch (error: unknown) {
        console.error("Erreur Gemini:", error);
        const errorMessage = error instanceof Error ? error.message : "Erreur lors du traitement Gemini";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}
