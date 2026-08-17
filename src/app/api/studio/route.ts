import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import os from 'os';

export const maxDuration = 120;

const BASE_APP_DIR = process.cwd();
const BACKUP_DIR = path.join(BASE_APP_DIR, '.studio_backups');

export async function POST(req: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        const openAiApiKey = process.env.OPENAI_WHISPER_KEY || process.env.OPENAI_API_KEY;

        if (!apiKey) {
            return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });
        }

        const body = await req.json();
        const { action = 'execute', backupId } = body;

        // --- GESTION DU ROLLBACK (ANNULATION) ---
        if (action === 'rollback') {
            if (!backupId) {
                return NextResponse.json({ error: "ID de sauvegarde manquant." }, { status: 400 });
            }
            const specificBackupDir = path.join(BACKUP_DIR, backupId);
            try {
                const files = await fs.readdir(specificBackupDir);
                const restored: string[] = [];
                for (const file of files) {
                    if (file.endsWith('.meta.json')) continue;
                    const metaFile = path.join(specificBackupDir, `${file}.meta.json`);
                    let originalRelativePath = '';
                    try {
                        const meta = JSON.parse(await fs.readFile(metaFile, 'utf-8'));
                        originalRelativePath = meta.originalPath;
                    } catch {
                        continue;
                    }
                    if (originalRelativePath) {
                        const targetDest = path.join(BASE_APP_DIR, originalRelativePath);
                        const backupContent = await fs.readFile(path.join(specificBackupDir, file));
                        await fs.writeFile(targetDest, backupContent);
                        restored.push(originalRelativePath);
                    }
                }
                return NextResponse.json({
                    status: "success",
                    message: `Restauration réussie (${restored.length} fichier(s) remis à l'état précédent).`,
                    restoredFiles: restored
                });
            } catch (err) {
                return NextResponse.json({ error: "Impossible de restaurer la sauvegarde : " + String(err) }, { status: 500 });
            }
        }

        // --- GESTION DE L'EXÉCUTION (LIVE CODE) ---
        let { instruction } = body;
        const { currentPath, audioBase64, mimeType } = body;

        if (!instruction && !audioBase64) {
            return NextResponse.json({ error: "Aucune instruction ou audio fourni." }, { status: 400 });
        }

        if (audioBase64 && openAiApiKey) {
            try {
                const buffer = Buffer.from(audioBase64, 'base64');
                const ext = mimeType && mimeType.includes('webm') ? '.webm' : '.mp3';
                const tempAudioPath = path.join(os.tmpdir(), `studio-audio-${Date.now()}${ext}`);
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
                console.error("[Studio API] Erreur Whisper:", err);
            }
        }

        if (!instruction) {
            return NextResponse.json({ error: "Impossible de comprendre l'instruction." }, { status: 400 });
        }

        // Identifier les fichiers candidats pertinents dans l'application
        const srcDir = path.join(BASE_APP_DIR, 'src');
        const relevantFiles: { relativePath: string; content: string }[] = [];

        const scanDir = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                const rel = path.relative(BASE_APP_DIR, full);
                if (entry.isDirectory()) {
                    if (entry.name !== 'node_modules' && entry.name !== '.next' && entry.name !== '.git') {
                        await scanDir(full);
                    }
                } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.css'))) {
                    // Si le fichier est pertinent ou fait partie des pages principales
                    if (rel.includes('consultation') || rel.includes('components') || rel.includes('app/page.tsx') || rel.includes('globals.css')) {
                        try {
                            const content = await fs.readFile(full, 'utf-8');
                            // Limiter aux fichiers raisonnables en taille
                            if (content.length < 120000) {
                                relevantFiles.push({ relativePath: rel, content });
                            }
                        } catch {}
                    }
                }
            }
        };

        await scanDir(srcDir);

        const ai = new GoogleGenAI({ apiKey });

        const systemPrompt = `Tu es l'architecte développeur intégré (Mode Studio) de l'application Micro Thérapeute (Next.js 14, React 18, Tailwind CSS, TypeScript, Framer Motion).
Le créateur de l'application (Guillaume Philippe) te demande d'ajouter ou modifier une fonctionnalité, un bouton, un style ou un composant en direct.

=== CONTEXTE ACTUEL DE L'APPLICATION ===
Page actuellement affichée à l'écran : ${currentPath || "/"}

=== FICHIERS SOURCES CLÉS DU PROJET ===
${relevantFiles.map(f => `--- FICHIER: ${f.relativePath} ---\n${f.content.slice(0, 8000)}\n--- FIN FICHIER ---`).join('\n\n')}

=== DEMANDE DU CONCEPTEUR ===
"${instruction}"

=== RÈGLES DE CODAGE STRICTES ===
1. DESIGN ÉPURÉ & COHÉRENT : Utilise la palette élégante de l'app (blanc #ffffff, ivoire #fdfbf6, texte #4a3f35, sous-titres #8c7b6d, accent terracotta #bd613c, bordures subtiles #e5e2dd, arrondis doux, micro-animations discrètes).
2. CODE PRODUCTION READY : Génère du code TypeScript/React valide sans erreur de compilation.
3. PRÉCISION CHIRURGICALE : Fournis le contenu COMPLET et final du fichier à modifier (ou à créer).
4. SÉCURITÉ : Ne casse jamais les imports ou les hooks existants.

Format JSON attendu :
{
  "modifiedFiles": [
    {
      "relativePath": "src/app/... ou src/components/...",
      "newContent": "Le code TypeScript complet et prêt pour la production.",
      "explanation": "Ce que cette modification apporte."
    }
  ],
  "summary": "Résumé concis de la fonctionnalité ajoutée ou du changement apporté."
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: systemPrompt }],
            config: {
                systemInstruction: "Tu retournes uniquement du JSON strict contenant modifiedFiles et summary.",
                responseMimeType: 'application/json',
                maxOutputTokens: 8192,
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        modifiedFiles: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    relativePath: { type: Type.STRING },
                                    newContent: { type: Type.STRING },
                                    explanation: { type: Type.STRING }
                                },
                                required: ["relativePath", "newContent", "explanation"]
                            }
                        },
                        summary: { type: Type.STRING }
                    },
                    required: ["modifiedFiles", "summary"]
                }
            }
        });

        const jsonText = response.text || "{}";
        const result = JSON.parse(jsonText.replace(/```json/g, '').replace(/```/g, '').trim());

        if (!result.modifiedFiles || result.modifiedFiles.length === 0) {
            return NextResponse.json({ error: "Aucun fichier à modifier trouvé pour cette consigne." }, { status: 400 });
        }

        // Création du backup avant écriture
        const currentBackupId = `backup-${Date.now()}`;
        const specificBackupDir = path.join(BACKUP_DIR, currentBackupId);
        await fs.mkdir(specificBackupDir, { recursive: true });

        const appliedFiles: string[] = [];

        for (const mod of result.modifiedFiles) {
            const targetFilePath = path.join(BASE_APP_DIR, mod.relativePath);
            
            // Backup si le fichier existe
            try {
                const currentContent = await fs.readFile(targetFilePath);
                const safeFileName = mod.relativePath.replace(/\//g, '_');
                await fs.writeFile(path.join(specificBackupDir, safeFileName), currentContent);
                await fs.writeFile(path.join(specificBackupDir, `${safeFileName}.meta.json`), JSON.stringify({ originalPath: mod.relativePath }));
            } catch {}

            // Écriture du nouveau contenu
            await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
            await fs.writeFile(targetFilePath, mod.newContent, 'utf-8');
            appliedFiles.push(mod.relativePath);
        }

        return NextResponse.json({
            status: "success",
            backupId: currentBackupId,
            appliedFiles,
            summary: result.summary,
            recognizedInstruction: instruction
        });

    } catch (error: unknown) {
        console.error("[API Studio] Erreur :", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur interne Studio" }, { status: 500 });
    }
}
