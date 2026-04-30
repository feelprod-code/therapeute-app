import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data: consults } = await supabase.from('consultations').select('id, patient_name, follow_ups').not('follow_ups', 'is', null);
  
  if (!consults || consults.length === 0) return;
  
  const recent = consults.filter(c => c.follow_ups && c.follow_ups.some(f => f.date && f.date.includes('2026-04-21')));

  for (const c of recent) {
    console.log(`Target Patient: ${c.patient_name} (ID: ${c.id})`);
    for (const f of c.follow_ups) {
      if (f.date && f.date.includes('2026-04-21')) {
        console.log(`- Follow up ID: ${f.id}`);
        console.log(`  Date: ${f.date}`);
        console.log(`  Content length: ${f.content?.length}`);
      }
    }
  }
}
check();
