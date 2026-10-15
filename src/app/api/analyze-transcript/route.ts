import { GoogleGenAI, Type } from '@google/genai';
import { NextResponse } from 'next/server';
import { ensureLastNameFirst, extractPatientNameFromText, isPlausiblePersonName } from '@/lib/utils';

export const maxDuration = 300;

export async function POST(req: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });

        const ai = new GoogleGenAI({ apiKey });
        const formData = await req.formData();
        const transcript = formData.get('transcript') as string;
        const targetLanguage = (formData.get('targetLanguage') as string) || 'Étranger';
        const attachedFiles = formData.getAll('files') as File[];

        if (!transcript || transcript.trim().length === 0) {
            return NextResponse.json({ error: "Aucune transcription fournie." }, { status: 400 });
        }

        const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const defaultDateShort = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

        const systemPrompt = `Tu es un assistant médical clinique expert travaillant pour Guillaume Philippe, masseur-kinésithérapeute et ostéopathe (approche tissulaire douce TDT).
Voici la retranscription complète d'une consultation bilingue (${targetLanguage} / Français) ainsi que d'éventuels documents joints.
Ton rôle est d'analyser l'intégralité de cet échange et de produire un bilan médical exhaustif en FRANÇAIS.

Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom du patient au format NOM Prénom (ex: 'SMITH John' ou chaîne vide si non mentionné)",
  "consultationDate": "Date de la consultation au format AAAA-MM-JJ si mentionnée, sinon chaîne vide",
  "resume": "Le résumé clinique structuré en Markdown",
  "synthese": "Le bilan complet de consultation formaté en Markdown"
}

Règles impératives :
1. "patientName" : Extrait le NOM (en MAJUSCULES) suivi du Prénom si mentionné dans la conversation ou les documents. Ne prends JAMAIS une phrase de dialogue ("Hello", "Bonjour", "Yes", "Oui") pour un nom ! Si aucun nom n'est mentionné, renvoie "".
2. "resume" : Rédige le résumé en Français avec les sections :
### 📋 Motif de Consultation, Symptômes Exprimés & Demande du Patient
- **Motif de consultation :** ...
- **Symptômes exprimés :** ...
- **Demande du patient :** ...

### 🎯 Examens d'Imagerie & Planches Didactiques
- ...

### Suivis Datés & Évolution
- **${defaultDateShort} :** Consultation bilingue (${targetLanguage} / Français). ...

3. "synthese" : Rédige le bilan complet en Français suivant strictement cette structure jusqu'à la fin de la section Antécédents :
# Bilan de consultation <span style="font-size: 0.6em; color: #8c7b6d;">- ${defaultDateShort}</span>

### Informations Patient
- **Nom/Prénom :** [Nom et Prénom ou Non renseigné]
- **Langue de consultation :** ${targetLanguage} / Français
- **Âge / Date de naissance :** [Extraire si mentionné, sinon Non renseigné]
- **Profession :** [Extraire si mentionné, sinon Non renseigné]
- **Date de consultation :** ${defaultDateShort}

### Motif de Consultation
[...]

### Histoire de la Maladie / Douleur
- **Description :** [...]
- **Intensité :** [...]
- **Fréquence :** [...]
- **Circonstances d'apparition :** [...]
- **Traitements déjà tentés :** [...]

### Examens Complémentaires
- **Photos / PDF / Textes :**
  - [...]

### Antécédents (ATCD) et Chronologie
- [...]`;

        const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [
            { text: `TRANSCRIPTION DE LA CONSULTATION BILINGUE (${targetLanguage} / Français) :\n\n${transcript}` }
        ];

        for (let i = 0; i < attachedFiles.length; i++) {
            const file = attachedFiles[i];
            const fArrayBuffer = await file.arrayBuffer();
            const fBase64 = Buffer.from(fArrayBuffer).toString('base64');
            let fMimeType = (file.type || 'application/octet-stream').split(';')[0].trim();
            if (file.name.toLowerCase().endsWith('.pdf')) fMimeType = 'application/pdf';
            if (file.name.toLowerCase().endsWith('.png')) fMimeType = 'image/png';
            if (file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) fMimeType = 'image/jpeg';

            parts.push({
                inlineData: {
                    data: fBase64,
                    mimeType: fMimeType
                }
            });
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts }],
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: 'application/json',
                maxOutputTokens: 32768,
                temperature: 0.1,
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        patientName: { type: Type.STRING },
                        consultationDate: { type: Type.STRING },
                        resume: { type: Type.STRING },
                        synthese: { type: Type.STRING }
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
            .replace(/```json\n/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const jsonResult = JSON.parse(cleanJson);

        let validName = jsonResult.patientName?.trim() || "";
        if (!isPlausiblePersonName(validName)) {
            const fallback = extractPatientNameFromText(transcript);
            validName = isPlausiblePersonName(fallback) ? fallback : "";
        }
        if (validName) {
            validName = ensureLastNameFirst(validName);
        }

        jsonResult.patientName = validName;
        jsonResult.transcription = transcript;
        jsonResult.targetLanguage = targetLanguage;

        return NextResponse.json(jsonResult);

    } catch (error: unknown) {
        console.error("Erreur serveur API /analyze-transcript :", error);
        const errorMessage = error instanceof Error ? error.message : "Erreur inconnue.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
