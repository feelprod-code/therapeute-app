import { NextResponse } from 'next/server';
import { generateWarmTtsAudio } from '@/lib/warm-tts';

export const maxDuration = 30;

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const rawText = (body.text || '').toString();
        const langCode = (body.langCode || 'fr-FR').toString();
        const speaker = (body.speaker || 'patient').toString();
        const voicePreset = (body.voicePreset || 'duo_warm').toString();

        const result = await generateWarmTtsAudio(rawText, langCode, speaker, voicePreset);
        if (!result) {
            return NextResponse.json({ error: "Impossible de générer la voix." }, { status: 500 });
        }

        return new Response(new Uint8Array(result.buffer), {
            headers: {
                'Content-Type': result.mimeType,
                'Cache-Control': 'no-store',
                'X-Voice-Engine': result.engine,
            },
        });
    } catch (error: unknown) {
        console.error("Erreur serveur API /tts :", error);
        const errorMessage = error instanceof Error ? error.message : "Erreur TTS inconnue.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
