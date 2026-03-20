import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 800; // 15 minutes instead of 5

export async function POST(req: Request) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });

        const body = await req.json();
        const { transcription, previousSynthese } = body;

        if (!transcription) {
            return NextResponse.json({ error: "Aucune transcription fournie." }, { status: 400 });
        }

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est de rédiger une note de suivi chronologique basée sur la transcription d'un audio ou document récent.
        
Voici la transcription complète de la consultation d'aujourd'hui (ou le document fourni) :
"""
${transcription}
"""

Voici la synthèse globale du dossier patient (pour contexte, ne la modifie pas, sers t'en juste pour comprendre de quoi il s'agit) :
"""
${previousSynthese || 'Aucun dossier patient existant.'}
"""

Instructions OBLIGATOIRES:
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON contenant la clé "content".
Le "content" DOIT être formaté de manière très structurée (listing / puces), utilisant le Markdown.
N'écris PAS de longs paragraphes. Utilise uniquement des listes à puces avec des petits tirets (-) pour organiser clairement l'information.

Fais la distinction claire en utilisant ces titres de sections (ajoute le titre uniquement si l'information est présente dans la transcription) :
### 🗣️ Ressenti du patient
- (Ce que le patient exprime, ses symptômes, son évolution, ses retours)

### 🩺 Intervention / Travail en séance
- (Ce que tu as fait, les zones traitées, les tests effectués, tes propres observations cliniques)

### 📌 À suivre / Plan d'action
- (Recommandations données, exercices, prochain rendez-vous)

Va droit au but, sois très précis et visuel. Ne fais aucune introduction de type "Voici la note :".
{
  "content": "Ta réponse formatée en Markdown ici..."
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: [
                {
                    role: 'user',
                    parts: [{ text: systemPrompt }]
                }
            ],
            config: {
                systemInstruction: "Tu retournes uniquement du JSON.",
            }
        });

        const texteResponse = response.text;

        if (!texteResponse) {
            throw new Error("L'API Gemini a retourné une réponse vide.");
        }

        const cleanJson = texteResponse
            .replace(/\`\`\`json\n/g, '')
            .replace(/\`\`\`\n?/g, '')
            .trim();

        const jsonResult = JSON.parse(cleanJson);

        return NextResponse.json(jsonResult);

    } catch (error: unknown) {
        console.error("Erreur serveur API /generate-follow-up :", error);
        const errorMessage = error instanceof Error ? error.message : "Erreur inconnue.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
