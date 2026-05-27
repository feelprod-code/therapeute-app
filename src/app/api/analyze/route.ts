import { GoogleGenAI, Type } from '@google/genai';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

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
    
    const positions = keys.map(key => {
        let index = jsonStr.indexOf(`"${key}"`);
        if (index === -1) index = jsonStr.indexOf(`'${key}'`);
        return { key, index };
    });
    
    positions.sort((a, b) => a.index - b.index);
    
    if (positions.some(p => p.index === -1)) {
        return null;
    }
    
    for (let i = 0; i < positions.length; i++) {
        const current = positions[i];
        const next = positions[i + 1];
        
        const keyEnd = current.index + current.key.length + 2;
        const colonIndex = jsonStr.indexOf(':', keyEnd);
        if (colonIndex === -1) return null;
        
        let valStart = colonIndex + 1;
        while (valStart < jsonStr.length && /\s/.test(jsonStr[valStart])) {
            valStart++;
        }
        
        let valEnd = jsonStr.length;
        if (next) {
            valEnd = next.index;
            let commaIndex = jsonStr.lastIndexOf(',', valEnd);
            if (commaIndex !== -1 && commaIndex > valStart) {
                valEnd = commaIndex;
            }
        } else {
            const lastCurly = jsonStr.lastIndexOf('}');
            if (lastCurly !== -1 && lastCurly > valStart) {
                valEnd = lastCurly;
            }
        }
        
        let rawVal = jsonStr.substring(valStart, valEnd).trim();
        
        if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
            rawVal = rawVal.substring(1, rawVal.length - 1);
        } else if (rawVal.startsWith("'") && rawVal.endsWith("'")) {
            rawVal = rawVal.substring(1, rawVal.length - 1);
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
            let finalMimeType = audioFile.mimeType;
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

            let processedAudioBuffer = audioBuffer;
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
                    parts.push({
                        text: `\n\n--- Document texte joint (${f.fileName}) ---\n${processedFBuffer.toString('utf-8')}\n--- Fin du document ---\n`
                    });
                } else {
                    console.log(`[API] Upload du fichier attaché vers Gemini File API: ${f.fileName} (${fMimeType})`);
                    const uploaded = await uploadToGemini(processedFBuffer, f.fileName, fMimeType);
                    allUploads.push(uploaded);
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

        // --- 3. ANALYSE GEMINI (TEXTE + DOCUMENTS) ---
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
- RÈGLE GÉNÉRALE: Maintiens la structure globale de la synthèse médicale. Intègre intelligemment les nouvelles plaintes ou informations DANS les sections pertinentes. Si la nouvelle note ressemble à une consigne du thérapeute (ex: "ajoute que...", "corrige la douleur..."), tu dois exécuter cette consigne pour améliorer le bilan, sans jamais recopier la consigne elle-même.
- FORMATAGE DES AJOUTS: Corrige toujours l'orthographe du texte ajouté si nécessaire, et intègre-le naturellement sous forme d'un nouveau tiret dans les listes à puces existantes. NE COMMENCE JAMAIS tes ajouts par "Ajout de", "Nouvelle information" ou "Note du thérapeute".
- DOCUMENTS JOINTS: Si un document (PDF, image, texte) t'est fourni, extrais minutieusement les informations médicales et intègre-les au bilan.
- INTERDICTION: NE CRÉE SURTOUT PAS EN BAS DE PAGE une section "Ajout d'informations" ou "Nouvelles informations". Le bilan doit rester un document unifié, écrit de façon fluide comme s'il avait été rédigé en une seule fois.
- EXCEPTION (NOM DU PATIENT): Si les nouveaux documents/audios te permettent de découvrir le VRAI nom et prénom du patient (et que la synthèse précédente disait "Patient Anonyme" ou était incomplète), tu as l'OBLIGATION de le mettre à jour. N'oublie pas non plus de renseigner le champ "patientName" de ta réponse JSON.
- EXCEPTION (DATE DE LA CONSULTATION): Si les nouvelles notes précisent la vraie date de la consultation (ex: "la première séance était le 12 octobre"), tu as l'OBLIGATION de la mettre à jour dans ton texte Markdown ET de renseigner cette date au format AAAA-MM-JJ dans la clé "consultationDate" du JSON.
- Pour la transcription : Tu dois produire EXCLUSIVEMENT la retranscription/extraction des NOUVEAUX éléments fournis (nouveau vocal, texte, document). IL EST STRICTEMENT INTERDIT DE RECOPIER L'ANCIENNE TRANSCRIPTION, même partiellement. Le système les fusionnera lui-même. Si c'est un document (PDF ou image), extrais-en de manière exhaustive et structurée TOUT le texte clinique, les mesures, les résultats, les diagnostics et les observations qu'il contient pour qu'ils soient lisibles dans le suivi du patient.
- EXCEPTION (RÉSUMÉ) : IL EST ABSOLUMENT OBLIGATOIRE que la clé "resume" contienne un résumé GLOBAL de TOUT LE BILAN FINAL (c'est-à-dire le texte généré dans la clé "synthese"). Ne résume SURTOUT PAS seulement les ajouts ! Le résumé doit donner l'état complet du patient.
`;
        } else {
            contextInstruction = `\n- DOCUMENTS JOINTS: Si des documents (PDF, images, textes) te sont fournis, extrais-en de manière exhaustive toutes les informations cliniques utiles pour rédiger le bilan (ex: compte-rendu d'imagerie, biologie, mesures, observations) et place l'intégralité du texte extrait ou analysé dans la clé "transcription".`;
        }

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est d'analyser la transcription d'un interrogatoire patient (et/ou des documents) fourni et de produire un bilan.${contextInstruction}
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "consultationDate": "Date trouvée dans le texte (ex: 2024-10-14). Si aucune date précise n'est mentionnée, renvoie null ou une chaîne vide.",
  "transcription": "Pour un audio : Génère la retranscription EXACTE, LITTÉRALE (Verbatim) et INTÉGRALE de tout le dialogue. RÈGLE ABSOLUE : Tu ne dois AUCUNEMENT corriger la grammaire, ni supprimer les hésitations ('euh', 'ah', 'ben', répétitions). Retranscris CHAQUE MOT. Pour un document (PDF/Image) : extrais-en de manière exhaustive, structurée et détaillée TOUTES les informations cliniques, mesures et conclusions médicales sous forme de Markdown lisible et structuré.",
  "resume": "Un résumé narratif GLOBAL en 3 à 5 phrases, synthétisant TOUT le document final complet généré dans 'synthese' (anciennes ET nouvelles informations). Sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce).",
  "synthese": "La synthèse médicale formatée en Markdown"
}

Règles impératives :
1. "patientName" : Extrait le Prénom et le Nom du patient. S'il n'est pas mentionné, laisse cette chaîne vide "". NE METS SURTOUT PAS "Jean Dupont" ou un nom inventé !
2. "consultationDate" : Si le texte mentionne EXPLICITEMENT la date de la séance (ex: "bilan du 14 octobre", "vu le 12/03/2021"), extrait-la au format string ISO AAAA-MM-JJ. Si AUCUNE date n'est prononcée ou écrite dans les documents, tu DOIS IMPÉRATIVEMENT renvoyer une chaîne vide "". Ne déduis PAS la date et ne mets JAMAIS la date d'aujourd'hui par défaut dans ce champ JSON.
3. "transcription" : Intégralité du texte brut ou du document extrait reçu en entrée. RÈGLE D'OR : Pour l'audio, mot pour mot (Verbatim), incluant les erreurs, faux-départs et hésitations. Pour les documents, extraction intégrale et structurée des données cliniques. (Pour une mise à jour, n'inclus QUE les nouveautés).
4. "resume" : Remplacer la transcription par un texte lisible en un coup d'oeil. (En cas de mise à jour, ce résumé DOIT couvrir l'intégralité du bilan fusionné).
5. "synthese" : Applique strictement la structure Markdown ci-dessous UNIQUEMENT si l'information est présente (ou fusionne à l'existant en intégrant naturellement les éléments sous forme de tirets dans les listes à puces) :

6. "ATCD" : Dans la section Antécédents (ATCD) et Chronologie, présente TOUS les antécédents, traumatismes, accidents, et interventions dans un ordre strictement chronologique de la naissance jusqu'à aujourd'hui. Ne garde que ce qui est explicitement dit. Ne recopie pas cette consigne dans le texte final.

# Bilan de consultation <span class="text-lg md:text-xl text-[#8c7b6d] font-normal ml-2">- [Date exacte de la consultation, ou ${currentDate} par défaut]</span>

### Informations Patient
- **Nom/Prénom :** [Extraire si mentionné, sinon écrire "Non précisé"]
- **Âge / Date de naissance :** [Extraire si mentionné]
- **Profession :** [Extraire si mentionné]
- **Date de consultation :** [Date exacte de la consultation extraite du texte]
### Motif de Consultation
[...]
### Histoire de la Maladie / Douleur
- **Description :** [...]
- **Intensité :** [...]
- **Fréquence :** [...]
- **Circonstances d'apparition :** [...]
### Examens Complémentaires
- **Photos / PDF / Textes :**
[CONSIGNE ABSOLUE ET CRITIQUE CONCERNANT LES DOCUMENTS JOINTS (IMAGERIES ET RAPPORTS) :
- Tu ne dois JAMAIS afficher visuellement dans la synthèse (ni tag <img> ni tag <iframe>) les documents qui sont des photographies de comptes-rendus médicaux imprimés, des scannings de feuilles de papier écrites, ou des fichiers PDF de comptes-rendus textuels (comme des feuilles imprimées de résultats de laboratoires, de comptes-rendus de scanner/IRM). Le contenu clinique de ces documents textuels doit uniquement être rédigé sous forme de texte normal dans les puces ci-dessus (Indication, Résultats, Conclusion). Ne mets pas de lien d'image ni d'iframe pour eux.
- En revanche, si le document fourni est une VÉRITABLE illustration visuelle d'imagerie anatomique (radiographie, cliché de scanner, échographie, IRM montrant des os, articulations ou tissus corporels, etc.), tu DOIS l'intégrer sous forme d'illustration en grand en utilisant EXCLUSIVEMENT le format HTML ci-dessous.
- Si le document est un rapport textuel / une feuille de papier prise en photo, ne l'affiche pas dans la synthèse. L'utilisateur y aura accès par le panneau latéral "Fichiers Joints" du dossier.

Pour chaque document d'imagerie anatomique réelle, insère-le comme suit :
Si c'est une image (JPEG, JPG, PNG, WEBP) :
<div style="margin: 16px 0;">
  <div style="font-weight: bold; color: #5a4e44; margin-bottom: 8px;">📷 [Nom d'origine nettoyé]</div>
  <img src="[URL publique]" alt="Imagerie" style="max-width: 100%; max-height: 500px; border-radius: 8px; border: 1px solid #e8e4e1; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);" />
</div>

Si c'est un PDF d'imagerie anatomique réelle (pas un texte) :
<div style="background: #fcfbfa; border: 1px solid #e8e4e1; padding: 16px; border-radius: 8px; margin: 16px 0;">
  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
    <span style="font-size: 28px;">📄</span>
    <div>
      <div style="font-weight: bold; color: #5a4e44;">[Nom d'origine nettoyé]</div>
      <div style="font-size: 0.85em; color: #8c7b6d;">Document PDF</div>
    </div>
    <a href="[URL publique]" target="_blank" style="margin-left: auto; background: #bd613c; color: white; padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 500; text-decoration: none; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">Ouvrir en plein écran</a>
  </div>
  <iframe src="[URL publique]" style="width: 100%; height: 500px; border-radius: 6px; border: 1px solid #ebd9c8;" />
</div>

Classe-les par ordre chronologique de la date de l'examen.
Si aucun document n'est fourni ou s'ils sont tous filtrés comme étant des comptes-rendus textuels sur papier, écris simplement : - **Photos / PDF / Textes :** Aucun document joint (les documents textuels sont accessibles dans les Fichiers Joints).]
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

        if (attachedDocsContext) {
            parts.push({ text: attachedDocsContext });
        }

        parts.push({ text: systemPrompt });


        console.log(`[API] Generating content...`);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: parts
                }
            ],
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: 'application/json',
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
                        transcription: {
                            type: Type.STRING,
                            description: "Retranscription EXACTE et LITTÉRALE de l'audio. S'il s'agit d'un document (PDF/Image), extraction exhaustive et structurée de l'intégralité du texte médical, des mesures, des analyses et des observations cliniques en Markdown."
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
                    required: ["patientName", "consultationDate", "transcription", "resume", "synthese"]
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

        if (isUpdate && previousContext?.transcription) {
            const separator = "\n\n---\n**Ajout d'information :**\n";
            jsonResult.transcription = previousContext.transcription + separator + (jsonResult.transcription || "");
        }

        // CLEANUP (Not needed anymore since we use inlineData!)

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
