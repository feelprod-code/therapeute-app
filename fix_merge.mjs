import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function fix() {
  const targetId = 'd6893f56-20a7-451b-8794-01a62300dcf7';
  const { data: c } = await supabase.from('consultations').select('user_id, follow_ups').eq('id', targetId).single();
  
  if (!c || !c.follow_ups || c.follow_ups.length === 0) {
    console.log("Nothing to fix.");
    return;
  }
  
  const payloads = c.follow_ups.map(f => ({
    id: f.id, // we can reuse the follow_up id as the consultation id (they are valid UUIDs)
    user_id: c.user_id,
    date: new Date().toISOString(),
    patient_name: `Patient Anonyme À Fusionner (${f.date.substring(11,16)})`,
    synthese: f.content,
    transcription: f.transcription || "",
    resume: "",
    created_at: new Date().toISOString()
  }));

  const { error: insertError } = await supabase.from('consultations').insert(payloads);
  if (insertError) {
    console.error("Failed to restore:", insertError);
    return;
  }

  const { error: updateError } = await supabase.from('consultations').update({ follow_ups: [] }).eq('id', targetId);
  if (updateError) {
    console.error("Failed to clear follow_ups:", updateError);
  } else {
    console.log("Successfully extracted follow-ups back into separate consultations!");
  }
}
fix();
