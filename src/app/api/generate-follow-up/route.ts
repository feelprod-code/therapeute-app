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

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est de rédiger une brève note de suivi chronologique (1 à 3 paragraphes maximum) basée sur la transcription d'un audio ou document récent.
        
Voici la transcription complète de la consultation d'aujourd'hui (ou le document fourni) :
"""
${transcription}
"""

Voici la synthèse globale du dossier patient (pour contexte, ne la modifie pas, sers t'en juste pour comprendre de quoi il s'agit) :
"""
${previousSynthese || 'Aucun dossier patient existant.'}
"""

Instructions:
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "content": "La note de suivi formatée en Markdown, rédigée de manière claire et professionnelle. Résume les points clés abordés lors de la séance."
}

Règles :
1. "content" : Ne rédige que la note de synthèse elle-même, pas de titre global ni de date (l'interface le fait). Concentre-toi sur l'évolution, le motif du jour, ce qui a été dit ou fait, et les prochaines étapes. Rédige de façon clinique et concise. Tu peux utiliser des *bullet points* ou du gras si nécessaire.`;

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
