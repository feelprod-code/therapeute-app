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
            systemPrompt = `Tu agis comme un interprète médical et ostéopathe bilingue instantané.
L'audio fourni est le praticien/thérapeute qui parle en FRANÇAIS.

Consignes cliniques :
1. Conserve la précision exacte des termes anatomiques, ostéopathiques et des consignes corporelles (respiration, relâchement, position, vertiges, irradiations).
2. Adapte le ton : bienveillant, clair, direct et professionnel.

Réponds STRICTEMENT sous ce format, avec les marqueurs sur leur propre ligne :

[TRANSCRIPTION]
Texte exact transcrit en français (corrigé des hésitations)
[TRANSLATION]
Traduction directe et fluide en ${targetLanguage.toLowerCase()}

IMPORTANT : Aucun commentaire d'introduction ou de conclusion, uniquement les deux blocs ci-dessus.`;
        } else {
            systemPrompt = `Tu agis comme un interprète médical et ostéopathe bilingue instantané.
L'audio fourni est le patient qui s'exprime en ${targetLanguage.toUpperCase()}.

Consignes cliniques :
1. Traduis fidèlement la description des symptômes, intensités de douleur, localisations corporelles et antécédents.
2. Formule en français médical clair et limpide pour le praticien.

Réponds STRICTEMENT sous ce format, avec les marqueurs sur leur propre ligne :

[TRANSCRIPTION]
Texte exact transcrit en ${targetLanguage.toLowerCase()}
[TRANSLATION]
Traduction directe et fidèle en français

IMPORTANT : Aucun commentaire d'introduction ou de conclusion, uniquement les deux blocs ci-dessus.`;
        }

        let sanitizedMimeType = mimeType || 'audio/webm';
        if (sanitizedMimeType) {
            sanitizedMimeType = sanitizedMimeType.split(';')[0].trim();
        }

        // Essai avec gemini-2.5-flash puis fallback gemini-2.0-flash
        let stream;
        try {
            stream = await ai.models.generateContentStream({
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
                config: {
                    maxOutputTokens: 8192
                }
            });
        } catch (modelErr) {
            console.warn("Fallback to gemini-2.0-flash for translation:", modelErr);
            stream = await ai.models.generateContentStream({
                model: 'gemini-2.0-flash',
                contents: [
                    systemPrompt,
                    {
                        inlineData: {
                            mimeType: sanitizedMimeType,
                            data: audio,
                        },
                    }
                ],
                config: {
                    maxOutputTokens: 8192
                }
            });
        }

        const encoder = new TextEncoder();

        const readable = new ReadableStream({
            async start(controller) {
                let accumulated = '';
                let hasSeenTranslationMarker = false;

                try {
                    for await (const chunk of stream) {
                        const text = chunk.text || '';
                        accumulated += text;

                        if (!hasSeenTranslationMarker && accumulated.includes('[TRANSLATION]')) {
                            hasSeenTranslationMarker = true;
                        }

                        if (!hasSeenTranslationMarker) {
                            let transcription = accumulated.replace('[TRANSCRIPTION]', '').trim();
                            // Nettoyer les marqueurs de crochets partiels à la fin du flux
                            const openBracketIdx = transcription.lastIndexOf('[');
                            if (openBracketIdx !== -1 && openBracketIdx > transcription.length - 15) {
                                transcription = transcription.substring(0, openBracketIdx).trim();
                            }
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'transcription', text: transcription })}\n\n`
                            ));
                        } else {
                            const parts = accumulated.split('[TRANSLATION]');
                            const transcription = parts[0].replace('[TRANSCRIPTION]', '').trim();
                            const translation = parts[1].trim();

                            // Envoyer la transcription finale (ou stable)
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'transcription', text: transcription })}\n\n`
                            ));
                            // Envoyer la traduction progressive en temps réel (pour affichage dynamique)
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'translation_chunk', text: translation })}\n\n`
                            ));
                        }
                    }

                    // Une fois le stream fini, envoyer le message final de traduction pour activer le TTS
                    if (accumulated.includes('[TRANSLATION]')) {
                        const parts = accumulated.split('[TRANSLATION]');
                        const transcription = parts[0].replace('[TRANSCRIPTION]', '').trim();
                        const translation = parts[1].trim();

                        controller.enqueue(encoder.encode(
                            `data: ${JSON.stringify({ type: 'transcription', text: transcription })}\n\n`
                        ));
                        controller.enqueue(encoder.encode(
                            `data: ${JSON.stringify({ type: 'translation', text: translation })}\n\n`
                        ));
                    } else {
                        // Fallback si pas de marqueurs
                        try {
                            const jsonResult = JSON.parse(accumulated);
                            const t = jsonResult.transcription || accumulated;
                            const tr = jsonResult.translation || accumulated;
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'transcription', text: t })}\n\n`
                            ));
                            controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify({ type: 'translation', text: tr })}\n\n`
                            ));
                        } catch {
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
