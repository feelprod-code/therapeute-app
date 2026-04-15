import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.storage.from('tdt_uploads').list('', { search: '13fb3905-b300-4d91-990d-79e5bc54b92b' });
  console.log("Bucket search:", data, error);
}
run();
