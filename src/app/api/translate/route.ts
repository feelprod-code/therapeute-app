import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });
        }

        const ai = new GoogleGenAI({ apiKey });
        const formData = await req.formData();
        const audioFile = formData.get('audio') as File | null;
        const speaker = (formData.get('speaker') as string) || 'bidirectional'; // 'therapeut' | 'patient' | 'bidirectional'
        const targetLanguage = (formData.get('targetLanguage') as string) || 'Anglais';

        if (!audioFile) {
            return NextResponse.json({ error: "Aucun fichier audio fourni." }, { status: 400 });
        }

        const arrayBuffer = await audioFile.arrayBuffer();
        if (arrayBuffer.byteLength < 500) {
            return new Response("[SILENCE]", {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        const base64Audio = Buffer.from(arrayBuffer).toString('base64');

        // Nettoyer les paramètres additionnels (ex: ;codecs=opus) qui font échouer Gemini
        let mimeType = (audioFile.type || 'audio/webm').split(';')[0].trim();
        if (mimeType === 'audio/x-m4a') {
            mimeType = 'audio/mp4';
        }

        let prompt = "";
        if (speaker === 'bidirectional') {
            prompt = `Tu es un interprète médical professionnel en temps réel lors d'une consultation d'ostéopathie / kinésithérapie entre le praticien (Guillaume Philippe, qui parle Français) et un patient étranger (qui parle ${targetLanguage} ou une autre langue étrangère).
Écoute attentivement cet extrait audio :
1. Si l'extrait ne contient aucune parole intelligible (uniquement du silence, un souffle, un bruit de fond ou un toussotement), réponds UNIQUEMENT par :
[SILENCE]

2. Si une personne parle :
- Détermine qui parle :
  * Si la personne parle principalement en Français, le locuteur est "therapeut", la transcription est en Français, et la traduction doit être en ${targetLanguage}.
  * Si la personne parle en ${targetLanguage} (ou dans une langue étrangère autre que le français), le locuteur est "patient", la transcription est dans la langue parlée par le patient, et la traduction doit être en Français.

Réponds STRICTEMENT et UNIQUEMENT avec ce format exact, sans aucun texte avant ni après :
[SPEAKER]
(écris uniquement "therapeut" ou "patient")
[TRANSCRIPTION]
(les mots exacts prononcés dans la langue d'origine)
[TRANSLATION]
(la traduction médicale fluide et naturelle dans l'autre langue)`;
        } else if (speaker === 'therapeut') {
            prompt = `Tu es un interprète médical professionnel lors d'une consultation d'ostéopathie / kinésithérapie.
Le praticien (Guillaume Philippe) parle en Français dans cet enregistrement.
Si l'enregistrement ne contient aucune parole (silence ou bruit), réponds uniquement : [SILENCE]
Sinon :
1. Transcris exactement ce qu'il dit en Français.
2. Traduis-le de manière naturelle, fluide et empathique en ${targetLanguage} pour le patient.

Réponds STRICTEMENT avec ce format exact :
[SPEAKER]
therapeut
[TRANSCRIPTION]
(ton texte transcrit en français ici)
[TRANSLATION]
(ta traduction en ${targetLanguage} ici)`;
        } else {
            prompt = `Tu es un interprète médical professionnel lors d'une consultation d'ostéopathie / kinésithérapie.
Le patient parle en ${targetLanguage} (ou dans sa langue maternelle étrangère) dans cet enregistrement.
Si l'enregistrement ne contient aucune parole (silence ou bruit), réponds uniquement : [SILENCE]
Sinon :
1. Transcris exactement ce qu'il dit dans sa langue d'origine (${targetLanguage}).
2. Traduis-le fidèlement et clairement en Français pour le praticien.

Réponds STRICTEMENT avec ce format exact :
[SPEAKER]
patient
[TRANSCRIPTION]
(ton texte transcrit en ${targetLanguage} ici)
[TRANSLATION]
(ta traduction en français ici)`;
        }

        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { data: base64Audio, mimeType } },
                        { text: prompt }
                    ]
                }
            ],
            config: {
                temperature: 0.1,
            }
        });

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of responseStream) {
                        const text = chunk.text;
                        if (text) {
                            controller.enqueue(new TextEncoder().encode(text));
                        }
                    }
                    controller.close();
                } catch (err) {
                    console.error("Erreur durant le stream Gemini /api/translate :", err);
                    controller.error(err);
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache',
            }
        });

    } catch (error: unknown) {
        console.error("Erreur serveur API /translate :", error);
        const errorMessage = error instanceof Error ? error.message : "Erreur inconnue.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
