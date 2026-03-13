import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';

export const maxDuration = 300;

export async function POST(req: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        const openAiApiKey = process.env.OPENAI_WHISPER_KEY;

        if (!apiKey) return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });
        if (!openAiApiKey) return NextResponse.json({ error: "Clé API OpenAI manquante." }, { status: 500 });

        const formData = await req.formData();

        const audioFile = formData.get('audio') as File | null;
        const attachedFiles = formData.getAll('files') as File[];
        const oldTranscription = formData.get('oldTranscription') as string || '';
        const oldSynthese = formData.get('oldSynthese') as string || '';
        const oldPatientName = formData.get('oldPatientName') as string || '';

        let newTranscriptionText = '';

        if (audioFile) {
            console.log(`[API UPDATE] Réception d'un nouvel audio : ${audioFile.name}, Taille: ${audioFile.size} octets`);

            const openai = new OpenAI({ apiKey: openAiApiKey });
            let extAudio = '.webm';
            if (audioFile.name && audioFile.name.includes('.')) {
                extAudio = audioFile.name.substring(audioFile.name.lastIndexOf('.'));
            }

            const tempAudioPath = path.join(os.tmpdir(), `tdt-update-${Date.now()}-${Math.random().toString(36).substring(7)}${extAudio}`);
            const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
            await fs.writeFile(tempAudioPath, audioBuffer);

            console.log(`[API UPDATE] Transcription du nouvel audio par Whisper...`);
            const transcriptionResponse = await openai.audio.transcriptions.create({
                file: createReadStream(tempAudioPath),
                model: "whisper-1",
                language: "fr",
                response_format: "text",
            });

            newTranscriptionText = String(transcriptionResponse);
            await fs.unlink(tempAudioPath).catch(() => { });
            console.log(`[API UPDATE] Transcription réussie ! Longueur: ${newTranscriptionText.length} caractères.`);
        }

        console.log(`[API UPDATE] Réception de ${attachedFiles.length} nouveau(x) fichier(s) attaché(s).`);

        const ai = new GoogleGenAI({ apiKey });
        const allUploads: { uri: string, mimeType: string, name: string }[] = [];

        const uploadToGemini = async (f: File) => {
            const buffer = Buffer.from(await f.arrayBuffer());
            let ext = '';
            if (f.name && f.name.includes('.')) {
                ext = f.name.substring(f.name.lastIndexOf('.'));
            } else if (f.type) {
                if (f.type.includes('pdf')) ext = '.pdf';
                else if (f.type.includes('jpeg') || f.type.includes('jpg')) ext = '.jpg';
                else if (f.type.includes('png')) ext = '.png';
            }

            const tempFilePath = path.join(os.tmpdir(), `tdt-file-up-${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);
            await fs.writeFile(tempFilePath, buffer);
            console.log(`[API UPDATE] Fichier temporaire créé : ${tempFilePath}`);

            const uploadResult = await ai.files.upload({
                file: tempFilePath,
                config: { mimeType: f.type || 'application/octet-stream' }
            });

            await fs.unlink(tempFilePath).catch(() => { });

            if (!uploadResult.name || !uploadResult.uri) {
                throw new Error("L'API Gemini n'a pas retourné d'URI valide.");
            }
            return { uri: uploadResult.uri, mimeType: f.type || 'application/octet-stream', name: uploadResult.name };
        };

        for (const attach of attachedFiles) {
            allUploads.push(await uploadToGemini(attach));
        }

        for (const uploaded of allUploads) {
            let fileInfo;
            try { fileInfo = await ai.files.get({ name: uploaded.name }); }
            catch { fileInfo = { state: 'PROCESSING' }; }

            let attempts = 0;
            while (fileInfo.state === 'PROCESSING' && attempts < 180) {
                await new Promise(r => setTimeout(r, 3000));
                attempts++;
                try { fileInfo = await ai.files.get({ name: uploaded.name }); } catch { }
            }

            if (fileInfo.state === 'FAILED' || fileInfo.state === 'PROCESSING') {
                throw new Error(`Traitement du fichier ${uploaded.name} échoué ou trop long.`);
            }
        }


        const parts: Array<{ text?: string, fileData?: { fileUri: string, mimeType: string } }> = allUploads.map(up => ({
            fileData: { fileUri: up.uri, mimeType: up.mimeType }
        }));

        let textPrompt = `Le médecin ajoute un complément d'information à un dossier patient existant.
Voici TON PRÉCÉDENT BILAN (à conserver au maximum, mais à enrichir) :
-----------------
${oldSynthese}
-----------------`;

        if (oldPatientName) {
            textPrompt += `\nLe patient s'appelait jusqu'à présent : ${oldPatientName}`;
        }

        if (newTranscriptionText.length > 0) {
            textPrompt += `\n\nVoici l'enregistrement VOCAL qui vient d'être rajouté par le thérapeute :
-----------------
${newTranscriptionText}
-----------------`;
        }

        if (attachedFiles.length > 0) {
            textPrompt += `\n\nTu as aussi de NOUVEAUX DOCUMENTS de biologie ou échographie attachés à ta vue. Exploite leurs conclusions.`;
        }

        textPrompt += `\n\nConsigne absolue :
Reformule ENTIÈREMENT le bilan final mis à jour et unifié, sans indiquer explicitement "le médecin a rajouté". Tu dois extraire ou corriger le NOM du patient si cela est spécifié dans les nouveaux éléments.
Format JSON attendu EXACTEMENT COMME CECI UNIQUEMENT :
{
  "patientName": "Nom et Prénom du patient (conservé, ajouté ou corrigé)",
  "synthese": "La nouvelle synthèse médicale mise à jour et unifiée en Markdown."
}`;

        parts.push({ text: textPrompt });

        console.log("[API UPDATE] Envoi à Gemini des informations additives...")
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: parts,
            config: {
                systemInstruction: "Tu retournes uniquement du JSON strict contenant les propriétés 'patientName' et 'synthese'.",
            }
        });

        const jsonText = response.text || "";
        let jsonResult;

        try {
            const rawJson = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
            jsonResult = JSON.parse(rawJson);
        } catch {
            throw new Error("L'API Gemini n'a pas renvoyé un JSON valide.\n" + jsonText);
        }

        let finaleTranscription = oldTranscription;
        if (newTranscriptionText) {
            finaleTranscription += `\n\n[AJOUT ULTÉRIEUR DU THÉRAPEUTE] :\n${newTranscriptionText}`;
        }

        return NextResponse.json({
            patientName: jsonResult.patientName,
            synthese: jsonResult.synthese,
            transcription: finaleTranscription
        });

    } catch (error: unknown) {
        console.error("Erreur serveur API /update-analyze :", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur inconnue" }, { status: 500 });
    }
}
