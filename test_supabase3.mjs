import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data: userRecord } = await supabase.from('consultations').select('user_id').limit(1);
  const userId = userRecord[0]?.user_id;
  
  if (!userId) {
    console.error("No user ID found");
    return;
  }

  const payload1 = {
    id: '622f32cc-6d57-43e9-a66c-5c46376dc8aa',
    user_id: userId,
    date: new Date('2026-04-21T15:27:14.629Z').toISOString(),
    patient_name: 'Patient Anonyme Récupéré (17:27)',
    audio_path: 'audio_1776785233641_622f32cc-6d57-43e9-a66c-5c46376dc8aa.webm',
    created_at: new Date('2026-04-21T15:27:14.629Z').toISOString()
  };

  const payload2 = {
    id: '75982a47-ccaa-4af1-bbe4-54eb4bb577dc',
    user_id: userId,
    date: new Date('2026-04-21T15:21:08.454Z').toISOString(),
    patient_name: 'Patient Anonyme Récupéré (17:21)',
    audio_path: 'audio_1776784867418_75982a47-ccaa-4af1-bbe4-54eb4bb577dc.webm',
    created_at: new Date('2026-04-21T15:21:08.454Z').toISOString()
  };

  const { error } = await supabase.from('consultations').insert([payload1, payload2]);
  if (error) {
    console.error("Insert error:", error);
  } else {
    console.log("Successfully recovered the deleted consultations.");
  }
}
check();
