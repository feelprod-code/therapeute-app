import { GoogleGenAI, Type } from '@google/genai';
import { NextResponse } from 'next/server';

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
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });
        }

        const ai = new GoogleGenAI({ apiKey });
        const formData = await req.formData();
        const audioFile = formData.get('audio') as File | null;
        const speakerMode = (formData.get('speaker') as string) || 'bidirectional'; // 'therapeut' | 'patient' | 'bidirectional'
        const targetLanguage = (formData.get('targetLanguage') as string) || 'Anglais';
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

        const base64Audio = Buffer.from(arrayBuffer).toString('base64');

        // Nettoyer les paramètres additionnels (ex: ;codecs=opus) qui font échouer Gemini
        let mimeType = (audioFile.type || 'audio/webm').split(';')[0].trim();
        if (mimeType === 'audio/x-m4a') {
            mimeType = 'audio/mp4';
        }

        const systemInstruction = `Tu es un interprète médical bilingue ultra-précis en cabinet d'ostéopathie et kinésithérapie entre :
- Le praticien : Guillaume Philippe (qui parle TOUJOURS en Français)
- Le patient étranger (qui parle en ${targetLanguage}).

RÈGLES CRITIQUES ABSOLUES :
1. FILTRE ANTI-BRUIT : Si l'audio contient uniquement du silence, une respiration, un soupir, un toussotement, un frottement de table ou des mots incompréhensibles/isolés sans sens clinique, mets "isSilence": true.
2. IDENTIFICATION DE LA LANGUE PARLÉE :
   - Écoute dans quelle langue la personne s'exprime réellement dans l'audio.
   - Si la personne parle en Français -> "spokenLanguageIsFrench": true.
   - Si la personne parle en ${targetLanguage} (ou toute langue autre que le Français) -> "spokenLanguageIsFrench": false.
3. DEUX CHAMPS DE SORTIE DISTINCTS ET OBLIGATOIRES :
   - "frenchVersion" : DOIT TOUJOURS ÊTRE RÉDIGÉ EN FRANÇAIS. Si la patiente a parlé en ${targetLanguage}, traduis fidèlement et naturellement ses propos en Français ici. Ne mets JAMAIS d'anglais ou de ${targetLanguage} dans "frenchVersion".
   - "foreignVersion" : DOIT TOUJOURS ÊTRE RÉDIGÉ EN ${targetLanguage.toUpperCase()}. Si le praticien a parlé en Français, traduis fidèlement et chaleureusement ses propos en ${targetLanguage} ici. Si la patiente a parlé en ${targetLanguage}, écris la transcription exacte de ses paroles en ${targetLanguage} ici.`;

        const userPrompt =
            speakerMode === 'therapeut'
                ? `Le praticien parle en Français. Transcris ses paroles dans "frenchVersion" et traduis-les en ${targetLanguage} dans "foreignVersion" ("spokenLanguageIsFrench": true).`
                : speakerMode === 'patient'
                ? `Le patient parle en ${targetLanguage}. Transcris ses paroles en ${targetLanguage} dans "foreignVersion" et traduis-les impérativement en Français dans "frenchVersion" ("spokenLanguageIsFrench": false).`
                : `Mode Mains Libres Bidirectionnel : Détecte si la voix parle en Français ("spokenLanguageIsFrench": true) ou en ${targetLanguage} ("spokenLanguageIsFrench": false). Fournis obligatoirement "frenchVersion" (toujours en Français) et "foreignVersion" (toujours en ${targetLanguage}).`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { data: base64Audio, mimeType } },
                        { text: userPrompt }
                    ]
                }
            ],
            config: {
                systemInstruction,
                temperature: 0.05,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        isSilence: {
                            type: Type.BOOLEAN,
                            description: "True si silence, bruit de fond, respiration, toux ou extrait inintelligible.",
                        },
                        spokenLanguageIsFrench: {
                            type: Type.BOOLEAN,
                            description: "True UNIQUEMENT si la personne dans l'audio parle en Français. False si elle parle en Anglais ou autre langue étrangère.",
                        },
                        frenchVersion: {
                            type: Type.STRING,
                            description: "Le texte en FRANÇAIS uniquement (jamais en anglais).",
                        },
                        foreignVersion: {
                            type: Type.STRING,
                            description: `Le texte en ${targetLanguage} uniquement.`,
                        },
                    },
                    required: ["isSilence", "spokenLanguageIsFrench", "frenchVersion", "foreignVersion"],
                },
            },
        });

        const rawJson = response.text || '{}';
        let parsed: {
            isSilence?: boolean;
            spokenLanguageIsFrench?: boolean;
            frenchVersion?: string;
            foreignVersion?: string;
        } = {};

        try {
            parsed = JSON.parse(rawJson);
        } catch {
            return new Response("[SILENCE]", {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        let frenchVersion = (parsed.frenchVersion || '').trim();
        let foreignVersion = (parsed.foreignVersion || '').trim();

        if (parsed.isSilence || (!frenchVersion && !foreignVersion)) {
            return new Response("[SILENCE]", {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        // Déterminer le locuteur de manière déterministe
        let resolvedSpeaker: 'therapeut' | 'patient';
        if (speakerMode === 'therapeut') {
            resolvedSpeaker = 'therapeut';
        } else if (speakerMode === 'patient') {
            resolvedSpeaker = 'patient';
        } else {
            resolvedSpeaker = parsed.spokenLanguageIsFrench ? 'therapeut' : 'patient';
        }

        let transcription = resolvedSpeaker === 'therapeut' ? frenchVersion : foreignVersion;
        let translation = resolvedSpeaker === 'therapeut' ? foreignVersion : frenchVersion;

        // Filtre anti-hallucination sur les phrases très courtes / parasites
        if (
            transcription.length < 2 ||
            HALLUCINATION_PATTERNS.some(rx => rx.test(transcription.trim()))
        ) {
            return new Response("[SILENCE]", {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        // Filtre anti-écho : si le micro a capté la voix du haut-parleur de la traduction précédente
        if (
            lastSpokenTts &&
            (isEchoOfLastTts(transcription, lastSpokenTts) || isEchoOfLastTts(translation, lastSpokenTts))
        ) {
            return new Response("[SILENCE]", {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        // GARDE-FOU ABSOLU : Si le locuteur est le patient (ex: patiente anglaise) et que la traduction
        // est identique à la transcription (ou non traduite en français), forcer la traduction en Français !
        if (
            resolvedSpeaker === 'patient' &&
            normalizeForComparison(translation) === normalizeForComparison(transcription)
        ) {
            const fixRes = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                text: `Traduis immédiatement et uniquement cette phrase médicale de ${targetLanguage} vers le FRANÇAIS (ne réponds que par la traduction française, sans guillemets) :\n"${transcription}"`,
                            },
                        ],
                    },
                ],
                config: { temperature: 0.1 },
            });
            const fixedFr = (fixRes.text || '').trim();
            if (fixedFr) {
                translation = fixedFr;
            }
        }

        // Inversement, si Guillaume parle Français et que la traduction est restée en Français
        if (
            resolvedSpeaker === 'therapeut' &&
            normalizeForComparison(translation) === normalizeForComparison(transcription)
        ) {
            const fixRes = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                text: `Translate immediately and only this medical sentence from French into ${targetLanguage} (reply only with the ${targetLanguage} translation, no quotes):\n"${transcription}"`,
                            },
                        ],
                    },
                ],
                config: { temperature: 0.1 },
            });
            const fixedForeign = (fixRes.text || '').trim();
            if (fixedForeign) {
                translation = fixedForeign;
            }
        }

        const formattedOutput = `[SPEAKER]\n${resolvedSpeaker}\n[TRANSCRIPTION]\n${transcription}\n[TRANSLATION]\n${translation}`;

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
