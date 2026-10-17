import { GoogleGenAI, Type } from '@google/genai';
import { NextResponse } from 'next/server';
import { generateWarmTtsAudio } from '@/lib/warm-tts';

export const maxDuration = 60;

// Expressions parasites typiques d'hallucination sur fond sonore / silence
const HALLUCINATION_PATTERNS = [
    /^thank you\.?$/i,
    /^thanks for watching\.?$/i,
    /^subtitles by/i,
    /^sous-titres/i,
    /^amara\.org/i,
    /^you$/i,
    /^bye\.?$/i,
    /^merci\.?$/i,
    /^merci d'avoir regard/i,
    /^\.+$/,
];

function normalizeForComparison(str: string): string {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isEchoOfLastTts(text: string, lastTts: string): boolean {
    if (!text || !lastTts) return false;
    const normText = normalizeForComparison(text);
    const normLast = normalizeForComparison(lastTts);
    if (!normText || !normLast) return false;
    if (normText === normLast) return true;
    if (normText.length >= 6 && normLast.includes(normText)) return true;
    if (normLast.length >= 6 && normText.includes(normLast)) return true;
    return false;
}

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const audioFile = formData.get('audio') as File | null;
        const speakerMode = (formData.get('speaker') as string) || 'bidirectional'; // 'therapeut' | 'patient' | 'bidirectional'
        const targetLanguage = (formData.get('targetLanguage') as string) || 'Anglais';
        const targetLangCode = (formData.get('targetLangCode') as string) || 'en-US';
        const ttsMode = (formData.get('ttsMode') as string) || 'all';
        const voicePreset = (formData.get('voicePreset') as string) || 'duo_warm';
        const lastSpokenTts = ((formData.get('lastSpokenTts') as string) || '').trim();

        if (!audioFile) {
            return NextResponse.json({ error: "Aucun fichier audio fourni." }, { status: 400 });
        }

        const arrayBuffer = await audioFile.arrayBuffer();
        if (arrayBuffer.byteLength < 800) {
            return new Response("[SILENCE]", {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        let mimeType = (audioFile.type || 'audio/webm').split(';')[0].trim();
        if (mimeType === 'audio/x-m4a') {
            mimeType = 'audio/mp4';
        }

        let resolvedSpeaker: 'therapeut' | 'patient' = 'patient';
        let transcription = '';
        let translation = '';
        let handledByGroq = false;

        // =========================================================================
        // 1. MOTEUR ULTRA-RAPIDE (~500ms) : Groq Whisper-Large-v3-Turbo + GPT-OSS-120B
        // =========================================================================
        const groqKey = process.env.GROQ_API_KEY;

        if (groqKey) {
            try {
                const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('mpeg') ? 'mp3' : 'webm';
                const whisperForm = new FormData();
                whisperForm.append('file', new Blob([arrayBuffer], { type: mimeType }), `speech.${ext}`);
                whisperForm.append('model', 'whisper-large-v3-turbo');
                whisperForm.append('response_format', 'verbose_json');

                const wRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${groqKey}` },
                    body: whisperForm,
                });

                if (wRes.ok) {
                    const wData = await wRes.json();
                    const rawText = (wData.text || '').trim();
                    const detectedLang = (wData.language || '').toLowerCase();
                    const firstSeg = Array.isArray(wData.segments) && wData.segments[0] ? wData.segments[0] : null;
                    const noSpeechProb = firstSeg && typeof firstSeg.no_speech_prob === 'number' ? firstSeg.no_speech_prob : 0;

                    if (!rawText || noSpeechProb > 0.72 || HALLUCINATION_PATTERNS.some(rx => rx.test(rawText))) {
                        return new Response("[SILENCE]", {
                            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                        });
                    }

                    const isSpokenFrench =
                        speakerMode === 'therapeut'
                            ? true
                            : speakerMode === 'patient'
                            ? false
                            : detectedLang === 'french' || detectedLang === 'fr';

                    resolvedSpeaker = isSpokenFrench ? 'therapeut' : 'patient';
                    transcription = rawText;

                    // Filtre anti-écho immédiat avant même d'appeler le LLM
                    if (lastSpokenTts && isEchoOfLastTts(transcription, lastSpokenTts)) {
                        return new Response("[SILENCE]", {
                            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                        });
                    }

                    const translationDirectionPrompt = isSpokenFrench
                        ? `Translate this French medical consultation sentence into natural, warm, empathetic ${targetLanguage}. Output JSON {"translation": "..."} ONLY.`
                        : `Traduis cette phrase de consultation médicale (${targetLanguage}) en FRANÇAIS naturel, fluide et précis. Ne répète JAMAIS l'anglais. Réponds UNIQUEMENT en JSON {"translation": "..."}.`;

                    const llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${groqKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: 'openai/gpt-oss-120b',
                            temperature: 0.05,
                            reasoning_effort: 'low',
                            response_format: { type: 'json_object' },
                            messages: [
                                { role: 'system', content: translationDirectionPrompt },
                                { role: 'user', content: transcription },
                            ],
                        }),
                    });

                    if (llmRes.ok) {
                        const llmData = await llmRes.json();
                        const content = llmData.choices?.[0]?.message?.content || '{}';
                        const parsed = JSON.parse(content);
                        if (parsed.translation && parsed.translation.trim()) {
                            translation = parsed.translation.trim();
                            handledByGroq = true;
                        }
                    }
                }
            } catch (groqErr) {
                console.warn('[API /translate] Groq fast-path warning, falling back to Gemini:', groqErr);
            }
        }

        // =========================================================================
        // 2. MOTEUR DE SECOURS : Gemini 2.5 Flash avec thinkingBudget: 0 (Zéro latence de réflexion)
        // =========================================================================
        if (!handledByGroq) {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                return NextResponse.json({ error: "Clé API manquante." }, { status: 500 });
            }

            const ai = new GoogleGenAI({ apiKey });
            const base64Audio = Buffer.from(arrayBuffer).toString('base64');

            const systemInstruction = `Tu es un interprète médical bilingue ultra-précis entre Guillaume Philippe (praticien qui parle Français) et son patient étranger (qui parle ${targetLanguage}).
1. Si silence/bruit/souffle -> "isSilence": true.
2. Si la voix parle Français -> "spokenLanguageIsFrench": true. Si elle parle ${targetLanguage} -> "spokenLanguageIsFrench": false.
3. "frenchVersion" : TOUJOURS EN FRANÇAIS.
4. "foreignVersion" : TOUJOURS EN ${targetLanguage.toUpperCase()}.`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { inlineData: { data: base64Audio, mimeType } },
                            { text: `Transcris et traduis entre Français et ${targetLanguage}.` }
                        ]
                    }
                ],
                config: {
                    systemInstruction,
                    temperature: 0.05,
                    thinkingConfig: { thinkingBudget: 0 },
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            isSilence: { type: Type.BOOLEAN },
                            spokenLanguageIsFrench: { type: Type.BOOLEAN },
                            frenchVersion: { type: Type.STRING },
                            foreignVersion: { type: Type.STRING },
                        },
                        required: ["isSilence", "spokenLanguageIsFrench", "frenchVersion", "foreignVersion"],
                    },
                },
            });

            const parsed = JSON.parse(response.text || '{}');
            const frenchVersion = (parsed.frenchVersion || '').trim();
            const foreignVersion = (parsed.foreignVersion || '').trim();

            if (parsed.isSilence || (!frenchVersion && !foreignVersion)) {
                return new Response("[SILENCE]", {
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            }

            resolvedSpeaker =
                speakerMode === 'therapeut'
                    ? 'therapeut'
                    : speakerMode === 'patient'
                    ? 'patient'
                    : parsed.spokenLanguageIsFrench
                    ? 'therapeut'
                    : 'patient';

            transcription = resolvedSpeaker === 'therapeut' ? frenchVersion : foreignVersion;
            translation = resolvedSpeaker === 'therapeut' ? foreignVersion : frenchVersion;
        }

        if (
            !transcription ||
            !translation ||
            transcription.length < 2 ||
            HALLUCINATION_PATTERNS.some(rx => rx.test(transcription.trim()))
        ) {
            return new Response("[SILENCE]", {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        if (
            lastSpokenTts &&
            (isEchoOfLastTts(transcription, lastSpokenTts) || isEchoOfLastTts(translation, lastSpokenTts))
        ) {
            return new Response("[SILENCE]", {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        // =========================================================================
        // 3. SYNTHÈSE VOCALE DIRECTE INTÉGRÉE (Zéro 2e aller-retour réseau !)
        // =========================================================================
        const shouldSpeak =
            ttsMode === 'all' ||
            (ttsMode === 'patient_only' && resolvedSpeaker === 'therapeut');

        let audioDataUri = '';
        if (shouldSpeak && translation) {
            const ttsLangCode = resolvedSpeaker === 'therapeut' ? targetLangCode : 'fr-FR';
            const ttsResult = await generateWarmTtsAudio(translation, ttsLangCode, resolvedSpeaker, voicePreset);
            if (ttsResult) {
                audioDataUri = `data:${ttsResult.mimeType};base64,${ttsResult.buffer.toString('base64')}`;
            }
        }

        const formattedOutput =
            `[SPEAKER]\n${resolvedSpeaker}\n` +
            `[TRANSCRIPTION]\n${transcription}\n` +
            `[TRANSLATION]\n${translation}` +
            (audioDataUri ? `\n[AUDIO_URI]\n${audioDataUri}` : '');

        return new Response(formattedOutput, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache',
            },
        });
    } catch (error: unknown) {
        console.error("Erreur serveur API /translate :", error);
        const errorMessage = error instanceof Error ? error.message : "Erreur inconnue.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
