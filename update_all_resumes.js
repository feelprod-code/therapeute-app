import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!supabaseUrl || !supabaseKey || !geminiApiKey) {
    console.error('Missing environment variables. Make sure .env.local is configured properly.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function regenerateResume(synthese, patientName) {
    const prompt = `Voici la synthèse médicale complète d'un patient nommé ${patientName || "Anonyme"}.
  
Ton objectif est de générer un NOUVEAU résumé narratif en 3 à 5 phrases MAXIMUM, sous forme d'un paragraphe continu unique (AUCUNE liste, AUCUN tiret, AUCUNE puce). 
Le résumé DOIT refléter l'INTÉGRALITÉ du bilan mis à jour ci-dessous. Tu dois capturer l'essentiel de la situation médicale de façon fluide.

Synthèse Médicale :
"""
${synthese}
"""

Renvoie UNIQUEMENT le texte du résumé, rien d'autre.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
        });
        return response.text.trim();
    } catch (err) {
        console.error(`Erreur Gemini pour ${patientName}:`, err);
        return null;
    }
}

async function main() {
    console.log('Fetching all consultations from Supabase...');
    const { data: consultations, error } = await supabase
        .from('consultations')
        .select('id, patient_name, synthese, resume');

    if (error) {
        console.error('Error fetching consultations:', error);
        process.exit(1);
    }

    console.log(`Found ${consultations.length} consultations.`);

    for (let i = 0; i < consultations.length; i++) {
        const consult = consultations[i];
        console.log(`\nProcessing patient ${i + 1}/${consultations.length}: ${consult.patient_name || 'Sans Nom'} (ID: ${consult.id})`);

        if (!consult.synthese || consult.synthese.trim() === '') {
            console.log('Skipping: No synthesis found.');
            continue;
        }

        console.log('Old Resume snippet:', consult.resume ? consult.resume.substring(0, 50) + "..." : "None");

        const newResume = await regenerateResume(consult.synthese, consult.patient_name);

        if (newResume) {
            console.log('New Resume snippet:', newResume.substring(0, 50) + "...");

            const { error: updateError } = await supabase
                .from('consultations')
                .update({ resume: newResume })
                .eq('id', consult.id);

            if (updateError) {
                console.error(`Error updating DB for ${consult.patient_name}:`, updateError);
            } else {
                console.log(`Successfully updated ${consult.patient_name} in DB.`);
            }
        } else {
            console.log(`Failed to generate new resume for ${consult.patient_name}.`);
        }

        // Rate limiting prevention
        await delay(2000);
    }

    console.log('\nAll consultations processed.');
}

main().catch(console.error);
