import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(request: Request) {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const { audio, mimeType, speaker, targetLanguage } = await request.json();

        if (!audio) {
            return NextResponse.json({ error: 'Aucun audio fourni' }, { status: 400 });
        }

        if (!speaker || !targetLanguage) {
            return NextResponse.json({ error: 'Paramètres speaker ou targetLanguage manquants' }, { status: 400 });
        }

        let systemPrompt = "";
        if (speaker === 'therapeut') {
            systemPrompt = `Tu agis comme un traducteur médical et interprète professionnel.
L'audio fourni est le médecin ou thérapeute qui parle en FRANÇAIS.

Réponds EXACTEMENT dans ce format, avec les marqueurs entre crochets sur leur propre ligne :

[TRANSCRIPTION]
Texte exact de ce qui a été dit en français
[TRANSLATION]
Traduction de ce texte en ${targetLanguage.toLowerCase()}

IMPORTANT : commence par la transcription, puis la traduction. Le langage doit être clair et professionnel, adapté à un patient.`;
        } else {
            systemPrompt = `Tu agis comme un interprète médical.
L'audio fourni est le patient qui parle en ${targetLanguage.toUpperCase()}.

Réponds EXACTEMENT dans ce format, avec les marqueurs entre crochets sur leur propre ligne :

[TRANSCRIPTION]
Texte exact de ce qui a été dit en ${targetLanguage.toLowerCase()}
[TRANSLATION]
Traduction de ce texte en français

IMPORTANT : commence par la transcription, puis la traduction.`;
        }

        let sanitizedMimeType = mimeType || 'audio/webm';
        if (sanitizedMimeType) {
            sanitizedMimeType = sanitizedMimeType.split(';')[0].trim();
        }

        const stream = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: [
                systemPrompt,
                {
                    inlineData: {
                        mimeType: sanitizedMimeType,
                        data: audio,
                    },
                }
            ],
        });

        const encoder = new TextEncoder();

        const readable = new ReadableStream({
            async start(controller) {
                let accumulated = '';
                let transcriptionSent = false;

                try {
                    for await (const chunk of stream) {
                        const text = chunk.text || '';
                        accumulated += text;

                        // Dès qu'on détecte le marqueur [TRANSLATION], on envoie la transcription
                        if (!transcriptionSent && accumulated.includes('[TRANSLATION]')) {
                            const parts = accumulated.split('[TRANSLATION]');
                            const transcription = parts[0].replace('[TRANSCRIPTION]', '').trim();
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'transcription', text: transcription })}\n\n`
                            ));
                            transcriptionSent = true;
                        }
                    }

                    // Stream terminé — envoyer la traduction
                    if (accumulated.includes('[TRANSLATION]')) {
                        const parts = accumulated.split('[TRANSLATION]');
                        const transcription = parts[0].replace('[TRANSCRIPTION]', '').trim();
                        const translation = parts[1].trim();

                        if (!transcriptionSent) {
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'transcription', text: transcription })}\n\n`
                            ));
                        }
                        controller.enqueue(encoder.encode(
                            `data: ${JSON.stringify({ type: 'translation', text: translation })}\n\n`
                        ));
                    } else {
                        // Fallback: pas de marqueurs → tenter de parser comme JSON (rétrocompat)
                        try {
                            const jsonResult = JSON.parse(accumulated);
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'transcription', text: jsonResult.transcription || accumulated })}\n\n`
                            ));
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'translation', text: jsonResult.translation || accumulated })}\n\n`
                            ));
                        } catch {
                            // Dernier recours : tout envoyer comme transcription
                            const cleaned = accumulated.replace('[TRANSCRIPTION]', '').trim();
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'transcription', text: cleaned })}\n\n`
                            ));
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'translation', text: cleaned })}\n\n`
                            ));
                        }
                    }

                    controller.enqueue(encoder.encode(
                        `data: ${JSON.stringify({ type: 'done' })}\n\n`
                    ));
                } catch (error) {
                    console.error('Erreur de streaming Gemini:', error);
                    controller.enqueue(encoder.encode(
                        `data: ${JSON.stringify({ type: 'error', text: String(error) })}\n\n`
                    ));
                }

                controller.close();
            }
        });

        return new Response(readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error) {
        console.error('Erreur lors de la traduction :', error);
        return NextResponse.json(
            { error: 'Erreur lors du traitement de la traduction' },
            { status: 500 }
        );
    }
}
