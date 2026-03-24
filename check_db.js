import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase
    .from('consultations')
    .select('id, patient_name, follow_ups')
    .order('created_at', { ascending: false })
    .limit(3);
    
  if (error) console.error("Error", error);
  else {
    data.forEach(c => {
      let size = 0;
      if (c.follow_ups) {
        size = JSON.stringify(c.follow_ups).length;
      }
      console.log(`Patient: ${c.patient_name}, ID: ${c.id}, Follow-ups JSON size: ${size} bytes`);
    });
  }
}
check();
