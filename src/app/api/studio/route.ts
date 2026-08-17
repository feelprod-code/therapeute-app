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
                    message: `Restauration réussie (${restored.length} fichier(s) rétabli(s)).`,
                    restoredFiles: restored
                });
            } catch (err) {
                return NextResponse.json({ error: "Impossible de restaurer la sauvegarde : " + String(err) }, { status: 500 });
            }
        }

        // --- GESTION DE L'EXÉCUTION (LIVE CODE PAR PATCH CIBLÉ) ---
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

        // Identifier les fichiers candidats pertinents
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
                    if (rel.includes('consultation') || rel.includes('components') || rel.includes('app/page.tsx') || rel.includes('globals.css')) {
                        try {
                            const content = await fs.readFile(full, 'utf-8');
                            // On extrait un extrait contextuel concis pour ne pas surcharger le prompt
                            relevantFiles.push({
                                relativePath: rel,
                                content: content.length > 20000 ? content.slice(0, 20000) + "\n// ... [reste du fichier]" : content
                            });
                        } catch {}
                    }
                }
            }
        };

        await scanDir(srcDir);

        const ai = new GoogleGenAI({ apiKey });

        const systemPrompt = `Tu es l'architecte développeur en direct (Mode Studio) de l'application Micro Thérapeute (Next.js 14, React 18, Tailwind CSS, TypeScript).
Le praticien / concepteur te demande d'effectuer une amélioration, ajouter un bouton, modifier un style ou ajouter une fonctionnalité.

=== CONTEXTE ACTUEL DE L'APPLICATION ===
Page active : ${currentPath || "/"}

=== FICHIERS SOURCES DU PROJET ===
${relevantFiles.map(f => `--- FICHIER: ${f.relativePath} ---\n${f.content}\n--- FIN FICHIER ---`).join('\n\n')}

=== DEMANDE DU CONCEPTEUR ===
"${instruction}"

=== RÈGLES CRITIQUES D'ÉDITION CIBLÉE (PATCH) ===
1. PATCH CIBLÉ OBLIGATOIRE : Au lieu de réécrire tout un gros fichier de 1000 lignes, fournis UNIQUEMENT le bloc exact de code à remplacer (targetContent) et le nouveau bloc de remplacement (replacementContent).
2. TARGETCONTENT EXACT : Le targetContent doit être une sous-chaîne EXACTE (caractère pour caractère) existante dans le fichier cible.
3. NOUVEAUX FICHIERS : Si la demande nécessite de créer un nouveau composant dans src/components/, place-le dans 'newFiles'.
4. DESIGN ÉPURÉ : Palette blanc #ffffff, ivoire #fdfbf6, texte #4a3f35, accent #bd613c, bordures douces #e5e2dd.

Format JSON attendu :
{
  "modifications": [
    {
      "relativePath": "src/app/page.tsx",
      "targetContent": "le bloc exact de code à remplacer",
      "replacementContent": "le nouveau code à insérer à la place"
    }
  ],
  "newFiles": [
    {
      "relativePath": "src/components/NouveauBouton.tsx",
      "content": "code complet du nouveau composant"
    }
  ],
  "summary": "Une phrase courte décrivant la modification appliquée."
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: systemPrompt }],
            config: {
                systemInstruction: "Tu retournes uniquement du JSON strict contenant modifications, newFiles et summary.",
                responseMimeType: 'application/json',
                maxOutputTokens: 8192,
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        modifications: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    relativePath: { type: Type.STRING },
                                    targetContent: { type: Type.STRING },
                                    replacementContent: { type: Type.STRING }
                                },
                                required: ["relativePath", "targetContent", "replacementContent"]
                            }
                        },
                        newFiles: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    relativePath: { type: Type.STRING },
                                    content: { type: Type.STRING }
                                },
                                required: ["relativePath", "content"]
                            }
                        },
                        summary: { type: Type.STRING }
                    },
                    required: ["modifications", "newFiles", "summary"]
                }
            }
        });

        const jsonText = response.text || "{}";
        const result = JSON.parse(jsonText.replace(/```json/g, '').replace(/```/g, '').trim());

        const hasMods = result.modifications && result.modifications.length > 0;
        const hasNew = result.newFiles && result.newFiles.length > 0;

        if (!hasMods && !hasNew) {
            return NextResponse.json({ error: "Aucune modification applicable trouvée pour cette consigne." }, { status: 400 });
        }

        // Création du dossier de sauvegarde
        const currentBackupId = `backup-${Date.now()}`;
        const specificBackupDir = path.join(BACKUP_DIR, currentBackupId);
        await fs.mkdir(specificBackupDir, { recursive: true });

        const appliedFiles: string[] = [];

        // 1. Appliquer les modifications ciblées sur les fichiers existants
        if (hasMods) {
            for (const mod of result.modifications) {
                const targetFilePath = path.join(BASE_APP_DIR, mod.relativePath);
                try {
                    const currentContent = await fs.readFile(targetFilePath, 'utf-8');

                    // Sauvegarde
                    const safeFileName = mod.relativePath.replace(/\//g, '_');
                    await fs.writeFile(path.join(specificBackupDir, safeFileName), currentContent, 'utf-8');
                    await fs.writeFile(path.join(specificBackupDir, `${safeFileName}.meta.json`), JSON.stringify({ originalPath: mod.relativePath }));

                    // Remplacement ciblé
                    if (currentContent.includes(mod.targetContent)) {
                        const updated = currentContent.replace(mod.targetContent, mod.replacementContent);
                        await fs.writeFile(targetFilePath, updated, 'utf-8');
                        appliedFiles.push(mod.relativePath);
                    } else {
                        console.warn(`[Studio] TargetContent non trouvé exactement dans ${mod.relativePath}`);
                        // Essayer de normaliser les retours à la ligne
                        const normCurrent = currentContent.replace(/\r\n/g, '\n');
                        const normTarget = mod.targetContent.replace(/\r\n/g, '\n');
                        if (normCurrent.includes(normTarget)) {
                            const updated = normCurrent.replace(normTarget, mod.replacementContent);
                            await fs.writeFile(targetFilePath, updated, 'utf-8');
                            appliedFiles.push(mod.relativePath);
                        } else {
                            throw new Error(`Impossible de localiser l'emplacement précis dans ${mod.relativePath}.`);
                        }
                    }
                } catch (e) {
                    console.error(`[Studio] Erreur sur ${mod.relativePath}:`, e);
                    throw e;
                }
            }
        }

        // 2. Créer les nouveaux fichiers
        if (hasNew) {
            for (const n of result.newFiles) {
                const targetFilePath = path.join(BASE_APP_DIR, n.relativePath);
                await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
                await fs.writeFile(targetFilePath, n.content, 'utf-8');
                appliedFiles.push(n.relativePath);
            }
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
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur Studio" }, { status: 500 });
    }
}
