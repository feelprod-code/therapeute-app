import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300;

export async function POST(req: Request) {
    const uploadedFileNames: string[] = [];
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const storageFilesToDelete: string[] = [];

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });

        const body = await req.json();
        const { audioFile, attachedFiles } = body;

        if (!audioFile || !audioFile.fileName) {
            console.error("[API] Aucun fichier audio reference.");
            return NextResponse.json({ error: "Aucun fichier audio fourni." }, { status: 400 });
        }

        console.log(`[API] Récupération de l'audio depuis Supabase: ${audioFile.fileName}`);
        storageFilesToDelete.push(audioFile.fileName);

        const { data: audioData, error: audioError } = await supabase.storage.from('tdt_uploads').download(audioFile.fileName);
        if (audioError || !audioData) {
            throw new Error("Impossible de télécharger l'audio depuis Supabase: " + (audioError?.message || ""));
        }

        const parts: Array<{ text?: string; fileData?: { fileUri: string; mimeType: string } }> = [];

        // 1. Process Audio File
        const audioArrayBuffer = await audioData.arrayBuffer();
        const audioBuffer = Buffer.from(audioArrayBuffer);
        const audioTmpPath = join(tmpdir(), `audio_${Date.now()}_${audioFile.fileName.replace(/[^a-zA-Z0-9.]/g, '_')}`);

        await writeFile(audioTmpPath, audioBuffer);

        console.log(`[API] Uploading audio to Gemini...`);
        const uploadedAudio = await ai.files.upload({
            file: audioTmpPath,
            config: { mimeType: audioFile.mimeType || 'audio/webm' },
        });
        console.log(`[API] Audio uploaded: ${uploadedAudio.name}`);

        if (uploadedAudio.name) uploadedFileNames.push(uploadedAudio.name);

        parts.push({
            fileData: {
                fileUri: uploadedAudio.uri || "",
                mimeType: uploadedAudio.mimeType || "",
            }
        });

        await unlink(audioTmpPath).catch(console.error);

        // 2. Process Attached Files
        if (attachedFiles && attachedFiles.length > 0) {
            console.log(`[API] Processing ${attachedFiles.length} attached files...`);
            for (let i = 0; i < attachedFiles.length; i++) {
                const f = attachedFiles[i];
                storageFilesToDelete.push(f.fileName);

                const { data: fData, error: fError } = await supabase.storage.from('tdt_uploads').download(f.fileName);
                if (fError || !fData) {
                    console.error("Erreur téléchargement fichier attaché", f.fileName, fError);
                    continue;
                }

                const fArrayBuffer = await fData.arrayBuffer();
                const fBuffer = Buffer.from(fArrayBuffer);
                const fTmpPath = join(tmpdir(), `file_${Date.now()}_${i}_${f.fileName.replace(/[^a-zA-Z0-9.]/g, '_')}`);

                await writeFile(fTmpPath, fBuffer);

                console.log(`[API] Uploading attached file ${f.fileName} to Gemini...`);
                const uploadedF = await ai.files.upload({
                    file: fTmpPath,
                    config: { mimeType: f.mimeType || 'application/octet-stream' },
                });

                if (uploadedF.name) uploadedFileNames.push(uploadedF.name);

                parts.push({
                    fileData: {
                        fileUri: uploadedF.uri || "",
                        mimeType: uploadedF.mimeType || "",
                    }
                });

                await unlink(fTmpPath).catch(console.error);
            }
        }

        // --- 3. ANALYSE GEMINI (TEXTE + DOCUMENTS) ---
        const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est d'analyser la transcription d'un interrogatoire patient fourni et de produire un bilan.
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "transcription": "La retranscription littérale et intégrale (brouillon mots-à-mots) de l'enregistrement",
  "resume": "Un résumé narratif en 3 à 5 phrases, sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce). Intègre l'essentiel de façon fluide.",
  "synthese": "La synthèse médicale formatée en Markdown"
}

Règles impératives :
1. "patientName" : Nom du patient (ex:"Jean DUPONT"). Laisse vide "" si absent.
2. "transcription" : Intégralité du texte brut reçu en entrée.
3. "resume" : Remplacer la transcription par un texte lisible en un coup d'oeil.
4. "synthese" : Applique strictement la structure Markdown ci-dessous UNIQUEMENT si l'information est présente :

# Bilan de Consultation - ${currentDate}

### Informations Patient
- **Nom/Prénom :** [Jean Dupont]
- **Âge / Date de naissance :** [Extraire si mentionné]
- **Profession :** [Extraire si mentionné]
- **Date de consultation :** La consultation se passe aujourd'hui le ${currentDate}.
### Motif de Consultation
[...]
### Histoire de la Maladie / Douleur
- **Description :** [...]
- **Intensité :** [...]
- **Fréquence :** [...]
- **Circonstances d'apparition :** [...]
### Examens Complémentaires
- **Photos / PDF / Textes :** [...]
### Antécédents (ATCD) et Chronologie
*Présente TOUS les antécédents, traumatismes, accidents, interventions dans un ordre strictement chronologique de la naissance jusqu'à aujourd'hui.*
*IMPORTANT : Ne garde que ce qui est explicitement dit.*
- [Année] - [Description]`;

        parts.push({ text: systemPrompt });

        console.log(`[API] Generating content...`);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: [
                {
                    role: 'user',
                    parts: parts
                }
            ],
            config: {
                systemInstruction: "Tu retournes uniquement du JSON.",
            }
        });

        const texteResponse = response.text;

        if (!texteResponse) {
            throw new Error("L'API Gemini a retourné une réponse vide.");
        }

        const cleanJson = texteResponse
            .replace(/\`\`\`json\n/g, '')
            .replace(/\`\`\`\n?/g, '')
            .trim();

        const jsonResult = JSON.parse(cleanJson);

        // CLEANUP
        for (const fileName of uploadedFileNames) {
            await ai.files.delete({ name: fileName }).catch(() => { });
        }
        if (storageFilesToDelete.length > 0) {
            await supabase.storage.from('tdt_uploads').remove(storageFilesToDelete).catch(() => { });
        }

        return NextResponse.json(jsonResult);

    } catch (error: unknown) {
        console.error("Erreur serveur API /analyze :", error);

        for (const fileName of uploadedFileNames) {
            await ai.files.delete({ name: fileName }).catch(() => { });
        }
        if (storageFilesToDelete.length > 0) {
            await supabase.storage.from('tdt_uploads').remove(storageFilesToDelete).catch(() => { });
        }

        const errorMessage = error instanceof Error ? error.message : "Erreur inconnue.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
