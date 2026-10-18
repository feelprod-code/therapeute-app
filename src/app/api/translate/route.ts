import { GoogleGenAI, Type } from '@google/genai';
import { NextResponse } from 'next/server';
import { generateWarmTtsAudio } from '@/lib/warm-tts';

export const maxDuration = 60;

// Expressions parasites typiques d'hallucination Whisper sur fond sonore / silence
const HALLUCINATION_PATTERNS = [
    /^thank you\.?$/i,
    /^thanks for watching\.?$/i,
    /^subtitles by/i,
    /^sous-titres/i,
    /^amara\.org/i,
    /^you$/i,
    /^bye\.?$/i,
    /^merci d'avoir regard/i,
    /^\.+$/,
];

// Prompt bilingue natif par langue pour guider le décodeur Whisper-Large-v3-Turbo sur les segments courts (1-2s)
const WHISPER_BILINGUAL_PROMPTS: Record<string, string> = {
    en: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? Hello, where does it hurt?',
    es: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? Hola, ¿dónde le duele exactamente?',
    de: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? Guten Tag, wo haben Sie Schmerzen?',
    it: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? Buongiorno, dove sente dolore?',
    pt: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? Olá, onde sente dor exatamente?',
    ru: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? Здравствуйте, где именно у вас болит?',
    zh: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? 您好，请问您哪里觉得疼？',
    ja: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? こんにちは、どこが痛みますか？',
    ko: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? 안녕하세요, 어디가 아프신가요?',
    ar: 'Consultation médicale ostéopathique. Bonjour, où avez-vous mal ? مرحباً، أين تشعر بالألم بالضبط؟',
};

