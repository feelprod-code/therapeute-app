import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 300;

export async function POST(req: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "Clé API Gemini (Google) manquante." }, { status: 500 });
        }

        // Initialisation du client avec la clé d'environnement
        const ai = new GoogleGenAI({ apiKey });

        const formData = await req.formData();
        const file = formData.get('audio') as File | null;

        if (!file) {
            return NextResponse.json({ error: "Aucun fichier audio fourni." }, { status: 400 });
        }

        // Transformation en ArrayBuffer pour la soumission InlineData
        const arrayBuffer = await file.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');

        const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est d'écouter l'enregistrement d'un interrogatoire patient et de produire un bilan.
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "transcription": "La retranscription littérale et intégrale (brouillon mots-à-mots) de l'enregistrement",
  "synthese": "La synthèse médicale formatée en Markdown"
}

**Règles pour la clé "patientName" :** 
Isole le nom et le prénom s'ils sont donnés dans les premières secondes. S'il n'y en a pas, laisse une chaîne vide "".

**Règles pour la clé "transcription" :**
Retranscris tout ce que tu entends, le plus fidèlement possible, mot pour mot. Ne mets AUCUN texte en gras.

**Règles pour la clé "synthese" (Formatage de ton texte) :**
Utilise des titres clairs (avec ###), des paragraphes aérés, et **exclusivement des listes à puces** pour les énumérations. 

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
*IMPORTANT : Nous sommes le ${currentDate}. Si on te donne un âge ancien, calcule mathématiquement l'année d'apparition.*
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
        } catch (e) {
            // Fallback sécurité si l'IA s'est ratée
            parsedResult = { patientName: "", transcription: "Erreur de formatage de la retranscription.", synthese: responseText };
        }

        return NextResponse.json({
            synthese: parsedResult.synthese,
            patientName: parsedResult.patientName,
            transcription: parsedResult.transcription
        });
    } catch (error: any) {
        console.error("Erreur Gemini:", error);
        return NextResponse.json(
            { error: error.message || "Erreur lors du traitement Gemini" },
            { status: 500 }
        );
    }
}
