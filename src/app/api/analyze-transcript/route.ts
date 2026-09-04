import { NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { ensureLastNameFirst, extractPatientNameFromText } from '@/lib/utils';
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

        const systemPrompt = `Tu es un assistant médical clinique expert (ostéopathie, biokinergie, thérapie manuelle). Ton rôle est d'analyser l'intégralité de la transcription de l'interrogatoire patient et de produire un bilan médical exhaustif, riche et rigoureusement structuré.
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom trouvés (ex: 'PETIT TOYOZATO Eri' ou 'DONNADIEU Nathalie')",
  "consultationDate": "Date trouvée dans le texte (ex: 2024-10-14). Si aucune date précise n'est mentionnée, renvoie null ou une chaîne vide.",
  "transcription": "",
  "resume": "Le résumé global et évolutif intégrant le bilan initial et les suivis datés (avec imagerie clé en markdown pur si présente, lieux de fracture, notes psy et synthèse clinique).",
  "synthese": "La synthèse médicale formatée en Markdown"
}

Règles impératives et absolues :
1. "patientName" : Extrait scrupuleusement le NOM (en MAJUSCULES) suivi du Prénom (ex: "PETIT TOYOZATO Eri", "SOULE Laura"). Si le texte commence par une civilité (Madame, Monsieur), des lignes avec Nom, Prénom, Nom de naissance, analyse scrupuleusement ces lignes. Ne renvoie JAMAIS "Anonyme", "Patient Anonyme" ou chaîne vide si un nom ou prénom est mentionné ou discernable dans le texte ou les documents !
2. "consultationDate" : Si le texte mentionne EXPLICITEMENT la date de la séance (ex: "bilan du 14 octobre", "vu le 12/03/2021"), extrait-la au format string ISO AAAA-MM-JJ. Si AUCUNE date n'est prononcée ou écrite dans les documents, tu DOIS IMPÉRATIVEMENT renvoyer une chaîne vide "".
3. "transcription" : Laisse ce champ STRICTEMENT vide "" car la transcription est déjà entièrement gérée par le serveur.
4. "resume" : Remplacer la transcription par un texte lisible en un coup d'oeil intégrant le bilan initial et toutes les séances de suivi avec leurs dates respectives, les constats radiologiques (fractures, cals osseux) et le volet psycho-émotionnel.
5. "synthese" : RÈGLE D'EXHAUSTIVITÉ CLINIQUE SANS REMPLISSAGE SPÉCULATIF :
   - RÈGLE CRITIQUE (ZÉRO SPÉCULATION / ZÉRO BLABLA QUAND AUCUN INTERROGATOIRE N'EST FOURNI) : Si l'utilisateur n'a transmis QUE l'identité du patient ou des résultats d'examens (radio, scanner) SANS audio d'interrogatoire clinique : N'INVENTE JAMAIS de texte d'explication ou de remplissage théorique (ex: NE PAS écrire 'Le patient se présente pour une évaluation...', NE PAS écrire 'En l'absence d'informations spécifiques...', NE PAS écrire 'Non précisés : Cette section exhaustive recenserait...'). Laisse simplement un tiret '-' ou 'Non renseigné' pour les sections sans informations (Motif, Histoire, ATCD), car l'audio de consultation arrivera ultérieurement !
   - **Histoire de la Maladie** : Si un interrogatoire a eu lieu, décris exhaustivement les symptômes, leur localisation, leur date d'apparition précise, les circonstances déclenchantes et les traitements déjà tentés. Sinon, écris simplement '-'.
   - **Antécédents et Chronologie (ATCD)** : Si mentionnés, liste TOUS les traumatismes physiques, deuils, chirurgies, classés par ordre chronologique. Sinon, écris simplement '-'.
   - **Examens Complémentaires** : Transcris exhaustivement les constatations et conclusions des examens radiologiques/médicaux fournis.
   - **Règle Anti-Troncature** : Chaque section doit être rédigée intégralement jusqu'à son terme sans jamais s'interrompre.

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
- **Photos / PDF / Textes :** Aucun document joint
### Antécédents (ATCD) et Chronologie
- [Année] - [Description]

TRÈS IMPORTANT : Produis uniquement un objet JSON valide conforme au schéma.`;

        const parts: Array<{ text?: string, fileData?: { fileUri: string, mimeType: string } }> = allUploads.map(up => ({
            fileData: { fileUri: up.uri, mimeType: up.mimeType }
        }));
        parts.push({ text: `Transcription brute à analyser :\n${transcript}\n\nINSTRUCTIONS SYSTEME:\n${systemPrompt}` });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: parts,
            config: {
                systemInstruction: "Tu retournes uniquement du JSON.",
                responseMimeType: 'application/json',
                maxOutputTokens: 65536,
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        patientName: {
                            type: Type.STRING,
                            description: "Nom et Prénom trouvés (ou chaîne vide si aucun)"
                        },
                        resume: {
                            type: Type.STRING,
                            description: "Un résumé narratif en 3 à 5 phrases, sous forme d'un paragraphe continu unique."
                        },
                        synthese: {
                            type: Type.STRING,
                            description: "La synthèse médicale formatée en Markdown"
                        }
                    },
                    required: ["patientName", "resume", "synthese"]
                }
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

        // Fallback extraction de nom si l'IA n'a rien trouvé ou a mis Anonyme
        if (!jsonResult.patientName || jsonResult.patientName.toLowerCase().startsWith("patient anonyme") || jsonResult.patientName.toLowerCase() === "anonyme" || jsonResult.patientName.toLowerCase().includes("non précisé")) {
            const fallbackName = extractPatientNameFromText(transcript);
            if (fallbackName) {
                jsonResult.patientName = fallbackName;
            }
        }

        if (jsonResult.patientName) {
            jsonResult.patientName = ensureLastNameFirst(jsonResult.patientName);
        }

        jsonResult.transcription = transcript;

        if (jsonResult.synthese) {
            const defaultDateFormatted = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
            jsonResult.synthese = jsonResult.synthese
                .replace(/# Bilan de consultation\s*<span[^>]*>-?\s*(?:\[Date[^\]]*\]|Non précisé(?:e)?|null|undefined)?\s*<\/span>/gi, `# Bilan de consultation <span style="font-size: 0.6em; color: #8c7b6d;">- ${defaultDateFormatted}</span>`)
                .replace(/- \*\*Date de consultation :\*\*(\s*)(?:\[Date[^\]]*\]|Non précisé(?:e)?|null|undefined)?$/gmi, `- **Date de consultation :** ${defaultDateFormatted}`);
        }

        return NextResponse.json(jsonResult);
    } catch (error: unknown) {
        console.error("[API analyze-transcript] Erreur globale:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur interne serveur" }, { status: 500 });
    }
}
