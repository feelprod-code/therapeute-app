import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

export const maxDuration = 800; // 15 minutes instead of 5

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

            if (finalMimeType.startsWith('text/')) {
                console.log(`[API] Document texte principal prêt en mémoire: ${audioFile.fileName}`);
                parts.push({
                    text: `\n\n--- Document texte de la consultation (${audioFile.fileName}) ---\n${audioBuffer.toString('utf-8')}\n--- Fin du document ---\n`
                });
            } else {
                console.log(`[API] Upload de l'audio vers Gemini File API (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB). Type MIME: ${finalMimeType}`);
                const uploaded = await uploadToGemini(audioBuffer, audioFile.fileName, finalMimeType);
                allUploads.push(uploaded);
            }
        }

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
                let fMimeType = f.mimeType || 'application/octet-stream';

                if (f.fileName.toLowerCase().endsWith('.pdf')) fMimeType = 'application/pdf';
                if (f.fileName.toLowerCase().endsWith('.png')) fMimeType = 'image/png';
                if (f.fileName.toLowerCase().endsWith('jpg') || f.fileName.toLowerCase().endsWith('jpeg')) fMimeType = 'image/jpeg';
                if (f.fileName.toLowerCase().endsWith('.txt')) fMimeType = 'text/plain';

                if (fMimeType.startsWith('text/')) {
                    console.log(`[API] Document texte joint prêt en mémoire: ${f.fileName}`);
                    parts.push({
                        text: `\n\n--- Document texte joint (${f.fileName}) ---\n${fBuffer.toString('utf-8')}\n--- Fin du document ---\n`
                    });
                } else {
                    console.log(`[API] Upload du fichier attaché vers Gemini File API: ${f.fileName} (${fMimeType})`);
                    const uploaded = await uploadToGemini(fBuffer, f.fileName, fMimeType);
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
- Pour la transcription : Tu dois produire EXCLUSIVEMENT la retranscription/description des NOUVEAUX éléments fournis (nouveau vocal, texte, document). IL EST STRICTEMENT INTERDIT DE RECOPIER L'ANCIENNE TRANSCRIPTION, même partiellement. Le système les fusionnera lui-même. Si c'est un document, décris brièvement sa nature (ex: "Ajout d'une IRM").
- EXCEPTION (RÉSUMÉ) : IL EST ABSOLUMENT OBLIGATOIRE que la clé "resume" contienne un résumé GLOBAL de TOUT LE BILAN FINAL (c'est-à-dire le texte généré dans la clé "synthese"). Ne résume SURTOUT PAS seulement les ajouts ! Le résumé doit donner l'état complet du patient.
`;
        } else {
            contextInstruction = `\n- DOCUMENTS JOINTS: Si des documents (PDF, images, textes) te sont fournis, extrais-en toutes les informations utiles pour rédiger le bilan (ex: compte-rendu d'imagerie, biologie) et décris brièvement la nature de ces documents dans la clé "transcription".`;
        }

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est d'analyser la transcription d'un interrogatoire patient (et/ou des documents) fourni et de produire un bilan.${contextInstruction}
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "consultationDate": "Date trouvée dans le texte (ex: 2024-10-14). Si aucune date précise n'est mentionnée, renvoie null ou une chaîne vide.",
  "transcription": "Génère la retranscription EXACTE, LITTÉRALE (Verbatim) et INTÉGRALE de tout le dialogue de l'audio. RÈGLE ABSOLUE : Tu ne dois AUCUNEMENT corriger la grammaire, ni supprimer les hésitations ('euh', 'ah', 'ben', répétitions). Retranscris CHAQUE MOT. S'il s'agit de documents (PDF/Images) ou de texte tapé, décris simplement ce qu'ils contiennent. Formate ce texte avec Markdown : ajoute toujours un **double saut de ligne** entre chaque prise de parole, et identifie l'interlocuteur avec : **<span style=\\"color: #bd613c;\\">Thérapeute :</span>** ou **<span style=\\"color: #bd613c;\\">Patient :</span>**.",
  "resume": "Un résumé narratif GLOBAL en 3 à 5 phrases, synthétisant TOUT le document final complet généré dans 'synthese' (anciennes ET nouvelles informations). Sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce).",
  "synthese": "La synthèse médicale formatée en Markdown"
}

Règles impératives :
1. "patientName" : Extrait le Prénom et le Nom du patient. S'il n'est pas mentionné, laisse cette chaîne vide "". NE METS SURTOUT PAS "Jean Dupont" ou un nom inventé !
2. "consultationDate" : Si le texte mentionne explicitement la date de la séance (ex: "bilan du 14 octobre", "vu le 12/03/2021"), extrait-la au format string ISO AAAA-MM-JJ. Sinon, string vide "".
3. "transcription" : Intégralité du texte brut reçu en entrée (nouveau vocal ou document). RÈGLE D'OR : Mot pour mot (Verbatim), incluant les erreurs, faux-départs et hésitations. (Pour une mise à jour, n'inclus QUE les nouveautés).
4. "resume" : Remplacer la transcription par un texte lisible en un coup d'oeil. (En cas de mise à jour, ce résumé DOIT couvrir l'intégralité du bilan fusionné).
5. "synthese" : Applique strictement la structure Markdown ci-dessous UNIQUEMENT si l'information est présente (ou fusionne à l'existant en intégrant naturellement les éléments sous forme de tirets dans les listes à puces) :

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
- **Photos / PDF / Textes :** [...]
### Antécédents (ATCD) et Chronologie
*Présente TOUS les antécédents, traumatismes, accidents, interventions dans un ordre strictement chronologique de la naissance jusqu'à aujourd'hui.*
*IMPORTANT : Ne garde que ce qui est explicitement dit.*
- [Année] - [Description]

TRÈS IMPORTANT POUR LE FORMAT JSON :
N'utilise JAMAIS de guillemets doubles (") à l'intérieur du texte de tes valeurs (transcription, synthese, resume). Utilise EXCLUSIVEMENT des guillemets simples (') ou des guillemets typographiques (« »). Toute guillemet double à l'intérieur d'une valeur cassera la structure JSON ! Ne mets pas non plus de sauts de ligne bruts dans les valeurs, utilise toujours \\n.`;

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
                responseMimeType: 'application/json'
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
            console.error("[API] JSON Parse Erreur. Brut texte:", cleanJson.substring(19750, 19850));
            // Tentative basique de sauvetage en remplaçant les guillemets non protégés
            const rescuedJson = cleanJson.replace(/(?<!\\)"([^"]*?)"(?=\s*[,}])/g, "\\\"$1\\\"");
            try {
                jsonResult = JSON.parse(rescuedJson);
            } catch (e2) {
                console.error("[API] Le sauvetage JSON a échoué. Log complet généré dans output:", cleanJson.slice(0, 500) + '... (coupé)');
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
            } catch (e) {
                // Ignore parse errors
            }
        }
        
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
