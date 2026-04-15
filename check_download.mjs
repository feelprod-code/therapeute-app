import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const fileName = 'audio_1775225535195_67aa816e-cbd1-4e49-b707-8d9af692af0d.webm';

  const { data: publicUrlData } = supabase.storage.from('tdt_uploads').getPublicUrl(fileName);
  console.log("Public URL:", publicUrlData.publicUrl);

  try {
    const res = await fetch(publicUrlData.publicUrl);
    console.log("Fetch Status:", res.status);
    if (res.status !== 200) {
      console.log("Error logic or 404");
    } else {
      console.log("It downloaded! Size:", res.headers.get('content-length'));
    }
  } catch (err) {
    console.error("Fetch error:", err);
  }
}
check();
