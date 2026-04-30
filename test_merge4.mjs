import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data: c } = await supabase.from('consultations').select('id, follow_ups').eq('id', 'd6893f56-20a7-451b-8794-01a62300dcf7').single();
  const f1 = c.follow_ups.find(f => f.id === '4c51912c-9150-4401-b7dd-005d306ed756');
  const f2 = c.follow_ups.find(f => f.id === 'cd65445b-a2d2-4371-89b7-e3ea60e862a8');
  console.log("Follow up 1 (15:59):", f1?.content?.substring(0, 300));
  console.log("Follow up 2 (15:30):", f2?.content?.substring(0, 300));
}
check();
