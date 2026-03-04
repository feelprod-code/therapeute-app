import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(request: Request) {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const { audio, speaker, targetLanguage } = await request.json();

        if (!audio) {
            return NextResponse.json({ error: 'Aucun audio fourni' }, { status: 400 });
        }

        if (!speaker || !targetLanguage) {
            return NextResponse.json({ error: 'Paramètres speaker ou targetLanguage manquants' }, { status: 400 });
        }

        let systemPrompt = "";
        if (speaker === 'therapeut') {
            systemPrompt = `
Tu agis comme un traducteur médical et interprète professionnel.
L'audio fourni est le médecin ou thérapeute qui parle en FRANÇAIS.
Ta tâche est de :
1. Transcrire avec exactitude ce qu'il vient de dire en Français.
2. Traduire cette transcription en ${targetLanguage.toUpperCase()}.
Le langage doit être clair et professionnel, adapté à un patient.

Tu dois répondre UNIQUEMENT avec un objet JSON valide suivant exactement cette structure :
{
  "transcription": "Texte exact de ce qui a été dit en français",
  "translation": "Traduction de ce texte en ${targetLanguage.toLowerCase()}"
}
`;
        } else {
            systemPrompt = `
Tu agis comme un interprète médical.
L'audio fourni est le patient qui parle en ${targetLanguage.toUpperCase()}.
Ta tâche est de :
1. Transcrire avec exactitude ce qu'il vient de dire en ${targetLanguage}.
2. Traduire cette transcription en FRANÇAIS.

Tu dois répondre UNIQUEMENT avec un objet JSON valide suivant exactement cette structure :
{
  "transcription": "Texte exact de ce qui a été dit en ${targetLanguage.toLowerCase()}",
  "translation": "Traduction de ce texte en français"
}
`;
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                systemPrompt,
                {
                    inlineData: {
                        mimeType: 'audio/webm', // Ajuster selon le format envoyé par MediaRecorder
                        data: audio, // base64 string
                    },
                }
            ],
            config: {
                responseMimeType: "application/json",
            }
        });

        const output = response.text || "{}";
        let jsonResult;
        try {
            jsonResult = JSON.parse(output);
        } catch {
            console.error("Échec du parsing JSON de la réponse Gemini :", output);
            return NextResponse.json({ error: "L'IA n'a pas renvoyé un format JSON valide." }, { status: 500 });
        }

        return NextResponse.json(jsonResult);
    } catch (error) {
        console.error('Erreur lors de la traduction :', error);
        return NextResponse.json(
            { error: 'Erreur lors du traitement de la traduction' },
            { status: 500 }
        );
    }
}
