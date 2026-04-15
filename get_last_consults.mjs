import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase.from('consultations').select('id, patient_name, audio_path, transcription, synthese, created_at').order('created_at', { ascending: false }).limit(5);
    if (error) {
        console.error(error);
    } else {
        for (const c of data) {
            console.log(`- ${c.patient_name} (${c.id}) [${c.created_at}] \n  audio: ${c.audio_path} \n  transc: ${c.transcription ? 'YES' : 'NO'}, synth: ${c.synthese ? 'YES' : 'NO'}`);
        }
    }
}
check();
