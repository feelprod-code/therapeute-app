import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function test() {
  const { data: { session }, error: authErr } = await supabase.auth.signInAnonymously();
  const textContent = "Patient Test. A mal au ventre depuis 3 jours.";
  
  const buffer = Buffer.from(textContent, 'utf-8');
  
  const { error: uploadError, data } = await supabase.storage
    .from('tdt_uploads')
    .upload(`audio_${Date.now()}_test.txt`, buffer, { contentType: 'text/plain' });

  if (uploadError) {
    console.error("Upload Error:", uploadError.message);
  } else {
    console.log("Upload OK:", data);
  }
}

test();
