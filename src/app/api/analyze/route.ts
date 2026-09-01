/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, prefer-const */
import { GoogleGenAI, Type } from '@google/genai';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ensureLastNameFirst, extractPatientNameFromText } from '@/lib/utils';

const execAsync = promisify(exec);

export const maxDuration = 800; // 15 minutes instead of 5

// Chercher ffmpeg à des emplacements connus ou dans le PATH
async function findFfmpeg(): Promise<string | null> {
    const pathsToCheck = [
        'ffmpeg', // PATH global
        '/Users/guillaumephilippe/.local/bin/ffmpeg', // Chemin local utilisateur
        '/usr/local/bin/ffmpeg',
        '/opt/homebrew/bin/ffmpeg',
        '/usr/bin/ffmpeg'
    ];

    for (const p of pathsToCheck) {
        try {
            const cmd = p === 'ffmpeg' ? 'ffmpeg -version' : `"${p}" -version`;
            await execAsync(cmd);
            console.log(`[FFmpeg] Trouvé à : ${p}`);
            return p;
        } catch {
            // Ignorer l'erreur et tenter le suivant
        }
    }
    console.warn(`[FFmpeg] Non trouvé dans les chemins standard.`);
    return null;
}

async function fixAudioBufferWithFfmpeg(buffer: any, mimeType: string): Promise<any> {
    // Correction uniquement si c'est un fichier webm (audio ou vidéo)
    if (!mimeType || !mimeType.includes('webm')) {
        return buffer;
    }

    const ffmpegPath = await findFfmpeg();
    if (!ffmpegPath) {
        console.warn("[FFmpeg] ffmpeg introuvable, retour au buffer original.");
        return buffer;
    }

    const tempInput = path.join(os.tmpdir(), `fix-in-${Date.now()}-${Math.random().toString(36).substring(7)}.webm`);
    const tempOutput = path.join(os.tmpdir(), `fix-out-${Date.now()}-${Math.random().toString(36).substring(7)}.webm`);

    try {
        await fs.writeFile(tempInput, buffer);
        console.log(`[FFmpeg] Fichier temporaire d'entrée créé : ${tempInput}`);

        // Reconstruction des métadonnées du conteneur sans réencodage (très rapide)
        const cmd = `"${ffmpegPath}" -i "${tempInput}" -c:a copy -y "${tempOutput}"`;
        console.log(`[FFmpeg] Exécution : ${cmd}`);
        await execAsync(cmd);

        const fixedBuffer = await fs.readFile(tempOutput);
        console.log(`[FFmpeg] Fichier corrigé avec succès par FFmpeg. Taille : ${(fixedBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        return fixedBuffer;
    } catch (err) {
        console.error("[FFmpeg] Échec de la réparation de l'audio :", err);
        return buffer;
    } finally {
        await fs.unlink(tempInput).catch(() => {});
        await fs.unlink(tempOutput).catch(() => {});
    }
}

function extractKeyValues(jsonStr: string): Record<string, string> | null {
    const keys = ["patientName", "consultationDate", "transcription", "resume", "synthese"];
    const result: Record<string, string> = {};
    
    const positions: { key: string; index: number }[] = [];
    for (const key of keys) {
        const regex = new RegExp(`"(?:${key})"\\s*:`, 'g');
        const match = regex.exec(jsonStr);
        if (match) {
            positions.push({ key, index: match.index });
        }
    }
    
    if (positions.length === 0) return null;
    positions.sort((a, b) => a.index - b.index);
    
    for (let i = 0; i < positions.length; i++) {
        const current = positions[i];
        const next = positions[i + 1];
        
        const colonIndex = jsonStr.indexOf(':', current.index);
        if (colonIndex === -1) continue;
        
        let valStart = colonIndex + 1;
        while (valStart < jsonStr.length && /\s/.test(jsonStr[valStart])) {
            valStart++;
        }
        
        let valEnd = jsonStr.length;
        if (next) {
            valEnd = next.index;
            const beforeNext = jsonStr.substring(valStart, valEnd);
            const commaMatch = beforeNext.match(/,\s*$/);
            if (commaMatch && commaMatch.index !== undefined) {
                valEnd = valStart + commaMatch.index;
            }
        } else {
            const lastCurly = jsonStr.lastIndexOf('}');
            if (lastCurly !== -1 && lastCurly > valStart) {
                valEnd = lastCurly;
            }
        }
        
        let rawVal = jsonStr.substring(valStart, valEnd).trim();
        
        if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
            rawVal = rawVal.substring(1, rawVal.length - 1);
        } else if (rawVal.startsWith('"')) {
            rawVal = rawVal.substring(1);
        }
        
        result[current.key] = rawVal
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t');
    }
    
    return result;
}

function cleanFileName(fileName: string): string {
    const match = fileName.match(/^(?:doc|archive|audio_addendum|txt_addendum|audio)_[0-9]+_[a-f0-9-]+_(.*)$/i);
    if (match) {
        return match[1];
    }
    const uuidMatch = fileName.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}_(.*)$/i);
    if (uuidMatch) {
        return uuidMatch[1];
    }
    return fileName;
}

export async function POST(req: Request) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const storageFilesToDelete: string[] = [];

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        console.log(`[API] Checking injected API key prefix: ${apiKey?.substring(0, 15)}...`);

        if (!apiKey) return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });

        const body = await req.json();
        const { audioFile, attachedFiles, previousContext, newText } = body;

        // Note: For appending documents only, audioFile might be optional. 
        // We'll relax the strict audioFile requirement if there are attachedFiles or newText.
        if ((!audioFile || !audioFile.fileName) && (!attachedFiles || attachedFiles.length === 0) && !newText) {
            console.error("[API] Aucun fichier audio, document ni texte fourni.");
            return NextResponse.json({ error: "Aucun fichier ou texte fourni à analyser." }, { status: 400 });
        }

        // 1. Process Audio File (if present)
        const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string }, fileData?: { fileUri: string, mimeType: string } }> = [];
        const allUploads: { uri: string, mimeType: string, name: string }[] = [];
        const uploadedDocs: { uri: string, mimeType: string, name: string, cleanName: string }[] = [];
        const textFilesContent: { cleanName: string, text: string }[] = [];

        const uploadToGemini = async (buffer: Buffer, originalName: string, defaultMime: string) => {
            let ext = '';
            if (originalName && originalName.includes('.')) {
                ext = originalName.substring(originalName.lastIndexOf('.'));
            } else if (defaultMime) {
                if (defaultMime.includes('webm')) ext = '.webm';
                else if (defaultMime.includes('mp4') || defaultMime.includes('m4a')) ext = '.m4a';
                else if (defaultMime.includes('mpeg') || defaultMime.includes('mp3')) ext = '.mp3';
                else if (defaultMime.includes('pdf')) ext = '.pdf';
                else if (defaultMime.includes('jpeg') || defaultMime.includes('jpg')) ext = '.jpg';
                else if (defaultMime.includes('png')) ext = '.png';
            }

            const tempFilePath = path.join(os.tmpdir(), `tdt-file-${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);
            await fs.writeFile(tempFilePath, buffer);
            console.log(`[API] Fichier temporaire créé : ${tempFilePath}`);

            const uploadResult = await ai.files.upload({
                file: tempFilePath,
                config: {
                    mimeType: defaultMime || 'application/octet-stream',
                }
            });
            console.log(`[API] Fichier uploadé sur Gemini File API : ${uploadResult.uri}`);

            await fs.unlink(tempFilePath).catch(() => { });

            if (!uploadResult.name || !uploadResult.uri) {
                throw new Error("L'API Gemini n'a pas retourné de nom ou d'URI de fichier valide.");
            }
            return { uri: uploadResult.uri, mimeType: defaultMime || 'application/octet-stream', name: uploadResult.name };
        };

        let finalMimeType = '';
        let processedAudioBuffer: Buffer = Buffer.alloc(0);

        if (audioFile && audioFile.fileName) {
            console.log(`[API] Récupération de l'audio depuis Supabase: ${audioFile.fileName}`);
            storageFilesToDelete.push(audioFile.fileName);

            const { data: audioData, error: audioError } = await supabase.storage.from('tdt_uploads').download(audioFile.fileName);
            if (audioError || !audioData) {
                throw new Error("Impossible de télécharger l'audio depuis Supabase: " + (audioError?.message || ""));
            }

            const audioArrayBuffer = await audioData.arrayBuffer();
            const audioBuffer = Buffer.from(audioArrayBuffer);

            // Inférence robuste du MIME type depuis l'extension si non fourni ou forcé erroné
            finalMimeType = audioFile.mimeType;
            if (finalMimeType) {
                // Retire les paramètres additionnels (ex: ;codecs=opus) qui font planter Gemini
                finalMimeType = finalMimeType.split(';')[0].trim();
            }
            if (!finalMimeType) {
                const ext = audioFile.fileName.split('.').pop()?.toLowerCase();
                if (ext === 'm4a') finalMimeType = 'audio/mp4';
                else if (ext === 'mp3') finalMimeType = 'audio/mp3';
                else if (ext === 'wav') finalMimeType = 'audio/wav';
                else if (ext === 'mp4') finalMimeType = 'video/mp4';
                else if (ext === 'ogg') finalMimeType = 'audio/ogg';
                else if (ext === 'txt') finalMimeType = 'text/plain';
                else if (ext === 'pdf') finalMimeType = 'application/pdf';
                else if (ext === 'png') finalMimeType = 'image/png';
                else if (ext === 'jpg' || ext === 'jpeg') finalMimeType = 'image/jpeg';
                else finalMimeType = 'audio/webm';
            }

            // Override iOS mp4 audio to video/mp4 as Gemini is sometimes happier parsing it as a video container.
            if (finalMimeType === 'audio/mp4' || finalMimeType === 'audio/x-m4a') {
                finalMimeType = 'video/mp4';
            }

            processedAudioBuffer = audioBuffer;
            if (!finalMimeType.startsWith('text/')) {
                processedAudioBuffer = await fixAudioBufferWithFfmpeg(audioBuffer, finalMimeType);
            }

            if (finalMimeType.startsWith('text/')) {
                console.log(`[API] Document texte principal prêt en mémoire: ${audioFile.fileName}`);
                parts.push({
                    text: `\n\n--- Document texte de la consultation (${audioFile.fileName}) ---\n${processedAudioBuffer.toString('utf-8')}\n--- Fin du document ---\n`
                });
            } else {
                console.log(`[API] Upload de l'audio vers Gemini File API (${(processedAudioBuffer.length / 1024 / 1024).toFixed(2)} MB). Type MIME: ${finalMimeType}`);
                const uploaded = await uploadToGemini(processedAudioBuffer, audioFile.fileName, finalMimeType);
                allUploads.push(uploaded);
            }
        }

        // 2. Process Attached Files
        const attachedFilesUrls: { originalName: string, publicUrl: string, mimeType: string }[] = [];
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
                let fMimeType = f.mimeType || 'application/octet-stream';

                if (f.fileName.toLowerCase().endsWith('.pdf')) fMimeType = 'application/pdf';
                if (f.fileName.toLowerCase().endsWith('.png')) fMimeType = 'image/png';
                if (f.fileName.toLowerCase().endsWith('jpg') || f.fileName.toLowerCase().endsWith('jpeg')) fMimeType = 'image/jpeg';
                if (f.fileName.toLowerCase().endsWith('.txt')) fMimeType = 'text/plain';

                const { data: urlData } = supabase.storage.from('tdt_uploads').getPublicUrl(f.fileName);
                attachedFilesUrls.push({
                    originalName: cleanFileName(f.fileName),
                    publicUrl: urlData.publicUrl,
                    mimeType: fMimeType
                });

                let processedFBuffer = fBuffer;
                if (!fMimeType.startsWith('text/')) {
                    processedFBuffer = await fixAudioBufferWithFfmpeg(fBuffer, fMimeType);
                }

                if (fMimeType.startsWith('text/')) {
                    console.log(`[API] Document texte joint prêt en mémoire: ${f.fileName}`);
                    const textContent = processedFBuffer.toString('utf-8');
                    parts.push({
                        text: `\n\n--- Document texte joint (${f.fileName}) ---\n${textContent}\n--- Fin du document ---\n`
                    });
                    textFilesContent.push({
                        cleanName: cleanFileName(f.fileName),
                        text: textContent
                    });
                } else {
                    console.log(`[API] Upload du fichier attaché vers Gemini File API: ${f.fileName} (${fMimeType})`);
                    const uploaded = await uploadToGemini(processedFBuffer, f.fileName, fMimeType);
                    allUploads.push(uploaded);
                    uploadedDocs.push({
                        ...uploaded,
                        cleanName: cleanFileName(f.fileName)
                    });
                }
            }
        }

        // 3. Process direct text
        if (newText) {
            console.log(`[API] Texte direct ajouté, longueur: ${newText.length} caractères`);
            parts.push({
                text: `\n\n--- Nouvelle Note Ajoutée ---\n${newText}\n--- Fin de la note ---\n`
            });
        }

        // Polling pour s'assurer que les fichiers uploadés sont "ACTIVE"
        for (const uploaded of allUploads) {
            let fileInfo;
            try {
                fileInfo = await ai.files.get({ name: uploaded.name });
            } catch (err) {
                console.log(`[API] Erreur initiale au get du fichier, on suppose PROCESSING...`, err);
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
            // Petite pause de sécurité après que le fichier soit ACTIVE pour éviter un "File not found" au moment de la génération
            await new Promise(r => setTimeout(r, 2000));

            parts.push({
                fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType }
            });
        }

        // Extraction de texte en parallèle pour tous les documents images/PDFs
        let mergedDocTranscriptions = "";
        
        // 1. Ajouter le contenu des fichiers texte joints
        textFilesContent.forEach(item => {
            if (mergedDocTranscriptions) {
                mergedDocTranscriptions += "\n\n---\n**Ajout d'information :**\n";
            }
            mergedDocTranscriptions += `--- Document joint (${item.cleanName}) ---\n${item.text}\n--- Fin du document ---`;
        });

        // 2. Extraire le texte des PDF et images en parallèle avec Gemini
        if (uploadedDocs.length > 0) {
            console.log(`[API] Infiltration d'extraction en parallèle de ${uploadedDocs.length} document(s)...`);
            try {
                const extractedTexts = await Promise.all(
                    uploadedDocs.map(async (doc) => {
                        console.log(`[API] Extraction du texte de : ${doc.cleanName}...`);
                        const ocrResponse = await ai.models.generateContent({
                            model: 'gemini-2.5-flash',
                            contents: [
                                { fileData: { fileUri: doc.uri, mimeType: doc.mimeType } },
                                { text: "Extraits de manière exhaustive, structurée et détaillée tout le texte de ce document. Si le document comporte plusieurs pages, extrais absolument toutes les pages sans exception." }
                            ]
                        });
                        return ocrResponse.text?.trim() || "";
                    })
                );

                extractedTexts.forEach((ocrText) => {
                    if (ocrText) {
                        if (mergedDocTranscriptions) {
                            mergedDocTranscriptions += "\n\n---\n**Ajout d'information :**\n";
                        }
                        mergedDocTranscriptions += ocrText;
                    }
                });
            } catch (err) {
                console.error("[API] Échec de l'extraction de texte en parallèle :", err);
            }
        }

        // --- ETAPE 1 (PASS 1) : TRANSCRIPTION INTEGRALE DE L'AUDIO SI PRESENT ---
        const isAudioInput = Boolean(audioFile && audioFile.fileName && !finalMimeType.startsWith('text/'));
        let directAudioTranscription = "";
        if (isAudioInput && allUploads.length > 0) {
            console.log(`[API PASS 1] Retranscription intégrale mot à mot de l'audio via Gemini 2.5 Flash...`);
            try {
                const audioUpload = allUploads[0];
                const transcribeRes = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [
                        { fileData: { fileUri: audioUpload.uri, mimeType: audioUpload.mimeType } },
                        { text: "Retranscris l'intégralité exacte, mot à mot (verbatim) de cet enregistrement audio médical en français. Retranscris CHAQUE MOT prononcé par le patient et le thérapeute, avec les hésitations, sans aucun résumé, sans omission et sans couper." }
                    ],
                    config: {
                        maxOutputTokens: 65536
                    }
                });
                directAudioTranscription = transcribeRes.text?.trim() || "";
                console.log(`[API PASS 1] Transcription audio réussie (${directAudioTranscription.length} caractères).`);
            } catch (err) {
                console.error("[API PASS 1] Erreur transcription audio dédiée :", err);
            }
        }

        // --- ETAPE 2 (PASS 2) : ANALYSE CLINIQUE ET SYNTHESE EXHAUSTIVE ---
        const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const isUpdate = previousContext && (previousContext.synthese || previousContext.transcription);

        let contextInstruction = "";
        if (isUpdate) {
            contextInstruction = `
ATTENTION: Tu mets à jour un dossier patient EXISTANT. 
Voici les informations PRECEDENTES de ce patient:
- Nom du patient : ${previousContext.patientName || 'Non renseigné.'}

Voici la transcription PRECEDENTE de la consultation:
"""
${previousContext.transcription || 'Aucune transcription précédente.'}
"""

Voici la synthese PRECEDENTE de ce patient:
"""
${previousContext.synthese || 'Aucune synthèse précédente.'}
"""

Instructions de MISE A JOUR:
Ton objectif est de mettre à jour la synthèse PRÉCÉDENTE en FUSIONNANT de manière cohérente les nouveaux éléments issus de l'audio/document/texte dans les sections appropriées existantes.
- MULTI-SÉANCES & SUIVI CHRONOLOGIQUE : Si les nouvelles informations correspondent à une NOUVELLE SÉANCE ou consultation à une date différente, CONSERVE TOUJOURS LE BILAN DE LA SÉANCE PRÉCÉDENTE au début et structure le document avec les séances successives (ex: "## 📅 Séance 1 : [Date 1]" puis "## 📅 Séance 2 : [Date 2]"). L'onglet Bilan doit afficher l'intégralité des séances de façon cumulative sans jamais effacer la séance précédente.
- FORMATAGE DES AJOUTS D'UNE MÊME SÉANCE : Si c'est une précision pour la même séance, intègre-le naturellement dans les listes à puces existantes sans section isolée "Ajout".
- DOCUMENTS JOINTS : Si un document (PDF, image, texte) t'est fourni, extrais minutieusement les informations médicales et intègre-les au bilan.
- EXCEPTION (NOM DU PATIENT) : Respecte la casse sobre et naturelle (ex: Jean-Claude Frénot).
- EXCEPTION (DATE DE LA CONSULTATION) : Si les nouvelles notes précisent les dates, affiche-les dans le titre (# Bilan de consultation <span style="font-size: 0.6em; color: #8c7b6d;">- [Date 1] & [Date 2]</span>).
- EXCEPTION (RÉSUMÉ) : IL EST ABSOLUMENT OBLIGATOIRE que la clé "resume" contienne un résumé GLOBAL et DYNAMIQUE de TOUT LE BILAN FINAL (c'est-à-dire le bilan initial ET l'ensemble des suivis / nouvelles séances / examens d'imagerie récents).
  * Si des examens d'imagerie médicale (radios, IRM, scanners, échographies) sont présents, le résumé DOIT débuter par la photo/planche d'imagerie clé la plus évocatrice en Markdown pur (![Description](url)).
  * Chaque suivi ou examen récent doit être mentionné avec sa date explicite (ex: "### 🗓️ Suivi du [Date] : ..."), en détaillant le lieu précis de fracture s'il y a lieu, les conclusions radiologiques, les notes psycho-émotionnelles ou les évolutions posturales.
  * Le résumé doit être complet, fluide et lisible en un coup d'œil.
`;
        } else {
            contextInstruction = `\n- DOCUMENTS JOINTS: Si des documents (PDF, images, textes) te sont fournis, analyse-les pour rédiger le bilan (motif, histoire, examens, ATCD). Si une imagerie est fournie, intègre la planche clé dans le résumé.`;
        }

        const systemPrompt = `Tu es un assistant médical clinique expert (ostéopathie, biokinergie, thérapie manuelle). Ton rôle est d'analyser l'intégralité de la transcription de l'interrogatoire patient (et/ou des documents) et de produire un bilan médical exhaustif, riche et rigoureusement structuré.${contextInstruction}
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ex: 'PETIT TOYOZATO Eri' ou 'DONNADIEU Nathalie')",
  "consultationDate": "Date trouvée dans le texte (ex: 2024-10-14). Si aucune date précise n'est mentionnée, renvoie null ou une chaîne vide.",
  "resume": "Le résumé global et évolutif intégrant le bilan initial et les suivis datés (avec imagerie clé en markdown pur si présente, lieux de fracture, notes psy et synthèse clinique).",
  "synthese": "La synthèse médicale formatée en Markdown"
}

Règles impératives et absolues :
1. "patientName" : Extrait scrupuleusement le NOM (en MAJUSCULES) suivi du Prénom (ex: "PETIT TOYOZATO Eri", "SOULE Laura"). Si le texte commence par une civilité (Madame, Monsieur), des lignes avec Nom, Prénom, Nom de naissance, analyse scrupuleusement ces lignes. Ne renvoie JAMAIS "Anonyme", "Patient Anonyme" ou chaîne vide si un nom ou prénom est mentionné ou discernable dans le texte ou les documents !
2. "consultationDate" : Si le texte mentionne EXPLICITEMENT la date de la séance (ex: "bilan du 14 octobre", "vu le 12/03/2021"), extrait-la au format string ISO AAAA-MM-JJ. Si AUCUNE date n'est prononcée ou écrite dans les documents, tu DOIS IMPÉRATIVEMENT renvoyer une chaîne vide "". Ne déduis PAS la date et ne mets JAMAIS la date d'aujourd'hui par défaut dans ce champ JSON.
3. "resume" : Remplacer la transcription par un texte lisible en un coup d'oeil intégrant le bilan initial et toutes les séances de suivi avec leurs dates respectives, les constats radiologiques (fractures, cals osseux, discarthrose) et le volet psycho-émotionnel.
4. "synthese" : RÈGLE D'EXHAUSTIVITÉ CLINIQUE SANS REMPLISSAGE SPÉCULATIF :
   - RÈGLE CRITIQUE (ZÉRO SPÉCULATION / ZÉRO BLABLA QUAND AUCUN INTERROGATOIRE N'EST FOURNI) : Si l'utilisateur n'a transmis QUE l'identité du patient ou des résultats d'examens (radio, scanner) SANS audio d'interrogatoire clinique : N'INVENTE JAMAIS de texte d'explication ou de remplissage théorique (ex: NE PAS écrire 'Le patient se présente pour une évaluation...', NE PAS écrire 'En l'absence d'informations spécifiques...', NE PAS écrire 'Non précisés : Cette section exhaustive recenserait...'). Laisse simplement un tiret '-' ou 'Non renseigné' pour les sections sans informations (Motif, Histoire, ATCD), car l'audio de consultation arrivera ultérieurement !
   - **Histoire de la Maladie** : Si un interrogatoire a eu lieu, décris exhaustivement les symptômes, leur localisation, leur date d'apparition précise, les circonstances déclenchantes et les traitements déjà tentés. Sinon, écris simplement '-'.
   - **Antécédents et Chronologie (ATCD)** : Si mentionnés, liste TOUS les traumatismes physiques, deuils, chirurgies, classés par ordre chronologique. Sinon, écris simplement '-'.
   - **Examens Complémentaires** : Transcris exhaustivement les constatations et conclusions des examens radiologiques/médicaux fournis.
   - **Règle Anti-Troncature Absolue** : Chaque section doit être rédigée intégralement jusqu'à son terme sans jamais s'interrompre.

# Bilan de consultation <span style="font-size: 0.6em; color: #8c7b6d;">- [Date exacte de la consultation, ou ${currentDate} par défaut]</span>

### Informations Patient
- **Nom/Prénom :** [Nom et Prénom extraits]
- **Âge / Date de naissance :** [Extraire si mentionné, ex: 51 ans / 28/03/1975]
- **Profession :** [Extraire si mentionné, sinon "Non renseigné"]
- **Date de consultation :** [Date exacte de la consultation extraite du texte, ou ${currentDate} par défaut]
### Motif de Consultation
[...]
### Histoire de la Maladie / Douleur
- **Description :** [...]
- **Intensité :** [...]
- **Fréquence :** [...]
- **Circonstances d'apparition :** [...]
### Examens Complémentaires
- **Photos / PDF / Textes :**
[CONSIGNE CONCERNANT LES DOCUMENTS JOINTS :
- Les comptes-rendus médicaux textuels (radios, scanners, IRM, labos) doivent uniquement être transcrits et rédigés sous forme de texte structuré et clair (Indication, Constatations, Conclusion).
- Ne crée pas de tag <img> ou <iframe> pour des photos de feuilles de papier ou comptes-rendus textuels.
- Seules les véritables images anatomiques (radiographies, coupes IRM) peuvent être intégrées avec le format HTML propre si pertinent.]
### Antécédents (ATCD) et Chronologie
- [Année] - [Description]

TRÈS IMPORTANT : Produis uniquement un objet JSON valide conforme au schéma.`;

        let attachedDocsContext = "";
        if (attachedFilesUrls.length > 0) {
            const docsOnly = attachedFilesUrls.filter(file => !file.mimeType.startsWith('audio/'));
            if (docsOnly.length > 0) {
                attachedDocsContext = "\n\n--- DOCUMENTS IMPORTÉS (IMAGERIES / COMPTES-RENDUS) A INTÉGRER ---\n";
                docsOnly.forEach(doc => {
                    attachedDocsContext += `- Nom : "${doc.originalName}" | URL Publique : ${doc.publicUrl} | Type : ${doc.mimeType}\n`;
                });
                attachedDocsContext += "-----------------------------------------------------\n";
            }
        }

        const synthesisParts: Array<{ text?: string; fileData?: { fileUri: string, mimeType: string } }> = [];

        // Si un fichier texte brut a été soumis comme note principale (ex: saisie manuelle / collage de texte)
        if (audioFile && audioFile.fileName && finalMimeType.startsWith('text/')) {
            const mainTextContent = processedAudioBuffer.toString('utf-8');
            synthesisParts.push({
                text: `\n\n--- TEXTE PRINCIPAL DE LA CONSULTATION / NOTES PATIENT (${audioFile.fileName}) ---\n${mainTextContent}\n--- FIN DU TEXTE ---\n`
            });
        }

        if (directAudioTranscription) {
            synthesisParts.push({
                text: `\n\n--- TRANSCRIPTION INTÉGRALE MOT À MOT DU DIALOGUE DE LA CONSULTATION ---\n${directAudioTranscription}\n--- FIN DE LA TRANSCRIPTION ---\n`
            });
        }

        // Ajouter les pièces jointes (images/PDFs) pour analyse visuelle
        for (const uploaded of uploadedDocs) {
            synthesisParts.push({
                fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType }
            });
        }

        // Ajouter les documents textes
        textFilesContent.forEach(item => {
            synthesisParts.push({
                text: `\n\n--- Document texte joint (${item.cleanName}) ---\n${item.text}\n--- Fin du document ---\n`
            });
        });

        // Ajouter les notes directes
        if (newText) {
            synthesisParts.push({
                text: `\n\n--- Nouvelle Note Ajoutée ---\n${newText}\n--- Fin de la note ---\n`
            });
        }

        if (attachedDocsContext) {
            synthesisParts.push({ text: attachedDocsContext });
        }

        synthesisParts.push({ text: systemPrompt });

        console.log(`[API PASS 2] Génération de la synthèse clinique exhaustive (budget: 65536 tokens)...`);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: synthesisParts
                }
            ],
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: 'application/json',
                maxOutputTokens: 65536,
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        patientName: {
                            type: Type.STRING,
                            description: "Nom et Prénom trouvés (ou chaîne vide si aucun)"
                        },
                        consultationDate: {
                            type: Type.STRING,
                            description: "Date trouvée dans le texte (ex: 2024-10-14). Si aucune date précise n'est mentionnée, renvoie null ou une chaîne vide."
                        },
                        resume: {
                            type: Type.STRING,
                            description: "Un résumé narratif GLOBAL en 3 à 5 phrases, synthétisant tout le document final complet généré dans 'synthese' (anciennes ET nouvelles informations). Sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce)."
                        },
                        synthese: {
                            type: Type.STRING,
                            description: "La synthèse médicale formatée en Markdown"
                        }
                    },
                    required: ["patientName", "consultationDate", "resume", "synthese"]
                }
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

        let jsonResult;
        try {
            jsonResult = JSON.parse(cleanJson);
        } catch (e) {
            console.error("[API] JSON Parse Erreur standard. Longueur :", cleanJson.length, "Message :", e instanceof Error ? e.message : e);
            try {
                await fs.writeFile(path.join(process.cwd(), 'debug_invalid_json.json'), cleanJson, 'utf-8');
                console.log("[API] JSON invalide écrit dans debug_invalid_json.json pour inspection.");
            } catch (err) {
                console.error("[API] Impossible d'écrire le JSON de debug :", err);
            }

            console.log("[API] Tentative de sauvetage du JSON via extraction robuste...");
            const rescued = extractKeyValues(cleanJson);
            if (rescued) {
                console.log("[API] Sauvetage JSON réussi avec succès !");
                jsonResult = rescued;
            } else {
                console.error("[API] Le sauvetage JSON a échoué.");
                throw e; // Renvoyer l'erreur d'origine
            }
        }

        // Fusion de la transcription de l'audio avec celle des documents extraits sur le serveur
        let finalTranscription = directAudioTranscription || "";
        
        // Si c'est un document texte brut en guise d'audio principal
        if (audioFile && audioFile.fileName && finalMimeType.startsWith('text/')) {
            finalTranscription = processedAudioBuffer.toString('utf-8');
        }

        if (mergedDocTranscriptions) {
            if (finalTranscription) {
                finalTranscription += "\n\n---\n**Ajout d'information :**\n" + mergedDocTranscriptions;
            } else {
                finalTranscription = mergedDocTranscriptions;
            }
        }
        
        jsonResult.transcription = finalTranscription;

        if (isUpdate && previousContext?.transcription) {
            const separator = "\n\n---\n**Ajout d'information :**\n";
            jsonResult.transcription = previousContext.transcription + separator + (jsonResult.transcription || "");
        }

        // Fallback extraction de nom si l'IA n'a rien trouvé ou a mis Anonyme
        if (!jsonResult.patientName || jsonResult.patientName.toLowerCase().startsWith("patient anonyme") || jsonResult.patientName.toLowerCase() === "anonyme" || jsonResult.patientName.toLowerCase().includes("non précisé")) {
            const fallbackName = extractPatientNameFromText(finalTranscription) || extractPatientNameFromText(newText || "");
            if (fallbackName) {
                jsonResult.patientName = fallbackName;
            }
        }

        if (jsonResult.patientName) {
            jsonResult.patientName = ensureLastNameFirst(jsonResult.patientName);
        }

        if (jsonResult.synthese) {
            const defaultDateFormatted = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
            // Fix any empty span or unformatted spans in title
            jsonResult.synthese = jsonResult.synthese
                .replace(/# Bilan de consultation\s*<span[^>]*>-?\s*(?:\[Date[^\]]*\]|Non précisé(?:e)?|null|undefined)?\s*<\/span>/gi, `# Bilan de consultation <span style="font-size: 0.6em; color: #8c7b6d;">- ${defaultDateFormatted}</span>`)
                .replace(/- \*\*Date de consultation :\*\*(\s*)(?:\[Date[^\]]*\]|Non précisé(?:e)?|null|undefined)?$/gmi, `- **Date de consultation :** ${defaultDateFormatted}`);
        }

        return NextResponse.json(jsonResult);

    } catch (error: unknown) {
        console.error("Erreur serveur API /analyze :", error);
        let errorMessage = error instanceof Error ? error.message : "Erreur inconnue.";
        
        // Friendly translation of Gemini errors
        if (errorMessage.includes("503") || errorMessage.toLowerCase().includes("overloaded")) {
            errorMessage = "Google Gemini est actuellement surchargé (503). Veuillez réessayer dans quelques instants.";
        } else if (errorMessage.startsWith("{")) {
            try {
                const parsed = JSON.parse(errorMessage);
                if (parsed.error && parsed.error.code === 503) {
                    errorMessage = "Google Gemini est actuellement surchargé (503). Veuillez réessayer dans quelques instants.";
                } else if (parsed.error && parsed.error.message) {
                    errorMessage = parsed.error.message;
                }
            } catch {
                // Ignore parse errors
            }
        }
        
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
