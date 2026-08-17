import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { ensureLastNameFirst } from '@/lib/utils';

export const maxDuration = 120;

export async function POST(req: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        const openAiApiKey = process.env.OPENAI_WHISPER_KEY || process.env.OPENAI_API_KEY;

        if (!apiKey) {
            return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });
        }

        const body = await req.json();
        let { instruction } = body;
        const { synthese, transcription, patientName, audioBase64, mimeType } = body;

        if (!instruction && !audioBase64) {
            return NextResponse.json({ error: "Aucune instruction ou fichier audio fourni." }, { status: 400 });
        }

        // Si un enregistrement audio direct est envoyé
        if (audioBase64 && openAiApiKey) {
            try {
                const buffer = Buffer.from(audioBase64, 'base64');
                const ext = mimeType && mimeType.includes('webm') ? '.webm' : '.mp3';
                const tempAudioPath = path.join(os.tmpdir(), `copilot-audio-${Date.now()}${ext}`);
                await fs.writeFile(tempAudioPath, buffer);

                const openai = new OpenAI({ apiKey: openAiApiKey });
                const transcriptionResponse = await openai.audio.transcriptions.create({
                    file: createReadStream(tempAudioPath),
                    model: "whisper-1",
                    language: "fr",
                    response_format: "text",
                });
                instruction = String(transcriptionResponse).trim();
                await fs.unlink(tempAudioPath).catch(() => {});
            } catch (err) {
                console.error("[Copilot API] Erreur Whisper:", err);
            }
        }

        if (!instruction) {
            return NextResponse.json({ error: "Impossible de comprendre l'instruction audio." }, { status: 400 });
        }

        const ai = new GoogleGenAI({ apiKey });

        const prompt = `Tu es l'agent copilote expert clinique de l'application Micro Thérapeute (ostéopathie, biokinergie, thérapie manuelle).
Le praticien te demande d'effectuer une RETOUCHE / MODIFICATION précise sur le bilan ou la fiche patient.

=== FICHE ACTUELLE DU PATIENT ===
Nom du patient : ${patientName || "Non renseigné"}

=== BILAN DE CONSULTATION ACTUEL (MARKDOWN) ===
${synthese || "(Aucun bilan rédigé pour le moment)"}

${transcription ? `=== TRANSCRIPTION VOCALE SOURCE (RÉFÉRENCE MOT-À-MOT) ===\n${transcription.slice(0, 3000)}...` : ""}

=== INSTRUCTION DE MODIFICATION DU THÉRAPEUTE ===
"${instruction}"

=== RÈGLES CLINIQUES & DE FORMATAGE IMPÉRATIVES ===
1. TITRE DU BILAN : Le titre principal doit TOUJOURS respecter strictement le format suivant :
   # Bilan de consultation <span style="font-size: 0.6em; color: #8c7b6d;">- [Date]</span>
   (Si la consigne change la date, mets à jour [Date] dans ce span. Ne supprime jamais le span).
2. FUSION FLUIDE : Intègre harmonieusement la correction demandée dans la bonne section (Motif, Anamnèse, Antécédents, Examen clinique, Conclusion).
   INTERDICTION : Ne crée JAMAIS de bloc "Ajout" ou "Complément d'information" isolé en bas. Tout doit être intégré comme si le bilan avait été rédigé ainsi dès l'origine.
3. PRÉSERVATION DES DONNÉES : Conserve l'intégralité des autres informations cliniques intactes, ne résume pas à l'excès et ne perds aucun élément clé.
4. TON & VOCABULAIRE : Sensible, clinique, épuré, respectueux du vivant.
5. Si l'instruction demande de modifier le nom du patient, renvoie le nom corrigé dans 'patientName'.

Format JSON attendu :
{
  "patientName": "Nom et prénom du patient",
  "synthese": "Le bilan complet mis à jour en Markdown",
  "summaryOfChanges": "Une phrase très courte et épurée décrivant la retouche effectuée (ex: 'Diagnostic réajusté en sacro-iliaque droite et date mise à jour au 14 juillet.')"
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: prompt }],
            config: {
                systemInstruction: "Tu retournes uniquement du JSON strict contenant patientName, synthese et summaryOfChanges.",
                responseMimeType: 'application/json',
                maxOutputTokens: 8192,
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        patientName: { type: Type.STRING },
                        synthese: { type: Type.STRING },
                        summaryOfChanges: { type: Type.STRING }
                    },
                    required: ["patientName", "synthese", "summaryOfChanges"]
                }
            }
        });

        const jsonText = response.text || "{}";
        const result = JSON.parse(jsonText.replace(/```json/g, '').replace(/```/g, '').trim());

        return NextResponse.json({
            patientName: ensureLastNameFirst(result.patientName || patientName),
            synthese: result.synthese,
            summaryOfChanges: result.summaryOfChanges,
            recognizedInstruction: instruction
        });

    } catch (error: unknown) {
        console.error("[API Copilot] Erreur :", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur interne" }, { status: 500 });
    }
}
