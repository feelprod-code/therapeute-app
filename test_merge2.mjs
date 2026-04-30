import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data: consults } = await supabase.from('consultations').select('id, patient_name, follow_ups').not('follow_ups', 'is', null);
  
  if (!consults || consults.length === 0) {
    console.log("No consultations with follow_ups found.");
    return;
  }
  
  // Find followups created today
  const recent = consults.filter(c => {
    return c.follow_ups && c.follow_ups.some(f => f.date && f.date.includes('2026-04-21'));
  });

  console.log(JSON.stringify(recent, null, 2));
}
check();
