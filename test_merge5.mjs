import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data: c } = await supabase.from('consultations').select('user_id, follow_ups').eq('id', 'd6893f56-20a7-451b-8794-01a62300dcf7').single();
  console.log("Total follow_ups for Leonie:", c.follow_ups.length);
}
check();
