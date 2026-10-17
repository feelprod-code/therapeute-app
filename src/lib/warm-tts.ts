import { GoogleGenAI } from '@google/genai';

// Voix Studio Haute Qualité (category=high_quality) 100% Français de France (Paris) & Britanniques (Zéro souffle de micro, zéro accent québécois)
export const VOICE_CONFIGS: Record<string, { elevenLabsId: string; geminiVoice: string }> = {
    victoria: {
        elevenLabsId: 'O31r762Gb3WFygrEOGh0', // Victoria - Parisienne Studio High-Quality (Fluide, Douce & Chaleureuse)
        geminiVoice: 'Aoede',
    },
    lucie: {
        elevenLabsId: 'YxrwjAKoUKULGd0g8K9Y', // Lucie - Française de France Studio High-Quality (Empathique & Naturelle)
        geminiVoice: 'Kore',
    },
    nicolas: {
        elevenLabsId: 'aQROLel5sQbj1vuIVi6B', // Nicolas - Parisien Studio High-Quality (Calme, Posé & Rassurant)
        geminiVoice: 'Charon',
    },
    claire: {
        elevenLabsId: '6vTyAgAT8PncODBcLjRf', // Claire - Française Chaleureuse
        geminiVoice: 'Aoede',
    },
    jeanne: {
        elevenLabsId: 'txtf1EDouKke753vN8SL', // Jeanne - Parisienne Naturelle
        geminiVoice: 'Aoede',
    },
    leo: {
        elevenLabsId: 'AfbuxQ9DVtS4azaxN1W7', // Léo - Parisien Rassurant
        geminiVoice: 'Charon',
    },
    guillaume: {
        elevenLabsId: 'wwP8V0shqgoFc7EOufdw', // Guillaume Philippe - Voix Clonée Pro Paris
        geminiVoice: 'Charon',
    },
    lily: {
        elevenLabsId: 'pFZP5JQG7iQjIQuC4Bku', // Lily - Britannique Studio Veloutée
        geminiVoice: 'Leda',
    },
    george: {
        elevenLabsId: 'JBFqnCBsd6RMkjVDRZzb', // George - Britannique Studio Chaleureux
        geminiVoice: 'Orus',
    },
};

export function resolveVoiceConfig(voicePreset: string, langCode: string, speaker: string) {
    const langPrefix = langCode.split('-')[0].toLowerCase();

    if (voicePreset === 'duo_warm' || !VOICE_CONFIGS[voicePreset]) {
        // En Français (traduction de la patiente pour Guillaume) -> Victoria (Studio High-Quality Parisienne sans aucun souffle)
        if (langPrefix === 'fr') {
            return VOICE_CONFIGS.victoria;
        }
        // En Anglais/Langue étrangère (traduction de Guillaume pour le patient) -> George (Studio Britannique Chaleureux)
        return speaker === 'therapeut' ? VOICE_CONFIGS.george : VOICE_CONFIGS.victoria;
    }

    // Si l'utilisateur a choisi une voix anglaise (george/lily) mais que le texte à lire est en Français,
    // basculer automatiquement sur l'équivalent Studio Français de France (nicolas/victoria)
    if (langPrefix === 'fr') {
        if (voicePreset === 'george') return VOICE_CONFIGS.nicolas;
        if (voicePreset === 'lily') return VOICE_CONFIGS.victoria;
    }

    return VOICE_CONFIGS[voicePreset];
}

export function pcm16ToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1): Buffer {
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;
    const wavHeader = Buffer.alloc(44);

    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(numChannels, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(blockAlign, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmBuffer.length, 40);

    return Buffer.concat([wavHeader, pcmBuffer]);
}

export async function generateWarmTtsAudio(
    rawText: string,
    langCode: string,
    speaker: string,
    voicePreset: string
): Promise<{ buffer: Buffer; mimeType: string; engine: string } | null> {
    const cleanText = rawText
        .replace(/[*#_~`]/g, '')
        .replace(/\[.*?\]/g, '')
        .trim();

    if (!cleanText) return null;

    const voiceConfig = resolveVoiceConfig(voicePreset, langCode, speaker);
    const langPrefix = langCode.split('-')[0].toLowerCase();

    const elevenLabsKey =
        process.env.ELEVENLABS_API_KEY ||
        process.env.ELEVEN_LABS_API_KEY;

    if (elevenLabsKey) {
        try {
            const supportedLangCodes = ['fr', 'en', 'es', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar'];
            const payload: Record<string, unknown> = {
                text: cleanText,
                model_id: 'eleven_turbo_v2_5',
                voice_settings: {
                    stability: 0.65,
                    similarity_boost: 0.75,
                    style: 0.0,
                    use_speaker_boost: false,
                },
            };

            if (supportedLangCodes.includes(langPrefix)) {
                payload.language_code = langPrefix;
            }

            // output_format=mp3_44100_128 sans optimize_streaming_latency dégradant : pureté studio 100% (~240ms avec Victoria/Lucie/Nicolas)
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
                    return {
                        buffer: Buffer.from(audioArrayBuffer),
                        mimeType: 'audio/mpeg',
                        engine: 'elevenlabs-turbo-v2.5-studio',
                    };
                }
            }
        } catch (elErr) {
            console.warn('[TTS] ElevenLabs warning, switching to Gemini fallback:', elErr);
        }
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) return null;

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const toneInstruction =
        langPrefix === 'fr'
            ? `Lis uniquement cette phrase avec un accent français de France (Paris) naturel, chaleureux, doux et rassurant : "${cleanText}"`
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
    if (!inlineData || !inlineData.data) return null;

    const pcmBuffer = Buffer.from(inlineData.data, 'base64');
    const wavBuffer = pcm16ToWavBuffer(pcmBuffer, 24000, 1);

    return {
        buffer: wavBuffer,
        mimeType: 'audio/wav',
        engine: 'gemini-2.5-flash-tts',
    };
}
