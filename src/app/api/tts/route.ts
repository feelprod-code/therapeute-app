import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

// Mapping des voix chaleureuses ElevenLabs & fallback Gemini Native Audio
const VOICE_CONFIGS: Record<string, { elevenLabsId: string; geminiVoice: string }> = {
    sarah: {
        elevenLabsId: 'EXAVITQu4vr4xnSDxMaL', // Sarah - Mature, Reassuring, Confident
        geminiVoice: 'Aoede',
    },
    bella: {
        elevenLabsId: 'hpp4J3VqNfWAUOO0d1Us', // Bella - Professional, Bright, Warm
        geminiVoice: 'Kore',
    },
    lily: {
        elevenLabsId: 'pFZP5JQG7iQjIQuC4Bku', // Lily - Velvety, Soothing
        geminiVoice: 'Leda',
    },
    brian: {
        elevenLabsId: 'nPczCjzI2devNBz1zQrb', // Brian - Deep, Resonant and Comforting
        geminiVoice: 'Charon',
    },
    george: {
        elevenLabsId: 'JBFqnCBsd6RMkjVDRZzb', // George - Warm, Captivating Storyteller
        geminiVoice: 'Orus',
    },
    guillaume: {
        elevenLabsId: 'wwP8V0shqgoFc7EOufdw', // Guillaume Philippe - Voix Clonée Pro
        geminiVoice: 'Charon',
    },
};

/**
 * Encapsule un flux PCM 16-bit mono (24000 Hz) retourné par Gemini TTS dans un conteneur WAV standard
 */
function pcm16ToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1): Buffer {
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;
    const wavHeader = Buffer.alloc(44);

    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    wavHeader.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
    wavHeader.writeUInt16LE(numChannels, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(blockAlign, 32);
    wavHeader.writeUInt16LE(16, 34); // BitsPerSample
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmBuffer.length, 40);

    return Buffer.concat([wavHeader, pcmBuffer]);
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const rawText = (body.text || '').toString();
        const langCode = (body.langCode || 'fr-FR').toString();
        const speaker = (body.speaker || 'patient').toString(); // 'therapeut' | 'patient'
        const voicePreset = (body.voicePreset || 'duo_warm').toString();

        const cleanText = rawText
            .replace(/[*#_~`]/g, '')
            .replace(/\[.*?\]/g, '')
            .trim();

        if (!cleanText) {
            return NextResponse.json({ error: "Texte vide." }, { status: 400 });
        }

        // Résolution de la voix selon le preset ou le mode Duo Clinique Chaleureux
        let selectedVoiceKey = voicePreset;
        if (voicePreset === 'duo_warm') {
            // Quand on traduit la patiente vers le Français -> voix féminine douce et rassurante (Sarah)
            // Quand on traduit Guillaume vers la langue du patient -> voix masculine posée et chaleureuse (Brian)
            selectedVoiceKey = speaker === 'therapeut' ? 'brian' : 'sarah';
        }

        const voiceConfig = VOICE_CONFIGS[selectedVoiceKey] || VOICE_CONFIGS.sarah;
        const langPrefix = langCode.split('-')[0].toLowerCase();

        // 1. MOTEUR PRIMAIRE : ElevenLabs Flash v2.5 (Ultra-rapide ~250ms & Voix Humaines Chaleureuses)
        const elevenLabsKey =
            process.env.ELEVENLABS_API_KEY ||
            process.env.ELEVEN_LABS_API_KEY ||
            'sk_c90ba3a5dc89903daaf74e5346b55598ee01260a647da505';

        if (elevenLabsKey) {
            try {
                const supportedLangCodes = ['fr', 'en', 'es', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar'];
                const payload: Record<string, unknown> = {
                    text: cleanText,
                    model_id: 'eleven_flash_v2_5',
                    voice_settings: {
                        stability: 0.55,
                        similarity_boost: 0.80,
                        style: 0.15,
                        use_speaker_boost: true,
                    },
                };

                if (supportedLangCodes.includes(langPrefix)) {
                    payload.language_code = langPrefix;
                }

                const elResponse = await fetch(
                    `https://api.elevenlabs.io/v1/text-to-speech/${voiceConfig.elevenLabsId}?output_format=mp3_44100_128`,
                    {
                        method: 'POST',
                        headers: {
                            'xi-api-key': elevenLabsKey,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(payload),
                    }
                );

                if (elResponse.ok) {
                    const audioArrayBuffer = await elResponse.arrayBuffer();
                    if (audioArrayBuffer.byteLength > 200) {
                        return new Response(audioArrayBuffer, {
                            headers: {
                                'Content-Type': 'audio/mpeg',
                                'Cache-Control': 'no-store',
                                'X-Voice-Engine': 'elevenlabs-flash-v2.5',
                            },
                        });
                    }
                } else {
                    console.warn('[API /tts] ElevenLabs fallback triggered:', elResponse.status);
                }
            } catch (elErr) {
                console.warn('[API /tts] ElevenLabs error, switching to Gemini TTS:', elErr);
            }
        }

        // 2. MOTEUR DE SECOURS AUTOMATIQUE : Gemini 2.5 Flash Native Audio TTS (Voix Chaleureuses Aoede / Charon)
        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (!geminiApiKey) {
            return NextResponse.json({ error: "Aucune clé TTS disponible." }, { status: 500 });
        }

        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const toneInstruction =
            langPrefix === 'fr'
                ? `Lis uniquement cette phrase d'une voix chaleureuse, douce, naturelle et bienveillante en français : "${cleanText}"`
                : `Read only this sentence in a warm, gentle, natural and reassuring voice: "${cleanText}"`;

        const geminiRes = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-tts',
            contents: [{ parts: [{ text: toneInstruction }] }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: voiceConfig.geminiVoice,
                        },
                    },
                },
            },
        });

        const inlineData = geminiRes.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!inlineData || !inlineData.data) {
            return NextResponse.json({ error: "Aucun flux audio généré par Gemini TTS." }, { status: 500 });
        }

        const pcmBuffer = Buffer.from(inlineData.data, 'base64');
        const wavBuffer = pcm16ToWavBuffer(pcmBuffer, 24000, 1);

        return new Response(new Uint8Array(wavBuffer), {
            headers: {
                'Content-Type': 'audio/wav',
                'Cache-Control': 'no-store',
                'X-Voice-Engine': 'gemini-2.5-flash-tts',
            },
        });
    } catch (error: unknown) {
        console.error("Erreur serveur API /tts :", error);
        const errorMessage = error instanceof Error ? error.message : "Erreur TTS inconnue.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
