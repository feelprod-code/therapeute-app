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
  
  const recent = consults.filter(c => c.follow_ups && c.follow_ups.length > 0).sort((a,b) => {
    // get latest follow up date
    const dateA = new Date(a.follow_ups[0].date).getTime();
    const dateB = new Date(b.follow_ups[0].date).getTime();
    return dateB - dateA; // descending
  });

  console.log(JSON.stringify(recent.map(c => ({ id: c.id, patient_name: c.patient_name, latest_followup: c.follow_ups[0] })), null, 2));
}
check();
