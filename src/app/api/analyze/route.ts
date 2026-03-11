import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export const maxDuration = 300;

export async function POST(req: Request) {
    const uploadedFileNames: string[] = [];
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("[API] Clé API Gemini manquante.");
            return NextResponse.json({ error: "Clé API Gemini (Google) manquante." }, { status: 500 });
        }

        const formData = await req.formData();
        const audioFile = formData.get('audio') as File | null;
        const attachedFiles = formData.getAll('files') as File[];

        if (!audioFile) {
            console.error("[API] Aucun fichier audio dans le FormData.");
            return NextResponse.json({ error: "Aucun fichier audio fourni." }, { status: 400 });
        }

        console.log(`[API] Réception d'un fichier audio : ${audioFile.name}, Taille: ${audioFile.size} octets, Type: ${audioFile.type}`);

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

        const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est d'écouter l'enregistrement d'un interrogatoire patient et de produire un bilan.
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "transcription": "La retranscription littérale et intégrale (brouillon mots-à-mots) de l'enregistrement",
  "resume": "Un résumé narratif en 3 à 5 phrases, sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce). Intègre l'essentiel de façon fluide.",
  "synthese": "La synthèse médicale formatée en Markdown"
}

**Règles pour la clé "transcription" :**
Retranscris tout ce que tu entends, le plus fidèlement possible, mot pour mot. Ne mets AUCUN texte en gras.

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
*IMPORTANT : Ne garde que ce qui est explicitement dit dans l'audio.*
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
                responseMimeType: "application/json",
            }
        });

        // Gemini nous renvoie cette fois une string contenant l'objet JSON. On doit la parser.
        const responseText = response.text || "{}";
        let parsedResult;
        try {
            parsedResult = JSON.parse(responseText);
        } catch {
            // Fallback sécurité si l'IA s'est ratée
            parsedResult = { patientName: "", transcription: "Erreur de formatage de la retranscription.", resume: "", synthese: responseText };
        }

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
    }
}
