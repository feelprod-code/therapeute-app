import { GoogleGenAI } from '@google/genai';

// Voix 100% Français de France (Paris) & Britanniques chaleureuses (Zéro accent québécois/américain en FR)
export const VOICE_CONFIGS: Record<string, { elevenLabsId: string; geminiVoice: string }> = {
    claire: {
        elevenLabsId: '6vTyAgAT8PncODBcLjRf', // Claire - Française de France (Chaleureuse, Douce, Naturelle)
        geminiVoice: 'Aoede',
    },
    jeanne: {
        elevenLabsId: 'txtf1EDouKke753vN8SL', // Jeanne - Parisienne Naturelle & Fluide
        geminiVoice: 'Aoede',
    },
    victoria: {
        elevenLabsId: 'O31r762Gb3WFygrEOGh0', // Victoria - Parisienne Captivante & Douce
        geminiVoice: 'Kore',
    },
    leo: {
        elevenLabsId: 'AfbuxQ9DVtS4azaxN1W7', // Léo - Parisien Rassurant & Posé
        geminiVoice: 'Charon',
    },
    nicolas: {
        elevenLabsId: 'aQROLel5sQbj1vuIVi6B', // Nicolas - Parisien Calme & Profond
        geminiVoice: 'Orus',
    },
    guillaume: {
        elevenLabsId: 'wwP8V0shqgoFc7EOufdw', // Guillaume Philippe - Voix Clonée Pro Paris
        geminiVoice: 'Charon',
    },
    lily: {
        elevenLabsId: 'pFZP5JQG7iQjIQuC4Bku', // Lily - Britannique Veloutée
        geminiVoice: 'Leda',
    },
    george: {
        elevenLabsId: 'JBFqnCBsd6RMkjVDRZzb', // George - Britannique Chaleureux & Rassurant
        geminiVoice: 'Orus',
    },
};

export function resolveVoiceConfig(voicePreset: string, langCode: string, speaker: string) {
    const langPrefix = langCode.split('-')[0].toLowerCase();

    if (voicePreset === 'duo_warm' || !VOICE_CONFIGS[voicePreset]) {
        // Si la phrase à prononcer est en Français (traduction de la patiente pour Guillaume) -> Claire (100% Française de France)
        if (langPrefix === 'fr') {
            return VOICE_CONFIGS.claire;
        }
        // Si la phrase à prononcer est en Anglais/Langue étrangère (traduction de Guillaume pour le patient) -> George (Chaleureux) ou Claire
        return speaker === 'therapeut' ? VOICE_CONFIGS.george : VOICE_CONFIGS.claire;
    }

    // Si l'utilisateur a choisi une voix anglaise (george/lily) mais que le texte à lire est en Français,
    // basculer automatiquement sur l'équivalent Français de France (leo/claire) pour éviter tout accent étranger/québécois !
    if (langPrefix === 'fr') {
        if (voicePreset === 'george') return VOICE_CONFIGS.leo;
        if (voicePreset === 'lily') return VOICE_CONFIGS.claire;
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

    // 1. ElevenLabs Turbo v2.5 avec optimisation de latence maximale (~300ms) et voix natives de France
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
                    stability: 0.48,
                    similarity_boost: 0.85,
                    style: 0.18,
                    use_speaker_boost: true,
                },
            };

            if (supportedLangCodes.includes(langPrefix)) {
                payload.language_code = langPrefix;
            }

            const elResponse = await fetch(
                `https://api.elevenlabs.io/v1/text-to-speech/${voiceConfig.elevenLabsId}?optimize_streaming_latency=4&output_format=mp3_44100_64`,
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
                        engine: 'elevenlabs-turbo-v2.5',
                    };
                }
            }
        } catch (elErr) {
            console.warn('[TTS] ElevenLabs warning, switching to Gemini fallback:', elErr);
        }
    }

    // 2. Secours automatique Gemini 2.5 Flash TTS (avec accent Français de France)
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
