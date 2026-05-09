import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const { targetLanguage, speaker } = await request.json();

        if (!process.env.OPENAI_API_KEY) {
            return NextResponse.json({ error: 'OPENAI_API_KEY non configurée' }, { status: 500 });
        }

        let instructions = '';
        if (speaker === 'bidirectional') {
            instructions = `Tu es un interprète médical professionnel en temps réel pour une consultation.
Deux personnes parlent :
- Le thérapeute parle en FRANÇAIS
- Le patient parle en ${targetLanguage}

Tu dois :
1. Écouter chaque phrase
2. Détecter automatiquement la langue parlée
3. Si c'est du français → traduire en ${targetLanguage} et prononcer la traduction
4. Si c'est du ${targetLanguage} → traduire en français et prononcer la traduction

Règles strictes :
- Ne réponds QUE avec la traduction, JAMAIS de commentaire
- Pas de "voici la traduction", pas d'explication
- Traduis phrase par phrase dès que le sens est clair
- Vocabulaire médical adapté`;
        } else if (speaker === 'therapeut') {
            instructions = `Tu es un interprète médical professionnel en temps réel.
Le thérapeute parle en FRANÇAIS. Tu dois :
1. Écouter attentivement ce qu'il dit
2. Traduire fidèlement en ${targetLanguage}
3. Prononcer la traduction clairement

Règles strictes :
- Ne réponds QUE avec la traduction, rien d'autre
- Pas de commentaires, pas d'explications, pas de "voici la traduction"
- Utilise un vocabulaire médical adapté au patient
- Traduis phrase par phrase dès que le sens est clair`;
        } else {
            instructions = `Tu es un interprète médical professionnel en temps réel.
Le patient parle en ${targetLanguage}. Tu dois :
1. Écouter attentivement ce qu'il dit
2. Traduire fidèlement en FRANÇAIS
3. Prononcer la traduction clairement

Règles strictes :
- Ne réponds QUE avec la traduction en français, rien d'autre
- Pas de commentaires, pas d'explications
- Utilise un vocabulaire médical clair pour le thérapeute
- Traduis phrase par phrase dès que le sens est clair`;
        }

        const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o-realtime-preview",
                modalities: ["audio", "text"],
                instructions,
                voice: "echo",
                input_audio_transcription: {
                    model: "whisper-1",
                },
                turn_detection: {
                    type: "server_vad",
                    threshold: 0.8,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 1000,
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenAI session error:", errorText);
            return NextResponse.json(
                { error: 'Impossible de créer la session Realtime', details: errorText },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Erreur création session:", error);
        return NextResponse.json(
            { error: 'Erreur interne serveur' },
            { status: 500 }
        );
    }
}
