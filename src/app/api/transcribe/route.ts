import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Clé GEMINI_API_KEY non configurée sur le serveur." },
        { status: 500 }
      );
    }

    let audioBuffer: Buffer | null = null;
    let mimeType = 'audio/webm';

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json(
          { error: "Aucun fichier audio fourni dans le formulaire." },
          { status: 400 }
        );
      }
      const arrayBuffer = await file.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
      mimeType = file.type || 'audio/webm';
    } else if (contentType.includes('application/json')) {
      const body = await req.json();
      if (!body.audioBase64) {
        return NextResponse.json(
          { error: "Aucune donnée audioBase64 fournie." },
          { status: 400 }
        );
      }
      audioBuffer = Buffer.from(body.audioBase64, 'base64');
      mimeType = body.mimeType || 'audio/webm';
    } else {
      const arrayBuffer = await req.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
      mimeType = contentType || 'audio/webm';
    }

    if (!audioBuffer || audioBuffer.length < 200) {
      return NextResponse.json(
        { error: "Fichier audio trop court ou vide." },
        { status: 400 }
      );
    }

    // Normaliser le mimeType pour Gemini
    let geminiMimeType = mimeType.split(';')[0].trim();
    if (geminiMimeType === 'audio/x-m4a' || geminiMimeType === 'audio/m4a') {
      geminiMimeType = 'audio/mp4';
    }
    if (!['audio/mp4', 'audio/webm', 'audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/aac'].includes(geminiMimeType)) {
      geminiMimeType = 'audio/webm';
    }

    const b64Audio = audioBuffer.toString('base64');

    const prompt = `Tu es l'assistant vocal officiel de FeelProd et du cabinet d'ostéopathie / TDT de Guillaume Philippe.
Transcris avec une fidélité absolue l'audio ci-joint.
Règles d'or :
1. Corrige la grammaire, la ponctuation, supprime les hésitations (euh, bah, hum).
2. Vocabulaire ostéopathique & clinique spécifique : FeelProd, Antigravity, TDT, Sutherland, Blechschmidt, SSB, MRP, dural, fascia, sphéno-basilaire, lemniscate, synchondrose, motilité, motricité, biodynamique, liquide cérébro-spinal, LCS, LCR, méninge, faux du cerveau, tente du cervelet, occiput, sacrum, sphénoïde, ethmoïde, temporal, pariétal, frontal, vomer, maxillaire, mandibule, ATM, ptérygoïde, crânien, viscéral, somato-émotionnel, fulcrum, Still, Becker, Viola Frymann, Rollin Becker, Fulford, Magoun, Jealous.
3. Renvoie UNIQUEMENT le texte propre nettoyé, sans aucun préfixe ni commentaire ni balises markdown.`;

    const modelsToTry = ["gemini-3.5-transcribe", "gemini-2.5-flash"];
    let cleanText = "";
    let lastError = "";

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: geminiMimeType,
                    data: b64Audio
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096
          }
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const data = await res.json();
          cleanText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          if (cleanText) break;
        } else {
          lastError = await res.text();
          console.warn(`[Therapeute Transcribe] Model ${model} returned ${res.status}: ${lastError.slice(0, 100)}`);
        }
      } catch (err: any) {
        lastError = err.message;
      }
    }

    if (!cleanText) {
      return NextResponse.json(
        { error: `Erreur API Gemini : ${lastError.slice(0, 200)}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ text: cleanText });
  } catch (error: any) {
    console.error("[API Transcribe] Exception:", error);
    return NextResponse.json(
      { error: error.message || "Erreur interne lors de la transcription." },
      { status: 500 }
    );
  }
}
