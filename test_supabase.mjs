import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  console.log("--- LATEST CONSULTATIONS ---");
  const { data: consults } = await supabase.from('consultations').select('id, patient_name, audio_path, created_at, transcription').order('created_at', { ascending: false }).limit(5);
  console.log(consults);

  console.log("\n--- LATEST STORAGE FILES ---");
  const { data: files } = await supabase.storage.from('tdt_uploads').list('', { limit: 10, sortBy: { column: 'created_at', order: 'desc' } });
  console.log(files?.map(f => ({ name: f.name, created_at: f.created_at })));
}
check();
