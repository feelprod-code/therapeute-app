import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('consultations').select('id, patient_name, audio_path').order('created_at', { ascending: false }).limit(1);
  const consult = data[0];
  console.log("Triggering analyze for:", consult);

  const payload = {
    audioFile: { fileName: consult.audio_path, mimeType: 'audio/webm' },
    attachedFiles: [],
    previousContext: null
  };

  try {
    const res = await fetch('http://localhost:3001/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    console.log("Status:", res.status);
    const json = await res.json();
    console.log("Response:", json);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}
check();
