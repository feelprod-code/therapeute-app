import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
<<<<<<< HEAD
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
=======
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
>>>>>>> e7e01e9 (UI refactoring: Minimalist design, unified action bar)

// Limite la durée d'exécution (valable sur Vercel, ignoré en dev local mais ça aide)
export const maxDuration = 300;

export async function POST(req: Request) {
    const uploadedFileNames: string[] = [];
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        const openAiApiKey = process.env.OPENAI_WHISPER_KEY;

<<<<<<< HEAD
        const formData = await req.formData();
        const audioFile = formData.get('audio') as File | null;
        const attachedFiles = formData.getAll('files') as File[];

        if (!audioFile) {
            console.error("[API] Aucun fichier audio dans le FormData.");
=======
        if (!apiKey) return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });
        if (!openAiApiKey) return NextResponse.json({ error: "Clé API OpenAI manquante." }, { status: 500 });

        const formData = await req.formData();
        const audioFile = formData.get('audio') as File;
        const attachedFiles = formData.getAll('files') as File[];

        if (!audioFile) {
>>>>>>> e7e01e9 (UI refactoring: Minimalist design, unified action bar)
            return NextResponse.json({ error: "Aucun fichier audio fourni." }, { status: 400 });
        }

        console.log(`[API] Réception d'un fichier audio : ${audioFile.name}, Taille: ${audioFile.size} octets, Type: ${audioFile.type}`);
