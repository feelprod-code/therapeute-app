import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { ensureLastNameFirst } from '@/lib/utils';

export const maxDuration = 120;

const PREFS_PATH = path.join(process.cwd(), 'src', 'lib', 'practitioner-preferences.json');

async function getPractitionerRules(): Promise<string[]> {
    try {
        const raw = await fs.readFile(PREFS_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.rules) ? parsed.rules : [];
    } catch {
        return [];
    }
}

async function addPractitionerRule(newRule: string): Promise<string[]> {
    try {
        const raw = await fs.readFile(PREFS_PATH, 'utf-8').catch(() => '{"rules":[]}');
        const parsed = JSON.parse(raw);
        const rules = Array.isArray(parsed.rules) ? parsed.rules : [];
        const clean = newRule.trim();
        if (clean && !rules.includes(clean)) {
            rules.push(clean);
            parsed.rules = rules;
            parsed.lastUpdated = new Date().toISOString();
            await fs.writeFile(PREFS_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
        }
        return rules;
    } catch {
        return [];
    }
}

export async function POST(req: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        const openAiApiKey = process.env.OPENAI_WHISPER_KEY || process.env.OPENAI_API_KEY;

        if (!apiKey) {
            return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });
        }

        const body = await req.json();
        let { instruction } = body;
        const { synthese, transcription, patientName, audioBase64, mimeType, conversationHistory } = body;

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

        // Charger les règles et préférences du praticien
        const practitionerRules = await getPractitionerRules();

        // Détection de mémorisation de règle directe
        let learnedRuleMessage: string | null = null;
        const lowerInst = instruction.toLowerCase().trim();
        if (lowerInst.startsWith('mémorise que') || lowerInst.startsWith('mémorise :') || lowerInst.startsWith('apprends que') || lowerInst.startsWith('garde en mémoire que')) {
            const ruleText = instruction.replace(/^(mémorise que|mémorise :|apprends que|garde en mémoire que)/i, '').trim();
            if (ruleText) {
                await addPractitionerRule(ruleText);
                learnedRuleMessage = `Règle mémorisée dans votre profil : "${ruleText}"`;
            }
        }

        const ai = new GoogleGenAI({ apiKey });

        const historyContext = Array.isArray(conversationHistory) && conversationHistory.length > 0
            ? `\n=== HISTORIQUE DE CONVERSATION RÉCENTE ===\n${conversationHistory.map((m: any) => `${m.role === 'user' ? 'Praticien' : 'Copilote'}: ${m.content}`).join('\n')}\n`
            : '';

        const prompt = `Tu es l'agent copilote intelligent de l'application Micro Thérapeute (ostéopathie, biokinergie, thérapie manuelle).
Tu es en dialogue direct avec le praticien (thérapeute).

=== FICHE DU PATIENT EN COURS (SI APPLICABLE) ===
Nom du patient : ${patientName || "Non renseigné"}

=== BILAN DE CONSULTATION ACTUEL (MARKDOWN) ===
${synthese || "(Aucun bilan en cours de consultation)"}

${transcription ? `=== TRANSCRIPTION VOCALE SOURCE (RÉFÉRENCE MOT-À-MOT) ===\n${transcription.slice(0, 4000)}...` : ""}
${historyContext}
=== MESSAGE / INSTRUCTION DU THÉRAPEUTE ===
"${instruction}"

=== RÈGLES ET PRÉFÉRENCES APPRISES DU PRATICIEN ===
${practitionerRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

=== COMPORTEMENT ATTENDU SELON LE TYPE DE DEMANDE ===

1. SI LE PRATICIEN DEMANDE UNE RETOUCHE OU UN AJOUT SUR LE BILAN :
   - Mets à jour le texte du bilan dans "synthese".
   - CONSERVE L'INTÉGRALITÉ des sections existantes sans les écraser.
   - Si la consigne change le nom du patient, renvoie-le dans "patientName".
   - Écris dans "summaryOfChanges" une phrase claire et directe résumant la retouche effectuée.

2. SI LE PRATICIEN POSE UNE QUESTION, DEMANDE UNE EXPLICATION, OU PARLE DU FONCTIONNEMENT DE L'APPLICATION (ex: recherche, accents, utilisation) :
   - Ne modifie pas le bilan : laisse "synthese" exactement identique à l'actuel.
   - Réponds directement, poliment et chaleureusement au praticien dans "summaryOfChanges" en français, en lui expliquant ce qui a été fait ou comment cela fonctionne.
   - Ne sois JAMAIS froid ou robotique (ne dis jamais "L'instruction concerne les paramètres et n'entraîne pas de modification..."). Parle comme un véritable confrère assistant attentif et utile.

Format JSON attendu :
{
  "patientName": "Nom et prénom du patient",
  "synthese": "Le bilan en Markdown (mis à jour si retouche demandée, ou identique à l'actuel si discussion/question)",
  "summaryOfChanges": "Ta réponse directe et claire au praticien (explication ou résumé de la retouche appliquée)"
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: prompt }],
            config: {
                systemInstruction: "Tu es un copilote bienveillant, précis et réactif. Tu retournes uniquement du JSON strict contenant patientName, synthese et summaryOfChanges.",
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
            patientName: result.patientName || patientName,
            synthese: result.synthese,
            summaryOfChanges: result.summaryOfChanges,
            recognizedInstruction: instruction,
            learnedRule: learnedRuleMessage
        });

    } catch (error: unknown) {
        console.error("[API Copilot] Erreur :", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur interne" }, { status: 500 });
    }
}
