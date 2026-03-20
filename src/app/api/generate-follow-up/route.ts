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

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est de rédiger une note de suivi chronologique basée sur la transcription d'un audio, d'un texte ou d'un document récent fourni par le thérapeute.
        
Voici la transcription complète de la note d'aujourd'hui :
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

ATTENTION concernant les titres : 
Analyse le contenu de la note et choisis un ou plusieurs titres adaptés à ce qui est réellement dit. N'utilise PAS "🗣️ Ressenti du patient" par défaut si le thérapeute décrit ce qu'il a fait.
Exemples de titres possibles (utilise des emojis pertinents) :
- ### 🗣️ Ressenti / Paroles du patient (si le patient exprime ses symptômes, retours)
- ### 👐 Manipulation / Pratique manuelle (si le thérapeute décrit ses techniques physiques)
- ### 🧠 Travail psychologique / Neuro (si le thérapeute agit sur la dimension cognitive ou émotionnelle)
- ### 📌 Notes & Suivi (pour du contenu général, des rappels)
- ### 🎯 Plan d'action / Recommandations (exercices donnés, prochains rdv)

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