<<<<<<< HEAD

        if (audioFile.size === 0) {
            console.error("[API] Le flux audio est vide.");
            return NextResponse.json({ error: "L'enregistrement audio est vide." }, { status: 400 });
        }

        const parts: Array<{ text?: string; fileData?: { fileUri: string; mimeType: string } }> = [];

        // 1. Process Audio File
        const audioArrayBuffer = await audioFile.arrayBuffer();
        const audioBuffer = Buffer.from(audioArrayBuffer);
        const audioTmpPath = join(tmpdir(), `audio_${Date.now()}_${audioFile.name.replace(/[^a-zA-Z0-9.]/g, '_')}`);

        await writeFile(audioTmpPath, audioBuffer);

        console.log(`[API] Uploading audio to Gemini...`);
        const uploadedAudio = await ai.files.upload({
            file: audioTmpPath,
            config: { mimeType: audioFile.type || 'audio/webm' },
        });
        console.log(`[API] Audio uploaded: ${uploadedAudio.name}`);

        if (uploadedAudio.name) uploadedFileNames.push(uploadedAudio.name);

        parts.push({
            fileData: {
                fileUri: uploadedAudio.uri || "",
                mimeType: uploadedAudio.mimeType || "",
            }
        });

        // Clean up audio tmp file
        await unlink(audioTmpPath).catch(console.error);

        // 2. Process Attached Files
        if (attachedFiles && attachedFiles.length > 0) {
            console.log(`[API] Processing ${attachedFiles.length} attached files...`);
            for (let i = 0; i < attachedFiles.length; i++) {
                const f = attachedFiles[i];
                if (f.size === 0) continue;

                const fArrayBuffer = await f.arrayBuffer();
                const fBuffer = Buffer.from(fArrayBuffer);
                const fTmpPath = join(tmpdir(), `file_${Date.now()}_${i}_${f.name.replace(/[^a-zA-Z0-9.]/g, '_')}`);

                await writeFile(fTmpPath, fBuffer);

                console.log(`[API] Uploading attached file ${f.name} to Gemini...`);
                const uploadedF = await ai.files.upload({
                    file: fTmpPath,
                    config: { mimeType: f.type || 'application/octet-stream' },
                });
                console.log(`[API] Attached file uploaded: ${uploadedF.name}`);

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
=======
        console.log(`[API] Réception de ${attachedFiles.length} fichier(s) attaché(s).`);

        // --- 1. TRANSCRIPTION OPENAI (WHISPER) ---
        const openai = new OpenAI({ apiKey: openAiApiKey });
        let extAudio = '.webm';
        if (audioFile.name && audioFile.name.includes('.')) {
            extAudio = audioFile.name.substring(audioFile.name.lastIndexOf('.'));
        }

        const tempAudioPath = path.join(os.tmpdir(), `tdt-audio-${Date.now()}-${Math.random().toString(36).substring(7)}${extAudio}`);
        const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
        await fs.writeFile(tempAudioPath, audioBuffer);

        console.log(`[API OpenAI] Envoi de l'audio à Whisper...`);
        const transcriptionResponse = await openai.audio.transcriptions.create({
            file: createReadStream(tempAudioPath),
            model: "whisper-1",
            language: "fr", // Optimisation : on force le français
            response_format: "text",
        });

        const transcription = transcriptionResponse; // Le format 'text' renvoie string textuellement

>>>>>>> e7e01e9 (UI refactoring: Minimalist design, unified action bar)

        await fs.unlink(tempAudioPath).catch(() => { });
        console.log(`[API Groq] Transcription réussie ! Longueur: ${transcription.length} caractères.`);

        // --- 2. UPLOAD DES DOCUMENTS ATTACHÉS VERS GEMINI ---
        const ai = new GoogleGenAI({ apiKey });
        const allUploads: { uri: string, mimeType: string, name: string }[] = [];

        const uploadToGemini = async (f: File) => {
            const buffer = Buffer.from(await f.arrayBuffer());

            // Grab extension
            let ext = '';
            if (f.name && f.name.includes('.')) {
                ext = f.name.substring(f.name.lastIndexOf('.'));
            } else if (f.type) {
                if (f.type.includes('pdf')) ext = '.pdf';
                else if (f.type.includes('jpeg') || f.type.includes('jpg')) ext = '.jpg';
                else if (f.type.includes('png')) ext = '.png';
            }

            const tempFilePath = path.join(os.tmpdir(), `tdt-file-${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);
            await fs.writeFile(tempFilePath, buffer);
            console.log(`[API] Fichier temporaire créé : ${tempFilePath}`);

            const uploadResult = await ai.files.upload({
                file: tempFilePath,
                config: {
                    mimeType: f.type || 'application/octet-stream',
                }
            });
            console.log(`[API] Fichier uploadé sur Gemini File API : ${uploadResult.uri}`);

            await fs.unlink(tempFilePath).catch(() => { });

            if (!uploadResult.name || !uploadResult.uri) {
                throw new Error("L'API Gemini n'a pas retourné de nom ou d'URI de fichier valide.");
            }
            return { uri: uploadResult.uri, mimeType: f.type || 'application/octet-stream', name: uploadResult.name };
        };

        for (const attach of attachedFiles) {
            allUploads.push(await uploadToGemini(attach));
        }

        // Polling pour s'assurer que les fichiers joints sont "ACTIVE"
        for (const uploaded of allUploads) {
            let fileInfo;
            try {
                fileInfo = await ai.files.get({ name: uploaded.name });
            } catch {
                console.log(`[API] Erreur initiale au get du fichier, on suppose PROCESSING...`);
                fileInfo = { state: 'PROCESSING' };
            }

            let attempts = 0;
            while (fileInfo.state === 'PROCESSING' && attempts < 180) {
                console.log(`[API] Fichier (${uploaded.name}) en cours de traitement... (tentative ${attempts}/180)`);
                await new Promise(r => setTimeout(r, 3000));
                attempts++;
                try {
                    fileInfo = await ai.files.get({ name: uploaded.name });
                } catch {
                    console.log(`[API] Fichier (${uploaded.name}) erreur API Gemini pendant le polling, on retente...`);
                }
            }

            if (fileInfo.state === 'FAILED') {
                throw new Error(`L'API Gemini a échoué à traiter le fichier ${uploaded.name}.`);
            }
            if (fileInfo.state === 'PROCESSING') {
                throw new Error(`Le fichier ${uploaded.name} met trop de temps à être traité par Gemini.`);
            }
            console.log(`[API] Fichier Prêt: ${fileInfo.state}`);
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

<<<<<<< HEAD
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
=======
        const parts: Array<{ text?: string, fileData?: { fileUri: string, mimeType: string } }> = allUploads.map(up => ({
            fileData: { fileUri: up.uri, mimeType: up.mimeType }
        }));
        parts.push({ text: `Voici la transcription de l'audio:\n\n${transcription}\n\nINSTRUCTIONS DU SYSTEME:\n${systemPrompt}` });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: parts,
>>>>>>> e7e01e9 (UI refactoring: Minimalist design, unified action bar)
            config: {
                systemInstruction: "Tu retournes uniquement du JSON.",
            }
        });

        const texteResponse = response.text;

        console.log(`[API] Réponse brute Gemini (début):`, texteResponse?.substring(0, 100));

        if (!texteResponse) {
            throw new Error("L'API Gemini a retourné une réponse vide.");
        }

<<<<<<< HEAD
        // Clean up Gemini files after generation
        for (const fileName of uploadedFileNames) {
            try {
                await ai.files.delete({ name: fileName });
                console.log(`[API] Deleted Gemini file: ${fileName}`);
            } catch (err) {
                console.error(`[API] Failed to delete Gemini file ${fileName}:`, err);
            }
        }

        return NextResponse.json({
            synthese: parsedResult.synthese,
            resume: parsedResult.resume,
            patientName: parsedResult.patientName,
            transcription: parsedResult.transcription
        });
    } catch (error: unknown) {
        console.error("Erreur Gemini:", error);

        // Ensure cleanup even on error
        for (const fileName of uploadedFileNames) {
            try {
                await ai.files.delete({ name: fileName });
            } catch {
                // Ignore errors during cleanup
            }
        }

        const errorMessage = error instanceof Error ? error.message : "Erreur lors du traitement Gemini";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
=======
        const cleanJson = texteResponse
            .replace(/```json\n/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const jsonResult = JSON.parse(cleanJson);

        return NextResponse.json(jsonResult);

    } catch (error: unknown) {
        console.error("Erreur serveur API /analyze :", error);
        const errorMessage = error instanceof Error ? error.message : "Erreur inconnue.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
>>>>>>> e7e01e9 (UI refactoring: Minimalist design, unified action bar)
    }
}
