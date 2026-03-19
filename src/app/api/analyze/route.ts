import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
        const { audioFile, attachedFiles, previousContext } = body;

        // Note: For appending documents only, audioFile might be optional. 
        // We'll relax the strict audioFile requirement if there are attachedFiles.
        if ((!audioFile || !audioFile.fileName) && (!attachedFiles || attachedFiles.length === 0)) {
            console.error("[API] Aucun fichier audio ni document fourni.");
            return NextResponse.json({ error: "Aucun fichier fourni à analyser." }, { status: 400 });
        }

        // 1. Process Audio File (if present)
        const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];

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
            if (!finalMimeType) {
                const ext = audioFile.fileName.split('.').pop()?.toLowerCase();
                if (ext === 'm4a') finalMimeType = 'audio/mp4';
                else if (ext === 'mp3') finalMimeType = 'audio/mp3';
                else if (ext === 'wav') finalMimeType = 'audio/wav';
                else if (ext === 'mp4') finalMimeType = 'video/mp4';
                else if (ext === 'ogg') finalMimeType = 'audio/ogg';
                else finalMimeType = 'audio/webm';
            }

            // Override iOS mp4 audio to video/mp4 as Gemini is sometimes happier parsing it as a video container.
            if (finalMimeType === 'audio/mp4' || finalMimeType === 'audio/x-m4a') {
                finalMimeType = 'video/mp4';
            }

            console.log(`[API] Audio prêt en mémoire (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB). Type MIME: ${finalMimeType}`);
            parts.push({
                inlineData: {
                    data: audioBuffer.toString('base64'),
                    mimeType: finalMimeType
                }
            });
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

                console.log(`[API] Fichier attaché prêt en mémoire: ${f.fileName}`);
                parts.push({
                    inlineData: {
                        data: fBuffer.toString('base64'),
                        mimeType: fMimeType
                    }
                });
            }
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
Ton objectif est d'ajouter les nouveaux éléments à la synthèse précédente, SANS MODIFIER LE RESTE DE L'EXISTANT.
- RÈGLE GÉNÉRALE: Ne modifie PAS la structure de la synthèse précédente.
- EXCEPTION (NOM DU PATIENT): Si les nouveaux documents/audios te permettent de découvrir le VRAI nom et prénom du patient (et que la synthèse précédente disait "Patient Anonyme" ou était incomplète), tu as l'OBLIGATION de corriger son nom dans la section "Informations Patient" -> "**Nom/Prénom :**" de ta synthèse finale. N'oubliez pas non plus de renseigner le champ "patientName" de ta réponse JSON.
- Ajoute SIMPLEMENT à la fin de la synthèse précédente la date de la nouvelle information sous format "### Ajout du [Date]" puis le compte rendu des nouveaux éléments fournis.
- Pour la transcription : Génère UNIQUEMENT la retranscription/description des NOUVEAUX éléments (nouveau vocal ou nouveau document). NE RECOPIE PAS l'ancienne transcription, le système s'en chargera automatiquement.
`;
        }

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est d'analyser la transcription d'un interrogatoire patient fourni et de produire un bilan.${contextInstruction}
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "transcription": "Génère la retranscription EXACTE, littérale et intégrale de tout le dialogue de ce nouvel audio (ou le contenu du document). Formate ce texte proprement avec Markdown et HTML : ajoute toujours un **double saut de ligne** entre chaque prise de parole, et écris le nom de l'interlocuteur exactement avec cette balise HTML : **<span style=\\"color: #bd613c;\\">Praticien Philippe Guillaume :</span>** ou **<span style=\\"color: #bd613c;\\">Patient [Nom et Prénom] :</span>**. Ne mets pas juste en gras.",
  "resume": "Un résumé narratif en 3 à 5 phrases, sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce). Intègre l'essentiel de façon fluide.",
  "synthese": "La synthèse médicale formatée en Markdown"
}

Règles impératives :
1. "patientName" : Nom du patient (ex:"Jean DUPONT"). Laisse vide "" si absent.
2. "transcription" : Intégralité du texte brut reçu en entrée (nouveau vocal ou document). Tu dois IMPÉRATIVEMENT structurer le dialogue en identifiant chaque prise de parole avec la balise **<span style=\\"color: #bd613c;\\">... :</span>** et en séparant les répliques par des sauts de ligne.
3. "resume" : Remplacer la transcription par un texte lisible en un coup d'oeil.
4. "synthese" : Applique strictement la structure Markdown ci-dessous UNIQUEMENT si l'information est présente (ou fusionne à l'existant en ajoutant la section "Ajout du ..." si en mise à jour) :

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

        if (isUpdate && previousContext?.transcription) {
            const separator = "\n\n---\n**Ajout d'information :**\n";
            jsonResult.transcription = previousContext.transcription + separator + (jsonResult.transcription || "");
        }

        // CLEANUP (Not needed anymore since we use inlineData!)

        return NextResponse.json(jsonResult);

    } catch (error: unknown) {
        console.error("Erreur serveur API /analyze :", error);
        const errorMessage = error instanceof Error ? error.message : "Erreur inconnue.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