function normalizeForComparison(str: string): string {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[.,!?;:'"()[\]{}«»„“”‘’¿¡\-—_…/\\|`~@#$%^&*+=<>،؛؟。，、！？「」『』（）]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isEchoOfLastTts(text: string, lastTts: string): boolean {
    if (!text || !lastTts) return false;
    const normText = normalizeForComparison(text);
    const normLast = normalizeForComparison(lastTts);
    if (!normText || !normLast) return false;
    if (normText === normLast) return true;
    const minLen = /[\u3040-\u9fff\uac00-\ud7af]/.test(normText) ? 3 : 6;
    if (normText.length >= minLen && normLast.includes(normText)) return true;
    if (normLast.length >= minLen && normText.includes(normLast)) return true;
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

        const targetLangPrefix = targetLangCode.split('-')[0].toLowerCase();

        let resolvedSpeaker: 'therapeut' | 'patient' = 'patient';
        let transcription = '';
        let translation = '';
        let handledByGroq = false;

        // =========================================================================
        // 1. MOTEUR ULTRA-RAPIDE (~450ms) : Groq Whisper-Large-v3-Turbo + Cascade 3 LLMs
        // =========================================================================
        const groqKey = process.env.GROQ_API_KEY;

        if (groqKey) {
            try {
                const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('mpeg') ? 'mp3' : 'webm';
                const whisperForm = new FormData();
                whisperForm.append('file', new Blob([arrayBuffer], { type: mimeType }), `speech.${ext}`);
                whisperForm.append('model', 'whisper-large-v3-turbo');
                whisperForm.append('response_format', 'verbose_json');

                // Si le bouton explicite "Guillaume (FR)" est pressé, verrouiller Whisper en français
                if (speakerMode === 'therapeut') {
                    whisperForm.append('language', 'fr');
                }
                // Toujours fournir le prompt bilingue natif pour que Whisper reconnaisse immédiatement les 10 langues même sur 1.5s d'audio
                const bilingualPrompt = WHISPER_BILINGUAL_PROMPTS[targetLangPrefix] || WHISPER_BILINGUAL_PROMPTS.en;
                whisperForm.append('prompt', bilingualPrompt);

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

                    if (
                        !rawText ||
                        noSpeechProb > 0.75 ||
                        HALLUCINATION_PATTERNS.some(rx => rx.test(rawText)) ||
                        rawText === bilingualPrompt
                    ) {
                        return new Response("[SILENCE]", {
                            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                        });
                    }

                    transcription = rawText;

                    // Filtre anti-écho immédiat avant d'appeler le LLM
                    if (lastSpokenTts && isEchoOfLastTts(transcription, lastSpokenTts)) {
                        return new Response("[SILENCE]", {
                            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                        });
                    }

                    const systemPrompt = `You are an ultra-fast medical interpreter between a French osteopath (who speaks French) and a foreign patient (who speaks ${targetLanguage}, code: ${targetLangCode}).
Analyze the input sentence (Whisper detected language hint: "${detectedLang}", button mode: "${speakerMode}"):
1. Determine if the input sentence is in FRENCH ("isSpokenFrench": true) or in a FOREIGN language ("isSpokenFrench": false).
   - Note: If the input sentence is clearly written in French (even if button mode is "patient" or "bidirectional"), set "isSpokenFrench": true!
   - If button mode is "therapeut", ALWAYS set "isSpokenFrench": true.
2. If "isSpokenFrench" is true:
   - Translate the French sentence into natural, warm, empathetic ${targetLanguage} (${targetLangCode}).
   - Use native script for ${targetLanguage} (e.g. Cyrillic for Russian, Simplified Chinese for Mandarin, Kana/Kanji for Japanese, Hangul for Korean, Arabic script for Arabic).
   - NEVER output French in "translation" when "isSpokenFrench" is true!
3. If "isSpokenFrench" is false:
   - Translate the foreign sentence into natural, fluent Metropolitan FRENCH (fr-FR).
   - NEVER repeat the foreign language in "translation" when "isSpokenFrench" is false!
Output strictly valid JSON: {"isSpokenFrench": boolean, "translation": "string"}`;

                    // Cascade de 3 modèles Groq ultra-rapides (évite tout blocage HTTP 429 Rate Limit lors de tests intensifs multi-langues)
                    const groqModels = [
                        'llama-3.3-70b-versatile',
                        'openai/gpt-oss-120b',
                        'llama-3.1-8b-instant',
                    ];

                    for (const modelName of groqModels) {
                        try {
                            const llmBody: Record<string, unknown> = {
                                model: modelName,
                                temperature: 0.05,
                                response_format: { type: 'json_object' },
                                messages: [
                                    { role: 'system', content: systemPrompt },
                                    { role: 'user', content: transcription },
                                ],
                            };
                            if (modelName === 'openai/gpt-oss-120b') {
                                llmBody.reasoning_effort = 'low';
                            }

                            const llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                                method: 'POST',
                                headers: {
                                    Authorization: `Bearer ${groqKey}`,
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify(llmBody),
                            });

                            if (llmRes.ok) {
                                const llmData = await llmRes.json();
                                const content = llmData.choices?.[0]?.message?.content || '{}';
                                const parsed = JSON.parse(content);
                                if (parsed.translation && parsed.translation.trim()) {
                                    const isFrench =
                                        speakerMode === 'therapeut'
                                            ? true
                                            : typeof parsed.isSpokenFrench === 'boolean'
                                            ? parsed.isSpokenFrench
                                            : detectedLang === 'french' || detectedLang === 'fr';
                                    resolvedSpeaker = isFrench ? 'therapeut' : 'patient';
                                    translation = parsed.translation.trim();
                                    handledByGroq = true;
                                    break;
                                }
                            }
                        } catch (innerErr) {
                            console.warn(`[API /translate] Model ${modelName} warning:`, innerErr);
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

            const systemInstruction = `Tu es un interprète médical bilingue ultra-précis entre Guillaume Philippe (praticien qui parle Français) et son patient étranger (qui parle ${targetLanguage}, code ${targetLangCode}).
1. Si silence/bruit/souffle -> "isSilence": true.
2. Si la voix parle Français -> "spokenLanguageIsFrench": true. Si elle parle ${targetLanguage} (ou une autre langue étrangère) -> "spokenLanguageIsFrench": false.
3. "frenchVersion" : TOUJOURS EN FRANÇAIS.
4. "foreignVersion" : TOUJOURS EN ${targetLanguage.toUpperCase()} (${targetLangCode}).`;

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
                    : parsed.spokenLanguageIsFrench
                    ? 'therapeut'
                    : 'patient';

            transcription = resolvedSpeaker === 'therapeut' ? frenchVersion : foreignVersion;
            translation = resolvedSpeaker === 'therapeut' ? foreignVersion : frenchVersion;
        }

        const isCjk = /[\u3040-\u9fff\uac00-\ud7af]/.test(transcription);
        if (
            !transcription ||
            !translation ||
            (!isCjk && transcription.length < 2) ||
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
