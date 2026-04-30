import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data: consults } = await supabase.from('consultations').select('id, patient_name, audio_path, created_at').in('id', ['622f32cc-6d57-43e9-a66c-5c46376dc8aa', '75982a47-ccaa-4af1-bbe4-54eb4bb577dc']);
  console.log(consults);
}
check();
