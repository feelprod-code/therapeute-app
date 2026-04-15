const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const supabaseUrl = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = envFile.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('consultations').select('id, patient_name, audio_path, transcription, synthese, created_at').order('created_at', { ascending: false }).limit(5);
  if (error) {
    console.error(error);
  } else {
    for (const c of data) {
      console.log(`- ${c.patient_name} (${c.id}) [${c.created_at}] audio: ${c.audio_path}, transc: ${c.transcription ? 'YES' : 'NO'}, synth: ${c.synthese ? 'YES' : 'NO'}`);
    }
  }
}
check();
