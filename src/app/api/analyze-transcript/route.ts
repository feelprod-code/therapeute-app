import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

export const maxDuration = 300;

export async function POST(req: Request) {
    console.log("[API analyze-transcript] Requête reçue.");

    try {
        const formData = await req.formData();
        const transcript = formData.get('transcript') as string;
        const attachedFiles = formData.getAll('files') as File[];

        if (!transcript || transcript.trim() === "") {
            console.error("[API] Aucun transcript fourni.");
            return NextResponse.json({ error: "L'historique de conversation est vide." }, { status: 400 });
        }

        console.log(`[API] Lancement de l'analyse IA sur le transcript texte (${transcript.length} caractères)...`);
        console.log(`[API] Réception de ${attachedFiles.length} fichier(s) attaché(s).`);

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const allUploads: { uri: string, mimeType: string, name: string }[] = [];

        const uploadToGemini = async (f: File) => {
            const buffer = Buffer.from(await f.arrayBuffer());

            // Grab extension
            let ext = '';
            if (f.name && f.name.includes('.')) {
                ext = f.name.substring(f.name.lastIndexOf('.'));
            } else if (f.type) {
                if (f.type.includes('webm')) ext = '.webm';
                else if (f.type.includes('mp4') || f.type.includes('m4a')) ext = '.m4a';
                else if (f.type.includes('mpeg') || f.type.includes('mp3')) ext = '.mp3';
                else if (f.type.includes('pdf')) ext = '.pdf';
                else if (f.type.includes('jpeg') || f.type.includes('jpg')) ext = '.jpg';
                else if (f.type.includes('png')) ext = '.png';
            }

            const tempFilePath = path.join(os.tmpdir(), `tdt-file-${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);
            await fs.writeFile(tempFilePath, buffer);
            console.log(`[API] Fichier temporaire créé : ${tempFilePath}`);

            let sanitizedMimeType = f.type || 'application/octet-stream';
            if (sanitizedMimeType) {
                sanitizedMimeType = sanitizedMimeType.split(';')[0].trim();
            }

            const uploadResult = await ai.files.upload({
                file: tempFilePath,
                config: {
                    mimeType: sanitizedMimeType,
                }
            });
            console.log(`[API] Fichier uploadé sur Gemini File API : ${uploadResult.uri}`);

            await fs.unlink(tempFilePath).catch(() => { });

            if (!uploadResult.name || !uploadResult.uri) {
                throw new Error("L'API Gemini n'a pas retourné de nom ou d'URI de fichier valide.");
            }
            return { uri: uploadResult.uri, mimeType: sanitizedMimeType, name: uploadResult.name };
        };

        for (const attach of attachedFiles) {
            allUploads.push(await uploadToGemini(attach));
        }

        // Polling pour s'assurer que les fichiers sont "ACTIVE"
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
                await new Promise(r => setTimeout(r, 3000)); // wait 3s instead of 2s
                attempts++;
                try {
                    fileInfo = await ai.files.get({ name: uploaded.name });
                } catch {
                    console.log(`[API] Fichier (${uploaded.name}) erreur API Gemini pendant le polling, on retente...`);
                    // keep state as PROCESSING to loop again
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

        const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est de lire l'historique d'une conversation entre un thérapeute et son patient et de produire un bilan.
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "transcription": "Ne change rien, renvoie simplement le texte qu'on t'a donné",
  "resume": "Un résumé narratif en 3 à 5 phrases, sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce). Intègre l'essentiel de façon fluide.",
  "synthese": "La synthèse médicale formatée en Markdown"
}

**Règles pour la clé "resume" :**
Rédige un paragraphe de texte narratif et continu. NE CRÉE AUCUN TIRETS NI PUCE ET N'UTILISE AUCUNE LISTE. Si le thérapeute ne parle d'aucun examen (radio, IRM...), n'invente rien et n'en fais pas mention.

**Règles pour la clé "synthese" (Formatage de ton texte) :**
Utilise des titres clairs (avec ###), des paragraphes aérés, et **exclusivement des listes à puces** pour les énumérations.
**TRÈS IMPORTANT:** N'inclus JAMAIS une section, un titre ou une puce s'il n'y a aucune information à ce sujet (par exemple, si aucune radio ou IRM n'est mentionnée, ne crée pas la section "Examens Complémentaires" ni de puce "Radio"). Élimine toute mention type "Non mentionné", "Pas de description" ou "Rien à signaler" ; supprime simplement la ligne ou la section entière. NE CRÉE PAS de catégories vides.

Structure attendue dans ce texte Markdown (pour la clé synthese) :
### Identité du Patient
- **Nom / Prénom :** [Extraire si mentionné]
- **Profession :** [Extraire si mentionné]
- **Date de consultation :** La consultation se passe aujourd'hui le ${currentDate}.

### Motif de Consultation
- **Motif principal :** [Extraire]
- **Historique du problème :** [Extraire]
- **Douleur :** [Localisation, type, intensité sur 10 si mentionnée]

### Antécédents
- **Médicaux :** [Extraire]
- **Chirurgicaux / Traumatiques :** [Extraire]
- **Traitements en cours :** [Extraire]

### Bilan Thérapeutique
- **Tests et observations :** [Tests effectués et résultats]
- **Diagnostic ou hypothèse :** [Conclusion du thérapeute]
- **Avis Médical :** [Si un avis médical est nécessaire ou suggéré]

### Plan de Traitement (Techniques Douces Tissulaires)
- **Techniques utilisées :** [Ce qui a été fait pendant la séance]
- **Conseils post-séance :** [Exercices, repos, hydratation...]
- **Suivi prévu :** [Prochain rendez-vous ou consignes]

Voici le transcript exact de la conversation bilingue :
`;

        const parts: Array<{ text?: string, fileData?: { fileUri: string, mimeType: string } }> = allUploads.map(up => ({
            fileData: { fileUri: up.uri, mimeType: up.mimeType }
        }));
        parts.push({ text: `Transcription brute à analyser :\n${transcript}\n\nINSTRUCTIONS SYSTEME:\n${systemPrompt}` });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: parts,
            config: {
                systemInstruction: "Tu retournes uniquement du JSON.",
            }
        });

        const output = response.text || "{}";

        const cleanJson = output
            .replace(/```json\n/g, '')
            .replace(/```\n?/g, '')
            .trim();

        let jsonResult;
        try {
            jsonResult = JSON.parse(cleanJson);
            console.log("[API analyze-transcript] JSON parsé avec succès.");
        } catch {
            console.error("[API analyze-transcript] Erreur de parsing JSON du retour IA. Brut:", output);
            return NextResponse.json({ error: "Erreur de formatage de l'IA." }, { status: 500 });
        }

        return NextResponse.json(jsonResult);
    } catch (error: unknown) {
        console.error("[API analyze-transcript] Erreur globale:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur interne serveur" }, { status: 500 });
    }
}
