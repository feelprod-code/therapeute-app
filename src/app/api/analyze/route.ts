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

                if (fMimeType.startsWith('text/')) {
                    console.log(`[API] Document texte joint prêt en mémoire: ${f.fileName}`);
                    parts.push({
                        text: `\n\n--- Document texte joint (${f.fileName}) ---\n${fBuffer.toString('utf-8')}\n--- Fin du document ---\n`
                    });
                } else {
                    console.log(`[API] Fichier attaché prêt en mémoire: ${f.fileName} (${fMimeType})`);
                    parts.push({
                        inlineData: {
                            data: fBuffer.toString('base64'),
                            mimeType: fMimeType
                        }
                    });
                }
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
Ton objectif est de mettre à jour la synthèse PRÉCÉDENTE en FUSIONNANT de manière cohérente les nouveaux éléments issus de l'audio/document dans les sections appropriées existantes.
- RÈGLE GÉNÉRALE: Maintiens la structure globale de la synthèse médicale. Intègre intelligemment les nouvelles plaintes, symptômes, ou examens complèmentaires DANS les sections pertinentes (par exemple, rajoute la localisation d'une nouvelle douleur dans "Histoire de la Maladie / Douleur"). 
- INTERDICTION: NE CRÉE SURTOUT PAS EN BAS DE PAGE une section "Ajout d'informations" ou "Nouvelles informations". Le bilan doit rester un document unifié, écrit de façon fluide comme s'il avait été rédigé en une seule fois.
- EXCEPTION (NOM DU PATIENT): Si les nouveaux documents/audios te permettent de découvrir le VRAI nom et prénom du patient (et que la synthèse précédente disait "Patient Anonyme" ou était incomplète), tu as l'OBLIGATION de le mettre à jour. N'oublie pas non plus de renseigner le champ "patientName" de ta réponse JSON.
- EXCEPTION (DATE DE LA CONSULTATION): Si les nouvelles notes précisent la vraie date de la consultation (ex: "la première séance était le 12 octobre"), tu as l'OBLIGATION de la mettre à jour dans ton texte Markdown ET de renseigner cette date au format AAAA-MM-JJ dans la clé "consultationDate" du JSON.
- Pour la transcription : Génère UNIQUEMENT la retranscription/description des NOUVEAUX éléments (nouveau vocal ou nouveau document). NE RECOPIE PAS l'ancienne transcription, le système s'en chargera automatiquement.
- EXCEPTION (RÉSUMÉ) : IL EST ABSOLUMENT OBLIGATOIRE que la clé "resume" contienne un résumé GLOBAL de TOUT LE BILAN FINAL (c'est-à-dire le texte généré dans la clé "synthese"). Ne résume SURTOUT PAS seulement les ajouts ! Le résumé doit donner l'état complet du patient.
`;
        }

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est d'analyser la transcription d'un interrogatoire patient fourni et de produire un bilan.${contextInstruction}
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ou chaîne vide si aucun)",
  "consultationDate": "Date trouvée dans le texte (ex: 2024-10-14). Si aucune date précise n'est mentionnée, renvoie null ou une chaîne vide.",
  "transcription": "Génère la retranscription EXACTE, LITTÉRALE (Verbatim) et INTÉGRALE de tout le dialogue de ce nouvel audio (ou document). RÈGLE ABSOLUE : Tu ne dois AUCUNEMENT corriger la grammaire, tu ne dois PAS supprimer les hésitations ('euh', 'ah', 'ben', répétitions). Retranscris CHAQUE MOT tel qu'il a été prononcé. Formate ce texte avec Markdown : ajoute toujours un **double saut de ligne** entre chaque prise de parole, et identifie l'interlocuteur avec : **<span style=\\"color: #bd613c;\\">Praticien :</span>** ou **<span style=\\"color: #bd613c;\\">Patient :</span>**.",
  "resume": "Un résumé narratif GLOBAL en 3 à 5 phrases, synthétisant TOUT le document final complet généré dans 'synthese' (anciennes ET nouvelles informations). Sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce).",
  "synthese": "La synthèse médicale formatée en Markdown"
}

Règles impératives :
1. "patientName" : Nom du patient (ex:"Jean DUPONT"). Laisse vide "" si absent.
2. "consultationDate" : Si le texte mentionne explicitement la date de la séance (ex: "bilan du 14 octobre", "vu le 12/03/2021"), extrait-la au format string ISO AAAA-MM-JJ. Sinon, string vide "".
3. "transcription" : Intégralité du texte brut reçu en entrée (nouveau vocal ou document). RÈGLE D'OR : Mot pour mot (Verbatim), incluant les erreurs, faux-départs et hésitations.
4. "resume" : Remplacer la transcription par un texte lisible en un coup d'oeil. (En cas de mise à jour, ce résumé DOIT couvrir l'intégralité du bilan fusionné).
5. "synthese" : Applique strictement la structure Markdown ci-dessous UNIQUEMENT si l'information est présente (ou fusionne à l'existant en ajoutant la section "Ajout du ..." si en mise à jour) :

# Bilan de consultation <span class="text-lg md:text-xl text-[#8c7b6d] font-normal ml-2">- [Date exacte de la consultation, ou ${currentDate} par défaut]</span>

### Informations Patient
- **Nom/Prénom :** [Jean Dupont]
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
