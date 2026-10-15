import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "Clé API Gemini manquante." },
                { status: 500 }
            );
        }

        const formData = await req.formData();
        const audioFile = formData.get("audio") as File | null;
        const promptHint = (formData.get("prompt") as string | null) || "";

        if (!audioFile) {
            return NextResponse.json(
                { error: "Aucun fichier audio fourni." },
                { status: 400 }
            );
        }

        const arrayBuffer = await audioFile.arrayBuffer();
        if (arrayBuffer.byteLength < 500) {
            return NextResponse.json({ text: "" });
        }

        const base64Audio = Buffer.from(arrayBuffer).toString("base64");

        let mimeType = (audioFile.type || "audio/webm").split(";")[0].trim();
        if (mimeType === "audio/x-m4a") {
            mimeType = "audio/mp4";
        }

        const systemInstruction = `Tu es un transcripteur médical expert pour un cabinet d'ostéopathie et de kinésithérapie (Approche Tissulaire Douce TDT de Guillaume Philippe).
Transcris cet enregistrement vocal en français avec une orthographe et une ponctuation impeccables.
Ne rajoute aucun commentaire, aucune formule de politesse, aucun guillemet autour du texte : renvoie uniquement le texte dicté exact. Si l'audio est totalement silencieux ou inaudible, renvoie une chaîne vide.${promptHint ? `\nContexte : ${promptHint}` : ""}`;

        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: systemInstruction },
                        {
                            inlineData: {
                                mimeType,
                                data: base64Audio,
                            },
                        },
                    ],
                },
            ],
            config: {
                temperature: 0.1,
            },
        });

        let text = response.text?.trim() || "";
        if (
            text.includes("je n'ai pas la capacité d'écouter") ||
            text.includes("aucun son") ||
            text.toLowerCase() === "inaudible"
        ) {
            text = "";
        }

        return NextResponse.json({ text });
    } catch (err: unknown) {
        console.error("[Transcribe Route Error]:", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Erreur interne de transcription" },
            { status: 500 }
        );
    }
}
