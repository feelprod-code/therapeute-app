import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const execAsync = promisify(exec);

export interface MedicalImagingResult {
    success: boolean;
    isMedicalImaging?: boolean;
    examTitle: string;
    examDate?: string;
    physician?: string;
    facility?: string;
    masterPlateUrl: string;
    contactSheetUrl: string;
    conclusionSummary?: string;
    panelsCount?: number;
}

export async function findPython(): Promise<string | null> {
    const candidates = [
        'python3',
        '/usr/local/bin/python3',
        '/opt/homebrew/bin/python3',
        '/usr/bin/python3'
    ];

    for (const p of candidates) {
        try {
            await execAsync(`"${p}" --version`);
            return p;
        } catch {
            // continue checking
        }
    }
    return null;
}

export async function processMedicalDocument(options: {
    fileBuffer: Buffer;
    originalName: string;
    mimeType: string;
    consultationId: string;
    patientName: string;
}): Promise<MedicalImagingResult | null> {
    const { fileBuffer, originalName, mimeType, consultationId, patientName } = options;

    const pythonPath = await findPython();
    if (!pythonPath) {
        console.warn('[MedicalImaging] Python 3 introuvable sur le système hôte, passage du traitement d\'imagerie.');
        return null;
    }

    const geminiKey = process.env.GEMINI_API_KEY || '';
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    if (!geminiKey || !supabaseUrl || !supabaseKey) {
        console.warn('[MedicalImaging] Clés d\'environnement manquantes (Gemini ou Supabase).');
        return null;
    }

    const scriptPath = path.join(process.cwd(), 'src', 'lib', 'medical-imaging', 'pipeline.py');
    let ext = path.extname(originalName).toLowerCase();
    if (!ext) {
        if (mimeType.includes('pdf')) ext = '.pdf';
        else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = '.jpg';
        else if (mimeType.includes('png')) ext = '.png';
        else if (mimeType.includes('webp')) ext = '.webp';
        else ext = '.pdf';
    }

    const tempInput = path.join(os.tmpdir(), `med-in-${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);

    try {
        await fs.writeFile(tempInput, fileBuffer);
        console.log(`[MedicalImaging] Démarrage du pipeline sur ${originalName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);

        const cmd = `"${pythonPath}" "${scriptPath}" ` +
            `--input-path "${tempInput}" ` +
            `--consultation-id "${consultationId || 'global'}" ` +
            `--patient-name "${patientName.replace(/"/g, '\\"')}" ` +
            `--gemini-key "${geminiKey}" ` +
            `--supabase-url "${supabaseUrl}" ` +
            `--supabase-key "${supabaseKey}"`;

        const { stdout, stderr } = await execAsync(cmd, {
            maxBuffer: 15 * 1024 * 1024,
            timeout: 180000 // 3 minutes timeout
        });

        if (stderr && stderr.trim().length > 0) {
            console.log('[MedicalImaging] stderr:', stderr.trim());
        }

        const trimmed = stdout.trim();
        const jsonMatch = trimmed.match(/\{[\s\S]*\}$/);
        if (!jsonMatch) {
            console.warn('[MedicalImaging] Pas de JSON valide retourné par le script:', trimmed);
            return null;
        }

        const data = JSON.parse(jsonMatch[0]);
        if (data.is_medical_imaging === false) {
            console.log('[MedicalImaging] Document identifié comme administratif / textuel sans imagerie. Pas de planche générée.');
            return null;
        }

        if (data.error) {
            console.error('[MedicalImaging] Erreur dans le script Python:', data.error);
            return null;
        }

        console.log(`[MedicalImaging] Succès ! Planche maîtresse générée: ${data.master_plate_url}`);
        return {
            success: true,
            isMedicalImaging: true,
            examTitle: data.exam_title,
            examDate: data.exam_date,
            physician: data.physician,
            facility: data.facility,
            masterPlateUrl: data.master_plate_url,
            contactSheetUrl: data.contact_sheet_url,
            conclusionSummary: data.conclusion_summary,
            panelsCount: data.panels_count
        };

    } catch (err) {
        console.error('[MedicalImaging] Exception lors de l\'exécution du pipeline:', err);
        return null;
    } finally {
        await fs.unlink(tempInput).catch(() => {});
    }
}

// Backwards compatibility
export async function processMedicalPdf(options: {
    pdfBuffer: Buffer;
    originalName: string;
    consultationId: string;
    patientName: string;
}): Promise<MedicalImagingResult | null> {
    return processMedicalDocument({
        fileBuffer: options.pdfBuffer,
        originalName: options.originalName,
        mimeType: 'application/pdf',
        consultationId: options.consultationId,
        patientName: options.patientName
    });
}
