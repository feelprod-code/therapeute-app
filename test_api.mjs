import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("Starting test API analysis script...");
    const { data, error } = await supabase.from('consultations').select('*').order('created_at', { ascending: false }).limit(1);
    if (error) {
        console.error("DB Error:", error);
        return;
    }
    const consult = data[0];
    console.log("Triggering analyze for:", consult.patient_name, consult.id);

    const payload = {
        audioFile: { fileName: consult.audio_path, mimeType: 'audio/webm' },
        attachedFiles: [],
        previousContext: null
    };

    try {
        const res = await fetch('http://localhost:3001/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log("Status:", res.status);
        const json = await res.json();
        console.log("Response:", JSON.stringify(json, null, 2).substring(0, 500) + '...');
    } catch (err) {
        console.error("Fetch error:", err);
    }
}
check();
