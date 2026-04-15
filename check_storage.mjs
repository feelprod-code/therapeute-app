import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
    const fileToLookFor = 'audio_1775225535195_67aa816e-cbd1-4e49-b707-8d9af692af0d.webm';
    const { data, error } = await supabase.storage.from('tdt_uploads').list('', { search: fileToLookFor });
    if (error) {
        console.error("Storage Error:", error);
    } else {
        console.log("Matching files:", data);
    }
}
check();
