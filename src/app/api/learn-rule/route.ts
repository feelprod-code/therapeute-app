/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const PREFS_PATH = path.join(process.cwd(), 'src', 'lib', 'practitioner-preferences.json');

export async function GET() {
    try {
        const raw = await fs.readFile(PREFS_PATH, 'utf-8').catch(() => '{"rules":[]}');
        const data = JSON.parse(raw);
        return NextResponse.json(data);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Erreur de lecture des règles." }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const { rule, action } = await req.json();
        if (!rule && action !== 'delete') {
            return NextResponse.json({ error: "Aucune règle fournie." }, { status: 400 });
        }

        let data = { rules: [] as string[], lastUpdated: new Date().toISOString() };
        try {
            const raw = await fs.readFile(PREFS_PATH, 'utf-8');
            data = JSON.parse(raw);
        } catch {}

        if (action === 'delete') {
            data.rules = data.rules.filter(r => r !== rule);
        } else {
            const trimmed = String(rule).trim();
            if (trimmed && !data.rules.includes(trimmed)) {
                data.rules.push(trimmed);
            }
        }
        data.lastUpdated = new Date().toISOString();

        await fs.writeFile(PREFS_PATH, JSON.stringify(data, null, 2), 'utf-8');

        return NextResponse.json({
            status: "success",
            rules: data.rules,
            message: action === 'delete' ? "Règle supprimée." : "Règle mémorisée avec succès !"
        });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Erreur d'enregistrement." }, { status: 500 });
    }
}
